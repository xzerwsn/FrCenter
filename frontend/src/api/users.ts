import { apiGet } from "./client";

export type CurrentUser = {
  id: string;
  email: string;
  username: string;
  is_email_confirmed: boolean;
  avatar_url: string | null;
  status: string;
  current_game: string | null;
  created_at: string;
  updated_at: string;
};

export type UserPublic = {
  id: string;
  username: string;
  avatar_url: string | null;
  status: string;
  current_game: string | null;
};

export async function getMe(token: string): Promise<CurrentUser> {
  return apiGet<CurrentUser>("/api/users/me", { token });
}
