"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useId, useState } from "react";
import {
  DISPUTE_DESCRIPTION_MAX,
  DISPUTE_DESCRIPTION_MIN,
  DISPUTE_REASONS_BY_ROLE,
  DISPUTE_REASON_LABELS,
  DISPUTE_WINDOW_DAYS,
  type DisputeEligibility,
  type DisputeReason,
  ORDER_STATUS_LABELS,
} from "@ecommerce/shared";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ApiError } from "@/lib/http";
import { createDispute, getDisputeEligibility } from "@/lib/dispute-api";
import { formatRupiah } from "@/lib/format";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useRemoteData } from "@/lib/use-remote-data";

function OrderSummary({ eligibility }: { eligibility: DisputeEligibility }) {
  const { order } = eligibility;
  return (
    <section className="card !block !p-4" aria-label="Pesanan yang dilaporkan">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold text-[var(--fg)]">{order.orderNo}</span>
        <span className="pill">{ORDER_STATUS_LABELS[order.status]}</span>
      </div>
      <ul className="!m-0 mt-2 flex flex-col gap-1 !p-0 !shadow-none">
        {order.items.map((i, idx) => (
          <li key={idx} className="!block !border-t-0 !p-0 text-sm">
            {i.productName} ({i.variantName}) × {i.quantity}
          </li>
        ))}
      </ul>
      <p className="muted small mt-2">
        {eligibility.role === "buyer" ? "Toko" : "Pembeli"}: {eligibility.counterpartName} · Total {formatRupiah(order.total)}
      </p>
    </section>
  );
}

export function DisputeForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const toMessage = useApiErrorMessage();
  const uid = useId();
  const fetcher = useCallback(() => getDisputeEligibility(orderId), [orderId]);
  const { data, error, retry } = useRemoteData(fetcher, { errorMessage: "Gagal memuat data pesanan." });

  const [reason, setReason] = useState<DisputeReason | "">("");
  const [description, setDescription] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const backHref = data?.role === "seller" ? "/seller/orders" : `/orders/${encodeURIComponent(orderId)}`;

  async function submit() {
    if (!data || submitting) return;
    if (!reason) return setFieldError("Pilih alasan laporan.");
    if (description.trim().length < DISPUTE_DESCRIPTION_MIN) {
      return setFieldError(`Jelaskan masalahnya minimal ${DISPUTE_DESCRIPTION_MIN} karakter agar admin bisa menilai dengan tepat.`);
    }
    setSubmitting(true);
    setFieldError(null);
    setSubmitError(null);
    try {
      const created = await createDispute({ orderId, reason, description: description.trim() });
      router.replace(`/disputes/${created.id}`);
      // Tombol tetap nonaktif sampai halaman berpindah — cegah kirim ganda.
    } catch (err) {
      setSubmitError(toMessage(err, "Laporan gagal dikirim. Coba lagi."));
      // Tiket baru saja dibuat di tab/perangkat lain → muat ulang supaya muncul tautan "Lihat laporan".
      if (err instanceof ApiError && err.code === "DISPUTE_ALREADY_OPEN") void retry();
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorBanner message={error} onRetry={retry} />
        <Link href="/orders" className="btn-ghost w-fit">
          Kembali ke pesanan
        </Link>
      </div>
    );
  }
  if (!data) return <p className="muted" aria-busy="true">Memuat data pesanan...</p>;

  const { dispute } = data;

  if (dispute.activeId) {
    return (
      <section className="glass flex flex-col items-center gap-3 p-8 text-center">
        <h1 className="text-lg font-extrabold text-[var(--fg)]">Sudah ada laporan aktif</h1>
        <p className="text-sm text-[var(--muted)]">Pesanan ini sudah punya laporan yang sedang ditangani. Lanjutkan percakapan di tiket tersebut.</p>
        <Link href={`/disputes/${dispute.activeId}`} className="btn">
          Buka laporan
        </Link>
      </section>
    );
  }

  if (!dispute.canOpen) {
    return (
      <div className="flex flex-col gap-3">
        <OrderSummary eligibility={data} />
        <section className="glass flex flex-col items-center gap-3 p-8 text-center">
          <h1 className="text-lg font-extrabold text-[var(--fg)]">Pesanan ini belum bisa dilaporkan</h1>
          <p className="text-sm text-[var(--muted)]">{dispute.blockedReason ?? "Pesanan ini tidak memenuhi syarat untuk dilaporkan."}</p>
          <Link href={backHref} className="btn-ghost">
            Kembali
          </Link>
        </section>
      </div>
    );
  }

  const reasons = DISPUTE_REASONS_BY_ROLE[data.role];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">Laporkan masalah</h1>
        <p className="muted small">
          Laporan dilihat oleh {data.role === "buyer" ? "penjual" : "pembeli"} dan admin. Bila pesanan sudah selesai, laporan bisa dibuat sampai {DISPUTE_WINDOW_DAYS} hari setelahnya.
        </p>
      </div>

      <OrderSummary eligibility={data} />

      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor={`${uid}-reason`}>Alasan</label>
          <select
            id={`${uid}-reason`}
            value={reason}
            disabled={submitting}
            aria-invalid={fieldError && !reason ? true : undefined}
            onChange={(e) => {
              setReason(e.target.value as DisputeReason);
              setFieldError(null);
            }}
          >
            <option value="" disabled>
              Pilih alasan
            </option>
            {reasons.map((r) => (
              <option key={r} value={r}>
                {DISPUTE_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`${uid}-desc`}>Ceritakan masalahnya</label>
          <textarea
            id={`${uid}-desc`}
            value={description}
            rows={6}
            maxLength={DISPUTE_DESCRIPTION_MAX}
            disabled={submitting}
            aria-invalid={fieldError && description.trim().length < DISPUTE_DESCRIPTION_MIN ? true : undefined}
            placeholder="Apa yang terjadi, kapan, dan apa yang Anda harapkan? Sertakan detail yang membantu admin menilai."
            onChange={(e) => {
              setDescription(e.target.value);
              setFieldError(null);
            }}
          />
          <span className="hint">
            {description.trim().length}/{DISPUTE_DESCRIPTION_MAX} (minimal {DISPUTE_DESCRIPTION_MIN})
          </span>
        </div>

        {fieldError && (
          <p role="alert" className="field-error">
            {fieldError}
          </p>
        )}
        {submitError && <ErrorBanner message={submitError} />}

        <div className="flex flex-wrap justify-end gap-2">
          <Link href={backHref} className="btn-ghost" aria-disabled={submitting}>
            Batal
          </Link>
          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? "Mengirim..." : "Kirim laporan"}
          </button>
        </div>
      </form>
    </div>
  );
}
