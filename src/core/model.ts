import { z } from "zod";

export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

export const Point = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof Point>;

export const Style = z.object({
  fill: z.string(),
  stroke: z.string(),
  strokeWidth: z.number().min(0),
  fontSize: z.number().positive(),
  fontColor: z.string(),
  align: z.enum(["left", "center", "right"]),
});
export type Style = z.infer<typeof Style>;

export const DEFAULT_STYLE: Style = {
  fill: "#ffffff",
  stroke: "#000000",
  strokeWidth: 1,
  fontSize: 12,
  fontColor: "#000000",
  align: "center",
};

export const SHAPE_KINDS = [
  "rectangle",
  "rounded-rectangle",
  "ellipse",
  "diamond",
  "triangle",
  "parallelogram",
  "hexagon",
  "cylinder",
  "cloud",
] as const;
export const ShapeKind = z.enum(SHAPE_KINDS);
export type ShapeKind = z.infer<typeof ShapeKind>;

export const Shape = z.object({
  id: Id,
  kind: ShapeKind,
  x: z.number(),
  y: z.number(),
  w: z.number().min(0),
  h: z.number().min(0),
  label: z.string(),
  style: Style,
  parent: Id.optional(),
});
export type Shape = z.infer<typeof Shape>;

export const End = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("glued"), shapeId: Id, arrow: z.boolean().optional() }),
  z.object({
    kind: z.literal("free"),
    x: z.number(),
    y: z.number(),
    arrow: z.boolean().optional(),
  }),
]);
export type End = z.infer<typeof End>;

export const Connector = z.object({
  id: Id,
  source: End,
  target: End,
  routing: z.enum(["straight", "orthogonal"]),
  label: z.string().optional(),
  style: Style,
});
export type Connector = z.infer<typeof Connector>;

export const Text = z.object({
  id: Id,
  x: z.number(),
  y: z.number(),
  content: z.string(),
  style: Style,
});
export type Text = z.infer<typeof Text>;

export const Stroke = z.array(Point);
export type Stroke = z.infer<typeof Stroke>;

export const Ink = z.object({ strokes: z.array(Stroke) });
export type Ink = z.infer<typeof Ink>;

export const Diagram = z
  .object({
    version: z.literal(1),
    shapes: z.array(Shape),
    connectors: z.array(Connector),
    texts: z.array(Text),
  })
  .superRefine((d, ctx) => {
    const ids = new Set<string>();
    for (const el of [...d.shapes, ...d.connectors, ...d.texts]) {
      if (ids.has(el.id)) ctx.addIssue({ code: "custom", message: `duplicate id ${el.id}` });
      ids.add(el.id);
    }
    const parents = new Map(d.shapes.map((s) => [s.id, s.parent]));
    for (const s of d.shapes) {
      if (s.parent !== undefined && !parents.has(s.parent)) {
        ctx.addIssue({ code: "custom", message: `shape ${s.id} has unknown parent ${s.parent}` });
      }
    }
    for (const c of d.connectors) {
      for (const end of [c.source, c.target]) {
        if (end.kind === "glued" && !parents.has(end.shapeId)) {
          ctx.addIssue({
            code: "custom",
            message: `connector ${c.id} glued to unknown ${end.shapeId}`,
          });
        }
      }
    }
    for (const s of d.shapes) {
      const seen = new Set([s.id]);
      for (let p = s.parent; p !== undefined; p = parents.get(p)) {
        if (seen.has(p)) {
          ctx.addIssue({ code: "custom", message: `parent cycle at shape ${s.id}` });
          break;
        }
        seen.add(p);
      }
    }
  });
export type Diagram = z.infer<typeof Diagram>;

export const emptyDiagram = (): Diagram => ({ version: 1, shapes: [], connectors: [], texts: [] });
