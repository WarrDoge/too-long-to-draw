import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import {
  arrowHead,
  connectorPath,
  containsRect,
  elementBounds,
  GRID,
  pathMidpoint,
  type Rect,
  shapePath,
  snap,
  textBounds,
} from "../core/geometry";
import {
  type Connector,
  DEFAULT_STYLE,
  type End,
  type Id,
  type Point,
  type Shape,
  type ShapeKind,
  type Style,
  type Text,
} from "../core/model";
import {
  addConnector,
  addShape,
  moveElements,
  renderOrder,
  reparent,
  resizeShape,
  setEnd,
} from "../core/ops";
import { addStroke, newId } from "./actions";
import {
  commit,
  diagram,
  editing,
  ink,
  interaction,
  mode,
  pan,
  selection,
  view,
  zoom,
} from "./state";
import { TextEditor } from "./text";

const ACCENT = "#1a73e8";
const LH = 1.2;

const SIZES: Record<ShapeKind, [number, number]> = {
  rectangle: [120, 60],
  "rounded-rectangle": [120, 60],
  parallelogram: [120, 60],
  ellipse: [120, 80],
  hexagon: [120, 80],
  cloud: [120, 80],
  diamond: [80, 80],
  triangle: [60, 80],
  cylinder: [60, 80],
};

type Drag =
  | { kind: "pan"; cx: number; cy: number; from: Point }
  | { kind: "move"; sx: number; sy: number; ox: number; oy: number }
  | { kind: "resize"; id: Id; fx: number; fy: number; sx: 1 | -1; sy: 1 | -1 }
  | { kind: "end"; id: Id; which: "source" | "target"; arrow: boolean | undefined }
  | { kind: "box"; sx: number; sy: number; cx: number; cy: number; shift: boolean; moved: boolean }
  | { kind: "stroke"; cx: number; cy: number; len: number };

let drag: Drag | null = null;
let svgEl: SVGSVGElement | null = null;

function toDiagram(cx: number, cy: number): Point {
  const r = svgEl?.getBoundingClientRect();
  return {
    x: (cx - (r?.left ?? 0) - pan.value.x) / zoom.value,
    y: (cy - (r?.top ?? 0) - pan.value.y) / zoom.value,
  };
}

const norm = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y),
});

function onPointerDown(e: PointerEvent) {
  const svg = e.currentTarget as SVGSVGElement;
  if (e.button === 1) {
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    drag = { kind: "pan", cx: e.clientX, cy: e.clientY, from: pan.value };
    return;
  }
  if (e.button !== 0 || editing.value) return;
  const p = toDiagram(e.clientX, e.clientY);
  svg.setPointerCapture(e.pointerId);

  if (mode.value === "draw") {
    drag = { kind: "stroke", cx: e.clientX, cy: e.clientY, len: 0 };
    interaction.value = { kind: "stroke", points: [p] };
    return;
  }

  const target = e.target as Element;
  const handle = target.closest("[data-handle]")?.getAttribute("data-handle");
  const endHandle = target.closest("[data-end]")?.getAttribute("data-end");
  const only = [...selection.value][0];
  const d = view.value;

  if (handle && only !== undefined) {
    const s = d.shapes.find((x) => x.id === only);
    if (s) {
      const sx = handle.includes("e") ? 1 : -1;
      const sy = handle.includes("s") ? 1 : -1;
      drag = {
        kind: "resize",
        id: only,
        fx: sx === 1 ? s.x : s.x + s.w,
        fy: sy === 1 ? s.y : s.y + s.h,
        sx,
        sy,
      };
      return;
    }
  }
  if ((endHandle === "source" || endHandle === "target") && only !== undefined) {
    const c = d.connectors.find((x) => x.id === only);
    if (c) {
      drag = { kind: "end", id: only, which: endHandle, arrow: c[endHandle].arrow };
      return;
    }
  }

  const id = target.closest("[data-id]")?.getAttribute("data-id");
  if (id) {
    if (e.shiftKey) {
      const next = new Set(selection.value);
      if (!next.delete(id)) next.add(id);
      selection.value = next;
      if (!next.has(id)) {
        drag = null;
        return;
      }
    } else if (!selection.value.has(id)) {
      selection.value = new Set([id]);
    }
    const b = elementBounds(diagram.value, id) ?? { x: 0, y: 0 };
    drag = { kind: "move", sx: p.x, sy: p.y, ox: b.x, oy: b.y };
    interaction.value = { kind: "move", ids: [...selection.value], dx: 0, dy: 0 };
    return;
  }

  drag = {
    kind: "box",
    sx: p.x,
    sy: p.y,
    cx: e.clientX,
    cy: e.clientY,
    shift: e.shiftKey,
    moved: false,
  };
}

