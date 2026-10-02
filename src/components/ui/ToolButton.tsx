/**
 * Toolbar / menu button.
 *
 * Unimplemented commands render visibly disabled with an explanatory tooltip,
 * rather than looking functional and doing nothing.
 */

import type { ReactNode } from 'react';

interface ToolButtonProps {
  label: string;
  onClick?: () => void;
  icon?: ReactNode;
  /** Renders in the pressed state, for toggles and the active tool. */
  active?: boolean;
  disabled?: boolean;
  /** Marks the command as planned-but-absent. Implies `disabled`. */
  notImplemented?: boolean;
  /** Keyboard hint appended to the tooltip. */
  shortcut?: string;
  /** Extra tooltip text, used for the not-implemented explanation. */
  note?: string;
  /** Shows the label beside the icon. */
  showLabel?: boolean;
  testId?: string;
}

export function ToolButton({
  label,
  onClick,
  icon,
  active = false,
  disabled = false,
  notImplemented = false,
  shortcut,
  note,
  showLabel = false,
  testId,
}: ToolButtonProps) {
  const isDisabled = disabled || notImplemented;

  const tooltip = [
    label,
    shortcut ? `(${shortcut})` : '',
    notImplemented ? `— ${note ?? 'Not implemented yet'}` : note ? `— ${note}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      title={tooltip}
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      className={[
        'focus-ring flex h-7 items-center gap-1.5 rounded px-2 text-[11px] whitespace-nowrap transition-colors',
        showLabel ? 'min-w-0' : 'w-7 justify-center px-0',
        active
          ? 'bg-accent-dim text-white'
          : isDisabled
            ? 'text-ink-faint/60 cursor-not-allowed'
            : 'text-ink-muted hover:bg-panel-raised hover:text-ink',
      ].join(' ')}
    >
      {icon}
      {showLabel && <span className="truncate">{label}</span>}
      {notImplemented && showLabel && (
        <span className="ml-auto pl-2 text-[9px] tracking-wide text-ink-faint/70 uppercase">
          Soon
        </span>
      )}
    </button>
  );
}

/** Vertical rule between toolbar groups. */
export function ToolbarSeparator() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-edge" aria-hidden="true" />;
}
