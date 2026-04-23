from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserMeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    username: str
    display_name: str | None
    nickname: str | None
    profile_status: str | None
    profile_photos: list[str]
    profile_banner_url: str | None
    profile_background_url: str | None
    avatar_ring_style: str | None
    is_email_confirmed: bool
    avatar_url: str | None
    status: str
    current_game: str | None
    created_at: datetime
    updated_at: datetime


class UserPublicResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    username: str
    display_name: str | None
    nickname: str | None
    profile_status: str | None
    profile_banner_url: str | None
    avatar_ring_style: str | None
    avatar_url: str | None
    status: str
    current_game: str | None


class UserMeUpdateRequest(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=32)
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    nickname: str | None = Field(default=None, min_length=1, max_length=32)
    profile_status: str | None = Field(default=None, min_length=1, max_length=160)
    avatar_url: str | None = None
    profile_banner_url: str | None = None
    profile_background_url: str | None = None
    avatar_ring_style: str | None = Field(default=None, max_length=32)
    profile_photos: list[str] | None = Field(default=None, max_length=30)
