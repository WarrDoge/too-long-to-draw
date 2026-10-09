import { expect, test } from "bun:test";
import { borderPoint } from "./geometry";
import { type Connector, DEFAULT_STYLE, Diagram, type Shape } from "./model";
import {
  bringToFront,
  copy,
  deleteElements,
  descendants,
  moveElements,
  parentFor,
  paste,
  renderOrder,
  reparent,
  resizeShape,
  sendToBack,
  setText,
} from "./ops";

const sh = (id: string, x: number, y: number, w: number, h: number, parent?: string): Shape => ({
  id,
  kind: "rectangle",
  x,
  y,
  w,
  h,
  label: "",
  style: DEFAULT_STYLE,
  ...(parent ? { parent } : {}),
});
const glue = (id: string, source: Connector["source"], target: Connector["target"]): Connector => ({
  id,
  source,
  target,
  routing: "straight",
  style: DEFAULT_STYLE,
});
const dia = (shapes: Shape[], connectors: Connector[] = []): Diagram => ({
  version: 1,
  shapes,
  connectors,
  texts: [],
});
const ok = (d: Diagram) => Diagram.parse(d);
const counter = (p: string) => {
  let n = 0;
  return () => `${p}${n++}`;
};

test("delete cascades and frees glued ends at the old border point", () => {
  const d = ok(
    dia(
      [sh("a", 0, 0, 100, 100), sh("b", 10, 10, 20, 20, "a"), sh("c", 300, 0, 100, 100)],
      [
        {
          ...glue(
            "k",
            { kind: "glued", shapeId: "a", arrow: true },
            { kind: "glued", shapeId: "c" },
          ),
        },
      ],
    ),
  );
  const expected = borderPoint(d.shapes[0] as Shape, { x: 350, y: 50 });
  const out = ok(deleteElements(d, ["a"]));
  expect(out.shapes.map((s) => s.id)).toEqual(["c"]);
  expect(out.connectors[0]?.source).toEqual({
    kind: "free",
    x: expected.x,
    y: expected.y,
    arrow: true,
  });
  expect(out.connectors[0]?.target).toEqual({ kind: "glued", shapeId: "c" });
  expect(d.shapes.length).toBe(3);
});

test("parentFor picks smallest container, never a descendant", () => {
  const d = ok(
    dia([
      sh("big", 0, 0, 500, 500),
      sh("mid", 50, 50, 200, 200),
      sh("small", 60, 60, 20, 20),
      sh("far", 400, 400, 20, 20),
    ]),
  );
  expect(parentFor(d, "small")).toBe("mid");
  expect(parentFor(d, "mid")).toBe("big");
  expect(parentFor(d, "big")).toBeUndefined();
  const nested = reparent(d, ["small", "mid", "far"]);
  expect(nested.shapes.find((s) => s.id === "small")?.parent).toBe("mid");
  expect(nested.shapes.find((s) => s.id === "mid")?.parent).toBe("big");
  ok(nested);
  // same-size shapes: once b is a's child, a cannot pick b
  const twins = reparent(dia([sh("a", 0, 0, 10, 10), sh("b", 0, 0, 10, 10)]), ["a", "b"]);
  expect(twins.shapes.find((s) => s.id === "a")?.parent).toBe("b");
  expect(twins.shapes.find((s) => s.id === "b")?.parent).toBeUndefined();
  ok(twins);
  // moving out clears parent
  const moved = moveElements(nested, ["small"], 1000, 0);
  const out = reparent(moved, ["small"]);
  expect("parent" in (out.shapes.find((s) => s.id === "small") as Shape)).toBe(false);
});

test("move shifts descendants once and free ends only", () => {
  const d = ok(
    dia(
      [sh("a", 0, 0, 100, 100), sh("b", 10, 10, 20, 20, "a")],
      [glue("k", { kind: "glued", shapeId: "a" }, { kind: "free", x: 5, y: 5 })],
    ),
  );
  const out = ok(moveElements(d, ["a", "b", "k"], 7, 3));
  expect(out.shapes.map((s) => [s.x, s.y])).toEqual([
    [7, 3],
    [17, 13],
  ]);
  expect(out.connectors[0]?.source.kind).toBe("glued");
  expect(out.connectors[0]?.target).toEqual({ kind: "free", x: 12, y: 8 });
  expect(d.shapes[0]?.x).toBe(0);
});

