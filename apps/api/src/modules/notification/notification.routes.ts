import type { FastifyPluginAsync } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import {
  notificationListResponseSchema,
  notificationPulseSchema,
  pusherAuthRequestSchema,
  realtimeConfigSchema,
  userChannelName,
} from "@ecommerce/shared";
import { db, schema } from "../../db";
import { httpError } from "../../lib/http-error";
import { realtimeConfig, signChannelAuth } from "../../lib/pusher";
import { requireAuth } from "../../plugins/auth";
import { toNotificationView } from "./notification.service";

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  // Sumber kebenaran bell: dipanggil saat mount, saat tab kembali aktif, dan sebagai fallback
  // polling bila realtime nonaktif. Query kecil & terindex (notifications_user_idx).
  app.get("/api/notifications", { preHandler: requireAuth }, async (req) => {
    const userId = req.user!.id;
    const [items, [unreadRow]] = await Promise.all([
      db.query.notifications.findMany({
        where: (n, { eq: eqq }) => eqq(n.userId, userId),
        orderBy: (n, { desc }) => desc(n.createdAt),
        limit: 30,
      }),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.notifications)
        .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.isRead, false))),
    ]);

    return notificationListResponseSchema.parse({
      items: items.map(toNotificationView),
      unreadCount: unreadRow?.count ?? 0,
    });
  });

  // Polling murah (2 query kecil, tanpa payload list): dipakai bell tiap beberapa detik untuk tahu
  // apakah ada yang baru; list lengkap baru ditarik bila angka/notifikasi terbaru berubah.
  app.get("/api/notifications/unread-count", { preHandler: requireAuth }, async (req) => {
    const userId = req.user!.id;
    const [latest, [unreadRow]] = await Promise.all([
      db.query.notifications.findFirst({
        where: (n, { eq: eqq }) => eqq(n.userId, userId),
        orderBy: (n, { desc }) => desc(n.createdAt),
        columns: { id: true },
      }),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.notifications)
        .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.isRead, false))),
    ]);
    return notificationPulseSchema.parse({ unreadCount: unreadRow?.count ?? 0, latestId: latest?.id ?? null });
  });

  // Idempoten: menandai notifikasi yang sudah terbaca tetap 200. Milik user lain = 404 (tidak bocor).
  app.post("/api/notifications/:id/read", { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const [updated] = await db
      .update(schema.notifications)
      .set({ isRead: true })
      .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, req.user!.id)))
      .returning({ id: schema.notifications.id });
    if (!updated) throw httpError(404, "NOTIFICATION_NOT_FOUND", "Notifikasi tidak ditemukan.");
    return { ok: true };
  });

  // Tombol "Tandai semua dibaca" di dropdown bell (eksplisit, bukan otomatis saat dropdown dibuka).
  app.post("/api/notifications/read-all", { preHandler: requireAuth }, async (req) => {
    await db
      .update(schema.notifications)
      .set({ isRead: true })
      .where(and(eq(schema.notifications.userId, req.user!.id), eq(schema.notifications.isRead, false)));
    return { ok: true };
  });

  // ---------- Realtime (Pusher) ----------

  // Key & cluster publik. `enabled: false` → web tidak membuka koneksi dan memakai polling.
  app.get("/api/notifications/realtime", { preHandler: requireAuth }, async () =>
    realtimeConfigSchema.parse(realtimeConfig),
  );

  // Otorisasi channel private: user hanya boleh subscribe ke channel miliknya sendiri.
  app.post("/api/pusher/auth", { preHandler: requireAuth }, async (req) => {
    const { socketId, channelName } = pusherAuthRequestSchema.parse(req.body);
    if (channelName !== userChannelName(req.user!.id)) {
      throw httpError(403, "CHANNEL_FORBIDDEN", "Anda tidak boleh mengakses channel ini.");
    }
    const signed = signChannelAuth(socketId, channelName);
    if (!signed) throw httpError(503, "REALTIME_DISABLED", "Notifikasi realtime tidak aktif di server ini.");
    return signed;
  });
};