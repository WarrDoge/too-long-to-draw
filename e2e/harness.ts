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
