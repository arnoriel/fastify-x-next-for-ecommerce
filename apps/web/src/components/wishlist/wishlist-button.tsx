"use client";

import { useRouter } from "next/navigation";
import { type MouseEvent as ReactMouseEvent, useEffect, useState } from "react";
import { FaHeart, FaRegHeart } from "react-icons/fa6";
import { withFeature } from "@/lib/features";
import { useWishlistStore } from "@/lib/wishlist-store";

type Props = {
  productId: string;
  /** Dari session server. Guest → klik mengarahkan ke login (tanpa request API). */
  loggedIn: boolean;
  /** card = ikon bulat di atas gambar kartu; detail = tombol berlabel di halaman produk. */
  variant?: "card" | "detail";
  className?: string;
};

function WishlistButtonImpl({ productId, loggedIn, variant = "card", className = "" }: Props) {
  const router = useRouter();
  const ensureLoaded = useWishlistStore((s) => s.ensureLoaded);
  const setWishlisted = useWishlistStore((s) => s.setWishlisted);
  const status = useWishlistStore((s) => s.status);
  const active = useWishlistStore((s) => s.ids.has(productId));
  const busy = useWishlistStore((s) => s.pending.has(productId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loggedIn) void ensureLoaded();
  }, [loggedIn, ensureLoaded]);

  const goToLogin = () => {
    const next = `${window.location.pathname}${window.location.search}`;
    router.push(`/login?next=${encodeURIComponent(next)}`);
  };

  async function handleClick(e: ReactMouseEvent) {
    // Tombol berada di atas kartu yang berupa link: jangan ikut membuka halaman produk.
    e.preventDefault();
    e.stopPropagation();
    if (!loggedIn || status === "unauthorized") return goToLogin();
    if (status === "error") await ensureLoaded();
    setError(null);
    const result = await setWishlisted(productId, !active);
    if (result.ok) return;
    if (result.reason === "unauthorized") goToLogin();
    else setError(result.message);
  }

  const label = active ? "Hapus dari wishlist" : "Simpan ke wishlist";
  const loading = loggedIn && status === "loading";
  const Icon = active ? FaHeart : FaRegHeart;

  if (variant === "card") {
    return (
      <>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          title={error ?? label}
          disabled={loading || busy}
          onClick={(e) => void handleClick(e)}
          className={`grid size-9 cursor-pointer place-items-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-md transition-transform hover:scale-105 disabled:cursor-wait disabled:opacity-60 ${
            active ? "text-[var(--brand)]" : "text-[var(--fg)]"
          } ${className}`}
        >
          <Icon aria-hidden size={15} />
        </button>
        {error && (
          <span role="alert" className="sr-only">
            {error}
          </span>
        )}
      </>
    );
  }

  return (
    <div className={`flex flex-col items-end gap-1 ${className}`}>
      <button
        type="button"
        aria-pressed={active}
        disabled={loading || busy}
        onClick={(e) => void handleClick(e)}
        className={`btn-ghost inline-flex shrink-0 items-center gap-2 !px-3 !py-2 text-xs ${active ? "!text-[var(--brand)]" : ""}`}
      >
        <Icon aria-hidden size={14} />
        {active ? "Tersimpan" : "Simpan"}
      </button>
      {error && (
        <span role="alert" className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}

/** Fitur wishlist nonaktif → tombol hilang & ID wishlist tidak dimuat dari API. */
export const WishlistButton = withFeature("wishlist", WishlistButtonImpl);
