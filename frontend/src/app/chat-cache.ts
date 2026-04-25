import Dexie, { type Table } from "dexie";

export type CachedDecodedMessage = {
  id?: number;
  chatId: string;
  messageId: string;
  ciphertext: string;
  iv: string;
  updatedAt: string;
};

class ChatCacheDatabase extends Dexie {
  decodedMessages!: Table<CachedDecodedMessage, number>;

  constructor() {
    super("frcenter-chat-cache");
    this.version(1).stores({
      decodedMessages: "++id, [chatId+messageId], chatId, messageId, updatedAt",
    });
  }
}

const db = new ChatCacheDatabase();
const MAX_CACHE_MESSAGES_PER_CHAT = 400;
const DEFAULT_CACHE_TTL_DAYS = 14;

export async function getCachedDecodedMessages(
  chatId: string,
  messageIds: string[],
): Promise<CachedDecodedMessage[]> {
  if (messageIds.length === 0) {
    return [];
  }
  const keys = messageIds.map((messageId) => [chatId, messageId] as [string, string]);
  return db.decodedMessages.where("[chatId+messageId]").anyOf(keys).toArray();
}

export async function upsertCachedDecodedMessages(items: CachedDecodedMessage[]): Promise<void> {
  if (items.length === 0) {
    return;
  }
  await db.decodedMessages.bulkPut(items);
}

export async function pruneDecodedMessages(options?: {
  maxAgeDays?: number;
  maxMessagesPerChat?: number;
}): Promise<void> {
  const maxAgeDays = options?.maxAgeDays ?? DEFAULT_CACHE_TTL_DAYS;
  const maxMessagesPerChat = options?.maxMessagesPerChat ?? MAX_CACHE_MESSAGES_PER_CHAT;
  const cutoffIso = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

  await db.transaction("rw", db.decodedMessages, async () => {
    await db.decodedMessages.where("updatedAt").below(cutoffIso).delete();

    const allItems = await db.decodedMessages.toArray();
    const itemsByChat = new Map<string, CachedDecodedMessage[]>();
    for (const item of allItems) {
      const bucket = itemsByChat.get(item.chatId);
      if (bucket) {
        bucket.push(item);
      } else {
        itemsByChat.set(item.chatId, [item]);
      }
    }

    const idsToDelete: number[] = [];
    for (const bucket of itemsByChat.values()) {
      if (bucket.length <= maxMessagesPerChat) {
        continue;
      }
      bucket.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      for (const item of bucket.slice(maxMessagesPerChat)) {
        if (typeof item.id === "number") {
          idsToDelete.push(item.id);
        }
      }
    }

    if (idsToDelete.length > 0) {
      await db.decodedMessages.bulkDelete(idsToDelete);
    }
  });
}

export async function clearDecodedMessagesCache(): Promise<void> {
  await db.decodedMessages.clear();
}
