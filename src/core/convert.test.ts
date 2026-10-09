import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { convertInk, retype } from "./convert";
import { mulberry32, synthesize } from "./dollarp";
import { GRID } from "./geometry";
import {
  DEFAULT_STYLE,
  Diagram,
  emptyDiagram,
  Ink,
  type Point,
  SHAPE_KINDS,
  type Shape,
} from "./model";

const counter = () => {
  let n = 0;
  return () => `id${++n}`;
};
const run = (ink: Ink, d: Diagram = emptyDiagram(), scale?: number) => {
  const r = convertInk(d, ink, { newId: counter(), ...(scale && { scale }) });
  Diagram.parse(r.diagram);
  return r;
};

const seg = (a: [number, number], b: [number, number]): Point[] =>
  Array.from({ length: 13 }, (_, i) => ({
    x: a[0] + ((b[0] - a[0]) * i) / 12,
    y: a[1] + ((b[1] - a[1]) * i) / 12,
  }));
const box = (x: number, y: number, w: number, h: number): Point[] => [
  ...seg([x, y], [x + w, y]),
  ...seg([x + w, y], [x + w, y + h]),
  ...seg([x + w, y + h], [x, y + h]),
  ...seg([x, y + h], [x, y + 2]),
];
const ellipse = (cx: number, cy: number, rx: number, ry: number): Point[] =>
  Array.from({ length: 49 }, (_, i) => ({
    x: cx + rx * Math.cos((i / 48) * 2 * Math.PI),
    y: cy + ry * Math.sin((i / 48) * 2 * Math.PI),
  }));
const existing = (id: string, x: number, y: number, w: number, h: number): Shape => ({
  id,
  kind: "rectangle",
  x,
  y,
  w,
  h,
  label: "",
  style: DEFAULT_STYLE,
});
const withShapes = (...shapes: Shape[]): Diagram => ({ ...emptyDiagram(), shapes });

test("a rectangle and an ellipse", () => {
  const { diagram, last } = run({
    strokes: [box(100, 100, 200, 100), ellipse(500, 200, 100, 50)],
  });
  expect(diagram.shapes.map((s) => s.kind)).toEqual(["rectangle", "ellipse"]);
  expect(diagram.shapes[0]).toMatchObject({ x: 100, y: 100, w: 200, h: 100, label: "" });
  expect(last?.shapeId).toBe(diagram.shapes[1]!.id);
  expect(last?.ranked.length).toBe(9);
  expect(last?.ranked[0]).toBe("ellipse");
});

test("two boxes and an arrow become a connector glued at both ends", () => {
  const { diagram } = run({
    strokes: [box(100, 100, 120, 100), box(400, 100, 120, 100), seg([222, 150], [398, 152])],
  });
  expect(diagram.connectors.length).toBe(1);
  const [a, b] = diagram.shapes;
  const c = diagram.connectors[0]!;
  expect(c.source).toEqual({ kind: "glued", shapeId: a!.id });
  expect(c.target).toEqual({ kind: "glued", shapeId: b!.id });
});

test("arrow flags map to ends, omitted when false", () => {
  const head = (tip: [number, number]) => [
    { x: tip[0] - 14, y: tip[1] - 9 },
    { x: tip[0], y: tip[1] },
    { x: tip[0] - 14, y: tip[1] + 9 },
  ];
  const { diagram } = run({
    strokes: [
      box(100, 100, 120, 100),
      box(400, 100, 120, 100),
      seg([222, 150], [398, 150]),
      head([398, 150]),
    ],
  });
  const c = diagram.connectors[0]!;
  expect(c.target).toMatchObject({ kind: "glued", arrow: true });
  expect("arrow" in c.source).toBe(false);
});

test("a line ending on an existing shape is glued to it", () => {
  const d = withShapes(existing("box", 300, 100, 100, 100));
  const { diagram } = run({ strokes: [seg([100, 150], [298, 150])] }, d);
  const c = diagram.connectors[0]!;
  expect(c.source).toEqual({ kind: "free", x: 100, y: 150 });
  expect(c.target).toEqual({ kind: "glued", shapeId: "box" });
});

test("a line with the same shape at both ends is skipped", () => {
  const d = withShapes(existing("box", 300, 100, 200, 100));
  const { diagram } = run({ strokes: [seg([298, 130], [302, 170])] }, d);
  expect(diagram.connectors.length).toBe(0);
});

test("nested drawn boxes give a parent", () => {
  const { diagram } = run({ strokes: [box(100, 100, 300, 250), box(160, 160, 100, 80)] });
  const [outer, inner] = diagram.shapes;
  expect(outer!.parent).toBeUndefined();
  expect(inner!.parent).toBe(outer!.id);
});

