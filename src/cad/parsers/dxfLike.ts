/**
 * Normalises "DXF-shaped" data into the {@link CadDocument} model.
 *
 * Both of our parsers emit DXF-flavoured objects: `dxf-parser` by definition,
 * and `@mlightcad/libredwg-web` because it models the DWG database using the
 * same group-code vocabulary. The field names differ in small ways (`startPoint`
 * vs `vertices[0]`, `knots` vs `knotValues`, `POLYLINE2D` vs `POLYLINE`), so the
 * readers below accept either spelling. That lets one normaliser serve both
 * formats, and means a third format only needs to produce this loose shape.
 *
 * Nothing here throws on bad input: an entity that cannot be understood becomes
 * a diagnostic so a single malformed record never fails an entire import.
 */

import {
  createEmptyBounds,
  expandBounds,
  isEmptyBounds,
  type BoundingBox,
} from '../model/boundingBox';
import {
  DEFAULT_LAYER_ID,
  createDefaultLayer,
  isCadEntityType,
  resolveUnits,
  type AnyCadEntity,
  type CadBlock,
  type CadDiagnostic,
  type CadEntityType,
  type CadLayer,
  type CadUnits,
} from '../model/document';
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
  PolylineVertex,
  SplineGeometry,
  TextGeometry,
  TextHorizontalAlign,
  TextVerticalAlign,
} from '../model/geometry';
import { computeEntityBounds } from '../geometry/entityBounds';
import { createInsertMatrix, multiplyMatrix, transformEntity, type Matrix2D } from '../geometry/transform';
import { aciToHex, resolveEntityColor } from './aci';

/** A loosely typed record straight out of a format parser. */
export type RawRecord = Record<string, unknown>;

export interface DxfLikeLayer {
  name: string;
  colorIndex?: number;
  color?: number;
  /** DXF semantics: a layer is hidden when `off` is true or `visible` is false. */
  off?: boolean;
  visible?: boolean;
  frozen?: boolean;
  locked?: boolean;
}

export interface DxfLikeBlock {
  name: string;
  /** Either `basePoint` (DWG) or `position` (DXF). */
  basePoint?: RawRecord;
  position?: RawRecord;
  entities?: readonly RawRecord[];
}

export interface DxfLikeSource {
  entities: readonly RawRecord[];
  layers: readonly DxfLikeLayer[];
  blocks: readonly DxfLikeBlock[];
  header?: RawRecord;
}

export interface NormaliseOptions {
  /** Maximum nesting depth when expanding block references. */
  maxBlockDepth?: number;
  /** Invoked periodically so a worker can report progress. */
  onProgress?: (processed: number, total: number) => void;
}

export interface NormalisedDocument {
  layers: CadLayer[];
  entities: AnyCadEntity[];
  blocks: Map<string, CadBlock>;
  bounds: BoundingBox;
  units: CadUnits;
  headerBounds?: BoundingBox;
  version?: string;
  diagnostics: CadDiagnostic[];
}

const DEFAULT_MAX_BLOCK_DEPTH = 8;

/** Collects diagnostics, collapsing duplicates into a count. */
class DiagnosticCollector {
  private readonly entries = new Map<string, CadDiagnostic>();

  add(severity: CadDiagnostic['severity'], message: string, entityType?: string): void {
    const key = `${severity}:${message}`;
    const existing = this.entries.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    this.entries.set(key, { severity, message, count: 1, entityType });
  }

  unsupportedEntity(type: string): void {
    this.add('warning', `Unsupported entity: ${type}`, type);
  }

  toArray(): CadDiagnostic[] {
    // Errors first, then warnings, then info; most frequent first within a group.
    const order: Record<CadDiagnostic['severity'], number> = { error: 0, warning: 1, info: 2 };
    return [...this.entries.values()].sort(
      (a, b) => order[a.severity] - order[b.severity] || b.count - a.count,
    );
  }
}

