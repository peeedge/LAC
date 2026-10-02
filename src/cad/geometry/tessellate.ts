/**
 * Converts curved CAD primitives into polylines.
 *
 * Every function here returns a flat `number[]` of `x, y, x, y, …` world
 * coordinates representing an open polyline. Keeping the output flat avoids
 * allocating one object per vertex, which matters on drawings with hundreds of
 * thousands of entities.
 */

import type {
  ArcGeometry,
  CircleGeometry,
  EllipseGeometry,
  Point2D,
  PolylineGeometry,
  PolylineVertex,
  SplineGeometry,
} from '../model/geometry';
import { TAU, ccwSweep, clamp, segmentsForArc } from './math';

/** Default chord tolerance in drawing units. */
export const DEFAULT_TOLERANCE = 0.05;

export interface TessellationOptions {
  /** Maximum deviation between the true curve and its polyline, in drawing units. */
  tolerance?: number;
}

function resolveTolerance(options?: TessellationOptions): number {
  const tolerance = options?.tolerance ?? DEFAULT_TOLERANCE;
  return tolerance > 0 ? tolerance : DEFAULT_TOLERANCE;
}

/**
 * Samples a circular arc counter-clockwise from `startAngle` across `sweep`.
 * The end point is always emitted exactly so adjacent segments stay watertight.
 */
export function tessellateArcSpan(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  sweep: number,
  tolerance: number,
  out: number[] = [],
): number[] {
  const segments = segmentsForArc(radius, sweep, tolerance);
  const step = sweep / segments;

  for (let i = 0; i <= segments; i += 1) {
    const angle = startAngle + step * i;
    out.push(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle));
  }

  return out;
}

export function tessellateArc(geometry: ArcGeometry, options?: TessellationOptions): number[] {
  const sweep = ccwSweep(geometry.startAngle, geometry.endAngle);
  return tessellateArcSpan(
    geometry.center.x,
    geometry.center.y,
    geometry.radius,
    geometry.startAngle,
    sweep,
    resolveTolerance(options),
  );
}

export function tessellateCircle(geometry: CircleGeometry, options?: TessellationOptions): number[] {
  return tessellateArcSpan(
    geometry.center.x,
    geometry.center.y,
    geometry.radius,
    0,
    TAU,
    resolveTolerance(options),
  );
}

/**
 * Samples an ellipse, including rotated and partial ones.
 *
 * The major axis vector defines both the major radius and the rotation, so a
 * point at parameter `t` is
 * `center + major * cos(t) + perpendicular(major) * axisRatio * sin(t)`.
 * Note `t` is the *parametric* angle, not the geometric angle from the centre.
 */
export function tessellateEllipse(
  geometry: EllipseGeometry,
  options?: TessellationOptions,
): number[] {
  const tolerance = resolveTolerance(options);
  const { center, majorAxis, axisRatio } = geometry;

  const majorRadius = Math.hypot(majorAxis.x, majorAxis.y);
  if (majorRadius <= 0) return [center.x, center.y];

  const minorRadius = majorRadius * Math.abs(axisRatio);
  const sweep = ccwSweep(geometry.startAngle, geometry.endAngle);

  // Tessellate against the larger radius so the tighter end stays within tolerance.
  const segments = segmentsForArc(Math.max(majorRadius, minorRadius), sweep, tolerance);
  const step = sweep / segments;

  // Unit vectors along the major axis and its CCW perpendicular.
  const ux = majorAxis.x / majorRadius;
  const uy = majorAxis.y / majorRadius;

  const out: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = geometry.startAngle + step * i;
    const cos = Math.cos(t) * majorRadius;
    const sin = Math.sin(t) * minorRadius;
    out.push(center.x + ux * cos - uy * sin, center.y + uy * cos + ux * sin);
  }

  return out;
}

/**
 * Expands a bulged polyline segment into an arc.
 *
 * DXF bulge is `tan(includedAngle / 4)`, signed positive for a counter-clockwise
 * arc. Given the chord between two vertices:
 *   includedAngle = 4 * atan(bulge)
 *   radius        = chordLength / (2 * sin(includedAngle / 2))
 * The centre sits on the chord's perpendicular bisector, offset by the apothem.
 *
 * The starting vertex is **not** emitted; the caller owns it. That keeps
 * consecutive segments from duplicating shared vertices.
 */
