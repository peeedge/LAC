/** Shared angle/vector helpers used by the tessellator and hit-testing. */

export const TAU = Math.PI * 2;

/** Wraps an angle into `[0, 2π)`. */
export function normaliseAngle(angle: number): number {
  const wrapped = angle % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

/**
 * Returns the counter-clockwise sweep from `startAngle` to `endAngle` in
 * `(0, 2π]`. A start equal to the end is treated as a full turn, matching how
 * CAD formats encode complete circles on arc-like entities.
 */
export function ccwSweep(startAngle: number, endAngle: number): number {
  const sweep = normaliseAngle(endAngle - startAngle);
  // Guard against float noise making a full circle collapse to ~0.
  return sweep < 1e-9 ? TAU : sweep;
}

/** True when `angle` lies on the CCW arc from `startAngle` through `sweep`. */
export function angleWithinSweep(angle: number, startAngle: number, sweep: number): boolean {
  const delta = normaliseAngle(angle - startAngle);
  return delta <= sweep + 1e-9;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Chooses how many straight segments approximate a curve so the maximum
 * deviation (sagitta) stays under `tolerance` drawing units.
 *
 * For a circular arc of radius r split into n segments the sagitta is
 * `r * (1 - cos(θ/2))` where `θ = sweep / n`. Solving for θ gives
 * `θ = 2 * acos(1 - tolerance / r)`.
 *
 * `tolerance` is expressed in drawing units; callers scale it by the current
 * view so distant geometry is not over-tessellated.
 */
export function segmentsForArc(
  radius: number,
  sweep: number,
  tolerance: number,
  minSegments = 8,
  maxSegments = 512,
): number {
  if (!Number.isFinite(radius) || radius <= 0) return minSegments;
  const absSweep = Math.abs(sweep);
  if (absSweep <= 0) return minSegments;

  // A tolerance at or above the radius means even a crude fan is acceptable.
  const ratio = 1 - tolerance / radius;
  if (ratio <= -1) return minSegments;

  const maxAngleStep = 2 * Math.acos(clamp(ratio, -1, 1));
  if (!Number.isFinite(maxAngleStep) || maxAngleStep <= 1e-6) return maxSegments;

  const count = Math.ceil(absSweep / maxAngleStep);
  return clamp(count, minSegments, maxSegments);
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/**
 * Shortest distance from point `p` to the segment `a`→`b`.
 * Used by entity picking, so it is written to avoid allocations.
 */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);

  // Project p onto the infinite line, then clamp to the segment.
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
