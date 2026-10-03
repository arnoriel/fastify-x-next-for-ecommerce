/**
 * T-08: logika bisnis status pengiriman — SATU-SATUNYA tempat yang mengubah status order akibat
 * kejadian kurir (shipped / delivered). Dipakai bersama oleh:
 *   - POST /webhook/biteship          (applyShippingWebhook)
 *   - GET  /api/orders/:id            (syncTrackingIfStale — fallback saat webhook tidak sampai)
 *   - bookShipment()                  (shipment.service.ts → pakai helper notify/event dari sini)
 *
 * Status order maju HANYA ke depan (paid → processing → shipped → delivered). Webhook telat/tidak
 * berurutan tidak pernah memundurkan status; `completed`/`cancelled`/`return_requested`/`refunded`
 * tidak disentuh (milik buyer/T-15).
 */

import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { type OrderTracking, orderTrackingSchema, shippingStatusLabel } from "@ecommerce/shared";
import { db, schema } from "../../db";
import { httpError } from "../../lib/http-error";
import { shipmentGateway, type TrackedShipment } from "../../lib/shipping";
import { createNotification } from "../notification/notification.service";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type OrderRow = typeof schema.orders.$inferSelect;
type EventRow = typeof schema.orderTrackingEvents.$inferSelect;

/** Tidak akan ada update tracking lagi → polling/sinkron berhenti. */
export const FINAL_SHIPPING_STATUSES: ReadonlySet<string> = new Set([
  "delivered",
  "cancelled",
  "returned",
  "rejected",
  "disposed",
  "courier_not_found",
]);
/** Booking gagal di sisi kurir → seller boleh membuat pengiriman ulang. */
export const FAILED_BOOKING_STATUSES: ReadonlySet<string> = new Set(["cancelled", "rejected", "courier_not_found"]);

const ORDER_STATUS_BY_SHIPPING: Record<string, "shipped" | "delivered"> = {
  picked: "shipped",
  in_transit: "shipped",
  dropping_off: "shipped",
  delivered: "delivered",
};
const ORDER_RANK: Record<string, number> = { paid: 1, processing: 2, shipped: 3, delivered: 4 };

/** Jeda minimum antar sinkron ke tracking API per order (buyer polling tidak membanjiri Biteship). */
const SYNC_INTERVAL_MS = 3 * 60 * 1000;

// ---------- Notifikasi ----------

/** Gagal membuat notifikasi (savepoint) TIDAK boleh membatalkan perubahan status pengiriman. */
export async function notifySafely(tx: Tx, params: Parameters<typeof createNotification>[0]) {
  try {
    await tx.transaction((sp) => createNotification(params, sp));
  } catch (err) {
    console.warn("[shipping] gagal membuat notifikasi — perubahan status tetap disimpan:", err);
  }
}

// ---------- View untuk buyer ----------

/** Rakit view tracking dari order + event-nya (event diharapkan sudah terurut terbaru → terlama). */
export function buildTracking(order: Pick<OrderRow, "shippingStatus" | "trackingLink"> & { trackingEvents: EventRow[] }): OrderTracking {
  return orderTrackingSchema.parse({
    shippingStatus: order.shippingStatus,
    shippingStatusLabel: order.shippingStatus ? shippingStatusLabel(order.shippingStatus) : null,
    trackingLink: order.trackingLink,
    isFinal: order.shippingStatus ? FINAL_SHIPPING_STATUSES.has(order.shippingStatus) : false,
    events: order.trackingEvents.map((e) => ({
      status: e.status,
      label: shippingStatusLabel(e.status),
      note: e.note,
      occurredAt: e.occurredAt.toISOString(),
    })),
  });
}

// ---------- Transisi status order ----------

/**
 * Terapkan 1 status pengiriman ke order (sudah row-lock oleh caller): update field shipping, majukan
 * status order bila perlu, kirim notifikasi. Tidak menulis event — pencatat event beda per sumber.
 */
