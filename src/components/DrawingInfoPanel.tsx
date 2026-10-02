/**
 * Summary of the loaded drawing: file, extents, units and entity statistics.
 * This is the panel that answers "what did I just open?".
 */

import { boundsHeight, boundsWidth } from '../cad/model/boundingBox';
import { useCadStore } from '../store/cadStore';
import { EmptyHint, Panel, PropertyRow } from './ui/Panel';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

function formatMeasure(value: number): string {
  if (!Number.isFinite(value)) return '—';
  // Very large or very small extents are easier to read in exponential form.
  if (value !== 0 && (Math.abs(value) >= 1e7 || Math.abs(value) < 1e-3)) {
    return value.toExponential(2);
  }
  return Number(value.toFixed(2)).toLocaleString();
}

export function DrawingInfoPanel() {
  const summary = useCadStore((state) => state.summary);

  if (!summary) {
    return (
      <Panel title="Drawing">
        <EmptyHint>No drawing loaded.</EmptyHint>
      </Panel>
    );
  }

  const { metadata, units, bounds } = summary;
  const unitSuffix = units.abbreviation ? ` ${units.abbreviation}` : '';

  const typeEntries = Object.entries(summary.entityTypeCounts).sort((a, b) => b[1] - a[1]);

  return (
    <Panel title="Drawing">
      <dl>
        <PropertyRow label="File" mono={false}>
          <span title={metadata.fileName}>{metadata.fileName}</span>
        </PropertyRow>
        <PropertyRow label="Size">{formatBytes(metadata.fileSize)}</PropertyRow>
        <PropertyRow label="Format">{metadata.sourceFormat.toUpperCase()}</PropertyRow>
        {metadata.version && <PropertyRow label="CAD version">{metadata.version}</PropertyRow>}
        <PropertyRow label="Parser" mono={false}>
          {metadata.parserId}
        </PropertyRow>
        <PropertyRow label="Parse time">{metadata.parseDurationMs.toFixed(0)} ms</PropertyRow>

        <SectionLabel>Units</SectionLabel>
        <PropertyRow label="Units" mono={false}>
          {units.detected ? units.name : `${units.name} (not declared)`}
        </PropertyRow>

        <SectionLabel>Extents</SectionLabel>
        <PropertyRow label="Min X / Y">
          {formatMeasure(bounds.minX)}, {formatMeasure(bounds.minY)}
        </PropertyRow>
        <PropertyRow label="Max X / Y">
          {formatMeasure(bounds.maxX)}, {formatMeasure(bounds.maxY)}
        </PropertyRow>
        <PropertyRow label="Width">
          {formatMeasure(boundsWidth(bounds))}
          {unitSuffix}
        </PropertyRow>
        <PropertyRow label="Height">
          {formatMeasure(boundsHeight(bounds))}
          {unitSuffix}
        </PropertyRow>

        <SectionLabel>Contents</SectionLabel>
        <PropertyRow label="Entities">
          <span data-testid="entity-count">{summary.entityCount.toLocaleString()}</span>
        </PropertyRow>
        <PropertyRow label="Line segments">{summary.segmentCount.toLocaleString()}</PropertyRow>
        <PropertyRow label="Layers">{summary.layers.length}</PropertyRow>
        <PropertyRow label="Blocks">{summary.blockCount}</PropertyRow>

        {typeEntries.length > 0 && (
          <>
            <SectionLabel>Entity types</SectionLabel>
            {typeEntries.map(([type, count]) => (
              <PropertyRow key={type} label={type}>
                {count.toLocaleString()}
              </PropertyRow>
            ))}
          </>
        )}
      </dl>
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
