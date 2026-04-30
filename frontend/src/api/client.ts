import { getBackendHttpUrl } from "../config/backend-url";

type ApiOptions = {
  token?: string;
  cacheKey?: string;
  cacheTtlMs?: number;
};

export class ApiError extends Error {
  status: number;
  payload?: unknown;

  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export async function apiGet<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const backendUrl = getBackendHttpUrl();
  const cacheKey = getRequestCacheKey(path, options);
  if (cacheKey) {
    const cached = getCachedValue<T>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const inFlight = getInFlightValue<T>(cacheKey);
    if (inFlight) {
      return inFlight;
    }
  }

  const request = (async () => {
  const response = await safeFetch(`${backendUrl}${path}`, {
    credentials: "include",
    headers: createHeaders(options.token, false),
  });
    const parsed = await parseResponse<T>(response);
    if (cacheKey && typeof options.cacheTtlMs === "number" && options.cacheTtlMs > 0) {
      rememberCachedValue(cacheKey, parsed, options.cacheTtlMs);
    }
    return parsed;
  })();

  if (!cacheKey) {
    return request;
  }

  requestCacheInFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    requestCacheInFlight.delete(cacheKey);
  }
}

export async function apiPost<T>(path: string, body: unknown, options: ApiOptions = {}): Promise<T> {
  const backendUrl = getBackendHttpUrl();
  const response = await safeFetch(`${backendUrl}${path}`, {
    method: "POST",
    credentials: "include",
    headers: createHeaders(options.token),
    body: JSON.stringify(body),
  });
  clearRequestCache();
  return parseResponse<T>(response);
}

export async function apiDelete<T>(path: string, body: unknown, options: ApiOptions = {}): Promise<T> {
  const backendUrl = getBackendHttpUrl();
  const response = await safeFetch(`${backendUrl}${path}`, {
    method: "DELETE",
    credentials: "include",
    headers: createHeaders(options.token),
    body: JSON.stringify(body),
  });
  clearRequestCache();
  return parseResponse<T>(response);
}

export async function apiPatch<T>(path: string, body: unknown, options: ApiOptions = {}): Promise<T> {
  const backendUrl = getBackendHttpUrl();
  const response = await safeFetch(`${backendUrl}${path}`, {
    method: "PATCH",
    credentials: "include",
    headers: createHeaders(options.token),
    body: JSON.stringify(body),
  });
  clearRequestCache();
  return parseResponse<T>(response);
}

type RequestCacheEntry = {
  expiresAt: number;
  value: unknown;
};

const requestCache = new Map<string, RequestCacheEntry>();
const requestCacheInFlight = new Map<string, Promise<unknown>>();

function createHeaders(token?: string, includeJsonContentType = true): HeadersInit {
  const headers: Record<string, string> = {};

  if (includeJsonContentType) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function getRequestCacheKey(path: string, options: ApiOptions): string | null {
  if (typeof options.cacheTtlMs !== "number" || options.cacheTtlMs <= 0) {
    return null;
  }
  return options.cacheKey ?? path;
}

function getCachedValue<T>(cacheKey: string): T | undefined {
  const cached = requestCache.get(cacheKey);
  if (!cached) {
    return undefined;
  }
  if (cached.expiresAt <= Date.now()) {
    requestCache.delete(cacheKey);
    return undefined;
  }
  return cached.value as T;
}

function getInFlightValue<T>(cacheKey: string): Promise<T> | null {
  const cached = requestCacheInFlight.get(cacheKey);
  return cached ? (cached as Promise<T>) : null;
}

function rememberCachedValue(cacheKey: string, value: unknown, cacheTtlMs: number): void {
  requestCache.set(cacheKey, {
    expiresAt: Date.now() + cacheTtlMs,
    value,
  });
}

function clearRequestCache(): void {
  requestCache.clear();
  requestCacheInFlight.clear();
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `API request failed: ${response.status}`;
    let payload: unknown;
    try {
      payload = await response.json();
      const errorPayload = payload as { detail?: unknown };
      if (typeof errorPayload.detail === "string") {
        detail = errorPayload.detail;
      } else if (Array.isArray(errorPayload.detail)) {
        const issues = errorPayload.detail
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
    throw new ApiError(response.status, detail, payload);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const backendUrl = getBackendHttpUrl();
  try {
    return await fetch(input, init);
  } catch {
    await wait(1200);
    try {
      return await fetch(input, init);
    } catch {
      throw new Error(
        `Не удалось подключиться к серверу (${backendUrl}). Если backend на Render, он может просыпаться после cold start. Также проверь CORS и доступность сервиса.`,
      );
    }
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
