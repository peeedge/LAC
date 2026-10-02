/**
 * Command registry and keyboard shortcut dispatch.
 *
 * Commands are the single place where "things the application can do" are
 * declared, so a menu item, a toolbar button and a keystroke all invoke the same
 * entry. Adding a future CAD command (LINE, OFFSET, TRIM…) means registering one
 * object here rather than wiring UI to behaviour in several places.
 *
 * Shortcuts are matched on `event.key` plus modifiers. `Ctrl` and `Cmd` are
 * treated as the same modifier (`mod`) so one declaration covers both platforms.
 */

export type CommandId =
  | 'file.open'
  | 'file.close'
  | 'file.saveAs'
  | 'view.zoomExtents'
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.toggleGrid'
  | 'view.toggleSnap'
  | 'view.toggleDiagnostics'
  | 'tool.select'
  | 'tool.pan'
  | 'edit.clearSelection'
  | 'edit.delete';

export interface Shortcut {
  /** Value of `KeyboardEvent.key`, compared case-insensitively. */
  key: string;
  /** Ctrl on Windows/Linux, Cmd on macOS. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface Command {
  id: CommandId;
  /** Menu/tooltip label. */
  label: string;
  shortcut?: Shortcut;
  /**
   * Set for features that are intentionally not built yet. The UI shows these as
   * disabled with an explanation rather than letting them appear functional.
   */
  notImplemented?: boolean;
  /** Short note shown alongside a not-implemented command. */
  note?: string;
}

/**
 * Every command the app exposes. Handlers are supplied at runtime by the React
 * layer, keeping this module free of UI and store dependencies.
 */
export const COMMANDS: readonly Command[] = [
  { id: 'file.open', label: 'Open Drawing…', shortcut: { key: 'o', mod: true } },
  { id: 'file.close', label: 'Close Drawing' },
  {
    id: 'file.saveAs',
    label: 'Save As…',
    notImplemented: true,
    note: 'LiteCAD is a viewer; writing DWG/DXF is not implemented yet.',
  },
  { id: 'view.zoomExtents', label: 'Zoom Extents', shortcut: { key: 'f' } },
  { id: 'view.zoomIn', label: 'Zoom In', shortcut: { key: '+' } },
  { id: 'view.zoomOut', label: 'Zoom Out', shortcut: { key: '-' } },
  { id: 'view.toggleGrid', label: 'Toggle Grid', shortcut: { key: 'g' } },
  { id: 'view.toggleSnap', label: 'Toggle Snap', shortcut: { key: 's' } },
  { id: 'view.toggleDiagnostics', label: 'Diagnostics', shortcut: { key: 'd' } },
  { id: 'tool.select', label: 'Select Tool', shortcut: { key: '1' } },
  { id: 'tool.pan', label: 'Pan Tool', shortcut: { key: '2' } },
  { id: 'edit.clearSelection', label: 'Clear Selection', shortcut: { key: 'Escape' } },
  {
    id: 'edit.delete',
    label: 'Delete',
    shortcut: { key: 'Delete' },
    notImplemented: true,
    note: 'Reserved for a future editing mode.',
  },
];

export const COMMANDS_BY_ID: ReadonlyMap<CommandId, Command> = new Map(
  COMMANDS.map((command) => [command.id, command]),
);

export type CommandHandlers = Partial<Record<CommandId, () => void>>;

/** True when the event's modifiers match the shortcut exactly. */
export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) return false;

  const mod = event.ctrlKey || event.metaKey;
  if (Boolean(shortcut.mod) !== mod) return false;
  if (Boolean(shortcut.shift) !== event.shiftKey) return false;
  if (Boolean(shortcut.alt) !== event.altKey) return false;

  return true;
}

/** Finds the command bound to a key event, if any. */
export function findCommandForEvent(event: KeyboardEvent): Command | undefined {
  return COMMANDS.find(
    (command) => command.shortcut && matchesShortcut(event, command.shortcut),
  );
}

/** Platform-appropriate shortcut label, e.g. `⌘O` or `Ctrl+O`. */
export function formatShortcut(shortcut: Shortcut | undefined, isMac = detectMac()): string {
  if (!shortcut) return '';

  const parts: string[] = [];
  if (shortcut.mod) parts.push(isMac ? '⌘' : 'Ctrl');
  if (shortcut.shift) parts.push(isMac ? '⇧' : 'Shift');
  if (shortcut.alt) parts.push(isMac ? '⌥' : 'Alt');

  const key =
    shortcut.key === 'Escape'
      ? 'Esc'
      : shortcut.key.length === 1
        ? shortcut.key.toUpperCase()
        : shortcut.key;

  parts.push(key);
  return parts.join(isMac ? '' : '+');
}

function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
}

/**
 * True when a keystroke should be left alone because the user is typing.
 * Without this, pressing `g` in a text field would toggle the grid.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
