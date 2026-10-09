import { dist, pathLength } from "./cluster";
import { outline } from "./geometry";
import { type Point, SHAPE_KINDS, type ShapeKind, type Stroke } from "./model";
import { TUNING } from "./tuning";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const S = TUNING.synth;
const gauss = (rng: Rng) => (rng() + rng() + rng() - 1.5) * 2;
const between = (rng: Rng, [lo, hi]: readonly [number, number] | readonly number[]) =>
  lo! + (hi! - lo!) * rng();

export type SynthOpts = {
  noise?: number;
  rotate?: number;
  size?: readonly [number, number];
  aspect?: readonly [number, number];
};

function densify(poly: readonly Point[], step: number, closed = true): Point[] {
  const out: Point[] = [];
  poly.forEach((p, i) => {
    const q = closed ? poly[(i + 1) % poly.length]! : poly[i + 1];
    if (!q) {
      out.push(p);
      return;
    }
    const n = Math.max(1, Math.ceil(dist(p, q) / step));
    for (let k = 0; k < n; k++) {
      out.push({ x: p.x + ((q.x - p.x) * k) / n, y: p.y + ((q.y - p.y) * k) / n });
    }
  });
  return out;
}

const ellipse = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  n: number,
) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = a0 + ((a1 - a0) * i) / n;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });

function loopStrokes(loop: Point[], rng: Rng): Point[][] {
  const m = loop.length;
  const start = Math.floor(rng() * m);
  const dir = rng() < 0.5 ? 1 : -1;
  const at = (k: number) => loop[(((start + dir * k) % m) + m) % m]!;
  const take = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => at(a + i));
  let r = rng() * S.splitWeights.reduce((a, b) => a + b, 0);
  let k = 1;
  for (const w of S.splitWeights) {
    r -= w;
    if (r <= 0 || k === S.splitWeights.length) break;
    k++;
  }
  if (k === 1) return [take(0, m + Math.floor(rng() * 7) - 2)];
  const cuts = Array.from({ length: k }, (_, i) =>
    Math.round(((i + (rng() - 0.5) * 0.5) * m) / k),
  ).sort((a, b) => a - b);
  const pieces = cuts.map((c, i) => take(c, i + 1 < k ? cuts[i + 1]! : cuts[0]! + m));
  const order = pieces.sort(() => rng() - 0.5);
  return order.map((p) => (rng() < 0.5 ? p.reverse() : p));
}

function cylinderStrokes(w: number, h: number, rng: Rng): Point[][] {
  const ry = h * 0.15;
  const a0 = rng() * 2 * Math.PI;
  const sgn = rng() < 0.5 ? 1 : -1;
  const top = ellipse(w / 2, ry, w / 2, ry, a0, a0 + sgn * (2 * Math.PI + rng() * 0.3), 48);
  const body = densify(
    [{ x: 0, y: ry }, ...ellipse(w / 2, h - ry, w / 2, ry, Math.PI, 0, 24), { x: w, y: ry }],
    h / 16,
    false,
  );
  const strokes = [top, body];
  if (rng() < 0.5) strokes.reverse();
  return strokes.map((s) => (rng() < 0.5 ? s.reverse() : s));
}

/** Hand-drawn style strokes for `kind`; cylinder is a closed top ellipse plus a U-shaped body. */
export function synthesize(kind: ShapeKind, rng: Rng, opts: SynthOpts = {}): Stroke[] {
  const { noise = S.noise, rotate = S.rotate, size = S.size } = opts;
  const aspect = opts.aspect ?? (kind === "cylinder" ? S.cylinderAspect : S.aspect);
  const s = between(rng, size);
  const a = Math.exp(between(rng, [Math.log(aspect[0]), Math.log(aspect[1])]));
  const w = s * Math.sqrt(a);
  const h = s / Math.sqrt(a);
  const raw =
    kind === "cylinder"
      ? cylinderStrokes(w, h, rng)
      : loopStrokes(densify(outline(kind, { x: 0, y: 0, w, h }), (2 * (w + h)) / S.points), rng);
  const th = (rng() * 2 - 1) * rotate;
  const [cos, sin] = [Math.cos(th), Math.sin(th)];
  const ox = 100 + rng() * 400;
  const oy = 100 + rng() * 300;
  const jit = noise * Math.sqrt(w * h);
  return raw.map((st) =>
    st.map((p) => {
      const x = p.x - w / 2;
      const y = p.y - h / 2;
      return {
        x: ox + x * cos - y * sin + gauss(rng) * jit,
        y: oy + x * sin + y * cos + gauss(rng) * jit,
      };
    }),
  );
}

