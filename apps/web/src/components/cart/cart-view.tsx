"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import { FaCartShopping, FaMinus, FaPlus, FaTrash, FaTriangleExclamation } from "react-icons/fa6";
import { formatRupiah } from "@/lib/format";
import { useCartStore } from "@/lib/cart-store";

const FALLBACK_IMAGE = "/product-placeholder.svg";

export function CartView() {
  const { cart, loading, error, hasLoaded, refresh, updateQuantity, remove } = useCartStore();

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!hasLoaded) {
    return <p className="muted">Memuat keranjang...</p>;
  }

  if (error && !cart) {
    return (
      <div className="alert">
        <FaTriangleExclamation aria-hidden />
        <span>{error}</span>
      </div>
    );
  }

  const groups = cart?.groups ?? [];
  const availableSubtotal = groups.reduce(
    (sum, g) => sum + g.items.filter((i) => i.isAvailable).reduce((s, i) => s + i.subtotal, 0),
    0,
  );
  const hasUnavailable = groups.some((g) => g.items.some((i) => !i.isAvailable));
  const canCheckout = groups.length > 0 && !groups.every((g) => g.items.every((i) => !i.isAvailable));

  if (groups.length === 0) {
    return (
      <div className="glass flex flex-col items-center gap-2 p-10 text-center">
        <FaCartShopping aria-hidden className="text-2xl text-[var(--muted)]" />
        <p className="font-semibold text-[var(--fg)]">Keranjang Anda kosong</p>
        <Link href="/" className="btn mt-2">
          Mulai belanja
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">Keranjang</h1>

      {hasUnavailable && (
        <div className="alert">
          <FaTriangleExclamation aria-hidden />
          <span>Beberapa item tidak tersedia (stok habis/produk dinonaktifkan). Hapus item tersebut untuk melanjutkan checkout.</span>
        </div>
      )}
      {error && (
        <div className="alert">
          <FaTriangleExclamation aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {groups.map((group) => (
        <div key={group.sellerId} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Link href={`/seller/${group.sellerSlug}`} className="font-semibold text-[var(--fg)] hover:underline">
              {group.sellerName}
            </Link>
            <span className="muted small">{formatRupiah(group.subtotal)}</span>
          </div>

          <ul className="card">
            {group.items.map((item) => (
              <li key={item.id} className="!items-start">
                <div className="flex flex-1 items-start gap-3">
                  <div className="clay-inset relative h-16 w-16 shrink-0 overflow-hidden">
                    <Image
                      src={item.imageUrl ?? FALLBACK_IMAGE}
                      alt={item.productName}
                      fill
                      sizes="64px"
                      className="object-cover"
                      unoptimized={!item.imageUrl}
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Link
                      href={`/product/${item.productSlug}`}
                      className="line-clamp-2 text-sm font-medium text-[var(--fg)] hover:underline"
                    >
                      {item.productName}
                    </Link>
                    <span className="muted small">{item.variantName}</span>
                    {!item.isAvailable && (
                      <span className="text-xs font-medium text-[var(--danger)]">
                        {item.stock === 0 ? "Stok habis" : `Stok tersisa ${item.stock}`}
                      </span>
                    )}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="btn-ghost !p-1.5"
                          aria-label="Kurangi jumlah"
                          disabled={loading || item.quantity <= 1}
                          onClick={() => void updateQuantity(item.id, item.quantity - 1)}
                        >
                          <FaMinus size={10} />
                        </button>
                        <span className="w-8 text-center text-sm">{item.quantity}</span>
                        <button
                          type="button"
                          className="btn-ghost !p-1.5"
                          aria-label="Tambah jumlah"
                          disabled={loading || item.quantity >= item.stock}
                          onClick={() => void updateQuantity(item.id, item.quantity + 1)}
                        >
                          <FaPlus size={10} />
                        </button>
                      </div>
                      <span className="text-sm font-semibold text-[var(--fg)]">{formatRupiah(item.subtotal)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-link"
                    aria-label="Hapus item"
                    disabled={loading}
                    onClick={() => void remove(item.id)}
                  >
                    <FaTrash size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="card flex items-center justify-between">
        <div>
          <p className="muted small">Subtotal ({groups.reduce((s, g) => s + g.items.filter((i) => i.isAvailable).length, 0)} item)</p>
          <p className="text-lg font-bold text-[var(--fg)]">{formatRupiah(availableSubtotal)}</p>
        </div>
        <Link
          href="/checkout"
          className="btn"
          aria-disabled={!canCheckout}
          onClick={(e) => {
            if (!canCheckout) e.preventDefault();
          }}
        >
          Checkout
        </Link>
      </div>
    </div>
  );
}
