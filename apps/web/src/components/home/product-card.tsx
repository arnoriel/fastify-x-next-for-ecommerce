import Image from "next/image";
import Link from "next/link";
import { FaStar } from "react-icons/fa6";
import type { ProductWithVariants } from "@ecommerce/shared";
import { formatCompactCount, formatRupiah } from "@/lib/format";

const FALLBACK_IMAGE = "/product-placeholder.svg";

export function ProductCard({ product }: { product: ProductWithVariants }) {
  const thumbnail = product.images[0] ?? FALLBACK_IMAGE;
  const hasRating = product.ratingCount > 0;

  return (
    <Link
      href={`/product/${product.slug}`}
      className="clay group flex flex-col overflow-hidden p-2.5 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
    >
      <div className="clay-inset relative aspect-square w-full overflow-hidden">
        <Image
          src={thumbnail}
          alt={product.name}
          fill
          sizes="(max-width: 640px) 45vw, (max-width: 1024px) 25vw, 220px"
          className="object-cover transition-transform duration-300 group-hover:scale-105"
          unoptimized={thumbnail === FALLBACK_IMAGE}
        />
      </div>
      <div className="flex flex-1 flex-col gap-1 px-1 pt-2.5">
        <p className="line-clamp-2 min-h-[2.5em] text-[0.82rem] leading-tight text-[var(--fg)]">{product.name}</p>
        <p className="text-[0.95rem] font-bold text-[var(--fg)]">{formatRupiah(product.minPrice)}</p>
        <div className="flex items-center gap-1 text-[0.72rem] text-[var(--muted)]">
          {hasRating ? (
            <>
              <FaStar aria-hidden className="text-amber-400" size={11} />
              <span>{product.ratingAvg.toFixed(1)}</span>
              <span aria-hidden>·</span>
            </>
          ) : (
            <span>Baru</span>
          )}
          <span>{formatCompactCount(product.soldCount)} terjual</span>
        </div>
      </div>
    </Link>
  );
}