test("copy/paste remaps, frees outside glue, offsets, works cross-diagram", () => {
  const src = ok(
    dia(
      [sh("a", 0, 0, 100, 100), sh("b", 10, 10, 20, 20, "a"), sh("out", 300, 0, 50, 50)],
      [
        glue("in", { kind: "glued", shapeId: "a" }, { kind: "glued", shapeId: "b" }),
        glue("x", { kind: "glued", shapeId: "b" }, { kind: "glued", shapeId: "out" }),
        glue("f", { kind: "free", x: 1, y: 2 }, { kind: "free", x: 3, y: 4 }),
      ],
    ),
  );
  const clip = copy(src, ["a", "in", "x", "f"]);
  expect(clip.shapes.map((s) => s.id)).toEqual(["a", "b"]);
  expect(clip.connectors.find((c) => c.id === "x")?.target.kind).toBe("free");

  const dst = ok(dia([sh("holder", -50, -50, 400, 400)]));
  const { diagram, ids } = paste(dst, clip, counter("n"), 10);
  ok(diagram);
  expect(ids.length).toBe(5);
  expect(new Set(ids).size).toBe(5);
  const [a, b] = diagram.shapes.slice(1) as [Shape, Shape];
  expect(a.parent).toBe("holder");
  expect(b.parent).toBe(a.id);
  expect([a.x, a.y]).toEqual([10, 10]);
  const f = diagram.connectors.find((c) => c.source.kind === "free" && c.source.x === 11);
  expect(f?.target).toEqual({ kind: "free", x: 13, y: 14 });
  const inner = diagram.connectors.find(
    (c) => c.source.kind === "glued" && c.target.kind === "glued",
  );
  expect(inner?.source).toEqual({ kind: "glued", shapeId: a.id });
  expect(inner?.target).toEqual({ kind: "glued", shapeId: b.id });
  // pasting twice into the same diagram stays valid
  ok(paste(diagram, clip, counter("m")).diagram);
});

test("z-order among siblings and renderOrder", () => {
  const d = ok(
    dia([
      sh("c1", 10, 10, 5, 5, "p"),
      sh("p", 0, 0, 100, 100),
      sh("c2", 20, 20, 5, 5, "p"),
      sh("q", 200, 0, 5, 5),
    ]),
  );
  expect(renderOrder(d).map((s) => s.id)).toEqual(["p", "c1", "c2", "q"]);
  expect(renderOrder(bringToFront(d, ["p"])).map((s) => s.id)).toEqual(["q", "p", "c1", "c2"]);
  expect(renderOrder(sendToBack(d, ["c2"])).map((s) => s.id)).toEqual(["p", "c2", "c1", "q"]);
  expect(bringToFront(d, ["c1", "p"]).shapes.map((s) => s.id)).toEqual(["c2", "q", "c1", "p"]);
  expect(descendants(d, "p")).toEqual(new Set(["c1", "c2"]));
});

test("setText drops empty connector label", () => {
  const d = ok(
    dia(
      [],
      [{ ...glue("k", { kind: "free", x: 0, y: 0 }, { kind: "free", x: 1, y: 1 }), label: "hi" }],
    ),
  );
  expect("label" in (setText(d, "k", "") as Diagram).connectors[0]!).toBe(false);
  expect(setText(d, "k", "yo").connectors[0]?.label).toBe("yo");
});

test("reparent adopts contained shapes and releases ones left outside", () => {
  const inner = sh("inner", 20, 20, 100, 100);
  const leaf = sh("leaf", 30, 30, 20, 20, "inner");
  const free = sh("free", 200, 20, 40, 40);
  const box = sh("box", 0, 0, 300, 200);
  const d = reparent(dia([inner, leaf, free, box]), ["box"]);
  const parent = (x: Diagram, id: string) => x.shapes.find((s) => s.id === id)?.parent;
  expect(parent(d, "inner")).toBe("box");
  expect(parent(d, "free")).toBe("box");
  expect(parent(d, "leaf")).toBe("inner");
  expect(renderOrder(d).map((s) => s.id)).toEqual(["box", "inner", "leaf", "free"]);
  const shrunk = reparent(resizeShape(d, "box", { x: 0, y: 0, w: 150, h: 200 }), ["box"]);
  expect(parent(shrunk, "inner")).toBe("box");
  expect(parent(shrunk, "free")).toBeUndefined();
  expect(Diagram.safeParse(shrunk).success).toBe(true);
});
