import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_STYLE, emptyDiagram } from "../core/model";
import { startServer } from "./server";

const dir = mkdtempSync(join(tmpdir(), "ttd-api-"));
const server = startServer({ dir, port: 0 });
const base = `http://127.0.0.1:${server.port}`;
afterAll(async () => {
  await server.stop(true);
  await rm(dir, { recursive: true, force: true });
});

const api = (path: string, init?: RequestInit) => fetch(base + path, init);
const put = (name: string, body: unknown, headers: Record<string, string> = {}) =>
  api(`/api/diagrams/${name}`, {
    method: "PUT",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers,
  });
const expectError = async (res: Response, status: number) => {
  expect(res.status).toBe(status);
  const j = (await res.json()) as { error: unknown };
  expect(typeof j.error).toBe("string");
};

describe("html", () => {
  test("served at / and client routes", async () => {
    for (const p of ["/", "/d/x"]) {
      const res = await api(p);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<div id="app">');
    }
  });
});

describe("crud", () => {
  test("list, get, put, delete with etag round-trip", async () => {
    expect(await (await api("/api/diagrams")).json()).toEqual([]);
    const res = await put("b", emptyDiagram());
    expect(res.status).toBe(204);
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^"[0-9a-f]+"$/);
    await put("a", emptyDiagram());
    await Bun.write(join(dir, "c.json.tmp"), "x");
    await Bun.write(join(dir, "bad.name.json"), "x");

    const list = (await (await api("/api/diagrams")).json()) as {
      name: string;
      modified: string;
    }[];
    expect(list.map((d) => d.name)).toEqual(["a", "b"]);
    expect(new Date(list[0]?.modified ?? "").toISOString()).toBe(list[0]?.modified ?? "");

    const got = await api("/api/diagrams/b");
    expect(got.headers.get("content-type")).toContain("application/json");
    expect(got.headers.get("etag")).toBe(etag);
    expect(await got.json()).toEqual(emptyDiagram());

    expect((await api("/api/diagrams/b", { method: "DELETE" })).status).toBe(204);
    await expectError(await api("/api/diagrams/b"), 404);
    await expectError(await api("/api/diagrams/b", { method: "DELETE" }), 404);
  });

  test("conditional puts", async () => {
    const first = await put("cond", emptyDiagram(), { "If-None-Match": "*" });
    expect(first.status).toBe(204);
    const etag = first.headers.get("etag") ?? "";
    await expectError(await put("cond", emptyDiagram(), { "If-None-Match": "*" }), 412);

    const d = {
      ...emptyDiagram(),
      texts: [{ id: "t", x: 1, y: 2, content: "hi", style: DEFAULT_STYLE }],
    };
    await expectError(await put("cond", d, { "If-Match": '"stale"' }), 412);
    const ok = await put("cond", d, { "If-Match": etag });
    expect(ok.status).toBe(204);
    expect((await api("/api/diagrams/cond")).headers.get("etag")).toBe(ok.headers.get("etag"));
    await expectError(await put("cond", d, { "If-Match": etag }), 412);
    await expectError(await put("missing-im", d, { "If-Match": etag }), 412);

    expect((await put("cond", emptyDiagram())).status).toBe(204);
    const names = await Array.fromAsync(new Bun.Glob("*.tmp").scan(dir));
    expect(names.filter((n) => n.startsWith("cond"))).toEqual([]);
  });
});

describe("validation", () => {
  test("bad names", async () => {
    for (const n of ["a.b", "a%2Eb", "x".repeat(65)]) {
      await expectError(await api(`/api/diagrams/${n}`), 400);
      await expectError(await put(n, emptyDiagram()), 400);
    }
  });

  test("bad bodies", async () => {
    await expectError(await put("v", "{nope"), 400);
    await expectError(await put("v", { version: 1 }), 400);
    const dangling = {
      ...emptyDiagram(),
      shapes: [
        {
          id: "s",
          kind: "rectangle",
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          label: "",
          parent: "nope",
          style: {
            fill: "#fff",
            stroke: "#000",
            strokeWidth: 1,
            fontSize: 12,
            fontColor: "#000",
            align: "center",
          },
        },
      ],
    };
    await expectError(await put("v", dangling), 400);
    await expectError(await api("/api/diagrams/v"), 404);
  });

  test("corrupt file on disk", async () => {
    await Bun.write(join(dir, "corrupt.json"), "{nope");
    await expectError(await api("/api/diagrams/corrupt"), 500);
    await Bun.write(join(dir, "corrupt.json"), '{"version":1}');
    await expectError(await api("/api/diagrams/corrupt"), 500);
  });
});

describe("rename", () => {
  const rename = (name: string, body: unknown) =>
    api(`/api/diagrams/${name}/rename`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  test("success, collision, missing, bad body", async () => {
    await put("r1", emptyDiagram());
    await put("r2", emptyDiagram());
    await expectError(await rename("r1", { name: "r2" }), 409);
    await expectError(await rename("nope", { name: "r3" }), 404);
    await expectError(await rename("r1", { name: "a.b" }), 400);
    await expectError(await rename("r1", { nam: "x" }), 400);
    await expectError(await rename("r1", "{bad"), 400);
    expect((await rename("r1", { name: "r3" })).status).toBe(204);
    await expectError(await api("/api/diagrams/r1"), 404);
    expect((await api("/api/diagrams/r3")).status).toBe(200);
  });
});

describe("routing and guard", () => {
  test("unknown route and wrong method give JSON 404", async () => {
    await expectError(await api("/api/nope"), 404);
    await expectError(await api("/api/diagrams", { method: "POST" }), 404);
    await expectError(await api("/api/diagrams/x", { method: "PATCH" }), 404);
    await expectError(await api("/api/diagrams/x/rename"), 404);
  });

  test("Origin rejection", async () => {
    await expectError(await api("/api/diagrams", { headers: { Origin: "http://evil.com" } }), 403);
    await expectError(await api("/api/nope", { headers: { Origin: "http://evil.com" } }), 403);
    const ok = await api("/api/diagrams", {
      headers: { Origin: `http://localhost:${server.port}` },
    });
    expect(ok.status).toBe(200);
  });

  test("Host rejection", async () => {
    for (const p of ["/api/diagrams", "/api/nope"]) {
      await expectError(await api(p, { headers: { Host: "evil.com" } }), 403);
      await expectError(await api(p, { headers: { Host: "127.0.0.1:1" } }), 403);
    }
    const ok = await api("/api/diagrams", { headers: { Host: `localhost:${server.port}` } });
    expect(ok.status).toBe(200);
  });
});
