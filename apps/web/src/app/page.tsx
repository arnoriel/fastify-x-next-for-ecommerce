import Link from "next/link";
import type { ProductSort } from "@ecommerce/shared";
import { CategoryBento } from "@/components/home/category-bento";
import { ProductGrid } from "@/components/home/product-grid";
import { SearchFilterBar } from "@/components/home/search-filter-bar";
import { getCategories, getProducts } from "@/lib/api";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const VALID_SORTS = new Set<ProductSort>(["relevance", "newest", "price_asc", "price_desc", "rating", "best_selling"]);

function toNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const sort = VALID_SORTS.has(params.sort as ProductSort) ? (params.sort as ProductSort) : "relevance";
  const minPrice = toNumber(params.minPrice);
  const maxPrice = toNumber(params.maxPrice);
  // Edge case: minPrice > maxPrice dari URL manual — jangan kirim ke API (400), abaikan maxPrice.
  const safeMaxPrice = minPrice !== undefined && maxPrice !== undefined && maxPrice < minPrice ? undefined : maxPrice;

  const [user, categories, products] = await Promise.all([
    getSession(),
    getCategories(),
    getProducts({
      search: params.search,
      categoryId: params.categoryId,
      minPrice,
      maxPrice: safeMaxPrice,
      minRating: toNumber(params.minRating),
      sort,
      pageSize: 24,
    }),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)] sm:text-2xl">Ecommerce</h1>
          <p className="muted small">Marketplace multi-vendor</p>
        </div>
        <nav className="nav !mt-0 shrink-0">
          <Link href="/cart" className="btn-ghost">
            Keranjang
          </Link>
          {user ? (
            <Link href="/account" className="btn-ghost">
              {user.name}
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn-ghost">
                Masuk
              </Link>
              <Link href="/register" className="btn">
                Daftar
              </Link>
            </>
          )}
        </nav>
      </header>

      <CategoryBento categories={categories} />

      <SearchFilterBar categories={categories} />

      <ProductGrid result={products} />
    </main>
  );
}
