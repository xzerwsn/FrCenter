import sodium from "libsodium-wrappers-sumo";

import { base64ToBytes, bytesToBase64, bytesToText, textToBytes } from "./encoding";

export type EncryptedMessagePayload = {
  ciphertext: string;
  nonce: string;
};

export type EncryptedBinaryPayload = {
  ciphertextBytes: Uint8Array;
  nonce: string;
};

export async function encryptTextForSharedKey(
  plaintext: string,
  sharedKeyBase64: string,
): Promise<EncryptedMessagePayload> {
  await sodium.ready;
  const key = base64ToBytes(sharedKeyBase64);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(textToBytes(plaintext), nonce, key);

  return {
    ciphertext: bytesToBase64(ciphertext),
    nonce: bytesToBase64(nonce),
  };
}

export async function decryptTextWithSharedKey(
  payload: EncryptedMessagePayload,
  sharedKeyBase64: string,
): Promise<string> {
  await sodium.ready;
  const decrypted = sodium.crypto_secretbox_open_easy(
    base64ToBytes(payload.ciphertext),
    base64ToBytes(payload.nonce),
    base64ToBytes(sharedKeyBase64),
  );

  return bytesToText(decrypted);
}

export async function createSharedMessageKey(): Promise<string> {
  await sodium.ready;
  return bytesToBase64(sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES));
}

export async function encryptBytesForSharedKey(
  plaintextBytes: Uint8Array,
  sharedKeyBase64: string,
): Promise<EncryptedBinaryPayload> {
  await sodium.ready;
  const key = base64ToBytes(sharedKeyBase64);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(plaintextBytes, nonce, key);
  return {
    ciphertextBytes: ciphertext,
    nonce: bytesToBase64(nonce),
  };
}
