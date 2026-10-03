"use client";

import type { ErrorResponse } from "@ecommerce/shared";
import { env } from "@/env";

/** Error API dengan status HTTP + kode, supaya UI bisa membedakan 401 (sesi habis) dari error lain. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Query = Record<string, string | number | null | undefined>;

/** Request ke API dengan cookie sesi; query kosong dibuang; error selalu berupa `ApiError` berpesan jelas. */
export async function apiRequest<T>(path: string, init: RequestInit & { query?: Query } = {}): Promise<T> {
  const { query, ...rest } = init;
  const url = new URL(path, env.NEXT_PUBLIC_API_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && String(value) !== "") url.searchParams.set(key, String(value));
  }

  let res: Response;
  try {
    res = await fetch(url, { credentials: "include", ...rest });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Tidak dapat terhubung ke server. Periksa koneksi internet Anda.");
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as ErrorResponse | null)?.error;
    throw new ApiError(res.status, error?.code ?? "UNKNOWN", error?.message ?? `Request gagal (${res.status})`);
  }
  return body as T;
}
