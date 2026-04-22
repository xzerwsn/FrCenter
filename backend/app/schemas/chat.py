from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import UserPublicResponse


class DirectChatCreate(BaseModel):
    username: str = Field(min_length=3, max_length=32)


class GroupChatCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    usernames: list[str] = Field(min_length=1, max_length=100)
    encrypted_group_key: str | None = None


class ChatMemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user: UserPublicResponse
    role: str
    joined_at: datetime


class ChatResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    type: str
    title: str | None
    avatar_url: str | None
    created_by: str
    created_at: datetime
    updated_at: datetime
    members: list[ChatMemberResponse]


class MessageSendRequest(BaseModel):
    ciphertext: str = Field(min_length=1)
    nonce: str = Field(min_length=1, max_length=128)
    message_type: str = Field(default="text", min_length=1, max_length=16)
    encrypted_message_keys: dict[str, str] = Field(default_factory=dict)


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    chat_id: str
    sender: UserPublicResponse
    ciphertext: str
    nonce: str
    message_type: str
    expires_at: datetime
    created_at: datetime


class ChatListResponse(BaseModel):
    chats: list[ChatResponse]
