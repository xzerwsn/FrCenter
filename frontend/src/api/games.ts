import { apiDelete, apiGet } from "./client";

export type GamePlatform = "steam" | "riot";

export type GameAccount = {
  id: string;
  platform: GamePlatform;
  external_user_id: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
};

export type SteamRecentGame = {
  app_id: number;
  name: string;
  playtime_hours: number;
};

export type SteamStats = {
  persona_name: string | null;
  profile_url: string | null;
  avatar_url: string | null;
  current_game: string | null;
  recent_games: SteamRecentGame[];
};

export type ValorantStats = {
  game_name: string | null;
  tag_line: string | null;
  puuid: string | null;
  recent_match_ids: string[];
};

export type GameProviderOverview = {
  enabled: boolean;
  connected: boolean;
  connect_url: string | null;
  account: GameAccount | null;
  steam_stats?: SteamStats | null;
  valorant_stats?: ValorantStats | null;
  game: string | null;
  status_hint: string | null;
};

export type GamesOverviewResponse = {
  steam: GameProviderOverview;
  riot: GameProviderOverview;
};

export async function getGamesOverview(token: string): Promise<GamesOverviewResponse> {
  return apiGet<GamesOverviewResponse>("/api/games/overview", { token });
}

export async function disconnectGameAccount(token: string, platform: GamePlatform): Promise<void> {
  await apiDelete<void>(`/api/games/accounts/${platform}`, {}, { token });
}
