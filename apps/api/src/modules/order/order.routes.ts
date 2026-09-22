import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  CONFIRMABLE_ORDER_STATUSES,
  listOrdersQuerySchema,
  orderDetailSchema,
  orderListResponseSchema,
} from "@ecommerce/shared";
import { db, schema } from "../../db";
import { httpError } from "../../lib/http-error";
import { requireAuth } from "../../plugins/auth";
import { createNotification } from "../notification/notification.service";

type OrderRow = NonNullable<Awaited<ReturnType<typeof loadOrder>>>;

async function loadOrder(userId: string, orderId: string) {
  return db.query.orders.findFirst({
    where: (o, { and: andd, eq: eqq }) => andd(eqq(o.id, orderId), eqq(o.userId, userId)),
    with: { items: true, seller: true },
  });
}

function canConfirm(status: OrderRow["status"]): boolean {
  return (CONFIRMABLE_ORDER_STATUSES as readonly string[]).includes(status);
}

function serializeDetail(order: OrderRow) {
  return orderDetailSchema.parse({
    id: order.id,
    orderNo: order.orderNo,
    sellerId: order.sellerId,
    sellerName: order.seller!.storeName,
    status: order.status,
    shippingAddress: {
      recipientName: order.shippingAddress.recipientName,
      phone: order.shippingAddress.phone,
      province: order.shippingAddress.province,
      city: order.shippingAddress.city,
      district: order.shippingAddress.district,
      postalCode: order.shippingAddress.postalCode,
      street: order.shippingAddress.street,
    },
    courierCode: order.courierCode,
    courierService: order.courierService,
    trackingNumber: order.trackingNumber,
    subtotal: order.subtotal,
    shippingCost: order.shippingCost,
    discount: order.discount,
    total: order.total,
    note: order.note,
    items: order.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      productName: i.productName,
      variantName: i.variantName,
      imageUrl: i.imageUrl,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      subtotal: i.subtotal,
    })),
    canConfirmReceived: canConfirm(order.status),
    canReview: order.status === "completed",
    createdAt: order.createdAt.toISOString(),
    shippedAt: order.shippedAt ? order.shippedAt.toISOString() : null,
    deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
    completedAt: order.completedAt ? order.completedAt.toISOString() : null,
  });
}

export const orderRoutes: FastifyPluginAsync = async (app) => {
  // ---------- Riwayat order buyer (filter status, pagination) ----------

  app.get("/api/orders", { preHandler: requireAuth }, async (req) => {
    const query = listOrdersQuerySchema.parse(req.query);
    const userId = req.user!.id;

    const whereClause = query.status
      ? and(eq(schema.orders.userId, userId), eq(schema.orders.status, query.status))
      : eq(schema.orders.userId, userId);

    const [totalRow] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.orders).where(whereClause);
    const count = totalRow?.count ?? 0;

    const rows = await db.query.orders.findMany({
      where: (o, { and: andd, eq: eqq }) =>
        query.status ? andd(eqq(o.userId, userId), eqq(o.status, query.status!)) : eqq(o.userId, userId),
      with: { items: true, seller: true },
      orderBy: (o, { desc: descc }) => descc(o.createdAt),
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });

    return orderListResponseSchema.parse({
      items: rows.map((o) => {
        const detail = serializeDetail(o);
        const { items, ...rest } = detail;
        return {
          ...rest,
          itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
          thumbnailUrl: items[0]?.imageUrl ?? null,
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      total: count,
    });
  });

  // ---------- Detail 1 order ----------

  app.get("/api/orders/:id", { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const order = await loadOrder(req.user!.id, id);
    if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Pesanan tidak ditemukan.");
    return serializeDetail(order);
  });

  // ---------- Konfirmasi terima barang (buyer) → status completed, buka akses review ----------

  app.post("/api/orders/:id/confirm", { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };

    const result = await db.transaction(async (tx) => {
      // Row lock: cegah double-click "Konfirmasi Terima Barang" memicu transisi status 2x
      // (idempotent secara alami karena guard status di bawah, tapi row lock cegah race read).
      const [order] = await tx
        .select()
        .from(schema.orders)
        .where(and(eq(schema.orders.id, id), eq(schema.orders.userId, req.user!.id)))
        .for("update");
      if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Pesanan tidak ditemukan.");
      if (!canConfirm(order.status)) {
        throw httpError(
          400,
          "ORDER_NOT_CONFIRMABLE",
          "Pesanan ini tidak bisa dikonfirmasi pada status saat ini.",
        );
      }

      const [updated] = await tx
        .update(schema.orders)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(schema.orders.id, id))
        .returning();

      return updated!;
    });

    await createNotification({
      userId: req.user!.id,
      type: "order_status",
      title: "Pesanan selesai",
      body: `Pesanan ${result.orderNo} telah dikonfirmasi diterima. Yuk beri review!`,
      payload: { orderId: result.id },
    });

    const full = await loadOrder(req.user!.id, id);
    return serializeDetail(full!);
  });
};