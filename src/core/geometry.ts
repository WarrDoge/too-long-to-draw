import type { Connector, Diagram, Id, Point, Shape, ShapeKind, Text } from "./model";

export const GRID = 10;

export type Rect = { x: number; y: number; w: number; h: number };

export const snap = (v: number, grid = GRID) => Math.round(v / grid) * grid;

export function bounds(points: readonly Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const arc = (cx: number, cy: number, rx: number, ry: number, from: number, to: number, n: number) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / n;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });

/** Closed outline polygon (first point not repeated), clockwise in screen coordinates. */
export function outline(kind: ShapeKind, { x, y, w, h }: Rect): Point[] {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const P = (px: number, py: number) => ({ x: px, y: py });
  switch (kind) {
    case "rectangle":
      return [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];
    case "rounded-rectangle": {
      const r = Math.min(w, h) * 0.15;
      const q = Math.PI / 2;
      return [
        ...arc(x + w - r, y + r, r, r, -q, 0, 6),
        ...arc(x + w - r, y + h - r, r, r, 0, q, 6),
        ...arc(x + r, y + h - r, r, r, q, 2 * q, 6),
        ...arc(x + r, y + r, r, r, 2 * q, 3 * q, 6),
      ];
    }
    case "ellipse":
      return arc(cx, cy, w / 2, h / 2, -Math.PI / 2, 1.5 * Math.PI, 64).slice(0, -1);
    case "diamond":
      return [P(cx, y), P(x + w, cy), P(cx, y + h), P(x, cy)];
    case "triangle":
      return [P(cx, y), P(x + w, y + h), P(x, y + h)];
    case "parallelogram":
      return [P(x + 0.2 * w, y), P(x + w, y), P(x + 0.8 * w, y + h), P(x, y + h)];
    case "hexagon":
      return [
        P(x + 0.25 * w, y),
        P(x + 0.75 * w, y),
        P(x + w, cy),
        P(x + 0.75 * w, y + h),
        P(x + 0.25 * w, y + h),
        P(x, cy),
      ];
    case "cylinder": {
      const ry = h * 0.15;
      return [
        ...arc(cx, y + ry, w / 2, ry, Math.PI, 2 * Math.PI, 16),
        ...arc(cx, y + h - ry, w / 2, ry, 0, Math.PI, 16),
      ];
    }
    case "cloud": {
      const raw = Array.from({ length: 96 }, (_, i) => {
        const t = -Math.PI / 2 + (2 * Math.PI * i) / 96;
        const r = 0.82 + 0.18 * Math.abs(Math.sin(3 * t));
        return P(Math.cos(t) * r, Math.sin(t) * r);
      });
      const b = bounds(raw);
      return raw.map((p) => P(x + ((p.x - b.x) / b.w) * w, y + ((p.y - b.y) / b.h) * h));
    }
  }
}

export const shapeRect = ({ x, y, w, h }: Shape): Rect => ({ x, y, w, h });

export const containsRect = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

const poly = (pts: readonly Point[]) =>
  `${pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ")} Z`;

export function shapePath(s: Shape): string {
  const { x, y, w, h } = s;
  switch (s.kind) {
    case "rounded-rectangle": {
      const r = Math.min(w, h) * 0.15;
      return (
        `M${x + r} ${y} L${x + w - r} ${y} A${r} ${r} 0 0 1 ${x + w} ${y + r} ` +
        `L${x + w} ${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} ` +
        `L${x + r} ${y + h} A${r} ${r} 0 0 1 ${x} ${y + h - r} ` +
        `L${x} ${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`
      );
    }
    case "ellipse": {
      const rx = w / 2;
      const ry = h / 2;
      return `M${x} ${y + ry} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry} A${rx} ${ry} 0 0 1 ${x} ${y + ry} Z`;
    }
    case "cylinder": {
      const rx = w / 2;
      const ry = h * 0.15;
      return (
        `M${x} ${y + ry} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry} ` +
        `L${x + w} ${y + h - ry} A${rx} ${ry} 0 0 1 ${x} ${y + h - ry} Z ` +
        `M${x} ${y + ry} A${rx} ${ry} 0 0 0 ${x + w} ${y + ry}`
      );
    }
    default:
      return poly(outline(s.kind, s));
  }
}

const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function borderPoint(s: Shape, toward: Point): Point {
  const c = center(s);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return { x: c.x, y: s.y };
  const pts = outline(s.kind, s);
  let best = 0;
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length] as Point;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (den === 0) return;
    const t = ((a.x - c.x) * ey - (a.y - c.y) * ex) / den;
    const u = ((a.x - c.x) * dy - (a.y - c.y) * dx) / den;
    if (u >= 0 && u <= 1 && t > best) best = t;
  });
  return { x: c.x + dx * best, y: c.y + dy * best };
}

