"use client";

import { useId, useRef } from "react";
import { FaRegStar, FaStar } from "react-icons/fa6";

const STARS = [1, 2, 3, 4, 5] as const;

/** Bintang statis (tampilan). `rating` boleh desimal — dibulatkan ke bintang terdekat. */
export function StarDisplay({ rating, size = 13 }: { rating: number; size?: number }) {
  const filled = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`Rating ${rating} dari 5`}>
      {STARS.map((n) =>
        n <= filled ? (
          <FaStar key={n} aria-hidden className="text-amber-400" size={size} />
        ) : (
          <FaRegStar key={n} aria-hidden className="text-[var(--border-strong)]" size={size} />
        ),
      )}
    </span>
  );
}

const RATING_LABELS: Record<number, string> = { 1: "Sangat buruk", 2: "Buruk", 3: "Cukup", 4: "Bagus", 5: "Sangat bagus" };
export const ratingLabel = (rating: number) => RATING_LABELS[rating] ?? "";

/** Pemilih rating 1–5 (radiogroup): bisa dipakai keyboard (panah/Home/End) dan pembaca layar. */
export function StarInput({
  value,
  onChange,
  disabled = false,
  label = "Rating",
}: {
  value: number;
  onChange: (rating: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function move(next: number) {
    const clamped = Math.min(5, Math.max(1, next));
    onChange(clamped);
    refs.current[clamped - 1]?.focus();
  }

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-xs font-semibold text-[var(--fg)]">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="flex items-center gap-1">
        {STARS.map((n) => (
          <button
            key={n}
            ref={(el) => {
              refs.current[n - 1] = el;
            }}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} bintang — ${RATING_LABELS[n]}`}
            // Roving tabindex: satu tab stop; sebelum memilih, bintang pertama yang fokus.
            tabIndex={value === n || (value === 0 && n === 1) ? 0 : -1}
            disabled={disabled}
            className="cursor-pointer border-0 bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => onChange(n)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                e.preventDefault();
                move((value || 0) + 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                e.preventDefault();
                move((value || 2) - 1);
              } else if (e.key === "Home") {
                e.preventDefault();
                move(1);
              } else if (e.key === "End") {
                e.preventDefault();
                move(5);
              }
            }}
          >
            {n <= value ? (
              <FaStar aria-hidden className="text-amber-400" size={26} />
            ) : (
              <FaRegStar aria-hidden className="text-[var(--border-strong)]" size={26} />
            )}
          </button>
        ))}
        {value > 0 && <span className="ml-2 text-xs text-[var(--muted)]">{RATING_LABELS[value]}</span>}
      </div>
    </div>
  );
}
