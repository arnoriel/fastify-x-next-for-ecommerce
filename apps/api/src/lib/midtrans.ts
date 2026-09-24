/**
 * T-07: Midtrans REST v2 — manual integration (tanpa SDK resmi).
 * Sandbox: https://app.sandbox.midtrans.com
 * Production: ganti MIDTRANS_SANDBOX=false di .env
 *
 * Semua amount dalam integer IDR (Rupiah) — Midtrans tidak mendukung desimal.
 */

import { createHash, createHmac } from "node:crypto";
import { env } from "../env";

// ---------- Config ----------

const BASE_URL = env.MIDTRANS_SANDBOX
  ? "https://app.sandbox.midtrans.com/snap/v1"
  : "https://app.midtrans.com/snap/v1";

const STATUS_BASE_URL = env.MIDTRANS_SANDBOX
  ? "https://api.sandbox.midtrans.com/v2"
  : "https://api.midtrans.com/v2";

/** Basic Auth header dari server key. */
function authHeader(): string {
  return "Basic " + Buffer.from(env.MIDTRANS_SERVER_KEY + ":").toString("base64");
}

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

export type MidtransFraudStatus = "accept" | "challenge" | "deny";

/** Response dari Snap /transactions (create payment). */
export interface MidtransSnapResponse {
  token: string;
  redirect_url: string;
}

/** Payload callback POST webhook dari Midtrans ke /webhook/midtrans. */
export interface MidtransWebhookPayload {
  transaction_id: string;
  order_id: string; // = checkout.invoiceNo kita
  payment_type: string;
  transaction_status: MidtransTransactionStatus;
  fraud_status?: MidtransFraudStatus;
  gross_amount: string; // string IDR, mis. "150000.00"
  signature_key: string;
  status_code: string;
  transaction_time: string; // "YYYY-MM-DD HH:MM:SS"
  currency: string; // "IDR"
  // Bisa ada field tambahan tergantung metode — hanya pakai yang kita perlu.
  [key: string]: unknown;
}

/** Status dari GET /v2/{orderId}/status (untuk rekonsiliasi manual). */
export interface MidtransStatusResponse {
  transaction_id: string;
  order_id: string;
  payment_type: string;
  transaction_status: MidtransTransactionStatus;
  fraud_status?: MidtransFraudStatus;
  gross_amount: string;
  status_code: string;
  status_message: string;
  transaction_time: string;
  currency: string;
  [key: string]: unknown;
}

// ---------- Helpers ----------

/**
 * Verifikasi signature_key webhook dari Midtrans.
 * Formula: SHA512(orderId + statusCode + grossAmount + serverKey)
 *
 * Midtrans mendokumentasikan ini di:
 * https://docs.midtrans.com/reference/core-api-notification
 */
export function verifySignature(payload: MidtransWebhookPayload): boolean {
  const raw = payload.order_id + payload.status_code + payload.gross_amount + env.MIDTRANS_SERVER_KEY;
  const expected = createHash("sha512").update(raw).digest("hex");
  // Constant-time comparison mencegah timing attack.
  if (expected.length !== payload.signature_key.length) return false;
  return createHmac("sha256", "timing").update(expected).digest("hex")
    === createHmac("sha256", "timing").update(payload.signature_key).digest("hex");
}

/**
 * Konversi transaction_status + fraud_status ke checkout status kita.
 *
 * Mapping referensi: https://docs.midtrans.com/reference/transaction-status
 *
 * Edge cases:
 * - "capture" + fraud_status "challenge" → tetap pending sampai ada settlement / accept.
 * - "authorize" → pre-auth (kartu kredit) — anggap pending sampai capture/settlement.
 * - "partial_refund" / "refund" → tetap paid di checkout, status refund diurus admin.
 */
export function resolveCheckoutStatus(
  txStatus: MidtransTransactionStatus,
  fraudStatus?: MidtransFraudStatus,
): "paid" | "failed" | "expired" | null {
  switch (txStatus) {
    case "settlement":
      return "paid";
    case "capture":
      // Capture tanpa fraud review, atau sudah accept → paid.
      if (!fraudStatus || fraudStatus === "accept") return "paid";
      // challenge / deny → tunggu resolusi.
      return null;
    case "deny":
    case "cancel":
    case "failure":
      return "failed";
    case "expire":
      return "expired";
    // pending / authorize / refund / partial_refund → belum final, jangan update status.
    default:
      return null;
  }
}

// ---------- API Calls ----------

/**
 * Buat Snap payment transaction.
 * Mengembalikan redirect_url yang bisa dibuka buyer untuk bayar (Snap Redirect),
 * atau null + log error kalau Midtrans API tidak bisa dihubungi.
 *
 * Edge case: grandTotal = 0 (full voucher) → skip, kembalikan null supaya order bisa
 * langsung `paid` tanpa melewati Midtrans (dihandle di checkout route, bukan di sini).
 */
export async function createTransaction(params: {
  orderId: string; // = invoiceNo checkout
  grossAmount: number; // IDR integer
  customerName: string;
  customerEmail: string;
  items: { id: string; price: number; quantity: number; name: string }[];
  callbackUrl?: string; // optional override finish_redirect_url
}): Promise<MidtransSnapResponse | null> {
  // Snap memerlukan amount >= 1 IDR.
  if (params.grossAmount < 1) return null;

  const body = {
    transaction_details: {
      order_id: params.orderId,
      gross_amount: params.grossAmount,
    },
    customer_details: {
      first_name: params.customerName,
      email: params.customerEmail,
    },
    item_details: params.items,
    callbacks: params.callbackUrl
      ? { finish: params.callbackUrl }
      : undefined,
  };

  try {
    const res = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(),
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      console.error(`[midtrans] createTransaction HTTP ${res.status}: ${text}`);
      return null;
    }

    const data = (await res.json()) as MidtransSnapResponse;
    return data;
  } catch (err) {
    // Network error / timeout — jangan crash server, log dan lanjut.
    console.error("[midtrans] createTransaction network error:", err);
    return null;
  }
}

/**
 * Cek status transaksi dari Midtrans API secara manual (rekonsiliasi).
 * Berguna saat webhook tidak sampai (missed), atau untuk admin panel.
 */
export async function checkTransactionStatus(orderId: string): Promise<MidtransStatusResponse | null> {
  try {
    const res = await fetch(`${STATUS_BASE_URL}/${encodeURIComponent(orderId)}/status`, {
      headers: {
        Authorization: authHeader(),
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      console.error(`[midtrans] checkStatus HTTP ${res.status}: ${text}`);
      return null;
    }

    return (await res.json()) as MidtransStatusResponse;
  } catch (err) {
    console.error("[midtrans] checkStatus network error:", err);
    return null;
  }
}
