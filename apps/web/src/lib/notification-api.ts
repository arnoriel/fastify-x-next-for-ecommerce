"use client";

import {
  notificationListResponseSchema,
  type NotificationListResponse,
  notificationPulseSchema,
  type NotificationPulse,
  realtimeConfigSchema,
  type RealtimeConfig,
} from "@ecommerce/shared";
import { apiRequest } from "@/lib/http";

export async function listNotifications(): Promise<NotificationListResponse> {
  return notificationListResponseSchema.parse(await apiRequest("/api/notifications"));
}

/** Polling ringan: unread count + id notifikasi terbaru. */
export async function getNotificationPulse(): Promise<NotificationPulse> {
  return notificationPulseSchema.parse(await apiRequest("/api/notifications/unread-count"));
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiRequest(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiRequest("/api/notifications/read-all", { method: "POST" });
}

/** Key/cluster Pusher dari API (satu sumber config); `enabled: false` → pakai polling. */
export async function getRealtimeConfig(): Promise<RealtimeConfig> {
  return realtimeConfigSchema.parse(await apiRequest("/api/notifications/realtime"));
}