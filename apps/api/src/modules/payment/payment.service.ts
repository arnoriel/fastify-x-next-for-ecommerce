/**
 * T-07: logika bisnis pembayaran — SATU-SATUNYA tempat yang mengubah status checkout/order
 * akibat pembayaran. Dipakai bersama oleh:
 *   - POST /api/checkout            (checkout.routes.ts → Snap awal / full-voucher)
 *   - POST /api/checkout/:id/pay    (retry Snap)
 *   - POST /webhook/midtrans        (callback Midtrans)
 *   - GET  /api/checkout/:id/status (rekonsiliasi manual)
 *   - reconcileStaleCheckouts()     (sweep berkala checkout kedaluwarsa)
 */

import { and, eq, lt, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { db, schema } from "../../db";
import { env } from "../../env";
import {
  checkTransactionStatus,
  createTransaction,
  parseMidtransTime,
  resolveCheckoutStatus,
  type MidtransTxResult,
} from "../../lib/midtrans";
import { createNotification } from "../notification/notification.service";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type FinalPaymentStatus = "paid" | "failed" | "expired";

/** Masa berlaku checkout (stok & voucher ditahan selama ini). Snap expiry disamakan dengannya. */
export const CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000;
/** Metode bayar untuk checkout bertotal 0 (voucher penuh) — tidak lewat Midtrans. */
export const FREE_CHECKOUT_PAYMENT_METHOD = "voucher_full_discount";
// Toleransi sebelum sweep menganggap checkout pending sudah benar-benar kedaluwarsa.
const STALE_GRACE_MS = 5 * 60 * 1000;
const STALE_BATCH_SIZE = 50;

/**
 * - applied      : status berubah (transisi pending → final)
 * - noop         : sudah final / checkout tidak ada — aman diabaikan (webhook retry)
 * - late_payment : pembayaran masuk setelah checkout expired/failed/cancelled (stok sudah
 *                  dilepas) → butuh penanganan manual (refund)
 */
export type ApplyResult = "applied" | "noop" | "late_payment";
export type SyncOutcome = ApplyResult | "pending" | "amount_mismatch";

const NOTIFICATION_COPY: Record<FinalPaymentStatus, { title: string; body: (invoiceNo: string) => string }> = {
  paid: {
    title: "Pembayaran berhasil",
    body: (inv) => `Invoice ${inv} telah dibayar. Pesanan sedang diproses penjual.`,
  },
  expired: { title: "Pembayaran kedaluwarsa", body: (inv) => `Invoice ${inv} tidak dibayar sampai batas waktu.` },
  failed: { title: "Pembayaran gagal", body: (inv) => `Invoice ${inv} tidak berhasil diselesaikan.` },
};

/**
 * Kembalikan stok & kuota voucher yang ditahan saat checkout (T-06) — dipanggil saat
 * checkout expired/failed. Tanpa ini stok "bocor" permanen untuk tiap pembayaran yang gagal.
 * Hanya boleh dipanggil dari dalam transaksi yang sudah row-lock checkout (guard idempotensi).
 */
async function releaseReservation(tx: Tx, checkoutId: string) {
  const lines = await tx
    .select({ variantId: schema.orderItems.variantId, quantity: schema.orderItems.quantity })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
    .where(eq(schema.orders.checkoutId, checkoutId));

  const qtyByVariant = new Map<string, number>();
  for (const l of lines) qtyByVariant.set(l.variantId, (qtyByVariant.get(l.variantId) ?? 0) + l.quantity);

  // Urutan variantId konsisten → hindari deadlock antar transaksi release paralel.
  for (const variantId of [...qtyByVariant.keys()].sort()) {
    await tx
      .update(schema.productVariants)
      .set({ stock: sql`${schema.productVariants.stock} + ${qtyByVariant.get(variantId)!}` })
      .where(eq(schema.productVariants.id, variantId));
  }

  const usages = await tx
    .select({ voucherId: schema.voucherUsages.voucherId })
    .from(schema.voucherUsages)
    .where(eq(schema.voucherUsages.checkoutId, checkoutId));
  for (const u of usages) {
    await tx
      .update(schema.vouchers)
      .set({ usedCount: sql`greatest(${schema.vouchers.usedCount} - 1, 0)` })
      .where(eq(schema.vouchers.id, u.voucherId));
  }
  // Pemakaian dibatalkan → jatah per-user buyer juga kembali.
  if (usages.length > 0) await tx.delete(schema.voucherUsages).where(eq(schema.voucherUsages.checkoutId, checkoutId));
}

/**
 * Transisi checkout `pending` → paid/failed/expired beserta seluruh order-nya, dalam 1 transaksi.
 *
 * Edge cases:
 * - Webhook ganda / paralel (retry Midtrans) → row lock + hanya transisi dari `pending` → idempotent;
 *   notifikasi & release stok tidak pernah jalan 2x.
 * - Status sudah final lalu datang status lain → diabaikan (noop), kecuali `paid` datang setelah
 *   expired/failed/cancelled → `late_payment` supaya caller bisa log/alert.
 * - expired/failed → stok & voucher dilepas (releaseReservation).
 * - Gagal membuat notifikasi (savepoint) TIDAK membatalkan update status pembayaran.
 */
export async function applyPaymentStatus(
  checkoutId: string,
  next: FinalPaymentStatus,
  meta: { paymentMethod?: string; paymentReference?: string; paidAt?: Date } = {},
): Promise<ApplyResult> {
  return db.transaction(async (tx) => {
    const [checkout] = await tx
      .select()
      .from(schema.checkouts)
      .where(eq(schema.checkouts.id, checkoutId))
      .for("update");
    if (!checkout) return "noop";

    if (checkout.status !== "pending") {
      return next === "paid" && checkout.status !== "paid" ? "late_payment" : "noop";
    }

    const now = new Date();
    await tx
      .update(schema.checkouts)
      .set({
        status: next,
        paymentMethod: meta.paymentMethod ?? checkout.paymentMethod,
        paymentReference: meta.paymentReference ?? checkout.paymentReference,
        paidAt: next === "paid" ? (meta.paidAt ?? now) : checkout.paidAt,
        updatedAt: now,
      })
      .where(eq(schema.checkouts.id, checkoutId));

    // Hanya order yang masih menunggu bayar — jangan menimpa status order yang sudah berjalan.
    await tx
      .update(schema.orders)
      .set({ status: next === "paid" ? "paid" : "cancelled", updatedAt: now })
      .where(and(eq(schema.orders.checkoutId, checkoutId), eq(schema.orders.status, "pending_payment")));

    if (next !== "paid") await releaseReservation(tx, checkoutId);

    if (checkout.userId) {
      const copy = NOTIFICATION_COPY[next];
      try {
        await tx.transaction((sp) =>
          createNotification(
            {
              userId: checkout.userId!,
              type: "order_status",
              title: copy.title,
              body: copy.body(checkout.invoiceNo),
              payload: { checkoutId, invoiceNo: checkout.invoiceNo, status: next },
            },
            sp,
          ),
        );
      } catch (err) {
        console.warn("[payment] gagal membuat notifikasi — status pembayaran tetap disimpan:", err);
      }
    }
    return "applied";
  });
}

/**
 * Terapkan hasil dari Midtrans (webhook ATAU GET status) ke checkout — satu jalur untuk keduanya.
 * Memvalidasi gross_amount terhadap grandTotal (anti-tampering / salah konfigurasi).
 */
export async function syncCheckoutFromMidtrans(
  checkout: { id: string; invoiceNo: string; grandTotal: number },
  result: MidtransTxResult,
  log: FastifyBaseLogger,
): Promise<SyncOutcome> {
  const next = resolveCheckoutStatus(result.transaction_status, result.fraud_status);
  if (!next) return "pending";

  const amount = Math.round(Number.parseFloat(result.gross_amount));
  if (amount !== checkout.grandTotal) {
    log.error(
      { invoiceNo: checkout.invoiceNo, expected: checkout.grandTotal, got: amount },
      "[payment] gross_amount mismatch — kemungkinan tampering atau config salah, status TIDAK diubah",
    );
    return "amount_mismatch";
  }

  const outcome = await applyPaymentStatus(checkout.id, next, {
    paymentMethod: result.payment_type || undefined,
    paymentReference: result.transaction_id || undefined,
    paidAt: next === "paid" ? parseMidtransTime(result.transaction_time) : undefined,
  });
  if (outcome === "late_payment") {
    log.error(
      { invoiceNo: checkout.invoiceNo },
      "[payment] pembayaran diterima SETELAH checkout expired/failed (stok sudah dilepas) — perlu refund manual",
    );
  }
  return outcome;
}

/**
 * Buat Snap transaction untuk checkout `pending` dan simpan paymentUrl-nya.
 * Return paymentUrl, atau null kalau Midtrans tidak tersedia / checkout sudah tidak valid
 * (caller memutuskan: checkout awal → biarkan null, buyer retry via /pay; /pay → 503).
 */
export async function initiateSnapPayment(checkoutId: string): Promise<string | null> {
  const checkout = await db.query.checkouts.findFirst({
    where: (c, { eq: eqq }) => eqq(c.id, checkoutId),
    with: { user: true, orders: { with: { items: true } } },
  });
  if (!checkout || checkout.status !== "pending") return null;

  const ttlMs = (checkout.expiresAt?.getTime() ?? Date.now() + CHECKOUT_TTL_MS) - Date.now();
  if (ttlMs <= 0) return null;

  // Sum(price × qty) wajib == grandTotal: item + ongkir − diskon (negatif) per order.
  const items = checkout.orders.flatMap((o) => [
    ...o.items.map((i) => ({
      id: i.variantId,
      price: i.unitPrice,
      quantity: i.quantity,
      name: `${i.productName} (${i.variantName})`,
    })),
    ...(o.shippingCost > 0
      ? [{ id: `shipping-${o.id}`, price: o.shippingCost, quantity: 1, name: `Ongkir ${o.courierCode ?? ""}`.trim() }]
      : []),
    ...(o.discount > 0 ? [{ id: `discount-${o.id}`, price: -o.discount, quantity: 1, name: "Diskon voucher" }] : []),
  ]);

  const snap = await createTransaction({
    orderId: checkout.invoiceNo,
    grossAmount: checkout.grandTotal,
    customerName: checkout.user?.name ?? "Customer",
    customerEmail: checkout.user?.email ?? "",
    items,
    callbackUrl: `${env.WEB_URL.replace(/\/$/, "")}/checkout/${checkout.id}`,
    expiryMinutes: Math.max(1, Math.floor(ttlMs / 60_000)),
  });

  if (!snap) {
    // Mungkin request paralel sudah berhasil menyimpan paymentUrl (Midtrans menolak order_id kembar).
    const fresh = await db.query.checkouts.findFirst({ where: (c, { eq: eqq }) => eqq(c.id, checkoutId) });
    return fresh?.paymentUrl ?? null;
  }

  await db
    .update(schema.checkouts)
    .set({ paymentUrl: snap.redirect_url, paymentReference: snap.token, updatedAt: new Date() })
    .where(and(eq(schema.checkouts.id, checkoutId), eq(schema.checkouts.status, "pending")));
  return snap.redirect_url;
}

/**
 * Sweep checkout `pending` yang sudah lewat expiresAt (+ toleransi) — jaring pengaman kalau
 * webhook `expire` tidak pernah sampai, supaya stok/voucher tidak tertahan selamanya.
 * Aman dijalankan di banyak instance sekaligus (applyPaymentStatus idempotent via row lock).
 */
export async function reconcileStaleCheckouts(log: FastifyBaseLogger): Promise<number> {
  const stale = await db
    .select({
      id: schema.checkouts.id,
      invoiceNo: schema.checkouts.invoiceNo,
      grandTotal: schema.checkouts.grandTotal,
      paymentUrl: schema.checkouts.paymentUrl,
    })
    .from(schema.checkouts)
    .where(
      and(eq(schema.checkouts.status, "pending"), lt(schema.checkouts.expiresAt, new Date(Date.now() - STALE_GRACE_MS))),
    )
    .limit(STALE_BATCH_SIZE);

  let expired = 0;
  for (const checkout of stale) {
    // Snap pernah dibuat → tanya Midtrans dulu (bisa jadi sudah dibayar tapi webhook hilang).
    if (checkout.paymentUrl) {
      const result = await checkTransactionStatus(checkout.invoiceNo);
      if (!result) continue; // Midtrans tidak terjangkau → coba lagi di sweep berikutnya.
      if (result.found) {
        const outcome = await syncCheckoutFromMidtrans(checkout, result.data, log);
        if (outcome !== "pending") continue; // applied/noop/mismatch sudah ditangani.
      }
    }
    // Tidak ada transaksi di Midtrans / masih pending lewat batas → expired lokal.
    if ((await applyPaymentStatus(checkout.id, "expired")) === "applied") expired += 1;
  }
  if (stale.length > 0) log.info({ checked: stale.length, expired }, "[payment] sweep checkout kedaluwarsa selesai");
  return expired;
}
