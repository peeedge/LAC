/**
 * Pointer interaction for the viewport: pan, zoom, hover and click-to-select.
 *
 * Lives outside React so that dragging the view never triggers a component
 * re-render — the controller mutates the camera and asks the renderer for a
 * frame. State that the UI genuinely needs (cursor coordinates, the active tool)
 * is pushed out through callbacks, throttled to one update per frame.
 */

import type { CadRenderer } from '../renderer/CadRenderer';
import { gridSpacingForScale } from '../renderer/grid';
import type { Point2D } from '../model/geometry';
import { pickEntity } from './picking';
import { buildSpatialIndex, type SpatialIndex } from './spatialIndex';

/** Active viewport tool. `select` is the default; `pan` forces drag-to-pan. */
export type ViewportTool = 'select' | 'pan';

/** Click radius for hit-testing, in CSS pixels. */
export const PICK_RADIUS_PIXELS = 6;

/** Wheel zoom step. 1.1 gives a responsive but controllable feel. */
const ZOOM_STEP = 1.1;

export interface ViewportCallbacks {
  /** Cursor position in true world coordinates, or `null` when outside. */
  onCursorMove?: (position: Point2D | null) => void;
  /** Fired on click. `null` means the user clicked empty space. */
  onPick?: (entityIndex: number | null, additive: boolean) => void;
  onHover?: (entityIndex: number | null) => void;
  /** Fired after the camera changes, for the zoom readout. */
  onCameraChange?: () => void;
}

interface DragState {
  pointerId: number;
  lastX: number;
  lastY: number;
  /** True once the pointer moved far enough to count as a drag, not a click. */
  moved: boolean;
  /** Whether this drag is panning (as opposed to a pending click). */
  panning: boolean;
}

