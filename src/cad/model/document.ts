/**
 * The normalised CAD document model.
 *
 * Everything downstream of parsing — geometry building, rendering, selection,
 * the layer panel, the property inspector — reads only these types. No DWG or
 * DXF specific concept is allowed to leak past this boundary, which is what
 * makes the parser swappable.
 */

import type { BoundingBox } from './boundingBox';
import type { CadGeometry } from './geometry';

/**
 * Entity types the geometry pipeline understands. Anything a parser produces
 * outside this list is recorded as an unsupported-entity diagnostic instead of
 * being silently dropped or crashing the import.
 */
export const CAD_ENTITY_TYPES = [
  'LINE',
  'POLYLINE',
  'LWPOLYLINE',
  'CIRCLE',
  'ARC',
  'ELLIPSE',
  'SPLINE',
  'POINT',
  'TEXT',
  'MTEXT',
  'INSERT',
  'SOLID',
  'FACE',
] as const;

export type CadEntityType = (typeof CAD_ENTITY_TYPES)[number];

const ENTITY_TYPE_SET = new Set<string>(CAD_ENTITY_TYPES);

export function isCadEntityType(value: string): value is CadEntityType {
  return ENTITY_TYPE_SET.has(value);
}

/** Which of the geometry kinds a given entity type carries. */
export type GeometryForEntity<T extends CadEntityType> = T extends 'LINE'
  ? import('./geometry').LineGeometry
  : T extends 'CIRCLE'
    ? import('./geometry').CircleGeometry
    : T extends 'ARC'
      ? import('./geometry').ArcGeometry
      : T extends 'ELLIPSE'
        ? import('./geometry').EllipseGeometry
        : T extends 'POLYLINE' | 'LWPOLYLINE'
          ? import('./geometry').PolylineGeometry
          : T extends 'SPLINE'
            ? import('./geometry').SplineGeometry
            : T extends 'POINT'
              ? import('./geometry').PointGeometry
              : T extends 'TEXT' | 'MTEXT'
                ? import('./geometry').TextGeometry
                : T extends 'INSERT'
                  ? import('./geometry').InsertGeometry
                  : T extends 'SOLID' | 'FACE'
                    ? import('./geometry').FaceGeometry
                    : CadGeometry;

export interface CadEntity<T extends CadEntityType = CadEntityType> {
  id: string;
  type: T;
  /** References `CadLayer.id`. Always set; falls back to the default layer. */
  layerId: string;
  /** Resolved CSS colour. `undefined` means "inherit from layer". */
  color?: string;
  lineType?: string;
  geometry: GeometryForEntity<T>;
  /** Cached world-space extent, used for culling and hit-testing. */
  bounds: BoundingBox;
  /** Format-specific extras surfaced in the property inspector. */
  properties?: Record<string, unknown>;
  /** Handle from the source file, useful when cross-referencing in a real CAD app. */
  handle?: string;
  /** Set when the entity came from expanding a block reference. */
  blockPath?: string;
}

export type AnyCadEntity = CadEntity<CadEntityType>;

export interface CadLayer {
  id: string;
  name: string;
  /** CSS colour string, e.g. `#ff0000`. */
  color: string;
  visible: boolean;
  locked: boolean;
  /** Frozen layers are hidden but tracked separately from user visibility. */
  frozen: boolean;
  entityCount: number;
}

/**
 * A block definition, retained so INSERT entities can be expanded and so a
 * future editor can place new references.
 */
export interface CadBlock {
  name: string;
  basePoint: { x: number; y: number };
  entities: AnyCadEntity[];
}

/**
 * DXF/DWG `$INSUNITS` codes, which both formats share.
 *
 * Declared as a const object rather than a TypeScript `enum` so the codebase
 * stays compatible with `erasableSyntaxOnly` (type-stripping-only transpilers).
 */
export const CadUnitCode = {
  Unitless: 0,
  Inches: 1,
  Feet: 2,
  Miles: 3,
  Millimeters: 4,
  Centimeters: 5,
  Meters: 6,
  Kilometers: 7,
  Microinches: 8,
  Mils: 9,
  Yards: 10,
  Angstroms: 11,
  Nanometers: 12,
  Microns: 13,
  Decimeters: 14,
  Decameters: 15,
  Hectometers: 16,
  Gigameters: 17,
  AstronomicalUnits: 18,
  LightYears: 19,
  Parsecs: 20,
  USSurveyFeet: 21,
  USSurveyInch: 22,
  USSurveyYard: 23,
  USSurveyMile: 24,
} as const;

export type CadUnitCode = (typeof CadUnitCode)[keyof typeof CadUnitCode];

export interface CadUnits {
  code: CadUnitCode;
  /** Human readable name, e.g. `Millimeters`. */
  name: string;
  /** Short suffix for the coordinate readout, e.g. `mm`. Empty when unitless. */
  abbreviation: string;
  /** True when the source file actually declared units. */
  detected: boolean;
}