function onPointerMove(e: PointerEvent) {
  if (!drag) return;
  const p = toDiagram(e.clientX, e.clientY);
  switch (drag.kind) {
    case "pan":
      pan.value = { x: drag.from.x + e.clientX - drag.cx, y: drag.from.y + e.clientY - drag.cy };
      break;
    case "move":
      interaction.value = {
        kind: "move",
        ids: [...selection.value],
        dx: snap(drag.ox + p.x - drag.sx) - drag.ox,
        dy: snap(drag.oy + p.y - drag.sy) - drag.oy,
      };
      break;
    case "resize": {
      const cx = drag.fx + drag.sx * Math.max(GRID, drag.sx * (snap(p.x) - drag.fx));
      const cy = drag.fy + drag.sy * Math.max(GRID, drag.sy * (snap(p.y) - drag.fy));
      interaction.value = {
        kind: "resize",
        id: drag.id,
        rect: norm({ x: drag.fx, y: drag.fy }, { x: cx, y: cy }),
      };
      break;
    }
    case "end": {
      const end: End = { kind: "free", x: snap(p.x), y: snap(p.y) };
      interaction.value = {
        kind: "end",
        id: drag.id,
        which: drag.which,
        end: drag.arrow === undefined ? end : { ...end, arrow: drag.arrow },
      };
      break;
    }
    case "box": {
      if (Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) > 3) drag.moved = true;
      interaction.value = { kind: "box", rect: norm({ x: drag.sx, y: drag.sy }, p) };
      break;
    }
    case "stroke": {
      const evs = e.getCoalescedEvents();
      const list = evs.length ? evs : [e];
      const pts = list.map((ev) => {
        drag = drag as Extract<Drag, { kind: "stroke" }>;
        drag.len += Math.hypot(ev.clientX - drag.cx, ev.clientY - drag.cy);
        drag.cx = ev.clientX;
        drag.cy = ev.clientY;
        return toDiagram(ev.clientX, ev.clientY);
      });
      const cur = interaction.value;
      if (cur?.kind === "stroke")
        interaction.value = { kind: "stroke", points: [...cur.points, ...pts] };
      break;
    }
  }
}

function onPointerUp(e: PointerEvent) {
  const d = drag;
  const i = interaction.value;
  drag = null;
  interaction.value = null;
  if (!d) return;
  const cur = diagram.value;
  switch (d.kind) {
    case "move":
      if (i?.kind === "move" && (i.dx || i.dy)) {
        commit(reparent(moveElements(cur, i.ids, i.dx, i.dy), i.ids));
      }
      break;
    case "resize":
      if (i?.kind === "resize") commit(resizeShape(cur, i.id, i.rect));
      break;
    case "end": {
      if (i?.kind !== "end") break;
      const shape = document
        .elementsFromPoint(e.clientX, e.clientY)
        .map((el) => el.closest("[data-shape]"))
        .find((el) => el && el.getAttribute("data-id") !== i.id);
      const id = shape?.getAttribute("data-id");
      const end: End = id
        ? i.end.arrow === undefined
          ? { kind: "glued", shapeId: id }
          : { kind: "glued", shapeId: id, arrow: i.end.arrow }
        : i.end;
      commit(setEnd(cur, i.id, i.which, end));
      break;
    }
    case "box": {
      if (!d.moved || i?.kind !== "box") {
        if (!d.shift) selection.value = new Set();
        break;
      }
      const hit = [...cur.shapes, ...cur.connectors, ...cur.texts]
        .filter((el) => {
          const b = elementBounds(cur, el.id);
          return b && containsRect(i.rect, b);
        })
        .map((el) => el.id);
      selection.value = new Set([...(d.shift ? selection.value : []), ...hit]);
      break;
    }
    case "stroke":
      if (d.len >= 3 && i?.kind === "stroke") addStroke(i.points);
      break;
  }
}

