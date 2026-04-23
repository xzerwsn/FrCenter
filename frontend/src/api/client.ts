const backendUrl = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000";

type ApiOptions = {
  token?: string;
};

export async function apiGet<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await safeFetch(`${backendUrl}${path}`, {
    headers: createHeaders(options.token),
  });
  return parseResponse<T>(response);
}

export async function apiPost<T>(path: string, body: unknown, options: ApiOptions = {}): Promise<T> {
  const response = await safeFetch(`${backendUrl}${path}`, {
    method: "POST",
    headers: createHeaders(options.token),
    body: JSON.stringify(body),
  });
  return parseResponse<T>(response);
}

export async function apiDelete<T>(path: string, body: unknown, options: ApiOptions = {}): Promise<T> {
  const response = await safeFetch(`${backendUrl}${path}`, {
    method: "DELETE",
    headers: createHeaders(options.token),
    body: JSON.stringify(body),
  });
  return parseResponse<T>(response);
}

export async function apiPatch<T>(path: string, body: unknown, options: ApiOptions = {}): Promise<T> {
  const response = await safeFetch(`${backendUrl}${path}`, {
    method: "PATCH",
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
    let detail = `API request failed: ${response.status}`;
    try {
      const payload = await response.json();
      if (typeof payload.detail === "string") {
        detail = payload.detail;
      } else if (Array.isArray(payload.detail)) {
        const issues = payload.detail
          .map((item: unknown) => {
            if (!item || typeof item !== "object") {
              return null;
            }
            const issue = item as { loc?: unknown; msg?: unknown };
            const msg = typeof issue.msg === "string" ? issue.msg : null;
            const field =
              Array.isArray(issue.loc) && issue.loc.length > 0
                ? String(issue.loc[issue.loc.length - 1])
                : "field";
            return msg ? `${field}: ${msg}` : null;
          })
          .filter((item: string | null): item is string => Boolean(item));
        if (issues.length > 0) {
          detail = issues.join("; ");
        }
      }
    } catch {
      // Keep the generic message when the server returns no JSON body.
    }
    throw new Error(detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error(
      `Не удалось подключиться к серверу (${backendUrl}). Проверь, что backend запущен и CORS разрешает origin фронтенда.`,
    );
  }
}
