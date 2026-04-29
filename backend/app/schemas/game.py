from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class GameAccountUpsertRequest(BaseModel):
    platform: str = Field(pattern=r"^(steam|riot)$")
    external_user_id: str = Field(min_length=2, max_length=120)
    display_name: str | None = Field(default=None, min_length=1, max_length=120)


class GameActivityUpsertRequest(BaseModel):
    platform: str = Field(pattern=r"^(steam|riot)$")
    game_name: str = Field(min_length=1, max_length=120)
    activity_type: str = Field(default="playing", pattern=r"^(playing|queue|match|online)$")


class GameAccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    platform: str
    external_user_id: str
    display_name: str | None
    created_at: datetime
    updated_at: datetime


class GameActivityResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    platform: str
    game_name: str
    activity_type: str
    created_at: datetime


class GamesOverviewResponse(BaseModel):
    accounts: list[GameAccountResponse]
    active_activities: list[GameActivityResponse]