function onDblClick(e: MouseEvent) {
  const t = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
  const id = t.closest("[data-id]")
    ? t.closest("[data-id]")?.getAttribute("data-id")
    : t.closest("[data-handle],[data-end]")
      ? [...selection.value][0]
      : undefined;
  if (id) {
    editing.value = { kind: "element", id };
    return;
  }
  const p = toDiagram(e.clientX, e.clientY);
  editing.value = { kind: "new-text", x: snap(p.x), y: snap(p.y) };
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  const raw = e.dataTransfer?.getData("application/x-tltd");
  if (!raw) return;
  const { kind } = JSON.parse(raw) as { kind: ShapeKind | "connector" };
  const p = toDiagram(e.clientX, e.clientY);
  const id = newId();
  if (kind === "connector") {
    const x = snap(p.x);
    const y = snap(p.y);
    commit(
      addConnector(diagram.value, {
        id,
        source: { kind: "free", x, y },
        target: { kind: "free", x: x + 120, y, arrow: true },
        routing: "straight",
        style: DEFAULT_STYLE,
      }),
    );
  } else {
    const [w, h] = SIZES[kind];
    const shape: Shape = {
      id,
      kind,
      x: snap(p.x - w / 2),
      y: snap(p.y - h / 2),
      w,
      h,
      label: "",
      style: DEFAULT_STYLE,
    };
    commit(reparent(addShape(diagram.value, shape), [id]));
  }
  selection.value = new Set([id]);
}

function Lines(props: {
  text: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  style: Style;
  halo?: boolean;
  [attr: string]: unknown;
}) {
  const { text, x, y, anchor, style, halo, ...rest } = props;
  const fs = style.fontSize;
  return (
    <text
      {...rest}
      x={x}
      y={y}
      font-family="sans-serif"
      font-size={fs}
      fill={style.fontColor}
      text-anchor={anchor}
      dominant-baseline="central"
      {...(halo ? { stroke: "#fff", "stroke-width": 3, "paint-order": "stroke" } : {})}
    >
      {text.split("\n").map((l, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : fs * LH}>
          {l || " "}
        </tspan>
      ))}
    </text>
  );
}

const ANCHOR = { left: "start", center: "middle", right: "end" } as const;

function ShapeView({ s, container }: { s: Shape; container: boolean }) {
  const fs = s.style.fontSize;
  const n = s.label.split("\n").length;
  const pad = 6;
  const x = { left: s.x + pad, center: s.x + s.w / 2, right: s.x + s.w - pad }[s.style.align];
  return (
    <g data-id={s.id} data-shape={s.kind}>
      <path
        d={shapePath(s)}
        fill={s.style.fill}
        stroke={s.style.stroke}
        stroke-width={s.style.strokeWidth}
      />
      {s.label && container ? (
        <Lines
          text={s.label}
          x={s.x + pad}
          y={s.y + pad + (fs * LH) / 2}
          anchor="start"
          style={s.style}
        />
      ) : s.label ? (
        <Lines
          text={s.label}
          x={x}
          y={s.y + s.h / 2 - ((n - 1) * fs * LH) / 2}
          anchor={ANCHOR[s.style.align]}
          style={s.style}
        />
      ) : null}
    </g>
  );
}

function ConnectorView({ c }: { c: Connector }) {
  const { points, d } = connectorPath(view.value, c);
  const mid = pathMidpoint(points);
  const arrow = (at: "source" | "target") =>
    c[at].arrow ? (
      <polygon
        data-arrow={at}
        points={arrowHead(points, at, 6 + 2 * c.style.strokeWidth)
          .map((p) => `${p.x},${p.y}`)
          .join(" ")}
        fill={c.style.stroke}
      />
    ) : null;
  return (
    <g data-id={c.id} data-connector data-source={c.source.kind} data-target={c.target.kind}>
      <path d={d} fill="none" stroke={c.style.stroke} stroke-width={c.style.strokeWidth} />
      {arrow("source")}
      {arrow("target")}
      {c.label ? (
        <Lines text={c.label} x={mid.x} y={mid.y} anchor="middle" style={c.style} halo />
      ) : null}
      <path
        data-ui
        d={d}
        fill="none"
        stroke="transparent"
        stroke-width={10}
        pointer-events="stroke"
      />
    </g>
  );
}

function TextView({ t }: { t: Text }) {
  const b = textBounds(t);
  const x = { left: b.x, center: b.x + b.w / 2, right: b.x + b.w }[t.style.align];
  return (
    <Lines
      data-id={t.id}
      data-text
      text={t.content}
      x={x}
      y={b.y + (t.style.fontSize * LH) / 2}
      anchor={ANCHOR[t.style.align]}
      style={t.style}
    />
  );
}

const outlineProps = {
  fill: "none",
  stroke: ACCENT,
  "stroke-dasharray": "4 3",
  "pointer-events": "none",
} as const;

