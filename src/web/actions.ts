import { convertInk, retype } from "../core/convert";
import type { Connector, Id, Stroke, Style } from "../core/model";
import {
  bringToFront,
  type Clip,
  copy,
  deleteElements,
  paste,
  sendToBack,
  setRouting,
  setStyle,
} from "../core/ops";
import { commit, diagram, ink, mode, selection, tabCycle, zoom } from "./state";

export const newId = (): Id => crypto.randomUUID();

const selected = () => [...selection.value];

export function deleteSelection() {
  if (!selection.value.size) return;
  commit(deleteElements(diagram.value, selected()));
  selection.value = new Set();
}

let clipboard: Clip | null = null;

export function copySelection() {
  if (selection.value.size) clipboard = copy(diagram.value, selected());
}

export function pasteClipboard() {
  if (!clipboard) return;
  const r = paste(diagram.value, clipboard, newId);
  commit(r.diagram);
  selection.value = new Set(r.ids);
  clipboard = copy(r.diagram, r.ids);
}

export const selectionToFront = () => commit(bringToFront(diagram.value, selected()));
export const selectionToBack = () => commit(sendToBack(diagram.value, selected()));
export const styleSelection = (patch: Partial<Style>) =>
  commit(setStyle(diagram.value, selected(), patch));
export const routeSelection = (routing: Connector["routing"]) =>
  commit(setRouting(diagram.value, selected(), routing));

export function toggleDrawMode() {
  mode.value = mode.value === "draw" ? "select" : "draw";
  selection.value = new Set();
}

export const addStroke = (stroke: Stroke) =>
  commit(diagram.value, { strokes: [...ink.value.strokes, stroke] });

export function discardInk() {
  if (ink.value.strokes.length) commit(diagram.value, { strokes: [] });
}

export const copyInk = () => navigator.clipboard.writeText(JSON.stringify(ink.value));

export function convertDrawing() {
  if (!ink.value.strokes.length) return;
  const r = convertInk(diagram.value, ink.value, { newId, scale: 1 / zoom.value });
  commit(r.diagram, { strokes: [] });
  if (r.last)
    tabCycle.value = { shapeId: r.last.shapeId, ranked: r.last.ranked.slice(0, 3), index: 0 };
}

export function cycleConversion() {
  const t = tabCycle.value;
  if (!t || t.ranked.length < 2) return;
  const index = (t.index + 1) % t.ranked.length;
  diagram.value = retype(diagram.value, t.shapeId, t.ranked[index]!);
  tabCycle.value = { ...t, index };
}
