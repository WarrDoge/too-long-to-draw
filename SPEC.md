# too-long-to-draw — Specification

A local, single-user diagram editor in the spirit of draw.io, built for architecture diagrams.
Its distinguishing feature is **draw mode**: sketch a diagram freehand, press Enter, and every
sketch is replaced by the closest clean shape or connector.

## 1. Toolchain and scripts

- TypeScript on Bun. `package.json` pins `"packageManager": "bun@1.3.14"`; `bun.lock` is committed.
- Dependencies: Preact 11, `@preact/signals` 2, Zod 4. Dev dependencies: TypeScript 7,
  `@types/bun`, `playwright-core`, Biome 2.
- `package.json` scripts:

  | Script  | Does                                                                          |
  |---------|-------------------------------------------------------------------------------|
  | `setup` | `bun install`; verify the Bun version matches the pin and `/usr/bin/chromium` exists |
  | `dev`   | `bun --hot src/server/main.ts`: one process serves the API and the frontend with HMR |
  | `start` | `NODE_ENV=production bun src/server/main.ts`; Bun bundles the frontend at startup |
  | `test`  | `bun test src`                                                                |
  | `e2e`   | `bun test e2e`                                                                |
  | `check` | `biome ci`, `tsc --noEmit` for the root, `src/core` and `src/web` projects, `bun run test` |
  | `bump`  | `bun upgrade`, then rewrite the `packageManager` pin to the installed version |

- No build step and no `dist/`. No CI. `bun run check` is the gate.
- `tsconfig.json` is `strict` with `noUncheckedIndexedAccess`.

## 2. Repository layout

One package:

| Path          | Contents                                                                   |
|---------------|----------------------------------------------------------------------------|
| `src/core/`   | Diagram model (Zod schemas), editing operations, geometry, stroke clustering, recognizer, snapping. Pure TS. |
| `src/web/`    | Editor UI (Preact + signals). `index.html` is the entry; `api.ts` is the typed API client. |
| `src/server/` | `startServer({ dir, port })` factory and `main.ts`, which calls it with `./diagrams` and `3000`. |
| `e2e/`        | Browser tests.                                                             |

`src/core` and `src/web` each have a `tsconfig.json` that extends the root one and sets
`types: []`. Core sets `lib: ["ES2023"]`, so any DOM or Bun API use fails `tsc`. Web sets
`lib: ["ES2023", "DOM", "DOM.Iterable"]`, so any Bun API use fails `tsc`. Both exclude
`*.test.ts`; the root project type-checks server code and all tests.

Unit and API tests sit next to their source as `*.test.ts`. Diagrams are stored in `./diagrams/`
(git-ignored).

## 3. Server

- `Bun.serve`, bound to `127.0.0.1` only. No auth: the app is local and single-user.
- The frontend is served by importing `src/web/index.html` as an HTML import on the `/*` route, so
  client routes such as `/d/{name}` get the page. In dev, `development.hmr` is on.
- Every `/api` request is rejected with 403 unless its `Host` is `127.0.0.1:<port>` or
  `localhost:<port>`, and its `Origin`, when present, is `http://127.0.0.1:<port>` or
  `http://localhost:<port>`. `<port>` is the actual bound port. This blocks cross-site requests
  and DNS rebinding from pages open in the same browser.
- REST API, JSON bodies typed by the `core` model:

  | Method   | Path                          | Action                                  |
  |----------|-------------------------------|-----------------------------------------|
  | `GET`    | `/api/diagrams`               | List diagram names + modified time      |
  | `GET`    | `/api/diagrams/:name`         | Load a diagram (with `ETag`)            |
  | `PUT`    | `/api/diagrams/:name`         | Create or overwrite a diagram (returns the new `ETag`) |
  | `POST`   | `/api/diagrams/:name/rename`  | Rename (body: `{ "name": "<new>" }`); refuses to overwrite an existing diagram (409) |
  | `DELETE` | `/api/diagrams/:name`         | Delete a diagram                        |

- Any other `/api/*` request gets 404, so it never falls through to the HTML route.
- Every error response is JSON `{ "error": string }`.
- Diagram names must match `^[A-Za-z0-9_-]{1,64}$`; anything else is rejected with 400, so no
  request can touch files outside the diagrams directory.
- `PUT` bodies and files read from disk are parsed with the `Diagram` Zod schema. An invalid body
  is rejected with 400; a corrupt file returns 500 instead of reaching the editor.
- Writes are atomic (write `<name>.json.tmp`, then rename) so a crash never leaves a truncated
  diagram.
- The `ETag` is a hash of the file bytes. A `PUT` with `If-Match` fails with 412 when the file's
  current `ETag` differs, so two tabs never silently overwrite each other. A `PUT` with
  `If-None-Match: *` fails with 412 when the diagram exists. A `PUT` with neither overwrites
  unconditionally.

## 4. Data model (`src/core`)

- Zod schemas are the single source of truth; TS types come from `z.infer`.
- `Id` is a string from `crypto.randomUUID()`. `src/core` has no `crypto` global, so core
  functions that create elements take an id factory (`newId: () => Id`) from the editor.
