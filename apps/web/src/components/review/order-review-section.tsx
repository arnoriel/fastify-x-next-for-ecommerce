"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { REVIEW_COMMENT_MAX, REVIEW_EDIT_WINDOW_DAYS, type MyReview, type OrderItemView } from "@ecommerce/shared";
import { ErrorBanner } from "@/components/ui/error-banner";
import { formatRelativeTime } from "@/lib/format";
import { ApiError } from "@/lib/http";
import { createReview, getOrderReviews, updateReview } from "@/lib/review-api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { StarDisplay, StarInput } from "./star-rating";

type FormProps = {
  initial: { rating: number; comment: string };
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (value: { rating: number; comment: string }) => void;
  onCancel: () => void;
};

function ReviewForm({ initial, submitLabel, busy, error, onSubmit, onCancel }: FormProps) {
  const uid = useId();
  const [rating, setRating] = useState(initial.rating);
  const [comment, setComment] = useState(initial.comment);
  const [touched, setTouched] = useState(false);

  const ratingMissing = rating < 1;
  return (
    <form
      className="flex flex-col gap-3 pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (ratingMissing || busy) return;
        onSubmit({ rating, comment: comment.trim() });
      }}
    >
      <StarInput value={rating} onChange={setRating} disabled={busy} />
      {touched && ratingMissing && (
        <p role="alert" className="field-error">
          Pilih rating 1–5 bintang terlebih dahulu.
        </p>
      )}
      <div className="field">
        <label htmlFor={`${uid}-comment`}>Ulasan (opsional)</label>
        <textarea
          id={`${uid}-comment`}
          value={comment}
          rows={3}
          maxLength={REVIEW_COMMENT_MAX}
          disabled={busy}
          placeholder="Ceritakan kualitas produk, kesesuaian deskripsi, dan pengemasan..."
          onChange={(e) => setComment(e.target.value)}
        />
        <span className="hint">
          {comment.length}/{REVIEW_COMMENT_MAX}
        </span>
      </div>
      {error && <ErrorBanner message={error} />}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>
          Batal
        </button>
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "Menyimpan..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

type ItemProps = {
  item: OrderItemView;
  review: MyReview | undefined;
  onSaved: (review: MyReview) => void;
  /** Review sudah ada (dibuat di tab lain) → muat ulang daftar dari server. */
  onConflict: () => void;
};

function ReviewItem({ item, review, onSaved, onConflict }: ItemProps) {
  const toMessage = useApiErrorMessage();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(value: { rating: number; comment: string }) {
    setBusy(true);
    setError(null);
    try {
      const saved = review
        ? await updateReview(review.id, { rating: value.rating, comment: value.comment })
        : await createReview(item.id, { rating: value.rating, comment: value.comment });
      onSaved(saved);
      setEditing(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "REVIEW_ALREADY_EXISTS") {
        setEditing(false);
        return onConflict();
      }
      setError(toMessage(err, "Review gagal disimpan. Coba lagi."));
    } finally {
      setBusy(false);
    }
  }

  return (
    // `.card li` memaksa flex + align center; !block + space-y menjaga susunan vertikal biasa.
    <li className="!block space-y-1.5 !py-3">
      <span className="block text-sm font-semibold text-[var(--fg)]">
        {item.productName} <span className="muted small font-normal">({item.variantName})</span>
      </span>

      {!editing && review && (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <StarDisplay rating={review.rating} />
            <span className="muted small">{formatRelativeTime(review.createdAt)}</span>
          </div>
          {review.comment && <p className="m-0 whitespace-pre-wrap break-words text-sm text-[var(--fg)]">{review.comment}</p>}
          {review.canEdit ? (
            <button type="button" className="btn-ghost w-fit !px-3 !py-1.5 text-xs" onClick={() => setEditing(true)}>
              Ubah ulasan
            </button>
          ) : (
            <span className="muted small">Ulasan tidak bisa diubah lagi (lewat {REVIEW_EDIT_WINDOW_DAYS} hari).</span>
          )}
        </div>
      )}

      {!editing && !review && (
        <button type="button" className="btn w-fit !px-4 !py-2 text-sm" onClick={() => setEditing(true)}>
          Beri ulasan
        </button>
      )}

      {editing && (
        <ReviewForm
          initial={{ rating: review?.rating ?? 0, comment: review?.comment ?? "" }}
          submitLabel={review ? "Simpan perubahan" : "Kirim ulasan"}
          busy={busy}
          error={error}
          onSubmit={(value) => void save(value)}
          onCancel={() => {
            setEditing(false);
            setError(null);
          }}
        />
      )}
    </li>
  );
}

/** Review per item di detail pesanan: tampil hanya saat pesanan `completed`. */
export function OrderReviewSection({ orderId, items, enabled }: { orderId: string; items: OrderItemView[]; enabled: boolean }) {
  const toMessage = useApiErrorMessage();
  const toMessageRef = useRef(toMessage);
  useEffect(() => {
    toMessageRef.current = toMessage;
  });

  const [reviews, setReviews] = useState<Record<string, MyReview> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setError(null);
    getOrderReviews(orderId)
      .then((res) => {
        if (!cancelled) setReviews(Object.fromEntries(res.items.map((r) => [r.orderItemId, r])));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toMessageRef.current(err, "Gagal memuat ulasan."));
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, enabled, reloadToken]);

  const handleSaved = useCallback((review: MyReview) => {
    setReviews((prev) => ({ ...(prev ?? {}), [review.orderItemId]: review }));
  }, []);

  if (!enabled) return null;

  const reviewedCount = reviews ? items.filter((i) => reviews[i.id]).length : 0;

  return (
    <section className="card !block !p-4" aria-labelledby={`${orderId}-reviews`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${orderId}-reviews`} className="text-sm font-semibold text-[var(--fg)]">
          Ulasan produk
        </h2>
        {reviews && (
          <span className="muted small">
            {reviewedCount}/{items.length} sudah diulas
          </span>
        )}
      </div>

      {error && (
        <div className="pt-2">
          <ErrorBanner message={error} onRetry={() => setReloadToken((t) => t + 1)} />
        </div>
      )}
      {!error && !reviews && (
        <p className="muted small pt-2" aria-busy="true">
          Memuat ulasan...
        </p>
      )}

      {reviews && (
        <ul className="!m-0 list-none !p-0 !shadow-none">
          {items.map((item) => (
            <ReviewItem
              key={item.id}
              item={item}
              review={reviews[item.id]}
              onSaved={handleSaved}
              onConflict={() => setReloadToken((t) => t + 1)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
