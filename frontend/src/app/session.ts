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
    return { token, user: JSON.parse(userJson) as CurrentUser };
  } catch {
    clearSession();
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
