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

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as RealtimeEvent;
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