function segDistance(p: Point, a: Point, b: Point): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len2 = ex * ex + ey * ey;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2));
  return Math.hypot(p.x - (a.x + t * ex), p.y - (a.y + t * ey));
}

export function borderDistance(s: Shape, p: Point): number {
  const pts = outline(s.kind, s);
  return Math.min(...pts.map((a, i) => segDistance(p, a, pts[(i + 1) % pts.length] as Point)));
}

export function connectorPath(d: Diagram, c: Connector): { points: Point[]; d: string } {
  const shapeOf = (id: Id) => {
    const s = d.shapes.find((x) => x.id === id);
    if (!s) throw new Error(`unknown shape ${id}`);
    return s;
  };
  const ref = (e: Connector["source"]): Point =>
    e.kind === "free" ? { x: e.x, y: e.y } : center(shapeOf(e.shapeId));
  const at = (e: Connector["source"], toward: Point): Point =>
    e.kind === "free" ? { x: e.x, y: e.y } : borderPoint(shapeOf(e.shapeId), toward);
  const { source, target } = c;
  let pts: Point[];
  if (c.routing === "straight") {
    pts = [at(source, ref(target)), at(target, ref(source))];
  } else if (source.kind === "glued" && target.kind === "glued") {
    const a = shapeOf(source.shapeId);
    const b = shapeOf(target.shapeId);
    const ac = center(a);
    const bc = center(b);
    const dx = bc.x - ac.x;
    const dy = bc.y - ac.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const s = { x: dx >= 0 ? a.x + a.w : a.x, y: ac.y };
      const t = { x: dx >= 0 ? b.x : b.x + b.w, y: bc.y };
      const mx = (s.x + t.x) / 2;
      pts = [s, { x: mx, y: s.y }, { x: mx, y: t.y }, t];
    } else {
      const s = { x: ac.x, y: dy >= 0 ? a.y + a.h : a.y };
      const t = { x: bc.x, y: dy >= 0 ? b.y : b.y + b.h };
      const my = (s.y + t.y) / 2;
      pts = [s, { x: s.x, y: my }, { x: t.x, y: my }, t];
    }
  } else {
    const bend = { x: ref(target).x, y: ref(source).y };
    pts = [at(source, bend), bend, at(target, bend)];
  }
  pts = pts.filter(
    (p, i) => i === 0 || p.x !== (pts[i - 1] as Point).x || p.y !== (pts[i - 1] as Point).y,
  );
  return { points: pts, d: pts.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ") };
}

export function arrowHead(points: Point[], at: "source" | "target", size: number): Point[] {
  const last = points.length - 1;
  const tip = points[at === "target" ? last : 0] as Point;
  const from = points[at === "target" ? last - 1 : 1] ?? { x: tip.x - 1, y: tip.y };
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const ux = (tip.x - from.x) / len;
  const uy = (tip.y - from.y) / len;
  const bx = tip.x - ux * size;
  const by = tip.y - uy * size;
  const hw = size * 0.4;
  return [tip, { x: bx - uy * hw, y: by + ux * hw }, { x: bx + uy * hw, y: by - ux * hw }];
}

export function pathMidpoint(points: Point[]): Point {
  const lens = points
    .slice(1)
    .map((p, i) => Math.hypot(p.x - (points[i] as Point).x, p.y - (points[i] as Point).y));
  let rest = lens.reduce((a, b) => a + b, 0) / 2;
  for (const [i, l] of lens.entries()) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    if (rest <= l) {
      const t = l === 0 ? 0 : rest / l;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    rest -= l;
  }
  return points[0] ?? { x: 0, y: 0 };
}

export function textBounds(t: Text): Rect {
  const lines = t.content.split("\n");
  const fs = t.style.fontSize;
  return {
    x: t.x,
    y: t.y,
    w: Math.max(...lines.map((l) => l.length)) * fs * 0.6,
    h: lines.length * fs * 1.2,
  };
}

export function elementBounds(d: Diagram, id: Id): Rect | undefined {
  const s = d.shapes.find((x) => x.id === id);
  if (s) return shapeRect(s);
  const t = d.texts.find((x) => x.id === id);
  if (t) return textBounds(t);
  const c = d.connectors.find((x) => x.id === id);
  return c && bounds(connectorPath(d, c).points);
}

export function diagramBounds(d: Diagram): Rect {
  const rs = [...d.shapes, ...d.connectors, ...d.texts]
    .map((e) => elementBounds(d, e.id))
    .filter((r): r is Rect => r !== undefined);
  if (!rs.length) return { x: 0, y: 0, w: 0, h: 0 };
  return bounds(rs.flatMap((r) => [r, { x: r.x + r.w, y: r.y + r.h }]));
}
