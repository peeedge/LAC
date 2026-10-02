/**
 * DXF support, backed by `dxf-parser` (MIT).
 *
 * DXF is the documented interchange format for AutoCAD drawings, so this is the
 * parser with no licensing caveats and the one used by the test fixtures.
 */

import DxfParser, { type IDxf } from 'dxf-parser';
import type { CadDocument } from '../model/document';
import { normaliseDxfLike, type DxfLikeBlock, type DxfLikeLayer, type RawRecord } from './dxfLike';
import { corruptDxfError, emptyFileError, toCadParseError } from './errors';
import type { CadFileParser, ParseOptions } from './types';

export const DXF_PARSER_ID = 'dxf-parser';

export class DxfParserAdapter implements CadFileParser {
  readonly id = DXF_PARSER_ID;
  readonly label = 'DXF reader';
  readonly extensions = ['dxf'] as const;
  readonly isAvailable = (): boolean => true;

  async parse(file: File, options: ParseOptions = {}): Promise<CadDocument> {
    const startedAt = performance.now();

    options.onProgress?.({ stage: 'reading', message: 'Opening drawing…' });
    const text = await file.text();

    if (text.trim().length === 0) throw emptyFileError(file.name);

    options.onProgress?.({ stage: 'parsing', message: 'Parsing entities…' });

    let parsed: IDxf | null;
    try {
      parsed = new DxfParser().parseSync(text);
    } catch (error) {
      // dxf-parser throws on structural problems; surface it as a readable error.
      console.error('[LiteCAD] DXF parse failure', error);
      throw corruptDxfError(error);
    }

    if (!parsed) throw corruptDxfError();

    options.onProgress?.({ stage: 'normalising', message: 'Building geometry…' });

    try {
      return buildDocument(parsed, file, startedAt, options);
    } catch (error) {
      console.error('[LiteCAD] DXF normalisation failure', error);
      throw toCadParseError(error, 'Unable to interpret this DXF file.');
    }
  }
}

function buildDocument(
  parsed: IDxf,
  file: File,
  startedAt: number,
  options: ParseOptions,
): CadDocument {
  // dxf-parser keys layers and blocks by name; the normaliser wants arrays.
  const layers: DxfLikeLayer[] = Object.entries(parsed.tables?.layer?.layers ?? {}).map(
    ([name, layer]) => ({
      name: layer.name ?? name,
      colorIndex: layer.colorIndex,
      color: layer.color,
      visible: layer.visible,
      frozen: layer.frozen,
    }),
  );

  const blocks: DxfLikeBlock[] = Object.entries(parsed.blocks ?? {}).map(([name, block]) => ({
    name: block.name ?? name,
    position: block.position as unknown as RawRecord,
    entities: (block.entities ?? []) as unknown as RawRecord[],
  }));

  const normalised = normaliseDxfLike(
    {
      entities: (parsed.entities ?? []) as unknown as RawRecord[],
      layers,
      blocks,
      header: parsed.header as unknown as RawRecord,
    },
    {
      maxBlockDepth: options.maxBlockDepth,
      onProgress: (processed, total) =>
        options.onProgress?.({
          stage: 'normalising',
          message: 'Building geometry…',
          ratio: total > 0 ? processed / total : undefined,
        }),
    },
  );

  return {
    metadata: {
      fileName: file.name,
      fileSize: file.size,
      sourceFormat: 'dxf',
      parserId: DXF_PARSER_ID,
      version: normalised.version,
      parseDurationMs: performance.now() - startedAt,
      headerBounds: normalised.headerBounds,
    },
    units: normalised.units,
    layers: normalised.layers,
    entities: normalised.entities,
    blocks: normalised.blocks,
    bounds: normalised.bounds,
    diagnostics: normalised.diagnostics,
  };
}
