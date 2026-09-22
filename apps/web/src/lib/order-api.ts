"use client";

import type { ErrorResponse, ListOrdersQuery, OrderDetail, OrderListResponse } from "@ecommerce/shared";
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

export async function listOrders(query: Partial<ListOrdersQuery> = {}): Promise<OrderListResponse> {
  const url = new URL(apiUrl("/api/orders"));
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && String(value) !== "") url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, { credentials: "include" });
  return parseOrThrow(res);
}

export async function getOrder(id: string): Promise<OrderDetail> {
  const res = await fetch(apiUrl(`/api/orders/${id}`), { credentials: "include" });
  return parseOrThrow(res);
}

export async function confirmOrderReceived(id: string): Promise<OrderDetail> {
  const res = await fetch(apiUrl(`/api/orders/${id}/confirm`), { method: "POST", credentials: "include" });
  return parseOrThrow(res);
}