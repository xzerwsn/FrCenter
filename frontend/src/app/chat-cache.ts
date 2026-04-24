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
