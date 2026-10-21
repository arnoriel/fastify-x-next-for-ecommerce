"use client";

import Link from "next/link";
import { useCallback, useEffect } from "react";
import { FaRegHeart } from "react-icons/fa6";
import { ProductCard } from "@/components/home/product-card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Pagination } from "@/components/ui/pagination";
import { usePaged } from "@/lib/use-paged";
import { useRemoteData } from "@/lib/use-remote-data";
import { listWishlist } from "@/lib/wishlist-api";

const PAGE_SIZE = 12;

/** Halaman wishlist. Ikon hati di kartu bisa dimatikan (kartu tetap tampil sampai halaman dimuat ulang — salah klik bisa dibatalkan). */
export function WishlistView() {
  const [page, setPage] = usePaged("wishlist");
  const fetcher = useCallback(() => listWishlist({ page, pageSize: PAGE_SIZE }), [page]);
  const { data, error, retry } = useRemoteData(fetcher, { errorMessage: "Gagal memuat wishlist." });

  // Halaman terakhir menjadi kosong (item dihapus di tab lain) → mundur ke halaman yang masih ada.
  useEffect(() => {
    if (data && data.items.length === 0 && data.page > 1) setPage(Math.ceil(data.total / data.pageSize));
  }, [data, setPage]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">Wishlist</h1>
        {data && data.total > 0 && <span className="muted small">{data.total} produk</span>}
      </div>

      {error && <ErrorBanner message={error} onRetry={retry} />}
      {!error && !data && (
        <p className="muted" aria-busy="true">
          Memuat wishlist...
        </p>
      )}

      {data && data.items.length === 0 && !error && (
        <div className="glass flex flex-col items-center gap-2 p-8 text-center">
          <FaRegHeart aria-hidden className="text-2xl text-[var(--muted)]" />
          <p className="font-semibold text-[var(--fg)]">Wishlist masih kosong</p>
          <p className="muted small">Tekan ikon hati di produk yang kamu suka untuk menyimpannya di sini.</p>
          <Link href="/" className="btn-ghost mt-1">
            Jelajahi produk
          </Link>
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.items.map((item) => (
              <div key={item.product.id} className="flex flex-col gap-1.5">
                <ProductCard product={item.product} loggedIn />
                {!item.available && <span className="pill w-fit !text-[0.7rem]">Stok habis / tidak tersedia</span>}
              </div>
            ))}
          </div>
          <Pagination page={data.page} total={data.total} pageSize={data.pageSize} onChange={setPage} />
        </>
      )}
    </div>
  );
}
