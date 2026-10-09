import { bounds } from "./geometry";
import type { Ink, Point, Stroke } from "./model";
import { TUNING } from "./tuning";

export type ShapeCluster = {
  strokes: Stroke[];
  points: Point[];
  compound: boolean;
  last: number;
};
export type LineCluster = {
  points: Point[];
  arrowStart: boolean;
  arrowEnd: boolean;
  last: number;
};

const C = TUNING.cluster;
const RAD = Math.PI / 180;

export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function pathLength(pts: readonly Point[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1]!, pts[i]!);
  return l;
}

/** Signed shoelace area of the implicitly closed polygon. */
export function polygonArea(pts: readonly Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function segDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from p to the closed polyline. */
export function loopDist(p: Point, loop: readonly Point[]): number {
  let m = Infinity;
  for (let i = 0; i < loop.length; i++) {
    m = Math.min(m, segDist(p, loop[i]!, loop[(i + 1) % loop.length]!));
  }
  return m;
}

export function rdpIndices(pts: readonly Point[], eps: number): number[] {
  const n = pts.length;
  if (n < 3) return pts.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let md = 0;
    let mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i]!, pts[a]!, pts[b]!);
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (mi >= 0 && md > eps) {
      keep[mi] = 1;
      stack.push([a, mi], [mi, b]);
    }
  }
  return [...keep.keys()].filter((i) => keep[i]);
}

