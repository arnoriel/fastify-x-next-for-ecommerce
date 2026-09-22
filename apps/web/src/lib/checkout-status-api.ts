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
