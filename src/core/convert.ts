import { clusterInk } from "./cluster";
import { borderDistance, bounds, GRID, type Rect, shapeRect, snap } from "./geometry";
import {
  DEFAULT_STYLE,
  type Diagram,
  type End,
  type Id,
  type Ink,
  type Point,
  type Shape,
  type ShapeKind,
} from "./model";
import { addConnector, addShape, reparent } from "./ops";
import { recognize } from "./recognize";
import { TUNING } from "./tuning";

const V = TUNING.convert;

const edges = (r: Rect) => ({
  x: [r.x, r.x + r.w / 2, r.x + r.w],
  y: [r.y, r.y + r.h / 2, r.y + r.h],
});

/** Shift that moves one of `mine` onto the closest of `others`, or 0 when none is within `tol`. */
function alignShift(mine: number[], others: number[], tol: number): number {
  let best = 0;
  let bd = tol;
  for (const a of mine) {
    for (const b of others) {
      if (Math.abs(b - a) <= bd) {
        bd = Math.abs(b - a);
        best = b - a;
      }
    }
  }
  return best;
}

function fit(raw: Rect, others: Shape[], scale: number): Rect {
  let { w, h } = raw;
  let { x, y } = raw;
  if (Math.abs(w - h) / Math.max(w, h, 1e-6) < V.squareRatio) {
    const side = (w + h) / 2;
    x += (w - side) / 2;
    y += (h - side) / 2;
    w = side;
    h = side;
  }
  w = Math.max(GRID, snap(w));
  h = Math.max(GRID, snap(h));
  x = snap(x);
  y = snap(y);
  const mine = edges({ x, y, w, h });
  const tol = V.alignDist * scale;
  const dx = alignShift(
    mine.x,
    others.flatMap((s) => edges(shapeRect(s)).x),
    tol,
  );
  const dy = alignShift(
    mine.y,
    others.flatMap((s) => edges(shapeRect(s)).y),
    tol,
  );
  return { x: x + dx, y: y + dy, w, h };
}

function straighten(a: Point, b: Point): [Point, Point] {
  const deg = (Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x)) * 180) / Math.PI;
  if (deg <= V.straightenDeg) {
    const y = (a.y + b.y) / 2;
    return [
      { x: a.x, y },
      { x: b.x, y },
    ];
  }
  if (deg >= 90 - V.straightenDeg) {
    const x = (a.x + b.x) / 2;
    return [
      { x, y: a.y },
      { x, y: b.y },
    ];
  }
  return [a, b];
}

function end(d: Diagram, raw: Point, free: Point, arrow: boolean, tol: number): End {
  let best: Shape | undefined;
  let bd = tol;
  for (const s of d.shapes) {
    const dist = borderDistance(s, raw);
    if (dist <= bd) {
      bd = dist;
      best = s;
    }
  }
  const flag = arrow ? { arrow: true } : {};
  return best
    ? { kind: "glued", shapeId: best.id, ...flag }
    : { kind: "free", x: snap(free.x), y: snap(free.y), ...flag };
}

export function convertInk(
  diagram: Diagram,
  ink: Ink,
  opts: { newId: () => Id; scale?: number },
): { diagram: Diagram; last?: { shapeId: Id; ranked: ShapeKind[] } } {
  const scale = opts.scale ?? 1;
  const { shapes, lines } = clusterInk(ink, scale);
  let d = diagram;
  const added: Id[] = [];
  let last: { at: number; shapeId: Id; ranked: ShapeKind[] } | undefined;
  for (const cluster of shapes) {
    const ranked = recognize(cluster, scale).map((r) => r.kind);
    const rect = fit(bounds(cluster.points), d.shapes, scale);
    const id = opts.newId();
    d = addShape(d, {
      id,
      kind: ranked[0]!,
      ...rect,
      label: "",
      style: { ...DEFAULT_STYLE },
    });
    added.push(id);
    if (!last || cluster.last > last.at) last = { at: cluster.last, shapeId: id, ranked };
  }
  d = reparent(d, added);

  const tol = V.glueDist * scale;
  for (const line of lines) {
    const rawA = line.points[0]!;
    const rawB = line.points[line.points.length - 1]!;
    const [fa, fb] = straighten(rawA, rawB);
    const source = end(d, rawA, fa, line.arrowStart, tol);
    const target = end(d, rawB, fb, line.arrowEnd, tol);
    const sameShape =
      source.kind === "glued" && target.kind === "glued" && source.shapeId === target.shapeId;
    const zero =
      source.kind === "free" &&
      target.kind === "free" &&
      source.x === target.x &&
      source.y === target.y;
    if (sameShape || zero) continue;
    d = addConnector(d, {
      id: opts.newId(),
      source,
      target,
      routing: "straight",
      style: { ...DEFAULT_STYLE },
    });
  }
  return { diagram: d, ...(last && { last: { shapeId: last.shapeId, ranked: last.ranked } }) };
}

export function retype(diagram: Diagram, shapeId: Id, kind: ShapeKind): Diagram {
  return {
    ...diagram,
    shapes: diagram.shapes.map((s) => (s.id === shapeId ? { ...s, kind } : s)),
  };
}
