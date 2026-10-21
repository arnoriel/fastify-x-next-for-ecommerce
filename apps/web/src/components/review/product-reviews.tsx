"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Review, ReviewSummary } from "@ecommerce/shared";
import { ErrorBanner } from "@/components/ui/error-banner";
import { formatRelativeTime } from "@/lib/format";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { listProductReviews } from "@/lib/review-api";
import { StarDisplay } from "./star-rating";

const PAGE_SIZE = 10;
const STAR_ROWS = [5, 4, 3, 2, 1] as const;

function ReviewRow({ review }: { review: Review }) {
  return (
    <li className="flex flex-col gap-1.5 border-t border-[var(--border)] py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StarDisplay rating={review.rating} size={12} />
        <span className="text-xs font-semibold text-[var(--fg)]">{review.authorName}</span>
        <span className="muted small">
          {formatRelativeTime(review.createdAt)}
          {review.edited ? " · diubah" : ""}
        </span>
      </div>
      {review.comment ? (
        <p className="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--fg)]">{review.comment}</p>
      ) : (
        <p className="muted small">Tanpa komentar.</p>
      )}
    </li>
  );
}

/** Ringkasan rating + daftar review publik halaman produk (filter bintang, muat lebih banyak). */
export function ProductReviews({ slug }: { slug: string }) {
  const toMessage = useApiErrorMessage();
  const toMessageRef = useRef(toMessage);
  useEffect(() => {
    toMessageRef.current = toMessage;
  });

  const [filter, setFilter] = useState<number | null>(null);
  const [items, setItems] = useState<Review[]>([]);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Ganti filter / muat halaman berikutnya. Respons basi (filter diganti cepat) diabaikan.
  const requestId = useRef(0);
  const load = useCallback(
    async (nextPage: number, rating: number | null) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const res = await listProductReviews(slug, { page: nextPage, pageSize: PAGE_SIZE, rating: rating ?? undefined });
        if (id !== requestId.current) return;
        setItems((prev) => (nextPage === 1 ? res.items : [...prev, ...res.items.filter((r) => !prev.some((p) => p.id === r.id))]));
        setSummary(res.summary);
        setTotal(res.total);
        setPage(nextPage);
      } catch (err) {
        if (id !== requestId.current) return;
        setError(toMessageRef.current(err, "Gagal memuat review."));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [slug],
  );

  useEffect(() => {
    void load(1, filter);
  }, [load, filter, reloadToken]);

  const hasMore = items.length < total;
  const count = summary?.count ?? 0;

  return (
    <section id="reviews" className="glass flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="reviews-title">
      <h2 id="reviews-title" className="text-base font-extrabold tracking-tight text-[var(--fg)]">
        Ulasan pembeli
      </h2>

      {summary && count > 0 && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex flex-col items-center gap-1 sm:w-32">
            <span className="text-3xl font-extrabold text-[var(--fg)]">{summary.average.toFixed(1)}</span>
            <StarDisplay rating={summary.average} size={14} />
            <span className="muted small">{count} ulasan</span>
          </div>
          <div className="flex flex-1 flex-col gap-1" role="group" aria-label="Filter berdasarkan bintang">
            {STAR_ROWS.map((star) => {
              const n = summary.distribution[star - 1] ?? 0;
              const active = filter === star;
              return (
                <button
                  key={star}
                  type="button"
                  aria-pressed={active}
                  disabled={n === 0}
                  onClick={() => setFilter(active ? null : star)}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-1.5 py-0.5 text-xs disabled:cursor-default disabled:opacity-50 ${
                    active ? "bg-[var(--surface)] font-bold text-[var(--fg)]" : "text-[var(--muted)]"
                  }`}
                >
                  <span className="w-12 text-left">{star} bintang</span>
                  <span className="clay-inset h-2 flex-1 overflow-hidden !rounded-full">
                    <span className="block h-full bg-amber-400" style={{ width: `${count ? (n / count) * 100 : 0}%` }} />
                  </span>
                  <span className="w-8 text-right">{n}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={() => setReloadToken((t) => t + 1)} />}

      {!error && loading && items.length === 0 && (
        <p className="muted small" aria-busy="true">
          Memuat ulasan...
        </p>
      )}

      {!error && !loading && items.length === 0 && (
        <p className="muted small">
          {filter ? `Belum ada ulasan dengan ${filter} bintang.` : "Belum ada ulasan. Ulasan muncul setelah pembeli menyelesaikan pesanannya."}
        </p>
      )}

      {items.length > 0 && (
        <ul className="!m-0 list-none !p-0 !shadow-none">
          {items.map((review) => (
            <ReviewRow key={review.id} review={review} />
          ))}
        </ul>
      )}

      {filter && (
        <button type="button" className="btn-ghost w-fit !px-3 !py-1.5 text-xs" onClick={() => setFilter(null)}>
          Tampilkan semua ulasan
        </button>
      )}

      {hasMore && !error && (
        <button type="button" className="btn-ghost w-fit self-center" disabled={loading} onClick={() => void load(page + 1, filter)}>
          {loading ? "Memuat..." : "Muat ulasan lainnya"}
        </button>
      )}
    </section>
  );
}
