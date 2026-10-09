import { clusterInk, dist, pathLength, polygonArea, type ShapeCluster, segDist } from "./cluster";
import { cloudDistanceTo, templateStrokes } from "./dollarp";
import { type Point, SHAPE_KINDS, type ShapeKind } from "./model";
import { TUNING } from "./tuning";

const R = TUNING.recognize;
const RAD = Math.PI / 180;

function resampleClosed(pts: readonly Point[], n: number): Point[] {
  const loop = [...pts, pts[0]!];
  const total = pathLength(loop);
  if (total === 0) return Array.from({ length: n }, () => pts[0]!);
  const step = total / n;
  const out: Point[] = [];
  let seg = 1;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (seg < loop.length - 1 && acc + dist(loop[seg - 1]!, loop[seg]!) < target) {
      acc += dist(loop[seg - 1]!, loop[seg]!);
      seg++;
    }
    const a = loop[seg - 1]!;
    const b = loop[seg]!;
    const d = dist(a, b);
    const t = d ? Math.min(1, (target - acc) / d) : 0;
    out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
  }
  return out;
}

function hull(pts: readonly Point[]): Point[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: Point[]) => {
    const h: Point[] = [];
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2]!, h[h.length - 1]!, q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half(p.reverse())];
}

/** Local maxima of `t` at or above `thr`, suppressing neighbours within `r` samples. */
function peaks(t: number[], thr: number, r: number): number[] {
  const n = t.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let top = t[i]! >= thr;
    for (let d = 1; top && d <= r; d++) {
      top = t[i]! > t[(i - d + n) % n]! && t[i]! >= t[(i + d) % n]!;
    }
    if (top) out.push(i);
  }
  return out;
}

export const FEATURES = [
  "circularity",
  "fill",
  "solidity",
  "gap0",
  "gap1",
  "gap2",
  "gap3",
  "corners",
  "cornerShare",
  "axisH",
  "axisV",
  "peak1",
  "peak2",
  "peak3",
  "cusps",
] as const;

/** Undo hand tilt: the rotation within ±deskew degrees that minimises the bounding-box area. */
function deskew(P: Point[]): Point[] {
  const hl = hull(P);
  const cx = P.reduce((a, p) => a + p.x, 0) / P.length;
  const cy = P.reduce((a, p) => a + p.y, 0) / P.length;
  const rot = (p: Point, th: number) => ({
    x: cx + (p.x - cx) * Math.cos(th) - (p.y - cy) * Math.sin(th),
    y: cy + (p.x - cx) * Math.sin(th) + (p.y - cy) * Math.cos(th),
  });
  const area = (th: number) => {
    const r = hl.map((p) => rot(p, th));
    const xs = r.map((p) => p.x);
    const ys = r.map((p) => p.y);
    return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  };
  let best = 0;
  let bestArea = area(0);
  for (let d = 1; d <= R.deskew; d++) {
    for (const th of [d * RAD, -d * RAD]) {
      const a = area(th);
      if (a < bestArea * (1 - R.deskewGain)) {
        best = th;
        bestArea = a;
      }
    }
  }
  return best === 0 ? P : P.map((p) => rot(p, best));
}

