/**
 * Parser registry — the single place that maps a file onto a parser.
 *
 * To add a format: implement {@link CadFileParser} and register it here. To
 * replace DWG handling (for example with a server-side conversion service),
 * swap the entry without touching the UI, the store or the renderer.
 */

import { DwgParserAdapter } from './DwgParserAdapter';
import { DxfParserAdapter } from './DxfParserAdapter';
import { unsupportedFormatError } from './errors';
import { extensionOf, type CadFileParser } from './types';

const parsers: CadFileParser[] = [new DwgParserAdapter(), new DxfParserAdapter()];

export function registerParser(parser: CadFileParser): void {
  parsers.unshift(parser);
}

export function listParsers(): readonly CadFileParser[] {
  return parsers;
}

/** All supported extensions, for the file input's `accept` attribute. */
export function supportedExtensions(): string[] {
  return parsers.flatMap((parser) => [...parser.extensions]);
}

export function acceptAttribute(): string {
  return supportedExtensions()
    .map((extension) => `.${extension}`)
    .join(',');
}

export function findParserForFile(fileName: string): CadFileParser | undefined {
  const extension = extensionOf(fileName);
  return parsers.find((parser) => parser.extensions.includes(extension));
}

/** Resolves the parser for a file, throwing a presentable error when none fits. */
export function requireParserForFile(fileName: string): CadFileParser {
  const parser = findParserForFile(fileName);
  if (!parser) throw unsupportedFormatError(extensionOf(fileName));
  return parser;
}
