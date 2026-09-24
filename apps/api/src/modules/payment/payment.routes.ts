/**
 * T-07: Midtrans webhook callback & checkout payment initiation.
 *
 * Routes:
 *   POST /webhook/midtrans         — callback dari Midtrans (tidak pakai auth JWT)
 *   POST /api/checkout/:id/pay     — buyer inisiasi pembayaran (buat Snap transaction)
 *   GET  /api/checkout/:id/status  — manual check status (rekonsiliasi / polling FE fallback)
 */

import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db";
import { httpError } from "../../lib/http-error";
import {
  checkTransactionStatus,
  createTransaction,
  resolveCheckoutStatus,
  verifySignature,
  type MidtransWebhookPayload,
} from "../../lib/midtrans";
import { requireAuth } from "../../plugins/auth";
import { createNotification } from "../notification/notification.service";
import { env } from "../../env";

/** Cari checkout berdasarkan invoiceNo (= orderId yang dikirim ke Midtrans). */
async function findCheckoutByInvoice(invoiceNo: string) {
  return db.query.checkouts.findFirst({
    where: (c, { eq: eqq }) => eqq(c.invoiceNo, invoiceNo),
    with: { orders: { with: { seller: true } } },
  });
}

/**
 * Update status checkout + seluruh order-nya dalam 1 transaksi DB.
 * Idempotent: kalau checkout sudah di status yang sama, skip update.
 *
 * Edge cases:
 * - Webhook datang 2x (retry Midtrans) → update tetap aman karena row lock + cek status.
 * - Order sudah cancelled oleh admin → jangan overwrite ke paid; hanya paid→paid aman.
 * - grandTotal 0 bypass Midtrans → status sudah paid dari awal, webhook tidak akan datang.
 */
async function applyPaymentStatus(
  checkoutId: string,
  checkoutStatus: "paid" | "failed" | "expired",
  meta: {
    paymentMethod?: string;
    paymentReference?: string;
    paidAt?: Date;
  },
) {
  await db.transaction(async (tx) => {
    // Row lock: cegah 2 webhook bersamaan race condition.
    const [checkout] = await tx
      .select()
      .from(schema.checkouts)
      .where(eq(schema.checkouts.id, checkoutId))
      .for("update");

    if (!checkout) return; // sudah dihapus (edge case admin)
    if (checkout.status === checkoutStatus) return; // idempotent — sudah di status ini

    // Tidak boleh revert dari final state (paid tidak bisa jadi failed lagi, dsb).
    const FINAL = new Set(["paid", "failed", "expired", "cancelled"]);
    if (FINAL.has(checkout.status) && checkout.status !== checkoutStatus) {
      // Biarkan — status sudah final berbeda (mis. admin cancel, lalu webhook paid masuk).
      return;
    }

    await tx
      .update(schema.checkouts)
      .set({
        status: checkoutStatus,
        paymentMethod: meta.paymentMethod ?? checkout.paymentMethod,
        paymentReference: meta.paymentReference ?? checkout.paymentReference,
        paidAt: meta.paidAt ?? checkout.paidAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.checkouts.id, checkoutId));

    // Sync status order-nya:
    // - paid → order jadi "paid" (menunggu seller proses)
    // - expired/failed → order jadi "cancelled"
    const orderStatus = checkoutStatus === "paid" ? "paid" : "cancelled";
    await tx
      .update(schema.orders)
      .set({ status: orderStatus, updatedAt: new Date() })
      .where(eq(schema.orders.checkoutId, checkoutId));
  });
}

