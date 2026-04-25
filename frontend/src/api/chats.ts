import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import type { UserPublic } from "./users";

export type ChatMember = {
  user: UserPublic;
  role: string;
  joined_at: string;
};

export type Chat = {
  id: string;
  type: string;
  title: string | null;
  avatar_url: string | null;
  background_url: string | null;
  created_by: string;
  created_at: string;
  last_message_id?: string | null;
  last_message_at?: string | null;
  member_count: number;
  updated_at: string;
  unread_count: number;
  peer?: UserPublic | null;
  members?: ChatMember[];
};

export type Message = {
  id: string;
  chat_id: string;
  sender: UserPublic;
  ciphertext: string;
  nonce: string;
  message_type: string;
  expires_at: string;
  created_at: string;
};

export type ChatListResponse = {
  chats: Chat[];
};

export type MessageListResponse = {
  messages: Message[];
  next_cursor_id: string | null;
  next_cursor_created_at: string | null;
  has_more: boolean;
};

export type SendMessagePayload = {
  ciphertext: string;
  nonce: string;
  message_type: string;
  encrypted_message_keys?: Record<string, string>;
};

export type CreateGroupChatPayload = {
  title: string;
  usernames: string[];
  encrypted_group_key?: string;
  avatar_url?: string;
  background_url?: string;
};

export type UpdateGroupMemberRolePayload = {
  user_id: string;
  role: "admin" | "member";
};

export type UpdateGroupChatPayload = {
  title?: string | null;
  avatar_url?: string | null;
  background_url?: string | null;
};

export async function listChats(token: string): Promise<ChatListResponse> {
  return apiGet<ChatListResponse>("/api/chats", { token });
}

export async function createDirectChat(token: string, username: string): Promise<Chat> {
  return apiPost<Chat>("/api/chats/direct", { username }, { token });
}

export async function readChat(token: string, chatId: string): Promise<Chat> {
  return apiGet<Chat>(`/api/chats/${chatId}`, { token });
}

export async function createGroupChat(token: string, payload: CreateGroupChatPayload): Promise<Chat> {
  return apiPost<Chat>(
    "/api/chats/group",
    {
      title: payload.title,
      usernames: payload.usernames,
      encrypted_group_key: payload.encrypted_group_key ?? null,
      avatar_url: payload.avatar_url ?? null,
      background_url: payload.background_url ?? null,
    },
    { token },
  );
}

export async function addGroupMember(
  token: string,
  chatId: string,
  username: string,
  encryptedGroupKey?: string,
): Promise<Chat> {
  return apiPost<Chat>(
    `/api/chats/${chatId}/members`,
    { username, encrypted_group_key: encryptedGroupKey ?? null },
    { token },
  );
}

export async function updateGroupChat(
  token: string,
  chatId: string,
  payload: UpdateGroupChatPayload,
): Promise<Chat> {
  return apiPatch<Chat>(
    `/api/chats/${chatId}`,
    {
      title: payload.title,
      avatar_url: payload.avatar_url,
      background_url: payload.background_url,
    },
    { token },
  );
}

export async function updateGroupMemberRole(
  token: string,
  chatId: string,
  payload: UpdateGroupMemberRolePayload,
): Promise<Chat> {
  return apiPatch<Chat>(
    `/api/chats/${chatId}/members/role`,
    {
      user_id: payload.user_id,
      role: payload.role,
    },
    { token },
  );
}

export async function removeGroupMember(
  token: string,
  chatId: string,
  userId: string,
  encryptedGroupKey?: string,
): Promise<Chat> {
  return apiDelete<Chat>(
    `/api/chats/${chatId}/members`,
    { user_id: userId, encrypted_group_key: encryptedGroupKey ?? null },
    { token },
  );
}

export async function listChatMessages(
  token: string,
  chatId: string,
  options: {
    cursorId?: string | null;
    cursorCreatedAt?: string | null;
    limit?: number;
  } = {},
): Promise<MessageListResponse> {
  const params = new URLSearchParams();
  if (options.cursorId) {
    params.set("cursor_id", options.cursorId);
  }
  if (options.cursorCreatedAt) {
    params.set("cursor_created_at", options.cursorCreatedAt);
  }
  if (typeof options.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return apiGet<MessageListResponse>(`/api/chats/${chatId}/messages${suffix}`, { token });
}

export async function markChatRead(token: string, chatId: string): Promise<void> {
  await apiPost<void>(`/api/chats/${chatId}/read`, {}, { token });
}

export async function sendChatMessage(
  token: string,
  chatId: string,
  payload: SendMessagePayload,
): Promise<Message> {
  return apiPost<Message>(
    `/api/chats/${chatId}/messages`,
    {
      ciphertext: payload.ciphertext,
      nonce: payload.nonce,
      message_type: payload.message_type,
      encrypted_message_keys: payload.encrypted_message_keys ?? {},
    },
    { token },
  );
}

export async function updateChatMessage(
  token: string,
  chatId: string,
  messageId: string,
  payload: SendMessagePayload,
): Promise<Message> {
  return apiPatch<Message>(
    `/api/chats/${chatId}/messages/${messageId}`,
    {
      ciphertext: payload.ciphertext,
      nonce: payload.nonce,
      message_type: payload.message_type,
    },
    { token },
  );
}

export async function deleteChatMessage(token: string, chatId: string, messageId: string): Promise<void> {
  await apiDelete<void>(`/api/chats/${chatId}/messages/${messageId}`, {}, { token });
}
