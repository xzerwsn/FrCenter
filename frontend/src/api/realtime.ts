import { getBackendWebSocketBaseUrl } from "../config/backend-url";
import { parseRealtimePayloadInWorker } from "../app/transport-worker-client";

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

type RealtimeSubscriber = (event: RealtimeEvent) => void;

type SharedRealtimeState = {
  socket: WebSocket | null;
  token: string | undefined;
  subscribers: Map<number, RealtimeSubscriber>;
  reconnectTimer: number | undefined;
  heartbeatTimer: number | undefined;
  reconnectAttempt: number;
  nextSubscriberId: number;
  closeRequested: boolean;
};

const sharedState: SharedRealtimeState = {
  socket: null,
  token: undefined,
  subscribers: new Map(),
  reconnectTimer: undefined,
  heartbeatTimer: undefined,
  reconnectAttempt: 0,
  nextSubscriberId: 0,
  closeRequested: false,
};

export function connectRealtime(token: string | undefined, onEvent: RealtimeSubscriber): { close: () => void } {
  const subscriberId = ++sharedState.nextSubscriberId;
  sharedState.subscribers.set(subscriberId, onEvent);

  if (sharedState.token !== token) {
    sharedState.token = token;
    hardResetSocket();
  }
  sharedState.closeRequested = false;
  ensureConnected();

  return {
    close: () => {
      sharedState.subscribers.delete(subscriberId);
      if (sharedState.subscribers.size === 0) {
        sharedState.closeRequested = true;
        clearReconnectTimer();
        clearHeartbeat();
        sharedState.reconnectAttempt = 0;
        sharedState.socket?.close();
        sharedState.socket = null;
      }
    },
  };
}

function ensureConnected(): void {
  if (sharedState.socket || sharedState.subscribers.size === 0) {
    return;
  }

  const wsUrl = getBackendWebSocketBaseUrl();
  const wsEndpoint = sharedState.token ? `${wsUrl}/ws?token=${encodeURIComponent(sharedState.token)}` : `${wsUrl}/ws`;
  const socket = new WebSocket(wsEndpoint);
  sharedState.socket = socket;

  socket.onopen = () => {
    sharedState.reconnectAttempt = 0;
    clearHeartbeat();
    sharedState.heartbeatTimer = window.setInterval(() => {
      if (sharedState.socket?.readyState === WebSocket.OPEN) {
        sharedState.socket.send(JSON.stringify({ type: "ping" }));
      }
    }, 15000);
  };

  socket.onmessage = async (event) => {
    try {
      const events = await parseRealtimePayloadInWorker<RealtimeEvent>(event.data as string);
      publishEvents(events);
    } catch {
      // Ignore malformed payloads in this prototype stage.
    }
  };

  socket.onclose = () => {
    clearHeartbeat();
    sharedState.socket = null;
    if (sharedState.closeRequested || sharedState.subscribers.size === 0) {
      return;
    }
    scheduleReconnect();
  };

  socket.onerror = () => {
    socket.close();
  };
}

function publishEvents(events: RealtimeEvent[]): void {
  for (const nextEvent of events) {
    if (nextEvent.type === "pong") {
      continue;
    }
    for (const subscriber of sharedState.subscribers.values()) {
      subscriber(nextEvent);
    }
  }
}

function scheduleReconnect(): void {
  clearReconnectTimer();
  const attempt = sharedState.reconnectAttempt + 1;
  sharedState.reconnectAttempt = attempt;
  const baseDelay = Math.min(1000 * 2 ** Math.min(attempt - 1, 5), 15000);
  const jitter = Math.floor(Math.random() * 350);
  sharedState.reconnectTimer = window.setTimeout(() => {
    sharedState.reconnectTimer = undefined;
    ensureConnected();
  }, baseDelay + jitter);
}

function hardResetSocket(): void {
  clearReconnectTimer();
  clearHeartbeat();
  sharedState.reconnectAttempt = 0;
  if (sharedState.socket) {
    const socket = sharedState.socket;
    sharedState.socket = null;
    socket.close();
  }
}

function clearReconnectTimer(): void {
  if (sharedState.reconnectTimer !== undefined) {
    window.clearTimeout(sharedState.reconnectTimer);
    sharedState.reconnectTimer = undefined;
  }
}

function clearHeartbeat(): void {
  if (sharedState.heartbeatTimer !== undefined) {
    window.clearInterval(sharedState.heartbeatTimer);
    sharedState.heartbeatTimer = undefined;
  }
}
