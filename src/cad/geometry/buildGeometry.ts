/**
 * Turns a {@link CadDocument} into GPU-ready buffers.
 *
 * Three ideas drive this module:
 *
 * 1. **Origin rebasing.** CAD drawings often sit at huge coordinates (survey
 *    grids in the millions). WebGL vertex attributes are 32-bit floats with ~7
 *    significant digits, so rendering such coordinates directly produces visible
 *    jitter and collapsed geometry. Every vertex is therefore stored relative to
 *    the drawing's centre, and the camera works in that same rebased space. The
 *    offset is added back only when coordinates are displayed.
 *
 * 2. **Batching by layer.** All geometry on a layer is merged into one buffer,
 *    so a drawing with 500k entities still issues only a handful of draw calls
 *    and layer visibility is a single `visible` flag per batch.
 *
 * 3. **One pick buffer.** The same tessellation feeds hit-testing, so a click is
 *    resolved against the exact polyline that is on screen rather than a
 *    re-derived approximation.
 */

import {
  boundsCenter,
  createEmptyBounds,
  expandBounds,
  isEmptyBounds,
  type BoundingBox,
} from '../model/boundingBox';
import type { AnyCadEntity, CadDocument, CadEntityType, CadLayer } from '../model/document';
import type {
  ArcGeometry,
  CircleGeometry,
  EllipseGeometry,
  FaceGeometry,
  LineGeometry,
  Point2D,
  PointGeometry,
  PolylineGeometry,
  SplineGeometry,
  TextGeometry,
} from '../model/geometry';
import { DEFAULT_ENTITY_COLOR } from '../parsers/aci';
import {
  tessellateArc,
  tessellateCircle,
  tessellateEllipse,
  tessellatePolyline,
  tessellateSpline,
} from './tessellate';

/** How an entity should be hit-tested. */
export const PickKind = {
  /** Open or closed polyline: distance to the nearest segment. */
  Polyline: 0,
  /** Single location: distance to the point. */
  Point: 1,
  /** Filled region: inside-polygon test, falling back to the outline. */
  Filled: 2,
  /** Text: bounding-box test. */
  Text: 3,
} as const;

export type PickKind = (typeof PickKind)[keyof typeof PickKind];

/** Merged line geometry for a single layer. */
export interface LineBatch {
  layerIndex: number;
  /** `x, y` pairs, two vertices per segment, in rebased coordinates. */
  positions: Float32Array;
  /** `r, g, b` per vertex in 0..1. */
  colors: Float32Array;
}

export interface PointBatch {
  layerIndex: number;
  positions: Float32Array;
  colors: Float32Array;
}

/** Triangle list for filled entities (SOLID / 3DFACE). */
export interface FaceBatch {
  layerIndex: number;
  positions: Float32Array;
  colors: Float32Array;
}

/** A single piece of text, positioned in rebased coordinates. */
export interface TextRun {
  layerIndex: number;
  entityIndex: number;
  x: number;
  y: number;
  value: string;
  height: number;
  rotation: number;
  widthFactor: number;
  horizontalAlign: TextGeometry['horizontalAlign'];
  verticalAlign: TextGeometry['verticalAlign'];
  color: string;
}

/**
 * Flat hit-testing geometry for every entity, indexed by the entity's ordinal
 * position in `CadDocument.entities`.
 */
export interface PickBundle {
  /** Concatenated polyline vertices (`x, y` pairs), rebased. */
  vertices: Float32Array;
  /** Two entries per entity: vertex start index and vertex count. */
  ranges: Uint32Array;
  /** One {@link PickKind} per entity. */
  kinds: Uint8Array;
  /** One layer index per entity. */
  layerIndices: Uint16Array;
  /** Four entries per entity: `minX, minY, maxX, maxY`, rebased. */
  bounds: Float32Array;
  entityCount: number;
}

