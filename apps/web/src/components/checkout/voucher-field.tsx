"use client";

import { useId, useState } from "react";
import { FaCircleCheck, FaTicket } from "react-icons/fa6";
import type { AvailableVoucher, VoucherPreview } from "@ecommerce/shared";
import { formatRupiah } from "@/lib/format";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { validateVoucher } from "@/lib/voucher-api";

const MAX_SUGGESTIONS = 3;

type Props = {
  label: string;
  /** Terisi = kolom voucher toko; kosong = kolom voucher platform. */
  sellerId?: string;
  /** Voucher yang sudah lolos validasi dan akan dikirim saat checkout. */
  applied: VoucherPreview | null;
  /** Voucher yang bisa dipilih (sudah difilter untuk kolom ini). */
  suggestions: AvailableVoucher[];
  /** Pesan dari induk (mis. voucher dari draft ternyata sudah tidak berlaku). */
  externalError?: string | null;
  disabled?: boolean;
  onApplied: (preview: VoucherPreview) => void;
  onRemoved: () => void;
};

/**
 * Input + pilih voucher di halaman checkout. Kode divalidasi server terhadap keranjang SAAT INI
 * sebelum dipakai (pesan jelas bila kedaluwarsa / kuota habis / belum memenuhi minimal belanja);
 * hanya voucher yang lolos yang dikirim saat checkout, dan server tetap memvalidasi ulang.
 */
export function VoucherField({ label, sellerId, applied, suggestions, externalError, disabled = false, onApplied, onRemoved }: Props) {
  const uid = useId();
  const toMessage = useApiErrorMessage();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(rawCode: string) {
    const code = rawCode.trim();
    if (!code || busy) return;
    setBusy(true);
    setError(null);
    try {
      const preview = await validateVoucher({ code, sellerId });
      setText("");
      onApplied(preview);
    } catch (err) {
      setError(toMessage(err, "Voucher gagal diperiksa. Coba lagi."));
    } finally {
      setBusy(false);
    }
  }

  const shownError = error ?? externalError ?? null;
  const shown = suggestions.filter((s) => s.code.toUpperCase() !== applied?.code.toUpperCase()).slice(0, MAX_SUGGESTIONS);

  return (
    <div className="flex flex-col gap-2 pt-2">
      <span className="text-xs font-semibold text-[var(--fg)]">{label}</span>

      {applied ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--up)] bg-[color-mix(in_srgb,var(--up)_10%,transparent)] px-3 py-2"
        >
          <span className="flex min-w-0 items-start gap-2 text-sm text-[var(--up)]">
            <FaCircleCheck aria-hidden className="mt-0.5 shrink-0" />
            <span className="flex min-w-0 flex-col">
              <span className="font-bold">
                {applied.code} · hemat {formatRupiah(applied.discount)}
              </span>
              <span className="small !text-[var(--muted)]">{applied.title}</span>
            </span>
          </span>
          <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" disabled={disabled} onClick={onRemoved}>
            Hapus
          </button>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <div className="field min-w-0 flex-1">
            <label htmlFor={`${uid}-code`} className="sr-only">
              {label}
            </label>
            <input
              id={`${uid}-code`}
              value={text}
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={50}
              placeholder="Masukkan kode voucher"
              aria-invalid={shownError ? true : undefined}
              aria-describedby={shownError ? `${uid}-error` : undefined}
              disabled={disabled || busy}
              onChange={(e) => {
                setText(e.target.value.toUpperCase());
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void apply(text);
                }
              }}
            />
          </div>
          <button type="button" className="btn !px-4" disabled={disabled || busy || text.trim().length === 0} onClick={() => void apply(text)}>
            {busy ? "Memeriksa..." : "Pakai"}
          </button>
        </div>
      )}

      {shownError && (
        <p id={`${uid}-error`} role="alert" className="field-error">
          {shownError}
        </p>
      )}

      {!applied && shown.length > 0 && (
        <ul className="!m-0 flex list-none flex-col gap-1.5 !p-0 !shadow-none" aria-label="Voucher tersedia">
          {shown.map((v) => (
            <li key={v.code} className="!block !border-t-0 !p-0">
              <button
                type="button"
                disabled={!v.eligible || disabled || busy}
                onClick={() => void apply(v.code)}
                className="clay-inset flex w-full cursor-pointer items-center gap-2.5 border-0 px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FaTicket aria-hidden className="shrink-0 text-[var(--brand)]" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-xs font-bold text-[var(--fg)]">{v.code}</span>
                  <span className="muted small">{v.title}</span>
                  {v.ineligibleReason && <span className="small text-[var(--danger)]">{v.ineligibleReason}</span>}
                </span>
                {v.eligible && <span className="shrink-0 text-xs font-semibold text-[var(--up)]">Hemat {formatRupiah(v.estimatedDiscount)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
