import { expect, test } from "bun:test";
import { DEFAULT_STYLE, Diagram, type Shape } from "./model";

const shape = (id: string, parent?: string): Shape => ({
  id,
  kind: "rectangle",
  x: 0,
  y: 0,
  w: 120,
  h: 60,
  label: "",
  style: DEFAULT_STYLE,
  ...(parent ? { parent } : {}),
});

const valid: Diagram = {
  version: 1,
  shapes: [shape("a"), shape("b", "a")],
  connectors: [
    {
      id: "c",
      source: { kind: "glued", shapeId: "a" },
      target: { kind: "free", x: 300, y: 40, arrow: true },
      routing: "straight",
      style: DEFAULT_STYLE,
    },
  ],
  texts: [{ id: "t", x: 10, y: 10, content: "hi", style: DEFAULT_STYLE }],
};

test("round-trips through JSON and omits absent optional fields", () => {
  const json = JSON.stringify(Diagram.parse(valid));
  expect(Diagram.parse(JSON.parse(json))).toEqual(valid);
  expect(json).not.toContain("null");
  expect(json).not.toContain('"label"'.concat(":null"));
  expect(Object.hasOwn(Diagram.parse(valid).shapes[0]!, "parent")).toBe(false);
});

test("rejects malformed diagrams", () => {
  expect(Diagram.safeParse({ ...valid, version: 2 }).success).toBe(false);
  expect(Diagram.safeParse({ ...valid, shapes: [{ ...shape("a"), kind: "star" }] }).success).toBe(
    false,
  );
  expect(Diagram.safeParse({ ...valid, texts: [{ id: "t" }] }).success).toBe(false);
  expect(Diagram.safeParse({ ...valid, shapes: [{ ...shape("a"), parent: null }] }).success).toBe(
    false,
  );
});

test("rejects duplicate ids across element arrays", () => {
  const d = { ...valid, texts: [{ ...valid.texts[0]!, id: "a" }] };
  expect(Diagram.safeParse(d).success).toBe(false);
});

test("rejects dangling references", () => {
  expect(Diagram.safeParse({ ...valid, shapes: [shape("a"), shape("b", "zz")] }).success).toBe(
    false,
  );
  const c = { ...valid.connectors[0]!, target: { kind: "glued", shapeId: "zz" } };
  expect(Diagram.safeParse({ ...valid, connectors: [c] }).success).toBe(false);
});

test("rejects parent cycles", () => {
  expect(Diagram.safeParse({ ...valid, shapes: [shape("a", "b"), shape("b", "a")] }).success).toBe(
    false,
  );
  expect(Diagram.safeParse({ ...valid, shapes: [shape("a", "a")] }).success).toBe(false);
});
