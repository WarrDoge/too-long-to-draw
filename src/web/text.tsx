import { useLayoutEffect, useRef } from "preact/hooks";
import { connectorPath, pathMidpoint, type Rect, textBounds } from "../core/geometry";
import { DEFAULT_STYLE, type Style } from "../core/model";
import { addText, deleteElements, setText } from "../core/ops";
import { newId } from "./actions";
import { commit, diagram, type Editing, editing, pan, view, zoom } from "./state";

type Box = { rect: Rect; style: Style; text: string; free: boolean };

function boxFor(e: Editing): Box | undefined {
  const d = view.value;
  if (e.kind === "new-text") {
    return {
      rect: { x: e.x, y: e.y, w: 100, h: 14.4 },
      style: { ...DEFAULT_STYLE, align: "left" },
      text: "",
      free: true,
    };
  }
  const s = d.shapes.find((x) => x.id === e.id);
  if (s) return { rect: s, style: s.style, text: s.label, free: false };
  const c = d.connectors.find((x) => x.id === e.id);
  if (c) {
    const m = pathMidpoint(connectorPath(d, c).points);
    return {
      rect: { x: m.x - 50, y: m.y - 10, w: 100, h: 20 },
      style: c.style,
      text: c.label ?? "",
      free: false,
    };
  }
  const t = d.texts.find((x) => x.id === e.id);
  if (!t) return undefined;
  const b = textBounds(t);
  return {
    rect: { ...b, w: Math.max(b.w + 20, 100) },
    style: t.style,
    text: t.content,
    free: true,
  };
}

function Editor({ e }: { e: Editing }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const box = boxFor(e);
  const initial = useRef(box?.text ?? "");

  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  if (!box) return null;
  const { rect, style } = box;
  const z = zoom.value;

  const finish = () => {
    if (done.current) return;
    done.current = true;
    const value = ref.current?.value ?? "";
    editing.value = null;
    if (e.kind === "new-text") {
      if (value !== "") {
        commit(
          addText(diagram.value, {
            id: newId(),
            x: e.x,
            y: e.y,
            content: value,
            style: { ...DEFAULT_STYLE, align: "left" },
          }),
        );
      }
    } else if (box.free && value === "") {
      commit(deleteElements(diagram.value, [e.id]));
    } else if (value !== initial.current) {
      commit(setText(diagram.value, e.id, value));
    }
  };

  return (
    <textarea
      data-editor
      ref={ref}
      defaultValue={initial.current}
      wrap="off"
      onBlur={finish}
      onKeyUp={(ev) => ev.stopPropagation()}
      onKeyDown={(ev) => {
        ev.stopPropagation();
        if (ev.key === "Escape") finish();
      }}
      style={{
        position: "absolute",
        left: `${pan.value.x + rect.x * z}px`,
        top: `${pan.value.y + rect.y * z}px`,
        width: `${rect.w * z}px`,
        height: `${Math.max(rect.h, style.fontSize * 1.2) * z}px`,
        boxSizing: "border-box",
        margin: 0,
        padding: 0,
        border: "1px dashed #1a73e8",
        outline: "none",
        resize: "none",
        overflow: "hidden",
        background: "#fff",
        font: `${style.fontSize * z}px/1.2 sans-serif`,
        color: style.fontColor,
        textAlign: style.align,
      }}
    />
  );
}

export function TextEditor() {
  const e = editing.value;
  return e ? <Editor key={JSON.stringify(e)} e={e} /> : null;
}
