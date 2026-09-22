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
