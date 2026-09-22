import { FaMagnifyingGlass, FaTriangleExclamation } from "react-icons/fa6";
import type { ProductListResponse } from "@ecommerce/shared";
import { ProductCard } from "./product-card";

export function ProductGrid({ result }: { result: ProductListResponse | null }) {
  if (result === null) {
    return (
      <div className="glass flex flex-col items-center gap-2 p-10 text-center">
        <FaTriangleExclamation aria-hidden className="text-2xl text-[var(--danger)]" />
        <p className="font-semibold text-[var(--fg)]">Tidak bisa memuat produk</p>
        <p className="text-sm text-[var(--muted)]">Server sedang bermasalah. Coba muat ulang halaman.</p>
      </div>
    );
  }

  if (result.items.length === 0) {
    return (
      <div className="glass flex flex-col items-center gap-2 p-10 text-center">
        <FaMagnifyingGlass aria-hidden className="text-2xl text-[var(--muted)]" />
        <p className="font-semibold text-[var(--fg)]">Produk tidak ditemukan</p>
        <p className="text-sm text-[var(--muted)]">Coba ubah kata kunci atau longgarkan filter.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {result.items.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}