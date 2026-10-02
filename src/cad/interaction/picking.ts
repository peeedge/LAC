/**
 * Entity hit-testing.
 *
 * Picking runs in two stages: the spatial index narrows the candidate set using
 * bounding boxes, then each candidate gets an exact test against the same
 * tessellated polyline that was uploaded to the GPU. That guarantees what the
 * user clicks is what they see.
 *
 * All coordinates here are *rebased* (the renderer's space), matching
 * {@link PickBundle}.
 */

import { PickKind, type PickBundle } from '../geometry/buildGeometry';
import { distanceToSegment } from '../geometry/math';
import { querySpatialIndex, type SpatialIndex } from './spatialIndex';

export interface PickResult {
  /** Ordinal position in `CadDocument.entities`. */
  entityIndex: number;
  /** Distance from the query point in rebased units. */
  distance: number;
}

export interface PickOptions {
  /** Layer indices that are currently hidden and must not be picked. */
  hiddenLayers?: ReadonlySet<number>;
  /** Layer indices that are locked; excluded because they cannot be edited. */
  lockedLayers?: ReadonlySet<number>;
}

/**
 * Finds the entity closest to `(x, y)` within `tolerance`.
 *
 * `tolerance` is in rebased world units and is normally derived from a fixed
 * pixel radius divided by the current zoom, so the pick target stays a constant
 * size on screen.
 */
export function pickEntity(
  pick: PickBundle,
  index: SpatialIndex,
  x: number,
  y: number,
  tolerance: number,
  options: PickOptions = {},
): PickResult | undefined {
  const candidates = querySpatialIndex(
    index,
    x - tolerance,
    y - tolerance,
    x + tolerance,
    y + tolerance,
  );

  let best: PickResult | undefined;

  for (const entityIndex of candidates) {
    const layerIndex = pick.layerIndices[entityIndex];
    if (options.hiddenLayers?.has(layerIndex)) continue;
    if (options.lockedLayers?.has(layerIndex)) continue;

    const distance = distanceToEntity(pick, entityIndex, x, y, tolerance);
    if (distance === undefined || distance > tolerance) continue;

    // Prefer the nearest; ties go to the later entity, which draws on top.
    if (!best || distance <= best.distance) {
      best = { entityIndex, distance };
    }
  }

  return best;
}

/** Everything inside the rectangle, for a future window-select tool. */
export function pickEntitiesInRect(
  pick: PickBundle,
  index: SpatialIndex,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  options: PickOptions = {},
): number[] {
  const candidates = querySpatialIndex(index, minX, minY, maxX, maxY);
  const results: number[] = [];

  for (const entityIndex of candidates) {
    const layerIndex = pick.layerIndices[entityIndex];
    if (options.hiddenLayers?.has(layerIndex)) continue;
    if (options.lockedLayers?.has(layerIndex)) continue;

    const base = entityIndex * 4;
    const entityMinX = pick.bounds[base];
    if (Number.isNaN(entityMinX)) continue;

    // Fully-contained test, matching AutoCAD's window (as opposed to crossing) select.
    if (
      entityMinX >= minX &&
      pick.bounds[base + 1] >= minY &&
      pick.bounds[base + 2] <= maxX &&
      pick.bounds[base + 3] <= maxY
    ) {
      results.push(entityIndex);
    }
  }

  return results.sort((a, b) => a - b);
}

/**
 * Exact distance from a point to one entity, or `undefined` when the entity has
 * no pickable geometry.
 */
export function distanceToEntity(
  pick: PickBundle,
  entityIndex: number,
  x: number,
  y: number,
  tolerance: number,
): number | undefined {
  const start = pick.ranges[entityIndex * 2];
  const count = pick.ranges[entityIndex * 2 + 1];
  if (count === 0) return undefined;

  const vertices = pick.vertices;
  const kind = pick.kinds[entityIndex];

  switch (kind) {
    case PickKind.Point: {
      return Math.hypot(x - vertices[start * 2], y - vertices[start * 2 + 1]);
    }

    case PickKind.Text: {
      // Text is picked by its bounding box: clicking anywhere on a label should
      // select it, and glyph-accurate testing would need real font metrics.
      const base = entityIndex * 4;
      const minX = pick.bounds[base];
      if (Number.isNaN(minX)) return undefined;

      const dx = Math.max(minX - x, 0, x - pick.bounds[base + 2]);
      const dy = Math.max(pick.bounds[base + 1] - y, 0, y - pick.bounds[base + 3]);
      return Math.hypot(dx, dy);
    }

    case PickKind.Filled: {
      if (pointInPolygon(vertices, start, count, x, y)) return 0;
      return distanceToPolyline(vertices, start, count, x, y, true);
    }

    case PickKind.Polyline:
    default: {
      if (count === 1) {
        return Math.hypot(x - vertices[start * 2], y - vertices[start * 2 + 1]);
      }
      return distanceToPolyline(vertices, start, count, x, y, false, tolerance);
    }
  }
}

/**
 * Nearest distance from a point to a polyline.
 *
 * Exits early once a segment is found within `earlyExit`, because for picking we
 * only need to know the entity is close enough, not the exact minimum.
 */
function distanceToPolyline(
  vertices: Float32Array,
  start: number,
  count: number,
  x: number,
  y: number,
  closed: boolean,
  earlyExit = Number.NEGATIVE_INFINITY,
): number {
  let best = Number.POSITIVE_INFINITY;

  for (let i = 0; i < count - 1; i += 1) {
    const a = (start + i) * 2;
    const b = (start + i + 1) * 2;
    const distance = distanceToSegment(
      x,
      y,
      vertices[a],
      vertices[a + 1],
      vertices[b],
      vertices[b + 1],
    );

    if (distance < best) {
      best = distance;
      if (best <= earlyExit) return best;
    }
  }

  if (closed && count > 2) {
    const last = (start + count - 1) * 2;
    const first = start * 2;
    const distance = distanceToSegment(
      x,
      y,
      vertices[last],
      vertices[last + 1],
      vertices[first],
      vertices[first + 1],
    );
    if (distance < best) best = distance;
  }

  return best;
}

/** Standard ray-crossing test. */
function pointInPolygon(
  vertices: Float32Array,
  start: number,
  count: number,
  x: number,
  y: number,
): boolean {
  let inside = false;

  for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
    const xi = vertices[(start + i) * 2];
    const yi = vertices[(start + i) * 2 + 1];
    const xj = vertices[(start + j) * 2];
    const yj = vertices[(start + j) * 2 + 1];

    // Does the edge straddle the horizontal ray, and is the crossing to the right?
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

/** Extracts an entity's pick polyline, for drawing the selection highlight. */
export function entityPickVertices(pick: PickBundle, entityIndex: number): Float32Array {
  const start = pick.ranges[entityIndex * 2];
  const count = pick.ranges[entityIndex * 2 + 1];
  if (count === 0) return new Float32Array(0);
  return pick.vertices.subarray(start * 2, (start + count) * 2);
}
