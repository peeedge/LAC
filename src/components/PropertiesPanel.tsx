/**
 * Property inspector for the selected entity.
 *
 * Geometry is formatted per entity type through a small table of renderers, so
 * supporting a new entity type means adding one entry rather than extending a
 * conditional chain. Entity details are fetched asynchronously because the full
 * entity list lives in the parsing worker.
 */

import type { CadEntityType } from '../cad/model/document';
import type {
  ArcGeometry,
  CircleGeometry,
  EllipseGeometry,
  FaceGeometry,
  LineGeometry,
  PointGeometry,
  PolylineGeometry,
  SplineGeometry,
  TextGeometry,
} from '../cad/model/geometry';
import { useCadStore } from '../store/cadStore';
import type { CadEntitySnapshot } from '../workers/protocol';
import { EmptyHint, Panel, PropertyRow } from './ui/Panel';

/** Fixed decimal places for coordinate display. */
const PRECISION = 3;

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  // Trim trailing zeros so short values stay readable.
  return Number(value.toFixed(PRECISION)).toString();
}

function formatPoint(point: { x: number; y: number }): string {
  return `${formatNumber(point.x)}, ${formatNumber(point.y)}`;
}

function radiansToDegrees(radians: number): string {
  return `${formatNumber((radians * 180) / Math.PI)}°`;
}

/** Per-type geometry rows. Returning an array keeps each renderer declarative. */
const GEOMETRY_ROWS: Partial<
  Record<CadEntityType, (geometry: never) => Array<[string, string]>>
> = {
  LINE: (geometry: LineGeometry) => [
    ['Start', formatPoint(geometry.start)],
    ['End', formatPoint(geometry.end)],
    [
      'Length',
      formatNumber(Math.hypot(geometry.end.x - geometry.start.x, geometry.end.y - geometry.start.y)),
    ],
    [
      'Angle',
      radiansToDegrees(
        Math.atan2(geometry.end.y - geometry.start.y, geometry.end.x - geometry.start.x),
      ),
    ],
  ],

  CIRCLE: (geometry: CircleGeometry) => [
    ['Center', formatPoint(geometry.center)],
    ['Radius', formatNumber(geometry.radius)],
    ['Diameter', formatNumber(geometry.radius * 2)],
    ['Circumference', formatNumber(2 * Math.PI * geometry.radius)],
  ],

  ARC: (geometry: ArcGeometry) => [
    ['Center', formatPoint(geometry.center)],
    ['Radius', formatNumber(geometry.radius)],
    ['Start angle', radiansToDegrees(geometry.startAngle)],
    ['End angle', radiansToDegrees(geometry.endAngle)],
  ],

  ELLIPSE: (geometry: EllipseGeometry) => [
    ['Center', formatPoint(geometry.center)],
    ['Major radius', formatNumber(Math.hypot(geometry.majorAxis.x, geometry.majorAxis.y))],
    ['Axis ratio', formatNumber(geometry.axisRatio)],
    [
      'Rotation',
      radiansToDegrees(Math.atan2(geometry.majorAxis.y, geometry.majorAxis.x)),
    ],
  ],

  POINT: (geometry: PointGeometry) => [['Position', formatPoint(geometry.position)]],

  SPLINE: (geometry: SplineGeometry) => [
    ['Degree', String(geometry.degree)],
    ['Control points', String(geometry.controlPoints.length)],
    ['Fit points', String(geometry.fitPoints?.length ?? 0)],
    ['Closed', geometry.closed ? 'Yes' : 'No'],
  ],
};

function polylineRows(geometry: PolylineGeometry): Array<[string, string]> {
  const bulged = geometry.vertices.filter((vertex) => (vertex.bulge ?? 0) !== 0).length;
  return [
    ['Vertices', String(geometry.vertices.length)],
    ['Closed', geometry.closed ? 'Yes' : 'No'],
    ['Arc segments', String(bulged)],
    ['First vertex', geometry.vertices[0] ? formatPoint(geometry.vertices[0]) : '—'],
  ];
}

function textRows(geometry: TextGeometry): Array<[string, string]> {
  return [
    ['Position', formatPoint(geometry.position)],
    ['Height', formatNumber(geometry.height)],
    ['Rotation', radiansToDegrees(geometry.rotation)],
    ['Alignment', `${geometry.horizontalAlign} / ${geometry.verticalAlign}`],
  ];
}

function geometryRows(snapshot: CadEntitySnapshot): Array<[string, string]> {
  switch (snapshot.type) {
    case 'POLYLINE':
    case 'LWPOLYLINE':
      return polylineRows(snapshot.geometry as PolylineGeometry);
    case 'TEXT':
    case 'MTEXT':
      return textRows(snapshot.geometry as TextGeometry);
    case 'SOLID':
    case 'FACE':
      return [['Corners', String((snapshot.geometry as FaceGeometry).points.length)]];
    default: {
      const renderer = GEOMETRY_ROWS[snapshot.type];
      return renderer ? renderer(snapshot.geometry as never) : [];
    }
  }
}

export function PropertiesPanel() {
  const inspected = useCadStore((state) => state.inspected);
  const loading = useCadStore((state) => state.inspectedLoading);
  const selectionCount = useCadStore((state) => state.selection.length);

  return (
    <Panel title="Properties" badge={selectionCount > 1 ? `${selectionCount} selected` : undefined}>
      {!inspected && !loading && (
        <EmptyHint>
          Click an entity in the drawing to inspect it.
          <br />
          Shift-click to add to the selection.
        </EmptyHint>
      )}

      {loading && !inspected && <EmptyHint>Reading entity…</EmptyHint>}

      {inspected && (
        <div className="pb-2">
          {/* Entity type header, mirroring how CAD tools title the inspector. */}
          <div className="flex items-center gap-2 border-b border-edge bg-panel-raised px-2 py-1.5">
            <span
              className="h-3 w-3 shrink-0 rounded-sm border border-black/40"
              style={{ backgroundColor: inspected.effectiveColor }}
              aria-hidden="true"
            />
            <span
              className="font-mono text-[12px] font-semibold tracking-wide text-ink"
              data-testid="inspector-type"
            >
              {inspected.type}
            </span>
          </div>

          <dl>
            <PropertyRow label="Layer">{inspected.layerName}</PropertyRow>
            <PropertyRow label="Color">{inspected.effectiveColor}</PropertyRow>
            {inspected.color === undefined && (
              <PropertyRow label="Color source">ByLayer</PropertyRow>
            )}
            {inspected.lineType && <PropertyRow label="Linetype">{inspected.lineType}</PropertyRow>}
            {inspected.handle && <PropertyRow label="Handle">{inspected.handle}</PropertyRow>}
            {inspected.blockPath && (
              <PropertyRow label="Block">{inspected.blockPath}</PropertyRow>
            )}

            <SectionLabel>Geometry</SectionLabel>
            {geometryRows(inspected).map(([label, value]) => (
              <PropertyRow key={label} label={label}>
                {value}
              </PropertyRow>
            ))}

            <SectionLabel>Extents</SectionLabel>
            <PropertyRow label="Min">
              {formatPoint({ x: inspected.bounds.minX, y: inspected.bounds.minY })}
            </PropertyRow>
            <PropertyRow label="Max">
              {formatPoint({ x: inspected.bounds.maxX, y: inspected.bounds.maxY })}
            </PropertyRow>
          </dl>
        </div>
      )}
    </Panel>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1 border-y border-edge bg-black/20 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-ink-faint uppercase">
      {children}
    </div>
  );
}
