import { bytesToBase64, textToBytes } from "./encoding";

export type DeviceKeyBundle = {
  deviceName: string;
  publicKey: string;
  encryptedPrivateKey: string;
  privateKeyNonce: string;
  privateKeySalt: string;
};

const KEY_DERIVATION_OPSLIMIT = 3;
const KEY_DERIVATION_MEMLIMIT = 64 * 1024 * 1024;

let sodiumModulePromise: Promise<typeof import("libsodium-wrappers-sumo")> | null = null;

async function getSodium() {
  sodiumModulePromise ??= import("libsodium-wrappers-sumo");
  const sodium = await sodiumModulePromise;
  await sodium.ready;
  return sodium;
}

export async function createDeviceKeyBundle(
  deviceName: string,
  cloudPassword: string,
): Promise<DeviceKeyBundle> {
  const sodium = await getSodium();

  const keyPair = sodium.crypto_box_keypair();
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const wrappingKey = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    cloudPassword,
    salt,
    KEY_DERIVATION_OPSLIMIT,
    KEY_DERIVATION_MEMLIMIT,
    sodium.crypto_pwhash_ALG_DEFAULT,
  );
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const encryptedPrivateKey = sodium.crypto_secretbox_easy(keyPair.privateKey, nonce, wrappingKey);

  return {
    deviceName,
    publicKey: bytesToBase64(keyPair.publicKey),
    encryptedPrivateKey: bytesToBase64(encryptedPrivateKey),
    privateKeyNonce: bytesToBase64(nonce),
    privateKeySalt: bytesToBase64(salt),
  };
}

export async function fingerprintPublicKey(publicKey: string): Promise<string> {
  const sodium = await getSodium();
  const hash = sodium.crypto_hash_sha256(textToBytes(publicKey)).slice(0, 8);
  return bytesToBase64(hash);
}
