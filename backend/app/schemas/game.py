from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SteamRecentGameResponse(BaseModel):
    app_id: int
    name: str
    playtime_hours: float


class SteamStatsResponse(BaseModel):
    persona_name: str | None = None
    profile_url: str | None = None
    avatar_url: str | None = None
    current_game: str | None = None
    recent_games: list[SteamRecentGameResponse] = []


class ValorantStatsResponse(BaseModel):
    game_name: str | None = None
    tag_line: str | None = None
    puuid: str | None = None
    recent_match_ids: list[str] = []


class GameAccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    platform: str
    external_user_id: str
    display_name: str | None
    created_at: datetime
    updated_at: datetime


class GameProviderOverviewResponse(BaseModel):
    enabled: bool
    connected: bool
    connect_url: str | None = None
    account: GameAccountResponse | None = None
    steam_stats: SteamStatsResponse | None = None
    valorant_stats: ValorantStatsResponse | None = None
    game: str | None = None
    status_hint: str | None = None


class GamesOverviewResponse(BaseModel):
    steam: GameProviderOverviewResponse
    riot: GameProviderOverviewResponse
