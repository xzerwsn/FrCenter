const DEFAULT_BACKEND_URL = "https://frcenter-backend.onrender.com";

export function getDefaultBackendHttpUrl(): string {
  return DEFAULT_BACKEND_URL;
}

export function getBackendHttpUrl(): string {
  return DEFAULT_BACKEND_URL;
}

export function getBackendWebSocketBaseUrl(): string {
  try {
    const parsed = new URL(DEFAULT_BACKEND_URL);
    const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${parsed.host}${normalizePath(parsed.pathname)}`;
  } catch {
    return "wss://frcenter-backend.onrender.com";
  }
}

export function saveBackendHttpUrl(_value: string): string {
  return DEFAULT_BACKEND_URL;
}

export function resetBackendHttpUrl(): string {
  return DEFAULT_BACKEND_URL;
}

export function subscribeBackendUrl(listener: (url: string) => void): () => void {
  listener(DEFAULT_BACKEND_URL);
  return () => undefined;
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
