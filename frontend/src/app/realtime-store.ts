import React from "react";

import { connectRealtime, type RealtimeEvent } from "../api/realtime";

export function useRealtimeSubscription(
  connectionKey: number,
  token: string | undefined,
  onEvent: (event: RealtimeEvent) => void,
  enabled = true,
): void {
  const eventRef = React.useRef(onEvent);

  React.useEffect(() => {
    eventRef.current = onEvent;
  }, [onEvent]);

  React.useEffect(() => {
    if (!enabled) {
      return;
    }
    const socket = connectRealtime(token, (event) => {
      eventRef.current(event);
    });
    return () => socket.close();
  }, [connectionKey, enabled, token]);
}
