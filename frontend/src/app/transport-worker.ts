/// <reference lib="webworker" />

type WorkerRequest =
  | {
      id: number;
      type: "parse-realtime";
      payload: {
        message: string;
      };
    }
  | {
      id: number;
      type: "parse-json-text";
      payload: {
        text: string;
      };
    }
  | {
      id: number;
      type: "parse-json-bytes";
      payload: {
        buffer: ArrayBuffer;
      };
    };

type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    switch (request.type) {
      case "parse-realtime": {
        const result = await parseRealtimeEnvelope(request.payload.message);
        respond({ id: request.id, ok: true, result });
        return;
      }
      case "parse-json-text": {
        respond({
          id: request.id,
          ok: true,
          result: JSON.parse(request.payload.text),
        });
        return;
      }
      case "parse-json-bytes": {
        const text = new TextDecoder().decode(request.payload.buffer);
        respond({
          id: request.id,
          ok: true,
          result: JSON.parse(text),
        });
        return;
      }
      default: {
        const unknownRequest = request as { id: number };
        respond({ id: unknownRequest.id, ok: false, error: "Unknown transport worker request" });
      }
    }
  } catch (error) {
    respond({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : "Transport worker failed",
    });
  }
};

async function parseRealtimeEnvelope(message: string): Promise<unknown[]> {
  const payload = JSON.parse(message) as
    | { type?: string; events?: unknown[]; encoding?: string; payload?: string }
    | Record<string, unknown>;

  if (payload.type === "batch" && Array.isArray(payload.events)) {
    return payload.events;
  }
  if (payload.type === "batch.compressed" && payload.encoding === "gzip+base64" && typeof payload.payload === "string") {
    return decompressEvents(payload.payload);
  }
  return [payload];
}

async function decompressEvents(payload: string): Promise<unknown[]> {
  const compressed = base64ToBytes(payload);
  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  const decoded = JSON.parse(text) as { events?: unknown[] };
  return Array.isArray(decoded.events) ? decoded.events : [];
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function respond(response: WorkerResponse): void {
  self.postMessage(response);
}
