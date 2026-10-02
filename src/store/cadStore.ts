/**
 * Application state.
 *
 * Deliberately holds only what the UI renders: the document *summary*, layer
 * flags, selection and view toggles. The entity list, geometry buffers and
 * parsed document live in the worker and the renderer respectively, which is why
 * loading a 500k-entity drawing does not make React slower.
 *
 * The geometry bundle is kept here as an opaque reference so the viewport can
 * pick it up, but nothing subscribes to its contents.
 */

import { create } from 'zustand';
import type { GeometryBundle } from '../cad/geometry/buildGeometry';
import type { CadLayer } from '../cad/model/document';
import { createDocumentSource, type CadDocumentSource } from '../cad/documentSource';
import { CadParseError, toCadParseError, type CadParseErrorDetails } from '../cad/parsers/errors';
import type { ParseProgress } from '../cad/parsers/types';
import { saveDrawingCopy } from '../cad/saveDrawing';
import type { CadDocumentSummary, CadEntitySnapshot } from '../workers/protocol';
import type { ViewportTool } from '../cad/interaction/ViewportController';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CadState {
  // --- Document ---
  status: LoadStatus;
  summary: CadDocumentSummary | null;
  geometry: GeometryBundle | null;
  /** Original bytes retained for lossless Save As; not a serialised CAD model. */
  sourceFile: File | null;
  error: CadParseErrorDetails | null;
  progress: ParseProgress | null;

  // --- Layers ---
  layers: CadLayer[];

  // --- Selection ---
  /** Ordinal positions into the document's entity list. */
  selection: number[];
  /** Resolved details for the most recently selected entity. */
  inspected: CadEntitySnapshot | null;
  inspectedLoading: boolean;

  // --- View ---
  tool: ViewportTool;
  gridVisible: boolean;
  snapEnabled: boolean;
  /** Cursor position in true world coordinates. */
  cursor: { x: number; y: number } | null;
  /** Zoom as a percentage of the "fits the viewport" scale. */
  zoomPercent: number;

  // --- Panels ---
  diagnosticsOpen: boolean;

  // --- Actions ---
  openFile(file: File): Promise<void>;
  saveDrawing(): void;
  closeDrawing(): void;
  setLayerVisible(layerId: string, visible: boolean): void;
  setAllLayersVisible(visible: boolean): void;
  isolateLayer(layerId: string): void;
  toggleLayerLocked(layerId: string): void;
  selectEntity(entityIndex: number | null, additive?: boolean): void;
  clearSelection(): void;
  setTool(tool: ViewportTool): void;
  toggleGrid(): void;
  toggleSnap(): void;
  setCursor(position: { x: number; y: number } | null): void;
  setZoomPercent(value: number): void;
  toggleDiagnostics(): void;
  dismissError(): void;
}

/**
 * The document source is module-level rather than part of the store: it owns a
 * Worker, which is not serialisable state and must survive store updates.
 */
let documentSource: CadDocumentSource | null = null;

function getDocumentSource(): CadDocumentSource {
  documentSource ??= createDocumentSource();
  return documentSource;
}

/** Replaces the source, used to recover after a worker-level failure. */
function resetDocumentSource(): void {
  documentSource?.dispose();
  documentSource = null;
}

/** Monotonic token so a slow load cannot overwrite a newer one. */
let loadToken = 0;

