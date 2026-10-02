/**
 * Diagnostics log.
 *
 * This is where unsupported entity types and recoverable parse problems surface,
 * e.g. `Unsupported entity: 3DSOLID`. Being explicit about what was skipped is
 * more honest than silently dropping geometry, and it is the first place to look
 * when a drawing does not appear as expected.
 */

import type { CadDiagnostic } from '../cad/model/document';
import { useCadStore } from '../store/cadStore';
import { CloseIcon, InfoIcon, WarningIcon } from './ui/icons';

const SEVERITY_STYLES: Record<CadDiagnostic['severity'], { color: string; label: string }> = {
  error: { color: 'text-danger', label: 'Error' },
  warning: { color: 'text-warn', label: 'Warning' },
  info: { color: 'text-ink-muted', label: 'Info' },
};

export function DiagnosticsPanel() {
  const diagnostics = useCadStore((state) => state.summary?.diagnostics);
  const open = useCadStore((state) => state.diagnosticsOpen);
  const toggle = useCadStore((state) => state.toggleDiagnostics);

  if (!open) return null;

  const entries = diagnostics ?? [];

  return (
    <div className="flex h-44 shrink-0 flex-col border-t border-edge bg-panel">
      <header className="flex h-7 shrink-0 items-center gap-2 border-b border-edge bg-panel-raised px-2">
        <h2 className="text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
          Diagnostics
        </h2>
        <span className="tnum rounded bg-edge px-1 text-[10px] text-ink-muted">
          {entries.length}
        </span>
        <button
          type="button"
          onClick={toggle}
          aria-label="Close diagnostics"
          className="focus-ring ml-auto rounded p-0.5 text-ink-faint hover:text-ink"
        >
          <CloseIcon />
        </button>
      </header>

      <div className="cad-scroll min-h-0 flex-1 overflow-y-auto font-mono text-[11px]">
        {entries.length === 0 ? (
          <p className="px-3 py-3 text-ink-faint">No diagnostics for this drawing.</p>
        ) : (
          <ul>
            {entries.map((diagnostic, index) => {
              const style = SEVERITY_STYLES[diagnostic.severity];
              return (
                <li
                  key={`${diagnostic.severity}-${diagnostic.message}-${index}`}
                  className="flex items-start gap-2 px-2 py-1 odd:bg-black/15"
                >
                  <span className={`mt-0.5 shrink-0 ${style.color}`} title={style.label}>
                    {diagnostic.severity === 'info' ? <InfoIcon /> : <WarningIcon />}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-ink-muted">
                    {diagnostic.message}
                  </span>
                  {diagnostic.count > 1 && (
                    <span className="tnum shrink-0 rounded bg-edge px-1 text-[10px] text-ink-faint">
                      ×{diagnostic.count}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
