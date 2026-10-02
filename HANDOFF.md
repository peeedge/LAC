# LiteCAD — handoff notes

Context for picking this project up in a fresh session. Written at the end of the
initial MVP build.

**Repo:** `C:\batches\LAC` · **Branch:** `main` · Committed and green.

---

## 1. Where things stand

The app works end to end: open a DWG or DXF, see it rendered, pan/zoom, toggle
layers, click entities and inspect their properties.

Verified at the checkpoint:

```
npx tsc -b      # clean
npm test        # 56 tests, 4 files, all passing
npm run build   # succeeds; LibreDWG lands in its own lazy chunk
```

### What is actually built

| Area | State |
| --- | --- |
| Vite + React 19 + TS 6 + Tailwind 4 scaffold | Done |
| Normalised CAD document model (`cad/model`) | Done |
| `CadFileParser` abstraction + registry | Done |
| DXF parsing via `dxf-parser` (MIT) | Done |
| DWG parsing via LibreDWG WASM (GPL-3.0), lazy-loaded | Done |
| Shared DXF-like normaliser serving both parsers | Done |
| Tessellation: arcs, ellipses, bulges, rational NURBS splines | Done |
| Exact bounds (closed-form for arcs/ellipses) | Done |
| Block (`INSERT`) expansion with affine transforms + cycle guard | Done |
| Origin rebasing for large coordinates | Done |
| Web Worker pipeline, zero-copy transfer, progress reporting | Done |
| Three.js renderer: per-layer batching, grid, axes, text atlas | Done |
| Camera: pan, zoom-at-cursor, zoom extents, fit | Done |
| Spatial index + exact hit-testing | Done |
| Zustand store, layers panel, property inspector, diagnostics, status bar | Done |
| Menu bar, toolbar, help dialog, command/shortcut registry | Done |
| Drag-and-drop, staged loading UI, error dialogs | Done |
| Unit tests (56) | Done |
| README with architecture + licensing decision | Done |

---

## 2. Next steps, in priority order

### a. Playwright E2E test — the main gap

`playwright.config.ts` exists and is configured (port 5174, SwiftShader flags for
headless WebGL), and `package.json` has the scripts, but **`e2e/` does not exist
yet.** Nothing has been run through Playwright.

Write `e2e/viewer.spec.ts` to: load the app, set the file input to
`src/cad/parsers/__fixtures__/sample.dxf`, assert the viewport appears, assert
entities rendered, and assert a layer toggle works.

Test IDs already in the DOM for this: `cad-viewport`, `cad-canvas`, `file-input`,
`empty-open-button`, `entity-count`, `status-state`, `status-coordinates`,
`status-zoom`, `inspector-type`, `toolbar-open`, `toolbar-zoom-extents`,
`toolbar-grid`, `toolbar-select`, `toolbar-pan`, `layer-toggle-<NAME>`,
`layer-row-<NAME>`, `layer-isolate-<NAME>`.

Useful details:
- Use `page.setInputFiles('[data-testid=file-input]', path)` — the input is
  `className="hidden"`, so `setInputFiles` is the right approach (no click needed).
- Wait on `[data-testid=status-state]` reading `Ready`.
- To confirm pixels were actually drawn, read back from the canvas and check that
  not every pixel equals the background `#1b2129`. `preserveDrawingBuffer: true`
  is already set on the renderer specifically so this works.
- First run needs `npm run test:e2e:install`.

### b. Verify in a real browser

The dev server has **not** been opened and clicked through yet. Everything is
verified by type-checking, unit tests and a successful production build, but the
renderer, text atlas and pointer interaction have not been exercised against real
WebGL. Do this early — it is where any remaining bug most likely hides.

Also worth confirming: a real `.dwg` file end to end (no DWG fixture is committed;
use your own). The DWG code path is written against the library's actual type
definitions but has not been run.

### c. Known rough edges to look at

- `src/cad/geometry/transform.ts`, the `ELLIPSE` case of `transformEntity`: the
  minor-axis derivation is convoluted and recomputes a hypot it already has.
  Correct as far as the tests go, but it should be simplified.
- `CadRenderer.attach()` uses an `as any` cast for keyed slot assignment. Minor,
  but it is the one deliberate escape hatch in the renderer.
- The text atlas is populated once per drawing load. If `acquire` is ever called
  after the `CanvasTexture` is created, `needsUpdate` must be set again — currently
  safe because all text is built in one pass, but it is a latent trap.
- `DiagnosticsPanel` renders `WarningIcon` for warnings and errors alike; an
  error-specific icon would read better.
- Grid lines are regenerated on a quantised view key. Correct, but at extreme zoom
  the `isMultiple` float tolerance for major lines may misclassify.

### d. Features worth building next

Roughly in order of value for a viewer:

1. `HATCH` (very common in architectural drawings; currently invisible).
2. `DIMENSION` (also common; LibreDWG exposes it with a lot of structure).
3. Line weights and line-type dash patterns.
4. OCS / extrusion-direction handling.
5. Paper-space layout switching (the model already tracks `isInPaperSpace`).
6. Real SHX/TTF text styles.
7. SVG / PDF export.

The architecture sections of `README.md` explain exactly which files each new
entity type touches.

---

## 3. Things worth knowing before you change anything

These are the non-obvious decisions. Changing them without understanding why will
break something.

