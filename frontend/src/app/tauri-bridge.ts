type TauriPayload = Record<string, unknown> | undefined;

type TauriInternals = {
  invoke?: <Result = unknown>(command: string, payload?: TauriPayload, options?: Record<string, unknown>) => Promise<Result>;
  transformCallback?: (callback: (payload: unknown) => void, once?: boolean) => number;
};

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: TauriInternals;
};

const CHANNEL_PREFIX = "__CHANNEL__:";
const RECENT_MESSAGES_LIMIT = 50;

function getTauriInternals(): TauriInternals | null {
  if (typeof window === "undefined") {
    return null;
  }
  return (window as TauriWindow).__TAURI_INTERNALS__ ?? null;
}

export function hasTauriIpc(): boolean {
  return typeof getTauriInternals()?.invoke === "function";
}

export async function invokeTauriCommand<Result = unknown>(
  command: string,
  payload?: TauriPayload,
): Promise<Result | undefined> {
  const internals = getTauriInternals();
  if (typeof internals?.invoke !== "function") {
    return undefined;
  }
  return internals.invoke<Result>(command, payload);
}

export async function cacheRecentMessagesInTauri(chatId: string, messages: unknown[]): Promise<void> {
  if (!hasTauriIpc()) {
    return;
  }
  const trimmed = messages.slice(-RECENT_MESSAGES_LIMIT);
  await invokeTauriCommand("cache_recent_messages", {
    chat_id: chatId,
    messages_json: JSON.stringify(trimmed),
  });
}

export async function clearRecentMessagesInTauri(): Promise<void> {
  if (!hasTauriIpc()) {
    return;
  }
  await invokeTauriCommand("clear_recent_messages");
}

export async function loadRecentMessagesFromTauri(chatId: string): Promise<string | null> {
  const internals = getTauriInternals();
  if (typeof internals?.invoke !== "function") {
    return null;
  }

  if (typeof internals.transformCallback === "function") {
    const streamed = await streamRecentMessagesFromTauri(chatId, internals);
    if (streamed !== null) {
      return streamed;
    }
  }

  const cached = await internals.invoke<string | null | undefined>("get_cached_messages", { chat_id: chatId });
  return typeof cached === "string" ? cached : null;
}

async function streamRecentMessagesFromTauri(chatId: string, internals: TauriInternals): Promise<string | null> {
  if (typeof internals.invoke !== "function") {
    return null;
  }
  const invoke = internals.invoke;
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  const completed = new Promise<string | null>((resolve, reject) => {
    const callbackId = internals.transformCallback?.((payload) => {
      const next = payload as { message?: unknown; end?: boolean };
      if (next?.end) {
        const merged = new Uint8Array(totalLength);
        let cursor = 0;
        for (const chunk of chunks) {
          merged.set(chunk, cursor);
          cursor += chunk.byteLength;
        }
        resolve(new TextDecoder().decode(merged));
        return;
      }

      const message = next?.message;
      if (message instanceof ArrayBuffer) {
        const chunk = new Uint8Array(message);
        chunks.push(chunk);
        totalLength += chunk.byteLength;
        return;
      }
      if (ArrayBuffer.isView(message)) {
        const view = new Uint8Array(message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength));
        chunks.push(view);
        totalLength += view.byteLength;
        return;
      }
      if (typeof message === "string") {
        const chunk = new TextEncoder().encode(message);
        chunks.push(chunk);
        totalLength += chunk.byteLength;
        return;
      }
      reject(new Error("Unsupported Tauri channel payload"));
    }, false);

    if (typeof callbackId !== "number") {
      resolve(null);
      return;
    }

    void invoke<boolean>("stream_cached_messages", {
        chat_id: chatId,
        channel: `${CHANNEL_PREFIX}${callbackId}`,
      })
      .then((hasPayload) => {
        if (!hasPayload) {
          resolve(null);
        }
      })
      .catch(reject);
  });

  return completed;
}
