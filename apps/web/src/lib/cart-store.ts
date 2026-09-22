"use client";

import { create } from "zustand";
import type { CartResponse } from "@ecommerce/shared";
import { addCartItem, getCart, removeCartItem, updateCartItem } from "@/lib/cart-api";

export interface CartState {
  cart: CartResponse | null;
  loading: boolean;
  error: string | null;
  hasLoaded: boolean;
  refresh: () => Promise<void>;
  add: (variantId: string, quantity?: number) => Promise<void>;
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  remove: (itemId: string) => Promise<void>;
}

/**
 * Cart TIDAK persist ke localStorage/sessionStorage — backend (Postgres) adalah satu-satunya
 * sumber kebenaran (PRD: "Cart persist antar sesi"). Store ini murni cache in-memory supaya
 * komponen lain (badge jumlah item, dsb) bisa reaktif tanpa refetch berulang.
 */
export const useCartStore = create<CartState>((set, get) => ({
  cart: null,
  loading: false,
  error: null,
  hasLoaded: false,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const cart = await getCart();
      set({ cart, loading: false, hasLoaded: true });
    } catch (err) {
      set({ loading: false, hasLoaded: true, error: err instanceof Error ? err.message : "Gagal memuat keranjang." });
    }
  },

  add: async (variantId, quantity = 1) => {
    set({ loading: true, error: null });
    try {
      const cart = await addCartItem(variantId, quantity);
      set({ cart, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : "Gagal menambah ke keranjang." });
      throw err;
    }
  },

  updateQuantity: async (itemId, quantity) => {
    const prev = get().cart;
    set({ loading: true, error: null });
    try {
      const cart = await updateCartItem(itemId, quantity);
      set({ cart, loading: false });
    } catch (err) {
      set({ loading: false, cart: prev, error: err instanceof Error ? err.message : "Gagal mengubah jumlah." });
      throw err;
    }
  },

  remove: async (itemId) => {
    set({ loading: true, error: null });
    try {
      const cart = await removeCartItem(itemId);
      set({ cart, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : "Gagal menghapus item." });
      throw err;
    }
  },
}));