import { apiGet, apiPatch } from "./client";

export type ProfilePhoto = {
  url: string;
  caption: string | null;
};

export type CurrentUser = {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  nickname: string | null;
  profile_status: string | null;
  profile_photos: ProfilePhoto[];
  profile_banner_url: string | null;
  profile_background_url: string | null;
  avatar_ring_style: string | null;
  is_email_confirmed: boolean;
  avatar_url: string | null;
  status: string;
  current_game: string | null;
  notification_sound_url: string | null;
  notification_volume: number;
  created_at: string;
  updated_at: string;
};

export type UserPublic = {
  id: string;
  username: string;
  display_name: string | null;
  nickname: string | null;
  profile_status: string | null;
  profile_banner_url: string | null;
  profile_background_url: string | null;
  profile_photos: string | null;
  avatar_ring_style: string | null;
  avatar_url: string | null;
  status: string;
  current_game: string | null;
};

export type CurrentUserUpdatePayload = {
  username?: string | null;
  display_name?: string | null;
  nickname?: string | null;
  profile_status?: string | null;
  status?: string | null;
  notification_sound_url?: string | null;
  notification_volume?: number | null;
  avatar_url?: string | null;
  profile_banner_url?: string | null;
  profile_background_url?: string | null;
  avatar_ring_style?: string | null;
  profile_photos?: ProfilePhoto[] | null;
};

export async function getMe(token?: string): Promise<CurrentUser> {
  return apiGet<CurrentUser>("/api/users/me", { token });
}

export async function updateMe(token: string, payload: CurrentUserUpdatePayload): Promise<CurrentUser> {
  return apiPatch<CurrentUser>("/api/users/me", payload, { token });
}
