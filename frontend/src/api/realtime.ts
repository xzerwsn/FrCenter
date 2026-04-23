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
      type: string;
      [key: string]: unknown;
    };

export function connectRealtime(token: string, onEvent: (event: RealtimeEvent) => void): WebSocket {
  const wsUrl = buildWebSocketUrl();
  const socket = new WebSocket(`${wsUrl}/ws?token=${encodeURIComponent(token)}`);

  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as RealtimeEvent;
      onEvent(payload);
    } catch {
      // Ignore malformed payloads in this prototype stage.
    }
  };

  return socket;
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