export type CadSourceFormat = 'dwg' | 'dxf' | 'unknown';

export interface CadMetadata {
  fileName: string;
  /** Size in bytes of the source file. */
  fileSize: number;
  sourceFormat: CadSourceFormat;
  /** Identifier of the parser that produced the document. */
  parserId: string;
  /** Source CAD version string when available, e.g. `AC1032`. */
  version?: string;
  /** Milliseconds spent parsing. */
  parseDurationMs: number;
  /** Extents declared in the file header, which may differ from computed bounds. */
  headerBounds?: BoundingBox;
}

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface CadDiagnostic {
  severity: DiagnosticSeverity;
  message: string;
  /** Repeated identical diagnostics are collapsed and counted. */
  count: number;
  /** Set for unsupported-entity diagnostics so the UI can group them. */
  entityType?: string;
}

export interface CadDocument {
  metadata: CadMetadata;
  units: CadUnits;
  layers: CadLayer[];
  entities: AnyCadEntity[];
  blocks: Map<string, CadBlock>;
  /** Computed from real geometry, not from the (often stale) file header. */
  bounds: BoundingBox;
  diagnostics: CadDiagnostic[];
}

export const DEFAULT_LAYER_ID = '0';

export function createDefaultLayer(): CadLayer {
  return {
    id: DEFAULT_LAYER_ID,
    name: '0',
    color: '#ffffff',
    visible: true,
    locked: false,
    frozen: false,
    entityCount: 0,
  };
}

const UNIT_INFO: Record<number, { name: string; abbreviation: string }> = {
  [CadUnitCode.Unitless]: { name: 'Unitless', abbreviation: '' },
  [CadUnitCode.Inches]: { name: 'Inches', abbreviation: 'in' },
  [CadUnitCode.Feet]: { name: 'Feet', abbreviation: 'ft' },
  [CadUnitCode.Miles]: { name: 'Miles', abbreviation: 'mi' },
  [CadUnitCode.Millimeters]: { name: 'Millimeters', abbreviation: 'mm' },
  [CadUnitCode.Centimeters]: { name: 'Centimeters', abbreviation: 'cm' },
  [CadUnitCode.Meters]: { name: 'Meters', abbreviation: 'm' },
  [CadUnitCode.Kilometers]: { name: 'Kilometers', abbreviation: 'km' },
  [CadUnitCode.Microinches]: { name: 'Microinches', abbreviation: 'µin' },
  [CadUnitCode.Mils]: { name: 'Mils', abbreviation: 'mil' },
  [CadUnitCode.Yards]: { name: 'Yards', abbreviation: 'yd' },
  [CadUnitCode.Angstroms]: { name: 'Angstroms', abbreviation: 'Å' },
  [CadUnitCode.Nanometers]: { name: 'Nanometers', abbreviation: 'nm' },
  [CadUnitCode.Microns]: { name: 'Microns', abbreviation: 'µm' },
  [CadUnitCode.Decimeters]: { name: 'Decimeters', abbreviation: 'dm' },
  [CadUnitCode.Decameters]: { name: 'Decameters', abbreviation: 'dam' },
  [CadUnitCode.Hectometers]: { name: 'Hectometers', abbreviation: 'hm' },
  [CadUnitCode.Gigameters]: { name: 'Gigameters', abbreviation: 'Gm' },
  [CadUnitCode.AstronomicalUnits]: { name: 'Astronomical Units', abbreviation: 'AU' },
  [CadUnitCode.LightYears]: { name: 'Light Years', abbreviation: 'ly' },
  [CadUnitCode.Parsecs]: { name: 'Parsecs', abbreviation: 'pc' },
  [CadUnitCode.USSurveyFeet]: { name: 'US Survey Feet', abbreviation: 'ft-us' },
  [CadUnitCode.USSurveyInch]: { name: 'US Survey Inches', abbreviation: 'in-us' },
  [CadUnitCode.USSurveyYard]: { name: 'US Survey Yards', abbreviation: 'yd-us' },
  [CadUnitCode.USSurveyMile]: { name: 'US Survey Miles', abbreviation: 'mi-us' },
};

/** Maps a raw `$INSUNITS` value onto the {@link CadUnits} model. */
export function resolveUnits(code: number | undefined | null): CadUnits {
  if (code == null || !UNIT_INFO[code]) {
    return { code: CadUnitCode.Unitless, name: 'Unitless', abbreviation: '', detected: false };
  }
  const info = UNIT_INFO[code];
  return {
    code: code as CadUnitCode,
    name: info.name,
    abbreviation: info.abbreviation,
    // `0` is a legitimate value meaning "the file says it has no units".
    detected: true,
  };
}
