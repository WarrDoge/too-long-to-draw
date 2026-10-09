import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { shapePath } from "../core/geometry";
import {
  type Connector,
  DEFAULT_STYLE,
  emptyDiagram,
  SHAPE_KINDS,
  type ShapeKind,
  type Style,
} from "../core/model";
import {
  routeSelection,
  selectionToBack,
  selectionToFront,
  styleSelection,
  toggleDrawMode,
} from "./actions";
import {
  ApiError,
  type DiagramInfo,
  deleteDiagram,
  listDiagrams,
  renameDiagram,
  saveDiagram,
} from "./api";
import { exportPng, exportSvg } from "./export";
import { cancel, endSession, flush, renameSession, status } from "./save";
import {
  diagram,
  mode,
  name,
  pan,
  redo,
  redoStack,
  selection,
  undo,
  undoStack,
  zoom,
} from "./state";

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const path = signal(location.pathname);

export function navigate(to: string) {
  history.pushState(null, "", to);
  path.value = to;
}

const diagrams = signal<DiagramInfo[]>([]);

const refresh = async () => {
  try {
    diagrams.value = await listDiagrams();
  } catch (e) {
    alert(String(e));
  }
};

function askName(initial: string): string | null {
  const n = prompt("Diagram name", initial)?.trim();
  if (n === undefined) return null;
  if (!NAME_RE.test(n)) {
    alert("Names use letters, digits, - and _ (1-64 characters)");
    return null;
  }
  return n;
}

async function newDiagram() {
  const n = askName("");
  if (!n) return;
  try {
    await saveDiagram(n, emptyDiagram(), { ifNoneMatch: true });
  } catch (e) {
    alert(e instanceof ApiError && e.status === 412 ? `"${n}" already exists` : String(e));
    return;
  }
  await refresh();
  navigate(`/d/${n}`);
}

async function renameCurrent() {
  const from = name.value;
  const to = from && askName(from);
  if (!from || !to || to === from) return;
  await flush();
  try {
    await renameDiagram(from, to);
  } catch (e) {
    alert(e instanceof ApiError && e.status === 409 ? `"${to}" already exists` : String(e));
    return;
  }
  name.value = to;
  renameSession(to);
  history.replaceState(null, "", `/d/${to}`);
  path.value = `/d/${to}`;
  await refresh();
}

async function deleteCurrent() {
  const n = name.value;
  if (!n || !confirm(`Delete "${n}"?`)) return;
  await cancel();
  try {
    await deleteDiagram(n);
  } catch (e) {
    alert(String(e));
    return;
  }
  endSession();
  await refresh();
  navigate("/");
}

export function DiagramList() {
  useEffect(() => void refresh(), []);
  const current = name.value;
  return (
    <section class="list">
      <div class="row">
        <button type="button" onClick={newDiagram}>
          New
        </button>
        <button type="button" disabled={!current} onClick={renameCurrent}>
          Rename
        </button>
        <button type="button" disabled={!current} onClick={deleteCurrent}>
          Delete
        </button>
      </div>
      <nav>
        {diagrams.value.map((d) => (
          <a
            key={d.name}
            href={`/d/${d.name}`}
            aria-current={d.name === current ? "page" : undefined}
            title={d.modified}
            onClick={(e) => {
              if (e.button || e.ctrlKey || e.metaKey || e.shiftKey) return;
              e.preventDefault();
              navigate(`/d/${d.name}`);
            }}
          >
            {d.name}
          </a>
        ))}
      </nav>
    </section>
  );
}

const ICON = { x: 3, y: 5, w: 26, h: 18 };

export function Palette() {
  const items: (ShapeKind | "connector")[] = [...SHAPE_KINDS, "connector"];
  return (
    <section class="palette">
      {items.map((kind) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: drag source only
        <div
          key={kind}
          class="item"
          draggable
          data-palette={kind}
          title={kind}
          onDragStart={(e) =>
            e.dataTransfer?.setData("application/x-tltd", JSON.stringify({ kind }))
          }
        >
          <svg width="32" height="28" viewBox="0 0 32 28" aria-hidden="true">
            {kind === "connector" ? (
              <path d="M4 24 L26 6 M26 6 L19 7 M26 6 L24 13" fill="none" stroke="currentColor" />
            ) : (
              <path
                d={shapePath({ id: "", kind, ...ICON, label: "", style: DEFAULT_STYLE })}
                fill="none"
                stroke="currentColor"
              />
            )}
          </svg>
          <span>{kind === "connector" ? "Connector" : kind}</span>
        </div>
      ))}
    </section>
  );
}

