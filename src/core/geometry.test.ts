import { expect, test } from "bun:test";
import {
  arrowHead,
  borderDistance,
  borderPoint,
  connectorPath,
  diagramBounds,
  elementBounds,
  pathMidpoint,
  shapePath,
  textBounds,
} from "./geometry";
import { type Connector, DEFAULT_STYLE, type Diagram, SHAPE_KINDS, type Shape } from "./model";

const shape = (id: string, x: number, y: number, kind: Shape["kind"] = "rectangle"): Shape => ({
  id,
  kind,
  x,
  y,
  w: 100,
  h: 60,
  label: "",
  style: DEFAULT_STYLE,
});
const conn = (c: Partial<Connector>): Connector => ({
  id: "c",
  source: { kind: "free", x: 0, y: 0 },
  target: { kind: "free", x: 10, y: 0 },
  routing: "straight",
  style: DEFAULT_STYLE,
  ...c,
});
const dia = (shapes: Shape[], connectors: Connector[] = []): Diagram => ({
  version: 1,
  shapes,
  connectors,
  texts: [],
});

test("shapePath is non-empty for every kind", () => {
  for (const k of SHAPE_KINDS) expect(shapePath(shape("a", 0, 0, k)).startsWith("M")).toBe(true);
  expect(shapePath(shape("a", 0, 0, "cylinder")).match(/M/g)?.length).toBe(2);
});

test("borderPoint on rectangle and ellipse", () => {
  const r = shape("a", 0, 0);
  expect(borderPoint(r, { x: 500, y: 30 })).toEqual({ x: 100, y: 30 });
  expect(borderPoint(r, { x: 50, y: -99 })).toEqual({ x: 50, y: 0 });
  expect(borderPoint(r, { x: 50, y: 30 })).toEqual({ x: 50, y: 0 });
  const e = borderPoint(shape("e", 0, 0, "ellipse"), { x: 500, y: 30 });
  expect(e.x).toBeCloseTo(100);
  expect(e.y).toBeCloseTo(30);
});

test("borderDistance", () => {
  const r = shape("a", 0, 0);
  expect(borderDistance(r, { x: 110, y: 30 })).toBeCloseTo(10);
  expect(borderDistance(r, { x: 50, y: 25 })).toBeCloseTo(25);
});

test("straight connector between glued shapes", () => {
  const d = dia([shape("a", 0, 0), shape("b", 300, 0)]);
  const c = conn({
    source: { kind: "glued", shapeId: "a" },
    target: { kind: "glued", shapeId: "b" },
  });
  const p = connectorPath(d, c);
  expect(p.points).toEqual([
    { x: 100, y: 30 },
    { x: 300, y: 30 },
  ]);
  expect(p.d).toBe("M 100 30 L 300 30");
});

test("orthogonal Z (horizontal and vertical first) and L", () => {
  const glued = (s: string, t: string) =>
    conn({
      routing: "orthogonal",
      source: { kind: "glued", shapeId: s },
      target: { kind: "glued", shapeId: t },
    });
  const h = connectorPath(dia([shape("a", 0, 0), shape("b", 300, 100)]), glued("a", "b"));
  expect(h.points).toEqual([
    { x: 100, y: 30 },
    { x: 200, y: 30 },
    { x: 200, y: 130 },
    { x: 300, y: 130 },
  ]);
  const v = connectorPath(dia([shape("a", 0, 0), shape("b", 20, 300)]), glued("a", "b"));
  expect(v.points).toEqual([
    { x: 50, y: 60 },
    { x: 50, y: 180 },
    { x: 70, y: 180 },
    { x: 70, y: 300 },
  ]);
  const l = connectorPath(
    dia([shape("a", 0, 0)]),
    conn({
      routing: "orthogonal",
      source: { kind: "glued", shapeId: "a" },
      target: { kind: "free", x: 300, y: 200 },
    }),
  );
  expect(l.points).toEqual([
    { x: 100, y: 30 },
    { x: 300, y: 30 },
    { x: 300, y: 200 },
  ]);
  const flat = connectorPath(
    dia([]),
    conn({ routing: "orthogonal", target: { kind: "free", x: 50, y: 0 } }),
  );
  expect(flat.points.length).toBe(2);
});

test("arrowHead tip, pathMidpoint, bounds", () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  const t = arrowHead(pts, "target", 10);
  expect(t[0]).toEqual({ x: 100, y: 0 });
  expect(t[1]?.x).toBe(90);
  expect(arrowHead(pts, "source", 10)[0]).toEqual({ x: 0, y: 0 });
  expect(arrowHead(pts, "source", 10)[1]?.x).toBe(10);
  expect(pathMidpoint([...pts, { x: 100, y: 100 }])).toEqual({ x: 100, y: 0 });

  const text = { id: "t", x: 5, y: 5, content: "ab\nabcd", style: DEFAULT_STYLE };
  expect(textBounds(text)).toEqual({ x: 5, y: 5, w: 4 * 12 * 0.6, h: 2 * 12 * 1.2 });
  const d = { ...dia([shape("a", 0, 0)]), texts: [text] };
  expect(elementBounds(d, "a")).toEqual({ x: 0, y: 0, w: 100, h: 60 });
  expect(elementBounds(d, "zz")).toBeUndefined();
  expect(diagramBounds(d)).toEqual({ x: 0, y: 0, w: 100, h: 60 });
  expect(diagramBounds(dia([]))).toEqual({ x: 0, y: 0, w: 0, h: 0 });
});
