import { afterAll, beforeAll, expect, test } from "bun:test";
import { setup } from "./harness";

let env: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  env = await setup();
}, 30_000);
afterAll(() => env.close());

test("/ loads", async () => {
  const page = await env.browser.newPage();
  const res = await page.goto(env.url);
  expect(res?.status()).toBe(200);
  expect(await page.locator("div#app").count()).toBe(1);
}, 30_000);
