from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import UserPublicResponse


class DirectChatCreate(BaseModel):
    username: str = Field(min_length=3, max_length=32)


class GroupChatCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    usernames: list[str] = Field(min_length=1, max_length=100)
    encrypted_group_key: str | None = None
    avatar_url: str | None = None
    background_url: str | None = None


class GroupChatUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    avatar_url: str | None = None
    background_url: str | None = None


class ChatMemberAddRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    encrypted_group_key: str | None = None


class ChatMemberRoleUpdateRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=36)
    role: str = Field(pattern=r"^(admin|member)$")


class ChatMemberRemoveRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=36)
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
    background_url: str | None
    created_by: str
    created_at: datetime
    updated_at: datetime
    members: list[ChatMemberResponse]


class MessageSendRequest(BaseModel):
    ciphertext: str = Field(min_length=1)
    nonce: str = Field(min_length=1, max_length=128)
    message_type: str = Field(default="text", min_length=1, max_length=16)
    encrypted_message_keys: dict[str, str] = Field(default_factory=dict)


class MessageUpdateRequest(BaseModel):
    ciphertext: str = Field(min_length=1)
    nonce: str = Field(min_length=1, max_length=128)
    message_type: str = Field(default="text", min_length=1, max_length=16)


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
