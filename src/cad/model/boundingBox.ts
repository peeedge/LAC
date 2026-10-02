/**
 * Axis-aligned bounding box helpers.
 *
 * An "empty" box is represented by inverted infinite bounds, which makes
 * `expand` work without a special-case first iteration.
 */

import type { Point2D } from './geometry';

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function createEmptyBounds(): BoundingBox {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

export function isEmptyBounds(bounds: BoundingBox): boolean {
  return !(bounds.maxX >= bounds.minX && bounds.maxY >= bounds.minY);
}

/** Grows `bounds` in place to include the point. Ignores non-finite input. */
export function expandBounds(bounds: BoundingBox, x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (x < bounds.minX) bounds.minX = x;
  if (y < bounds.minY) bounds.minY = y;
  if (x > bounds.maxX) bounds.maxX = x;
  if (y > bounds.maxY) bounds.maxY = y;
}

/** Grows `target` in place to include all of `other`. */
export function unionBounds(target: BoundingBox, other: BoundingBox): void {
  if (isEmptyBounds(other)) return;
  expandBounds(target, other.minX, other.minY);
  expandBounds(target, other.maxX, other.maxY);
}

export function boundsFromPoints(points: readonly Point2D[]): BoundingBox {
  const bounds = createEmptyBounds();
  for (const point of points) expandBounds(bounds, point.x, point.y);
  return bounds;
}

export function boundsWidth(bounds: BoundingBox): number {
  return isEmptyBounds(bounds) ? 0 : bounds.maxX - bounds.minX;
}

export function boundsHeight(bounds: BoundingBox): number {
  return isEmptyBounds(bounds) ? 0 : bounds.maxY - bounds.minY;
}

export function boundsCenter(bounds: BoundingBox): Point2D {
  if (isEmptyBounds(bounds)) return { x: 0, y: 0 };
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

/**
 * Returns a copy grown by `amount` on every side. Useful for hit-testing
 * tolerance and for padding the initial camera fit.
 */
export function inflateBounds(bounds: BoundingBox, amount: number): BoundingBox {
  if (isEmptyBounds(bounds)) return { ...bounds };
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount,
  };
}

export function boundsIntersect(a: BoundingBox, b: BoundingBox): boolean {
  if (isEmptyBounds(a) || isEmptyBounds(b)) return false;
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function boundsContainsPoint(bounds: BoundingBox, x: number, y: number): boolean {
  if (isEmptyBounds(bounds)) return false;
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

/**
 * Produces a non-degenerate box suitable for a camera fit. Drawings that are a
 * single point, or perfectly axis-aligned lines, would otherwise yield a zero
 * width or height and an infinite zoom factor.
 */
export function normaliseForView(bounds: BoundingBox, fallbackSize = 100): BoundingBox {
  if (isEmptyBounds(bounds)) {
    const half = fallbackSize / 2;
    return { minX: -half, minY: -half, maxX: half, maxY: half };
  }

  const width = boundsWidth(bounds);
  const height = boundsHeight(bounds);
  // Pad degenerate axes relative to the other axis so aspect stays sensible.
  const padX = width > 0 ? 0 : (height > 0 ? height : fallbackSize) / 2;
  const padY = height > 0 ? 0 : (width > 0 ? width : fallbackSize) / 2;

  return {
    minX: bounds.minX - padX,
    minY: bounds.minY - padY,
    maxX: bounds.maxX + padX,
    maxY: bounds.maxY + padY,
  };
}
