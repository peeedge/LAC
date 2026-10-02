/**
 * Computes world-space bounds for each entity type.
 *
 * Arcs, circles and ellipses use closed-form extrema rather than their
 * tessellation, so bounds stay exact regardless of chord tolerance. Splines
 * fall back to sampling because a tight analytic hull is not worth the cost.
 */

import {
  createEmptyBounds,
  expandBounds,
  type BoundingBox,
} from '../model/boundingBox';
import type {
  AnyCadEntity,
  CadEntity,
} from '../model/document';
import type {
  ArcGeometry,
  CircleGeometry,
  EllipseGeometry,
  FaceGeometry,
  InsertGeometry,
  LineGeometry,
  PointGeometry,
  PolylineGeometry,
  SplineGeometry,
  TextGeometry,
} from '../model/geometry';
import { TAU, angleWithinSweep, ccwSweep, normaliseAngle } from './math';
import { tessellateBulgeSegment, tessellateSpline } from './tessellate';

/**
 * Average glyph width as a fraction of cap height, used to estimate text
 * extents without measuring real font metrics. Monospaced-ish CAD fonts sit
 * around 0.6, which is close enough for culling and hit-testing.
 */
export const TEXT_WIDTH_RATIO = 0.6;

export function computeEntityBounds(entity: AnyCadEntity): BoundingBox {
  const bounds = createEmptyBounds();

  switch (entity.type) {
    case 'LINE': {
      const geometry = entity.geometry as LineGeometry;
      expandBounds(bounds, geometry.start.x, geometry.start.y);
      expandBounds(bounds, geometry.end.x, geometry.end.y);
      break;
    }

    case 'POINT': {
      const geometry = entity.geometry as PointGeometry;
      expandBounds(bounds, geometry.position.x, geometry.position.y);
      break;
    }

    case 'CIRCLE': {
      const geometry = entity.geometry as CircleGeometry;
      const { center, radius } = geometry;
      expandBounds(bounds, center.x - radius, center.y - radius);
      expandBounds(bounds, center.x + radius, center.y + radius);
      break;
    }

    case 'ARC':
      expandArcBounds(bounds, entity.geometry as ArcGeometry);
      break;

    case 'ELLIPSE':
      expandEllipseBounds(bounds, entity.geometry as EllipseGeometry);
      break;

    case 'POLYLINE':
    case 'LWPOLYLINE':
      expandPolylineBounds(bounds, entity.geometry as PolylineGeometry);
      break;

    case 'SPLINE': {
      const flat = tessellateSpline(entity.geometry as SplineGeometry);
      for (let i = 0; i < flat.length; i += 2) expandBounds(bounds, flat[i], flat[i + 1]);
      break;
    }

    case 'TEXT':
    case 'MTEXT':
      expandTextBounds(bounds, entity.geometry as TextGeometry);
      break;

    case 'SOLID':
    case 'FACE': {
      const geometry = entity.geometry as FaceGeometry;
      for (const point of geometry.points) expandBounds(bounds, point.x, point.y);
      break;
    }

    case 'INSERT': {
      // A bare INSERT has no extent of its own; bounds come from the expanded
      // block contents. The insertion point keeps it pickable regardless.
      const geometry = entity.geometry as InsertGeometry;
      expandBounds(bounds, geometry.position.x, geometry.position.y);
      break;
    }

    default:
      break;
  }

  return bounds;
}

/**
 * Exact arc bounds: the endpoints, plus whichever of the four axis-aligned
 * extreme points (0, π/2, π, 3π/2) the sweep actually passes through.
 */
function expandArcBounds(bounds: BoundingBox, geometry: ArcGeometry): void {
  const { center, radius } = geometry;
  const startAngle = normaliseAngle(geometry.startAngle);
  const sweep = ccwSweep(geometry.startAngle, geometry.endAngle);

  expandBounds(bounds, center.x + radius * Math.cos(startAngle), center.y + radius * Math.sin(startAngle));
  const endAngle = startAngle + sweep;
  expandBounds(bounds, center.x + radius * Math.cos(endAngle), center.y + radius * Math.sin(endAngle));

  for (let quadrant = 0; quadrant < 4; quadrant += 1) {
    const angle = (quadrant * Math.PI) / 2;
    if (angleWithinSweep(angle, startAngle, sweep)) {
      expandBounds(bounds, center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle));
    }
  }
}

/**
 * Exact bounds for a rotated ellipse arc.
 *
 * With `P(t) = C + U·a·cos t + V·b·sin t` (U the unit major axis, V its CCW
 * perpendicular), dx/dt = 0 at `tan t = -(b·Uy_component)/(a·Ux_component)`.
 * Solving per axis yields two candidate parameters each, which we keep only if
 * they fall inside the sweep.
 */
