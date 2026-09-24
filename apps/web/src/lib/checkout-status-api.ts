"use client";

import type { CheckoutView, ErrorResponse } from "@ecommerce/shared";
import { env } from "@/env";

function apiUrl(path: string) {
  return new URL(path, env.NEXT_PUBLIC_API_URL).toString();
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) {
    const err = body as ErrorResponse;
    throw new Error(err.error?.message ?? `Request gagal (${res.status})`);
  }
  return body as T;
}

/** Dipoll berkala oleh halaman status pembayaran (T-06B) sampai status jadi final. */
export async function pollCheckout(id: string): Promise<CheckoutView> {
  const res = await fetch(apiUrl(`/api/checkout/${id}`), { credentials: "include" });
  return parseOrThrow(res);
}

/**
 * Inisiasi / retry pembayaran Midtrans Snap (T-07).
 * Dipanggil kalau checkout dibuat tapi paymentUrl masih null (Midtrans sempat down),
 * atau buyer ingin membuka ulang halaman bayar.
 */
export async function initiatePayment(checkoutId: string): Promise<{ status: string; paymentUrl: string | null }> {
  const res = await fetch(apiUrl(`/api/checkout/${checkoutId}/pay`), {
    method: "POST",
    credentials: "include",
  });
  return parseOrThrow(res);
}

/**
 * Manual status check dari Midtrans API langsung (fallback rekonsiliasi).
 * Dipakai sebagai fallback kalau polling /api/checkout/:id tidak menangkap perubahan
 * karena webhook tidak sampai (dev tanpa tunnel).
 */
export async function manualCheckStatus(checkoutId: string): Promise<{ status: string; paymentUrl: string | null }> {
  const res = await fetch(apiUrl(`/api/checkout/${checkoutId}/status`), { credentials: "include" });
  return parseOrThrow(res);
}
