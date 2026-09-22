"use client";

import type { Address, CreateAddressInput, ErrorResponse } from "@ecommerce/shared";
import { env } from "@/env";

async function parseOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) {
    const err = body as ErrorResponse;
    throw new Error(err.error?.message ?? `Request gagal (${res.status})`);
  }
  return body as T;
}

function apiUrl(path: string) {
  return new URL(path, env.NEXT_PUBLIC_API_URL).toString();
}

export async function listAddresses(): Promise<Address[]> {
  const res = await fetch(apiUrl("/api/addresses"), { credentials: "include" });
  const data = await parseOrThrow<{ items: Address[] }>(res);
  return data.items;
}

export async function createAddress(input: CreateAddressInput): Promise<Address> {
  const res = await fetch(apiUrl("/api/addresses"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseOrThrow<Address>(res);
}
