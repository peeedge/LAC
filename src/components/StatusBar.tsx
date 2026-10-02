/**
 * Bottom status bar: live cursor coordinates, zoom, space and load state.
 *
 * Coordinates are shown in true world units (the renderer's rebase offset is
 * added back), because the user cares about drawing coordinates, not the internal
 * rendering space.
 */

import { useCadStore } from '../store/cadStore';

function formatCoordinate(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value !== 0 && (Math.abs(value) >= 1e7 || Math.abs(value) < 1e-4)) {
    return value.toExponential(2);
  }
  return value.toFixed(2);
}

export function StatusBar() {
  const cursor = useCadStore((state) => state.cursor);
  const zoom = useCadStore((state) => state.zoomPercent);
  const units = useCadStore((state) => state.summary?.units);
  const status = useCadStore((state) => state.status);
  const progress = useCadStore((state) => state.progress);
  const snapEnabled = useCadStore((state) => state.snapEnabled);
  const gridVisible = useCadStore((state) => state.gridVisible);
  const selectionCount = useCadStore((state) => state.selection.length);
  const toggleDiagnostics = useCadStore((state) => state.toggleDiagnostics);
  const diagnosticsCount = useCadStore((state) => state.summary?.diagnostics.length ?? 0);

  const unitSuffix = units?.abbreviation ? ` ${units.abbreviation}` : '';

  const statusText =
    status === 'loading'
      ? (progress?.message ?? 'Working…')
      : status === 'ready'
        ? 'Ready'
        : status === 'error'
          ? 'Failed'
          : 'No drawing';

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-edge bg-shell px-2 text-[11px] text-ink-muted">
      <span className="tnum font-mono" data-testid="status-coordinates">
        X: {cursor ? formatCoordinate(cursor.x) : '—'}
        {'  '}
        Y: {cursor ? formatCoordinate(cursor.y) : '—'}
        {cursor ? unitSuffix : ''}
      </span>

      <Divider />

      <span className="tnum font-mono" data-testid="status-zoom">
        Zoom: {Number.isFinite(zoom) ? `${zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}%` : '—'}
      </span>

      <Divider />

      <Toggle label="Grid" on={gridVisible} />
      <Toggle label="Snap" on={snapEnabled} />

      {selectionCount > 0 && (
        <>
          <Divider />
          <span className="tnum">
            {selectionCount} selected
          </span>
        </>
      )}

      <div className="ml-auto flex items-center gap-3">
        {diagnosticsCount > 0 && (
          <button
            type="button"
            onClick={toggleDiagnostics}
            className="focus-ring rounded px-1 hover:text-ink"
            data-testid="status-diagnostics"
          >
            {diagnosticsCount} diagnostic{diagnosticsCount === 1 ? '' : 's'}
          </button>
        )}

        <span className="text-ink-faint">Model Space</span>

        <Divider />

        <span
          className={
            status === 'ready'
              ? 'text-ok'
              : status === 'error'
                ? 'text-danger'
                : status === 'loading'
                  ? 'text-accent'
                  : 'text-ink-faint'
          }
          data-testid="status-state"
        >
          {statusText}
        </span>
      </div>
    </footer>
  );
}

function Divider() {
  return <span className="h-3 w-px bg-edge" aria-hidden="true" />;
}

function Toggle({ label, on }: { label: string; on: boolean }) {
  return (
    <span className={on ? 'text-ink' : 'text-ink-faint/70'}>
      {label}: {on ? 'On' : 'Off'}
    </span>
  );
}
