import type { FastifyPluginAsync } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { notificationListResponseSchema } from "@ecommerce/shared";
import { db, schema } from "../../db";
import { httpError } from "../../lib/http-error";
import { requireAuth } from "../../plugins/auth";

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  // Dipoll FE (bell icon) tiap beberapa detik — query kecil, terindex (user_idx).
  app.get("/api/notifications", { preHandler: requireAuth }, async (req) => {
    const items = await db.query.notifications.findMany({
      where: (n, { eq: eqq }) => eqq(n.userId, req.user!.id),
      orderBy: (n, { desc }) => desc(n.createdAt),
      limit: 30,
    });
    const [unreadRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, req.user!.id), eq(schema.notifications.isRead, false)));
    const count = unreadRow?.count ?? 0;

    return notificationListResponseSchema.parse({
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        payload: n.payload,
        isRead: n.isRead,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount: count,
    });
  });

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

  // Tandai semua terbaca sekaligus — dipakai saat buyer buka dropdown notifikasi.
  app.post("/api/notifications/read-all", { preHandler: requireAuth }, async (req) => {
    await db
      .update(schema.notifications)
      .set({ isRead: true })
      .where(and(eq(schema.notifications.userId, req.user!.id), eq(schema.notifications.isRead, false)));
    return { ok: true };
  });
};