// ---------------------------------------------------------------------------
// Field readers — tolerant of the small naming differences between parsers.
// ---------------------------------------------------------------------------

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Reads a point from any `{x, y}`-like record. */
function point(value: unknown): Point2D | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as RawRecord;
  const x = record.x;
  const y = record.y;
  if (typeof x !== 'number' || typeof y !== 'number') return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

/** Returns the first defined value among the given keys. */
function pick(record: RawRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function pickPoint(record: RawRecord, ...keys: string[]): Point2D | undefined {
  for (const key of keys) {
    const candidate = point(record[key]);
    if (candidate) return candidate;
  }
  return undefined;
}

function pickPointArray(value: unknown): Point2D[] {
  if (!Array.isArray(value)) return [];
  const points: Point2D[] = [];
  for (const item of value) {
    const parsed = point(item);
    if (parsed) points.push(parsed);
  }
  return points;
}

function pickNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
}

/** DXF group code 70 bit 1 means "closed" on polylines and splines. */
function hasClosedFlag(record: RawRecord): boolean {
  if (record.shape === true || record.closed === true) return true;
  const flag = record.flag ?? record.flags;
  return typeof flag === 'number' && (flag & 1) === 1;
}

// ---------------------------------------------------------------------------
// Entity type mapping
// ---------------------------------------------------------------------------

/**
 * Maps source type names onto our model. LibreDWG splits POLYLINE into
 * `POLYLINE2D`/`POLYLINE3D`; DXF calls 3DFACE what we model as FACE.
 */
const TYPE_ALIASES: Record<string, CadEntityType> = {
  LINE: 'LINE',
  POLYLINE: 'POLYLINE',
  POLYLINE2D: 'POLYLINE',
  POLYLINE3D: 'POLYLINE',
  LWPOLYLINE: 'LWPOLYLINE',
  CIRCLE: 'CIRCLE',
  ARC: 'ARC',
  ELLIPSE: 'ELLIPSE',
  SPLINE: 'SPLINE',
  POINT: 'POINT',
  TEXT: 'TEXT',
  MTEXT: 'MTEXT',
  ATTRIB: 'TEXT',
  ATTDEF: 'TEXT',
  INSERT: 'INSERT',
  SOLID: 'SOLID',
  '3DFACE': 'FACE',
  FACE3D: 'FACE',
};

function mapEntityType(rawType: string): CadEntityType | undefined {
  const upper = rawType.toUpperCase();
  const alias = TYPE_ALIASES[upper];
  if (alias) return alias;
  return isCadEntityType(upper) ? upper : undefined;
}

// ---------------------------------------------------------------------------
// Geometry converters
// ---------------------------------------------------------------------------

type GeometryConverter = (record: RawRecord) => unknown | undefined;

