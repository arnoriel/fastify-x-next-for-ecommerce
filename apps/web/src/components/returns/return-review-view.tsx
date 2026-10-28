"use client";

import Link from "next/link";
import { useCallback, useId, useState } from "react";
import {
  ORDER_STATUS_LABELS,
  RETURN_NOTE_MAX,
  RETURN_NOTE_MIN,
  RETURN_REASON_LABELS,
  RETURN_STATUS_LABELS,
} from "@ecommerce/shared";
import { ErrorBanner } from "@/components/ui/error-banner";
import { formatDateTime, formatRupiah } from "@/lib/format";
import {
  completeReturnRefund,
  getAdminReturn,
  getSellerReturn,
  reviewAdminReturn,
  reviewSellerReturn,
} from "@/lib/return-api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useRemoteData } from "@/lib/use-remote-data";

type Mode = "seller" | "admin";

const DEFAULT_APPROVE_NOTE = "Retur disetujui. Refund diproses sesuai kebijakan toko.";

export function ReturnReviewView({ mode, returnId }: { mode: Mode; returnId: string }) {
  const uid = useId();
  const toMessage = useApiErrorMessage();
  const fetcher = useCallback(
    () => (mode === "admin" ? getAdminReturn(returnId) : getSellerReturn(returnId)),
    [mode, returnId],
  );
  const { data, error, retry, reload } = useRemoteData(fetcher, { errorMessage: "Gagal memuat pengajuan retur." });

  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [refundNote, setRefundNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | "refund" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function review(decision: "approve" | "reject") {
    if (!data || busy) return;
    const trimmed = note.trim();
    if (decision === "reject" && trimmed.length < RETURN_NOTE_MIN) {
      return setActionError(`Alasan penolakan minimal ${RETURN_NOTE_MIN} karakter.`);
    }
    const finalNote = trimmed.length >= RETURN_NOTE_MIN ? trimmed : DEFAULT_APPROVE_NOTE;

    setBusy(decision);
    setActionError(null);
    try {
      if (mode === "admin") await reviewAdminReturn(data.id, decision, finalNote);
      else await reviewSellerReturn(data.id, decision, finalNote);
      setNote("");
      reload();
    } catch (err) {
      setActionError(toMessage(err, "Gagal memproses retur."));
    } finally {
      setBusy(null);
    }
  }

  async function completeRefund() {
    if (!data || busy) return;
    if (reference.trim().length < 3) return setActionError("Isi referensi refund minimal 3 karakter.");
    setBusy("refund");
    setActionError(null);
    try {
      await completeReturnRefund(data.id, {
        reference: reference.trim(),
        note: refundNote.trim() || undefined,
      });
      setReference("");
      setRefundNote("");
      reload();
    } catch (err) {
      setActionError(toMessage(err, "Gagal menandai refund selesai."));
    } finally {
      setBusy(null);
    }
  }

  const backHref = mode === "admin" ? "/admin/refunds" : "/seller/orders?tab=returns";

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorBanner message={error} onRetry={retry} />
        <Link href={backHref} className="btn-ghost w-fit">
          Kembali
        </Link>
      </div>
    );
  }
  if (!data) return <p className="muted" aria-busy="true">Memuat pengajuan retur...</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">Retur {data.returnNo}</h1>
          <span className="muted small">
            Diajukan {formatDateTime(data.requestedAt)} · {RETURN_STATUS_LABELS[data.status]}
          </span>
        </div>
        <Link href={backHref} className="btn-ghost">
          Kembali
        </Link>
      </div>

      <section className="card !block !p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-sm font-bold text-[var(--fg)]">{data.order.orderNo}</span>
            <span className="muted small">{data.order.storeName}</span>
          </div>
          <span className="pill">{ORDER_STATUS_LABELS[data.order.status]}</span>
        </div>
        <ul className="!m-0 mt-3 flex flex-col gap-1 !p-0 !shadow-none">
          {data.order.items.map((item, index) => (
            <li key={index} className="!block !border-t-0 !p-0 text-sm">
              {item.productName} ({item.variantName}) × {item.quantity}
            </li>
          ))}
        </ul>
        {mode === "admin" && (
          <p className="muted small mt-2">
            Pembeli: {data.order.buyerName ?? "Guest"} {data.order.buyerEmail ? `· ${data.order.buyerEmail}` : ""}
          </p>
        )}
      </section>

      <section className="card !block !p-4">
        <h2 className="text-sm font-semibold text-[var(--fg)]">Alasan retur</h2>
        <p className="muted small mt-1">{RETURN_REASON_LABELS[data.reason]}</p>
        <p className="text-sm mt-2 whitespace-pre-wrap">{data.description}</p>
        {data.evidenceUrls.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {data.evidenceUrls.map((url) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt="Foto bukti retur"
                  className="h-24 w-24 rounded-[var(--radius-sm)] border border-[var(--border)] object-cover"
                />
              </a>
            ))}
          </div>
        )}
      </section>

      <section className="card !block !p-4">
        <h2 className="text-sm font-semibold text-[var(--fg)]">Refund</h2>
        <p className="text-sm mt-1">Nominal: {formatRupiah(data.amount)}</p>
        {data.refundBank ? (
          <p className="muted small mt-1">
            Tujuan: {data.refundBank.bankName} · {data.refundBank.accountNumber} ·{" "}
            {data.refundBank.accountHolder}
          </p>
        ) : (
          <p className="muted small mt-1">Data rekening hanya terlihat oleh admin.</p>
        )}
        {data.resolutionNote && <p className="muted small mt-2">Catatan: {data.resolutionNote}</p>}
        {data.refundReference && <p className="muted small mt-1">Referensi: {data.refundReference}</p>}
        {data.status === "approved" && mode === "seller" && (
          <p className="muted small mt-2">Menunggu admin mengeksekusi refund ke rekening pembeli.</p>
        )}
      </section>

      {actionError && <ErrorBanner message={actionError} />}

      {data.canReview && (
        <section className="card !block !p-4">
          <h2 className="text-sm font-semibold text-[var(--fg)]">Keputusan</h2>
          <div className="field mt-2">
            <label htmlFor={`${uid}-note`}>Catatan (wajib untuk penolakan)</label>
            <textarea
              id={`${uid}-note`}
              rows={3}
              maxLength={RETURN_NOTE_MAX}
              value={note}
              disabled={busy !== null}
              placeholder="Jelaskan pertimbangan keputusan retur."
              onChange={(e) => {
                setNote(e.target.value);
                setActionError(null);
              }}
            />
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="btn-ghost"
              disabled={busy !== null}
              onClick={() => void review("reject")}
            >
              {busy === "reject" ? "Menolak..." : "Tolak retur"}
            </button>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => void review("approve")}>
              {busy === "approve" ? "Menyetujui..." : "Setujui retur"}
            </button>
          </div>
        </section>
      )}

      {data.status === "approved" && mode === "admin" && (
        <section className="card !block !p-4">
          <h2 className="text-sm font-semibold text-[var(--fg)]">Refund manual</h2>
          <p className="muted small mt-1">
            Setelah dana benar-benar dikirim ke rekening pembeli, catat referensi transaksi di sini.
          </p>
          <div className="field mt-2">
            <label htmlFor={`${uid}-reference`}>Referensi refund</label>
            <input
              id={`${uid}-reference`}
              value={reference}
              maxLength={120}
              disabled={busy !== null}
              placeholder="mis. nomor transaksi bank / Midtrans"
              onChange={(e) => {
                setReference(e.target.value);
                setActionError(null);
              }}
            />
          </div>
          <div className="field mt-2">
            <label htmlFor={`${uid}-refund-note`}>Catatan (opsional)</label>
            <input
              id={`${uid}-refund-note`}
              value={refundNote}
              maxLength={RETURN_NOTE_MAX}
              disabled={busy !== null}
              onChange={(e) => setRefundNote(e.target.value)}
            />
          </div>
          <button type="button" className="btn mt-3" disabled={busy !== null} onClick={() => void completeRefund()}>
            {busy === "refund" ? "Menyimpan..." : "Tandai refund selesai"}
          </button>
        </section>
      )}

      {data.status === "refunded" && (
        <p className="glass p-4 text-sm font-semibold text-[var(--up)]">Refund sudah selesai diproses.</p>
      )}
    </div>
  );
}
