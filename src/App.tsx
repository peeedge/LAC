/**
 * Application shell.
 *
 * Owns layout and the mapping from commands to behaviour. Deliberately has no
 * CAD logic of its own: parsing lives in the worker, rendering in `CadRenderer`,
 * and state in the Zustand store.
 */

import { useCallback, useRef, useState } from 'react';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { DrawingInfoPanel } from './components/DrawingInfoPanel';
import { FileDropOverlay } from './components/FileDropOverlay';
import { HelpDialog } from './components/HelpDialog';
import { LayersPanel } from './components/LayersPanel';
import { MenuBar } from './components/MenuBar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { Viewport, type ViewportHandle } from './components/Viewport';
import { acceptAttribute } from './cad/parsers/registry';
import type { CommandHandlers } from './cad/commands/registry';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useCadStore } from './store/cadStore';

/** Wheel-equivalent zoom step for the toolbar buttons. */
const ZOOM_BUTTON_STEP = 1.3;

export default function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<ViewportHandle | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const openFile = useCadStore((state) => state.openFile);
  const closeDrawing = useCadStore((state) => state.closeDrawing);
  const setTool = useCadStore((state) => state.setTool);
  const toggleGrid = useCadStore((state) => state.toggleGrid);
  const toggleSnap = useCadStore((state) => state.toggleSnap);
  const toggleDiagnostics = useCadStore((state) => state.toggleDiagnostics);
  const clearSelection = useCadStore((state) => state.clearSelection);

  const requestOpen = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handlers: CommandHandlers = {
    'file.open': requestOpen,
    'file.close': closeDrawing,
    'view.zoomExtents': () => viewportRef.current?.zoomExtents(),
    'view.zoomIn': () => viewportRef.current?.zoomBy(ZOOM_BUTTON_STEP),
    'view.zoomOut': () => viewportRef.current?.zoomBy(1 / ZOOM_BUTTON_STEP),
    'view.toggleGrid': toggleGrid,
    'view.toggleSnap': toggleSnap,
    'view.toggleDiagnostics': toggleDiagnostics,
    'tool.select': () => setTool('select'),
    'tool.pan': () => setTool('pan'),
    'edit.clearSelection': () => {
      // Escape also closes the help dialog, which is the more immediate action.
      if (helpOpen) setHelpOpen(false);
      else clearSelection();
    },
  };

  useKeyboardShortcuts(handlers);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-shell">
      <MenuBar handlers={handlers} onShowHelp={() => setHelpOpen(true)} />
      <Toolbar handlers={handlers} />

      <div className="flex min-h-0 flex-1">
        {/* Left dock: layers above drawing info. */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-edge bg-panel">
          <div className="flex min-h-0 flex-[3] flex-col border-b border-edge">
            <LayersPanel />
          </div>
          <div className="flex min-h-0 flex-[4] flex-col">
            <DrawingInfoPanel />
          </div>
        </aside>

        {/* Centre: the viewport, with overlays for empty/loading/error states. */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <Viewport onReady={(handle) => (viewportRef.current = handle)} />
          <FileDropOverlay onRequestOpen={requestOpen} />
          <DiagnosticsPanel />
        </main>

        {/* Right dock: property inspector. */}
        <aside className="flex w-64 shrink-0 flex-col border-l border-edge bg-panel">
          <PropertiesPanel />
        </aside>
      </div>

      <StatusBar />

      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}

      {/*
        The file input is the only reliable way to open a native file picker.
        It is kept out of the layout and driven by the Open command.
      */}
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptAttribute()}
        data-testid="file-input"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void openFile(file);
          // Reset so re-opening the same file fires `change` again.
          event.target.value = '';
        }}
      />
    </div>
  );
}
