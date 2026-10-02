/**
 * Drag-and-drop target, empty-state prompt, loading progress and error dialog.
 *
 * All four states share one overlay because they are mutually exclusive and all
 * sit above the viewport.
 */

import { useCallback, useEffect, useState } from 'react';
import { acceptAttribute } from '../cad/parsers/registry';
import { useCadStore } from '../store/cadStore';
import { OpenIcon, WarningIcon } from './ui/icons';

interface FileDropOverlayProps {
  onRequestOpen: () => void;
}

/** Ordered stage list, so progress reads as a checklist rather than a spinner. */
const STAGE_LABELS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'reading', label: 'Opening drawing' },
  { key: 'parsing', label: 'Parsing entities' },
  { key: 'normalising', label: 'Building geometry' },
  { key: 'building-geometry', label: 'Building geometry' },
  { key: 'rendering', label: 'Rendering' },
];

export function FileDropOverlay({ onRequestOpen }: FileDropOverlayProps) {
  const status = useCadStore((state) => state.status);
  const progress = useCadStore((state) => state.progress);
  const error = useCadStore((state) => state.error);
  const dismissError = useCadStore((state) => state.dismissError);
  const openFile = useCadStore((state) => state.openFile);

  const [dragging, setDragging] = useState(false);

  // Drag events are bound to the window so the drop target covers the whole app.
  useEffect(() => {
    let depth = 0;

    const onDragEnter = (event: DragEvent): void => {
      // Only react to real file drags, not text selections.
      if (!event.dataTransfer?.types.includes('Files')) return;
      depth += 1;
      setDragging(true);
    };

    const onDragOver = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      // Required, otherwise the browser navigates to the dropped file.
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };

    const onDragLeave = (): void => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };

    const onDrop = (event: DragEvent): void => {
      event.preventDefault();
      depth = 0;
      setDragging(false);

      const file = event.dataTransfer?.files?.[0];
      if (file) void openFile(file);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [openFile]);

  const currentStageIndex = useCallback((): number => {
    if (!progress) return -1;
    return STAGE_LABELS.findIndex((stage) => stage.key === progress.stage);
  }, [progress])();

  // --- Drag highlight ------------------------------------------------------
  if (dragging) {
    return (
      <div className="absolute inset-0 z-40 flex items-center justify-center bg-shell/80 backdrop-blur-sm">
        <div className="rounded border-2 border-dashed border-accent px-10 py-8 text-center">
          <p className="text-sm font-medium text-ink">Drop to open drawing</p>
          <p className="mt-1 text-[11px] text-ink-muted">DWG or DXF</p>
        </div>
      </div>
    );
  }

  // --- Error ---------------------------------------------------------------
  if (status === 'error' && error) {
    return (
      <div className="absolute inset-0 z-40 flex items-center justify-center bg-shell/70 p-6 backdrop-blur-sm">
        <div
          role="alertdialog"
          aria-labelledby="parse-error-title"
          className="w-full max-w-md rounded border border-edge-strong bg-panel shadow-2xl shadow-black/60"
        >
          <div className="flex items-start gap-3 border-b border-edge px-4 py-3">
            <span className="mt-0.5 text-warn">
              <WarningIcon />
            </span>
            <div className="min-w-0">
              <h2 id="parse-error-title" className="text-[13px] font-semibold text-ink">
                {error.title}
              </h2>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">{error.description}</p>
            </div>
          </div>

          {error.reasons && error.reasons.length > 0 && (
            <div className="px-4 py-3">
              <p className="text-[11px] text-ink-faint">The file may:</p>
              <ul className="mt-1 space-y-0.5">
                {error.reasons.map((reason) => (
                  <li key={reason} className="flex gap-2 text-[12px] text-ink-muted">
                    <span className="text-ink-faint">•</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error.suggestion && (
            <p className="border-t border-edge px-4 py-3 text-[12px] leading-relaxed text-ink-muted">
              {error.suggestion}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-edge px-4 py-2.5">
            <button
              type="button"
              onClick={dismissError}
              className="focus-ring rounded px-3 py-1 text-[12px] text-ink-muted hover:bg-panel-raised hover:text-ink"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => {
                dismissError();
                onRequestOpen();
              }}
              className="focus-ring rounded bg-accent-dim px-3 py-1 text-[12px] text-white hover:bg-accent"
            >
              Choose another file
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Loading -------------------------------------------------------------
  if (status === 'loading') {
    return (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-shell/60 backdrop-blur-sm">
        <div className="w-72 rounded border border-edge-strong bg-panel px-5 py-4">
          <ul className="space-y-1.5">
            {/* `building-geometry` duplicates the `normalising` label, so it is hidden. */}
            {STAGE_LABELS.filter((stage) => stage.key !== 'building-geometry').map(
              (stage, index) => {
                const done = currentStageIndex > index;
                const active = currentStageIndex === index;

                return (
                  <li
                    key={stage.key}
                    className={`flex items-center gap-2 font-mono text-[12px] ${
                      active ? 'text-ink' : done ? 'text-ink-faint' : 'text-ink-faint/50'
                    }`}
                  >
                    <span className="w-3 text-center">{done ? '✓' : active ? '›' : '·'}</span>
                    <span>
                      {stage.label}
                      {active ? '…' : ''}
                    </span>
                  </li>
                );
              },
            )}
          </ul>

          {/* Determinate bar when the parser reports a ratio, indeterminate otherwise. */}
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-edge">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-150"
              style={{
                width:
                  progress?.ratio !== undefined
                    ? `${Math.round(progress.ratio * 100)}%`
                    : `${Math.max(8, (currentStageIndex + 1) * 22)}%`,
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  // --- Empty state ---------------------------------------------------------
  if (status === 'idle') {
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center">
        <div className="pointer-events-auto max-w-sm text-center">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">
            Open a CAD drawing
          </h2>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
            Drag a <span className="font-mono text-ink">.dwg</span> or{' '}
            <span className="font-mono text-ink">.dxf</span> file here, or choose one from your
            computer.
          </p>

          <button
            type="button"
            onClick={onRequestOpen}
            data-testid="empty-open-button"
            className="focus-ring mx-auto mt-4 flex items-center gap-2 rounded border border-edge-strong bg-panel-raised px-3 py-1.5 text-[12px] text-ink hover:border-accent hover:text-white"
          >
            <OpenIcon />
            Open Drawing
          </button>

          <p className="mt-4 font-mono text-[10px] text-ink-faint">
            Accepts {acceptAttribute()}
          </p>
        </div>
      </div>
    );
  }

  return null;
}