function Selection() {
  const d = view.value;
  const z = zoom.value;
  const ids = [...selection.value];
  const single =
    ids.length === 1 && !interaction.value?.kind.startsWith("box") ? ids[0] : undefined;
  const hs = 8 / z;
  const out: JSX.Element[] = ids.map((id) => {
    const b = elementBounds(d, id);
    if (!b) return <g key={id} />;
    const pad = 2 / z;
    return (
      <rect
        key={id}
        {...outlineProps}
        stroke-width={1 / z}
        x={b.x - pad}
        y={b.y - pad}
        width={b.w + 2 * pad}
        height={b.h + 2 * pad}
      />
    );
  });
  const s = d.shapes.find((x) => x.id === single);
  if (s) {
    const corners = {
      nw: [s.x, s.y],
      ne: [s.x + s.w, s.y],
      sw: [s.x, s.y + s.h],
      se: [s.x + s.w, s.y + s.h],
    } as const;
    for (const [h, [cx, cy]] of Object.entries(corners)) {
      out.push(
        <rect
          key={h}
          data-handle={h}
          x={cx - hs / 2}
          y={cy - hs / 2}
          width={hs}
          height={hs}
          fill="#fff"
          stroke={ACCENT}
          stroke-width={1 / z}
          cursor={`${h}-resize`}
        />,
      );
    }
  }
  const c = d.connectors.find((x) => x.id === single);
  if (c) {
    const pts = connectorPath(d, c).points;
    for (const [which, p] of [
      ["source", pts[0]],
      ["target", pts.at(-1)],
    ] as const) {
      if (!p) continue;
      out.push(
        <circle
          key={which}
          data-end={which}
          cx={p.x}
          cy={p.y}
          r={5 / z}
          fill="#fff"
          stroke={ACCENT}
          stroke-width={1 / z}
          cursor="crosshair"
        />,
      );
    }
  }
  return <g data-ui>{out}</g>;
}

function Grid() {
  const z = zoom.value;
  const step = GRID * z * (GRID * z < 5 ? 5 : 1);
  const { x, y } = pan.value;
  return (
    <g data-ui pointer-events="none">
      <defs>
        <pattern
          id="tltd-grid"
          width={step}
          height={step}
          x={x}
          y={y}
          patternUnits="userSpaceOnUse"
        >
          <path d={`M ${step} 0 L 0 0 0 ${step}`} fill="none" stroke="#e6e6e6" stroke-width={1} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#tltd-grid)" />
    </g>
  );
}

function Ink() {
  const i = interaction.value;
  const strokes = [...ink.value.strokes, ...(i?.kind === "stroke" ? [i.points] : [])];
  return (
    <>
      {strokes.map((pts, k) => (
        <polyline
          key={k}
          data-ink
          data-ui
          points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={ACCENT}
          stroke-width={2 / zoom.value}
          stroke-linecap="round"
          stroke-linejoin="round"
          pointer-events="none"
        />
      ))}
    </>
  );
}

function BoxRect() {
  const i = interaction.value;
  if (i?.kind !== "box") return null;
  const z = zoom.value;
  return (
    <rect
      data-ui
      {...outlineProps}
      stroke-width={1 / z}
      x={i.rect.x}
      y={i.rect.y}
      width={i.rect.w}
      height={i.rect.h}
    />
  );
}

export function Canvas() {
  useEffect(() => {
    const svg = svgEl;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        const r = svg.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const z0 = zoom.value;
        const z1 = Math.min(4, Math.max(0.1, z0 * Math.exp(-e.deltaY * 0.01)));
        const { x, y } = pan.value;
        pan.value = { x: mx - ((mx - x) * z1) / z0, y: my - ((my - y) * z1) / z0 };
        zoom.value = z1;
      } else {
        pan.value = { x: pan.value.x - e.deltaX, y: pan.value.y - e.deltaY };
      }
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const d = view.value;
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <svg
        data-canvas
        role="img"
        aria-label="Diagram canvas"
        ref={(el) => {
          svgEl = el;
        }}
        width="100%"
        height="100%"
        style={{ display: "block", userSelect: "none", touchAction: "none", background: "#fff" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDblClick={onDblClick}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <Grid />
        <g
          data-viewport
          transform={`translate(${pan.value.x} ${pan.value.y}) scale(${zoom.value})`}
        >
          {renderOrder(d).map((s) => (
            <ShapeView key={s.id} s={s} container={d.shapes.some((c) => c.parent === s.id)} />
          ))}
          {d.connectors.map((c) => (
            <ConnectorView key={c.id} c={c} />
          ))}
          {d.texts.map((t) => (
            <TextView key={t.id} t={t} />
          ))}
          <Ink />
          <Selection />
          <BoxRect />
        </g>
      </svg>
      <TextEditor />
    </div>
  );
}
