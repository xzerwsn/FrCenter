import { apiGet, apiPost } from "./client";
import type { DeviceKeyBundle } from "../crypto/devices";

export type DeviceResponse = {
  id: string;
  device_name: string;
  public_key: string;
  encrypted_private_key: string;
  last_seen_at: string;
  created_at: string;
};

export type DeviceListResponse = {
  devices: DeviceResponse[];
};

export type DevicePublicKeyResponse = {
  id: string;
  user_id: string;
  device_name: string;
  public_key: string;
  last_seen_at: string;
};

export type DevicePublicKeyListResponse = {
  devices: DevicePublicKeyResponse[];
};

export async function registerDevice(token: string, bundle: DeviceKeyBundle): Promise<DeviceResponse> {
  return apiPost<DeviceResponse>(
    "/api/devices",
    {
      device_name: bundle.deviceName,
      public_key: bundle.publicKey,
      encrypted_private_key: JSON.stringify({
        ciphertext: bundle.encryptedPrivateKey,
        nonce: bundle.privateKeyNonce,
        salt: bundle.privateKeySalt,
      }),
    },
    { token },
  );
}

export async function listMyDevices(token: string): Promise<DeviceListResponse> {
  return apiGet<DeviceListResponse>("/api/devices/me", { token });
}

export async function listUserPublicKeys(
  token: string,
  userId: string,
): Promise<DevicePublicKeyListResponse> {
  return apiGet<DevicePublicKeyListResponse>(`/api/devices/users/${userId}/public-keys`, { token });
}
