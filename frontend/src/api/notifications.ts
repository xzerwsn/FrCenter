import { apiGet, apiPost } from "./client";

export type AppNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
};

export type NotificationListResponse = {
  notifications: AppNotification[];
  unread_count: number;
};

export async function listNotifications(token: string): Promise<NotificationListResponse> {
  return apiGet<NotificationListResponse>("/api/notifications", { token });
}

export async function markNotificationRead(token: string, notificationId: string): Promise<AppNotification> {
  return apiPost<AppNotification>(`/api/notifications/${notificationId}/read`, {}, { token });
}

export async function markAllNotificationsRead(token: string): Promise<void> {
  await apiPost<void>("/api/notifications/read-all", {}, { token });
}
