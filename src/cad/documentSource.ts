/**
 * The UI's gateway to a loaded drawing.
 *
 * Two implementations share one interface:
 *
 * - {@link WorkerDocumentSource} runs the pipeline off the main thread. This is
 *   what the app uses, and it is why the UI stays responsive while a large DWG
 *   is decoded.
 * - {@link InProcessDocumentSource} runs it inline. Used by unit tests and as an
 *   automatic fallback if `Worker` is unavailable.
 *
 * Because the UI depends only on this interface, moving DWG parsing to a server
 * later is a change confined to this file plus a parser adapter.
 */

import type { GeometryBundle } from './geometry/buildGeometry';
import { CadParseError, toCadParseError } from './parsers/errors';
import type { ParseProgressCallback } from './parsers/types';
import {
  runPipeline,
  snapshotEntity,
  type PipelineResult,
} from '../workers/documentPipeline';
import type {
  CadDocumentSummary,
  CadEntitySnapshot,
  WorkerRequest,
  WorkerResponse,
} from '../workers/protocol';

export interface LoadedDrawing {
  summary: CadDocumentSummary;
  geometry: GeometryBundle;
}

export interface CadDocumentSource {
  load(file: File, onProgress?: ParseProgressCallback): Promise<LoadedDrawing>;
  getEntity(entityIndex: number): Promise<CadEntitySnapshot | undefined>;
  dispose(): void;
}

// ---------------------------------------------------------------------------

/** Runs the pipeline on the calling thread. */
export class InProcessDocumentSource implements CadDocumentSource {
  private result: PipelineResult | null = null;

  async load(file: File, onProgress?: ParseProgressCallback): Promise<LoadedDrawing> {
    this.result = await runPipeline(file, { onProgress });
    return { summary: this.result.summary, geometry: this.result.geometry };
  }

  async getEntity(entityIndex: number): Promise<CadEntitySnapshot | undefined> {
    if (!this.result) return undefined;
    return snapshotEntity(this.result.document, entityIndex);
  }

  dispose(): void {
    this.result = null;
  }
}

// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (response: WorkerResponse) => void;
  reject: (error: unknown) => void;
  onProgress?: ParseProgressCallback;
}

/**
 * `Omit` collapses unions into their common keys, so it is applied per-member to
 * keep each request variant's own fields.
 */
type WithoutRequestId<T> = T extends { requestId: number } ? Omit<T, 'requestId'> : T;

/** A request as callers supply it; `requestId` is assigned by {@link WorkerDocumentSource.send}. */
type OutgoingRequest = WithoutRequestId<WorkerRequest>;

/** Runs the pipeline in a dedicated module worker. */
export class WorkerDocumentSource implements CadDocumentSource {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    // `new URL(..., import.meta.url)` is the form Vite statically analyses to
    // bundle the worker as a separate chunk.
    const worker = new Worker(new URL('../workers/parser.worker.ts', import.meta.url), {
      type: 'module',
      name: 'litecad-parser',
    });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const entry = this.pending.get(response.requestId);
      if (!entry) return;

      if (response.type === 'progress') {
        entry.onProgress?.(response.progress);
        return;
      }

      this.pending.delete(response.requestId);
      entry.resolve(response);
    };

    worker.onerror = (event) => {
      console.error('[LiteCAD] parser worker error', event);
      const error = toCadParseError(
        event.error ?? new Error(event.message || 'Worker failed'),
        'The drawing could not be processed.',
      );
      // A worker-level failure invalidates every in-flight request.
      for (const [, entry] of this.pending) entry.reject(error);
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    };

    this.worker = worker;
    return worker;
  }

  private send(
    request: OutgoingRequest,
    onProgress?: ParseProgressCallback,
  ): Promise<WorkerResponse> {
    const worker = this.ensureWorker();
    const requestId = this.nextRequestId++;

    return new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, onProgress });
      worker.postMessage({ ...request, requestId } as WorkerRequest);
    });
  }

  async load(file: File, onProgress?: ParseProgressCallback): Promise<LoadedDrawing> {
    const response = await this.send({ type: 'parse', file }, onProgress);

    if (response.type === 'error') throw CadParseError.fromDetails(response.error);
    if (response.type !== 'parsed') throw toCadParseError(new Error('Unexpected worker response'));

    return { summary: response.summary, geometry: response.geometry };
  }

  async getEntity(entityIndex: number): Promise<CadEntitySnapshot | undefined> {
    const response = await this.send({ type: 'entity', entityIndex });
    return response.type === 'entity' ? response.snapshot : undefined;
  }

  dispose(): void {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'dispose' } satisfies WorkerRequest);
    this.worker.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

/** Picks the worker implementation when the environment supports it. */
export function createDocumentSource(): CadDocumentSource {
  if (typeof Worker === 'undefined') {
    console.warn('[LiteCAD] Web Workers unavailable; parsing on the main thread.');
    return new InProcessDocumentSource();
  }
  return new WorkerDocumentSource();
}
