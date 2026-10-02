/**
 * Binds the command registry to the window's keyboard events.
 *
 * Handlers are read through a ref so the listener is installed once and never
 * re-attached as callbacks change identity between renders.
 */

import { useEffect, useRef } from 'react';
import {
  findCommandForEvent,
  isTextEntryTarget,
  type CommandHandlers,
} from '../cad/commands/registry';

export function useKeyboardShortcuts(handlers: CommandHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTextEntryTarget(event.target)) return;

      const command = findCommandForEvent(event);
      if (!command) return;

      const handler = handlersRef.current[command.id];
      if (!handler) return;

      // Claim the keystroke so the browser does not also act on it
      // (notably Ctrl/Cmd+O, which would open a file picker for the page).
      event.preventDefault();
      handler();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