export interface GeometryBundle {
  /** World coordinate of the rebased origin; add this back to display values. */
  origin: Point2D;
  /** Drawing bounds in world coordinates. */
  worldBounds: BoundingBox;
  /** Drawing bounds in rebased coordinates (what the camera uses). */
  viewBounds: BoundingBox;
  lineBatches: LineBatch[];
  pointBatches: PointBatch[];
  faceBatches: FaceBatch[];
  textRuns: TextRun[];
  pick: PickBundle;
  /** Total line segments produced, for the statistics panel. */
  segmentCount: number;
}

export interface BuildGeometryOptions {
  tolerance?: number;
  /** Upper bound on rendered text runs; drawings can contain enormous amounts. */
  maxTextRuns?: number;
  onProgress?: (processed: number, total: number) => void;
}

const DEFAULT_MAX_TEXT_RUNS = 20_000;

/** Parses `#rrggbb` into normalised RGB. Falls back to light grey. */
function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(value)) return [0.85, 0.85, 0.85];
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

/**
 * Growable float buffer. Using a plain array of numbers and converting once at
 * the end is measurably slower and allocates far more than doubling a typed
 * array, which matters on multi-hundred-thousand entity drawings.
 */
class FloatBuffer {
  private data: Float32Array;
  private length = 0;

  constructor(initialCapacity = 1024) {
    this.data = new Float32Array(Math.max(initialCapacity, 16));
  }

  private ensure(extra: number): void {
    if (this.length + extra <= this.data.length) return;
    let capacity = this.data.length * 2;
    while (capacity < this.length + extra) capacity *= 2;
    const grown = new Float32Array(capacity);
    grown.set(this.data.subarray(0, this.length));
    this.data = grown;
  }

  push2(a: number, b: number): void {
    this.ensure(2);
    this.data[this.length++] = a;
    this.data[this.length++] = b;
  }

  push3(a: number, b: number, c: number): void {
    this.ensure(3);
    this.data[this.length++] = a;
    this.data[this.length++] = b;
    this.data[this.length++] = c;
  }

  get size(): number {
    return this.length;
  }

