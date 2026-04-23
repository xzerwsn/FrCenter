import { apiGet, apiPost } from "./client";
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
  created_by: string;
  created_at: string;
  updated_at: string;
  members: ChatMember[];
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
};

export async function listChats(token: string): Promise<ChatListResponse> {
  return apiGet<ChatListResponse>("/api/chats", { token });
}

export async function createDirectChat(token: string, username: string): Promise<Chat> {
  return apiPost<Chat>("/api/chats/direct", { username }, { token });
}

export async function createGroupChat(token: string, payload: CreateGroupChatPayload): Promise<Chat> {
  return apiPost<Chat>(
    "/api/chats/group",
    {
      title: payload.title,
      usernames: payload.usernames,
      encrypted_group_key: payload.encrypted_group_key ?? null,
    },
    { token },
  );
}

export async function listChatMessages(token: string, chatId: string): Promise<Message[]> {
  return apiGet<Message[]>(`/api/chats/${chatId}/messages`, { token });
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
