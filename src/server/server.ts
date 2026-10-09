import { mkdirSync } from "node:fs";
import { link, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { Diagram } from "../core/model";
import index from "../web/index.html";

const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const RenameBody = z.object({ name: z.string() });

const fail = (status: number, error: string) => Response.json({ error }, { status });
const etagOf = (bytes: Uint8Array | string) => `"${Bun.hash(bytes).toString(16)}"`;
const isCode = (e: unknown, code: string) => (e as { code?: string }).code === code;

export function startServer({ dir, port }: { dir: string; port: number }) {
  mkdirSync(dir, { recursive: true });
  const file = (name: string | undefined) => join(dir, `${name}.json`);

  const guard =
    (handler: (req: Bun.BunRequest<string>) => Promise<Response> | Response) =>
    async (req: Bun.BunRequest<string>) => {
      const p = server.port;
      const hosts = [`127.0.0.1:${p}`, `localhost:${p}`];
      const origin = req.headers.get("origin");
      if (
        !hosts.includes(req.headers.get("host") ?? "") ||
        (origin !== null && !hosts.some((h) => origin === `http://${h}`))
      ) {
        return fail(403, "forbidden");
      }
      try {
        return await handler(req);
      } catch (e) {
        return fail(500, e instanceof Error ? e.message : "internal error");
      }
    };

  const parseDiagram = (text: string) => {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return "invalid JSON";
    }
    const r = Diagram.safeParse(json);
    if (!r.success) return r.error.issues[0]?.message ?? "invalid diagram";
    return r.data;
  };

  const currentEtag = async (path: string) => {
    const f = Bun.file(path);
    return (await f.exists()) ? etagOf(await f.bytes()) : null;
  };

  const list = async () => {
    const out: { name: string; modified: string }[] = [];
    for (const f of await readdir(dir)) {
      const name = f.endsWith(".json") ? f.slice(0, -5) : "";
      if (!NAME.test(name)) continue;
      out.push({ name, modified: (await stat(join(dir, f))).mtime.toISOString() });
    }
    return Response.json(out.sort((a, b) => (a.name < b.name ? -1 : 1)));
  };

  const get = async (path: string) => {
    const f = Bun.file(path);
    if (!(await f.exists())) return fail(404, "not found");
    const bytes = await f.bytes();
    const r = parseDiagram(new TextDecoder().decode(bytes));
    if (typeof r === "string") return fail(500, `corrupt diagram: ${r}`);
    return new Response(bytes, {
      headers: { "Content-Type": "application/json", ETag: etagOf(bytes) },
    });
  };

  const put = async (req: Bun.BunRequest<string>, path: string) => {
    const r = parseDiagram(await req.text());
    if (typeof r === "string") return fail(400, r);
    const body = JSON.stringify(r, null, 2);
    const tmp = `${path}.tmp`;
    await Bun.write(tmp, body);
    try {
      if (req.headers.get("if-none-match") === "*") {
        try {
          await link(tmp, path);
        } catch (e) {
          if (isCode(e, "EEXIST")) return fail(412, "already exists");
          throw e;
        }
        await unlink(tmp);
      } else {
        const ifMatch = req.headers.get("if-match");
        if (ifMatch !== null && (await currentEtag(path)) !== ifMatch) {
          await unlink(tmp);
          return fail(412, "etag mismatch");
        }
        await rename(tmp, path);
      }
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
    return new Response(null, { status: 204, headers: { ETag: etagOf(body) } });
  };

  const del = async (path: string) => {
    try {
      await unlink(path);
    } catch (e) {
      if (isCode(e, "ENOENT")) return fail(404, "not found");
      throw e;
    }
    return new Response(null, { status: 204 });
  };

  const renameDiagram = async (req: Bun.BunRequest<string>, src: string) => {
    const body = RenameBody.safeParse(await req.json().catch(() => null));
    if (!body.success || !NAME.test(body.data.name)) return fail(400, "invalid name");
    const dst = file(body.data.name);
    try {
      await link(src, dst);
    } catch (e) {
      if (isCode(e, "ENOENT")) return fail(404, "not found");
      if (isCode(e, "EEXIST")) return fail(409, "target exists");
      throw e;
    }
    if (dst !== src) await unlink(src);
    return new Response(null, { status: 204 });
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    development: process.env.NODE_ENV === "production" ? false : { hmr: true },
    routes: {
      "/api/diagrams": guard((req) => (req.method === "GET" ? list() : fail(404, "not found"))),
      "/api/diagrams/:name": guard((req) => {
        if (!NAME.test(req.params.name ?? "")) return fail(400, "invalid name");
        const path = file(req.params.name);
        if (req.method === "GET") return get(path);
        if (req.method === "PUT") return put(req, path);
        if (req.method === "DELETE") return del(path);
        return fail(404, "not found");
      }),
      "/api/diagrams/:name/rename": guard((req) => {
        if (req.method !== "POST") return fail(404, "not found");
        if (!NAME.test(req.params.name ?? "")) return fail(400, "invalid name");
        return renameDiagram(req, file(req.params.name));
      }),
      "/api/*": guard(() => fail(404, "not found")),
      "/*": index,
    },
  });
  return server;
}
