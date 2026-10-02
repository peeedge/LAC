/**
 * Parsing worker.
 *
 * Owns the parsed {@link CadDocument} for the lifetime of the loaded drawing so
 * the UI thread never has to hold (or clone) the entity list. All heavy work —
 * file reading, DWG WebAssembly decoding, tessellation — happens here, which is
 * what keeps the viewport interactive while a large file loads.
 */

/// <reference lib="webworker" />

import type { CadDocument } from '../cad/model/document';
import { CadParseError, toCadParseError } from '../cad/parsers/errors';
import { runPipeline, snapshotEntity } from './documentPipeline';
import { collectTransferables, type WorkerRequest, type WorkerResponse } from './protocol';

/** Retained between messages so entity details can be looked up on demand. */
let currentDocument: CadDocument | null = null;

function post(response: WorkerResponse, transfer?: Transferable[]): void {
  // `postMessage` in a module worker accepts a transfer list as the second argument.
  self.postMessage(response, { transfer: transfer ?? [] });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>): Promise<void> => {
  const request = event.data;

  switch (request.type) {
    case 'parse': {
      const { requestId, file } = request;

      try {
        const { document, summary, geometry } = await runPipeline(file, {
          tolerance: request.tolerance,
          onProgress: (progress) => post({ type: 'progress', requestId, progress }),
        });

        currentDocument = document;

        post(
          { type: 'parsed', requestId, summary, geometry },
          collectTransferables(geometry),
        );
      } catch (error) {
        currentDocument = null;
        const parseError =
          error instanceof CadParseError ? error : toCadParseError(error);

        // The full error (including any stack) stays in the console; only the
        // presentable fields cross back to the UI.
        console.error('[LiteCAD] parse failed', error);
        post({ type: 'error', requestId, error: parseError.toDetails() });
      }
      break;
    }

    case 'entity': {
      const snapshot = currentDocument
        ? snapshotEntity(currentDocument, request.entityIndex)
        : undefined;
      post({ type: 'entity', requestId: request.requestId, snapshot });
      break;
    }

    case 'dispose': {
      currentDocument = null;
      break;
    }

    default:
      break;
  }
};
