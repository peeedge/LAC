/**
 * Primary toolbar.
 *
 * Every button maps to a command in the registry, so labels and shortcut hints
 * stay in sync with the keyboard bindings automatically.
 */

import { COMMANDS_BY_ID, formatShortcut, type CommandHandlers } from '../cad/commands/registry';
import { useCadStore } from '../store/cadStore';
import { ToolButton, ToolbarSeparator } from './ui/ToolButton';
import {
  GridIcon,
  OpenIcon,
  PanIcon,
  SaveIcon,
  SelectIcon,
  SnapIcon,
  ZoomExtentsIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from './ui/icons';

interface ToolbarProps {
  handlers: CommandHandlers;
}

export function Toolbar({ handlers }: ToolbarProps) {
  const tool = useCadStore((state) => state.tool);
  const gridVisible = useCadStore((state) => state.gridVisible);
  const snapEnabled = useCadStore((state) => state.snapEnabled);
  const hasDrawing = useCadStore((state) => state.summary !== null);
  const canSave = useCadStore((state) => state.sourceFile !== null);

  /** Pulls label, shortcut and not-implemented metadata from the registry. */
  const props = (id: Parameters<typeof COMMANDS_BY_ID.get>[0]) => {
    const command = COMMANDS_BY_ID.get(id);
    return {
      label: command?.label ?? String(id),
      shortcut: formatShortcut(command?.shortcut),
      notImplemented: command?.notImplemented,
      note: command?.note,
      onClick: handlers[id],
    };
  };

  return (
    <div
      className="flex h-9 shrink-0 items-center gap-0.5 border-b border-edge bg-panel px-1.5"
      role="toolbar"
      aria-label="Drawing tools"
    >
      <ToolButton {...props('file.open')} icon={<OpenIcon />} testId="toolbar-open" />
      <ToolButton
        {...props('file.saveAs')}
        icon={<SaveIcon />}
        disabled={!canSave}
        testId="toolbar-save"
      />

      <ToolbarSeparator />

      <ToolButton
        {...props('view.zoomExtents')}
        icon={<ZoomExtentsIcon />}
        disabled={!hasDrawing}
        testId="toolbar-zoom-extents"
      />
      <ToolButton {...props('view.zoomIn')} icon={<ZoomInIcon />} disabled={!hasDrawing} />
      <ToolButton {...props('view.zoomOut')} icon={<ZoomOutIcon />} disabled={!hasDrawing} />

      <ToolbarSeparator />

      <ToolButton
        {...props('tool.select')}
        icon={<SelectIcon />}
        active={tool === 'select'}
        testId="toolbar-select"
      />
      <ToolButton
        {...props('tool.pan')}
        icon={<PanIcon />}
        active={tool === 'pan'}
        testId="toolbar-pan"
      />

      <ToolbarSeparator />

      <ToolButton
        {...props('view.toggleGrid')}
        icon={<GridIcon />}
        active={gridVisible}
        testId="toolbar-grid"
      />
      <ToolButton
        {...props('view.toggleSnap')}
        icon={<SnapIcon />}
        active={snapEnabled}
        testId="toolbar-snap"
      />
    </div>
  );
}
