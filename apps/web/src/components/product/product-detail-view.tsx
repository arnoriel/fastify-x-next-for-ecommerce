"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { FaCartPlus, FaStar, FaTriangleExclamation } from "react-icons/fa6";
import type { ProductWithVariants, Variant } from "@ecommerce/shared";
import { formatCompactCount, formatRupiah } from "@/lib/format";
import { useCartStore, type CartState } from "@/lib/cart-store";

const FALLBACK_IMAGE = "/product-placeholder.svg";

/** true kalau setidaknya satu varian aktif punya stok — dasar untuk state "stok habis semua". */
function hasAnyPurchasableVariant(variants: Variant[]): boolean {
  return variants.some((v) => v.isActive && v.stock > 0);
}

export function ProductDetailView({ product }: { product: ProductWithVariants }) {
  const router = useRouter();
  const add = useCartStore((s: CartState) => s.add);

  // Edge case: hanya tampilkan varian aktif; kalau seller nonaktifkan semua, purchasable = false.
  const purchasableVariants = useMemo(() => product.variants.filter((v) => v.isActive), [product.variants]);
  const anyPurchasable = hasAnyPurchasableVariant(product.variants);

  // Edge case: 1 varian saja → auto-select, jangan paksa user memilih.
  const [selectedId, setSelectedId] = useState<string | null>(
    purchasableVariants.length === 1 ? (purchasableVariants[0]?.id ?? null) : null,
  );
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const selected = purchasableVariants.find((v) => v.id === selectedId) ?? null;
  const images = product.images.length > 0 ? product.images : [FALLBACK_IMAGE];
  const [activeImage, setActiveImage] = useState(0);
  const hasRating = product.ratingCount > 0;
  const hasAttributes = Object.keys(product.attributes).length > 0;
  const currentImage = images[activeImage] ?? images[0] ?? FALLBACK_IMAGE;

  async function handleAddToCart() {
    if (!selected) {
      setStatus("error");
      setMessage("Pilih varian terlebih dahulu.");
      return;
    }
    setStatus("loading");
    setMessage(null);
    try {
      await add(selected.id, 1);
      setStatus("done");
      setTimeout(() => setStatus("idle"), 1500);
    } catch (err) {
      // Edge case: belum login → backend balas 401. Arahkan ke login+next, jangan tampilkan raw error.
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("401") || /unauthor/i.test(msg)) {
        router.push(`/login?next=${encodeURIComponent(`/product/${product.slug}`)}`);
        return;
      }
      setStatus("error");
      setMessage(msg || "Gagal menambah ke keranjang.");
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:items-start">
      <div className="clay flex flex-col gap-3 p-3">
        <div className="clay-inset relative aspect-square w-full overflow-hidden">
          <Image
            src={currentImage}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 100vw, 500px"
            className="object-cover"
            unoptimized={currentImage === FALLBACK_IMAGE}
            priority
          />
        </div>
        {images.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
            {images.map((src, i) => (
              <button
                key={src + i}
                type="button"
                onClick={() => setActiveImage(i)}
                aria-label={`Gambar ${i + 1}`}
                aria-current={i === activeImage}
                className={`clay-inset relative h-16 w-16 shrink-0 overflow-hidden transition-shadow ${
                  i === activeImage ? "ring-2 ring-[var(--brand)]" : ""
                }`}
              >
                <Image src={src} alt="" fill sizes="64px" className="object-cover" unoptimized={src === FALLBACK_IMAGE} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="glass flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-extrabold leading-tight tracking-tight text-[var(--fg)] sm:text-2xl">
            {product.name}
          </h1>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-[var(--muted)]">
            {hasRating ? (
              <>
                <FaStar aria-hidden className="text-amber-400" size={13} />
                <span className="font-medium text-[var(--fg)]">{product.ratingAvg.toFixed(1)}</span>
                <span>({product.ratingCount} rating)</span>
              </>
            ) : (
              <span>Belum ada rating</span>
            )}
            <span aria-hidden className="text-[var(--border-strong)]">
              ·
            </span>
            <span>{formatCompactCount(product.soldCount)} terjual</span>
          </div>
        </div>

        <div className="clay-inset flex flex-col gap-4 p-4">
          <p className="text-2xl font-bold text-[var(--fg)] sm:text-[1.75rem]">
            {formatRupiah(selected ? selected.price : product.minPrice)}
          </p>

          {!anyPurchasable ? (
            <div className="alert !mt-0">
              <FaTriangleExclamation aria-hidden />
              <span>Stok produk ini sedang habis.</span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Pilih varian
              </span>
              <div className="flex flex-wrap gap-2">
                {purchasableVariants.map((v) => {
                  const outOfStock = v.stock === 0;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      disabled={outOfStock}
                      onClick={() => setSelectedId(v.id)}
                      aria-pressed={selectedId === v.id}
                      className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                        selectedId === v.id
                          ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--brand-fg)]"
                          : "border-[var(--border-strong)] bg-[var(--card)] text-[var(--fg)] hover:border-[var(--brand)]"
                      }`}
                    >
                      {v.name}
                      {outOfStock ? " (habis)" : ""}
                    </button>
                  );
                })}
              </div>
              {selected && selected.stock <= 5 && (
                <span className="text-xs font-medium text-[var(--danger)]">Sisa stok: {selected.stock}</span>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              className="btn flex w-full items-center justify-center gap-2 !rounded-2xl !border-[var(--brand)] !bg-[var(--brand)] !py-3.5 !text-[0.95rem] !text-[var(--brand-fg)]"
              disabled={!anyPurchasable || status === "loading"}
              onClick={() => void handleAddToCart()}
            >
              <FaCartPlus aria-hidden />
              {status === "loading" ? "Menambahkan..." : status === "done" ? "Ditambahkan!" : "Tambah ke keranjang"}
            </button>
            {message && <span className="field-error">{message}</span>}
          </div>
        </div>

        {product.description && (
          <div className="flex flex-col gap-1.5">
            <h2 className="text-sm font-semibold text-[var(--fg)]">Deskripsi</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--muted)]">{product.description}</p>
          </div>
        )}

        {hasAttributes && (
          <div className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-4">
            <h2 className="text-sm font-semibold text-[var(--fg)]">Spesifikasi</h2>
            <dl className="kv">
              {Object.entries(product.attributes).map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="capitalize">{key.replace(/_/g, " ")}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}