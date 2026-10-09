import { batch, computed, signal } from "@preact/signals";
import type { Rect } from "../core/geometry";
import {
  type Diagram,
  type End,
  emptyDiagram,
  type Id,
  type Ink,
  type Point,
  type ShapeKind,
} from "../core/model";
import { moveElements, resizeShape, setEnd } from "../core/ops";

export type Mode = "select" | "draw";

export type Interaction =
  | { kind: "move"; ids: Id[]; dx: number; dy: number }
  | { kind: "resize"; id: Id; rect: Rect }
  | { kind: "end"; id: Id; which: "source" | "target"; end: End }
  | { kind: "box"; rect: Rect }
  | { kind: "stroke"; points: Point[] };

export type Editing = { kind: "element"; id: Id } | { kind: "new-text"; x: number; y: number };

export type TabCycle = { shapeId: Id; ranked: ShapeKind[]; index: number };

type Snapshot = { diagram: Diagram; ink: Ink };

export const name = signal<string | null>(null);
export const diagram = signal<Diagram>(emptyDiagram());
export const ink = signal<Ink>({ strokes: [] });
export const selection = signal<ReadonlySet<Id>>(new Set());
export const mode = signal<Mode>("select");
export const zoom = signal(1);
export const pan = signal<Point>({ x: 0, y: 0 });
export const interaction = signal<Interaction | null>(null);
export const editing = signal<Editing | null>(null);
export const tabCycle = signal<TabCycle | null>(null);
export const undoStack = signal<Snapshot[]>([]);
export const redoStack = signal<Snapshot[]>([]);

export const view = computed(() => {
  const d = diagram.value;
  const i = interaction.value;
  switch (i?.kind) {
    case "move":
      return moveElements(d, i.ids, i.dx, i.dy);
    case "resize":
      return resizeShape(d, i.id, i.rect);
    case "end":
      return setEnd(d, i.id, i.which, i.end);
    default:
      return d;
  }
});

function apply(next: Snapshot) {
  diagram.value = next.diagram;
  ink.value = next.ink;
  const ids = new Set(
    [...next.diagram.shapes, ...next.diagram.connectors, ...next.diagram.texts].map((e) => e.id),
  );
  if ([...selection.value].some((id) => !ids.has(id))) {
    selection.value = new Set([...selection.value].filter((id) => ids.has(id)));
  }
}

export function commit(next: Diagram, nextInk: Ink = ink.value) {
  if (next === diagram.value && nextInk === ink.value) return;
  batch(() => {
    undoStack.value = [...undoStack.value, { diagram: diagram.value, ink: ink.value }];
    redoStack.value = [];
    tabCycle.value = null;
    apply({ diagram: next, ink: nextInk });
  });
}

export function undo() {
  const prev = undoStack.value.at(-1);
  if (!prev) return;
  batch(() => {
    undoStack.value = undoStack.value.slice(0, -1);
    redoStack.value = [...redoStack.value, { diagram: diagram.value, ink: ink.value }];
    tabCycle.value = null;
    apply(prev);
  });
}

export function redo() {
  const next = redoStack.value.at(-1);
  if (!next) return;
  batch(() => {
    redoStack.value = redoStack.value.slice(0, -1);
    undoStack.value = [...undoStack.value, { diagram: diagram.value, ink: ink.value }];
    tabCycle.value = null;
    apply(next);
  });
}

export function load(n: string | null, d: Diagram) {
  batch(() => {
    name.value = n;
    diagram.value = d;
    ink.value = { strokes: [] };
    selection.value = new Set();
    interaction.value = null;
    editing.value = null;
    tabCycle.value = null;
    undoStack.value = [];
    redoStack.value = [];
  });
}
