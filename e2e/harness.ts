import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { startServer } from "../src/server/server";

export async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ttd-e2e-"));
  const server = startServer({ dir, port: 0 });
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  return {
    browser,
    server,
    url: `http://127.0.0.1:${server.port}`,
    dir,
    async close() {
      await browser.close();
      await server.stop(true);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function sketch(page: Page, points: { x: number; y: number }[], steps = 8) {
  const [first, ...rest] = points;
  if (!first) return;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of rest) await page.mouse.move(p.x, p.y, { steps });
  await page.mouse.up();
}

export type Pt = { x: number; y: number };
export const EMPTY = { version: 1, shapes: [], connectors: [], texts: [] };

export async function openDiagram(
  env: { url: string },
  page: Page,
  name: string,
  body: unknown = EMPTY,
) {
  const res = await fetch(`${env.url}/api/diagrams/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${name}: ${res.status}`);
  await page.goto(`${env.url}/d/${name}`);
  await page.locator("svg[data-canvas]").waitFor();
}

/** Canvas top-left in page coordinates; sketch points are relative to it. */
export async function canvasOrigin(page: Page): Promise<Pt> {
  const box = await page.locator("svg[data-canvas]").boundingBox();
  if (!box) throw new Error("no canvas");
  return { x: box.x, y: box.y };
}

export async function sketchAt(page: Page, points: Pt[], steps = 10) {
  const o = await canvasOrigin(page);
  await sketch(
    page,
    points.map((p) => ({ x: o.x + p.x, y: o.y + p.y })),
    steps,
  );
}

/** Closed, slightly imperfect rectangle outline. */
export function rectPoints(x: number, y: number, w: number, h: number): Pt[] {
  return [
    { x: x + 2, y: y - 1 },
    { x: x + w - 2, y: y + 2 },
    { x: x + w + 1, y: y + h - 2 },
    { x: x - 1, y: y + h + 1 },
    { x: x + 1, y: y + 1 },
  ];
}

export function ellipsePoints(cx: number, cy: number, rx: number, ry: number, n = 40): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });
}

/** Poll until `get` resolves to `want` (bun's expect has no auto-retrying matchers). */
export async function eventually<T>(get: () => Promise<T>, want: T, timeout = 10_000) {
  const end = Date.now() + timeout;
  let got = await get();
  while (got !== want && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
    got = await get();
  }
  if (got !== want) throw new Error(`expected ${String(want)}, got ${String(got)}`);
}
