import { z } from "zod";

export const NOTIFICATION_TYPES = ["order_status", "chat_message", "seller_status"] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const notificationSchema = z.object({
  id: z.string(),
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  payload: z.record(z.string(), z.unknown()),
  isRead: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type NotificationView = z.infer<typeof notificationSchema>;

export const notificationListResponseSchema = z.object({
  items: z.array(notificationSchema),
  unreadCount: z.number(),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

/** Denyut ringan untuk polling: cukup membandingkan angka & notifikasi terbaru, tanpa menarik seluruh list. */
export const notificationPulseSchema = z.object({
  unreadCount: z.number(),
  latestId: z.string().nullable(),
});
export type NotificationPulse = z.infer<typeof notificationPulseSchema>;

// ---------- Realtime (T-09B) ----------

/** Nama event Pusher untuk notifikasi baru. Dipakai bersama oleh API (publish) dan web (bind). */
export const NOTIFICATION_EVENT = "notification.new";

/** Channel private per user — satu-satunya channel yang boleh di-subscribe user tersebut. */
export const userChannelName = (userId: string) => `private-user-${userId}`;

/** Konfigurasi Pusher publik untuk browser. `enabled: false` = API tanpa Pusher → web memakai polling. */
export const realtimeConfigSchema = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false) }),
  z.object({ enabled: z.literal(true), key: z.string().min(1), cluster: z.string().min(1) }),
]);
export type RealtimeConfig = z.infer<typeof realtimeConfigSchema>;

/** Body `POST /api/pusher/auth` (diteruskan dari handler otorisasi channel pusher-js). */
export const pusherAuthRequestSchema = z.object({
  socketId: z.string().regex(/^\d+\.\d+$/, "socketId tidak valid"),
  channelName: z.string().min(1).max(164),
});
export type PusherAuthRequest = z.infer<typeof pusherAuthRequestSchema>;