function setZoom(z: number) {
  const next = Math.min(4, Math.max(0.1, z));
  const box = document.querySelector(".stage")?.getBoundingClientRect();
  const k = next / zoom.value;
  if (box) {
    const c = { x: box.width / 2, y: box.height / 2 };
    pan.value = { x: c.x - (c.x - pan.value.x) * k, y: c.y - (c.y - pan.value.y) * k };
  }
  zoom.value = next;
}

const STATUS_TITLE = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  error: "Save failed",
  conflict: "Conflict: changed elsewhere (Ctrl+S overwrites)",
};

export function Toolbar() {
  const n = name.value;
  const modes = [
    ["select", "Select", "Select (V)"],
    ["draw", "Draw", "Draw (D)"],
  ] as const;
  return (
    <header class="toolbar">
      {modes.map(([m, text, title]) => (
        <button
          key={m}
          type="button"
          title={title}
          aria-pressed={mode.value === m}
          onClick={() => mode.value !== m && toggleDrawMode()}
        >
          {text}
        </button>
      ))}
      <button type="button" disabled={!undoStack.value.length} onClick={undo}>
        Undo
      </button>
      <button type="button" disabled={!redoStack.value.length} onClick={redo}>
        Redo
      </button>
      <button type="button" title="Zoom out" onClick={() => setZoom(zoom.value / 1.25)}>
        −
      </button>
      <button type="button" title="Reset zoom" onClick={() => setZoom(1)}>
        {Math.round(zoom.value * 100)}%
      </button>
      <button type="button" title="Zoom in" onClick={() => setZoom(zoom.value * 1.25)}>
        +
      </button>
      <button type="button" disabled={!n} onClick={() => n && exportSvg(n)}>
        Export SVG
      </button>
      <button type="button" disabled={!n} onClick={() => n && void exportPng(n)}>
        Export PNG
      </button>
      <span class="grow" />
      <span class="dot" data-status={status.value} title={STATUS_TITLE[status.value]} />
    </header>
  );
}

function Field(props: { label: string; children: preact.ComponentChildren }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the input is passed as children
    <label>
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

export function StylePanel() {
  const d = diagram.value;
  const id = [...selection.value][0];
  const conn = d.connectors.find((c) => c.id === id);
  const el = id && (d.shapes.find((s) => s.id === id) ?? conn ?? d.texts.find((t) => t.id === id));
  if (!el) return <aside class="style">Nothing selected</aside>;
  const s = el.style;
  const color = (label: string, key: "fill" | "stroke" | "fontColor") => (
    <Field label={label}>
      <input
        type="color"
        name={key}
        value={s[key]}
        onChange={(e) => styleSelection({ [key]: e.currentTarget.value })}
      />
    </Field>
  );
  const num = (label: string, key: "strokeWidth" | "fontSize", min: number) => (
    <Field label={label}>
      <input
        type="number"
        name={key}
        min={min}
        value={s[key]}
        onChange={(e) => {
          const v = e.currentTarget.valueAsNumber;
          if (v >= min) styleSelection({ [key]: v });
        }}
      />
    </Field>
  );
  return (
    <aside class="style">
      {color("Fill", "fill")}
      {color("Stroke", "stroke")}
      {num("Stroke width", "strokeWidth", 0)}
      {num("Font size", "fontSize", 1)}
      {color("Font color", "fontColor")}
      <Field label="Align">
        <select
          name="align"
          value={s.align}
          onChange={(e) => styleSelection({ align: e.currentTarget.value as Style["align"] })}
        >
          <option>left</option>
          <option>center</option>
          <option>right</option>
        </select>
      </Field>
      {conn && (
        <Field label="Routing">
          <select
            name="routing"
            value={conn.routing}
            onChange={(e) => routeSelection(e.currentTarget.value as Connector["routing"])}
          >
            <option>straight</option>
            <option>orthogonal</option>
          </select>
        </Field>
      )}
      <button type="button" onClick={selectionToFront}>
        Bring to front
      </button>
      <button type="button" onClick={selectionToBack}>
        Send to back
      </button>
    </aside>
  );
}
