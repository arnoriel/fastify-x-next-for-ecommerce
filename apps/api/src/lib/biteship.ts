/**
 * T-08: Biteship REST v1 — manual integration (tanpa SDK).
 * Docs: https://biteship.com/id/docs/api/authentication
 *
 * Base URL sama untuk testing & live — mode ditentukan prefix API key (`biteship_test.` / `biteship_live.`).
 * File ini murni "transport + helper" (tanpa akses DB); logika bisnis ada di modules/shipping/*.
 * Semua fungsi API TIDAK PERNAH throw: network error/timeout/non-2xx dikembalikan sebagai hasil gagal,
 * supaya caller yang memutuskan (checkout → 503, webhook → 200/500, sinkron tracking → diam-diam skip).
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../env";

const BASE_URL = "https://api.biteship.com/v1";
const DEFAULT_TIMEOUT_MS = 10_000;

// ---------- Types ----------

export type BiteshipResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number | null; code: number | null; message: string; body: unknown };

export interface BiteshipArea {
  id: string;
  name: string;
  administrative_division_level_1_name?: string;
  administrative_division_level_2_name?: string;
  administrative_division_level_3_name?: string;
  postal_code?: number | string;
}

export interface BiteshipPricing {
  courier_code: string;
  courier_name: string;
  courier_service_code: string;
  courier_service_name: string;
  duration?: string;
  shipment_duration_range?: string;
  shipment_duration_unit?: string;
  price: number;
}

export interface BiteshipOrderItem {
  name: string;
  value: number;
  quantity: number;
  weight: number; // gram
  length?: number; // cm
  width?: number;
  height?: number;
}

export interface BiteshipCreateOrderPayload {
  reference_id: string;
  origin_contact_name: string;
  origin_contact_phone: string;
  origin_address: string;
  origin_postal_code?: number;
  origin_area_id?: string;
  origin_note?: string;
  destination_contact_name: string;
  destination_contact_phone: string;
  destination_address: string;
  destination_postal_code?: number;
  destination_area_id?: string;
  destination_note?: string;
  courier_company: string;
  courier_type: string;
  delivery_type: "now" | "scheduled";
  order_note?: string;
  items: BiteshipOrderItem[];
}

export interface BiteshipOrder {
  id: string;
  status: string;
  price?: number;
  courier?: { tracking_id?: string | null; waybill_id?: string | null; link?: string | null };
}

export interface BiteshipTrackingHistory {
  note?: string | null;
  updated_at: string;
  status: string;
}

export interface BiteshipTracking {
  id: string;
  waybill_id?: string | null;
  link?: string | null;
  status: string;
  history: BiteshipTrackingHistory[];
}

/** Biteship menolak `reference_id` yang sudah pernah dipakai (code 40002060) dan mengembalikan order lamanya. */
const DUPLICATE_REFERENCE_CODE = 40002060;

// ---------- Webhook ----------

/**
 * Payload webhook Biteship (order.status / order.price / order.waybill_id).
 * `looseObject` + hampir semua field opsional: event baru/ping uji dari dashboard tidak boleh membuat
 * parse gagal → 4xx → Biteship menandai webhook error. Event tak dikenal diabaikan di route.
 */
export const biteshipWebhookSchema = z.looseObject({
  event: z.string().default(""),
  order_id: z.string().optional(),
  status: z.string().optional(),
  courier_tracking_id: z.string().nullish(),
  courier_waybill_id: z.string().nullish(),
  courier_link: z.string().nullish(),
});
export type BiteshipWebhookPayload = z.infer<typeof biteshipWebhookSchema>;

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/**
 * Verifikasi shared secret webhook. Biteship dashboard mengizinkan auth custom pada webhook;
 * kita terima secret lewat header `x-webhook-secret` ATAU `Authorization` (raw atau `Bearer <secret>`).
 * Dibandingkan lewat hash SHA-256 + timingSafeEqual (panjang selalu sama, tahan timing attack).
 */
export function verifyWebhookSecret(headers: Record<string, string | string[] | undefined>): boolean {
  const secret = env.BITESHIP_WEBHOOK_SECRET;
  if (!secret) return false;

  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const authorization = first(headers.authorization)?.replace(/^Bearer\s+/i, "");
  const candidates = [first(headers["x-webhook-secret"]), authorization].filter((v): v is string => Boolean(v));

  const expected = sha256(secret);
  return candidates.some((c) => timingSafeEqual(sha256(c), expected));
}

