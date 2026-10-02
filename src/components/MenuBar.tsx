/**
 * Application menu bar.
 *
 * Menus are driven by the command registry and close on outside click or Escape.
 * Kept lightweight on purpose — no dropdown library, since the menu structure is
 * small and fully static.
 */

import { useEffect, useRef, useState } from 'react';
import {
  COMMANDS_BY_ID,
  formatShortcut,
  type CommandHandlers,
  type CommandId,
} from '../cad/commands/registry';
import { useCadStore } from '../store/cadStore';

interface MenuDefinition {
  label: string;
  items: Array<CommandId | 'separator'>;
}

const MENUS: readonly MenuDefinition[] = [
  { label: 'File', items: ['file.open', 'file.saveAs', 'separator', 'file.close'] },
  {
    label: 'View',
    items: [
      'view.zoomExtents',
      'view.zoomIn',
      'view.zoomOut',
      'separator',
      'view.toggleGrid',
      'view.toggleSnap',
      'separator',
      'view.toggleDiagnostics',
    ],
  },
  { label: 'Tools', items: ['tool.select', 'tool.pan', 'separator', 'edit.delete'] },
];

interface MenuBarProps {
  handlers: CommandHandlers;
  onShowHelp: () => void;
}

export function MenuBar({ handlers, onShowHelp }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileName = useCadStore((state) => state.summary?.metadata.fileName);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!openMenu) return;

    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenMenu(null);
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  return (
    <div
      ref={containerRef}
      className="flex h-8 shrink-0 items-center gap-1 border-b border-edge bg-shell px-2"
    >
      <span className="mr-2 flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-ink select-none">
        <span className="text-accent">▞</span>
        LiteCAD
      </span>

      <nav className="flex items-center gap-0.5" aria-label="Main menu">
        {MENUS.map((menu) => (
          <div key={menu.label} className="relative">
            <button
              type="button"
              // Once a menu is open, hovering another switches to it, as in desktop apps.
              onClick={() => setOpenMenu((current) => (current === menu.label ? null : menu.label))}
              onPointerEnter={() => setOpenMenu((current) => (current ? menu.label : current))}
              aria-expanded={openMenu === menu.label}
              aria-haspopup="menu"
              className={`focus-ring rounded px-2 py-1 text-[12px] transition-colors ${
                openMenu === menu.label
                  ? 'bg-panel-raised text-ink'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              {menu.label}
            </button>

            {openMenu === menu.label && (
              <div
                role="menu"
                className="absolute top-full left-0 z-50 mt-0.5 min-w-56 rounded border border-edge-strong bg-panel-raised py-1 shadow-2xl shadow-black/50"
              >
                {menu.items.map((item, index) =>
                  item === 'separator' ? (
                    <div
                      key={`separator-${index}`}
                      className="my-1 h-px bg-edge"
                      role="separator"
                    />
                  ) : (
                    <MenuItem
                      key={item}
                      id={item}
                      handler={handlers[item]}
                      onInvoke={() => setOpenMenu(null)}
                    />
                  ),
                )}
              </div>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={onShowHelp}
          className="focus-ring rounded px-2 py-1 text-[12px] text-ink-muted transition-colors hover:text-ink"
        >
          Help
        </button>
      </nav>

      {fileName && (
        <span
          className="ml-auto max-w-[40%] truncate pl-4 text-[11px] text-ink-faint"
          title={fileName}
        >
          {fileName}
        </span>
      )}
    </div>
  );
}

function MenuItem({
  id,
  handler,
  onInvoke,
}: {
  id: CommandId;
  handler?: () => void;
  onInvoke: () => void;
}) {
  const command = COMMANDS_BY_ID.get(id);
  if (!command) return null;

  const disabled = command.notImplemented || !handler;

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={command.notImplemented ? command.note : undefined}
      onClick={() => {
        handler?.();
        onInvoke();
      }}
      className={`flex w-full items-center gap-4 px-3 py-1 text-left text-[12px] ${
        disabled ? 'cursor-not-allowed text-ink-faint/60' : 'text-ink hover:bg-accent-dim'
      }`}
    >
      <span className="flex-1 truncate">{command.label}</span>
      {command.notImplemented ? (
        <span className="text-[9px] tracking-wide uppercase">Soon</span>
      ) : (
        <span className="tnum text-[10px] text-ink-faint">{formatShortcut(command.shortcut)}</span>
      )}
    </button>
  );
}
