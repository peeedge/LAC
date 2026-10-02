/**
 * The parse → normalise → build-geometry pipeline.
 *
 * Kept free of worker APIs so it can run either inside the worker or directly on
 * the main thread (used by unit tests and as a fallback where Workers are
 * unavailable).
 */

import { buildGeometry, type GeometryBundle } from '../cad/geometry/buildGeometry';
import type { CadDocument, CadEntityType } from '../cad/model/document';
import { emptyDrawingError } from '../cad/parsers/errors';
import { requireParserForFile } from '../cad/parsers/registry';
import type { ParseProgressCallback } from '../cad/parsers/types';
import type { CadDocumentSummary, CadEntitySnapshot } from './protocol';

export interface PipelineResult {
  document: CadDocument;
  summary: CadDocumentSummary;
  geometry: GeometryBundle;
}

export interface PipelineOptions {
  tolerance?: number;
  onProgress?: ParseProgressCallback;
}

export async function runPipeline(file: File, options: PipelineOptions = {}): Promise<PipelineResult> {
  const parser = requireParserForFile(file.name);

  const document = await parser.parse(file, {
    tolerance: options.tolerance,
    onProgress: options.onProgress,
  });

  options.onProgress?.({ stage: 'building-geometry', message: 'Building geometry…' });

  const geometry = buildGeometry(document, {
    tolerance: options.tolerance,
    onProgress: (processed, total) =>
      options.onProgress?.({
        stage: 'building-geometry',
        message: 'Building geometry…',
        ratio: total > 0 ? processed / total : undefined,
      }),
  });

  // A file that parses but yields nothing drawable is reported as an error so the
  // user is not left staring at an empty viewport with no explanation.
  if (document.entities.length === 0) throw emptyDrawingError();

  return { document, summary: buildSummary(document, geometry), geometry };
}

export function buildSummary(document: CadDocument, geometry: GeometryBundle): CadDocumentSummary {
  const entityTypeCounts: Partial<Record<CadEntityType, number>> = {};
  for (const entity of document.entities) {
    entityTypeCounts[entity.type] = (entityTypeCounts[entity.type] ?? 0) + 1;
  }

  return {
    metadata: document.metadata,
    units: document.units,
    layers: document.layers,
    bounds: document.bounds,
    diagnostics: document.diagnostics,
    entityCount: document.entities.length,
    segmentCount: geometry.segmentCount,
    blockCount: document.blocks.size,
    entityTypeCounts,
  };
}

/** Resolves one entity into the display-ready form used by the inspector. */
export function snapshotEntity(
  document: CadDocument,
  entityIndex: number,
): CadEntitySnapshot | undefined {
  const entity = document.entities[entityIndex];
  if (!entity) return undefined;

  const layer = document.layers.find((candidate) => candidate.id === entity.layerId);

  return {
    index: entityIndex,
    id: entity.id,
    type: entity.type,
    layerId: entity.layerId,
    layerName: layer?.name ?? entity.layerId,
    color: entity.color,
    effectiveColor: entity.color ?? layer?.color ?? '#ffffff',
    lineType: entity.lineType,
    handle: entity.handle,
    blockPath: entity.blockPath,
    bounds: entity.bounds,
    geometry: entity.geometry,
    properties: entity.properties,
  };
}
