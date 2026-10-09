import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { clusterInk } from "./cluster";
import { mulberry32, synthesize } from "./dollarp";
import { Ink, SHAPE_KINDS, type ShapeKind } from "./model";
import { recognize } from "./recognize";

const SAMPLES = 40;
const NOISE = 0.016;

const SYNTHETIC_FLOOR: Record<ShapeKind, number> = {
  rectangle: 0.9,
  "rounded-rectangle": 0.85,
  ellipse: 0.9,
  diamond: 0.9,
  triangle: 0.9,
  parallelogram: 0.85,
  hexagon: 0.85,
  cylinder: 0.85,
  cloud: 0.85,
};
// Five files per kind: a floor of 0.8 tolerates one miss.
const FIXTURE_FLOOR = 0.8;

const top = (strokes: Ink["strokes"]) => {
  const { shapes, lines } = clusterInk({ strokes });
  return shapes.length === 1 && lines.length === 0 ? recognize(shapes[0]!)[0]!.kind : undefined;
};

for (const [k, kind] of SHAPE_KINDS.entries()) {
  test(`synthetic ${kind}`, () => {
    const rng = mulberry32(90210 + k);
    let hits = 0;
    for (let i = 0; i < SAMPLES; i++) {
      if (top(synthesize(kind, rng, { noise: NOISE })) === kind) hits++;
    }
    expect(hits / SAMPLES).toBeGreaterThanOrEqual(SYNTHETIC_FLOOR[kind]);
  });
}

const fixtures = (dir: string) => {
  const root = new URL(`./fixtures/${dir}/`, import.meta.url);
  return readdirSync(root)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({
      name: `${dir}/${f}`,
      ink: Ink.parse(JSON.parse(readFileSync(new URL(f, root), "utf8"))),
    }));
};

for (const kind of SHAPE_KINDS) {
  test(`fixtures ${kind}`, () => {
    const files = fixtures(kind);
    expect(files.length).toBeGreaterThanOrEqual(5);
    const miss: string[] = [];
    for (const { name, ink } of files) {
      const { shapes, lines } = clusterInk(ink);
      if (shapes.length !== 1 || lines.length !== 0 || recognize(shapes[0]!)[0]!.kind !== kind) {
        miss.push(name);
      }
    }
    expect(
      (files.length - miss.length) / files.length,
      `missed: ${miss.join(", ")}`,
    ).toBeGreaterThanOrEqual(FIXTURE_FLOOR);
  });
}

test("fixtures line: one plain line", () => {
  for (const { name, ink } of fixtures("line")) {
    const { shapes, lines } = clusterInk(ink);
    expect([name, shapes.length, lines.length]).toEqual([name, 0, 1]);
    expect(lines[0]).toMatchObject({ arrowStart: false, arrowEnd: false });
  }
});

test("fixtures arrow: one line with an arrowhead", () => {
  const files = fixtures("arrow");
  expect(files.length).toBeGreaterThanOrEqual(5);
  for (const { name, ink } of files) {
    const { shapes, lines } = clusterInk(ink);
    expect([name, shapes.length, lines.length]).toEqual([name, 0, 1]);
    expect(lines[0]!.arrowStart || lines[0]!.arrowEnd).toBe(true);
  }
});

test("ranking lists all 9 kinds, best first, and is deterministic", () => {
  const rng = mulberry32(5);
  const scribble = Array.from({ length: 80 }, (_, i) => ({
    x: 300 + 120 * Math.sin(i * 0.9) * rng(),
    y: 300 + 90 * Math.cos(i * 1.7) * rng() + i,
  }));
  const inks = [
    [scribble],
    ...SHAPE_KINDS.map((kind) => synthesize(kind, mulberry32(11), { noise: NOISE })),
  ];
  for (const strokes of inks) {
    const cluster = { strokes, points: strokes.flat(), compound: strokes.length === 2 };
    const a = recognize(cluster);
    expect(a.map((r) => r.kind).toSorted()).toEqual([...SHAPE_KINDS].toSorted());
    expect(a.map((r) => r.score)).toEqual(a.map((r) => r.score).toSorted((x, y) => y - x));
    expect(recognize(cluster)).toEqual(a);
  }
});

test("compound decides cylinder", () => {
  const [shape] = clusterInk({ strokes: synthesize("cylinder", mulberry32(3)) }).shapes;
  expect(recognize(shape!)[0]!.kind).toBe("cylinder");
  const [ellipse] = clusterInk({ strokes: synthesize("ellipse", mulberry32(3)) }).shapes;
  expect(recognize(ellipse!)[0]!.kind).toBe("ellipse");
  expect(recognize({ ...ellipse!, compound: true })[0]!.kind).toBe("cylinder");
});