export const useCadStore = create<CadState>((set, get) => ({
  status: 'idle',
  summary: null,
  geometry: null,
  sourceFile: null,
  error: null,
  progress: null,
  layers: [],
  selection: [],
  inspected: null,
  inspectedLoading: false,
  tool: 'select',
  gridVisible: true,
  snapEnabled: false,
  cursor: null,
  zoomPercent: 100,
  diagnosticsOpen: false,

  async openFile(file) {
    const token = ++loadToken;

    set({
      status: 'loading',
      error: null,
      progress: { stage: 'reading', message: 'Opening drawing…' },
      selection: [],
      inspected: null,
      sourceFile: null,
    });

    try {
      const { summary, geometry } = await getDocumentSource().load(file, (progress) => {
        // Ignore progress from a superseded load.
        if (token === loadToken) set({ progress });
      });

      if (token !== loadToken) return;

      set({
        status: 'ready',
        summary,
        geometry,
        sourceFile: file,
        // Copied so layer toggles never mutate the worker's summary object.
        layers: summary.layers.map((layer) => ({ ...layer })),
        progress: { stage: 'done', message: 'Ready' },
        error: null,
        // Surface the diagnostics panel when something needed attention.
        diagnosticsOpen: summary.diagnostics.some((entry) => entry.severity !== 'info'),
      });
    } catch (error) {
      if (token !== loadToken) return;

      const parseError =
        error instanceof CadParseError ? error : toCadParseError(error);
      console.error('[LiteCAD] open failed', error);

      // A failed worker is unusable; drop it so the next attempt gets a fresh one.
      if (parseError.code === 'unknown') resetDocumentSource();

      set({
        status: 'error',
        error: parseError.toDetails(),
        progress: null,
        summary: null,
        geometry: null,
        sourceFile: null,
        layers: [],
      });
    }
  },

  saveDrawing() {
    const file = get().sourceFile;
    if (file) saveDrawingCopy(file);
  },

  closeDrawing() {
    loadToken += 1;
    resetDocumentSource();
    set({
      status: 'idle',
      summary: null,
      geometry: null,
      sourceFile: null,
      layers: [],
      selection: [],
      inspected: null,
      error: null,
      progress: null,
      diagnosticsOpen: false,
    });
  },

  setLayerVisible(layerId, visible) {
    set({
      layers: get().layers.map((layer) =>
        layer.id === layerId ? { ...layer, visible } : layer,
      ),
    });
  },

  setAllLayersVisible(visible) {
    set({ layers: get().layers.map((layer) => ({ ...layer, visible })) });
  },

  isolateLayer(layerId) {
    set({
      layers: get().layers.map((layer) => ({ ...layer, visible: layer.id === layerId })),
    });
  },

  toggleLayerLocked(layerId) {
    set({
      layers: get().layers.map((layer) =>
        layer.id === layerId ? { ...layer, locked: !layer.locked } : layer,
      ),
    });
  },

  selectEntity(entityIndex, additive = false) {
    if (entityIndex === null) {
      if (!additive) get().clearSelection();
      return;
    }

    const current = get().selection;
    let next: number[];

    if (additive) {
      // Toggle: clicking an already-selected entity removes it.
      next = current.includes(entityIndex)
        ? current.filter((index) => index !== entityIndex)
        : [...current, entityIndex];
    } else {
      next = [entityIndex];
    }

    set({ selection: next });

    const last = next.at(-1);
    if (last === undefined) {
      set({ inspected: null, inspectedLoading: false });
      return;
    }

    // Entity details live in the worker, so inspection is asynchronous.
    set({ inspectedLoading: true });
    void getDocumentSource()
      .getEntity(last)
      .then((snapshot) => {
        // Discard if the selection moved on while we were waiting.
        if (get().selection.at(-1) !== last) return;
        set({ inspected: snapshot ?? null, inspectedLoading: false });
      })
      .catch((error: unknown) => {
        console.error('[LiteCAD] failed to read entity details', error);
        set({ inspected: null, inspectedLoading: false });
      });
  },

  clearSelection() {
    set({ selection: [], inspected: null, inspectedLoading: false });
  },

  setTool(tool) {
    set({ tool });
  },

  toggleGrid() {
    set({ gridVisible: !get().gridVisible });
  },

  toggleSnap() {
    set({ snapEnabled: !get().snapEnabled });
  },

  setCursor(position) {
    set({ cursor: position });
  },

  setZoomPercent(value) {
    set({ zoomPercent: value });
  },

  toggleDiagnostics() {
    set({ diagnosticsOpen: !get().diagnosticsOpen });
  },

  dismissError() {
    set({ error: null, status: get().summary ? 'ready' : 'idle' });
  },
}));

/** Layer indices (positions in `layers`) that are currently hidden. */
export function hiddenLayerIndices(layers: readonly CadLayer[]): Set<number> {
  const hidden = new Set<number>();
  layers.forEach((layer, index) => {
    if (!layer.visible) hidden.add(index);
  });
  return hidden;
}

export function lockedLayerIndices(layers: readonly CadLayer[]): Set<number> {
  const locked = new Set<number>();
  layers.forEach((layer, index) => {
    if (layer.locked) locked.add(index);
  });
  return locked;
}
