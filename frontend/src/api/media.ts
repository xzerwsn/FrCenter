import { getBackendHttpUrl } from "../config/backend-url";

export type MediaUploadResponse = {
  media_id: string;
  media_url: string;
  media_path: string;
  size: number;
  mime_type: string;
  filename: string;
};

export type PublicMediaUploadResponse = {
  asset_url: string;
  storage_key: string;
  size: number;
  mime_type: string;
  filename: string;
};

export async function uploadEncryptedMedia(
  token: string,
  chatId: string,
  encryptedFile: File,
): Promise<MediaUploadResponse> {
  const backendUrl = getBackendHttpUrl();
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("encrypted_file", encryptedFile);

  const response = await fetch(`${backendUrl}/api/media/upload`, {
    method: "POST",
    credentials: "include",
    headers: token
      ? {
          Authorization: `Bearer ${token}`,
        }
      : undefined,
    body: formData,
  });

  if (!response.ok) {
    let detail = `API request failed: ${response.status}`;
    try {
      const payload = await response.json();
      if (typeof payload.detail === "string") {
        detail = payload.detail;
      }
    } catch {
      // keep generic message
    }
    throw new Error(detail);
  }

  return response.json() as Promise<MediaUploadResponse>;
}

export async function uploadPublicMedia(
  token: string,
  file: File,
  category: string,
): Promise<PublicMediaUploadResponse> {
  const backendUrl = getBackendHttpUrl();
  const formData = new FormData();
  formData.append("file", file);
  formData.append("category", category);

  const response = await fetch(`${backendUrl}/api/media/public-upload`, {
    method: "POST",
    credentials: "include",
    headers: token
      ? {
          Authorization: `Bearer ${token}`,
        }
      : undefined,
    body: formData,
  });

  if (!response.ok) {
    let detail = `API request failed: ${response.status}`;
    try {
      const payload = await response.json();
      if (typeof payload.detail === "string") {
        detail = payload.detail;
      }
    } catch {
      // keep generic message
    }
    throw new Error(detail);
  }

  return response.json() as Promise<PublicMediaUploadResponse>;
}
