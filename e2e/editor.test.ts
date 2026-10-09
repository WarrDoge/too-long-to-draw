import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import {
  canvasOrigin,
  ellipsePoints,
  eventually,
  openDiagram,
  rectPoints,
  setup,
  sketchAt,
} from "./harness";

let env: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  env = await setup();
}, 30_000);
afterAll(() => env.close());

const onDisk = (name: string) => readFileSync(join(env.dir, `${name}.json`), "utf8");

let n = 0;
async function fresh(name = `t${++n}`) {
  const page = await env.browser.newPage({ viewport: { width: 1280, height: 800 } });
  await openDiagram(env, page, name);
  return { page, name };
}

const shapes = (p: Page, kind = "") => p.locator(`g[data-shape${kind ? `="${kind}"` : ""}]`);
const ink = (p: Page) => p.locator("polyline[data-ink]");

async function draw(page: Page) {
  await page.keyboard.press("d");
}

async function drawRect(page: Page, x = 200, y = 150) {
  await sketchAt(page, rectPoints(x, y, 160, 100));
}

test("rectangle sketch converts to one rectangle", async () => {
  const { page } = await fresh();
  await draw(page);
  await drawRect(page);
  await page.keyboard.press("Enter");
  await eventually(() => shapes(page, "rectangle").count(), 1);
  expect(await ink(page).count()).toBe(0);
  expect(await shapes(page).count()).toBe(1);
}, 30_000);

test("ellipse sketch converts to ellipse", async () => {
  const { page } = await fresh();
  await draw(page);
  await sketchAt(page, ellipsePoints(300, 250, 90, 60), 3);
  await page.keyboard.press("Enter");
  await eventually(() => shapes(page, "ellipse").count(), 1);
}, 30_000);

test("line with arrowhead between rectangles becomes glued connector", async () => {
  const { page } = await fresh();
  await draw(page);
  await drawRect(page, 100, 150);
  await drawRect(page, 440, 150);
  await sketchAt(page, [
    { x: 261, y: 201 },
    { x: 439, y: 199 },
  ]);
  await sketchAt(page, [
    { x: 425, y: 188 },
    { x: 440, y: 200 },
    { x: 425, y: 212 },
  ]);
  await page.keyboard.press("Enter");
  await eventually(() => shapes(page).count(), 2);
  const c = page.locator("g[data-connector]");
  await eventually(() => c.count(), 1);
  await eventually(() => c.getAttribute("data-source"), "glued");
  await eventually(() => c.getAttribute("data-target"), "glued");
  await eventually(() => c.locator('polygon[data-arrow="target"]').count(), 1);
}, 30_000);

test("Ctrl+Z after conversion restores ink", async () => {
  const { page } = await fresh();
  await draw(page);
  await drawRect(page, 100, 150);
  await drawRect(page, 440, 150);
  await page.keyboard.press("Enter");
  await eventually(() => shapes(page).count(), 2);
  await page.keyboard.press("Control+z");
  await eventually(() => shapes(page).count(), 0);
  await eventually(() => ink(page).count(), 2);
}, 30_000);

test("Tab cycles the converted shape; undo still restores ink", async () => {
  const { page } = await fresh();
  await draw(page);
  await drawRect(page);
  await page.keyboard.press("Enter");
  const shape = shapes(page);
  await eventually(() => shape.count(), 1);
  const k0 = await shape.getAttribute("data-shape");
  await page.keyboard.press("Tab");
  const k1 = await shape.getAttribute("data-shape");
  expect(k1).not.toBe(k0);
  await page.keyboard.press("Tab");
  const k2 = await shape.getAttribute("data-shape");
  expect(k2).not.toBe(k1);
  await page.keyboard.press("Control+z");
  await eventually(() => shapes(page).count(), 0);
  await eventually(() => ink(page).count(), 1);
}, 30_000);

