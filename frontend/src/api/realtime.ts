const backendHttpUrl = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000";

export type RealtimeEvent =
  | {
      type: "message.new";
      chat_id: string;
      message: unknown;
    }
  | {
      type: "message.updated";
      chat_id: string;
      message: unknown;
    }
  | {
      type: "message.deleted";
      chat_id: string;
      message_id: string;
    }
  | {
      type: "notification.new";
      notification: unknown;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

type RealtimeEnvelope =
  | RealtimeEvent
  | {
      type: "batch";
      events: RealtimeEvent[];
    }
  | {
      type: "batch.compressed";
      encoding: "gzip+base64";
      payload: string;
    };

export function connectRealtime(token: string | undefined, onEvent: (event: RealtimeEvent) => void): { close: () => void } {
  const wsUrl = buildWebSocketUrl();
  let closedByClient = false;
  let reconnectTimer: number | undefined;
  let heartbeatTimer: number | undefined;
  let socket: WebSocket | null = null;

  const clearHeartbeat = () => {
    if (heartbeatTimer !== undefined) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };

  const connect = () => {
    const wsEndpoint = token ? `${wsUrl}/ws?token=${encodeURIComponent(token)}` : `${wsUrl}/ws`;
    socket = new WebSocket(wsEndpoint);

    socket.onopen = () => {
      clearHeartbeat();
      heartbeatTimer = window.setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }));
        }
      }, 15000);
    };

    socket.onmessage = async (event) => {
      try {
        const payload = JSON.parse(event.data) as RealtimeEnvelope;
        if (payload.type === "batch" && Array.isArray(payload.events)) {
          for (const nextEvent of payload.events as RealtimeEvent[]) {
            if (nextEvent.type !== "pong") {
              onEvent(nextEvent);
            }
          }
          return;
        }
        if (payload.type === "batch.compressed" && payload.encoding === "gzip+base64" && typeof payload.payload === "string") {
          const events = await decompressEvents(payload.payload);
          for (const nextEvent of events) {
            if (nextEvent.type !== "pong") {
              onEvent(nextEvent);
            }
          }
          return;
        }
        if (payload.type !== "pong") {
          onEvent(payload);
        }
      } catch {
        // Ignore malformed payloads in this prototype stage.
      }
    };

    socket.onclose = () => {
      clearHeartbeat();
      if (!closedByClient) {
        reconnectTimer = window.setTimeout(connect, 700);
      }
    };

    socket.onerror = () => {
      socket?.close();
    };
  };

  connect();

  return {
    close: () => {
      closedByClient = true;
      clearHeartbeat();
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    },
  };
}

function buildWebSocketUrl(): string {
  try {
    const parsed = new URL(backendHttpUrl);
    const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${parsed.host}`;
  } catch {
    return "ws://localhost:8000";
  }
}

async function decompressEvents(payload: string): Promise<RealtimeEvent[]> {
  const compressed = base64ToBytes(payload);
  const buffer = toArrayBuffer(compressed);
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  const decoded = JSON.parse(text) as { events?: RealtimeEvent[] };
  return Array.isArray(decoded.events) ? decoded.events : [];
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
