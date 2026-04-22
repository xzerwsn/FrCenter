from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr


class UserMeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    username: str
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
    avatar_url: str | None
    status: str
    current_game: str | None
