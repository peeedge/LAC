/**
 * 2D CAD camera.
 *
 * Operates in *rebased* coordinates (see `buildGeometry`): the drawing's centre
 * is the local origin, and `GeometryBundle.origin` converts back to true world
 * coordinates for display. That split is what lets drawings positioned at huge
 * survey coordinates render without float32 jitter.
 *
 * `scale` is CSS pixels per drawing unit, which makes it the natural quantity for
 * zoom percentages, pick tolerances and grid spacing.
 */

import {
  boundsHeight,
  boundsWidth,
  normaliseForView,
  type BoundingBox,
} from '../model/boundingBox';
import type { Point2D } from '../model/geometry';

/** Clamp range for `scale`, chosen to stay inside float32 precision. */
const MIN_SCALE = 1e-9;
const MAX_SCALE = 1e9;

/** Fraction of the viewport left as margin by `fitBounds`. */
export const FIT_PADDING = 0.06;

export interface CameraState {
  /** Viewport centre, in rebased coordinates. */
  centerX: number;
  centerY: number;
  /** CSS pixels per drawing unit. */
  scale: number;
}

export class CadCamera {
  centerX = 0;
  centerY = 0;
  scale = 1;

  /** Viewport size in CSS pixels. */
  width = 1;
  height = 1;

  setViewport(width: number, height: number): void {
    this.width = Math.max(width, 1);
    this.height = Math.max(height, 1);
  }

  getState(): CameraState {
    return { centerX: this.centerX, centerY: this.centerY, scale: this.scale };
  }

  /** Visible region in rebased coordinates. */
  getVisibleBounds(): BoundingBox {
    const halfWidth = this.width / 2 / this.scale;
    const halfHeight = this.height / 2 / this.scale;
    return {
      minX: this.centerX - halfWidth,
      minY: this.centerY - halfHeight,
      maxX: this.centerX + halfWidth,
      maxY: this.centerY + halfHeight,
    };
  }

  /**
   * Frames `bounds`, choosing the scale that fits both axes with a small margin.
   * Degenerate bounds (a single point, a perfectly straight line) are padded
   * first so the scale stays finite.
   */
  fitBounds(bounds: BoundingBox): void {
    const safe = normaliseForView(bounds);

    this.centerX = (safe.minX + safe.maxX) / 2;
    this.centerY = (safe.minY + safe.maxY) / 2;

    const width = boundsWidth(safe);
    const height = boundsHeight(safe);

    const scaleX = width > 0 ? this.width / width : Number.POSITIVE_INFINITY;
    const scaleY = height > 0 ? this.height / height : Number.POSITIVE_INFINITY;

    const fitted = Math.min(scaleX, scaleY);
    this.scale = clampScale(Number.isFinite(fitted) ? fitted * (1 - FIT_PADDING) : 1);
  }

  /** Pans by a screen-space delta in CSS pixels. */
  panByPixels(deltaX: number, deltaY: number): void {
    this.centerX -= deltaX / this.scale;
    // Screen Y grows downwards while drawing Y grows upwards.
    this.centerY += deltaY / this.scale;
  }

  /**
   * Zooms by `factor` while keeping the drawing point under the given screen
   * position stationary — the behaviour expected of mouse-wheel zoom in CAD.
   */
  zoomAtScreenPoint(factor: number, screenX: number, screenY: number): void {
    const before = this.screenToWorld(screenX, screenY);
    this.scale = clampScale(this.scale * factor);
    const after = this.screenToWorld(screenX, screenY);

    // Shift the centre by however much the anchor point drifted.
    this.centerX += before.x - after.x;
    this.centerY += before.y - after.y;
  }

  /** Zooms about the viewport centre. */
  zoomBy(factor: number): void {
    this.zoomAtScreenPoint(factor, this.width / 2, this.height / 2);
  }

  /** CSS pixel position → rebased drawing coordinates. */
  screenToWorld(screenX: number, screenY: number): Point2D {
    return {
      x: this.centerX + (screenX - this.width / 2) / this.scale,
      y: this.centerY - (screenY - this.height / 2) / this.scale,
    };
  }

  /** Rebased drawing coordinates → CSS pixel position. */
  worldToScreen(worldX: number, worldY: number): Point2D {
    return {
      x: (worldX - this.centerX) * this.scale + this.width / 2,
      y: (this.centerY - worldY) * this.scale + this.height / 2,
    };
  }

  /** Converts a screen-space pixel radius into drawing units. */
  pixelsToWorld(pixels: number): number {
    return pixels / this.scale;
  }

  restore(state: CameraState): void {
    this.centerX = state.centerX;
    this.centerY = state.centerY;
    this.scale = clampScale(state.scale);
  }
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
}

/**
 * Zoom percentage shown in the status bar.
 *
 * 100% is defined as "the drawing exactly fits the viewport", because an
 * absolute pixels-per-unit figure is meaningless without knowing the drawing's
 * units — a 1:1 reading would be 0.001% for a building in millimetres.
 */
export function zoomPercent(scale: number, fitScale: number): number {
  if (!Number.isFinite(fitScale) || fitScale <= 0) return 100;
  return (scale / fitScale) * 100;
}
