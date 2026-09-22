"use client";

const STORAGE_KEY = "guest_cart_v1";

export interface GuestCartItem {
  variantId: string;
  quantity: number;
}

/** Baca guest cart dari localStorage. `[]` kalau kosong/corrupt/server-side. */
export function readGuestCart(): GuestCartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is GuestCartItem =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as GuestCartItem).variantId === "string" &&
        typeof (item as GuestCartItem).quantity === "number",
    );
  } catch {
    return [];
  }
}

function writeGuestCart(items: GuestCartItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // localStorage penuh/disabled (mode privat) — guest cart hilang, bukan fatal.
  }
}

/** Tambah 1 varian ke guest cart. Item sama → qty dijumlahkan. */
export function addGuestCartItem(variantId: string, quantity = 1) {
  const items = readGuestCart();
  const existing = items.find((i) => i.variantId === variantId);
  if (existing) existing.quantity += quantity;
  else items.push({ variantId, quantity });
  writeGuestCart(items);
}

/** Kosongkan guest cart — dipanggil setelah berhasil di-merge ke akun saat login. */
export function clearGuestCart() {
  writeGuestCart([]);
}

export function hasGuestCartItems(): boolean {
  return readGuestCart().length > 0;
}
