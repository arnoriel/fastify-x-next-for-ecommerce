"use client";

import {
  wishlistIdsSchema,
  wishlistResponseSchema,
  type ListWishlistQuery,
  type WishlistResponse,
} from "@ecommerce/shared";
import { apiRequest } from "@/lib/http";

export async function listWishlist(query: Partial<ListWishlistQuery> = {}): Promise<WishlistResponse> {
  return wishlistResponseSchema.parse(await apiRequest("/api/wishlist", { query }));
}

export async function getWishlistIds(): Promise<string[]> {
  return wishlistIdsSchema.parse(await apiRequest("/api/wishlist/ids")).ids;
}

// Idempoten: PUT = pasti ada, DELETE = pasti tidak ada.
export async function addToWishlist(productId: string): Promise<void> {
  await apiRequest(`/api/wishlist/${encodeURIComponent(productId)}`, { method: "PUT" });
}

export async function removeFromWishlist(productId: string): Promise<void> {
  await apiRequest(`/api/wishlist/${encodeURIComponent(productId)}`, { method: "DELETE" });
}