function expandEllipseBounds(bounds: BoundingBox, geometry: EllipseGeometry): void {
  const { center, majorAxis } = geometry;
  const majorRadius = Math.hypot(majorAxis.x, majorAxis.y);

  if (majorRadius <= 0) {
    expandBounds(bounds, center.x, center.y);
    return;
  }

  const minorRadius = majorRadius * Math.abs(geometry.axisRatio);
  const ux = majorAxis.x / majorRadius;
  const uy = majorAxis.y / majorRadius;

  const startAngle = normaliseAngle(geometry.startAngle);
  const sweep = ccwSweep(geometry.startAngle, geometry.endAngle);

  const evaluate = (t: number): void => {
    const cos = Math.cos(t) * majorRadius;
    const sin = Math.sin(t) * minorRadius;
    expandBounds(bounds, center.x + ux * cos - uy * sin, center.y + uy * cos + ux * sin);
  };

  evaluate(startAngle);
  evaluate(startAngle + sweep);

  // x(t) = Cx + ux·a·cos t − uy·b·sin t  →  dx/dt = 0 at tan t = −uy·b / (ux·a)
  const xCritical = Math.atan2(-uy * minorRadius, ux * majorRadius);
  // y(t) = Cy + uy·a·cos t + ux·b·sin t  →  dy/dt = 0 at tan t =  ux·b / (uy·a)
  const yCritical = Math.atan2(ux * minorRadius, uy * majorRadius);

  for (const critical of [xCritical, yCritical]) {
    // Each derivative has two roots half a turn apart.
    for (const candidate of [normaliseAngle(critical), normaliseAngle(critical + Math.PI)]) {
      if (sweep >= TAU - 1e-9 || angleWithinSweep(candidate, startAngle, sweep)) {
        evaluate(candidate);
      }
    }
  }
}

function expandPolylineBounds(bounds: BoundingBox, geometry: PolylineGeometry): void {
  const vertices = geometry.vertices;
  if (vertices.length === 0) return;

  for (const vertex of vertices) expandBounds(bounds, vertex.x, vertex.y);

  // Bulged segments can bow outside the control vertices, so sample those spans.
  const scratch: number[] = [];
  const segmentCount = geometry.closed ? vertices.length : vertices.length - 1;

  for (let i = 0; i < segmentCount; i += 1) {
    const from = vertices[i];
    const bulge = from.bulge ?? 0;
    if (bulge === 0) continue;

    const to = vertices[(i + 1) % vertices.length];
    scratch.length = 0;
    tessellateBulgeSegment(from, to, bulge, 1e-3, scratch);
    for (let j = 0; j < scratch.length; j += 2) expandBounds(bounds, scratch[j], scratch[j + 1]);
  }
}

/** Estimated text box, rotated about the insertion point. */
function expandTextBounds(bounds: BoundingBox, geometry: TextGeometry): void {
  const lines = geometry.value.split('\n');
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);

  const width = longest * geometry.height * TEXT_WIDTH_RATIO * (geometry.widthFactor || 1);
  const height = geometry.height * Math.max(lines.length, 1);

  // Local-space corners relative to the insertion point, honouring alignment.
  const offsetX =
    geometry.horizontalAlign === 'center' ? -width / 2 : geometry.horizontalAlign === 'right' ? -width : 0;
  const offsetY =
    geometry.verticalAlign === 'top'
      ? -height
      : geometry.verticalAlign === 'middle'
        ? -height / 2
        : 0;

  const cos = Math.cos(geometry.rotation);
  const sin = Math.sin(geometry.rotation);

  const corners: ReadonlyArray<readonly [number, number]> = [
    [offsetX, offsetY],
    [offsetX + width, offsetY],
    [offsetX + width, offsetY + height],
    [offsetX, offsetY + height],
  ];

  for (const [lx, ly] of corners) {
    expandBounds(
      bounds,
      geometry.position.x + lx * cos - ly * sin,
      geometry.position.y + lx * sin + ly * cos,
    );
  }
}

/** Recomputes and assigns `bounds` for an entity, returning the same entity. */
export function withComputedBounds<T extends AnyCadEntity>(entity: T): T {
  entity.bounds = computeEntityBounds(entity);
  return entity;
}

export function boundsOfEntities(entities: readonly CadEntity[]): BoundingBox {
  const bounds = createEmptyBounds();
  for (const entity of entities) {
    const entityBounds = entity.bounds;
    expandBounds(bounds, entityBounds.minX, entityBounds.minY);
    expandBounds(bounds, entityBounds.maxX, entityBounds.maxY);
  }
  return bounds;
}