test("draw-mode double-click creates free text without ink", async () => {
  const { page } = await fresh();
  await draw(page);
  const o = await canvasOrigin(page);
  await page.mouse.dblclick(o.x + 300, o.y + 200);
  expect(await ink(page).count()).toBe(0);
  const ed = page.locator("textarea[data-editor]");
  await eventually(() => ed.isVisible(), true);
  await page.keyboard.type("Hello");
  await page.keyboard.press("Escape");
  await eventually(() => ed.count(), 0);
  await eventually(
    async () => ((await page.locator("text[data-text]").textContent()) ?? "").includes("Hello"),
    true,
  );
  expect(await ink(page).count()).toBe(0);
}, 30_000);

test("double-click labels a shape and a connector", async () => {
  const { page } = await fresh();
  await draw(page);
  await drawRect(page, 100, 150);
  await drawRect(page, 440, 150);
  await sketchAt(page, [
    { x: 261, y: 201 },
    { x: 439, y: 199 },
  ]);
  await page.keyboard.press("Enter");
  await page.keyboard.press("v");
  const o = await canvasOrigin(page);
  const ed = page.locator("textarea[data-editor]");

  const first = shapes(page).first();
  const b = await first.boundingBox();
  if (!b) throw new Error("no shape box");
  await page.mouse.dblclick(b.x + 10, b.y + b.height / 2 - 20);
  await eventually(() => ed.isVisible(), true);
  await page.keyboard.type("API");
  await page.mouse.click(o.x + 600, o.y + 500);
  await eventually(() => ed.count(), 0);
  await eventually(async () => ((await first.textContent()) ?? "").includes("API"), true);

  const conn = page.locator("g[data-connector]");
  await eventually(() => conn.count(), 1);
  const cb = await conn.locator("path").first().boundingBox();
  if (!cb) throw new Error("no connector box");
  await page.mouse.dblclick(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await eventually(() => ed.isVisible(), true);
  await page.keyboard.type("calls");
  await page.mouse.click(o.x + 600, o.y + 500);
  await eventually(async () => ((await conn.textContent()) ?? "").includes("calls"), true);
}, 30_000);

test("palette drag adds a diamond", async () => {
  const { page } = await fresh();
  const canvas = page.locator("svg[data-canvas]");
  await page
    .locator('[data-palette="diamond"]')
    .dragTo(canvas, { targetPosition: { x: 300, y: 250 } });
  await eventually(() => shapes(page, "diamond").count(), 1);
}, 30_000);

test("autosave round-trips through reload and disk", async () => {
  const { page, name } = await fresh();
  await draw(page);
  await drawRect(page);
  await page.keyboard.press("Enter");
  await eventually(() => shapes(page, "rectangle").count(), 1);
  await eventually(async () => onDisk(name).includes('"rectangle"'), true);
  await eventually(() => page.locator('[data-status="saved"]').count(), 1);
  await page.reload();
  await eventually(() => shapes(page, "rectangle").count(), 1);
}, 30_000);

test("conflict stops autosave until Ctrl+S overwrites", async () => {
  const { page: a, name } = await fresh();
  const b = await env.browser.newPage({ viewport: { width: 1280, height: 800 } });
  await b.goto(`${env.url}/d/${name}`);
  await b.locator("svg[data-canvas]").waitFor();

  await a.locator('[data-palette="diamond"]').dragTo(a.locator("svg[data-canvas]"), {
    targetPosition: { x: 300, y: 250 },
  });
  await a.keyboard.press("Control+s");
  await eventually(() => a.locator('[data-status="saved"]').isVisible(), true);
  await eventually(async () => onDisk(name).includes('"diamond"'), true);

  await b.locator('[data-palette="ellipse"]').dragTo(b.locator("svg[data-canvas]"), {
    targetPosition: { x: 300, y: 250 },
  });
  const status = b.locator("[data-status]");
  await eventually(() => status.getAttribute("data-status"), "conflict");
  await b.waitForTimeout(2_000);
  await eventually(() => status.getAttribute("data-status"), "conflict");

  await b.keyboard.press("Control+s");
  await eventually(() => status.getAttribute("data-status"), "saved");
  const disk = onDisk(name);
  expect(disk).toContain('"ellipse"');
  expect(disk).not.toContain('"diamond"');
}, 30_000);