async function transition(
  tx: Tx,
  order: OrderRow,
  status: string,
  meta: { waybillId?: string | null; trackingId?: string | null; link?: string | null },
) {
  const now = new Date();
  const patch: Partial<typeof schema.orders.$inferInsert> = { shippingStatus: status, updatedAt: now };
  if (meta.waybillId) patch.trackingNumber = meta.waybillId;
  if (meta.trackingId) patch.biteshipTrackingId = meta.trackingId;
  if (meta.link) patch.trackingLink = meta.link;

  const target = ORDER_STATUS_BY_SHIPPING[status];
  const currentRank = ORDER_RANK[order.status];
  const advance = target !== undefined && currentRank !== undefined && currentRank < ORDER_RANK[target]!;

  if (advance) {
    patch.status = target;
    if (!order.shippedAt) patch.shippedAt = now;
    if (target === "delivered") patch.deliveredAt = now;
  }
  await tx.update(schema.orders).set(patch).where(eq(schema.orders.id, order.id));

  const resi = (meta.waybillId ?? order.trackingNumber) ? ` No. resi: ${meta.waybillId ?? order.trackingNumber}.` : "";
  if (advance && order.userId) {
    await notifySafely(tx, {
      userId: order.userId,
      type: "order_status",
      title: target === "delivered" ? "Pesanan tiba" : "Pesanan dikirim",
      body:
        target === "delivered"
          ? `Pesanan ${order.orderNo} telah sampai di tujuan. Konfirmasi penerimaan untuk menyelesaikan pesanan.`
          : `Pesanan ${order.orderNo} sedang dalam perjalanan.${resi}`,
      payload: { orderId: order.id, shippingStatus: status },
    });
  }

  // Booking gagal di kurir → seller perlu tahu supaya membuat pengiriman ulang.
  if (FAILED_BOOKING_STATUSES.has(status) && order.shippingStatus !== status) {
    const seller = await tx.query.sellers.findFirst({
      where: (s, { eq: eqq }) => eqq(s.id, order.sellerId),
      columns: { userId: true },
    });
    if (seller) {
      await notifySafely(tx, {
        userId: seller.userId,
        type: "order_status",
        title: "Pengiriman perlu dibuat ulang",
        body: `Pengiriman pesanan ${order.orderNo}: ${shippingStatusLabel(status)}. Buat pengiriman ulang agar pesanan sampai ke pembeli.`,
        payload: { orderId: order.id, shippingStatus: status },
      });
    }
  }
}

/** Status lama yang datang telat setelah `delivered` diabaikan — jangan memundurkan status pengiriman. */
const isStale = (order: OrderRow, incoming: string) => order.shippingStatus === "delivered" && incoming !== "delivered";

// ---------- Serah terima ke kurir oleh seller (T-09) ----------

/**
 * Seller menandai paket sudah diserahkan ke kurir: `processing` → `shipped` lewat jalur `transition`
 * yang sama dengan webhook (status "picked"), jadi notifikasi buyer & aturan "hanya maju" identik.
 *
 * - Sudah `shipped`/`delivered`/`completed` (klik ganda, webhook lebih dulu) → `changed: false`, tanpa efek.
 * - Order milik seller lain / tidak ada → 404.
 * - Belum `processing`, atau booking kurir belum ada/gagal → 409 (seller harus buat pengiriman dulu).
 */
export async function markShippedBySeller(params: { orderId: string; sellerId: string }) {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.id, params.orderId), eq(schema.orders.sellerId, params.sellerId)))
      .for("update");
    if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Pesanan tidak ditemukan.");

    if (order.status === "shipped" || order.status === "delivered" || order.status === "completed") {
      return { order, changed: false };
    }
    if (order.status !== "processing") {
      throw httpError(409, "ORDER_NOT_SHIPPABLE", "Pesanan belum bisa ditandai dikirim pada status saat ini.");
    }
    if (!order.biteshipOrderId || FAILED_BOOKING_STATUSES.has(order.shippingStatus ?? "")) {
      throw httpError(409, "SHIPMENT_NOT_BOOKED", "Buat pengiriman (resi) terlebih dahulu sebelum menandai dikirim.");
    }

    await tx
      .insert(schema.orderTrackingEvents)
      .values({
        orderId: order.id,
        status: "picked",
        note: "Paket diserahkan penjual ke kurir",
        occurredAt: new Date(),
        source: "system",
      })
      .onConflictDoNothing();
    await transition(tx, order, "picked", {});

    const [updated] = await tx.select().from(schema.orders).where(eq(schema.orders.id, order.id));
    return { order: updated!, changed: true };
  });
}

// ---------- Webhook ----------

export type WebhookOutcome = "applied" | "ignored" | "unknown_order";

/**
 * Proses webhook `order.status`. Idempotent: retry Biteship dengan status sama tidak menggandakan event
 * maupun notifikasi (event terbaru berstatus sama → tidak dicatat ulang; transisi hanya maju).
 * Order Biteship yang tidak dikenal (mis. dibuat manual dari dashboard Biteship) → `unknown_order`.
 */
