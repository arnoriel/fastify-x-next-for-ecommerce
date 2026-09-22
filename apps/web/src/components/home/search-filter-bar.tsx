"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FaFilter, FaMagnifyingGlass, FaStar, FaXmark } from "react-icons/fa6";
import type { Category, ProductSort } from "@ecommerce/shared";

const SORT_OPTIONS: { value: ProductSort; label: string }[] = [
  { value: "relevance", label: "Paling sesuai" },
  { value: "newest", label: "Terbaru" },
  { value: "best_selling", label: "Terlaris" },
  { value: "rating", label: "Rating tertinggi" },
  { value: "price_asc", label: "Harga terendah" },
  { value: "price_desc", label: "Harga tertinggi" },
];

const RATING_OPTIONS = [4, 3, 2, 1] as const;
const DEBOUNCE_MS = 400;

export function SearchFilterBar({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [showFilters, setShowFilters] = useState(false);
  const [searchInput, setSearchInput] = useState(searchParams.get("search") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync input kalau URL berubah dari luar (mis. klik kategori bento).
  useEffect(() => {
    setSearchInput(searchParams.get("search") ?? "");
  }, [searchParams]);

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === "") params.delete(key);
        else params.set(key, value);
      }
      params.delete("page"); // filter berubah = reset ke halaman 1
      startTransition(() => router.push(`${pathname}?${params.toString()}`));
    },
    [pathname, router, searchParams],
  );

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateParams({ search: value.trim() || undefined }), DEBOUNCE_MS);
  }

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const activeCategoryId = searchParams.get("categoryId") ?? "";
  const activeSort = (searchParams.get("sort") as ProductSort | null) ?? "relevance";
  const activeMinRating = searchParams.get("minRating") ?? "";
  const minPrice = searchParams.get("minPrice") ?? "";
  const maxPrice = searchParams.get("maxPrice") ?? "";

  const activeFilterCount = [activeCategoryId, activeMinRating, minPrice, maxPrice].filter(Boolean).length;

  function clearAllFilters() {
    setSearchInput("");
    router.push(pathname);
  }

  return (
    <div className="glass sticky top-3 z-10 flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <div className="clay-inset flex flex-1 items-center gap-2 px-3.5 py-2.5">
          <FaMagnifyingGlass aria-hidden className="shrink-0 text-[var(--muted)]" size={13} />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Cari produk, brand, atau toko..."
            aria-label="Cari produk"
            className="w-full bg-transparent text-sm text-[var(--fg)] outline-none placeholder:text-[var(--muted)]"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className="clay relative flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-[var(--fg)]"
        >
          <FaFilter aria-hidden size={12} />
          Filter
          {activeFilterCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--brand)] text-[0.7rem] font-bold text-[var(--brand-fg)]">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => updateParams({ sort: opt.value === "relevance" ? undefined : opt.value })}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              activeSort === opt.value
                ? "bg-[var(--brand)] text-[var(--brand-fg)]"
                : "clay-inset text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {showFilters && (
        <div className="clay-inset flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="category-select" className="text-xs font-semibold text-[var(--muted)]">
              Kategori
            </label>
            <select
              id="category-select"
              value={activeCategoryId}
              onChange={(e) => updateParams({ categoryId: e.target.value || undefined })}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)]"
            >
              <option value="">Semua kategori</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-[var(--muted)]">Rentang harga (Rp)</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="Min"
                defaultValue={minPrice}
                onBlur={(e) => updateParams({ minPrice: e.target.value || undefined })}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)]"
              />
              <span className="text-[var(--muted)]">–</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="Maks"
                defaultValue={maxPrice}
                onBlur={(e) => updateParams({ maxPrice: e.target.value || undefined })}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)]"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-[var(--muted)]">Rating minimal</span>
            <div className="flex flex-wrap gap-2">
              {RATING_OPTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => updateParams({ minRating: activeMinRating === String(r) ? undefined : String(r) })}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium ${
                    activeMinRating === String(r)
                      ? "bg-[var(--brand)] text-[var(--brand-fg)]"
                      : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]"
                  }`}
                >
                  <FaStar aria-hidden size={10} />
                  {r} ke atas
                </button>
              ))}
            </div>
          </div>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="btn-link inline-flex items-center gap-1 self-start !text-[var(--muted)]"
            >
              <FaXmark aria-hidden size={11} />
              Reset semua filter
            </button>
          )}
        </div>
      )}
    </div>
  );
}