function intersect(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (den === 0) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

const hasArea = (p: Point[]) =>
  p.length >= 3 && Math.abs(polygonArea(p)) / pathLength(p) ** 2 >= C.closedMinArea;

/** The closed outline of a chain (overshoot trimmed), or null when the chain is open. */
function closure(pts: Point[], scale: number): Point[] | null {
  const n = pts.length;
  const len = pathLength(pts);
  if (n < 3 || len < C.closedMinLen * scale) return null;
  const arc = [0];
  for (let i = 1; i < n; i++) arc.push(arc[i - 1]! + dist(pts[i - 1]!, pts[i]!));
  const slack = (1 - C.loopFrac) * len;
  for (let j = 0; j < n - 1 && arc[j]! <= slack; j++) {
    for (let i = n - 2; i > j + 1 && arc[j]! + len - arc[i]! <= slack; i--) {
      const x = intersect(pts[j]!, pts[j + 1]!, pts[i]!, pts[i + 1]!);
      if (!x) continue;
      const loop = [x, ...pts.slice(j + 1, i + 1)];
      if (hasArea(loop)) return loop;
    }
  }
  let best = -1;
  let bd = C.closeGapFrac * len;
  for (let i = 0; i < n; i++) {
    const d = dist(pts[i]!, pts[0]!);
    if (arc[i]! >= 0.6 * len && d < bd) {
      bd = d;
      best = i;
    }
  }
  const loop = best >= 0 ? pts.slice(0, best + 1) : [];
  return hasArea(loop) ? loop : null;
}

type Head = { tip: Point; a: Point; b: Point };

function arrowHead(s: Stroke, scale: number): Head | null {
  const len = pathLength(s);
  if (len < C.arrowMinLen * scale || len > C.arrowMaxLen * scale) return null;
  const idx = rdpIndices(s, C.arrowRdpFrac * len);
  if (idx.length !== 3) return null;
  const [a, tip, b] = idx.map((i) => s[i]!) as [Point, Point, Point];
  const la = dist(a, tip);
  const lb = dist(b, tip);
  if (Math.min(la, lb) < C.arrowArmRatio * Math.max(la, lb)) return null;
  const ang = Math.acos(clamp(dot(sub(a, tip), sub(b, tip)) / (la * lb)));
  return ang <= C.arrowMaxAngle * RAD ? { tip, a, b } : null;
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const unit = (v: Point): Point => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

/** A same-stroke V at the end of the line: the line without it, and whether it had one. */
function stripTail(pts: Point[], scale: number): { pts: Point[]; arrow: boolean } {
  const len = pathLength(pts);
  const idx = rdpIndices(pts, C.tailRdp * scale);
  const m = idx.length;
  for (let t = Math.max(1, m - 1 - C.tailMaxVerts); t < m - 1; t++) {
    const ti = idx[t]!;
    const tip = pts[ti]!;
    const back = sub(pts[idx[t - 1]!]!, tip);
    const out = sub(pts[idx[t + 1]!]!, tip);
    const ang = Math.acos(
      clamp(dot(back, out) / (Math.hypot(back.x, back.y) * Math.hypot(out.x, out.y) || 1)),
    );
    if (ang > C.tailAngle * RAD) continue;
    const tail = pts.slice(ti);
    const tailLen = pathLength(tail);
    const mainLen = len - tailLen;
    if (tailLen > Math.min(C.tailMaxLen * scale, C.tailFrac * len)) continue;
    if (mainLen < C.tailMainRatio * tailLen) continue;
    const ub = unit(back);
    const inCone = tail.every((p) => {
      const v = sub(p, tip);
      const l = Math.hypot(v.x, v.y);
      return l < C.tailTip * scale || dot(v, ub) / l >= Math.cos(C.tailCone * RAD);
    });
    if (inCone) return { pts: pts.slice(0, ti + 1), arrow: true };
  }
  return { pts, arrow: false };
}

type Chain = { pts: Point[]; idx: number[]; closed: boolean; compound: boolean };

function nearestJoin(chains: Chain[], cur: Chain, scale: number) {
  const lc = pathLength(cur.pts);
  let best: { chain: Chain; cEnd: 0 | 1; curEnd: 0 | 1 } | undefined;
  let bd = Infinity;
  for (const chain of chains) {
    if (chain.closed) continue;
    const limit =
      Math.max(C.joinMin, Math.min(C.joinMax, C.joinFrac * Math.min(lc, pathLength(chain.pts)))) *
      scale;
    for (const cEnd of [0, 1] as const) {
      for (const curEnd of [0, 1] as const) {
        const d = dist(endOf(chain.pts, cEnd), endOf(cur.pts, curEnd));
        if (d < limit && d < bd) {
          bd = d;
          best = { chain, cEnd, curEnd };
        }
      }
    }
  }
  return best;
}

const endOf = (pts: Point[], end: 0 | 1) => (end === 0 ? pts[0]! : pts[pts.length - 1]!);

function attach(lines: LineBuild[], h: Head, scale: number): LineBuild | null {
  let best: LineBuild | null = null;
  let bestEnd: 0 | 1 = 0;
  let bd = C.attachDist * scale;
  for (const line of lines) {
    for (const end of [0, 1] as const) {
      const d = dist(h.tip, endOf(line.points, end));
      if (d < bd) {
        bd = d;
        best = line;
        bestEnd = end;
      }
    }
  }
  if (!best) return null;
  const pts = bestEnd === 1 ? best.points : [...best.points].reverse();
  const tipEnd = pts[pts.length - 1]!;
  const reach = Math.min(C.dirLen * scale, pathLength(pts) / 2);
  let k = pts.length - 1;
  while (k > 0 && dist(pts[k]!, tipEnd) < reach) k--;
  const inward = unit(sub(pts[k]!, tipEnd));
  const va = unit(sub(h.a, h.tip));
  const vb = unit(sub(h.b, h.tip));
  const axis = unit({ x: va.x + vb.x, y: va.y + vb.y });
  if (dot(axis, inward) < Math.cos(C.symAngle * RAD)) return null;
  if (bestEnd === 1) best.arrowEnd = true;
  else best.arrowStart = true;
  return best;
}

type LineBuild = LineCluster & { idx: number[] };

export function clusterInk(ink: Ink, scale = 1): { shapes: ShapeCluster[]; lines: LineCluster[] } {
  const chains: Chain[] = [];
  const heads: { head: Head; i: number; stroke: Stroke }[] = [];
  ink.strokes.forEach((stroke, i) => {
    if (stroke.length < 2 || pathLength(stroke) < C.minStrokeLen * scale) return;
    const loop = closure(stroke, scale);
    if (loop) {
      chains.push({ pts: loop, idx: [i], closed: true, compound: false });
      return;
    }
    const head = arrowHead(stroke, scale);
    if (head) {
      heads.push({ head, i, stroke });
      return;
    }
    let cur: Chain = { pts: stroke, idx: [i], closed: false, compound: false };
    for (let hit = nearestJoin(chains, cur, scale); hit; hit = nearestJoin(chains, cur, scale)) {
      chains.splice(chains.indexOf(hit.chain), 1);
      const a = hit.cEnd === 1 ? hit.chain.pts : [...hit.chain.pts].reverse();
      const b = hit.curEnd === 0 ? cur.pts : [...cur.pts].reverse();
      cur = { ...cur, pts: [...a, ...b], idx: [...hit.chain.idx, ...cur.idx] };
      const loop = closure(cur.pts, scale);
      if (loop) {
        cur = { ...cur, pts: loop, closed: true };
        break;
      }
    }
    chains.push(cur);
  });

  const closedChains = chains.filter((c) => c.closed);
  const openChains: Chain[] = [];
  for (const o of chains) {
    if (o.closed) continue;
    const e0 = o.pts[0]!;
    const e1 = o.pts[o.pts.length - 1]!;
    let host: Chain | undefined;
    let hd = Infinity;
    for (const c of closedChains) {
      if (c.compound) continue;
      const b = bounds(c.pts);
      const m = Math.max(b.w, b.h);
      const tol = Math.max(C.compoundNearMin * scale, C.compoundNearFrac * m);
      const d0 = loopDist(e0, c.pts);
      const d1 = loopDist(e1, c.pts);
      if (d0 < tol && d1 < tol && dist(e0, e1) >= C.compoundSepFrac * m && d0 + d1 < hd) {
        hd = d0 + d1;
        host = c;
      }
    }
    if (host) {
      host.pts = [...host.pts, ...o.pts];
      host.idx = [...host.idx, ...o.idx];
      host.compound = true;
    } else openChains.push(o);
  }

  const lines: LineBuild[] = openChains.map((c) => {
    const end = stripTail(c.pts, scale);
    const start = stripTail([...end.pts].reverse(), scale);
    return {
      points: start.pts.reverse(),
      arrowStart: start.arrow,
      arrowEnd: end.arrow,
      last: 0,
      idx: c.idx,
    };
  });
  for (const { head, i, stroke } of heads) {
    const line = attach(lines, head, scale);
    if (line) line.idx.push(i);
    else lines.push({ points: stroke, arrowStart: false, arrowEnd: false, last: 0, idx: [i] });
  }

  const first = (c: { idx: number[] }) => Math.min(...c.idx);
  return {
    shapes: closedChains
      .sort((a, b) => first(a) - first(b))
      .map((c) => {
        const idx = c.idx.toSorted((a, b) => a - b);
        return {
          strokes: idx.map((i) => ink.strokes[i]!),
          points: c.pts,
          compound: c.compound,
          last: idx[idx.length - 1]!,
        };
      }),
    lines: lines
      .sort((a, b) => first(a) - first(b))
      .map(({ idx, ...l }) => ({ ...l, last: Math.max(...idx) })),
  };
}
