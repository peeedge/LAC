/**
 * Layer list with visibility, isolate and lock controls.
 *
 * Rows are plain buttons rather than a virtualised list: real drawings rarely
 * exceed a few hundred layers, and toggling visibility is a per-layer flag on the
 * renderer rather than anything that touches geometry.
 */

import { useState } from 'react';
import { useCadStore } from '../store/cadStore';
import { EmptyHint, Panel } from './ui/Panel';
import { EyeIcon, EyeOffIcon, IsolateIcon, LockIcon } from './ui/icons';

export function LayersPanel() {
  const layers = useCadStore((state) => state.layers);
  const setLayerVisible = useCadStore((state) => state.setLayerVisible);
  const setAllLayersVisible = useCadStore((state) => state.setAllLayersVisible);
  const isolateLayer = useCadStore((state) => state.isolateLayer);
  const toggleLayerLocked = useCadStore((state) => state.toggleLayerLocked);

  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);

  const allVisible = layers.length > 0 && layers.every((layer) => layer.visible);

  return (
    <Panel
      title="Layers"
      badge={layers.length > 0 ? layers.length : undefined}
      actions={
        layers.length > 0 && (
          <button
            type="button"
            onClick={() => setAllLayersVisible(!allVisible)}
            className="focus-ring rounded px-1.5 py-0.5 text-[10px] text-ink-muted hover:bg-edge hover:text-ink"
            title={allVisible ? 'Hide all layers' : 'Show all layers'}
          >
            {allVisible ? 'Hide all' : 'Show all'}
          </button>
        )
      }
    >
      {layers.length === 0 ? (
        <EmptyHint>No drawing loaded.</EmptyHint>
      ) : (
        <ul className="py-0.5">
          {layers.map((layer) => {
            const isSelected = selectedLayer === layer.id;

            return (
              <li key={layer.id}>
                <div
                  className={`group flex h-6 items-center gap-1.5 px-1.5 ${
                    isSelected ? 'bg-accent-dim/35' : 'hover:bg-panel-raised'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setLayerVisible(layer.id, !layer.visible)}
                    title={layer.visible ? 'Hide layer' : 'Show layer'}
                    aria-label={`${layer.visible ? 'Hide' : 'Show'} layer ${layer.name}`}
                    data-testid={`layer-toggle-${layer.name}`}
                    className={`focus-ring shrink-0 rounded p-0.5 ${
                      layer.visible ? 'text-ink-muted hover:text-ink' : 'text-ink-faint/60'
                    }`}
                  >
                    {layer.visible ? <EyeIcon /> : <EyeOffIcon />}
                  </button>

                  <span
                    className="h-3 w-3 shrink-0 rounded-sm border border-black/40"
                    style={{ backgroundColor: layer.color }}
                    title={layer.color}
                    aria-hidden="true"
                  />

                  <button
                    type="button"
                    onClick={() => setSelectedLayer(isSelected ? null : layer.id)}
                    className={`focus-ring min-w-0 flex-1 truncate text-left text-[11px] ${
                      layer.visible ? 'text-ink' : 'text-ink-faint line-through'
                    }`}
                    title={layer.name}
                    data-testid={`layer-row-${layer.name}`}
                  >
                    {layer.name}
                  </button>

                  <span className="tnum shrink-0 pr-0.5 text-[10px] text-ink-faint">
                    {layer.entityCount}
                  </span>

                  {/* Secondary actions stay hidden until hover to reduce noise. */}
                  <button
                    type="button"
                    onClick={() => isolateLayer(layer.id)}
                    title={`Isolate ${layer.name}`}
                    aria-label={`Isolate layer ${layer.name}`}
                    data-testid={`layer-isolate-${layer.name}`}
                    className="focus-ring shrink-0 rounded p-0.5 text-ink-faint opacity-0 group-hover:opacity-100 hover:text-accent focus-visible:opacity-100"
                  >
                    <IsolateIcon />
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleLayerLocked(layer.id)}
                    title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                    aria-label={`${layer.locked ? 'Unlock' : 'Lock'} layer ${layer.name}`}
                    className={`focus-ring shrink-0 rounded p-0.5 ${
                      layer.locked
                        ? 'text-warn'
                        : 'text-ink-faint opacity-0 group-hover:opacity-100 hover:text-ink focus-visible:opacity-100'
                    }`}
                  >
                    <LockIcon />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
