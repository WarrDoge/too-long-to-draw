import type { Point, ShapeKind } from "./model";

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
