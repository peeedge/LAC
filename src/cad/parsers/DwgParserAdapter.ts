/**
 * DWG support, backed by LibreDWG compiled to WebAssembly
 * (`@mlightcad/libredwg-web`).
 *
 * Two deliberate choices here:
 *
 * 1. **Lazy loading.** The module and its ~9.5 MB `.wasm` binary are imported
 *    only when a DWG is actually opened, so DXF users never pay for them and the
 *    initial bundle stays small.
 * 2. **Licence isolation.** LibreDWG is GPL-3.0. Confining it to this single
 *    adapter behind the `CadFileParser` interface keeps the dependency
 *    swappable — see the licensing section of the README.
 *
 * LibreDWG models the DWG database with DXF group-code semantics, so once the
 * database is in hand it goes through the same normaliser as DXF.
 */

import type { CadDocument } from '../model/document';
import { normaliseDxfLike, type DxfLikeBlock, type DxfLikeLayer, type RawRecord } from './dxfLike';
import {
  corruptDwgError,
  emptyFileError,
  parserUnavailableError,
  toCadParseError,
} from './errors';
import type { CadFileParser, ParseOptions } from './types';

export const DWG_PARSER_ID = 'libredwg-wasm';

/**
 * Directory (served statically) containing `libredwg-web.wasm`.
 * `scripts/sync-wasm.mjs` copies the binary here during `predev` / `prebuild`.
 */
const WASM_DIRECTORY = `${import.meta.env.BASE_URL ?? '/'}wasm/`.replace(/\/{2,}/g, '/');

/** Minimal surface of the LibreDWG module that this adapter relies on. */
interface LibreDwgInstance {
  dwg_read_data(content: ArrayBuffer, fileType: number): number | undefined;
  convert(pointer: number): LibreDwgDatabase;
  dwg_free(pointer: number): void;
}

interface LibreDwgDatabase {
  header?: Record<string, unknown>;
  entities?: unknown[];
  tables?: {
    LAYER?: { entries?: unknown[] };
    BLOCK_RECORD?: { entries?: unknown[] };
  };
}

/**
 * Cached module promise. LibreDWG keeps global state in its Emscripten heap, so
 * one instance is created and reused for every file.
 */
let modulePromise: Promise<LibreDwgInstance> | null = null;

async function loadLibreDwg(): Promise<LibreDwgInstance> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const { LibreDwg } = await import('@mlightcad/libredwg-web');
      return (await LibreDwg.create(WASM_DIRECTORY)) as unknown as LibreDwgInstance;
    })().catch((error: unknown) => {
      // Allow a retry on the next attempt rather than caching the failure.
      modulePromise = null;
      throw error;
    });
  }

  return modulePromise;
}

/** Lets the UI warm the parser up (and surface download cost) ahead of time. */
export function preloadDwgParser(): Promise<unknown> {
  return loadLibreDwg().catch((error: unknown) => {
    console.warn('[LiteCAD] DWG parser preload failed', error);
  });
}

export class DwgParserAdapter implements CadFileParser {
  readonly id = DWG_PARSER_ID;
  readonly label = 'DWG reader';
  readonly extensions = ['dwg'] as const;

  /** DWG support is always reachable; the WASM module downloads on demand. */
  readonly isAvailable = (): boolean => true;

  async parse(file: File, options: ParseOptions = {}): Promise<CadDocument> {
    const startedAt = performance.now();

    options.onProgress?.({ stage: 'reading', message: 'Opening drawing…' });
    const buffer = await file.arrayBuffer();

    if (buffer.byteLength === 0) throw emptyFileError(file.name);

    let libredwg: LibreDwgInstance;
    try {
      options.onProgress?.({ stage: 'reading', message: 'Loading DWG reader…' });
      libredwg = await loadLibreDwg();
    } catch (error) {
      console.error('[LiteCAD] failed to load LibreDWG WASM module', error);
      throw parserUnavailableError(this.label, error);
    }

    options.onProgress?.({ stage: 'parsing', message: 'Parsing entities…' });

    // DWG file type code 0; 1 would be DXF, which we handle with dxf-parser.
    let pointer: number | undefined;
    try {
      pointer = libredwg.dwg_read_data(buffer, 0);
    } catch (error) {
      console.error('[LiteCAD] LibreDWG threw while reading the file', error);
      throw corruptDwgError(error);
    }

    // A null pointer means LibreDWG rejected the file outright.
    if (!pointer) {
      throw corruptDwgError(
        undefined,
        'LibreDWG could not decode the drawing. Versions up to DWG 2018 (AC1032) are supported.',
      );
    }

    try {
      const database = libredwg.convert(pointer);
      options.onProgress?.({ stage: 'normalising', message: 'Building geometry…' });
      return buildDocument(database, file, startedAt, options);
    } catch (error) {
      console.error('[LiteCAD] DWG conversion failure', error);
      throw toCadParseError(error, 'Unable to interpret this DWG file.');
    } finally {
      // Always release the native allocation, even if conversion failed.
      try {
        libredwg.dwg_free(pointer);
      } catch (error) {
        console.warn('[LiteCAD] dwg_free failed', error);
      }
    }
  }
}

function buildDocument(
  database: LibreDwgDatabase,
  file: File,
  startedAt: number,
  options: ParseOptions,
): CadDocument {
  const layers: DxfLikeLayer[] = ((database.tables?.LAYER?.entries ?? []) as RawRecord[]).map(
    (entry) => ({
      name: String(entry.name ?? ''),
      colorIndex: typeof entry.colorIndex === 'number' ? entry.colorIndex : undefined,
      color: typeof entry.color === 'number' ? entry.color : undefined,
      off: entry.off === true,
      frozen: entry.frozen === true,
      locked: entry.locked === true,
    }),
  );

  // LibreDWG stores block contents on BLOCK_RECORD table entries. The
  // `*Model_Space` / `*Paper_Space` records are layouts rather than reusable
  // blocks, and their contents already appear in `database.entities`.
  const blocks: DxfLikeBlock[] = ((database.tables?.BLOCK_RECORD?.entries ?? []) as RawRecord[])
    .filter((entry) => !String(entry.name ?? '').startsWith('*'))
    .map((entry) => ({
      name: String(entry.name ?? ''),
      basePoint: entry.basePoint as RawRecord,
      entities: (entry.entities ?? []) as RawRecord[],
    }));

  const normalised = normaliseDxfLike(
    {
      entities: (database.entities ?? []) as RawRecord[],
      layers,
      blocks,
      header: (database.header ?? {}) as RawRecord,
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
      sourceFormat: 'dwg',
      parserId: DWG_PARSER_ID,
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
