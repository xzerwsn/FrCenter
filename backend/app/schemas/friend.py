from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import UserPublicResponse


class FriendRequestCreate(BaseModel):
    username: str = Field(min_length=3, max_length=32)


class FriendRequestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    from_user: UserPublicResponse
    to_user: UserPublicResponse
    status: str
    created_at: datetime
    updated_at: datetime


class FriendListResponse(BaseModel):
    friends: list[UserPublicResponse]


class InviteCodeCreate(BaseModel):
    max_uses: int = Field(default=1, ge=1, le=50)


class InviteCodeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    max_uses: int
    used_count: int
    created_at: datetime


class AddByInviteCodeRequest(BaseModel):
    code: str = Field(min_length=6, max_length=32)
