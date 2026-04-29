import { apiDelete, apiGet, apiPost } from "./client";

export type GamePlatform = "steam" | "riot";

export type GameAccount = {
  id: string;
  platform: GamePlatform;
  external_user_id: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
};

export type GameActivity = {
  id: string;
  platform: GamePlatform;
  game_name: string;
  activity_type: "playing" | "queue" | "match" | "online";
  created_at: string;
};

export type GamesOverviewResponse = {
  accounts: GameAccount[];
  active_activities: GameActivity[];
};

export async function getGamesOverview(token: string): Promise<GamesOverviewResponse> {
  return apiGet<GamesOverviewResponse>("/api/games/overview", { token });
}

export async function connectGameAccount(
  token: string,
  payload: { platform: GamePlatform; external_user_id: string; display_name?: string | null },
): Promise<GameAccount> {
  return apiPost<GameAccount>("/api/games/accounts", payload, { token });
}

export async function disconnectGameAccount(token: string, platform: GamePlatform): Promise<void> {
  await apiDelete<void>(`/api/games/accounts/${platform}`, {}, { token });
}

export async function setGameActivity(
  token: string,
  payload: { platform: GamePlatform; game_name: string; activity_type?: "playing" | "queue" | "match" | "online" },
): Promise<GameActivity> {
  return apiPost<GameActivity>("/api/games/activity", payload, { token });
}

export async function clearGameActivity(token: string, platform: GamePlatform): Promise<void> {
  await apiDelete<void>(`/api/games/activity/${platform}`, {}, { token });
}