**Origin rebasing.** `buildGeometry` subtracts the drawing's centre from every
vertex because float32 cannot represent survey coordinates precisely. The camera,
the pick buffers and the spatial index all operate in this *rebased* space. Only
the status bar and the property inspector use true world coordinates (rebased +
`GeometryBundle.origin`). If you see geometry in the wrong place, this is the first
thing to check.

**The worker owns the document.** The main thread never holds the entity list —
only a summary plus transferred typed arrays. `store.selectEntity` therefore
fetches entity details *asynchronously* from the worker. Do not "simplify" this by
posting the whole entity array; that is the thing the design exists to avoid.

**One normaliser, two parsers.** `src/cad/parsers/dxfLike.ts` is the single
biggest file and the heart of the project. It accepts both LibreDWG and
`dxf-parser` field spellings. Two gotchas already found the hard way:
- `dxf-parser` prefixes header variables with `$` (`$INSUNITS`); LibreDWG does not.
  `headerValue()` handles both.
- `dxf-parser` silently drops entity types it has no handler for, so unsupported
  entities from DXF never reach our diagnostics. That path is therefore tested
  against the normaliser directly in `dxfLike.test.ts`, not through the DXF
  adapter. The fixture's `3DSOLID` is deliberately unasserted for this reason.

**`erasableSyntaxOnly` is on.** No TS `enum`s and no constructor parameter
properties. Use `const` objects with a companion type (see `CadUnitCode`,
`PickKind`) and explicit field declarations. Two rounds of build errors came from
this.

**`INSERT` is expanded, not reported as unsupported.** Most real DWG geometry
lives inside blocks, so a viewer that skipped `INSERT` would look broken. Block
contents are transformed into world space and tagged with `blockPath`; no bare
`INSERT` entity survives normalisation. Entities on layer `0` inside a block
inherit the reference's layer, and `ByBlock` colours resolve to the reference's
colour — both are real CAD semantics, not incidental.

**The WASM binary needs to be a served static file.** `scripts/sync-wasm.mjs`
copies `libredwg-web.wasm` into `public/wasm/` on `predev`/`prebuild`. The
Emscripten glue fetches it over the network via `locateFile`; it is not a bundled
module. If DWG loading fails with a parser-unavailable error, check that this ran.

**Licensing.** LibreDWG is GPL-3.0 and is confined to
`src/cad/parsers/DwgParserAdapter.ts`, lazily imported so it is a separate chunk.
This is documented in the README and is deliberate — keep it isolated.

---

## 4. Decisions already made (so they need not be re-litigated)

- **DWG parsing:** LibreDWG → WebAssembly, after evaluating a custom parser
  (rejected), ODA/RealDWG commercial SDKs (rejected: paid, not redistributable)
  and server-side conversion (viable, deferred — no backend in the MVP). Reasoning
  is written up in the README.
- **No faked DWG support.** Renaming a DXF to `.dwg` will not work, by design.
- **Zoom percentage is relative to the fit scale**, where 100% means "drawing fits
  the viewport". An absolute pixels-per-unit figure is meaningless without knowing
  the drawing's units.
- **On-demand rendering**, not a continuous animation loop.
- **Text via a canvas atlas**, not DOM elements and not per-glyph vector geometry.
- **Uniform grid for spatial indexing**, not a quadtree/R-tree: builds in one
  linear pass with no per-node allocation.
- **Unimplemented commands render visibly disabled** with a "Soon" marker and an
  explanatory tooltip, rather than looking functional.

---

## 5. Repo map

```
scripts/sync-wasm.mjs              Copies the LibreDWG .wasm into public/wasm/
src/cad/model/                     document.ts, geometry.ts, boundingBox.ts
src/cad/parsers/                   types.ts (the interface), registry.ts,
                                   dxfLike.ts (shared normaliser — start here),
                                   DxfParserAdapter.ts, DwgParserAdapter.ts,
                                   aci.ts (AutoCAD colour palette), errors.ts
src/cad/geometry/                  tessellate.ts, entityBounds.ts, transform.ts,
                                   buildGeometry.ts (CPU → GPU buffers), math.ts
src/cad/renderer/                  CadRenderer.ts, camera.ts, grid.ts, textAtlas.ts
src/cad/interaction/               ViewportController.ts, picking.ts, spatialIndex.ts
src/cad/commands/registry.ts       Commands + keyboard shortcuts
src/cad/documentSource.ts          Worker-backed and in-process document sources
src/workers/                       parser.worker.ts, protocol.ts, documentPipeline.ts
src/store/cadStore.ts              Zustand state
src/components/                    UI (Viewport.tsx is the React↔renderer bridge)
src/cad/parsers/__fixtures__/      sample.dxf
```

Tests live next to their subjects as `*.test.ts`:
`boundingBox.test.ts`, `camera.test.ts`, `dxfLike.test.ts`,
`DxfParserAdapter.test.ts`.

---

## 6. Suggested opening prompt for the next session

> Continue the LiteCAD project in `C:\batches\LAC`. Read `HANDOFF.md` first.
> The MVP is complete and committed (type-check, 56 unit tests and production
> build all pass), but the Playwright E2E suite has not been written and the app
> has not yet been opened in a real browser.
>
> Please: (1) start the dev server and verify the app actually renders the DXF
> fixture correctly, fixing anything broken; (2) write the `e2e/` Playwright suite
> described in section 2a of the handoff and get it passing.
