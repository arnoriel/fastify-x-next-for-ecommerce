/**
 * T-07: Midtrans REST v2 — manual integration (tanpa SDK resmi).
 * Sandbox: https://app.sandbox.midtrans.com
 * Production: ganti MIDTRANS_SANDBOX=false di .env
 *
 * Semua amount dalam integer IDR (Rupiah) — Midtrans tidak mendukung desimal.
 * File ini murni "transport + helper" (tanpa akses DB); logika bisnis ada di
 * modules/payment/payment.service.ts.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../env";

// ---------- Config ----------

const SNAP_URL = env.MIDTRANS_SANDBOX
  ? "https://app.sandbox.midtrans.com/snap/v1"
  : "https://app.midtrans.com/snap/v1";

const CORE_URL = env.MIDTRANS_SANDBOX ? "https://api.sandbox.midtrans.com/v2" : "https://api.midtrans.com/v2";

const REQUEST_TIMEOUT_MS = 10_000;
// Batas panjang field item_details Midtrans (id & name).
const ITEM_FIELD_MAX = 50;

/** Basic Auth header dari server key. */
const authHeader = () => "Basic " + Buffer.from(env.MIDTRANS_SERVER_KEY + ":").toString("base64");

// ---------- Types ----------

export type MidtransTransactionStatus =
  | "pending"
  | "capture"
  | "settlement"
  | "deny"
  | "cancel"
  | "expire"
  | "failure"
  | "refund"
  | "partial_refund"
  | "authorize";

/**
 * Payload callback POST webhook Midtrans → /webhook/midtrans.
 * `looseObject`: field tambahan per metode bayar (va_numbers, dst.) dibiarkan lewat.
 * `transaction_status` sengaja z.string() (bukan enum) — status baru dari Midtrans tidak boleh
 * membuat parse gagal → 4xx → Midtrans retry terus; status tak dikenal diabaikan di resolveCheckoutStatus.
 */
export const midtransWebhookSchema = z.looseObject({
  order_id: z.string().min(1), // = checkout.invoiceNo kita
  status_code: z.string().min(1),
  gross_amount: z.string().min(1), // string IDR, mis. "150000.00"
  signature_key: z.string().min(1),
  transaction_status: z.string().min(1),
  transaction_id: z.string().default(""),
  payment_type: z.string().default(""),
  transaction_time: z.string().default(""), // "YYYY-MM-DD HH:MM:SS" (WIB)
  fraud_status: z.string().optional(),
});
export type MidtransWebhookPayload = z.infer<typeof midtransWebhookSchema>;

/** Subset field yang sama-sama ada di webhook & GET status — input tunggal untuk sinkronisasi status. */
export type MidtransTxResult = Pick<
  MidtransWebhookPayload,
  "transaction_status" | "fraud_status" | "payment_type" | "transaction_id" | "transaction_time" | "gross_amount"
>;

/** Response dari Snap /transactions (create payment). */
export interface MidtransSnapResponse {
  token: string;
  redirect_url: string;
}

/** Response GET /v2/{orderId}/status (rekonsiliasi manual). */
export interface MidtransStatusResponse extends MidtransTxResult {
  order_id: string;
  status_code: string;
  status_message: string;
  [key: string]: unknown;
}

/**
 * Hasil cek status:
 * - `null`           → Midtrans tidak terjangkau / error (caller: coba lagi nanti, jangan ubah state)
 * - `found: false`   → transaksi belum ada di Midtrans (buyer belum pilih metode bayar di Snap, atau tidak pernah dibuat)
 */
export type MidtransStatusResult = { found: true; data: MidtransStatusResponse } | { found: false } | null;

// ---------- Helpers ----------

/**
 * Verifikasi signature_key webhook: SHA512(orderId + statusCode + grossAmount + serverKey).
 * Ref: https://docs.midtrans.com/reference/core-api-notification
 * Perbandingan constant-time (timingSafeEqual) mencegah timing attack.
 */
export function verifySignature(p: Pick<MidtransWebhookPayload, "order_id" | "status_code" | "gross_amount" | "signature_key">): boolean {
  const expected = createHash("sha512")
    .update(p.order_id + p.status_code + p.gross_amount + env.MIDTRANS_SERVER_KEY)
    .digest();
  const given = Buffer.from(p.signature_key, "hex");
  return given.length === expected.length && timingSafeEqual(expected, given);
}

