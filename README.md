# LiteCAD

A lightweight, browser-based 2D CAD **viewer** for AutoCAD DWG and DXF drawings.

Upload a drawing, and LiteCAD parses it and renders its geometry in a WebGL
viewport with pan/zoom, layer control, entity selection and a property inspector.
It is not a clone of AutoCAD — it is a clean MVP with an architecture meant to
grow into an editor.

> **Status: initial MVP.** Viewing works end to end. Editing, drawing commands and
> file export are not implemented; see [Known limitations](#known-limitations).

---

## Install, run, build

Requires Node 20.19+ (or 22+) and npm.

```bash
npm install     # also copies the LibreDWG .wasm into public/wasm/
npm run dev     # http://localhost:5173
npm run build   # type-check + production bundle into dist/
npm run preview # serve the production build
```

Other scripts:

| Script | Purpose |
| --- | --- |
| `npm test` | Vitest unit suite |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run test:e2e:install` | One-time Chromium download for Playwright |
| `npm run sync:wasm` | Re-copy the LibreDWG WebAssembly binary |
| `npm run lint` | oxlint |

`npm run sync:wasm` runs automatically before `dev` and `build`. It copies
`libredwg-web.wasm` from `node_modules` into `public/wasm/`, because the
Emscripten glue resolves that binary over the network at runtime rather than as a
bundled module.

---

## Supported CAD formats

| Format | Parser | Licence | Notes |
| --- | --- | --- | --- |
| `.dxf` | [`dxf-parser`](https://github.com/gdsestimating/dxf-parser) | MIT | ASCII DXF. The recommended format. |
| `.dwg` | [`@mlightcad/libredwg-web`](https://github.com/mlightcad/libredwg-web) (LibreDWG → WebAssembly) | **GPL-3.0** | Real DWG parsing in the browser. Loaded on demand. |

Entity types rendered today: `LINE`, `POLYLINE`, `LWPOLYLINE` (including bulge
arcs), `CIRCLE`, `ARC`, `ELLIPSE`, `SPLINE` (rational NURBS), `POINT`, `TEXT`,
`MTEXT`, `SOLID`, `3DFACE`, and `INSERT` (expanded into its block's geometry).

Anything else is reported in the diagnostics panel — e.g.
`Unsupported entity: 3DSOLID` — rather than silently dropped or crashing the
import.

---

## DWG parsing approach

DWG is a closed, undocumented, frequently-revised format. The options were
evaluated as follows:

1. **Write our own DWG parser.** Rejected. Reverse-engineering DWG is a
   multi-year effort and explicitly out of scope.
2. **Commercial SDK (Open Design Alliance, Autodesk RealDWG).** Technically the
   most complete option, and what most commercial viewers use. Rejected for an
   MVP: both require paid membership/licensing and neither is freely
   redistributable.
3. **Server-side conversion** (e.g. ODA File Converter, LibreDWG CLI, converting
   DWG → DXF before it reaches the browser). Viable and still the best path for
   maximum format coverage, but it requires infrastructure that an MVP does not
   have.
4. **LibreDWG compiled to WebAssembly.** ✅ **Chosen.** GNU LibreDWG is a mature
   open-source DWG reader, and `@mlightcad/libredwg-web` is an actively
   maintained WASM build of it with TypeScript definitions. This gives genuine,
   fully client-side DWG parsing with no backend and no per-seat licence.

**No DWG support is faked.** Renaming a DXF to `.dwg` will not work; the DWG path
runs real LibreDWG code.

### The licensing caveat — please read

**LibreDWG is GPL-3.0.** If you distribute LiteCAD with DWG support enabled, the
GPL's terms apply to the distributed work. That is a deliberate, documented
trade-off for the MVP, and the architecture is built so it can be reversed:

- The dependency is confined to `src/cad/parsers/DwgParserAdapter.ts`.
- It is `import()`-ed lazily, so it is a separate bundle chunk that is never
  downloaded unless a user actually opens a DWG.
- Everything else — the document model, geometry pipeline, renderer and UI — is
  licence-clean and only knows about the `CadFileParser` interface.

To ship a permissively-licensed build, delete that one adapter from the registry
in `src/cad/parsers/registry.ts` and plug in a commercial SDK or a server-side
conversion endpoint. See [Replacing the parser](#replacing-the-parser).

---

## Architecture

The guiding rule: **React never touches CAD data structures, and CAD code never
imports React.**

```
src/
  cad/
    model/         Normalised, format-independent document model
    parsers/       CadFileParser implementations + the shared DXF-like normaliser
    geometry/      Tessellation, transforms, bounds, GPU buffer building
    renderer/      Three.js renderer, camera, grid, text atlas
    interaction/   Pan/zoom controller, spatial index, hit-testing
    commands/      Command + keyboard shortcut registry
  components/      React UI
  store/           Zustand application state
  workers/         Parsing worker, its message protocol, and the pipeline
  hooks/
```

### Data flow

```
File
 └─ WorkerDocumentSource ──postMessage──► parser.worker.ts
                                            │
                                 CadFileParser.parse()        (DWG or DXF)
                                            │
                                 normaliseDxfLike()           → CadDocument
                                            │
                                 buildGeometry()              → typed arrays
                                            │
      summary + transferred buffers ◄───────┘
        │
        ├─► Zustand store  (layers, selection, metadata — small, React-friendly)
        └─► CadRenderer    (GPU buffers, one batch per layer)
```

Four decisions carry most of the weight:

**1. The parser abstraction.** Every format implements one interface:

```ts
interface CadFileParser {
  parse(file: File, options?: ParseOptions): Promise<CadDocument>;
}
```

Both parsers emit DXF-flavoured records (LibreDWG models the DWG database using
DXF group-code semantics), so a single normaliser — `src/cad/parsers/dxfLike.ts`
— serves both. It accepts either field spelling (`startPoint` vs `vertices[0]`,
`knots` vs `knotValues`, `POLYLINE2D` vs `POLYLINE`).

**2. The worker owns the document.** The UI thread receives a small summary plus
*transferred* (zero-copy) typed arrays — never the entity list. Structured-cloning
a million entity objects would block the main thread for seconds. Details for the
*selected* entity are fetched on demand. This is why load time is independent of
entity count.

**3. Origin rebasing.** CAD drawings often sit at survey coordinates in the
millions, and WebGL vertex attributes are 32-bit floats (~7 significant digits),
which causes visible jitter and collapsed geometry. `buildGeometry` subtracts the
drawing's centre from every vertex and the camera works in that rebased space;
the offset is added back only for display. See `GeometryBundle.origin`.

**4. Batching by layer.** All geometry on a layer is merged into one buffer, so a
500k-entity drawing issues a handful of draw calls, and layer visibility is one
`visible` flag per batch. No CAD entity is ever a DOM element or a React
component.

### Performance notes

- Parsing, tessellation and buffer building all happen off the main thread.
- A growable `Float32Array` (not `number[]`) accumulates vertices.
- Hit-testing uses a uniform-grid spatial index built in one linear pass, in
  CSR layout with no per-cell objects.
- Rendering is on-demand (`requestRender`), not a continuous `requestAnimationFrame`
  loop, so a static drawing costs zero GPU time.
- Pan, zoom and cursor tracking mutate the camera and DOM directly rather than
  going through React state.
- Text is rasterised once per unique string into a shared atlas texture, giving
  one draw call per layer.

---

## Extending LiteCAD

### Adding a CAD entity type

Say you want `LEADER`:

1. **Geometry type** — add an interface to `src/cad/model/geometry.ts` and include
   it in the `CadGeometry` union.
2. **Entity type** — add `'LEADER'` to `CAD_ENTITY_TYPES` in
   `src/cad/model/document.ts` and map it in `GeometryForEntity`.
3. **Parsing** — add a converter to the `CONVERTERS` table in
   `src/cad/parsers/dxfLike.ts` (and an alias in `TYPE_ALIASES` if the source name
   differs). Return `undefined` for unusable input; the caller records a diagnostic.
4. **Bounds** — add a case to `computeEntityBounds` in
   `src/cad/geometry/entityBounds.ts`.
5. **Tessellation** — if it is curved, add a function to
   `src/cad/geometry/tessellate.ts`.
6. **Rendering** — add the type to `POLYLINE_TYPES` in
   `src/cad/geometry/buildGeometry.ts` (if it draws as a polyline) or handle it
   explicitly there.
7. **Transforms** — add a case to `transformEntity` in
   `src/cad/geometry/transform.ts` so it survives block expansion.
8. **Inspector** — add a row renderer in `src/components/PropertiesPanel.tsx`.

Steps 1–4 are the minimum to load it without warnings; 5–6 make it visible.

### Replacing the parser

Implement `CadFileParser` and register it:

```ts
// src/cad/parsers/MyDwgServiceAdapter.ts
export class MyDwgServiceAdapter implements CadFileParser {
  readonly id = 'dwg-service';
  readonly label = 'DWG conversion service';
  readonly extensions = ['dwg'] as const;
  readonly isAvailable = () => true;

  async parse(file: File, options?: ParseOptions): Promise<CadDocument> {
    // POST the file to a backend that returns DXF, then reuse normaliseDxfLike().
  }
}
```

Then swap the entry in `src/cad/parsers/registry.ts`. Nothing in the UI, store,
geometry pipeline or renderer changes — they only know the interface.

### Adding a command or shortcut

Add an entry to `COMMANDS` in `src/cad/commands/registry.ts`, then supply a
handler in the `handlers` map in `src/App.tsx`. The menu bar, toolbar, help dialog
and keyboard dispatch all read from the registry, so they stay in sync. Commands
marked `notImplemented` render visibly disabled rather than appearing functional.

---

## Controls

| Input | Action |
| --- | --- |
| `Ctrl`/`Cmd` + `O` | Open drawing |
| `F` | Zoom extents |
| `G` | Toggle grid |
| `S` | Toggle snap |
| `D` | Toggle diagnostics panel |
| `1` / `2` | Select tool / Pan tool |
| `Esc` | Clear selection |
| `Delete` | Reserved for future editing |
| Mouse wheel | Zoom at cursor |
| Middle-drag / right-drag | Pan |
| Left-click | Select entity |
| `Shift`/`Ctrl` + click | Add to / remove from selection |
| Double-click | Zoom extents |

---

## Testing

```bash
npm test                   # unit suite
npm run test:e2e:install   # once
npm run test:e2e           # Playwright
```

Unit tests cover the bounding-box maths, camera and coordinate transforms, the
tessellator, layer visibility rules, block expansion (including self-referential
blocks), colour resolution, the parser adapter against a real DXF fixture, and
error handling for empty and corrupt files.

The DXF fixture at `src/cad/parsers/__fixtures__/sample.dxf` is a hand-written
ASCII DXF exercising each supported entity type. **No DWG fixture is committed**:
the WASM build of LibreDWG is read-only so one cannot be generated, and shipping a
third-party DWG would raise licensing questions. Test the DWG path with your own
files.

---

## Known limitations

- **Read-only.** No drawing, editing, or saving. `Save As` is a visible
  placeholder.
- **Model space only.** Paper-space layouts are skipped.
- **2D only.** Z coordinates are preserved in the model but ignored when drawing.
- **No `HATCH`, `DIMENSION`, `LEADER`, or 3D solids.** They appear in diagnostics.
- **Text is approximate.** Rendered with a system sans-serif rather than the
  drawing's SHX/TTF style; widths and MTEXT layout are estimates, and inline
  formatting is stripped to plain text.
- **No line weights or line-type dash patterns.** Everything draws 1px solid.
- **OCS/extrusion directions are ignored**, so entities on a non-world
  construction plane may be misplaced.
- **DWG coverage is LibreDWG's coverage.** Very new or unusual DWG revisions may
  fail; the error dialog suggests exporting to DXF.
- **Text rendering is capped** at 20,000 runs per drawing.
- DWG support pulls in a ~9.5 MB WebAssembly binary on first use.

---

## Licence

Application code: MIT.

Note the GPL-3.0 implication of bundling the DWG parser, described in
[the licensing caveat](#the-licensing-caveat--please-read).
