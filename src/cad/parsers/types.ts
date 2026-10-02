/**
 * The parser boundary.
 *
 * Every CAD format is plugged in behind {@link CadFileParser}. The UI and the
 * renderer only ever see the {@link CadDocument} a parser returns, so adding a
 * format (or moving DWG handling to a server) requires no changes outside this
 * folder.
 */

import type { CadDocument } from '../model/document';

/** Coarse stages reported while a file is being read, in order. */
export type ParseStage =
  | 'reading'
  | 'parsing'
  | 'normalising'
  | 'building-geometry'
  | 'rendering'
  | 'done';

export interface ParseProgress {
  stage: ParseStage;
  /** Human readable status for the UI, e.g. `Parsing entities…`. */
  message: string;
  /** Completion in `[0, 1]`, or `undefined` when indeterminate. */
  ratio?: number;
}

export type ParseProgressCallback = (progress: ParseProgress) => void;

export interface ParseOptions {
  onProgress?: ParseProgressCallback;
  /** Chord tolerance in drawing units, forwarded to the tessellator. */
  tolerance?: number;
  /**
   * Maximum depth for expanding nested block references. Guards against
   * self-referential blocks in malformed files.
   */
  maxBlockDepth?: number;
}

/**
 * A single CAD format implementation.
 *
 * Parsers must not throw raw errors; failures are wrapped in
 * {@link CadParseError} so the UI can show actionable guidance.
 */
export interface CadFileParser {
  /** Stable identifier recorded in `CadMetadata.parserId`. */
  readonly id: string;
  /** Display name for the diagnostics panel. */
  readonly label: string;
  /** Lower-case extensions this parser handles, without the dot. */
  readonly extensions: readonly string[];
  /** True when the parser can run without downloading extra assets. */
  readonly isAvailable: () => boolean;

  parse(file: File, options?: ParseOptions): Promise<CadDocument>;
}

/** Matches a file against a parser's declared extensions. */
export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index === -1 ? '' : fileName.slice(index + 1).toLowerCase();
}
