/**
 * Full-width crosshair cursor, as used by CAD applications for precise aiming.
 *
 * Tracks the pointer with direct DOM writes inside a `pointermove` listener
 * rather than React state, so moving the mouse never re-renders the tree.
 */

import { useEffect, useRef } from 'react';

export function Crosshair() {
  const horizontalRef = useRef<HTMLDivElement>(null);
  const verticalRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    // The crosshair follows the pointer anywhere inside the viewport container.
    const container = root?.parentElement;
    if (!root || !container) return;

    let frame: number | null = null;
    let pending: { x: number; y: number } | null = null;

    const flush = (): void => {
      frame = null;
      if (!pending) return;
      // `translate` on a composited layer keeps this off the layout path.
      if (horizontalRef.current) {
        horizontalRef.current.style.transform = `translateY(${pending.y}px)`;
      }
      if (verticalRef.current) {
        verticalRef.current.style.transform = `translateX(${pending.x}px)`;
      }
    };

    const onPointerMove = (event: PointerEvent): void => {
      const rect = container.getBoundingClientRect();
      pending = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      root.style.opacity = '1';
      if (frame === null) frame = requestAnimationFrame(flush);
    };

    const onPointerLeave = (): void => {
      root.style.opacity = '0';
    };

    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerleave', onPointerLeave);

    return () => {
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerleave', onPointerLeave);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150"
      aria-hidden="true"
    >
      <div
        ref={horizontalRef}
        className="absolute top-0 left-0 h-px w-full bg-ink-muted/35 will-change-transform"
      />
      <div
        ref={verticalRef}
        className="absolute top-0 left-0 h-full w-px bg-ink-muted/35 will-change-transform"
      />
    </div>
  );
}
