const backendUrl = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000";

type ApiOptions = {
  token?: string;
};

export async function apiGet<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(`${backendUrl}${path}`, {
    headers: createHeaders(options.token),
  });
  return parseResponse<T>(response);
}

export async function apiPost<T>(path: string, body: unknown, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(`${backendUrl}${path}`, {
    method: "POST",
    headers: createHeaders(options.token),
    body: JSON.stringify(body),
  });
  return parseResponse<T>(response);
}

function createHeaders(token?: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
