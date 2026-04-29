import type { CurrentUser } from "../api/users";

const LEGACY_TOKEN_KEY = "frcenter.accessToken";
const USER_KEY = "frcenter.currentUser";

export type Session = {
  token: string;
  user: CurrentUser;
};

export function saveSession(session: Session): void {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // Ignore cleanup failures for legacy token storage.
  }

  const primaryPayload = serializeStoredUser(session.user, "full");
  if (tryStoreUser(primaryPayload)) {
    return;
  }

  const compactPayload = serializeStoredUser(session.user, "compact");
  if (tryStoreUser(compactPayload)) {
    return;
  }

  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function loadSession(): Session | null {
  let userJson: string | null = null;
  try {
    userJson = localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
  if (!userJson) {
    return null;
  }

  try {
    return { token: "", user: normalizeStoredUser(JSON.parse(userJson)) };
  } catch {
    return { token: "", user: normalizeStoredUser({}) };
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function normalizeStoredUser(raw: unknown): CurrentUser {
  const user = (raw && typeof raw === "object" ? raw : {}) as Partial<CurrentUser>;
  return {
    id: typeof user.id === "string" ? user.id : "",
    email: typeof user.email === "string" ? user.email : "",
    username: typeof user.username === "string" ? user.username : "",
    display_name: typeof user.display_name === "string" ? user.display_name : null,
    nickname: typeof user.nickname === "string" ? user.nickname : null,
    profile_status: typeof user.profile_status === "string" ? user.profile_status : null,
    profile_photos: Array.isArray(user.profile_photos)
      ? user.profile_photos.map((item) => {
          if (item && typeof item === "object" && typeof (item as { url?: unknown }).url === "string") {
            return {
              url: (item as { url: string }).url,
              caption: typeof (item as { caption?: unknown }).caption === "string" ? (item as { caption: string }).caption : null,
            };
          }
          if (typeof item === "string") {
            return { url: item, caption: null };
          }
          return null;
        }).filter((item): item is { url: string; caption: string | null } => item !== null)
      : [],
    profile_banner_url: typeof user.profile_banner_url === "string" ? user.profile_banner_url : null,
    profile_background_url: typeof user.profile_background_url === "string" ? user.profile_background_url : null,
    avatar_ring_style: typeof user.avatar_ring_style === "string" ? user.avatar_ring_style : null,
    is_email_confirmed: Boolean(user.is_email_confirmed),
    avatar_url: typeof user.avatar_url === "string" ? user.avatar_url : null,
    status: typeof user.status === "string" ? user.status : "offline",
    current_game: typeof user.current_game === "string" ? user.current_game : null,
    notification_sound_url: typeof user.notification_sound_url === "string" ? user.notification_sound_url : null,
    notification_volume: typeof user.notification_volume === "number" ? user.notification_volume : 0.7,
    created_at: typeof user.created_at === "string" ? user.created_at : "",
    updated_at: typeof user.updated_at === "string" ? user.updated_at : "",
  };
}

function tryStoreUser(value: string): boolean {
  try {
    localStorage.setItem(USER_KEY, value);
    return true;
  } catch {
    return false;
  }
}

function serializeStoredUser(user: CurrentUser, mode: "full" | "compact"): string {
  const isCompact = mode === "compact";
  return JSON.stringify({
    id: user.id,
    email: user.email,
    username: user.username,
    display_name: user.display_name,
    nickname: user.nickname,
    profile_status: trimText(user.profile_status, isCompact ? 160 : 400),
    profile_photos: isCompact ? [] : sanitizeProfilePhotos(user.profile_photos, 4),
    profile_banner_url: sanitizeStoredUrl(user.profile_banner_url, isCompact),
    profile_background_url: sanitizeStoredUrl(user.profile_background_url, isCompact),
    avatar_ring_style: user.avatar_ring_style,
    is_email_confirmed: user.is_email_confirmed,
    avatar_url: sanitizeStoredUrl(user.avatar_url, isCompact),
    status: user.status,
    current_game: trimText(user.current_game, 120),
    notification_sound_url: sanitizeStoredUrl(user.notification_sound_url, true),
    notification_volume: user.notification_volume,
    created_at: user.created_at,
    updated_at: user.updated_at,
  });
}

function sanitizeProfilePhotos(photos: CurrentUser["profile_photos"], limit: number): CurrentUser["profile_photos"] {
  return photos
    .slice(0, limit)
    .map((photo) => {
      const nextUrl = sanitizeStoredUrl(photo.url, false);
      if (!nextUrl) {
        return null;
      }
      return {
        url: nextUrl,
        caption: trimText(photo.caption, 160),
      };
    })
    .filter((photo): photo is { url: string; caption: string | null } => photo !== null);
}

function sanitizeStoredUrl(value: string | null | undefined, compact: boolean): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("data:")) {
    return null;
  }
  const maxLength = compact ? 512 : 2048;
  return trimmed.length <= maxLength ? trimmed : null;
}

function trimText(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, maxLength);
}
