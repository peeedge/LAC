import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CadDocument } from '../model/document';
import { boundsHeight, boundsWidth } from '../model/boundingBox';
import { buildGeometry } from '../geometry/buildGeometry';
import { DxfParserAdapter } from './DxfParserAdapter';
import { CadParseError } from './errors';
import { findParserForFile, requireParserForFile } from './registry';

/** Wraps bytes in a `File`, which is what the parser interface accepts. */
function createFile(name: string, contents: string | Uint8Array): File {
  return new File([contents as BlobPart], name);
}

function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
}

describe('DxfParserAdapter', () => {
  let document: CadDocument;

  beforeAll(async () => {
    document = await new DxfParserAdapter().parse(createFile('sample.dxf', fixture('sample.dxf')));
  });

  it('records metadata from the source file', () => {
    expect(document.metadata.fileName).toBe('sample.dxf');
    expect(document.metadata.sourceFormat).toBe('dxf');
    expect(document.metadata.parserId).toBe('dxf-parser');
    expect(document.metadata.parseDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('detects declared units', () => {
    // $INSUNITS 4 is millimetres.
    expect(document.units.detected).toBe(true);
    expect(document.units.name).toBe('Millimeters');
    expect(document.units.abbreviation).toBe('mm');
  });

  it('builds the layer table with colours and entity counts', () => {
    const names = document.layers.map((layer) => layer.name);
    expect(names).toContain('WALLS');
    expect(names).toContain('DOORS');
    expect(names).toContain('NOTES');

    const walls = document.layers.find((layer) => layer.name === 'WALLS');
    // ACI 1 is red.
    expect(walls?.color).toBe('#ff0000');
    expect(walls?.visible).toBe(true);
    expect(walls?.entityCount).toBeGreaterThan(0);

    // Every entity is attributed to exactly one layer.
    const counted = document.layers.reduce((total, layer) => total + layer.entityCount, 0);
    expect(counted).toBe(document.entities.length);
  });

  it('normalises the expected entity types', () => {
    const types = new Set(document.entities.map((entity) => entity.type));
    expect(types).toContain('LWPOLYLINE');
    expect(types).toContain('LINE');
    expect(types).toContain('CIRCLE');
    expect(types).toContain('ARC');
    expect(types).toContain('ELLIPSE');
    expect(types).toContain('POINT');
    expect(types).toContain('TEXT');
    expect(types).toContain('MTEXT');
  });

  it('computes bounds from real geometry rather than the header', () => {
    // The outer wall rectangle spans 200 x 120.
    expect(boundsWidth(document.bounds)).toBeGreaterThanOrEqual(200);
    expect(boundsHeight(document.bounds)).toBeGreaterThanOrEqual(120);
    expect(document.bounds.minX).toBeLessThanOrEqual(0);
  });

  it('expands INSERT references into real geometry instead of skipping them', () => {
    // The MARKER block holds two lines, inserted once at 2x scale.
    const fromBlock = document.entities.filter((entity) => entity.blockPath === 'MARKER');
    expect(fromBlock).toHaveLength(2);
    expect(fromBlock.every((entity) => entity.type === 'LINE')).toBe(true);

    // No bare INSERT should survive normalisation.
    expect(document.entities.some((entity) => entity.type === 'INSERT')).toBe(false);
  });

  it('loads without any error-level diagnostics', () => {
    expect(document.diagnostics.filter((entry) => entry.severity === 'error')).toHaveLength(0);
  });

  it('preserves bulge arcs on polylines', () => {
    const bulged = document.entities.find(
      (entity) =>
        entity.type === 'LWPOLYLINE' &&
        (entity.geometry as { vertices: Array<{ bulge?: number }> }).vertices.some(
          (vertex) => (vertex.bulge ?? 0) !== 0,
        ),
    );
    expect(bulged).toBeDefined();
  });

  it('produces renderable geometry batches', () => {
    const bundle = buildGeometry(document);

    expect(bundle.segmentCount).toBeGreaterThan(0);
    expect(bundle.lineBatches.length).toBeGreaterThan(0);
    expect(bundle.textRuns.length).toBeGreaterThan(0);
    expect(bundle.pick.entityCount).toBe(document.entities.length);

    // Geometry is rebased, so vertices sit near the local origin.
    for (const batch of bundle.lineBatches) {
      for (const value of batch.positions) {
        expect(Math.abs(value)).toBeLessThan(1000);
      }
    }
  });
});

describe('error handling', () => {
  it('rejects an empty file with actionable copy', async () => {
    const parser = new DxfParserAdapter();
    await expect(parser.parse(createFile('empty.dxf', ''))).rejects.toMatchObject({
      code: 'empty-file',
    });
  });

  it('rejects unreadable content as a corrupt file', async () => {
    const parser = new DxfParserAdapter();

    // Not DXF at all; the parser must fail with a presentable error, not a crash.
    const error = await parser.parse(createFile('bad.dxf', 'this is not a dxf file')).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(CadParseError);
    expect((error as CadParseError).title).toMatch(/Unable to read/i);
    // No raw stack trace leaks into user-facing copy.
    expect((error as CadParseError).description).not.toMatch(/at \w+/);
  });

  it('never exposes a stack trace through the serialisable form', () => {
    const error = new CadParseError(
      { code: 'corrupt-file', title: 'T', description: 'D' },
      new Error('internal detail'),
    );
    expect(Object.keys(error.toDetails())).toEqual([
      'code',
      'title',
      'description',
      'reasons',
      'suggestion',
    ]);
  });
});

describe('parser registry', () => {
  it('routes files by extension, case-insensitively', () => {
    expect(findParserForFile('plan.dxf')?.id).toBe('dxf-parser');
    expect(findParserForFile('plan.DXF')?.id).toBe('dxf-parser');
    expect(findParserForFile('plan.dwg')?.id).toBe('libredwg-wasm');
    expect(findParserForFile('plan.DWG')?.id).toBe('libredwg-wasm');
  });

  it('rejects unsupported extensions', () => {
    expect(findParserForFile('model.step')).toBeUndefined();
    expect(() => requireParserForFile('model.step')).toThrow(CadParseError);
    expect(() => requireParserForFile('model.step')).toThrow(/Unsupported file type/i);
  });
});
