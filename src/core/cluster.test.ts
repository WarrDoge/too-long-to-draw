import { expect, test } from "bun:test";
import { clusterInk } from "./cluster";
import type { Point, Stroke } from "./model";

const path = (...v: [number, number][]): Stroke => {
  const out: Point[] = [];
  v.forEach(([x, y], i) => {
    const [px, py] = v[i - 1] ?? [x, y];
    const n = i === 0 ? 1 : Math.max(2, Math.round(Math.hypot(x - px, y - py) / 8));
    for (let k = 1; k <= n; k++) {
      out.push({ x: px + ((x - px) * k) / n, y: py + ((y - py) * k) / n });
    }
  });
  return out;
};

const sides = {
  top: path([100, 100], [260, 100]),
  right: path([261, 101], [261, 200]),
  bottom: path([259, 201], [100, 201]),
  left: path([99, 199], [99, 99]),
};

test("a box drawn in 2, 3 or 4 strokes is one closed cluster", () => {
  const { top, right, bottom, left } = sides;
  const two = [
    [...top, ...right],
    [...bottom, ...left],
  ];
  const three = [top, [...right, ...bottom], left];
  const four = [top, bottom.toReversed(), left.toReversed(), right];
  for (const strokes of [two, three, four]) {
    const { shapes, lines } = clusterInk({ strokes });
    expect(shapes.length).toBe(1);
    expect(lines.length).toBe(0);
    expect(shapes[0]!.strokes.length).toBe(strokes.length);
    expect(shapes[0]!.compound).toBe(false);
    expect(shapes[0]!.last).toBe(strokes.length - 1);
  }
});

test("nested boxes stay two clusters", () => {
  const outer = path([100, 100], [300, 100], [300, 250], [100, 250], [100, 104]);
  const inner = [
    path([140, 140], [260, 140], [260, 210]),
    path([260, 210], [140, 210], [140, 140]),
  ];
  const { shapes } = clusterInk({ strokes: [outer, ...inner] });
  expect(shapes.map((s) => s.strokes.length)).toEqual([1, 2]);
});

test("a line ending on a box stays a separate line", () => {
  const { top, right, bottom, left } = sides;
  const line = path([261, 150], [420, 150]);
  const { shapes, lines } = clusterInk({
    strokes: [[...top, ...right], [...bottom, ...left], line],
  });
  expect(shapes.length).toBe(1);
  expect(lines.length).toBe(1);
  expect(lines[0]!.arrowStart || lines[0]!.arrowEnd).toBe(false);
  expect(lines[0]!.last).toBe(2);
});

test("a cylinder body joins its top ellipse as compound", () => {
  const top: Stroke = Array.from({ length: 41 }, (_, i) => ({
    x: 200 + 80 * Math.cos((i / 40) * 2 * Math.PI),
    y: 120 + 20 * Math.sin((i / 40) * 2 * Math.PI),
  }));
  const bottom = Array.from({ length: 13 }, (_, i) => ({
    x: 200 - 80 * Math.cos((i / 12) * Math.PI),
    y: 260 + 20 * Math.sin((i / 12) * Math.PI),
  }));
  const body = [...path([120, 120], [120, 260]), ...bottom, ...path([280, 260], [280, 121])];
  for (const strokes of [
    [top, body],
    [body, top],
  ]) {
    const { shapes, lines } = clusterInk({ strokes });
    expect(lines.length).toBe(0);
    expect(shapes.length).toBe(1);
    expect(shapes[0]!.compound).toBe(true);
    expect(shapes[0]!.strokes.length).toBe(2);
  }
});

const shaft = path([100, 300], [300, 300]);
const vHead = (tip: [number, number], dx: number) =>
  path([tip[0] + dx, tip[1] - 11], tip, [tip[0] + dx, tip[1] + 11]);

test("a separate V head sets the arrow flag at its end", () => {
  const end = clusterInk({ strokes: [shaft, vHead([302, 301], -16)] });
  expect(end.shapes.length).toBe(0);
  expect(end.lines.length).toBe(1);
  expect(end.lines[0]).toMatchObject({ arrowStart: false, arrowEnd: true, last: 1 });
  const start = clusterInk({ strokes: [vHead([98, 299], 16), shaft] });
  expect(start.lines[0]).toMatchObject({ arrowStart: true, arrowEnd: false });
});

test("a same-stroke V tail is stripped and flagged", () => {
  const tail = path([100, 300], [300, 300], [285, 289], [300, 300], [285, 311]);
  const { lines } = clusterInk({ strokes: [tail] });
  expect(lines.length).toBe(1);
  expect(lines[0]).toMatchObject({ arrowStart: false, arrowEnd: true });
  const last = lines[0]!.points.at(-1)!;
  expect(Math.hypot(last.x - 300, last.y - 300)).toBeLessThan(3);
});

test("arrowheads at both ends, separate or same-stroke", () => {
  const tail = path([100, 300], [300, 300], [285, 289], [300, 300], [285, 311]);
  const mixed = clusterInk({ strokes: [tail, vHead([98, 301], 16)] });
  expect(mixed.lines.length).toBe(1);
  expect(mixed.lines[0]).toMatchObject({ arrowStart: true, arrowEnd: true });
  const sep = clusterInk({ strokes: [vHead([98, 301], 16), shaft, vHead([302, 299], -16)] });
  expect(sep.lines.length).toBe(1);
  expect(sep.lines[0]).toMatchObject({ arrowStart: true, arrowEnd: true, last: 2 });
});

test("a V that is not symmetric about the line is not an arrowhead", () => {
  const across = path([300, 280], [302, 300], [300, 320]);
  const { lines } = clusterInk({ strokes: [shaft, across] });
  expect(lines.length).toBe(2);
});

test("a lone small V is a line", () => {
  const { shapes, lines } = clusterInk({ strokes: [vHead([300, 300], -16)] });
  expect(shapes.length).toBe(0);
  expect(lines.length).toBe(1);
  expect(lines[0]).toMatchObject({ arrowStart: false, arrowEnd: false });
});

test("a small closed triangle stays a shape", () => {
  const one = path([100, 100], [140, 100], [120, 66], [100, 100]);
  const three = [
    path([100, 100], [140, 100]),
    path([140, 100], [120, 66]),
    path([120, 66], [100, 100]),
  ];
  for (const strokes of [[one], three]) {
    const { shapes, lines } = clusterInk({ strokes });
    expect(shapes.length).toBe(1);
    expect(lines.length).toBe(0);
  }
});

test("a closing overshoot is trimmed", () => {
  const loop = path([100, 100], [300, 100], [300, 250], [100, 250], [100, 90], [140, 90]);
  const { shapes } = clusterInk({ strokes: [loop] });
  expect(shapes.length).toBe(1);
  expect(shapes[0]!.points.length).toBeLessThan(loop.length);
});

test("distance thresholds scale with `scale`", () => {
  const a = path([0, 0], [200, 0]);
  const b = path([240, 0], [440, 0]);
  expect(clusterInk({ strokes: [a, b] }).lines.length).toBe(2);
  const zoomedOut = clusterInk({ strokes: [a, b] }, 2);
  expect(zoomedOut.lines.length).toBe(1);
  expect(zoomedOut.lines[0]!.points.length).toBe(a.length + b.length);
});
