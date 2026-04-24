type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
};

type CacheCipherItem = {
  id: string;
  ciphertext: string;
  iv: string;
};

let worker: Worker | null = null;
let requestId = 0;
const pendingRequests = new Map<number, PendingRequest>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
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
      pending.reject(new Error(payload.error || "Worker request failed"));
    };
  }
  return worker;
}

function callWorker<Result>(type: string, payload?: unknown): Promise<Result> {
  const id = ++requestId;
  return new Promise<Result>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    getWorker().postMessage({ id, type, payload });
  });
}

export async function decryptMessagesInWorker(
  sharedKeyBase64: string,
  messages: Array<{ id: string; ciphertext: string; nonce: string }>,
): Promise<Array<{ id: string; plaintext: string }>> {
  return callWorker("decrypt-messages", { sharedKeyBase64, messages });
}

export async function encryptCacheEntriesInWorker(
  passphrase: string,
  salt: string,
  items: Array<{ id: string; plaintext: string }>,
): Promise<CacheCipherItem[]> {
  return callWorker("encrypt-cache", { passphrase, salt, items });
}

export async function decryptCacheEntriesInWorker(
  passphrase: string,
  salt: string,
  items: CacheCipherItem[],
): Promise<Array<{ id: string; plaintext: string }>> {
  return callWorker("decrypt-cache", { passphrase, salt, items });
}

export async function generateSharedKeyInWorker(): Promise<string> {
  return callWorker("generate-shared-key");
}
