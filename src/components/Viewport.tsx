/**
 * The CAD viewport.
 *
 * This component is intentionally thin: it owns a canvas and the lifetime of the
 * {@link CadRenderer} / {@link ViewportController} pair, then forwards store
 * changes into them. No CAD entity is ever a React element, and camera
 * interaction never triggers a re-render — the controller mutates the camera and
 * asks the renderer for a frame directly.
 */

import { useEffect, useRef } from 'react';
import { CadRenderer } from '../cad/renderer/CadRenderer';
import { ViewportController } from '../cad/interaction/ViewportController';
import { zoomPercent } from '../cad/renderer/camera';
import { hiddenLayerIndices, lockedLayerIndices, useCadStore } from '../store/cadStore';
import { Crosshair } from './Crosshair';

export interface ViewportHandle {
  zoomExtents(): void;
  zoomBy(factor: number): void;
}

interface ViewportProps {
  /** Receives imperative camera controls for the toolbar and shortcuts. */
  onReady?: (handle: ViewportHandle | null) => void;
}

export function Viewport({ onReady }: ViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CadRenderer | null>(null);
  const controllerRef = useRef<ViewportController | null>(null);

  const geometry = useCadStore((state) => state.geometry);
  const layers = useCadStore((state) => state.layers);
  const selection = useCadStore((state) => state.selection);
  const tool = useCadStore((state) => state.tool);
  const gridVisible = useCadStore((state) => state.gridVisible);
  const snapEnabled = useCadStore((state) => state.snapEnabled);

  // --- Renderer lifetime ---------------------------------------------------
  // Created once on mount. Store updates are applied by the effects below.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let renderer: CadRenderer;
    try {
      renderer = new CadRenderer(canvas);
    } catch (error) {
      // A missing WebGL context must not take the whole app down.
      console.error('[LiteCAD] failed to create the WebGL renderer', error);
      return;
    }

    rendererRef.current = renderer;

    const store = useCadStore.getState();

    const controller = new ViewportController(container, renderer, {
      onCursorMove: (position) => useCadStore.getState().setCursor(position),
      onPick: (entityIndex, additive) =>
        useCadStore.getState().selectEntity(entityIndex, additive),
      onCameraChange: () => {
        useCadStore
          .getState()
          .setZoomPercent(zoomPercent(renderer.camera.scale, renderer.getFitScale()));
      },
    });
    controllerRef.current = controller;

    controller.setTool(store.tool);
    controller.setSnapToGrid(store.snapEnabled);
    renderer.setGridVisible(store.gridVisible);

    // Track element size rather than window size so panel resizing works too.
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      renderer.setSize(width, height);
      useCadStore
        .getState()
        .setZoomPercent(zoomPercent(renderer.camera.scale, renderer.getFitScale()));
    });
    observer.observe(container);

    renderer.setSize(container.clientWidth, container.clientHeight);

    onReady?.({
      zoomExtents: () => {
        renderer.zoomExtents();
        useCadStore
          .getState()
          .setZoomPercent(zoomPercent(renderer.camera.scale, renderer.getFitScale()));
      },
      zoomBy: (factor) => {
        renderer.camera.zoomBy(factor);
        renderer.requestRender();
        useCadStore
          .getState()
          .setZoomPercent(zoomPercent(renderer.camera.scale, renderer.getFitScale()));
      },
    });

    return () => {
      onReady?.(null);
      observer.disconnect();
      controller.dispose();
      renderer.dispose();
      controllerRef.current = null;
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only setup
  }, []);

  // --- New drawing ---------------------------------------------------------
  useEffect(() => {
    const renderer = rendererRef.current;
    const controller = controllerRef.current;
    if (!renderer || !controller) return;

    if (!geometry) {
      renderer.clearDrawing();
      controller.rebuildIndex();
      renderer.requestRender();
      return;
    }

    renderer.setDrawing(geometry, layers);
    controller.rebuildIndex();
    // Frame the drawing as soon as it loads; this is the "fit to screen" step.
    renderer.zoomExtents();
    useCadStore
      .getState()
      .setZoomPercent(zoomPercent(renderer.camera.scale, renderer.getFitScale()));
    // `layers` is applied by its own effect; depending on it here would reload
    // all GPU buffers on every visibility toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry]);

  // --- Layer visibility ----------------------------------------------------
  useEffect(() => {
    rendererRef.current?.applyLayerVisibility(layers);
    controllerRef.current?.setHiddenLayers(hiddenLayerIndices(layers));
    controllerRef.current?.setLockedLayers(lockedLayerIndices(layers));
  }, [layers]);

  // --- Selection -----------------------------------------------------------
  useEffect(() => {
    rendererRef.current?.setSelection(selection);
  }, [selection]);

  // --- Toggles -------------------------------------------------------------
  useEffect(() => {
    controllerRef.current?.setTool(tool);
  }, [tool]);

  useEffect(() => {
    controllerRef.current?.setSnapToGrid(snapEnabled);
  }, [snapEnabled]);

  useEffect(() => {
    rendererRef.current?.setGridVisible(gridVisible);
  }, [gridVisible]);

  return (
    <div
      ref={containerRef}
      data-testid="cad-viewport"
      // `touch-none` keeps the browser from hijacking drag gestures as scrolls.
      className="relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden bg-viewport"
    >
      <canvas ref={canvasRef} className="block h-full w-full" data-testid="cad-canvas" />
      <Crosshair />
      <AxisIndicator />
    </div>
  );
}

/** Small X/Y axis gnomon in the lower-left corner of the viewport. */
function AxisIndicator() {
  return (
    <svg
      viewBox="0 0 56 56"
      className="pointer-events-none absolute bottom-2 left-2 h-11 w-11 opacity-80"
      aria-hidden="true"
    >
      <line x1="8" y1="48" x2="44" y2="48" stroke="#8b3a3a" strokeWidth="1.4" />
      <line x1="8" y1="48" x2="8" y2="12" stroke="#3f7a42" strokeWidth="1.4" />
      <polygon points="44,48 39,45.5 39,50.5" fill="#8b3a3a" />
      <polygon points="8,12 5.5,17 10.5,17" fill="#3f7a42" />
      <text x="46" y="51" fill="#8b3a3a" fontSize="9" fontFamily="monospace">
        X
      </text>
      <text x="2" y="10" fill="#3f7a42" fontSize="9" fontFamily="monospace">
        Y
      </text>
    </svg>
  );
}