/**
 * transaction_status + fraud_status Midtrans → status checkout kita. `null` = belum final.
 * Ref: https://docs.midtrans.com/reference/transaction-status
 *
 * - capture + fraud challenge/deny → tetap pending (tunggu resolusi review fraud).
 * - authorize (pre-auth kartu) / pending / refund / partial_refund / status tak dikenal → belum final.
 */
export function resolveCheckoutStatus(txStatus: string, fraudStatus?: string): "paid" | "failed" | "expired" | null {
  switch (txStatus) {
    case "settlement":
      return "paid";
    case "capture":
      return !fraudStatus || fraudStatus === "accept" ? "paid" : null;
    case "deny":
    case "cancel":
    case "failure":
      return "failed";
    case "expire":
      return "expired";
    default:
      return null;
  }
}

/** transaction_time Midtrans berformat "YYYY-MM-DD HH:MM:SS" dalam WIB (UTC+7), bukan zona server. */
export function parseMidtransTime(value: string): Date {
  const parsed = new Date(`${value.trim().replace(" ", "T")}+07:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** fetch + Basic Auth + timeout. Mengembalikan null kalau network error/timeout (tidak pernah throw). */
async function midtransFetch(url: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await fetch(url, {
      ...init,
      headers: { Accept: "application/json", Authorization: authHeader(), ...init.headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`[midtrans] ${init.method ?? "GET"} ${url} network error:`, err);
    return null;
  }
}

// ---------- API Calls ----------

/**
 * Buat Snap payment transaction → redirect_url untuk dibuka buyer (Snap Redirect).
 * Mengembalikan null (+ log) kalau Midtrans tidak bisa dihubungi / menolak request.
 *
 * Edge cases:
 * - grossAmount < 1 → null (Snap min 1 IDR). Full voucher ditangani di layer service, bukan di sini.
 * - Sum(item price × qty) HARUS sama dengan grossAmount, kalau tidak Midtrans menolak (400).
 * - id/name item dipotong 50 karakter (batas Midtrans).
 * - expiryMinutes menyamakan masa berlaku Snap dengan checkout.expiresAt supaya status `expire`
 *   dari Midtrans sinkron dengan batas waktu internal.
 */
export async function createTransaction(params: {
  orderId: string; // = invoiceNo checkout
  grossAmount: number; // IDR integer
  customerName: string;
  customerEmail: string;
  items: { id: string; price: number; quantity: number; name: string }[];
  callbackUrl?: string; // finish redirect setelah buyer selesai di Snap
  expiryMinutes?: number;
}): Promise<MidtransSnapResponse | null> {
  if (params.grossAmount < 1) return null;

  const body = {
    transaction_details: { order_id: params.orderId, gross_amount: params.grossAmount },
    customer_details: {
      first_name: params.customerName,
      ...(params.customerEmail ? { email: params.customerEmail } : {}),
    },
    item_details: params.items.map((i) => ({
      ...i,
      id: i.id.slice(0, ITEM_FIELD_MAX),
      name: i.name.slice(0, ITEM_FIELD_MAX),
    })),
    ...(params.callbackUrl ? { callbacks: { finish: params.callbackUrl } } : {}),
    ...(params.expiryMinutes ? { expiry: { unit: "minutes", duration: params.expiryMinutes } } : {}),
  };

  const res = await midtransFetch(`${SNAP_URL}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res) return null;

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    console.error(`[midtrans] createTransaction HTTP ${res.status}: ${text}`);
    return null;
  }
  return (await res.json()) as MidtransSnapResponse;
}

/**
 * Cek status transaksi langsung ke Midtrans (rekonsiliasi saat webhook tidak sampai).
 * Catatan: Midtrans membalas transaksi yang belum ada dengan HTTP 404 ATAU HTTP 200 + body
 * status_code "404" — keduanya dipetakan ke `{ found: false }`.
 */
export async function checkTransactionStatus(orderId: string): Promise<MidtransStatusResult> {
  const res = await midtransFetch(`${CORE_URL}/${encodeURIComponent(orderId)}/status`);
  if (!res) return null;
  if (res.status === 404) return { found: false };

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    console.error(`[midtrans] checkStatus HTTP ${res.status}: ${text}`);
    return null;
  }

  const data = (await res.json().catch(() => null)) as MidtransStatusResponse | null;
  if (!data) return null;
  return data.status_code === "404" ? { found: false } : { found: true, data };
}
