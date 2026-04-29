const DEFAULT_BACKEND_URL = normalizeBackendUrl(import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000") ?? "http://localhost:8000";

export const BACKEND_URL_STORAGE_KEY = "frcenter.backendUrl";

const BACKEND_URL_CHANGED_EVENT = "frcenter:backend-url-changed";

export function getDefaultBackendHttpUrl(): string {
  return DEFAULT_BACKEND_URL;
}

export function getBackendHttpUrl(): string {
  if (typeof window === "undefined") {
    return DEFAULT_BACKEND_URL;
  }

  try {
    const saved = window.localStorage.getItem(BACKEND_URL_STORAGE_KEY);
    return normalizeBackendUrl(saved) ?? DEFAULT_BACKEND_URL;
  } catch {
    return DEFAULT_BACKEND_URL;
  }
}

export function getBackendWebSocketBaseUrl(): string {
  try {
    const parsed = new URL(getBackendHttpUrl());
    const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${parsed.host}${normalizePath(parsed.pathname)}`;
  } catch {
    return "ws://localhost:8000";
  }
}

export function saveBackendHttpUrl(value: string): string {
  const normalized = normalizeBackendUrl(value);
  if (!normalized) {
    throw new Error("Укажи корректный backend URL вида http://127.0.0.1:8000");
  }

  if (typeof window !== "undefined") {
    try {
      if (normalized === DEFAULT_BACKEND_URL) {
        window.localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
      } else {
        window.localStorage.setItem(BACKEND_URL_STORAGE_KEY, normalized);
      }
    } catch {
      // Ignore storage write errors and still use the value in-memory for this session.
    }

    window.dispatchEvent(
      new CustomEvent<string>(BACKEND_URL_CHANGED_EVENT, {
        detail: normalized,
      }),
    );
  }

  return normalized;
}

export function resetBackendHttpUrl(): string {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
    } catch {
      // Ignore storage write errors.
    }

    window.dispatchEvent(
      new CustomEvent<string>(BACKEND_URL_CHANGED_EVENT, {
        detail: DEFAULT_BACKEND_URL,
      }),
    );
  }

  return DEFAULT_BACKEND_URL;
}

export function subscribeBackendUrl(listener: (url: string) => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleChange = (event: Event) => {
    const detail = event instanceof CustomEvent && typeof event.detail === "string" ? event.detail : getBackendHttpUrl();
    listener(detail);
  };

  window.addEventListener(BACKEND_URL_CHANGED_EVENT, handleChange as EventListener);
  return () => window.removeEventListener(BACKEND_URL_CHANGED_EVENT, handleChange as EventListener);
}

export function normalizeBackendUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return `${parsed.protocol}//${parsed.host}${normalizePath(parsed.pathname)}`;
  } catch {
    return null;
  }
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "";
  }
  return pathname.replace(/\/+$/, "");
}
