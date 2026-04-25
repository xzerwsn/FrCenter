import React from "react";

import { type Message } from "../api/chats";
import {
  acceptFriendRequest,
  declineFriendRequest,
  listFriendRequests,
  listFriends,
  type FriendRequestResponse,
} from "../api/friends";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "../api/notifications";
import type { RealtimeEvent } from "../api/realtime";
import type { CurrentUser, UserPublic } from "../api/users";
import { useRealtimeSubscription } from "./realtime-store";

export const DEFAULT_NOTIFICATION_SOUND_URL = "https://www.myinstants.com/media/sounds/hell_AJWSn3e.mp3";

export function useNotificationsStore({
  token,
  currentUser,
  onFriendsChanged,
}: {
  token: string;
  currentUser: CurrentUser;
  onFriendsChanged: (friends: UserPublic[]) => void;
}) {
  const [notificationsOpen, setNotificationsOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<AppNotification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = React.useState(0);
  const [friendRequests, setFriendRequests] = React.useState<FriendRequestResponse[]>([]);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  const visibleNotifications = React.useMemo(
    () => notifications.filter((item) => item.kind !== "friend_request"),
    [notifications],
  );

  const playNotificationSound = React.useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // Ignore autoplay restrictions until the user interacts with the page.
    });
  }, []);

  const refreshNotifications = React.useCallback(async () => {
    try {
      const response = await listNotifications(token);
      setNotifications(response.notifications);
      setUnreadNotifications(response.unread_count);
    } catch {
      // keep the dashboard usable even if notifications fail
    }
  }, [token]);

  const refreshFriendRequests = React.useCallback(async () => {
    try {
      const response = await listFriendRequests(token);
      setFriendRequests(response.incoming);
    } catch {
      // keep the dashboard usable even if friend requests fail
    }
  }, [token]);

  React.useEffect(() => {
    void refreshNotifications();
    void refreshFriendRequests();
  }, [refreshFriendRequests, refreshNotifications]);

  React.useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(currentUser.notification_sound_url || DEFAULT_NOTIFICATION_SOUND_URL);
    }
    audioRef.current.src = currentUser.notification_sound_url || DEFAULT_NOTIFICATION_SOUND_URL;
    audioRef.current.preload = "auto";
    audioRef.current.volume = Math.max(0, Math.min(1, currentUser.notification_volume ?? 0.7));
  }, [currentUser.notification_sound_url, currentUser.notification_volume]);

  const handleRealtimeEvent = React.useCallback(
    (event: RealtimeEvent) => {
      if (event.type === "message.new" && event.message && typeof event.message === "object") {
        const incomingMessage = event.message as Message;
        if (incomingMessage.sender.id !== currentUser.id) {
          playNotificationSound();
        }
        return;
      }
      if (event.type !== "notification.new" || !event.notification || typeof event.notification !== "object") {
        return;
      }
      const incoming = event.notification as AppNotification;
      setNotifications((current) => [incoming, ...current.filter((item) => item.id !== incoming.id)].slice(0, 50));
      setUnreadNotifications((current) => current + (incoming.is_read ? 0 : 1));
      playNotificationSound();
      if (incoming.kind === "friend_request") {
        void refreshFriendRequests();
      }
    },
    [currentUser.id, playNotificationSound, refreshFriendRequests],
  );

  useRealtimeSubscription(token, handleRealtimeEvent);

  const openNotifications = React.useCallback(async () => {
    setNotificationsOpen(true);
    if (unreadNotifications > 0) {
      try {
        await markAllNotificationsRead(token);
        setUnreadNotifications(0);
        setNotifications((current) =>
          current.map((item) => ({ ...item, is_read: true, read_at: item.read_at ?? new Date().toISOString() })),
        );
      } catch {
        // keep modal open even if read-all fails
      }
    }
  }, [token, unreadNotifications]);

  const acceptIncomingFriendRequest = React.useCallback(
    async (requestId: string) => {
      try {
        await acceptFriendRequest(token, requestId);
        await Promise.all([refreshFriendRequests(), refreshNotifications()]);
        const response = await listFriends(token);
        onFriendsChanged(response.friends);
      } catch {
        // leave the request visible if the action failed
      }
    },
    [onFriendsChanged, refreshFriendRequests, refreshNotifications, token],
  );

  const declineIncomingFriendRequest = React.useCallback(
    async (requestId: string) => {
      try {
        await declineFriendRequest(token, requestId);
        await Promise.all([refreshFriendRequests(), refreshNotifications()]);
      } catch {
        // leave the request visible if the action failed
      }
    },
    [refreshFriendRequests, refreshNotifications, token],
  );

  const readNotification = React.useCallback(async (notificationId: string) => {
    try {
      const updated = await markNotificationRead(token, notificationId);
      setNotifications((current) => current.map((item) => (item.id === notificationId ? updated : item)));
      if (updated.is_read) {
        setUnreadNotifications((current) => Math.max(0, current - 1));
      }
    } catch {
      // keep notification list usable
    }
  }, [token]);

  return {
    notificationsOpen,
    setNotificationsOpen,
    notifications,
    visibleNotifications,
    unreadNotifications,
    friendRequests,
    openNotifications,
    refreshNotifications,
    refreshFriendRequests,
    acceptIncomingFriendRequest,
    declineIncomingFriendRequest,
    readNotification,
  };
}
