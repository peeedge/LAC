/** Keyboard and mouse reference, generated from the command registry. */

import { COMMANDS, formatShortcut } from '../cad/commands/registry';
import { CloseIcon } from './ui/icons';

const MOUSE_BINDINGS: ReadonlyArray<[string, string]> = [
  ['Mouse wheel', 'Zoom in / out at the cursor'],
  ['Middle-drag', 'Pan'],
  ['Right-drag', 'Pan'],
  ['Left-click', 'Select entity'],
  ['Shift / Ctrl + click', 'Add to or remove from selection'],
  ['Double-click', 'Zoom extents'],
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-shell/70 p-6 backdrop-blur-sm"
      // Clicking the backdrop dismisses; the inner panel stops propagation.
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-labelledby="help-title"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded border border-edge-strong bg-panel shadow-2xl shadow-black/60"
      >
        <header className="flex h-9 items-center border-b border-edge bg-panel-raised px-3">
          <h2 id="help-title" className="text-[12px] font-semibold tracking-wide text-ink">
            LiteCAD — Shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help"
            className="focus-ring ml-auto rounded p-1 text-ink-faint hover:text-ink"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="cad-scroll max-h-[calc(80vh-2.25rem)] overflow-y-auto px-3 py-3">
          <Section title="Keyboard">
            {COMMANDS.filter((command) => command.shortcut).map((command) => (
              <Row
                key={command.id}
                left={formatShortcut(command.shortcut)}
                right={command.label}
                muted={command.notImplemented}
                note={command.notImplemented ? 'not implemented' : undefined}
              />
            ))}
          </Section>

          <Section title="Mouse">
            {MOUSE_BINDINGS.map(([binding, description]) => (
              <Row key={binding} left={binding} right={description} />
            ))}
          </Section>

          <p className="mt-3 border-t border-edge pt-3 text-[11px] leading-relaxed text-ink-muted">
            LiteCAD is a read-only viewer. Drawing and editing commands are not implemented;
            anything marked “Soon” is a placeholder so the intended surface is visible without
            pretending it works.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3">
      <h3 className="mb-1 text-[10px] font-semibold tracking-wider text-ink-faint uppercase">
        {title}
      </h3>
      <dl className="overflow-hidden rounded border border-edge">{children}</dl>
    </section>
  );
}

function Row({
  left,
  right,
  muted,
  note,
}: {
  left: string;
  right: string;
  muted?: boolean;
  note?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-2 py-1 odd:bg-black/15">
      <dt className="w-36 shrink-0 font-mono text-[11px] text-accent">{left}</dt>
      <dd className={`flex-1 text-[11px] ${muted ? 'text-ink-faint' : 'text-ink-muted'}`}>
        {right}
        {note && <span className="ml-1.5 text-[10px] text-ink-faint/70">({note})</span>}
      </dd>
    </div>
  );
}
