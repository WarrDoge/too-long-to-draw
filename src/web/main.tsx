import { effect, signal } from "@preact/signals";
import { render } from "preact";
import { emptyDiagram } from "./../core/model";
import {
  convertDrawing,
  copyInk,
  copySelection,
  cycleConversion,
  deleteSelection,
  discardInk,
  pasteClipboard,
  toggleDrawMode,
} from "./actions";
import { loadDiagram } from "./api";
import { Canvas } from "./canvas";
import { DiagramList, Palette, path, StylePanel, Toolbar } from "./panels";
import { endSession, flush, saveNow, startSession } from "./save";
import { editing, load, mode, name, redo, selection, tabCycle, undo } from "./state";

const error = signal<string | null>(null);
let opening = 0;

async function open(target: string | null) {
  const mine = ++opening;
  error.value = null;
  await flush();
  if (mine !== opening) return;
  if (target === null) {
    endSession();
    load(null, emptyDiagram());
    return;
  }
  try {
    const { diagram, etag } = await loadDiagram(target);
    if (mine !== opening) return;
    load(target, diagram);
    startSession(target, etag);
  } catch (e) {
    if (mine !== opening) return;
    endSession();
    load(null, emptyDiagram());
    error.value = `Cannot open "${target}": ${e instanceof Error ? e.message : e}`;
  }
}

effect(() => {
  const m = /^\/d\/([^/]+)$/.exec(path.value);
  const target = m?.[1] ? decodeURIComponent(m[1]) : null;
  if (target !== name.peek() || (target === null && error.peek() === null && opening === 0)) {
    void open(target);
  }
});

addEventListener("popstate", () => {
  path.value = location.pathname;
});

addEventListener("keydown", (e) => {
  const t = e.target;
  if (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement
  )
    return;
  if (editing.value) return;
  if (e.key !== "Tab" && !["Shift", "Control", "Alt", "Meta"].includes(e.key))
    tabCycle.value = null;
  const key = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl) {
    if (key === "z") (e.shiftKey ? redo : undo)();
    else if (key === "y") redo();
    else if (key === "c") copySelection();
    else if (key === "v") pasteClipboard();
    else if (key === "s") {
      e.preventDefault();
      void saveNow();
    } else if (key === "e" && e.shiftKey) {
      e.preventDefault();
      void copyInk();
    }
    return;
  }
  if (key === "delete" || key === "backspace") deleteSelection();
  else if (key === "d") toggleDrawMode();
  else if (key === "v") mode.value = "select";
  else if (key === "enter" && mode.value === "draw") convertDrawing();
  else if (key === "tab") {
    e.preventDefault();
    cycleConversion();
  } else if (key === "escape") {
    if (mode.value === "draw") discardInk();
    else selection.value = new Set();
  }
});

function App() {
  return (
    <div class="app">
      <Toolbar />
      <aside class="left">
        <DiagramList />
        <Palette />
      </aside>
      <main class="stage">
        {name.value ? (
          <Canvas />
        ) : (
          <p class="hint">{error.value ?? "Select or create a diagram"}</p>
        )}
      </main>
      <StylePanel />
    </div>
  );
}

render(<App />, document.getElementById("app")!);