test("a box drawn inside an existing shape becomes its child", () => {
  const d = withShapes(existing("big", 100, 100, 400, 300));
  const { diagram } = run({ strokes: [box(200, 200, 100, 80)] }, d);
  expect(diagram.shapes[1]!.parent).toBe("big");
  expect(diagram.shapes[0]!.parent).toBeUndefined();
});

test("near-square becomes square, an ellipse a circle", () => {
  const { diagram } = run({ strokes: [box(100, 100, 100, 92), ellipse(500, 200, 60, 56)] });
  for (const s of diagram.shapes) expect(s.w).toBe(s.h);
  expect(diagram.shapes[1]!.kind).toBe("ellipse");
});

test("shapes snap to the grid with a minimum size", () => {
  const { diagram } = run({ strokes: [box(103, 97, 187, 83)] });
  const s = diagram.shapes[0]!;
  for (const v of [s.x, s.y, s.w, s.h]) expect(v % GRID).toBe(0);
});

test("alignment shifts a second box to the first's center", () => {
  const { diagram } = run({ strokes: [box(100, 100, 200, 100), box(130, 300, 140, 80)] });
  const [a, b] = diagram.shapes;
  expect(b!.x + b!.w / 2).toBe(a!.x + a!.w / 2);
  expect(b!.w).toBe(140);
});

test("near-horizontal and near-vertical lines straighten", () => {
  const { diagram } = run({ strokes: [seg([100, 100], [400, 112]), seg([600, 100], [609, 400])] });
  const [h, v] = diagram.connectors;
  if (h!.source.kind !== "free" || h!.target.kind !== "free") throw new Error("free");
  expect(h!.source.y).toBe(h!.target.y);
  if (v!.source.kind !== "free" || v!.target.kind !== "free") throw new Error("free");
  expect(v!.source.x).toBe(v!.target.x);
});

test("deterministic", () => {
  const ink = { strokes: [box(100, 100, 200, 100), seg([302, 150], [500, 150])] };
  expect(run(ink).diagram).toEqual(run(ink).diagram);
});

test("retype changes only the kind", () => {
  const d = withShapes(existing("a", 10, 20, 30, 40));
  expect(retype(d, "a", "hexagon").shapes[0]).toEqual({ ...d.shapes[0]!, kind: "hexagon" });
  expect(retype(d, "zz", "hexagon")).toEqual(d);
});

test("scale multiplies the glue and alignment thresholds", () => {
  const d = withShapes(existing("box", 300, 100, 100, 100));
  const ink = { strokes: [seg([100, 150], [270, 150])] };
  expect(run(ink, d).diagram.connectors[0]!.target.kind).toBe("free");
  expect(run(ink, d, 2).diagram.connectors[0]!.target).toEqual({ kind: "glued", shapeId: "box" });
});

const fixtures = (dir: string) => {
  const root = new URL(`./fixtures/${dir}/`, import.meta.url);
  return readdirSync(root)
    .filter((f) => f.endsWith(".json"))
    .map((f) => Ink.parse(JSON.parse(readFileSync(new URL(f, root), "utf8"))));
};

test("convertInk on fixtures", () => {
  for (const kind of SHAPE_KINDS) {
    const hits = fixtures(kind).filter((ink) => {
      const { diagram } = run(ink);
      return (
        diagram.shapes.length === 1 &&
        diagram.shapes[0]!.kind === kind &&
        diagram.connectors.length === 0
      );
    });
    expect(hits.length, kind).toBeGreaterThanOrEqual(4);
  }
  for (const ink of fixtures("line")) {
    const { diagram } = run(ink);
    expect(diagram.shapes.length).toBe(0);
    expect(diagram.connectors.length).toBe(1);
    const c = diagram.connectors[0]!;
    expect(c.source).not.toHaveProperty("arrow");
    expect(c.target).not.toHaveProperty("arrow");
  }
  for (const ink of fixtures("arrow")) {
    const { diagram } = run(ink);
    const [c] = diagram.connectors;
    expect(diagram.connectors.length).toBe(1);
    expect(Boolean(c!.source.arrow) || Boolean(c!.target.arrow)).toBe(true);
  }
});

test("synthetic ink always yields a valid diagram", () => {
  const rng = mulberry32(8);
  for (const kind of SHAPE_KINDS) {
    expect(run({ strokes: synthesize(kind, rng) }).diagram.shapes.length).toBe(1);
  }
});
