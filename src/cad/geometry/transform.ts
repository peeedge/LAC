/**
 * 2D affine transforms, used to expand block references (INSERT) into
 * world-space geometry.
 *
 * A matrix is stored row-major as `[a, b, c, d, e, f]`, mapping
 * `x' = a·x + c·y + e` and `y' = b·x + d·y + f` — the same convention as the
 * Canvas 2D and SVG APIs.
 */

import type {
  ArcGeometry,
  CircleGeometry,
  EllipseGeometry,
  FaceGeometry,
  InsertGeometry,
  LineGeometry,
  Point2D,
  PointGeometry,
  PolylineGeometry,
  SplineGeometry,
  TextGeometry,
} from '../model/geometry';
import type { AnyCadEntity, CadEntityType } from '../model/document';
import { computeEntityBounds } from './entityBounds';

export type Matrix2D = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix2D = [1, 0, 0, 1, 0, 0];

/** Builds the transform for a block insertion: scale, then rotate, then translate. */
export function createInsertMatrix(
  translateX: number,
  translateY: number,
  scaleX: number,
  scaleY: number,
  rotation: number,
): Matrix2D {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [scaleX * cos, scaleX * sin, -scaleY * sin, scaleY * cos, translateX, translateY];
}

/** Returns `outer ∘ inner`, i.e. apply `inner` first. */
export function multiplyMatrix(outer: Matrix2D, inner: Matrix2D): Matrix2D {
  const [a1, b1, c1, d1, e1, f1] = outer;
  const [a2, b2, c2, d2, e2, f2] = inner;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function applyToPoint(matrix: Matrix2D, point: Point2D): Point2D {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}

/** Transforms a direction (ignores translation). */
function applyToVector(matrix: Matrix2D, point: Point2D): Point2D {
  const [a, b, c, d] = matrix;
  return { x: a * point.x + c * point.y, y: b * point.x + d * point.y };
}

/** Column magnitudes, which are the scale factors applied to each local axis. */
function axisScales(matrix: Matrix2D): { sx: number; sy: number } {
  const [a, b, c, d] = matrix;
  return { sx: Math.hypot(a, b), sy: Math.hypot(c, d) };
}

/** Rotation of the transformed local X axis. */
function matrixRotation(matrix: Matrix2D): number {
  return Math.atan2(matrix[1], matrix[0]);
}

/** True when the transform flips handedness, which reverses arc sweep direction. */
function isMirrored(matrix: Matrix2D): boolean {
  const [a, b, c, d] = matrix;
  return a * d - b * c < 0;
}

/**
 * Applies `matrix` to an entity, returning a new entity with recomputed bounds.
 *
 * Non-uniform or mirrored scaling turns circles and arcs into ellipses, which is
 * what a real CAD engine does: a scaled circle is only still a circle when both
 * axes scale equally.
 */
export function transformEntity(
  entity: AnyCadEntity,
  matrix: Matrix2D,
  id: string,
  blockPath: string,
): AnyCadEntity {
  const { sx, sy } = axisScales(matrix);
  const uniform = Math.abs(sx - sy) <= Math.max(sx, sy) * 1e-9;

  let type: CadEntityType = entity.type;
  let geometry: unknown;

  switch (entity.type) {
    case 'LINE': {
      const source = entity.geometry as LineGeometry;
      geometry = {
        start: applyToPoint(matrix, source.start),
        end: applyToPoint(matrix, source.end),
      } satisfies LineGeometry;
      break;
    }

    case 'POINT': {
      const source = entity.geometry as PointGeometry;
      geometry = { position: applyToPoint(matrix, source.position) } satisfies PointGeometry;
      break;
    }

    case 'CIRCLE': {
      const source = entity.geometry as CircleGeometry;
      if (uniform) {
        geometry = {
          center: applyToPoint(matrix, source.center),
          radius: source.radius * sx,
        } satisfies CircleGeometry;
      } else {
        type = 'ELLIPSE';
        geometry = toEllipse(matrix, source.center, source.radius, 0, Math.PI * 2);
      }
      break;
    }

    case 'ARC': {
      const source = entity.geometry as ArcGeometry;
      if (uniform && !isMirrored(matrix)) {
        const rotation = matrixRotation(matrix);
        geometry = {
          center: applyToPoint(matrix, source.center),
          radius: source.radius * sx,
          startAngle: source.startAngle + rotation,
          endAngle: source.endAngle + rotation,
        } satisfies ArcGeometry;
      } else {
        type = 'ELLIPSE';
        geometry = toEllipse(matrix, source.center, source.radius, source.startAngle, source.endAngle);
      }
      break;
    }

    case 'ELLIPSE': {
      const source = entity.geometry as EllipseGeometry;
      const major = applyToVector(matrix, source.majorAxis);
      // Derive the new minor radius from the transformed minor axis vector.
      const minorSource = { x: -source.majorAxis.y, y: source.majorAxis.x };
      const minorLength = Math.hypot(minorSource.x, minorSource.y) * source.axisRatio;
      const minorUnit =
        minorLength > 0
          ? { x: (minorSource.x / Math.hypot(minorSource.x, minorSource.y)) * minorLength,
              y: (minorSource.y / Math.hypot(minorSource.x, minorSource.y)) * minorLength }
          : { x: 0, y: 0 };
      const minor = applyToVector(matrix, minorUnit);

      const majorLength = Math.hypot(major.x, major.y);
      geometry = {
        center: applyToPoint(matrix, source.center),
        majorAxis: major,
        axisRatio: majorLength > 0 ? Math.hypot(minor.x, minor.y) / majorLength : source.axisRatio,
        startAngle: source.startAngle,
        endAngle: source.endAngle,
      } satisfies EllipseGeometry;
      break;
    }

    case 'POLYLINE':
    case 'LWPOLYLINE': {
      const source = entity.geometry as PolylineGeometry;
      const mirrored = isMirrored(matrix);
      geometry = {
        closed: source.closed,
        vertices: source.vertices.map((vertex) => {
          const moved = applyToPoint(matrix, vertex);
          // Bulge sign encodes sweep direction, which a mirror reverses.
          const bulge = vertex.bulge == null ? undefined : mirrored ? -vertex.bulge : vertex.bulge;
          return bulge === undefined ? moved : { ...moved, bulge };
        }),
      } satisfies PolylineGeometry;
      break;
    }

    case 'SPLINE': {
      const source = entity.geometry as SplineGeometry;
      geometry = {
        ...source,
        controlPoints: source.controlPoints.map((point) => applyToPoint(matrix, point)),
        fitPoints: source.fitPoints?.map((point) => applyToPoint(matrix, point)),
      } satisfies SplineGeometry;
      break;
    }

    case 'TEXT':
    case 'MTEXT': {
      const source = entity.geometry as TextGeometry;
      geometry = {
        ...source,
        position: applyToPoint(matrix, source.position),
        // Text height follows the vertical scale; rotation accumulates.
        height: source.height * sy,
        rotation: source.rotation + matrixRotation(matrix),
      } satisfies TextGeometry;
      break;
    }

    case 'SOLID':
    case 'FACE': {
      const source = entity.geometry as FaceGeometry;
      geometry = {
        points: source.points.map((point) => applyToPoint(matrix, point)),
      } satisfies FaceGeometry;
      break;
    }

    case 'INSERT': {
      const source = entity.geometry as InsertGeometry;
      geometry = {
        ...source,
        position: applyToPoint(matrix, source.position),
        scaleX: source.scaleX * sx,
        scaleY: source.scaleY * sy,
        rotation: source.rotation + matrixRotation(matrix),
      } satisfies InsertGeometry;
      break;
    }

    default:
      geometry = entity.geometry;
      break;
  }

  const transformed = {
    ...entity,
    id,
    type,
    geometry,
    blockPath,
  } as AnyCadEntity;

  transformed.bounds = computeEntityBounds(transformed);
  return transformed;
}

/** Converts a circular arc into the equivalent ellipse under a non-uniform transform. */
function toEllipse(
  matrix: Matrix2D,
  center: Point2D,
  radius: number,
  startAngle: number,
  endAngle: number,
): EllipseGeometry {
  const major = applyToVector(matrix, { x: radius, y: 0 });
  const minor = applyToVector(matrix, { x: 0, y: radius });

  const majorLength = Math.hypot(major.x, major.y);
  const minorLength = Math.hypot(minor.x, minor.y);

  return {
    center: applyToPoint(matrix, center),
    majorAxis: major,
    axisRatio: majorLength > 0 ? minorLength / majorLength : 1,
    startAngle,
    endAngle,
  };
}