- Optional fields are omitted from the JSON when absent (never `null`).
- `Diagram { version: 1, shapes, connectors, texts }`, saved as JSON. Array order is z-order:
  later elements draw on top.
- `Shape { id, kind, x, y, w, h, label, style, parent?: Id }`.
- `ShapeKind`: `"rectangle" | "rounded-rectangle" | "ellipse" | "diamond" | "triangle" |
  "parallelogram" | "hexagon" | "cylinder" | "cloud"`, plus palette-only kinds added later as
  needed.
- `Connector { id, source: End, target: End, routing: "straight" | "orthogonal", label?, style }`.
- `End` is a tagged union: `{ kind: "glued", shapeId, arrow?: boolean }` or
  `{ kind: "free", x, y, arrow?: boolean }`. A glued end stores no position: it sits where the
  connector meets the shape's outline, recomputed on every render.
- `Text { id, x, y, content, style }` for free-standing labels.
- `Ink { strokes: Stroke[] }`, where `Stroke` is `{ x, y }[]` in diagram coordinates and array
  order is drawing order. It is the draw-mode input and the fixture format.
- `Style`: fill, stroke color, stroke width, font size, font color, text alignment.
- Defaults match draw.io's look: white fill, 1px black stroke, 12px sans-serif text.
- `Diagram` also checks references (`superRefine`): ids are unique across all elements, every
  `shapeId` and `parent` names an existing shape, and parents form no cycle.

## 5. Editor (`src/web`)

### Layout

draw.io-like:
- **Left:** diagram list (new / rename / delete) above a shape palette (drag onto canvas).
- **Top:** toolbar — select/draw mode, undo/redo, zoom, export.
- **Right:** style panel for the current selection.
- **Center:** SVG canvas.

Each diagram is addressable at `/d/{name}`. Routing is hand-rolled: read `location.pathname`,
navigate with `history.pushState`, listen to `popstate`. After a rename the URL is updated with
`history.replaceState`.

### State

- The open diagram is one `signal<Diagram>`, replaced with a new immutable value on each commit.
- In-progress interaction (drag, resize, box select, unconverted ink) lives in separate signals and
  is committed on `pointerup` or conversion.
- Undo/redo are stacks of `{ diagram, ink }` snapshots, so undoing a conversion restores the
  original ink.
- Every commit goes through a pure editing operation in `src/core`: `(Diagram, args) => Diagram`
  for move (with descendants), resize, delete (with cascade), reparent (the container rule),
  paste, z-order, style and text changes. The web code only maps input to operations. Rendering,
  SVG export and hit-testing share one core function for connector geometry,
  `connectorPath(diagram, connector)`. Editing logic is therefore unit-tested under `bun test`,
  and e2e tests cover only the wiring.
- Continuous inputs (color pickers, number fields) commit on `change`, not `input`, so one picker
  drag is one undo step.
- All server calls go through `api.ts`, whose signatures use the `core` types.

### Rendering and input

- SVG DOM rendering; browser hit-testing.
- Styles are SVG presentation attributes, not CSS classes, so the serialized canvas exports as-is.
- Pointer Events for mouse and pen. No touch gestures in v1.

### Editing features (v1)

- Select, move, resize, delete. Deleting a shape deletes its descendants; connector ends glued to
  it become free ends at their current position.
- Multi-select by box drag and Shift-click.
- Undo/redo.
- Copy/paste through an in-app clipboard, so it also works across diagrams in the same tab. Paste
  assigns new ids, remaps references inside the copied set, turns ends glued to shapes outside the
  set into free ends, and offsets the copy by one grid step.
- Grid with snap; zoom and pan.
- Fill and stroke color; z-order (bring to front / send to back) among a shape's siblings.
- **Containers:** when a shape is dropped, moved or converted, its parent becomes the smallest
  other shape that fully contains it, or none. A descendant is never chosen. Moving a container
  moves its descendants. A child always renders above its parent: rendering walks root shapes in
  array order, each followed by its children. A container's label sits top-left.
- **Connectors:** ends glue to shapes and reroute when shapes move. The palette's Connector item
  drops a straight arrow with free ends. Dragging an end of a selected connector onto a shape
  glues it; dragging it off unglues it. Draw mode also creates connectors. Routing is straight or
  orthogonal; orthogonal is a fixed elbow with one or two bends and no obstacle avoidance.

Out of scope for v1: rotation, groups (beyond containers), layers, alignment guides, pages,
themes, rich text.

### Text

Double-click works in both select and draw mode:
- On empty canvas: create a free text label at the cursor.
- On a shape: edit its centered label.
- On a connector: add or edit its label.

Text is plain and multi-line (Enter inserts a newline; click outside or Esc commits). Labels never
auto-wrap; each line renders as a `<tspan>`. Editing uses an HTML `<textarea>` overlay, not
`<foreignObject>`. While the overlay has focus, canvas shortcuts are off. Font size, color and
alignment come from the style panel. In draw mode, a click with no movement is not a stroke, so
double-click never leaves ink behind.

