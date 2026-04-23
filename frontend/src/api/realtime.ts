export type RealtimeEvent =
  | {
      type: "message.new";
      chat_id: string;
      message: unknown;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

export function connectRealtime(token: string, onEvent: (event: RealtimeEvent) => void): WebSocket {
  const socket = new WebSocket(`ws://127.0.0.1:8000/ws?token=${encodeURIComponent(token)}`);

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
