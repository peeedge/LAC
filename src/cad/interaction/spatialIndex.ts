/**
 * Uniform-grid spatial index over entity bounding boxes.
 *
 * A grid is chosen over a tree because it builds in a single linear pass with no
 * per-node allocation — important when indexing hundreds of thousands of
 * entities right after a file loads. Queries are small rectangles (a click
 * tolerance or the viewport), which a grid answers well.
 *
 * The whole structure lives in three typed arrays using the standard CSR
 * layout, so there is no per-cell object overhead:
 *   `cellStarts[c] .. cellStarts[c + 1]` indexes into `cellItems`.
 */

import type { BoundingBox } from '../model/boundingBox';
import { boundsHeight, boundsWidth, isEmptyBounds } from '../model/boundingBox';

/** Target average entities per cell; keeps cell counts and scan cost balanced. */
const TARGET_PER_CELL = 4;
const MAX_CELLS = 1 << 20;

export interface SpatialIndex {
  readonly minX: number;
  readonly minY: number;
  readonly cellSize: number;
  readonly columns: number;
  readonly rows: number;
  readonly cellStarts: Uint32Array;
  readonly cellItems: Uint32Array;
}

/**
 * Builds an index from a flat `minX, minY, maxX, maxY` array (4 floats per
 * entity). Entities whose `minX` is `NaN` are treated as having no extent and
 * are skipped.
 */
export function buildSpatialIndex(entityBounds: Float32Array, extent: BoundingBox): SpatialIndex {
  const entityCount = Math.floor(entityBounds.length / 4);

  const width = boundsWidth(extent);
  const height = boundsHeight(extent);

  // Pick a cell size that yields roughly TARGET_PER_CELL entities per cell.
  const area = Math.max(width * height, 1e-9);
  const idealCells = Math.max(1, Math.ceil(entityCount / TARGET_PER_CELL));
  let cellSize = Math.sqrt(area / idealCells);
  if (!Number.isFinite(cellSize) || cellSize <= 0) cellSize = 1;

  let columns = Math.max(1, Math.ceil(width / cellSize) || 1);
  let rows = Math.max(1, Math.ceil(height / cellSize) || 1);

  // Guard against pathological aspect ratios blowing up memory.
  while (columns * rows > MAX_CELLS) {
    cellSize *= 2;
    columns = Math.max(1, Math.ceil(width / cellSize) || 1);
    rows = Math.max(1, Math.ceil(height / cellSize) || 1);
  }

  const cellCount = columns * rows;
  const minX = isEmptyBounds(extent) ? 0 : extent.minX;
  const minY = isEmptyBounds(extent) ? 0 : extent.minY;

  const clampColumn = (value: number): number => (value < 0 ? 0 : value >= columns ? columns - 1 : value);
  const clampRow = (value: number): number => (value < 0 ? 0 : value >= rows ? rows - 1 : value);

  // Pass 1: count how many cells each entity touches, to size `cellItems`.
  const counts = new Uint32Array(cellCount + 1);
  let totalRefs = 0;

  for (let index = 0; index < entityCount; index += 1) {
    const base = index * 4;
    const entityMinX = entityBounds[base];
    if (Number.isNaN(entityMinX)) continue;

    const c0 = clampColumn(Math.floor((entityMinX - minX) / cellSize));
    const r0 = clampRow(Math.floor((entityBounds[base + 1] - minY) / cellSize));
    const c1 = clampColumn(Math.floor((entityBounds[base + 2] - minX) / cellSize));
    const r1 = clampRow(Math.floor((entityBounds[base + 3] - minY) / cellSize));

    for (let row = r0; row <= r1; row += 1) {
      for (let column = c0; column <= c1; column += 1) {
        counts[row * columns + column] += 1;
        totalRefs += 1;
      }
    }
  }

  // Prefix-sum the counts into start offsets.
  const cellStarts = new Uint32Array(cellCount + 1);
  let running = 0;
  for (let cell = 0; cell < cellCount; cell += 1) {
    cellStarts[cell] = running;
    running += counts[cell];
  }
  cellStarts[cellCount] = running;

  // Pass 2: scatter entity indices into their cells.
  const cellItems = new Uint32Array(totalRefs);
  const cursors = cellStarts.slice(0, cellCount);

  for (let index = 0; index < entityCount; index += 1) {
    const base = index * 4;
    const entityMinX = entityBounds[base];
    if (Number.isNaN(entityMinX)) continue;

    const c0 = clampColumn(Math.floor((entityMinX - minX) / cellSize));
    const r0 = clampRow(Math.floor((entityBounds[base + 1] - minY) / cellSize));
    const c1 = clampColumn(Math.floor((entityBounds[base + 2] - minX) / cellSize));
    const r1 = clampRow(Math.floor((entityBounds[base + 3] - minY) / cellSize));

    for (let row = r0; row <= r1; row += 1) {
      for (let column = c0; column <= c1; column += 1) {
        const cell = row * columns + column;
        cellItems[cursors[cell]++] = index;
      }
    }
  }

  return { minX, minY, cellSize, columns, rows, cellStarts, cellItems };
}

/**
 * Collects entity indices whose bounds may overlap the query rectangle.
 *
 * Results may contain duplicates when an entity spans several cells, so the
 * caller is given a `Set`. Callers still need an exact test; this only narrows
 * the candidate list.
 */
export function querySpatialIndex(
  index: SpatialIndex,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Set<number> {
  const { cellSize, columns, rows, cellStarts, cellItems } = index;

  const c0 = Math.max(0, Math.min(columns - 1, Math.floor((minX - index.minX) / cellSize)));
  const r0 = Math.max(0, Math.min(rows - 1, Math.floor((minY - index.minY) / cellSize)));
  const c1 = Math.max(0, Math.min(columns - 1, Math.floor((maxX - index.minX) / cellSize)));
  const r1 = Math.max(0, Math.min(rows - 1, Math.floor((maxY - index.minY) / cellSize)));

  const results = new Set<number>();

  for (let row = r0; row <= r1; row += 1) {
    for (let column = c0; column <= c1; column += 1) {
      const cell = row * columns + column;
      const end = cellStarts[cell + 1];
      for (let i = cellStarts[cell]; i < end; i += 1) {
        results.add(cellItems[i]);
      }
    }
  }

  return results;
}