export function tessellateBulgeSegment(
  start: Point2D,
  end: Point2D,
  bulge: number,
  tolerance: number,
  out: number[],
): void {
  const chordX = end.x - start.x;
  const chordY = end.y - start.y;
  const chordLength = Math.hypot(chordX, chordY);

  // Degenerate chord or a straight segment: a single vertex is enough.
  if (chordLength < 1e-12 || Math.abs(bulge) < 1e-9) {
    out.push(end.x, end.y);
    return;
  }

  const includedAngle = 4 * Math.atan(bulge);
  const halfAngle = includedAngle / 2;
  const sinHalf = Math.sin(halfAngle);

  if (Math.abs(sinHalf) < 1e-12) {
    out.push(end.x, end.y);
    return;
  }

  const radius = chordLength / (2 * sinHalf);

  // Midpoint of the chord plus the apothem along the chord normal.
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  // Distance from chord midpoint to centre; sign follows the bulge direction.
  const apothem = radius * Math.cos(halfAngle);
  // CCW normal of the chord direction.
  const normalX = -chordY / chordLength;
  const normalY = chordX / chordLength;

  const centerX = midX + normalX * apothem;
  const centerY = midY + normalY * apothem;

  const absRadius = Math.abs(radius);
  const startAngle = Math.atan2(start.y - centerY, start.x - centerX);

  // `includedAngle` already carries the direction, so sweep directly with it.
  const segments = segmentsForArc(absRadius, includedAngle, tolerance);
  const step = includedAngle / segments;

  for (let i = 1; i <= segments; i += 1) {
    // Emit the true end point rather than a sampled one to avoid drift.
    if (i === segments) {
      out.push(end.x, end.y);
      break;
    }
    const angle = startAngle + step * i;
    out.push(centerX + absRadius * Math.cos(angle), centerY + absRadius * Math.sin(angle));
  }
}

/** Flattens a polyline, expanding any bulged segments into arcs. */
export function tessellatePolyline(
  geometry: PolylineGeometry,
  options?: TessellationOptions,
): number[] {
  const tolerance = resolveTolerance(options);
  const vertices = geometry.vertices;
  if (vertices.length === 0) return [];
  if (vertices.length === 1) return [vertices[0].x, vertices[0].y];

  const out: number[] = [vertices[0].x, vertices[0].y];

  for (let i = 0; i < vertices.length - 1; i += 1) {
    emitSegment(vertices[i], vertices[i + 1], tolerance, out);
  }

  if (geometry.closed) {
    emitSegment(vertices[vertices.length - 1], vertices[0], tolerance, out);
  }

  return out;
}

function emitSegment(
  from: PolylineVertex,
  to: PolylineVertex,
  tolerance: number,
  out: number[],
): void {
  const bulge = from.bulge ?? 0;
  if (bulge === 0) {
    out.push(to.x, to.y);
  } else {
    tessellateBulgeSegment(from, to, bulge, tolerance, out);
  }
}

/**
 * Evaluates a NURBS curve with the Cox-de Boor recurrence.
 *
 * Splines are sampled at a fixed density derived from their control polygon
 * length rather than adaptively, because estimating curvature on a rational
 * B-spline is considerably more expensive than simply sampling it finely.
 */
