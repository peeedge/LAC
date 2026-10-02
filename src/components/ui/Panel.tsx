/** Shared chrome for the side panels: a compact header above a scrolling body. */

import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  /** Small count or status shown next to the title. */
  badge?: ReactNode;
  /** Buttons rendered at the right of the header. */
  actions?: ReactNode;
  children: ReactNode;
  /** When false, the body does not scroll independently. */
  scroll?: boolean;
}

export function Panel({ title, badge, actions, children, scroll = true }: PanelProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-7 shrink-0 items-center gap-2 border-b border-edge bg-panel-raised px-2">
        <h2 className="text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
          {title}
        </h2>
        {badge !== undefined && (
          <span className="tnum rounded bg-edge px-1 text-[10px] text-ink-muted">{badge}</span>
        )}
        {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
      </header>

      <div className={`min-h-0 flex-1 ${scroll ? 'cad-scroll overflow-y-auto' : ''}`}>
        {children}
      </div>
    </section>
  );
}

/** A labelled value row, used throughout the inspector and info panels. */
export function PropertyRow({
  label,
  children,
  mono = true,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 px-2 py-[3px] odd:bg-black/15">
      <dt className="w-[42%] shrink-0 truncate text-[11px] text-ink-faint" title={label}>
        {label}
      </dt>
      <dd
        className={`min-w-0 flex-1 truncate text-[11px] text-ink ${mono ? 'tnum font-mono' : ''}`}
      >
        {children}
      </dd>
    </div>
  );
}

/** Centred placeholder for an empty panel. */
export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 py-4 text-center text-[11px] leading-relaxed text-ink-faint">{children}</p>
  );
}