const CONVERTERS: Record<CadEntityType, GeometryConverter> = {
  LINE: (record) => {
    // DWG exposes startPoint/endPoint; dxf-parser exposes a 2-element vertices array.
    let start = pickPoint(record, 'startPoint', 'start');
    let end = pickPoint(record, 'endPoint', 'end');

    if (!start || !end) {
      const vertices = pickPointArray(record.vertices);
      start ??= vertices[0];
      end ??= vertices[1];
    }

    if (!start || !end) return undefined;
    return { start, end } satisfies LineGeometry;
  },

  POINT: (record) => {
    const position = pickPoint(record, 'position', 'startPoint', 'center');
    return position ? ({ position } satisfies PointGeometry) : undefined;
  },

  CIRCLE: (record) => {
    const center = pickPoint(record, 'center');
    const radius = num(record.radius);
    if (!center || radius <= 0) return undefined;
    return { center, radius } satisfies CircleGeometry;
  },

  ARC: (record) => {
    const center = pickPoint(record, 'center');
    const radius = num(record.radius);
    if (!center || radius <= 0) return undefined;
    return {
      center,
      radius,
      startAngle: num(record.startAngle),
      endAngle: num(record.endAngle),
    } satisfies ArcGeometry;
  },

  ELLIPSE: (record) => {
    const center = pickPoint(record, 'center');
    const majorAxis = pickPoint(record, 'majorAxisEndPoint', 'majorAxis');
    if (!center || !majorAxis) return undefined;
    return {
      center,
      majorAxis,
      axisRatio: num(record.axisRatio, 1) || 1,
      startAngle: num(record.startAngle, 0),
      // A zero end angle on an ellipse means a full turn, not a degenerate arc.
      endAngle: num(record.endAngle, Math.PI * 2) || Math.PI * 2,
    } satisfies EllipseGeometry;
  },

  POLYLINE: convertPolyline,
  LWPOLYLINE: convertPolyline,

  SPLINE: (record) => {
    const controlPoints = pickPointArray(pick(record, 'controlPoints'));
    const fitPoints = pickPointArray(pick(record, 'fitPoints'));
    if (controlPoints.length === 0 && fitPoints.length === 0) return undefined;

    return {
      controlPoints,
      fitPoints,
      knots: pickNumberArray(pick(record, 'knots', 'knotValues')),
      weights: pickNumberArray(pick(record, 'weights')),
      degree: num(pick(record, 'degree', 'degreeOfSplineCurve'), 3) || 3,
      closed: hasClosedFlag(record),
    } satisfies SplineGeometry;
  },

  TEXT: (record) => convertText(record, false),
  MTEXT: (record) => convertText(record, true),

  INSERT: (record) => {
    const position = pickPoint(record, 'insertionPoint', 'position');
    const blockName = str(record.name);
    if (!position || !blockName) return undefined;

    return {
      position,
      blockName,
      // A zero scale would collapse the block; treat it as unset.
      scaleX: num(record.xScale, 1) || 1,
      scaleY: num(record.yScale, 1) || 1,
      rotation: num(record.rotation, 0),
    } satisfies InsertGeometry;
  },

  SOLID: convertFace,
  FACE: convertFace,
};

function convertPolyline(record: RawRecord): PolylineGeometry | undefined {
  const raw = record.vertices;
  if (!Array.isArray(raw)) return undefined;

  const vertices: PolylineVertex[] = [];
  for (const item of raw) {
    const parsed = point(item);
    if (!parsed) continue;
    const bulge = typeof (item as RawRecord)?.bulge === 'number' ? ((item as RawRecord).bulge as number) : 0;
    vertices.push(bulge === 0 ? parsed : { ...parsed, bulge });
  }

  if (vertices.length === 0) return undefined;
  return { vertices, closed: hasClosedFlag(record) };
}

function convertFace(record: RawRecord): FaceGeometry | undefined {
  // DWG SOLID/3DFACE expose corner1..corner4; dxf-parser exposes a points array.
  let points = pickPointArray(record.points);

  if (points.length === 0) {
    points = ['corner1', 'corner2', 'corner3', 'corner4']
      .map((key) => point(record[key]))
      .filter((value): value is Point2D => value !== undefined);
  }

  return points.length >= 3 ? { points } : undefined;
}

const H_ALIGN: Record<number, TextHorizontalAlign> = {
  0: 'left',
  1: 'center',
  2: 'right',
  3: 'left', // Aligned — treated as left; true fitting needs font metrics.
  4: 'center', // Middle
  5: 'left', // Fit
};

const V_ALIGN: Record<number, TextVerticalAlign> = {
  0: 'baseline',
  1: 'bottom',
  2: 'middle',
  3: 'top',
};

/**
 * MTEXT attachment points 1-9 encode a 3x3 grid of
 * (top|middle|bottom) x (left|center|right).
 */
function mtextAlignment(attachmentPoint: number): {
  horizontal: TextHorizontalAlign;
  vertical: TextVerticalAlign;
} {
  const clamped = attachmentPoint >= 1 && attachmentPoint <= 9 ? attachmentPoint : 1;
  const row = Math.floor((clamped - 1) / 3);
  const column = (clamped - 1) % 3;

  return {
    vertical: (['top', 'middle', 'bottom'] as const)[row],
    horizontal: (['left', 'center', 'right'] as const)[column],
  };
}