// ---------- HTTP ----------

async function biteshipFetch<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {},
): Promise<BiteshipResult<T>> {
  const method = init.method ?? "GET";
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        // Biteship memakai API key mentah di header authorization (bukan Basic/Bearer).
        authorization: env.BITESHIP_API_KEY ?? "",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`[biteship] ${method} ${path} network error:`, err);
    return { ok: false, status: null, code: null, message: "Biteship tidak dapat dihubungi.", body: null };
  }

  const body = (await res.json().catch(() => null)) as (Record<string, unknown> & { success?: boolean }) | null;
  if (!res.ok || !body || body.success === false) {
    const message = typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
    const code = typeof body?.code === "number" ? body.code : null;
    console.error(`[biteship] ${method} ${path} gagal (${res.status}${code ? `/${code}` : ""}): ${message}`);
    return { ok: false, status: res.status, code, message, body };
  }
  return { ok: true, data: body as T };
}

// ---------- API Calls ----------

/** Cari area (kecamatan) untuk mendapatkan area_id. `type=single` = 1 hasil per kecamatan+kode pos. */
export async function searchAreas(input: string): Promise<BiteshipArea[] | null> {
  const params = new URLSearchParams({ countries: "ID", input, type: "single" });
  const res = await biteshipFetch<{ areas?: BiteshipArea[] }>(`/maps/areas?${params}`, { timeoutMs: 5_000 });
  return res.ok ? (res.data.areas ?? []) : null;
}

/**
 * Rate multi-kurir by area id (akurasi tertinggi). Area-id rate TIDAK mengembalikan kurir instant
 * (GoSend/Grab butuh koordinat) — karena itu hanya kurir standar yang diminta.
 * Return null = Biteship gagal; array kosong = tidak ada layanan untuk rute tersebut.
 */
export async function fetchRates(params: {
  originAreaId: string;
  destinationAreaId: string;
  couriers: string[];
  weightGram: number;
}): Promise<BiteshipPricing[] | null> {
  const res = await biteshipFetch<{ pricing?: BiteshipPricing[] }>("/rates/couriers", {
    method: "POST",
    body: {
      origin_area_id: params.originAreaId,
      destination_area_id: params.destinationAreaId,
      couriers: params.couriers.join(","),
      // Harga rate tidak bergantung pada `value` selama tanpa asuransi/COD (price = shipping_fee + fee opsional),
      // tapi field ini wajib di API → nilai nominal.
      items: [{ name: "Paket", value: 1, quantity: 1, weight: Math.max(1, Math.round(params.weightGram)) }],
    },
  });
  return res.ok ? (res.data.pricing ?? []) : null;
}

export type CreateOrderResult =
  | { ok: true; order: BiteshipOrder }
  | { ok: false; reason: "duplicate"; existingOrderId: string | null }
  | { ok: false; reason: "error"; message: string };

/** Buat order pengiriman (kurir akan pickup). `reference_id` unik → dipakai sebagai idempotency. */
export async function createOrder(payload: BiteshipCreateOrderPayload): Promise<CreateOrderResult> {
  const res = await biteshipFetch<BiteshipOrder>("/orders", { method: "POST", body: payload });
  if (res.ok) return { ok: true, order: res.data };

  if (res.code === DUPLICATE_REFERENCE_CODE) {
    const details = (res.body as { details?: { order_id?: string } } | null)?.details;
    return { ok: false, reason: "duplicate", existingOrderId: details?.order_id ?? null };
  }
  return { ok: false, reason: "error", message: res.message };
}

/** Ambil order yang sudah ada (adopsi saat `reference_id` duplikat, mis. crash setelah booking sukses sebelum DB commit). */
export async function fetchOrder(orderId: string): Promise<BiteshipOrder | null> {
  const res = await biteshipFetch<BiteshipOrder>(`/orders/${encodeURIComponent(orderId)}`, { timeoutMs: 5_000 });
  return res.ok ? res.data : null;
}

/** Tracking + histori resi (GET /v1/trackings/:id). Null = gagal/timeout (caller skip, bukan error). */
export async function fetchTracking(trackingId: string, timeoutMs = 3_000): Promise<BiteshipTracking | null> {
  const res = await biteshipFetch<BiteshipTracking>(`/trackings/${encodeURIComponent(trackingId)}`, { timeoutMs });
  return res.ok ? { ...res.data, history: res.data.history ?? [] } : null;
}
