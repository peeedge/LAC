/**
 * Message contract between the UI thread and the parsing worker.
 *
 * The worker keeps the full {@link CadDocument} in its own heap and hands the UI
 * only two things: a small summary, and typed arrays that are *transferred*
 * (zero-copy) rather than cloned. Individual entity details are fetched on
 * demand for the selected entity. This keeps load time independent of how many
 * entity objects the drawing contains — structured-cloning a million objects
 * would block the main thread for seconds.
 */

import type { BoundingBox } from '../cad/model/boundingBox';
import type {
  CadDiagnostic,
  CadEntityType,
  CadLayer,
  CadMetadata,
  CadUnits,
} from '../cad/model/document';
import type { GeometryBundle } from '../cad/geometry/buildGeometry';
import type { CadParseErrorDetails } from '../cad/parsers/errors';
import type { ParseProgress } from '../cad/parsers/types';

/** Everything the UI needs about a drawing, without the entity list. */
export interface CadDocumentSummary {
  metadata: CadMetadata;
  units: CadUnits;
  layers: CadLayer[];
  /** World-coordinate bounds computed from real geometry. */
  bounds: BoundingBox;
  diagnostics: CadDiagnostic[];
  entityCount: number;
  segmentCount: number;
  blockCount: number;
  /** Entity counts keyed by type, for the statistics panel. */
  entityTypeCounts: Partial<Record<CadEntityType, number>>;
}

/** A single entity, resolved for display in the property inspector. */
export interface CadEntitySnapshot {
  /** Ordinal position in the document's entity list. */
  index: number;
  id: string;
  type: CadEntityType;
  layerId: string;
  layerName: string;
  /** Explicit entity colour, if it overrides the layer. */
  color?: string;
  /** Colour actually used when drawing. */
  effectiveColor: string;
  lineType?: string;
  handle?: string;
  /** Set when the entity came from a block reference, e.g. `DOOR/HINGE`. */
  blockPath?: string;
  /** World-coordinate bounds. */
  bounds: BoundingBox;
  /** World-coordinate geometry, shape depends on `type`. */
  geometry: unknown;
  properties?: Record<string, unknown>;
}

export interface ParseRequest {
  type: 'parse';
  requestId: number;
  file: File;
  tolerance?: number;
}

export interface EntityRequest {
  type: 'entity';
  requestId: number;
  entityIndex: number;
}

export interface DisposeRequest {
  type: 'dispose';
}

export type WorkerRequest = ParseRequest | EntityRequest | DisposeRequest;

export interface ProgressResponse {
  type: 'progress';
  requestId: number;
  progress: ParseProgress;
}

export interface ParseSuccessResponse {
  type: 'parsed';
  requestId: number;
  summary: CadDocumentSummary;
  geometry: GeometryBundle;
}

export interface ParseErrorResponse {
  type: 'error';
  requestId: number;
  error: CadParseErrorDetails;
}

export interface EntityResponse {
  type: 'entity';
  requestId: number;
  snapshot?: CadEntitySnapshot;
}

export type WorkerResponse =
  | ProgressResponse
  | ParseSuccessResponse
  | ParseErrorResponse
  | EntityResponse;

/**
 * Collects the `ArrayBuffer`s inside a geometry bundle so `postMessage` can
 * transfer rather than copy them.
 */
export function collectTransferables(geometry: GeometryBundle): Transferable[] {
  const transferables: Transferable[] = [
    geometry.pick.vertices.buffer,
    geometry.pick.ranges.buffer,
    geometry.pick.kinds.buffer,
    geometry.pick.layerIndices.buffer,
    geometry.pick.bounds.buffer,
  ];

  for (const batch of geometry.lineBatches) {
    transferables.push(batch.positions.buffer, batch.colors.buffer);
  }
  for (const batch of geometry.pointBatches) {
    transferables.push(batch.positions.buffer, batch.colors.buffer);
  }
  for (const batch of geometry.faceBatches) {
    transferables.push(batch.positions.buffer, batch.colors.buffer);
  }

  // De-duplicate: a zero-length batch can share the same empty buffer.
  return [...new Set(transferables)];
}
