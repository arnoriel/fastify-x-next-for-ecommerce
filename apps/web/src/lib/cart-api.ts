"use client";

import type {
  CartResponse,
  CheckoutView,
  CreateCheckoutInput,
  ErrorResponse,
  ShippingRateRequest,
  ShippingRateResponse,
} from "@ecommerce/shared";
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

function jsonRequest(method: string, path: string, payload?: unknown) {
  return fetch(apiUrl(path), {
    method,
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

export async function getCart(): Promise<CartResponse> {
  return parseOrThrow(await jsonRequest("GET", "/api/cart"));
}

/** T-03 [V3]: kirim guest cart (localStorage) ke backend saat login sukses. */
export async function mergeGuestCart(items: { variantId: string; quantity: number }[]): Promise<CartResponse> {
  return parseOrThrow(await jsonRequest("POST", "/api/cart/merge", { items }));
}

export async function addCartItem(variantId: string, quantity = 1): Promise<CartResponse> {
  return parseOrThrow(await jsonRequest("POST", "/api/cart/items", { variantId, quantity }));
}

export async function updateCartItem(itemId: string, quantity: number): Promise<CartResponse> {
  return parseOrThrow(await jsonRequest("PATCH", `/api/cart/items/${itemId}`, { quantity }));
}

export async function removeCartItem(itemId: string): Promise<CartResponse> {
  return parseOrThrow(await jsonRequest("DELETE", `/api/cart/items/${itemId}`));
}

export async function getShippingRates(input: ShippingRateRequest): Promise<ShippingRateResponse> {
  return parseOrThrow(await jsonRequest("POST", "/api/checkout/shipping-rates", input));
}

export async function submitCheckout(input: CreateCheckoutInput): Promise<CheckoutView> {
  return parseOrThrow(await jsonRequest("POST", "/api/checkout", input));
}

export async function getCheckout(id: string): Promise<CheckoutView> {
  return parseOrThrow(await jsonRequest("GET", `/api/checkout/${id}`));
}
