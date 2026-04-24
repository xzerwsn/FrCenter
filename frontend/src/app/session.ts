import type { CurrentUser } from "../api/users";

const TOKEN_KEY = "frcenter.accessToken";
const USER_KEY = "frcenter.currentUser";

export type Session = {
  token: string;
  user: CurrentUser;
};

export function saveSession(session: Session): void {
  localStorage.setItem(TOKEN_KEY, session.token);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
}

export function loadSession(): Session | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const userJson = localStorage.getItem(USER_KEY);
  if (!token || !userJson) {
    return null;
  }

  try {
    return { token, user: normalizeStoredUser(JSON.parse(userJson)) };
  } catch {
    clearSession();
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
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
