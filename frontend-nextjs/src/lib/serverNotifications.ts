import "server-only";

import { adminDb, adminMessaging } from "@/lib/firebaseAdmin";

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

type PreferenceNode = {
  enabled?: boolean;
  topics?: Partial<Record<NotificationTopic, boolean>>;
};

type SubscriptionNode = {
  token?: string;
  enabled?: boolean;
};

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

function chunk<T>(items: T[], size: number): T[][];
function chunk<T>(items: T[], size: number): Array<Array<T>> {
  const out: Array<Array<T>> = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function toStringMap(data?: NotificationData): Record<string, string> {
  if (!data) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = String(value);
  }
  return out;
}

async function resolveRecipientTokens(topic: NotificationTopic): Promise<string[]> {
  const db = adminDb();
  const [prefSnap, subsSnap] = await Promise.all([
    db.ref("notifications/preferences").get(),
    db.ref("notifications/subscriptions").get(),
  ]);

  const preferences = (prefSnap.val() || {}) as Record<string, PreferenceNode>;
  const subscriptions = (subsSnap.val() || {}) as Record<
    string,
    Record<string, SubscriptionNode>
  >;

  const tokens = new Set<string>();

  for (const [uid, userDevices] of Object.entries(subscriptions)) {
    const userPref = preferences[uid];
    const userEnabled = userPref?.enabled === true;
    const topicEnabled = userPref?.topics?.[topic] === true;
    if (!userEnabled || !topicEnabled) continue;

    for (const device of Object.values(userDevices || {})) {
      if (!device || device.enabled !== true || !device.token) continue;
      tokens.add(device.token);
    }
  }

  return [...tokens];
}

export async function dispatchTopicNotification(params: {
  topic: NotificationTopic;
  title: string;
  body: string;
  data?: NotificationData;
}): Promise<DispatchResult> {
  const tokens = await resolveRecipientTokens(params.topic);
  if (tokens.length === 0) {
    return {
      recipientCount: 0,
      successCount: 0,
      failureCount: 0,
      errors: [],
    };
  }

  const messageData = {
    topic: params.topic,
    title: params.title,
    body: params.body,
    icon: "/images/BatakLogo192.png",
    ...toStringMap(params.data),
  };

  const messaging = adminMessaging();
  const tokenChunks = chunk(tokens, 500);
  let successCount = 0;
  let failureCount = 0;
  const errors: string[] = [];

  for (const tokenChunk of tokenChunks) {
    const response = await messaging.sendEachForMulticast({
      tokens: tokenChunk,
      data: messageData,
      webpush: {
        fcmOptions: {
          link:
            typeof params.data?.link === "string" && params.data.link.length > 0
              ? params.data.link
              : "/",
        },
      },
    });

    successCount += response.successCount;
    failureCount += response.failureCount;
    response.responses.forEach((entry) => {
      if (!entry.success && entry.error) {
        errors.push(entry.error.message);
      }
    });
  }

  return {
    recipientCount: tokens.length,
    successCount,
    failureCount,
    errors: [...new Set(errors)].slice(0, 20),
  };
}

export async function emitNotificationEvent(params: {
  eventId: string;
  topic: NotificationTopic;
  title: string;
  body: string;
  data?: NotificationData;
  createdByUid?: string;
  createdByName?: string;
}): Promise<EmitResult> {
  const safeEventId = normalizeEventId(params.eventId);
  const eventRef = adminDb().ref(`notifications/events/${safeEventId}`);
  const tx = await eventRef.transaction(
    (current: any) => {
      if (current?.status === "sent") {
        return;
      }
      if (
        current?.status === "pending" &&
        typeof current?.createdAt === "number" &&
        Date.now() - current.createdAt < 30_000
      ) {
        return;
      }

      return {
        eventId: safeEventId,
        topic: params.topic,
        status: "pending",
        createdAt: Date.now(),
        createdByUid: params.createdByUid || "system",
        createdByName: params.createdByName || "system",
        title: params.title,
        body: params.body,
        data: params.data || null,
      };
    },
    undefined,
    false
  );

  if (!tx.committed) {
    return { eventId: safeEventId, duplicate: true };
  }

  try {
    const result = await dispatchTopicNotification({
      topic: params.topic,
      title: params.title,
      body: params.body,
      data: {
        ...(params.data || {}),
        eventId: params.eventId,
      },
    });

    await eventRef.update({
      status: "sent",
      sentAt: Date.now(),
      recipientCount: result.recipientCount,
      successCount: result.successCount,
      failureCount: result.failureCount,
      errors: result.errors,
    });

    return { eventId: safeEventId, duplicate: false, dispatch: result };
  } catch (dispatchError: any) {
    await eventRef.update({
      status: "failed",
      failedAt: Date.now(),
      error: dispatchError?.message || "dispatch_failed",
    });
    throw dispatchError;
  }
}
