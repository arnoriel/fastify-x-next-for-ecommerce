"use client";

import { create } from "zustand";
import { ApiError } from "@/lib/http";
import { addToWishlist, getWishlistIds, removeFromWishlist } from "@/lib/wishlist-api";

type Status = "idle" | "loading" | "ready" | "error" | "unauthorized";
export type WishlistResult = { ok: true } | { ok: false; reason: "unauthorized" } | { ok: false; reason: "error"; message: string };

interface WishlistState {
  /** Id produk di wishlist user — satu sumber untuk semua ikon hati di halaman. */
  ids: Set<string>;
  status: Status;
  /** Produk yang request-nya sedang berjalan (klik ganda diabaikan, bukan dikirim dua kali). */
  pending: Set<string>;
  ensureLoaded: () => Promise<void>;
  setWishlisted: (productId: string, wanted: boolean) => Promise<WishlistResult>;
}

const without = (set: Set<string>, id: string) => {
  const next = new Set(set);
  next.delete(id);
  return next;
};
const withId = (set: Set<string>, id: string) => new Set(set).add(id);

/**
 * Cache in-memory (server = sumber kebenaran). Dimuat sekali per sesi tab lewat `ensureLoaded()`;
 * perubahan optimistik, dikembalikan bila request gagal.
 */
export const useWishlistStore = create<WishlistState>((set, get) => ({
  ids: new Set(),
  status: "idle",
  pending: new Set(),

  ensureLoaded: async () => {
    const { status } = get();
    if (status === "loading" || status === "ready" || status === "unauthorized") return;
    set({ status: "loading" });
    try {
      set({ ids: new Set(await getWishlistIds()), status: "ready" });
    } catch (err) {
      set({ status: err instanceof ApiError && err.status === 401 ? "unauthorized" : "error" });
    }
  },

  setWishlisted: async (productId, wanted) => {
    if (get().pending.has(productId)) return { ok: true };
    set((s) => ({
      pending: withId(s.pending, productId),
      ids: wanted ? withId(s.ids, productId) : without(s.ids, productId),
    }));
    try {
      if (wanted) await addToWishlist(productId);
      else await removeFromWishlist(productId);
      return { ok: true };
    } catch (err) {
      // Kembalikan tampilan ke keadaan sebelum klik.
      set((s) => ({ ids: wanted ? without(s.ids, productId) : withId(s.ids, productId) }));
      if (err instanceof ApiError && err.status === 401) {
        set({ status: "unauthorized" });
        return { ok: false, reason: "unauthorized" };
      }
      return { ok: false, reason: "error", message: err instanceof Error ? err.message : "Gagal memperbarui wishlist." };
    } finally {
      set((s) => ({ pending: without(s.pending, productId) }));
    }
  },
}));