/** Movement in pixels before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 3;

export class ViewportController {
  private tool: ViewportTool = 'select';
  private drag: DragState | null = null;
  private spatialIndex: SpatialIndex | null = null;

  /** Layer indices that cannot be picked. */
  private hiddenLayers: ReadonlySet<number> = new Set();
  private lockedLayers: ReadonlySet<number> = new Set();

  private hoveredEntity: number | null = null;
  private snapToGrid = false;

  /** Coalesces hover work to one hit-test per animation frame. */
  private pendingHover: { x: number; y: number } | null = null;
  private hoverFrame: number | null = null;

  private readonly listeners: Array<() => void> = [];

  private readonly element: HTMLElement;
  private readonly renderer: CadRenderer;
  private readonly callbacks: ViewportCallbacks;

  constructor(element: HTMLElement, renderer: CadRenderer, callbacks: ViewportCallbacks = {}) {
    this.element = element;
    this.renderer = renderer;
    this.callbacks = callbacks;
    this.attach();
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  setTool(tool: ViewportTool): void {
    this.tool = tool;
    this.element.style.cursor = tool === 'pan' ? 'grab' : 'crosshair';
  }

  setSnapToGrid(enabled: boolean): void {
    this.snapToGrid = enabled;
  }

  setHiddenLayers(hidden: ReadonlySet<number>): void {
    this.hiddenLayers = hidden;
  }

  setLockedLayers(locked: ReadonlySet<number>): void {
    this.lockedLayers = locked;
  }

  /** Rebuilds the hit-testing index. Call whenever a new drawing loads. */
  rebuildIndex(): void {
    const bundle = this.renderer.geometry;
    this.spatialIndex = bundle
      ? buildSpatialIndex(bundle.pick.bounds, bundle.viewBounds)
      : null;
  }

  // -------------------------------------------------------------------------
  // Event wiring
  // -------------------------------------------------------------------------

  private attach(): void {
    const add = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ): void => {
      this.element.addEventListener(type, handler as EventListener, options);
      this.listeners.push(() => this.element.removeEventListener(type, handler as EventListener));
    };

    add('pointerdown', this.handlePointerDown);
    add('pointermove', this.handlePointerMove);
    add('pointerup', this.handlePointerUp);
    add('pointercancel', this.handlePointerUp);
    add('pointerleave', this.handlePointerLeave);
    // Non-passive so the page does not scroll while zooming.
    add('wheel', this.handleWheel, { passive: false });
    // Middle-click and right-click are pan gestures, so suppress the default menu.
    add('contextmenu', this.handleContextMenu);
    add('dblclick', this.handleDoubleClick);

    this.setTool('select');
  }

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  private localPosition(event: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private handlePointerDown = (event: PointerEvent): void => {
    // Middle button, right button, or the pan tool all start a pan.
    // Space-less panning with the left button is reserved for the pan tool.
    const panning =
      event.button === 1 || event.button === 2 || (event.button === 0 && this.tool === 'pan');

    if (event.button !== 0 && !panning) return;

    const { x, y } = this.localPosition(event);
    this.drag = { pointerId: event.pointerId, lastX: x, lastY: y, moved: false, panning };

    this.element.setPointerCapture(event.pointerId);
    if (panning) this.element.style.cursor = 'grabbing';
    event.preventDefault();
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const { x, y } = this.localPosition(event);

    if (this.drag && this.drag.pointerId === event.pointerId) {
      const deltaX = x - this.drag.lastX;
      const deltaY = y - this.drag.lastY;

      if (!this.drag.moved && Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD) {
        this.drag.moved = true;
      }

      if (this.drag.panning && this.drag.moved) {
        this.renderer.camera.panByPixels(deltaX, deltaY);
        this.renderer.requestRender();
        this.callbacks.onCameraChange?.();
      }

      this.drag.lastX = x;
      this.drag.lastY = y;
    }

    this.reportCursor(x, y);

    // Hover highlighting is pointless mid-pan and costs a hit-test.
    if (!this.drag?.panning) this.queueHover(x, y);
  };

  private handlePointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;

    this.drag = null;
    if (this.element.hasPointerCapture(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId);
    }
    this.setTool(this.tool);

    // A left press that did not turn into a drag is a selection click.
    if (!drag.moved && event.button === 0 && this.tool === 'select') {
      const { x, y } = this.localPosition(event);
      const hit = this.hitTest(x, y);
      // Shift or Ctrl/Cmd adds to the selection, as in AutoCAD.
      this.callbacks.onPick?.(hit, event.shiftKey || event.ctrlKey || event.metaKey);
    }
  };

  private handlePointerLeave = (): void => {
    this.callbacks.onCursorMove?.(null);
    this.setHover(null);
  };

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();

    const { x, y } = this.localPosition(event);
    // Normalise across deltaMode (pixels, lines, pages) to one step per notch.
    const direction = event.deltaY > 0 ? -1 : 1;
    const factor = direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;

    this.renderer.camera.zoomAtScreenPoint(factor, x, y);
    this.renderer.requestRender();
    this.callbacks.onCameraChange?.();
    this.reportCursor(x, y);
  };

  private handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private handleDoubleClick = (): void => {
    // Double-click is zoom-extents, matching common CAD viewers.
    this.renderer.zoomExtents();
    this.callbacks.onCameraChange?.();
  };

  // -------------------------------------------------------------------------
  // Cursor + hover
  // -------------------------------------------------------------------------

  private reportCursor(screenX: number, screenY: number): void {
    if (!this.callbacks.onCursorMove) return;

    const local = this.renderer.camera.screenToWorld(screenX, screenY);
    const origin = this.renderer.geometry?.origin ?? { x: 0, y: 0 };

    let x = local.x + origin.x;
    let y = local.y + origin.y;

    if (this.snapToGrid) {
      // Snapping reuses the same spacing the grid is drawn at, so the cursor
      // always lands on a visible intersection.
      const spacing = gridSpacingForScale(this.renderer.camera.scale);
      x = Math.round(x / spacing) * spacing;
      y = Math.round(y / spacing) * spacing;
    }

    this.callbacks.onCursorMove({ x, y });
  }

  private queueHover(x: number, y: number): void {
    this.pendingHover = { x, y };
    if (this.hoverFrame !== null) return;

    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = null;
      const pending = this.pendingHover;
      this.pendingHover = null;
      if (!pending) return;
      this.setHover(this.hitTest(pending.x, pending.y));
    });
  }

  private setHover(entityIndex: number | null): void {
    if (entityIndex === this.hoveredEntity) return;
    this.hoveredEntity = entityIndex;
    this.renderer.setHover(entityIndex);
    this.callbacks.onHover?.(entityIndex);
  }

  /** Hit-tests a screen position, returning an entity ordinal or `null`. */
  hitTest(screenX: number, screenY: number): number | null {
    const bundle = this.renderer.geometry;
    if (!bundle || !this.spatialIndex) return null;

    const world = this.renderer.camera.screenToWorld(screenX, screenY);
    // A constant pixel radius becomes a zoom-dependent world radius.
    const tolerance = this.renderer.camera.pixelsToWorld(PICK_RADIUS_PIXELS);

    const result = pickEntity(bundle.pick, this.spatialIndex, world.x, world.y, tolerance, {
      hiddenLayers: this.hiddenLayers,
      lockedLayers: this.lockedLayers,
    });

    return result?.entityIndex ?? null;
  }

  dispose(): void {
    for (const remove of this.listeners) remove();
    this.listeners.length = 0;
    if (this.hoverFrame !== null) cancelAnimationFrame(this.hoverFrame);
  }
}
