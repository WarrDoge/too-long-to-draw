import { connectorPath, containsRect, GRID, type Rect, shapeRect } from "./geometry";
import type { Connector, Diagram, End, Id, Shape, Style, Text } from "./model";

export type Clip = { shapes: Shape[]; connectors: Connector[]; texts: Text[] };

const area = (s: Shape) => s.w * s.h;

const mapIn = <T extends { id: Id }>(arr: T[], ids: ReadonlySet<Id>, f: (e: T) => T) =>
  arr.map((e) => (ids.has(e.id) ? f(e) : e));

const withParent = (s: Shape, parent: Id | undefined): Shape => {
  const { parent: _, ...rest } = s;
  return parent === undefined ? rest : { ...rest, parent };
};

const toFree = (e: End, p: { x: number; y: number }): End =>
  e.arrow === undefined ? { kind: "free", ...p } : { kind: "free", ...p, arrow: e.arrow };

export const childrenOf = (d: Diagram, id: Id): Shape[] => d.shapes.filter((s) => s.parent === id);

export function descendants(d: Diagram, id: Id): Set<Id> {
  const out = new Set<Id>();
  const stack = [id];
  for (let cur = stack.pop(); cur !== undefined; cur = stack.pop()) {
    for (const c of childrenOf(d, cur)) {
      out.add(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

export function renderOrder(d: Diagram): Shape[] {
  const walk = (s: Shape): Shape[] => [s, ...childrenOf(d, s.id).flatMap(walk)];
  return d.shapes.filter((s) => s.parent === undefined).flatMap(walk);
}

export const addShape = (d: Diagram, s: Shape): Diagram => ({ ...d, shapes: [...d.shapes, s] });
export const addConnector = (d: Diagram, c: Connector): Diagram => ({
  ...d,
  connectors: [...d.connectors, c],
});
export const addText = (d: Diagram, t: Text): Diagram => ({ ...d, texts: [...d.texts, t] });

export function moveElements(d: Diagram, ids: readonly Id[], dx: number, dy: number): Diagram {
  const sel = new Set(ids);
  const moving = new Set<Id>();
  for (const s of d.shapes) {
    if (sel.has(s.id)) {
      moving.add(s.id);
      for (const x of descendants(d, s.id)) moving.add(x);
    }
  }
  const end = (e: End): End => (e.kind === "free" ? { ...e, x: e.x + dx, y: e.y + dy } : e);
  return {
    ...d,
    shapes: mapIn(d.shapes, moving, (s) => ({ ...s, x: s.x + dx, y: s.y + dy })),
    texts: mapIn(d.texts, sel, (t) => ({ ...t, x: t.x + dx, y: t.y + dy })),
    connectors: mapIn(d.connectors, sel, (c) => ({
      ...c,
      source: end(c.source),
      target: end(c.target),
    })),
  };
}

export const resizeShape = (d: Diagram, id: Id, { x, y, w, h }: Rect): Diagram => ({
  ...d,
  shapes: mapIn(d.shapes, new Set([id]), (s) => ({ ...s, x, y, w, h })),
});

export function parentFor(d: Diagram, shapeId: Id): Id | undefined {
  const s = d.shapes.find((x) => x.id === shapeId);
  if (!s) return undefined;
  const below = descendants(d, shapeId);
  const r = shapeRect(s);
  let best: Shape | undefined;
  for (const o of d.shapes) {
    if (o.id === shapeId || below.has(o.id) || !containsRect(shapeRect(o), r)) continue;
    if (!best || area(o) < area(best)) best = o;
  }
  return best?.id;
}

/** Applies the container rule to the listed shapes, then to every shape they now contain or used to parent. */
export function reparent(d: Diagram, ids: readonly Id[]): Diagram {
  let out = d;
  const set = (id: Id) => {
    const p = parentFor(out, id);
    out = { ...out, shapes: mapIn(out.shapes, new Set([id]), (s) => withParent(s, p)) };
  };
  const listed = ids.filter((id) => d.shapes.some((s) => s.id === id));
  for (const id of listed) set(id);
  for (const id of listed) {
    const r = shapeRect(out.shapes.find((s) => s.id === id)!);
    for (const o of out.shapes) {
      if (o.id !== id && (o.parent === id || containsRect(r, shapeRect(o)))) set(o.id);
    }
  }
  return out;
}

export function deleteElements(d: Diagram, ids: readonly Id[]): Diagram {
  const gone = new Set(ids);
  for (const s of d.shapes) {
    if (gone.has(s.id)) for (const x of descendants(d, s.id)) gone.add(x);
  }
  const fix = (c: Connector): Connector => {
    const { points } = connectorPath(d, c);
    const first = points[0] as (typeof points)[number];
    const last = points[points.length - 1] as typeof first;
    const f = (e: End, p: typeof first) =>
      e.kind === "glued" && gone.has(e.shapeId) ? toFree(e, p) : e;
    return { ...c, source: f(c.source, first), target: f(c.target, last) };
  };
  return {
    ...d,
    shapes: d.shapes.filter((s) => !gone.has(s.id)),
    texts: d.texts.filter((t) => !gone.has(t.id)),
    connectors: d.connectors.filter((c) => !gone.has(c.id)).map(fix),
  };
}

export function copy(d: Diagram, ids: readonly Id[]): Clip {
  const set = new Set(ids);
  for (const s of d.shapes) {
    if (set.has(s.id)) for (const x of descendants(d, s.id)) set.add(x);
  }
  const shapes = d.shapes.filter((s) => set.has(s.id));
  const connectors = d.connectors
    .filter((c) => set.has(c.id))
    .map((c) => {
      const { points } = connectorPath(d, c);
      const first = points[0] as (typeof points)[number];
      const last = points[points.length - 1] as typeof first;
      const f = (e: End, p: typeof first) =>
        e.kind === "glued" && !set.has(e.shapeId) ? toFree(e, p) : e;
      return { ...c, source: f(c.source, first), target: f(c.target, last) };
    });
  return { shapes, connectors, texts: d.texts.filter((t) => set.has(t.id)) };
}

export function paste(
  d: Diagram,
  clip: Clip,
  newId: () => Id,
  offset = GRID,
): { diagram: Diagram; ids: Id[] } {
  const map = new Map<Id, Id>();
  for (const e of [...clip.shapes, ...clip.connectors, ...clip.texts]) map.set(e.id, newId());
  const nid = (id: Id) => map.get(id) as Id;
  const orphans: Id[] = [];
  const shapes = clip.shapes.map((s): Shape => {
    const moved = { ...s, id: nid(s.id), x: s.x + offset, y: s.y + offset };
    if (s.parent !== undefined && map.has(s.parent)) return { ...moved, parent: nid(s.parent) };
    orphans.push(moved.id);
    return withParent(moved, undefined);
  });
  const end = (e: End): End => {
    if (e.kind === "free") return { ...e, x: e.x + offset, y: e.y + offset };
    return { ...e, shapeId: nid(e.shapeId) };
  };
  const connectors = clip.connectors.map((c) => ({
    ...c,
    id: nid(c.id),
    source: end(c.source),
    target: end(c.target),
  }));
  const texts = clip.texts.map((t) => ({ ...t, id: nid(t.id), x: t.x + offset, y: t.y + offset }));
  const diagram = reparent(
    {
      ...d,
      shapes: [...d.shapes, ...shapes],
      connectors: [...d.connectors, ...connectors],
      texts: [...d.texts, ...texts],
    },
    orphans,
  );
  return { diagram, ids: [...map.values()] };
}

const reorder = <T extends { id: Id }>(arr: T[], ids: ReadonlySet<Id>, front: boolean) => {
  const sel = arr.filter((e) => ids.has(e.id));
  const rest = arr.filter((e) => !ids.has(e.id));
  return front ? [...rest, ...sel] : [...sel, ...rest];
};

const zorder = (d: Diagram, ids: readonly Id[], front: boolean): Diagram => {
  const s = new Set(ids);
  return {
    ...d,
    shapes: reorder(d.shapes, s, front),
    connectors: reorder(d.connectors, s, front),
    texts: reorder(d.texts, s, front),
  };
};

export const bringToFront = (d: Diagram, ids: readonly Id[]) => zorder(d, ids, true);
export const sendToBack = (d: Diagram, ids: readonly Id[]) => zorder(d, ids, false);

export function setStyle(d: Diagram, ids: readonly Id[], patch: Partial<Style>): Diagram {
  const s = new Set(ids);
  const f = <T extends { style: Style }>(e: T): T => ({ ...e, style: { ...e.style, ...patch } });
  return {
    ...d,
    shapes: mapIn(d.shapes, s, f),
    connectors: mapIn(d.connectors, s, f),
    texts: mapIn(d.texts, s, f),
  };
}

export function setText(d: Diagram, id: Id, content: string): Diagram {
  const one = new Set([id]);
  return {
    ...d,
    shapes: mapIn(d.shapes, one, (s) => ({ ...s, label: content })),
    connectors: mapIn(d.connectors, one, (c) => {
      const { label: _, ...rest } = c;
      return content === "" ? rest : { ...rest, label: content };
    }),
    texts: mapIn(d.texts, one, (t) => ({ ...t, content })),
  };
}

export const setEnd = (
  d: Diagram,
  connectorId: Id,
  which: "source" | "target",
  end: End,
): Diagram => ({
  ...d,
  connectors: mapIn(d.connectors, new Set([connectorId]), (c) => ({ ...c, [which]: end })),
});

export const setRouting = (
  d: Diagram,
  ids: readonly Id[],
  routing: Connector["routing"],
): Diagram => ({
  ...d,
  connectors: mapIn(d.connectors, new Set(ids), (c) => ({ ...c, routing })),
});
