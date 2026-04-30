type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
};

let worker: Worker | null = null;
let requestId = 0;
const pendingRequests = new Map<number, PendingRequest>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./transport-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const payload = event.data;
      const pending = pendingRequests.get(payload.id);
      if (!pending) {
        return;
      }
      pendingRequests.delete(payload.id);
      if (payload.ok) {
        pending.resolve(payload.result);
        return;
      }
      pending.reject(new Error(payload.error || "Transport worker request failed"));
    };
  }
  return worker;
}

function callWorker<Result>(type: string, payload?: unknown, transfer?: Transferable[]): Promise<Result> {
  const id = ++requestId;
  return new Promise<Result>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    getWorker().postMessage({ id, type, payload }, transfer ?? []);
  });
}

export async function parseRealtimePayloadInWorker<Result>(message: string): Promise<Result[]> {
  return callWorker("parse-realtime", { message });
}

export async function parseJsonTextInWorker<Result>(text: string): Promise<Result> {
  return callWorker("parse-json-text", { text });
}

export async function parseJsonBytesInWorker<Result>(bytes: Uint8Array): Promise<Result> {
  const transferable = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return callWorker("parse-json-bytes", { buffer: transferable }, [transferable]);
}
