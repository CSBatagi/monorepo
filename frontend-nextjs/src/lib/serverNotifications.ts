import "server-only";

export const NOTIFICATION_TOPICS = [
  "teker_dondu_reached",
  "mvp_poll_locked",
  "stats_updated",
  "timed_reminders",
  "admin_custom_message",
] as const;

export type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number];

type NotificationDataValue = string | number | boolean;
export type NotificationData = Record<string, NotificationDataValue>;

export type DispatchResult = {
  recipientCount: number;
  successCount: number;
  failureCount: number;
  errors: string[];
};

export type EmitResult = {
  eventId: string;
  duplicate: boolean;
  dispatch?: DispatchResult;
};

export function isNotificationTopic(value: string): value is NotificationTopic {
  return (NOTIFICATION_TOPICS as readonly string[]).includes(value);
}

export function normalizeEventId(value: string): string {
  return value.replace(/[.#$/\[\]]/g, "_");
}
