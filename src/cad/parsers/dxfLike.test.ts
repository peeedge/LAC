/**
 * Tests the shared normaliser directly.
 *
 * Going through the raw DXF-shaped input (rather than a parser) is what lets us
 * cover cases a given parser filters out on our behalf — notably unsupported
 * entity types, which `dxf-parser` drops before we ever see them.
 */

import { describe, expect, it } from 'vitest';
import { normaliseDxfLike, stripMTextFormatting, type DxfLikeSource } from './dxfLike';

function source(partial: Partial<DxfLikeSource>): DxfLikeSource {
  return { entities: [], layers: [], blocks: [], ...partial };
}

describe('normaliseDxfLike', () => {
  it('reports unsupported entity types as diagnostics without dropping the import', () => {
    const result = normaliseDxfLike(
      source({
        entities: [
          { type: 'LINE', layer: '0', startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 0 } },
          { type: '3DSOLID', layer: '0' },
          { type: 'HATCH', layer: '0' },
          { type: '3DSOLID', layer: '0' },
        ],
      }),
    );

    // The supported entity still loads.
    expect(result.entities).toHaveLength(1);

    const solid = result.diagnostics.find((d) => d.message === 'Unsupported entity: 3DSOLID');
    expect(solid).toMatchObject({ severity: 'warning', count: 2, entityType: '3DSOLID' });

    expect(
      result.diagnostics.some((d) => d.message === 'Unsupported entity: HATCH'),
    ).toBe(true);
  });

  it('accepts either field spelling for LINE', () => {
    // LibreDWG style.
    const dwgStyle = normaliseDxfLike(
      source({
        entities: [{ type: 'LINE', startPoint: { x: 1, y: 2 }, endPoint: { x: 3, y: 4 } }],
      }),
    );
    // dxf-parser style: a two-element vertices array.
    const dxfStyle = normaliseDxfLike(
      source({
        entities: [
          { type: 'LINE', vertices: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
        ],
      }),
    );

    expect(dwgStyle.entities[0].geometry).toEqual(dxfStyle.entities[0].geometry);
  });

  it('maps POLYLINE2D and POLYLINE3D onto POLYLINE', () => {
    const result = normaliseDxfLike(
      source({
        entities: [
          { type: 'POLYLINE2D', vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
          { type: 'POLYLINE3D', vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        ],
      }),
    );

    expect(result.entities.map((entity) => entity.type)).toEqual(['POLYLINE', 'POLYLINE']);
  });

  it('reads the closed flag from either `shape` or bit 1 of `flag`', () => {
    const result = normaliseDxfLike(
      source({
        entities: [
          { type: 'LWPOLYLINE', shape: true, vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
          { type: 'LWPOLYLINE', flag: 1, vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
          { type: 'LWPOLYLINE', flag: 128, vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
        ],
      }),
    );

    expect(result.entities.map((e) => (e.geometry as { closed: boolean }).closed)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('creates a placeholder for a layer referenced but never defined', () => {
    const result = normaliseDxfLike(
      source({
        entities: [{ type: 'POINT', layer: 'GHOST', position: { x: 0, y: 0 } }],
      }),
    );

    const ghost = result.layers.find((layer) => layer.name === 'GHOST');
    expect(ghost).toBeDefined();
    expect(ghost?.entityCount).toBe(1);
    expect(result.diagnostics.some((d) => d.message.includes('GHOST'))).toBe(true);
  });

  it('treats a layer that is off or frozen as hidden', () => {
    const result = normaliseDxfLike(
      source({
        layers: [
          { name: 'ON' },
          { name: 'OFF', off: true },
          { name: 'FROZEN', frozen: true },
          { name: 'INVISIBLE', visible: false },
        ],
      }),
    );

    const visibility = Object.fromEntries(
      result.layers.map((layer) => [layer.name, layer.visible]),
    );
    expect(visibility).toMatchObject({ ON: true, OFF: false, FROZEN: false, INVISIBLE: false });
  });

  it('skips paper-space entities', () => {
    const result = normaliseDxfLike(
      source({
        entities: [
          { type: 'POINT', position: { x: 0, y: 0 }, isInPaperSpace: true },
          { type: 'POINT', position: { x: 1, y: 1 }, inPaperSpace: true },
          { type: 'POINT', position: { x: 2, y: 2 } },
        ],
      }),
    );

    expect(result.entities).toHaveLength(1);
  });

  it('expands a block reference, applying scale and rotation', () => {
    const result = normaliseDxfLike(
      source({
        blocks: [
          {
            name: 'TICK',
            basePoint: { x: 0, y: 0 },
            entities: [
              { type: 'LINE', startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 0 } },
            ],
          },
        ],
        entities: [
          {
            type: 'INSERT',
            name: 'TICK',
            insertionPoint: { x: 10, y: 20 },
            xScale: 2,
            yScale: 2,
            rotation: Math.PI / 2,
          },
        ],
      }),
    );

    expect(result.entities).toHaveLength(1);
    const geometry = result.entities[0].geometry as {
      start: { x: number; y: number };
      end: { x: number; y: number };
    };

    // Scaled to length 2, rotated 90°, then translated to the insertion point.
    expect(geometry.start.x).toBeCloseTo(10);
    expect(geometry.start.y).toBeCloseTo(20);
    expect(geometry.end.x).toBeCloseTo(10);
    expect(geometry.end.y).toBeCloseTo(22);
    expect(result.entities[0].blockPath).toBe('TICK');
  });

  it('does not recurse forever on a self-referential block', () => {
    const result = normaliseDxfLike(
      source({
        blocks: [
          {
            name: 'LOOP',
            basePoint: { x: 0, y: 0 },
            entities: [
              { type: 'LINE', startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 0 } },
              { type: 'INSERT', name: 'LOOP', insertionPoint: { x: 1, y: 0 } },
            ],
          },
        ],
        entities: [{ type: 'INSERT', name: 'LOOP', insertionPoint: { x: 0, y: 0 } }],
      }),
    );

    // One line from the outer expansion; the nested self-reference is refused.
    expect(result.entities).toHaveLength(1);
    expect(result.diagnostics.some((d) => d.message.includes('references itself'))).toBe(true);
  });

  it('warns when a referenced block is missing', () => {
    const result = normaliseDxfLike(
      source({ entities: [{ type: 'INSERT', name: 'NOPE', insertionPoint: { x: 0, y: 0 } }] }),
    );

    expect(result.entities).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.message.includes('“NOPE”'))).toBe(true);
  });

  it('resolves true colour ahead of the ACI index', () => {
    const result = normaliseDxfLike(
      source({
        entities: [
          { type: 'POINT', position: { x: 0, y: 0 }, color: 0x336699, colorIndex: 1 },
          { type: 'POINT', position: { x: 0, y: 0 }, colorIndex: 1 },
          // 256 is ByLayer, so the entity carries no colour of its own.
          { type: 'POINT', position: { x: 0, y: 0 }, colorIndex: 256 },
        ],
      }),
    );

    expect(result.entities[0].color).toBe('#336699');
    expect(result.entities[1].color).toBe('#ff0000');
    expect(result.entities[2].color).toBeUndefined();
  });

  it('reads header values with or without the DXF `$` prefix', () => {
    const withPrefix = normaliseDxfLike(source({ header: { $INSUNITS: 6, $ACADVER: 'AC1032' } }));
    const withoutPrefix = normaliseDxfLike(source({ header: { INSUNITS: 6, ACADVER: 'AC1032' } }));

    for (const result of [withPrefix, withoutPrefix]) {
      expect(result.units.name).toBe('Meters');
      expect(result.units.detected).toBe(true);
      expect(result.version).toBe('AC1032');
    }
  });

  it('marks units as undetected when the header omits them', () => {
    const result = normaliseDxfLike(source({}));
    expect(result.units.detected).toBe(false);
    expect(result.units.name).toBe('Unitless');
  });

  it('handles an empty drawing without throwing', () => {
    const result = normaliseDxfLike(source({}));
    expect(result.entities).toHaveLength(0);
    // The default layer "0" always exists so entities have somewhere to land.
    expect(result.layers.map((layer) => layer.name)).toEqual(['0']);
  });

  it('skips entities with unusable geometry and says so', () => {
    const result = normaliseDxfLike(
      source({
        entities: [
          { type: 'CIRCLE', center: { x: 0, y: 0 }, radius: 0 },
          { type: 'LINE' },
          { type: 'TEXT', startPoint: { x: 0, y: 0 }, text: '', textHeight: 5 },
        ],
      }),
    );

    expect(result.entities).toHaveLength(0);
    expect(result.diagnostics.every((d) => d.severity !== 'error')).toBe(true);
  });
});

describe('stripMTextFormatting', () => {
  it('converts paragraph codes into newlines', () => {
    expect(stripMTextFormatting('Line one\\PLine two')).toBe('Line one\nLine two');
  });

  it('removes font and property codes but keeps the text', () => {
    expect(stripMTextFormatting('{\\fArial|b0|i0;Hello}')).toBe('Hello');
    expect(stripMTextFormatting('\\A1;Centered')).toBe('Centered');
  });

  it('flattens stacked fractions', () => {
    expect(stripMTextFormatting('\\S1/2;')).toBe('1/2');
  });

  it('leaves plain text untouched', () => {
    expect(stripMTextFormatting('ROOM 101')).toBe('ROOM 101');
  });
});