export async function applyShippingWebhook(params: {
  biteshipOrderId: string;
  status: string;
  waybillId?: string | null;
  trackingId?: string | null;
  link?: string | null;
}): Promise<WebhookOutcome> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.biteshipOrderId, params.biteshipOrderId))
      .for("update");
    if (!order) return "unknown_order";
    if (isStale(order, params.status)) return "ignored";

    const [latest] = await tx
      .select({ status: schema.orderTrackingEvents.status })
      .from(schema.orderTrackingEvents)
      .where(eq(schema.orderTrackingEvents.orderId, order.id))
      .orderBy(desc(schema.orderTrackingEvents.occurredAt))
      .limit(1);
    if (latest?.status !== params.status) {
      await tx
        .insert(schema.orderTrackingEvents)
        .values({ orderId: order.id, status: params.status, note: null, occurredAt: new Date(), source: "webhook" })
        .onConflictDoNothing();
    }

    await transition(tx, order, params.status, params);
    return "applied";
  });
}

/** Webhook `order.waybill_id`: resi berubah (mis. serah-terima ke kurir berikutnya). */
export async function applyWaybillUpdate(params: {
  biteshipOrderId: string;
  waybillId: string;
  trackingId?: string | null;
}): Promise<boolean> {
  const updated = await db
    .update(schema.orders)
    .set({
      trackingNumber: params.waybillId,
      ...(params.trackingId ? { biteshipTrackingId: params.trackingId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.orders.biteshipOrderId, params.biteshipOrderId))
    .returning({ id: schema.orders.id });
  return updated.length > 0;
}

// ---------- Sinkron tracking API (fallback webhook) ----------

/**
 * Gabungkan histori dari tracking API ke tabel event: event webhook/booking untuk status yang sama
 * "diupgrade" (waktu & catatan asli dari kurir) alih-alih jadi duplikat di timeline.
 */
async function mergeHistory(tx: Tx, orderId: string, history: TrackedShipment["history"]) {
  const existing = await tx
    .select()
    .from(schema.orderTrackingEvents)
    .where(eq(schema.orderTrackingEvents.orderId, orderId));
  const claimed = new Set<string>();

  for (const h of [...history].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
    const exact = existing.find((e) => e.status === h.status && e.occurredAt.getTime() === h.occurredAt.getTime());
    if (exact) {
      claimed.add(exact.id);
      continue;
    }

    const upgradable = existing.find((e) => e.source !== "sync" && e.status === h.status && !claimed.has(e.id));
    if (upgradable) {
      claimed.add(upgradable.id);
      await tx
        .update(schema.orderTrackingEvents)
        .set({ occurredAt: h.occurredAt, note: h.note, source: "sync" })
        .where(eq(schema.orderTrackingEvents.id, upgradable.id));
      continue;
    }

    await tx
      .insert(schema.orderTrackingEvents)
      .values({ orderId, status: h.status, note: h.note, occurredAt: h.occurredAt, source: "sync" })
      .onConflictDoNothing();
  }
}

/**
 * Dipanggil saat buyer membuka detail order: kalau pengiriman belum final dan sinkron terakhir sudah
 * > 3 menit, tarik tracking dari Biteship. Best-effort — gagal/timeout tidak pernah mengganggu halaman.
 * "Klaim" jadwal sinkron dilakukan atomik lebih dulu agar banyak tab/polling tidak memicu panggilan paralel.
 * Return true kalau data order berubah (caller perlu muat ulang).
 */
export async function syncTrackingIfStale(order: OrderRow): Promise<boolean> {
  if (!order.biteshipTrackingId) return false;
  if (order.shippingStatus && FINAL_SHIPPING_STATUSES.has(order.shippingStatus)) return false;

  const threshold = new Date(Date.now() - SYNC_INTERVAL_MS);
  const claimed = await db
    .update(schema.orders)
    .set({ trackingSyncedAt: new Date() })
    .where(
      and(
        eq(schema.orders.id, order.id),
        or(isNull(schema.orders.trackingSyncedAt), lt(schema.orders.trackingSyncedAt, threshold)),
      ),
    )
    .returning({ id: schema.orders.id });
  if (claimed.length === 0) return false;

  try {
    const tracked = await shipmentGateway.trackShipment(order.biteshipTrackingId);
    if (!tracked) return false;

    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(schema.orders).where(eq(schema.orders.id, order.id)).for("update");
      if (!locked) return;
      await mergeHistory(tx, locked.id, tracked.history);
      if (!isStale(locked, tracked.status)) {
        await transition(tx, locked, tracked.status, { waybillId: tracked.waybillId, link: tracked.link });
      }
    });
    return true;
  } catch (err) {
    console.warn(`[shipping] sinkron tracking order ${order.id} gagal:`, err);
    return false;
  }
}