export const paymentRoutes: FastifyPluginAsync = async (app) => {
  // ---------- POST /webhook/midtrans ----------
  // Midtrans mengirim POST ke sini setelah transaksi berubah status.
  // Tidak perlu auth JWT — keamanan via signature_key.
  // WAJIB return 200 OK (bahkan untuk payload invalid) supaya Midtrans tidak retry terus-menerus.
  // Satu-satunya case non-200: signature invalid (bisa retry dari orang lain, bukan Midtrans).

  app.post("/webhook/midtrans", async (req, reply) => {
    const payload = req.body as MidtransWebhookPayload;

    // 1. Validasi signature — satu-satunya guard keamanan di endpoint ini.
    if (!payload?.signature_key || !verifySignature(payload)) {
      app.log.warn({ orderId: payload?.order_id }, "[webhook/midtrans] signature invalid — ditolak");
      // 401 supaya Midtrans tidak retry (signature salah = bukan dari Midtrans).
      reply.code(401);
      return { error: "INVALID_SIGNATURE" };
    }

    app.log.info(
      { orderId: payload.order_id, txStatus: payload.transaction_status, fraudStatus: payload.fraud_status },
      "[webhook/midtrans] callback diterima",
    );

    // 2. Konversi status Midtrans → status checkout kita.
    const newStatus = resolveCheckoutStatus(payload.transaction_status, payload.fraud_status as never);
    if (!newStatus) {
      // Status belum final (pending, authorize, challenge) — acknowledge saja.
      app.log.info({ txStatus: payload.transaction_status }, "[webhook/midtrans] status belum final, skip update");
      reply.code(200);
      return { ok: true };
    }

    // 3. Cari checkout berdasarkan invoiceNo (= order_id Midtrans).
    const checkout = await findCheckoutByInvoice(payload.order_id);
    if (!checkout) {
      app.log.warn({ orderId: payload.order_id }, "[webhook/midtrans] checkout tidak ditemukan");
      // 200 supaya Midtrans tidak retry untuk invoice yang memang tidak ada.
      reply.code(200);
      return { ok: true };
    }

    // 4. Validasi gross_amount — cegah amount tampering (meski signature sudah divalidasi).
    const webhookAmount = Math.round(parseFloat(payload.gross_amount));
    if (webhookAmount !== checkout.grandTotal) {
      app.log.error(
        { invoiceNo: payload.order_id, expected: checkout.grandTotal, got: webhookAmount },
        "[webhook/midtrans] gross_amount mismatch — kemungkinan tampering atau config salah",
      );
      // Jangan update status, tapi return 200 supaya Midtrans tidak retry.
      reply.code(200);
      return { ok: true, warning: "amount_mismatch" };
    }

    // 5. Apply status update (idempotent).
    await applyPaymentStatus(checkout.id, newStatus, {
      paymentMethod: payload.payment_type,
      paymentReference: payload.transaction_id,
      paidAt: newStatus === "paid" ? new Date(payload.transaction_time) : undefined,
    });

    // 6. Notifikasi in-app ke buyer (T-09B) — non-blocking, error tidak rollback webhook.
    if (checkout.userId) {
      try {
        const notifTitle =
          newStatus === "paid"
            ? "Pembayaran berhasil"
            : newStatus === "expired"
              ? "Pembayaran kedaluwarsa"
              : "Pembayaran gagal";
        const notifBody =
          newStatus === "paid"
            ? `Invoice ${checkout.invoiceNo} telah dibayar. Pesanan sedang diproses penjual.`
            : `Invoice ${checkout.invoiceNo} tidak berhasil diselesaikan.`;

        await createNotification({
          userId: checkout.userId,
          type: "order_status",
          title: notifTitle,
          body: notifBody,
          payload: { checkoutId: checkout.id, invoiceNo: checkout.invoiceNo, status: newStatus },
        });
      } catch (notifErr) {
        app.log.warn({ err: notifErr }, "[webhook/midtrans] gagal buat notifikasi — diabaikan");
      }
    }

    app.log.info(
      { invoiceNo: payload.order_id, newStatus },
      "[webhook/midtrans] status checkout & order diperbarui",
    );
    reply.code(200);
    return { ok: true };
  });

  // ---------- POST /api/checkout/:id/pay ----------
  // Buyer panggil ini setelah checkout dibuat (T-06) untuk mendapatkan Snap payment URL.
  // Bisa dipanggil ulang kalau paymentUrl belum ada (Midtrans sempat down saat checkout).
  //
  // Edge cases:
  // - Checkout sudah paid/expired/failed → kembalikan status tanpa buat transaction baru.
  // - grandTotal = 0 → skip Midtrans, langsung mark paid.
  // - Midtrans API down → kembalikan error yang bisa di-retry buyer.
  // - Checkout bukan milik user yang login → 404.

  app.post("/api/checkout/:id/pay", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;

    const checkout = await db.query.checkouts.findFirst({
      where: (c, { and: andd, eq: eqq }) => andd(eqq(c.id, id), eqq(c.userId, userId)),
    });
    if (!checkout) throw httpError(404, "CHECKOUT_NOT_FOUND", "Checkout tidak ditemukan.");

    // Sudah final — kembalikan state tanpa aksi.
    if (checkout.status === "paid" || checkout.status === "cancelled") {
      return { status: checkout.status, paymentUrl: checkout.paymentUrl };
    }
    if (checkout.status === "expired" || checkout.status === "failed") {
      throw httpError(409, "CHECKOUT_EXPIRED", "Checkout sudah kedaluwarsa atau gagal. Buat checkout baru.");
    }

    // paymentUrl sudah ada — kembalikan saja (buyer cukup buka URL yang sama).
    if (checkout.paymentUrl) {
      return { status: checkout.status, paymentUrl: checkout.paymentUrl };
    }

    // grandTotal = 0 (full discount voucher) → bypass Midtrans, langsung paid.
    if (checkout.grandTotal === 0) {
      await applyPaymentStatus(checkout.id, "paid", { paidAt: new Date(), paymentMethod: "voucher_full_discount" });
      return { status: "paid", paymentUrl: null };
    }

    // Ambil user untuk customer_details Midtrans.
    const user = await db.query.users.findFirst({ where: (u, { eq: eqq }) => eqq(u.id, userId) });

    // Ambil order items untuk item_details Midtrans.
    const orders = await db.query.orders.findMany({
      where: (o, { eq: eqq }) => eqq(o.checkoutId, checkout.id),
      with: { items: true },
    });

    const itemDetails = orders.flatMap((o) =>
      o.items.map((i) => ({
        id: i.variantId,
        price: i.unitPrice,
        quantity: i.quantity,
        name: `${i.productName} (${i.variantName})`.slice(0, 50), // Midtrans max 50 chars
      })),
    );

    // Tambahkan ongkir sebagai item terpisah kalau ada.
    for (const o of orders) {
      if (o.shippingCost > 0) {
        itemDetails.push({
          id: `shipping-${o.id}`,
          price: o.shippingCost,
          quantity: 1,
          name: `Ongkir ${o.courierCode ?? ""}`.trim().slice(0, 50),
        });
      }
      if (o.discount > 0) {
        itemDetails.push({
          id: `discount-${o.id}`,
          price: -o.discount, // negatif = diskon
          quantity: 1,
          name: "Diskon voucher",
        });
      }
    }

    // URL callback setelah buyer selesai bayar di Snap.
    const webUrl = env.WEB_URL.replace(/\/$/, "");
    const finishUrl = `${webUrl}/checkout/${checkout.id}`;

    const snap = await createTransaction({
      orderId: checkout.invoiceNo,
      grossAmount: checkout.grandTotal,
      customerName: user?.name ?? "Customer",
      customerEmail: user?.email ?? "",
      items: itemDetails,
      callbackUrl: finishUrl,
    });

    if (!snap) {
      // Midtrans down — beri tahu buyer untuk retry, jangan gagalkan checkout.
      throw httpError(
        503,
        "PAYMENT_GATEWAY_UNAVAILABLE",
        "Layanan pembayaran sedang tidak tersedia. Silakan coba lagi dalam beberapa saat.",
      );
    }

    // Simpan paymentUrl & paymentReference (snap token).
    await db
      .update(schema.checkouts)
      .set({ paymentUrl: snap.redirect_url, paymentReference: snap.token, updatedAt: new Date() })
      .where(eq(schema.checkouts.id, checkout.id));

    reply.code(200);
    return { status: "pending", paymentUrl: snap.redirect_url };
  });

  // ---------- GET /api/checkout/:id/status ----------
  // Manual reconciliation: cek status ke Midtrans API langsung.
  // Berguna saat webhook tidak terkirim (ngrok down, dst) — bisa dipakai FE sebagai fallback polling.

  app.get("/api/checkout/:id/status", { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;

    const checkout = await db.query.checkouts.findFirst({
      where: (c, { and: andd, eq: eqq }) => andd(eqq(c.id, id), eqq(c.userId, userId)),
    });
    if (!checkout) throw httpError(404, "CHECKOUT_NOT_FOUND", "Checkout tidak ditemukan.");

    // Sudah final di DB — kembalikan dari DB, tidak perlu hit Midtrans.
    const FINAL = new Set(["paid", "failed", "expired", "cancelled"]);
    if (FINAL.has(checkout.status)) {
      return { source: "db", status: checkout.status, paymentUrl: checkout.paymentUrl };
    }

    // Belum ada paymentReference → Snap belum dibuat (buyer belum panggil /pay).
    if (!checkout.invoiceNo) {
      return { source: "db", status: checkout.status, paymentUrl: checkout.paymentUrl };
    }

    const mtStatus = await checkTransactionStatus(checkout.invoiceNo);
    if (!mtStatus) {
      // Midtrans tidak bisa dihubungi — kembalikan status DB sebagai fallback.
      return { source: "db", status: checkout.status, paymentUrl: checkout.paymentUrl };
    }

    const resolvedStatus = resolveCheckoutStatus(
      mtStatus.transaction_status,
      mtStatus.fraud_status as never,
    );

    if (resolvedStatus && resolvedStatus !== checkout.status) {
      // Status beda antara Midtrans dan DB → sync sekarang (reconcile).
      await applyPaymentStatus(checkout.id, resolvedStatus, {
        paymentMethod: mtStatus.payment_type,
        paymentReference: mtStatus.transaction_id,
        paidAt: resolvedStatus === "paid" ? new Date(mtStatus.transaction_time) : undefined,
      });

      return { source: "midtrans", status: resolvedStatus, paymentUrl: checkout.paymentUrl };
    }

    return {
      source: "midtrans",
      status: checkout.status,
      midtransStatus: mtStatus.transaction_status,
      paymentUrl: checkout.paymentUrl,
    };
  });
};