type Cloud = { x: number; y: number; id: number }[];
const P = TUNING.pcloud;

/** $P preprocessing: resample across strokes, scale uniformly, translate centroid to origin. */
export function toCloud(strokes: readonly Stroke[], n: number = P.n): Cloud {
  const pts: Cloud = strokes.flatMap((s, id) => s.map((p) => ({ x: p.x, y: p.y, id })));
  if (pts.length === 0) return [];
  const total = strokes.reduce((a, s) => a + pathLength(s), 0);
  const step = total / (n - 1) || 1;
  const out: Cloud = [pts[0]!];
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (a.id !== b.id) continue;
    const seg = dist(a, b);
    if (d + seg >= step && seg > 0) {
      const t = (step - d) / seg;
      const q = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), id: b.id };
      out.push(q);
      pts.splice(i, 0, q);
      d = 0;
    } else d += seg;
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1]! });
  out.length = n;
  const xs = out.map((p) => p.x);
  const ys = out.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const sc = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  const norm = out.map((p) => ({ x: (p.x - minX) / sc, y: (p.y - minY) / sc, id: p.id }));
  const cx = norm.reduce((a, p) => a + p.x, 0) / n;
  const cy = norm.reduce((a, p) => a + p.y, 0) / n;
  return norm.map((p) => ({ x: p.x - cx, y: p.y - cy, id: p.id }));
}

function cloudDistance(a: Cloud, b: Cloud, start: number): number {
  const n = a.length;
  const matched = new Uint8Array(n);
  let sum = 0;
  let i = start;
  do {
    let min = Infinity;
    let idx = -1;
    for (let j = 0; j < n; j++) {
      if (matched[j]) continue;
      const d = Math.hypot(a[i]!.x - b[j]!.x, a[i]!.y - b[j]!.y);
      if (d < min) {
        min = d;
        idx = j;
      }
    }
    matched[idx] = 1;
    sum += (1 - ((i - start + n) % n) / n) * min;
    i = (i + 1) % n;
  } while (i !== start);
  return sum;
}

export function cloudMatch(a: Cloud, b: Cloud): number {
  const n = a.length;
  const step = Math.max(1, Math.floor(n ** (1 - P.epsilon)));
  let min = Infinity;
  for (let i = 0; i < n; i += step) {
    min = Math.min(min, cloudDistance(a, b, i), cloudDistance(b, a, i));
  }
  return min;
}

let strokeCache: Record<ShapeKind, Stroke[][]> | undefined;
let cloudCache: Record<ShapeKind, Cloud[]> | undefined;

export function templateStrokes(): Record<ShapeKind, Stroke[][]> {
  strokeCache ??= Object.fromEntries(
    SHAPE_KINDS.map((kind, k) => {
      const rng = mulberry32(P.seed + k);
      return [kind, Array.from({ length: P.templates }, () => synthesize(kind, rng))];
    }),
  ) as Record<ShapeKind, Stroke[][]>;
  return strokeCache;
}

export function templateClouds(): Record<ShapeKind, Cloud[]> {
  cloudCache ??= Object.fromEntries(
    SHAPE_KINDS.map((k) => [k, templateStrokes()[k].map((s) => toCloud(s))]),
  ) as Record<ShapeKind, Cloud[]>;
  return cloudCache;
}

/** Smallest $P distance from the strokes to any template of `kind`. */
export function cloudDistanceTo(strokes: readonly Stroke[], kind: ShapeKind): number {
  const c = toCloud(strokes);
  return Math.min(...templateClouds()[kind].map((t) => cloudMatch(c, t)));
}
