/// <reference lib="webworker" />

import { base64ToBytes, bytesToBase64, textToBytes } from "./encoding";
import {
  createSharedMessageKey,
  decryptTextWithSharedKey,
} from "./messages";

type WorkerRequest =
  | {
      id: number;
      type: "decrypt-messages";
      payload: {
        sharedKeyBase64: string;
        messages: Array<{ id: string; ciphertext: string; nonce: string }>;
      };
    }
  | {
      id: number;
      type: "encrypt-cache";
      payload: {
        passphrase: string;
        salt: string;
        items: Array<{ id: string; plaintext: string }>;
      };
    }
  | {
      id: number;
      type: "decrypt-cache";
      payload: {
        passphrase: string;
        salt: string;
        items: Array<{ id: string; ciphertext: string; iv: string }>;
      };
    }
  | {
      id: number;
      type: "generate-shared-key";
    }
  | {
      id: number;
      type: "encrypt-text";
      payload: {
        plaintext: string;
        sharedKeyBase64: string;
      };
    }
  | {
      id: number;
      type: "encrypt-bytes";
      payload: {
        plaintextBuffer: ArrayBuffer;
        sharedKeyBase64: string;
      };
    }
  | {
      id: number;
      type: "clear-session";
    };

type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const derivedKeyCache = new Map<string, Promise<CryptoKey>>();
let sodiumModulePromise: Promise<typeof import("libsodium-wrappers-sumo")> | null = null;
const sharedKeyCache = new Map<string, Uint8Array>();

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    switch (request.type) {
      case "decrypt-messages": {
        const result = await Promise.all(
          request.payload.messages.map(async (message) => {
            try {
              const plaintext = await decryptTextWithSharedKey(
                { ciphertext: message.ciphertext, nonce: message.nonce },
                request.payload.sharedKeyBase64,
              );
              return { id: message.id, plaintext };
            } catch {
              return { id: message.id, plaintext: "Не удалось расшифровать сообщение" };
            }
          }),
        );
        respond({ id: request.id, ok: true, result });
        return;
      }
      case "encrypt-cache": {
        const key = await getDerivedAesKey(request.payload.passphrase, request.payload.salt);
        const result = await Promise.all(
          request.payload.items.map(async (item) => {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const ciphertext = await crypto.subtle.encrypt(
              { name: "AES-GCM", iv },
              key,
              textEncoder.encode(item.plaintext),
            );
            return {
              id: item.id,
              ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
              iv: bytesToBase64(iv),
            };
          }),
        );
        respond({ id: request.id, ok: true, result });
        return;
      }
      case "decrypt-cache": {
        const key = await getDerivedAesKey(request.payload.passphrase, request.payload.salt);
        const result = await Promise.all(
          request.payload.items.map(async (item) => {
            try {
              const encryptedBytes = base64ToBytes(item.ciphertext);
              const decrypted = await crypto.subtle.decrypt(
                {
                  name: "AES-GCM",
                  iv: toArrayBuffer(base64ToBytes(item.iv)),
                },
                key,
                toArrayBuffer(encryptedBytes),
              );
              return {
                id: item.id,
                plaintext: textDecoder.decode(decrypted),
              };
            } catch {
              return null;
            }
          }),
        );
        const filtered = result.filter(
          (item): item is { id: string; plaintext: string } => item !== null,
        );
        respond({ id: request.id, ok: true, result: filtered });
        return;
      }
      case "generate-shared-key": {
        const result = await createSharedMessageKey();
        respond({ id: request.id, ok: true, result });
        return;
      }
      case "encrypt-text": {
        const sodium = await getSodium();
        const key = getSharedKeyBytes(request.payload.sharedKeyBase64);
        const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
        const ciphertext = sodium.crypto_secretbox_easy(textToBytes(request.payload.plaintext), nonce, key);
        respond({
          id: request.id,
          ok: true,
          result: {
            ciphertext: bytesToBase64(ciphertext),
            nonce: bytesToBase64(nonce),
          },
        });
        return;
      }
      case "encrypt-bytes": {
        const sodium = await getSodium();
        const key = getSharedKeyBytes(request.payload.sharedKeyBase64);
        const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
        const ciphertext = sodium.crypto_secretbox_easy(new Uint8Array(request.payload.plaintextBuffer), nonce, key);
        const ciphertextBuffer = toArrayBuffer(ciphertext);
        respondWithTransfer(
          {
            id: request.id,
            ok: true,
            result: {
              ciphertextBuffer,
              nonce: bytesToBase64(nonce),
            },
          },
          [ciphertextBuffer],
        );
        return;
      }
      case "clear-session": {
        derivedKeyCache.clear();
        sharedKeyCache.clear();
        sodiumModulePromise = null;
        respond({ id: request.id, ok: true, result: true });
        return;
      }
      default: {
        const unknownRequest = request as { id: number };
        respond({ id: unknownRequest.id, ok: false, error: "Unknown worker request" });
      }
    }
  } catch (error) {
    respond({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : "Crypto worker failed",
    });
  }
};

function getDerivedAesKey(passphrase: string, salt: string): Promise<CryptoKey> {
  const cacheKey = `${salt}::${passphrase}`;
  const existing = derivedKeyCache.get(cacheKey);
  if (existing) {
    return existing;
  }
  const next = deriveAesKey(passphrase, salt);
  derivedKeyCache.set(cacheKey, next);
  return next;
}

async function deriveAesKey(passphrase: string, salt: string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: textEncoder.encode(salt),
      iterations: 120_000,
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function respond(response: WorkerResponse) {
  self.postMessage(response);
}

function respondWithTransfer(response: WorkerResponse, transfer: Transferable[]) {
  self.postMessage(response, transfer);
}

async function getSodium() {
  sodiumModulePromise ??= import("libsodium-wrappers-sumo");
  const sodiumModule = await sodiumModulePromise;
  const sodium = (("default" in sodiumModule ? sodiumModule.default : sodiumModule) ?? sodiumModule) as typeof import("libsodium-wrappers-sumo");
  await sodium.ready;
  return sodium;
}

function getSharedKeyBytes(sharedKeyBase64: string): Uint8Array {
  const existing = sharedKeyCache.get(sharedKeyBase64);
  if (existing) {
    return existing;
  }
  const decoded = base64ToBytes(sharedKeyBase64);
  sharedKeyCache.set(sharedKeyBase64, decoded);
  return decoded;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