  /** Returns a right-sized copy, leaving this buffer reusable. */
  toArray(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

/** Per-layer accumulators, created lazily so empty layers cost nothing. */
interface LayerAccumulator {
  lines: FloatBuffer;
  lineColors: FloatBuffer;
  points: FloatBuffer;
  pointColors: FloatBuffer;
  faces: FloatBuffer;
  faceColors: FloatBuffer;
}

function createAccumulator(): LayerAccumulator {
  return {
    lines: new FloatBuffer(4096),
    lineColors: new FloatBuffer(6144),
    points: new FloatBuffer(256),
    pointColors: new FloatBuffer(384),
    faces: new FloatBuffer(256),
    faceColors: new FloatBuffer(384),
  };
}

/** Entity types that tessellate to a single open/closed polyline. */
const POLYLINE_TYPES = new Set<CadEntityType>([
  'LINE',
  'POLYLINE',
  'LWPOLYLINE',
  'CIRCLE',
  'ARC',
  'ELLIPSE',
  'SPLINE',
]);

export function buildGeometry(
  document: CadDocument,
  options: BuildGeometryOptions = {},
): GeometryBundle {
  const tolerance = options.tolerance;
  const maxTextRuns = options.maxTextRuns ?? DEFAULT_MAX_TEXT_RUNS;

  // Rebase around the drawing centre so float32 precision is spent on the
  // drawing's own extent rather than its distance from the origin.
  const origin = boundsCenter(document.bounds);
  const originX = origin.x;
  const originY = origin.y;

  const layerIndexById = new Map<string, number>();
  document.layers.forEach((layer, index) => layerIndexById.set(layer.id, index));

  const layerColors = document.layers.map((layer) => hexToRgb(layer.color));
  const accumulators = new Map<number, LayerAccumulator>();

  const getAccumulator = (layerIndex: number): LayerAccumulator => {
    let accumulator = accumulators.get(layerIndex);
    if (!accumulator) {
      accumulator = createAccumulator();
      accumulators.set(layerIndex, accumulator);
    }
    return accumulator;
  };

  const entities = document.entities;
  const entityCount = entities.length;

  // Pick buffers are sized exactly where possible and grown where not.
  const pickVertices = new FloatBuffer(Math.max(entityCount * 4, 1024));
  const pickRanges = new Uint32Array(entityCount * 2);
  const pickKinds = new Uint8Array(entityCount);
  const pickLayers = new Uint16Array(entityCount);
  const pickBounds = new Float32Array(entityCount * 4);

  const textRuns: TextRun[] = [];
  const viewBounds = createEmptyBounds();
  let segmentCount = 0;
  let textOverflow = 0;

  const progressInterval = Math.max(1, Math.floor(entityCount / 50));

  // Reused across iterations to avoid per-entity array allocation.
  let flat: number[] = [];

  for (let index = 0; index < entityCount; index += 1) {
    const entity = entities[index];
    const layerIndex = layerIndexById.get(entity.layerId) ?? 0;
    pickLayers[index] = layerIndex;

    const [r, g, b] = entity.color
      ? hexToRgb(entity.color)
      : (layerColors[layerIndex] ?? hexToRgb(DEFAULT_ENTITY_COLOR));

    const accumulator = getAccumulator(layerIndex);
    const pickStart = pickVertices.size / 2;
    let pickCount = 0;

    if (POLYLINE_TYPES.has(entity.type)) {
      flat = tessellateEntity(entity, tolerance);
      pickKinds[index] = PickKind.Polyline;

      const vertexCount = flat.length / 2;
      for (let v = 0; v < vertexCount; v += 1) {
        const x = flat[v * 2] - originX;
        const y = flat[v * 2 + 1] - originY;
        pickVertices.push2(x, y);
        expandBounds(viewBounds, x, y);
      }
      pickCount = vertexCount;

      // Expand the polyline into GL_LINES pairs: each interior vertex is shared
      // by two segments, so it is written twice.
      for (let v = 0; v < vertexCount - 1; v += 1) {
        accumulator.lines.push2(flat[v * 2] - originX, flat[v * 2 + 1] - originY);
        accumulator.lines.push2(flat[v * 2 + 2] - originX, flat[v * 2 + 3] - originY);
        accumulator.lineColors.push3(r, g, b);
        accumulator.lineColors.push3(r, g, b);
        segmentCount += 1;
      }
    } else if (entity.type === 'POINT') {
      const geometry = entity.geometry as PointGeometry;
      const x = geometry.position.x - originX;
      const y = geometry.position.y - originY;

      accumulator.points.push2(x, y);
      accumulator.pointColors.push3(r, g, b);

      pickKinds[index] = PickKind.Point;
      pickVertices.push2(x, y);
      pickCount = 1;
      expandBounds(viewBounds, x, y);
    } else if (entity.type === 'SOLID' || entity.type === 'FACE') {
      const geometry = entity.geometry as FaceGeometry;
      const points = geometry.points;

      pickKinds[index] = PickKind.Filled;
      for (const point of points) {
        const x = point.x - originX;
        const y = point.y - originY;
        pickVertices.push2(x, y);
        expandBounds(viewBounds, x, y);
      }
      pickCount = points.length;

      // Fan-triangulate. SOLID/3DFACE are at most quads and always convex, so a
      // fan from the first vertex is correct without a general tessellator.
      for (let t = 1; t + 1 < points.length; t += 1) {
        for (const point of [points[0], points[t], points[t + 1]]) {
          accumulator.faces.push2(point.x - originX, point.y - originY);
          accumulator.faceColors.push3(r, g, b);
        }
      }
    } else if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
      const geometry = entity.geometry as TextGeometry;
      pickKinds[index] = PickKind.Text;

      const x = geometry.position.x - originX;
      const y = geometry.position.y - originY;
      pickVertices.push2(x, y);
      pickCount = 1;

      if (textRuns.length < maxTextRuns) {
        textRuns.push({
          layerIndex,
          entityIndex: index,
          x,
          y,
          value: geometry.value,
          height: geometry.height,
          rotation: geometry.rotation,
          widthFactor: geometry.widthFactor,
          horizontalAlign: geometry.horizontalAlign,
          verticalAlign: geometry.verticalAlign,
          color: entity.color ?? document.layers[layerIndex]?.color ?? DEFAULT_ENTITY_COLOR,
        });
      } else {
        textOverflow += 1;
      }

      // Use the precomputed text bounds so the view fits labels correctly.
      if (!isEmptyBounds(entity.bounds)) {
        expandBounds(viewBounds, entity.bounds.minX - originX, entity.bounds.minY - originY);
        expandBounds(viewBounds, entity.bounds.maxX - originX, entity.bounds.maxY - originY);
      }
    } else {
      // INSERT entities are expanded during normalisation, so reaching here
      // means a type with no renderable representation. Record an empty range.
      pickKinds[index] = PickKind.Point;
    }

    pickRanges[index * 2] = pickStart;
    pickRanges[index * 2 + 1] = pickCount;

    const bounds = entity.bounds;
    if (!isEmptyBounds(bounds)) {
      pickBounds[index * 4] = bounds.minX - originX;
      pickBounds[index * 4 + 1] = bounds.minY - originY;
      pickBounds[index * 4 + 2] = bounds.maxX - originX;
      pickBounds[index * 4 + 3] = bounds.maxY - originY;
    } else {
      // Mark as degenerate so the spatial index can skip it.
      pickBounds[index * 4] = Number.NaN;
    }

    if (options.onProgress && index % progressInterval === 0) {
      options.onProgress(index, entityCount);
    }
  }

  options.onProgress?.(entityCount, entityCount);

  if (textOverflow > 0) {
    document.diagnostics.push({
      severity: 'info',
      message: `${textOverflow} additional text entities were not rendered (limit ${maxTextRuns}).`,
      count: 1,
    });
  }

  // Collapse accumulators into right-sized batches, skipping empty ones.
  const lineBatches: LineBatch[] = [];
  const pointBatches: PointBatch[] = [];
  const faceBatches: FaceBatch[] = [];

  for (const [layerIndex, accumulator] of accumulators) {
    if (accumulator.lines.size > 0) {
      lineBatches.push({
        layerIndex,
        positions: accumulator.lines.toArray(),
        colors: accumulator.lineColors.toArray(),
      });
    }
    if (accumulator.points.size > 0) {
      pointBatches.push({
        layerIndex,
        positions: accumulator.points.toArray(),
        colors: accumulator.pointColors.toArray(),
      });
    }
    if (accumulator.faces.size > 0) {
      faceBatches.push({
        layerIndex,
        positions: accumulator.faces.toArray(),
        colors: accumulator.faceColors.toArray(),
      });
    }
  }

  return {
    origin: { x: originX, y: originY },
    worldBounds: document.bounds,
    viewBounds,
    lineBatches,
    pointBatches,
    faceBatches,
    textRuns,
    pick: {
      vertices: pickVertices.toArray(),
      ranges: pickRanges,
      kinds: pickKinds,
      layerIndices: pickLayers,
      bounds: pickBounds,
      entityCount,
    },
    segmentCount,
  };
}

/** Dispatches an entity to the matching tessellator. */
function tessellateEntity(entity: AnyCadEntity, tolerance?: number): number[] {
  const options = tolerance === undefined ? undefined : { tolerance };

  switch (entity.type) {
    case 'LINE': {
      const geometry = entity.geometry as LineGeometry;
      return [geometry.start.x, geometry.start.y, geometry.end.x, geometry.end.y];
    }
    case 'CIRCLE':
      return tessellateCircle(entity.geometry as CircleGeometry, options);
    case 'ARC':
      return tessellateArc(entity.geometry as ArcGeometry, options);
    case 'ELLIPSE':
      return tessellateEllipse(entity.geometry as EllipseGeometry, options);
    case 'POLYLINE':
    case 'LWPOLYLINE':
      return tessellatePolyline(entity.geometry as PolylineGeometry, options);
    case 'SPLINE':
      return tessellateSpline(entity.geometry as SplineGeometry, options);
    default:
      return [];
  }
}

/** Convenience helper: the layer a batch belongs to. */
export function layerOfBatch(layers: readonly CadLayer[], layerIndex: number): CadLayer | undefined {
  return layers[layerIndex];
}