export function tessellateSpline(
  geometry: SplineGeometry,
  options?: TessellationOptions,
): number[] {
  const tolerance = resolveTolerance(options);
  let controlPoints = geometry.controlPoints;

  // Some exporters write only fit points. Treat them as a plain polyline:
  // interpolating them would require solving for tangents we do not have.
  if (controlPoints.length < 2) {
    const fit = geometry.fitPoints ?? [];
    if (fit.length === 0) return [];
    const out: number[] = [];
    for (const point of fit) out.push(point.x, point.y);
    return out;
  }

  const degree = clamp(Math.floor(geometry.degree) || 3, 1, controlPoints.length - 1);
  let weights = geometry.weights;

  if (geometry.closed) {
    // Wrap the first `degree` control points to close the curve smoothly.
    controlPoints = [...controlPoints, ...controlPoints.slice(0, degree)];
    if (weights && weights.length >= geometry.controlPoints.length) {
      weights = [...weights, ...weights.slice(0, degree)];
    }
  }

  const pointCount = controlPoints.length;
  const expectedKnots = pointCount + degree + 1;
  const knots =
    geometry.knots.length === expectedKnots
      ? geometry.knots
      : buildClampedKnots(pointCount, degree);

  // Sample density scales with the control polygon's length so long, sweeping
  // curves get more points than short ones.
  const polygonLength = controlPolygonLength(controlPoints);
  const target = polygonLength > 0 ? Math.ceil(polygonLength / Math.max(tolerance * 12, 1e-6)) : 0;
  const samples = clamp(Math.max(target, pointCount * 6), 16, 2048);

  const domainStart = knots[degree];
  const domainEnd = knots[pointCount];
  const span = domainEnd - domainStart;

  if (!(span > 0)) {
    const out: number[] = [];
    for (const point of controlPoints) out.push(point.x, point.y);
    return out;
  }

  const out: number[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = domainStart + (span * i) / samples;
    // Nudge the final sample inside the domain; de Boor is undefined at the
    // closing knot because no span contains it.
    const u = i === samples ? domainEnd - span * 1e-9 : t;
    const point = evaluateDeBoor(u, degree, controlPoints, knots, weights);
    out.push(point.x, point.y);
  }

  return out;
}

function controlPolygonLength(points: readonly Point2D[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return length;
}

/** Uniform knot vector clamped at both ends, which reproduces the endpoints. */
function buildClampedKnots(pointCount: number, degree: number): number[] {
  const knots: number[] = [];
  const interior = pointCount - degree - 1;

  for (let i = 0; i <= degree; i += 1) knots.push(0);
  for (let i = 1; i <= interior; i += 1) knots.push(i / (interior + 1));
  for (let i = 0; i <= degree; i += 1) knots.push(1);

  return knots;
}

/** Index of the knot span containing `u`. */
function findSpan(u: number, degree: number, pointCount: number, knots: readonly number[]): number {
  if (u >= knots[pointCount]) return pointCount - 1;
  if (u <= knots[degree]) return degree;

  let low = degree;
  let high = pointCount;
  let mid = Math.floor((low + high) / 2);

  while (u < knots[mid] || u >= knots[mid + 1]) {
    if (u < knots[mid]) high = mid;
    else low = mid;
    mid = Math.floor((low + high) / 2);
  }

  return mid;
}

/**
 * De Boor's algorithm. Rational curves are handled by evaluating in homogeneous
 * coordinates (x·w, y·w, w) and dividing through at the end.
 */
function evaluateDeBoor(
  u: number,
  degree: number,
  controlPoints: readonly Point2D[],
  knots: readonly number[],
  weights?: readonly number[],
): Point2D {
  const pointCount = controlPoints.length;
  const span = findSpan(u, degree, pointCount, knots);

  const x: number[] = new Array(degree + 1);
  const y: number[] = new Array(degree + 1);
  const w: number[] = new Array(degree + 1);

  for (let i = 0; i <= degree; i += 1) {
    const index = span - degree + i;
    const point = controlPoints[index] ?? controlPoints[pointCount - 1];
    const weight = weights?.[index] ?? 1;
    x[i] = point.x * weight;
    y[i] = point.y * weight;
    w[i] = weight;
  }

  for (let level = 1; level <= degree; level += 1) {
    for (let i = degree; i >= level; i -= 1) {
      const index = span - degree + i;
      const denominator = knots[index + degree - level + 1] - knots[index];
      const alpha = denominator === 0 ? 0 : (u - knots[index]) / denominator;
      const inverse = 1 - alpha;

      x[i] = inverse * x[i - 1] + alpha * x[i];
      y[i] = inverse * y[i - 1] + alpha * y[i];
      w[i] = inverse * w[i - 1] + alpha * w[i];
    }
  }

  const weight = w[degree];
  if (!weight || !Number.isFinite(weight)) return { x: x[degree], y: y[degree] };
  return { x: x[degree] / weight, y: y[degree] / weight };
}
