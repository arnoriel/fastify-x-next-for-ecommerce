/**
 * T-07: endpoint pembayaran Midtrans.
 *
 *   POST /webhook/midtrans         — callback Midtrans (tanpa auth; keamanan via signature_key)
 *   POST /api/checkout/:id/pay     — buyer buat/ambil ulang Snap payment URL
 *   GET  /api/checkout/:id/status  — rekonsiliasi manual ke Midtrans (fallback polling FE)
 *
 * Realtime ke buyer (T-06B): FE polling GET /api/checkout/:id (checkout.routes.ts) —
 * perubahan status dari webhook langsung terbaca di sana. Tidak perlu channel terpisah.
 */

import type { FastifyPluginAsync } from "fastify";
import { env } from "../../env";
import { db } from "../../db";
import { httpError } from "../../lib/http-error";
import { checkTransactionStatus, midtransWebhookSchema, verifySignature } from "../../lib/midtrans";
import { requireAuth } from "../../plugins/auth";
import {
  applyPaymentStatus,
  FREE_CHECKOUT_PAYMENT_METHOD,
  initiateSnapPayment,
  reconcileStaleCheckouts,
  syncCheckoutFromMidtrans,
} from "./payment.service";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

async function findOwnedCheckout(id: string, userId: string) {
  const checkout = await db.query.checkouts.findFirst({
    where: (c, { and: andd, eq: eqq }) => andd(eqq(c.id, id), eqq(c.userId, userId)),
  });
  if (!checkout) throw httpError(404, "CHECKOUT_NOT_FOUND", "Checkout tidak ditemukan.");
  return checkout;
}

export const paymentRoutes: FastifyPluginAsync = async (app) => {
  // ---------- POST /webhook/midtrans ----------
  // Respons:
  //  - 401 signature tidak ada/salah (bukan dari Midtrans)
  //  - 400 payload cacat
  //  - 200 untuk semua kasus lain (status belum final, invoice tak dikenal, amount mismatch,
  //    duplikat) supaya Midtrans tidak retry tanpa henti. Error DB → 500 → Midtrans retry (diinginkan).
  app.post("/webhook/midtrans", async (req, reply) => {
    const parsed = midtransWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      const missingSignature = parsed.error.issues.some((i) => i.path[0] === "signature_key");
      app.log.warn({ issues: parsed.error.issues.length }, "[webhook/midtrans] payload tidak valid");
      reply.code(missingSignature ? 401 : 400);
      return { error: missingSignature ? "INVALID_SIGNATURE" : "INVALID_PAYLOAD" };
    }
    const payload = parsed.data;

    if (!verifySignature(payload)) {
      app.log.warn({ orderId: payload.order_id }, "[webhook/midtrans] signature invalid — ditolak");
      reply.code(401);
      return { error: "INVALID_SIGNATURE" };
    }

    const checkout = await db.query.checkouts.findFirst({
      where: (c, { eq: eqq }) => eqq(c.invoiceNo, payload.order_id),
    });
    if (!checkout) {
      app.log.warn({ orderId: payload.order_id }, "[webhook/midtrans] checkout tidak ditemukan");
      return { ok: true };
    }

    const outcome = await syncCheckoutFromMidtrans(checkout, payload, app.log);
    app.log.info(
      { invoiceNo: payload.order_id, txStatus: payload.transaction_status, fraudStatus: payload.fraud_status, outcome },
      "[webhook/midtrans] callback diproses",
    );
    return { ok: true };
  });

  // ---------- POST /api/checkout/:id/pay ----------
  // Dipanggil buyer saat paymentUrl belum ada (Midtrans sempat down saat checkout dibuat).
  // Idempotent: paymentUrl yang sudah ada dikembalikan apa adanya.
  app.post("/api/checkout/:id/pay", { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const checkout = await findOwnedCheckout(id, req.user!.id);

    if (checkout.status === "paid" || checkout.status === "cancelled") {
      return { status: checkout.status, paymentUrl: checkout.paymentUrl };
    }
    if (checkout.status === "expired" || checkout.status === "failed") {
      throw httpError(409, "CHECKOUT_EXPIRED", "Checkout sudah kedaluwarsa atau gagal. Buat checkout baru.");
    }
    if (checkout.paymentUrl) return { status: checkout.status, paymentUrl: checkout.paymentUrl };

    if (checkout.grandTotal === 0) {
      await applyPaymentStatus(checkout.id, "paid", { paymentMethod: FREE_CHECKOUT_PAYMENT_METHOD });
      return { status: "paid", paymentUrl: null };
    }
    if (checkout.expiresAt && checkout.expiresAt.getTime() <= Date.now()) {
      throw httpError(409, "CHECKOUT_EXPIRED", "Checkout sudah kedaluwarsa. Buat checkout baru.");
    }

    const paymentUrl = await initiateSnapPayment(checkout.id);
    if (!paymentUrl) {
      throw httpError(
        503,
        "PAYMENT_GATEWAY_UNAVAILABLE",
        "Layanan pembayaran sedang tidak tersedia. Silakan coba lagi dalam beberapa saat.",
      );
    }
    return { status: "pending", paymentUrl };
  });

  // ---------- GET /api/checkout/:id/status ----------
  // Rekonsiliasi manual: tanya Midtrans langsung, sinkronkan DB kalau berbeda. Dipakai FE sebagai
  // fallback saat webhook tidak sampai (mis. dev tanpa tunnel ngrok).
  app.get("/api/checkout/:id/status", { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const checkout = await findOwnedCheckout(id, req.user!.id);
    const fromDb = () => ({ source: "db" as const, status: checkout.status, paymentUrl: checkout.paymentUrl });

    // Sudah final, atau Snap belum pernah dibuat (tidak ada transaksi di Midtrans) → cukup dari DB.
    if (checkout.status !== "pending" || !checkout.paymentUrl) return fromDb();

    const result = await checkTransactionStatus(checkout.invoiceNo);
    // Midtrans tidak terjangkau / buyer belum memilih metode bayar di Snap → status DB apa adanya.
    if (!result || !result.found) return fromDb();

    await syncCheckoutFromMidtrans(checkout, result.data, app.log);
    const fresh = await findOwnedCheckout(id, req.user!.id);
    return {
      source: "midtrans" as const,
      status: fresh.status,
      midtransStatus: result.data.transaction_status,
      paymentUrl: fresh.paymentUrl,
    };
  });

  // ---------- Sweep checkout kedaluwarsa ----------
  if (env.NODE_ENV !== "test") {
    const timer = setInterval(() => {
      reconcileStaleCheckouts(app.log).catch((err) => app.log.error({ err }, "[payment] sweep gagal"));
    }, SWEEP_INTERVAL_MS);
    timer.unref();
    app.addHook("onClose", async () => clearInterval(timer));
  }
};
