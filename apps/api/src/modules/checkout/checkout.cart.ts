import { db } from "../../db";

export type CartItemWithVariant = Awaited<ReturnType<typeof loadCartForCheckout>>[number];

/** Cart item milik user, join varian+produk+seller — dipakai rate ongkir, voucher, dan create checkout. */
export async function loadCartForCheckout(userId: string) {
  const cart = await db.query.carts.findFirst({ where: (c, { eq: eqq }) => eqq(c.userId, userId) });
  if (!cart) return [];
  return db.query.cartItems.findMany({
    where: (ci, { eq: eqq }) => eqq(ci.cartId, cart.id),
    with: { variant: { with: { product: { with: { seller: true } } } } },
  });
}

/** Kelompokkan item cart per seller, hitung berat total (gram) untuk rate ongkir. */
export function groupBySeller(items: CartItemWithVariant[]) {
  const bySeller = new Map<string, { sellerId: string; items: typeof items; weightGram: number }>();
  for (const item of items) {
    const product = item.variant?.product;
    const seller = product?.seller;
    if (!product || !seller) continue;
    const entry = bySeller.get(seller.id) ?? { sellerId: seller.id, items: [], weightGram: 0 };
    entry.items.push(item);
    const unitWeight = item.variant!.weightGram ?? product.weightGram;
    entry.weightGram += unitWeight * item.quantity;
    bySeller.set(seller.id, entry);
  }
  return bySeller;
}

/** Aturan yang sama dengan `isAvailable` di cart: hanya item tersedia yang dihitung ke subtotal. */
export function isCartItemAvailable(item: CartItemWithVariant): boolean {
  const variant = item.variant;
  const product = variant?.product;
  return Boolean(variant && product && variant.isActive && product.status === "active" && !product.deletedAt && variant.stock >= item.quantity);
}

/** Subtotal item tersedia per seller + total — basis perhitungan voucher di luar transaksi checkout. */
export function summarizeCart(items: CartItemWithVariant[]) {
  const bySeller = new Map<string, { sellerId: string; sellerName: string; subtotal: number }>();
  let total = 0;
  for (const item of items) {
    const seller = item.variant?.product?.seller;
    if (!seller || !isCartItemAvailable(item)) continue;
    const line = item.variant!.price * item.quantity;
    const entry = bySeller.get(seller.id) ?? { sellerId: seller.id, sellerName: seller.storeName, subtotal: 0 };
    entry.subtotal += line;
    bySeller.set(seller.id, entry);
    total += line;
  }
  return { bySeller, total };
}