### Saving and export

- Autosave: debounced `PUT` about 1 s after the last change. A status dot shows saved, unsaved or
  error. Ctrl+S forces an immediate save.
- At most one `PUT` is in flight. A change during a save queues one follow-up save with the latest
  diagram, so responses can't land out of order and persist an older diagram.
- The pending save is flushed before a rename, before switching diagrams and on `pagehide`
  (`fetch` with `keepalive`). It is cancelled before a delete.
- Autosave sends `If-Match` with the last `ETag`; a new diagram is created with
  `If-None-Match: *`. On 412 the status dot shows a conflict and autosave stops. Ctrl+S then
  overwrites unconditionally; reloading discards the local changes.
- Export the diagram as SVG (serialized canvas without selection handles and grid) and PNG (2x,
  rendered via an offscreen canvas).
- Own JSON format only. `.drawio` export is a later addition; `.drawio` import is not planned.

## 6. Draw mode

### Controls

| Key    | Action                                                        |
|--------|---------------------------------------------------------------|
| `D`    | Toggle draw mode (also a toolbar button)                      |
| Enter  | Convert all unconverted ink                                   |
| Tab    | Right after Enter: cycle the most recently drawn shape of that conversion through its 2nd/3rd best matches |
| Esc    | Discard unconverted ink                                       |
| `V`    | Return to select mode                                         |
| Ctrl+Z | After a conversion: restore the original ink                  |
| Ctrl+Shift+E | Copy the unconverted ink to the clipboard as `Ink` JSON (fixture format) |

"Right after Enter" lasts until the next edit or key other than Tab. Tab steps change the
conversion in place and push no undo entry, so Ctrl+Z still restores the original ink. Tab and
Ctrl+S call `preventDefault`.

### Conversion pipeline (pure functions in `src/core`, called directly by the editor)

1. **Cluster strokes** by endpoint joins, in drawing order: a stroke joins a cluster when one of
   its endpoints lies near an open end of that cluster. A closed cluster accepts no more strokes.
   So a box drawn in several strokes merges, while nested boxes and a line that ends on a box stay
   separate. Then an open cluster whose two ends both land on the same closed cluster joins it
   (the body of a cylinder).
2. **Classify each cluster** as a closed shape, a line, or an arrowhead fragment. A short V-shaped
   stroke near a line end (same stroke or separate) becomes an arrowhead at that end; either or
   both ends may have one. Lines without a V stay plain lines.
3. **Recognize closed shapes** with a hybrid recognizer:
   - Primary: geometric features after resampling and RDP simplification — closure, corner count
     and angles, circularity, convex-hull ratios, parallel sides.
   - Tiebreaker: `$P` point-cloud matching against templates synthesized in code from ideal shapes
     with jitter, varied start points and stroke orders. The jitter comes from a seeded PRNG, so
     recognition is deterministic.
   - All thresholds live in one exported `TUNING` const object.
   - The recognizer always returns a ranked list; the top match is applied (a scribble becomes the
     closest shape), and the next two feed Tab cycling.
4. **Fit geometry:** the shape takes the cluster's bounding box, snapped to the grid. Near-square
   becomes square, near-circle becomes circle, near-horizontal/vertical lines straighten, and
   nearby shapes align with each other.
5. **Resolve structure:** converted shapes get parents by the container rule (§5). Shapes are
   placed before lines; a line end that lands near a shape border, existing or just converted,
   becomes a glued end.

### Recognized set

Rectangle, rounded rectangle, ellipse/circle, diamond, triangle, parallelogram, hexagon,
cylinder, cloud, line, arrow. Cylinder and cloud are the hardest to separate from the ellipse and
are delivered last.

## 7. Testing

All tests run on `bun test`.

- **`src/core`:** recognizer accuracy tests over synthetic shapes and hand-drawn fixture strokes,
  each shape kind with a minimum accuracy floor; geometry, clustering and snapping tests; model
  tests that round-trip diagrams through the Zod schemas and reject malformed ones, including
  dangling references and parent cycles; editing-operation tests (cascade delete, reparenting,
  paste remap, connector geometry). Fixtures live in `src/core/fixtures/<kind>/*.json`: the
  directory names the expected kind, and the content is `Ink` JSON pasted from Ctrl+Shift+E and
  parsed with the `Ink` schema on load.
- **`src/server`:** API tests through `startServer({ dir, port: 0 })` with a temporary diagrams
  directory, including name-validation rejection, Host/Origin rejection, invalid-body rejection,
  rename collision, corrupt-file 500, unknown-route 404 and `If-Match` / `If-None-Match` 412.
- **`e2e`:** `playwright-core` launches `/usr/bin/chromium` headless with `--no-sandbox` (no
  chromedriver, no browser download); `startServer` runs in-process with a temporary directory.
  Tests sketch shapes with `page.mouse` pointer actions, press Enter, and assert the resulting SVG
  shapes and connectors; double-click text; autosave round-trip.
- Spike first: before building the e2e suite, confirm that `startServer` serves its HTML import
  inside `bun test`. Every e2e test depends on it.