export function features(points: readonly Point[], scale = 1): number[] {
  const n = R.samples;
  const k = R.window;
  const P = deskew(resampleClosed(points, n));
  const xs = P.map((p) => p.x);
  const ys = P.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(Math.max(...xs) - minX, 1e-6);
  const h = Math.max(Math.max(...ys) - minY, 1e-6);

  const hl = hull(P);
  const hullArea = Math.abs(polygonArea(hl)) || 1e-6;
  const hullPerim = pathLength([...hl, hl[0]!]) || 1e-6;
  const area = polygonArea(P);

  const U = P.map((p) => ({ x: (p.x - minX) / w, y: (p.y - minY) / h }));
  const tol = (R.gapTolPx * scale) / Math.hypot(w, h);
  const gaps = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ]
    .map((c) => {
      let m = Infinity;
      for (let i = 0; i < n; i++) m = Math.min(m, segDist(c, U[i]!, U[(i + 1) % n]!));
      return Math.max(0, m / Math.SQRT2 - tol);
    })
    .sort((a, b) => a - b);

  let Q = P;
  for (let pass = 0; pass < R.smooth; pass++) {
    const src = Q;
    Q = src.map((p, i) => {
      const a = src[(i - 1 + n) % n]!;
      const b = src[(i + 1) % n]!;
      return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
    });
  }
  const sign = area < 0 ? -1 : 1;
  const turn = Q.map((p, i) => {
    const a = Q[(i - k + n) % n]!;
    const b = Q[(i + k) % n]!;
    const [ux, uy, vx, vy] = [p.x - a.x, p.y - a.y, b.x - p.x, b.y - p.y];
    return sign * Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  });
  const corners = peaks(turn, R.cornerTurn * RAD, R.nms);
  const cusps = peaks(
    turn.map((t) => -t),
    R.cuspTurn * RAD,
    R.nms,
  );

  const aw = R.axisWindow * RAD;
  let axisH = 0;
  const hist = new Array<number>(36).fill(0);
  let axisV = 0;
  for (let i = 0; i < n; i++) {
    const a = Q[(i - k + n) % n]!;
    const b = Q[(i + k) % n]!;
    const ang = ((Math.atan2(b.y - a.y, b.x - a.x) % Math.PI) + Math.PI) % Math.PI;
    if (ang < aw || ang > Math.PI - aw) axisH++;
    else if (Math.abs(ang - Math.PI / 2) < aw) axisV++;
    hist[Math.min(35, Math.floor((ang / Math.PI) * 36))]!++;
  }
  const pw = Math.round((R.peakWindow * 36) / 180);
  const shares: number[] = [];
  for (let r = 0; r < 3; r++) {
    let best = 0;
    let bc = 0;
    for (let c = 0; c < 36; c++) {
      let s = 0;
      for (let d = -pw; d <= pw; d++) s += hist[(c + d + 36) % 36]!;
      if (s > best) {
        best = s;
        bc = c;
      }
    }
    shares.push(best / n);
    for (let d = -pw; d <= pw; d++) hist[(bc + d + 36) % 36] = 0;
  }

  return [
    (4 * Math.PI * hullArea) / hullPerim ** 2,
    hullArea / (w * h),
    Math.min(1, Math.abs(area) / hullArea),
    ...gaps,
    corners.length,
    corners.reduce((a, i) => a + turn[i]!, 0) / (2 * Math.PI),
    axisH / n,
    axisV / n,
    ...shares,
    cusps.length,
  ];
}

type Proto = { mean: number[]; std: number[] };
let protos: Record<ShapeKind, Proto> | undefined;

function getProtos() {
  protos ??= Object.fromEntries(
    SHAPE_KINDS.map((kind) => {
      const rows = templateStrokes()[kind].flatMap((strokes) => {
        const c = clusterInk({ strokes }).shapes;
        return c.length === 1 ? [features(c[0]!.points)] : [];
      });
      const mean = FEATURES.map((_, i) => rows.reduce((a, r) => a + r[i]!, 0) / rows.length);
      const std = FEATURES.map((_, i) =>
        Math.sqrt(rows.reduce((a, r) => a + (r[i]! - mean[i]!) ** 2, 0) / rows.length),
      );
      return [kind, { mean, std }];
    }),
  ) as Record<ShapeKind, Proto>;
  return protos;
}

const similarity = (f: number[], p: Proto) => {
  let sum = 0;
  let wsum = 0;
  f.forEach((v, i) => {
    const s = Math.hypot(R.sigma[i]!, p.std[i]!);
    sum += R.weight[i]! * ((v - p.mean[i]!) / s) ** 2;
    wsum += R.weight[i]!;
  });
  return Math.exp((-R.sharp * sum) / wsum);
};

export function recognize(
  cluster: Pick<ShapeCluster, "strokes" | "points" | "compound">,
  scale = 1,
): { kind: ShapeKind; score: number }[] {
  const f = features(cluster.points, scale);
  const p = getProtos();
  const cusps = f[FEATURES.indexOf("cusps")]!;
  const ranked = SHAPE_KINDS.map((kind) => {
    let score = similarity(f, p[kind]);
    if (kind === "cylinder") score = cluster.compound ? 1 : R.cylinderBase * R.vetoPenalty;
    else if (cluster.compound) score *= R.vetoPenalty;
    if (
      kind !== "cylinder" &&
      (kind === "cloud" ? cusps < R.cloudMinCusps : cusps >= R.otherMaxCusps)
    )
      score *= R.vetoPenalty;
    return { kind, score };
  }).sort((a, b) => b.score - a.score);

  const floor = ranked[0]!.score * (1 - R.tieRatio);
  const tied = ranked.filter((r) => r.score >= floor);
  if (tied.length > 1) {
    const d = new Map(tied.map((r) => [r.kind, cloudDistanceTo(cluster.strokes, r.kind)]));
    const scores = tied.map((r) => r.score);
    tied.sort((a, b) => d.get(a.kind)! - d.get(b.kind)!);
    tied.forEach((r, i) => {
      r.score = scores[i]!;
    });
    ranked.splice(0, tied.length, ...tied);
  }
  return ranked;
}
