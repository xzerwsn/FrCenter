export type MediaUploadResponse = {
  media_id: string;
  media_url: string;
  size: number;
  mime_type: string;
  filename: string;
};

const backendUrl = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000";

export async function uploadEncryptedMedia(
  token: string,
  chatId: string,
  encryptedFile: File,
): Promise<MediaUploadResponse> {
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("encrypted_file", encryptedFile);

  const response = await fetch(`${backendUrl}/api/media/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
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