/**
 * Strips MTEXT inline formatting codes, e.g. `\A1;`, `{\fArial|b0;text}`,
 * `\P` (paragraph break). We keep the literal text and the line structure,
 * which is what a 2D preview needs; full rich-text layout is out of scope.
 */
export function stripMTextFormatting(input: string): string {
  let text = input;

  // Paragraph breaks become real newlines before other codes are removed.
  text = text.replace(/\\P/gi, '\n');
  // Stacked fractions: `\S1/2;` → `1/2`.
  text = text.replace(/\\S([^;]*);/gi, (_match, body: string) => body.replace(/[\\^#]/g, '/'));
  // Property changes that take an argument terminated by `;`.
  text = text.replace(/\\[A-Za-z](?:[^\\;]*);/g, '');
  // Escaped braces and backslashes.
  text = text.replace(/\\([{}\\])/g, '$1');
  // Remaining grouping braces.
  text = text.replace(/[{}]/g, '');

  return text;
}

function convertText(record: RawRecord, isMText: boolean): TextGeometry | undefined {
  const position = pickPoint(record, isMText ? 'insertionPoint' : 'startPoint', 'position', 'insertionPoint', 'startPoint');
  if (!position) return undefined;

  const rawValue = str(record.text) ?? '';
  const value = isMText ? stripMTextFormatting(rawValue) : rawValue;
  if (value.trim().length === 0) return undefined;

  const height = num(pick(record, 'textHeight', 'height'), 0);
  if (height <= 0) return undefined;

  if (isMText) {
    const alignment = mtextAlignment(num(record.attachmentPoint, 1));
    return {
      position,
      value,
      height,
      rotation: num(record.rotation, 0),
      widthFactor: 1,
      horizontalAlign: alignment.horizontal,
      verticalAlign: alignment.vertical,
    };
  }

  // TEXT with a non-left justification positions itself at `endPoint` instead.
  const halign = num(record.halign, 0);
  const valign = num(record.valign, 0);
  const alignmentPoint = pickPoint(record, 'endPoint');
  const usesAlignmentPoint = (halign !== 0 || valign !== 0) && alignmentPoint !== undefined;

  return {
    position: usesAlignmentPoint ? alignmentPoint : position,
    value,
    height,
    rotation: num(record.rotation, 0),
    widthFactor: num(record.xScale, 1) || 1,
    horizontalAlign: H_ALIGN[halign] ?? 'left',
    verticalAlign: V_ALIGN[valign] ?? 'baseline',
  };
}

// ---------------------------------------------------------------------------
// Layer handling
// ---------------------------------------------------------------------------

function buildLayers(source: readonly DxfLikeLayer[]): Map<string, CadLayer> {
  const layers = new Map<string, CadLayer>();

  for (const raw of source) {
    const name = raw.name?.trim();
    if (!name) continue;

    const frozen = raw.frozen === true;
    // `off` (DWG) and `visible === false` (DXF) both mean hidden.
    const off = raw.off === true || raw.visible === false;

    layers.set(name, {
      id: name,
      name,
      color: aciToHex(raw.colorIndex) ?? resolveEntityColor(raw) ?? '#ffffff',
      visible: !off && !frozen,
      locked: raw.locked === true,
      frozen,
      entityCount: 0,
    });
  }

  if (!layers.has(DEFAULT_LAYER_ID)) {
    layers.set(DEFAULT_LAYER_ID, createDefaultLayer());
  }

  return layers;
}

// ---------------------------------------------------------------------------
// Main normalisation
// ---------------------------------------------------------------------------

export function normaliseDxfLike(
  source: DxfLikeSource,
  options: NormaliseOptions = {},
): NormalisedDocument {
  const diagnostics = new DiagnosticCollector();
  const layers = buildLayers(source.layers);
  const maxBlockDepth = options.maxBlockDepth ?? DEFAULT_MAX_BLOCK_DEPTH;

  let nextId = 0;
  const makeId = (): string => `e${(nextId += 1)}`;

  /** Ensures an entity's layer exists, creating a placeholder if the table missed it. */
  const resolveLayerId = (rawLayer: unknown): string => {
    const name = str(rawLayer);
    if (!name) return DEFAULT_LAYER_ID;

    if (!layers.has(name)) {
      layers.set(name, { ...createDefaultLayer(), id: name, name });
      diagnostics.add('info', `Layer “${name}” was referenced but not defined in the layer table.`);
    }

    return name;
  };

  /**
   * Converts one raw record. Returns `undefined` for records we cannot use,
   * recording a diagnostic in the process.
   */
  const convertEntity = (record: RawRecord, id: string): AnyCadEntity | undefined => {
    const rawType = str(record.type);
    if (!rawType) {
      diagnostics.add('warning', 'Skipped a record with no entity type.');
      return undefined;
    }

    const type = mapEntityType(rawType);
    if (!type) {
      diagnostics.unsupportedEntity(rawType.toUpperCase());
      return undefined;
    }

    let geometry: unknown;
    try {
      geometry = CONVERTERS[type](record);
    } catch (error) {
      console.error(`[LiteCAD] failed to convert ${rawType}`, error, record);
      diagnostics.add('warning', `Skipped a malformed ${rawType} entity.`);
      return undefined;
    }

    if (geometry === undefined) {
      diagnostics.add('warning', `Skipped a ${rawType} entity with incomplete geometry.`);
      return undefined;
    }

    // DXF marks invisible entities with group code 60 = 1.
    if (record.isVisible === false || record.visible === false) return undefined;

    const entity: AnyCadEntity = {
      id,
      type,
      layerId: resolveLayerId(record.layer),
      color: resolveEntityColor(record as { color?: number; colorIndex?: number }),
      lineType: str(record.lineType),
      geometry: geometry as never,
      bounds: createEmptyBounds(),
      handle: typeof record.handle === 'string' ? record.handle : str(String(record.handle ?? '')),
    };

    entity.bounds = computeEntityBounds(entity);
    return entity;
  };

  // --- Block definitions -------------------------------------------------
  // Converted first so INSERT expansion has something to reference. Block
  // contents are stored in block-local coordinates.
  const blocks = new Map<string, CadBlock>();

  for (const rawBlock of source.blocks) {
    const name = rawBlock.name?.trim();
    if (!name) continue;

    const basePoint = point(rawBlock.basePoint) ?? point(rawBlock.position) ?? { x: 0, y: 0 };
    const entities: AnyCadEntity[] = [];

    for (const record of rawBlock.entities ?? []) {
      const entity = convertEntity(record, makeId());
      if (entity) entities.push(entity);
    }

    blocks.set(name, { name, basePoint, entities });
  }

  // --- Model space entities ---------------------------------------------
  const entities: AnyCadEntity[] = [];
  const bounds = createEmptyBounds();
  let expandedReferences = 0;
  let unresolvedBlocks = 0;

  const addEntity = (entity: AnyCadEntity): void => {
    entities.push(entity);
    if (!isEmptyBounds(entity.bounds)) {
      expandBounds(bounds, entity.bounds.minX, entity.bounds.minY);
      expandBounds(bounds, entity.bounds.maxX, entity.bounds.maxY);
    }
    const layer = layers.get(entity.layerId);
    if (layer) layer.entityCount += 1;
  };

  /**
   * Expands a block reference into world-space entities.
   *
   * `visited` guards against a block that (directly or indirectly) inserts
   * itself, which would otherwise recurse forever on a malformed file.
   */
  const expandInsert = (
    insert: AnyCadEntity,
    parentMatrix: Matrix2D,
    depth: number,
    visited: ReadonlySet<string>,
  ): void => {
    const geometry = insert.geometry as InsertGeometry;
    const block = blocks.get(geometry.blockName);

    if (!block) {
      unresolvedBlocks += 1;
      diagnostics.add('warning', `Block “${geometry.blockName}” is referenced but not defined.`);
      return;
    }

    if (depth > maxBlockDepth) {
      diagnostics.add(
        'warning',
        `Stopped expanding block “${geometry.blockName}” at ${maxBlockDepth} levels of nesting.`,
      );
      return;
    }

    if (visited.has(geometry.blockName)) {
      diagnostics.add('warning', `Block “${geometry.blockName}” references itself; skipped.`);
      return;
    }

    expandedReferences += 1;

    // Block contents are defined relative to the block's base point.
    const local = multiplyMatrix(
      createInsertMatrix(
        geometry.position.x,
        geometry.position.y,
        geometry.scaleX,
        geometry.scaleY,
        geometry.rotation,
      ),
      [1, 0, 0, 1, -block.basePoint.x, -block.basePoint.y],
    );
    const matrix = multiplyMatrix(parentMatrix, local);
    const nextVisited = new Set(visited).add(geometry.blockName);
    const blockPath = insert.blockPath
      ? `${insert.blockPath}/${geometry.blockName}`
      : geometry.blockName;

    for (const child of block.entities) {
      const transformed = transformEntity(child, matrix, makeId(), blockPath);

      // Entities inside a block drawn on layer "0" inherit the reference's layer.
      if (transformed.layerId === DEFAULT_LAYER_ID) transformed.layerId = insert.layerId;
      // A ByBlock colour resolves to the reference's colour.
      transformed.color ??= insert.color;

      if (transformed.type === 'INSERT') {
        expandInsert(transformed, matrix, depth + 1, nextVisited);
      } else {
        addEntity(transformed);
      }
    }
  };

  const total = source.entities.length;
  const progressInterval = Math.max(1, Math.floor(total / 50));

  for (let index = 0; index < total; index += 1) {
    const record = source.entities[index];

    // Paper-space entities are not part of model space.
    if (record.isInPaperSpace === true || record.inPaperSpace === true) continue;

    const entity = convertEntity(record, makeId());
    if (entity) {
      if (entity.type === 'INSERT') {
        expandInsert(entity, [1, 0, 0, 1, 0, 0], 1, new Set());
      } else {
        addEntity(entity);
      }
    }

    if (options.onProgress && index % progressInterval === 0) {
      options.onProgress(index, total);
    }
  }

  options.onProgress?.(total, total);

  if (expandedReferences > 0) {
    diagnostics.add(
      'info',
      `Expanded ${expandedReferences} block reference${expandedReferences === 1 ? '' : 's'} into geometry.`,
    );
  }
  if (unresolvedBlocks > 0) {
    diagnostics.add('warning', `${unresolvedBlocks} block reference(s) could not be resolved.`);
  }

  // --- Header-derived metadata ------------------------------------------
  // `dxf-parser` keys header variables with their DXF `$` prefix, while LibreDWG
  // strips it, so both spellings are accepted.
  const header = source.header ?? {};
  const headerValue = (name: string): unknown => pick(header, name, `$${name}`);

  const rawUnits = headerValue('INSUNITS');
  const units = resolveUnits(typeof rawUnits === 'number' ? rawUnits : undefined);

  const extMin = point(headerValue('EXTMIN'));
  const extMax = point(headerValue('EXTMAX'));
  const headerBounds =
    extMin && extMax
      ? { minX: extMin.x, minY: extMin.y, maxX: extMax.x, maxY: extMax.y }
      : undefined;

  return {
    layers: [...layers.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    entities,
    blocks,
    bounds,
    units,
    headerBounds,
    version: str(headerValue('ACADVER')),
    diagnostics: diagnostics.toArray(),
  };
}
