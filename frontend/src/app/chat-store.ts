import Dexie, { type Table } from "dexie";

import type { Chat } from "../api/chats";
import type { CurrentUser } from "../api/users";

export const CHAT_KEY_PREFIX = "frcenter.chatKey.";
export const SELECTED_CHAT_STORAGE_KEY_PREFIX = "frcenter.selectedChat.";

type CachedChatSummary = {
  id?: number;
  userId: string;
  chatId: string;
  payload: Chat;
  updatedAt: string;
};

class ChatSummaryDatabase extends Dexie {
  chatSummaries!: Table<CachedChatSummary, number>;

  constructor() {
    super("frcenter-chat-summary-cache");
    this.version(1).stores({
      chatSummaries: "++id, [userId+chatId], userId, chatId, updatedAt",
    });
  }
}

const db = new ChatSummaryDatabase();

export async function readCachedChats(userId: string): Promise<Chat[]> {
  const rows = await db.chatSummaries.where("userId").equals(userId).toArray();
  return rows
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((row) => row.payload);
}

export async function writeCachedChats(userId: string, chats: Chat[]): Promise<void> {
  const updatedAt = new Date().toISOString();
  await db.transaction("rw", db.chatSummaries, async () => {
    const existing = await db.chatSummaries.where("userId").equals(userId).toArray();
    const incomingIds = new Set(chats.map((chat) => chat.id));
    const idsToDelete = existing
      .filter((item) => !incomingIds.has(item.chatId))
      .map((item) => item.id)
      .filter((item): item is number => typeof item === "number");
    if (idsToDelete.length > 0) {
      await db.chatSummaries.bulkDelete(idsToDelete);
    }
    await db.chatSummaries.bulkPut(
      chats.map((chat) => ({
        userId,
        chatId: chat.id,
        payload: toCachedChatSummary(chat),
        updatedAt,
      })),
    );
  });
}

export async function clearCachedChats(userId: string): Promise<void> {
  const existing = await db.chatSummaries.where("userId").equals(userId).toArray();
  const idsToDelete = existing
    .map((item) => item.id)
    .filter((item): item is number => typeof item === "number");
  if (idsToDelete.length > 0) {
    await db.chatSummaries.bulkDelete(idsToDelete);
  }
}

export function readStoredSelectedChatId(userId: string): string {
  try {
    return localStorage.getItem(`${SELECTED_CHAT_STORAGE_KEY_PREFIX}${userId}`) ?? "";
  } catch {
    return "";
  }
}

export function writeStoredSelectedChatId(userId: string, chatId: string): void {
  try {
    const storageKey = `${SELECTED_CHAT_STORAGE_KEY_PREFIX}${userId}`;
    if (!chatId) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, chatId);
  } catch {
    // ignore storage write errors
  }
}

export function getChatPresentation(chat: Chat, me: CurrentUser): {
  title: string;
  subtitle: string;
  avatarUrl: string | null;
  initials: string;
} {
  if (chat.type === "direct") {
    const peer = chat.peer ?? chat.members?.find((member) => member.user.id !== me.id)?.user ?? null;
    const title = peer?.username ?? "Личный чат";
    return {
      title,
      subtitle: "1 на 1",
      avatarUrl: peer?.avatar_url ?? null,
      initials: title.slice(0, 1).toUpperCase(),
    };
  }
  const title = chat.title?.trim() || "Группа";
  return {
    title,
    subtitle: `${getChatMemberCount(chat)} участника`,
    avatarUrl: chat.avatar_url,
    initials: title.slice(0, 1).toUpperCase(),
  };
}

export function getChatMemberCount(chat: Chat): number {
  if (typeof chat.member_count === "number" && chat.member_count > 0) {
    return chat.member_count;
  }
  return chat.members?.length ?? (chat.type === "direct" ? 2 : 0);
}

export function mergeChatSummaries(previous: Chat[], incoming: Chat[]): Chat[] {
  const previousById = new Map(previous.map((chat) => [chat.id, chat]));
  return incoming.map((chat) => {
    const existing = previousById.get(chat.id);
    if (!existing) {
      return chat;
    }
    return {
      ...chat,
      members: existing.members ?? chat.members,
      peer: chat.peer ?? existing.peer ?? null,
    };
  });
}

function toCachedChatSummary(chat: Chat): Chat {
  return {
    ...chat,
    members: undefined,
  };
}
