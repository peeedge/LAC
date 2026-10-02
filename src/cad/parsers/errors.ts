/**
 * User-facing parse failures.
 *
 * A {@link CadParseError} carries a short title, an explanatory body and
 * optional bullet points. The UI renders exactly these fields, which is how we
 * guarantee a stack trace never reaches a normal user — the original error is
 * kept on `cause` for `console.error` only.
 */

export type CadParseErrorCode =
  | 'empty-file'
  | 'unsupported-format'
  | 'parser-unavailable'
  | 'corrupt-file'
  | 'unsupported-version'
  | 'no-geometry'
  | 'file-too-large'
  | 'unknown';

export interface CadParseErrorDetails {
  code: CadParseErrorCode;
  title: string;
  /** One or two sentences describing what went wrong. */
  description: string;
  /** Possible causes, rendered as a bulleted list. */
  reasons?: string[];
  /** A concrete next step the user can take. */
  suggestion?: string;
}

export class CadParseError extends Error {
  readonly code: CadParseErrorCode;
  readonly title: string;
  readonly description: string;
  readonly reasons: string[];
  readonly suggestion?: string;

  constructor(details: CadParseErrorDetails, cause?: unknown) {
    super(`${details.title} ${details.description}`);
    this.name = 'CadParseError';
    this.code = details.code;
    this.title = details.title;
    this.description = details.description;
    this.reasons = details.reasons ?? [];
    this.suggestion = details.suggestion;
    if (cause !== undefined) this.cause = cause;
  }

  /** Plain object form, safe to post across a Web Worker boundary. */
  toDetails(): CadParseErrorDetails {
    return {
      code: this.code,
      title: this.title,
      description: this.description,
      reasons: this.reasons,
      suggestion: this.suggestion,
    };
  }

  static fromDetails(details: CadParseErrorDetails): CadParseError {
    return new CadParseError(details);
  }
}

export function emptyFileError(fileName: string): CadParseError {
  return new CadParseError({
    code: 'empty-file',
    title: 'This file is empty.',
    description: `“${fileName}” contains no data, so there is nothing to draw.`,
    suggestion: 'Check that the file finished downloading or exporting, then try again.',
  });
}

export function unsupportedFormatError(extension: string): CadParseError {
  return new CadParseError({
    code: 'unsupported-format',
    title: 'Unsupported file type.',
    description: extension
      ? `LiteCAD cannot open “.${extension}” files.`
      : 'LiteCAD could not determine this file’s type.',
    reasons: ['Only DWG and DXF drawings are supported.'],
    suggestion: 'Open a .dwg or .dxf drawing instead.',
  });
}

export function corruptDwgError(cause?: unknown, detail?: string): CadParseError {
  return new CadParseError(
    {
      code: 'corrupt-file',
      title: 'Unable to read this DWG file.',
      description: detail ?? 'The drawing could not be decoded.',
      reasons: [
        'it uses a DWG version the parser does not support',
        'the file is corrupted or incomplete',
        'it relies on features that require a full CAD engine',
      ],
      suggestion:
        'Try re-saving the drawing as DXF, or export it from AutoCAD as an older DWG version (2018 or earlier).',
    },
    cause,
  );
}

export function corruptDxfError(cause?: unknown): CadParseError {
  return new CadParseError(
    {
      code: 'corrupt-file',
      title: 'Unable to read this DXF file.',
      description: 'The drawing could not be decoded.',
      reasons: [
        'the file is truncated or corrupted',
        'it is a binary DXF variant that is not supported',
        'it was produced by a non-standard exporter',
      ],
      suggestion: 'Re-export the drawing as an ASCII DXF (R2000 or later) and try again.',
    },
    cause,
  );
}

export function emptyDrawingError(): CadParseError {
  return new CadParseError({
    code: 'no-geometry',
    title: 'This drawing contains no visible geometry.',
    description: 'The file was read successfully but model space has no drawable entities.',
    reasons: [
      'all geometry lives in a paper-space layout',
      'the drawing only contains entity types LiteCAD does not render yet',
      'the drawing is genuinely empty',
    ],
    suggestion: 'Check the diagnostics panel to see which entity types were skipped.',
  });
}

export function parserUnavailableError(label: string, cause?: unknown): CadParseError {
  return new CadParseError(
    {
      code: 'parser-unavailable',
      title: `The ${label} could not be loaded.`,
      description:
        'The DWG reader is a WebAssembly module that is downloaded on first use, and that download did not complete.',
      reasons: [
        'the network request for the WebAssembly binary failed',
        'the asset is missing from the deployment',
      ],
      suggestion:
        'Check your connection and reload. If you are running locally, make sure `npm run sync:wasm` has been run.',
    },
    cause,
  );
}

/** Wraps anything non-`CadParseError` so the UI always has presentable copy. */
export function toCadParseError(error: unknown, fallbackTitle = 'Unable to open this drawing.'): CadParseError {
  if (error instanceof CadParseError) return error;

  return new CadParseError(
    {
      code: 'unknown',
      title: fallbackTitle,
      description: 'An unexpected problem occurred while reading the file.',
      suggestion: 'Open the browser console for technical details, then try a different file.',
    },
    error,
  );
}
