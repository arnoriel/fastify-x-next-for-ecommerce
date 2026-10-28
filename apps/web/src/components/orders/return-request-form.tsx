"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useId, useRef, useState } from "react";
import {
  ORDER_STATUS_LABELS,
  RETURN_DESCRIPTION_MAX,
  RETURN_DESCRIPTION_MIN,
  RETURN_EVIDENCE_MAX,
  RETURN_REASON_LABELS,
  RETURN_REASONS,
  RETURN_STATUS_LABELS,
  type ReturnReason,
} from "@ecommerce/shared";
import { ErrorBanner } from "@/components/ui/error-banner";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { createReturn, uploadReturnEvidence } from "@/lib/return-api";
import { getOrder } from "@/lib/order-api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useRemoteData } from "@/lib/use-remote-data";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

export function ReturnRequestForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const toMessage = useApiErrorMessage();
  const uid = useId();
  const fetcher = useCallback(() => getOrder(orderId), [orderId]);
  const { data: order, error, retry } = useRemoteData(fetcher, { errorMessage: "Gagal memuat data pesanan." });

  const [reason, setReason] = useState<ReturnReason | "">("");
  const [description, setDescription] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = RETURN_EVIDENCE_MAX - evidenceUrls.length;
    if (room <= 0) return setFieldError(`Maksimal ${RETURN_EVIDENCE_MAX} foto bukti.`);

    setUploading(true);
    setFieldError(null);
    try {
      for (const file of Array.from(files).slice(0, room)) {
        if (!ALLOWED_MIME.includes(file.type)) throw new Error("Foto bukti harus JPG, PNG, atau WEBP.");
        if (file.size > MAX_BYTES) throw new Error("Ukuran tiap foto maksimal 5MB.");
        const url = await uploadReturnEvidence(orderId, file);
        setEvidenceUrls((prev) => [...prev, url]);
      }
    } catch (err) {
      setFieldError(err instanceof Error ? err.message : "Upload foto gagal.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submit() {
    if (!order || submitting || uploading) return;
    if (!reason) return setFieldError("Pilih alasan retur.");
    if (description.trim().length < RETURN_DESCRIPTION_MIN) {
      return setFieldError(`Jelaskan alasan retur minimal ${RETURN_DESCRIPTION_MIN} karakter.`);
    }
    if (bankName.trim().length < 3 || accountHolder.trim().length < 3) {
      return setFieldError("Isi nama bank dan nama pemilik rekening dengan lengkap.");
    }
    if (!/^[0-9]{6,30}$/.test(accountNumber.trim())) {
      return setFieldError("Nomor rekening harus 6–30 digit angka.");
    }

    setSubmitting(true);
    setFieldError(null);
    setSubmitError(null);
    try {
      await createReturn(orderId, {
        reason,
        description: description.trim(),
        evidenceUrls,
        refundBank: {
          bankName: bankName.trim(),
          accountNumber: accountNumber.trim(),
          accountHolder: accountHolder.trim(),
        },
      });
      router.replace(`/orders/${orderId}`);
      router.refresh();
    } catch (err) {
      setSubmitError(toMessage(err, "Pengajuan retur gagal dikirim. Coba lagi."));
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorBanner message={error} onRetry={retry} />
        <Link href={`/orders/${orderId}`} className="btn-ghost w-fit">
          Kembali ke pesanan
        </Link>
      </div>
    );
  }
  if (!order) return <p className="muted" aria-busy="true">Memuat data pesanan...</p>;

  const info = order.return;

  if (info.request) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">Pengajuan Retur</h1>
        <section className="glass flex flex-col gap-2 p-6">
          <span className="pill w-fit">{RETURN_STATUS_LABELS[info.request.status]}</span>
          <p className="text-sm text-[var(--fg)]">
            Retur <strong>{info.request.returnNo}</strong> untuk pesanan {order.orderNo}.
          </p>
          <p className="muted small">
            Diajukan {formatDateTime(info.request.requestedAt)} · Nominal {formatRupiah(info.request.amount)}
          </p>
          {info.request.resolutionNote && <p className="text-sm">Catatan: {info.request.resolutionNote}</p>}
          {info.request.refundReference && (
            <p className="muted small">Referensi refund: {info.request.refundReference}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href={`/orders/${orderId}`} className="btn">
              Kembali ke pesanan
            </Link>
            <Link href="/orders" className="btn-ghost">
              Riwayat pesanan
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (!info.canRequest) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">Ajukan Retur</h1>
        <section className="glass flex flex-col gap-2 p-8">
          <p className="font-semibold text-[var(--fg)]">Pesanan ini belum bisa diretur</p>
          <p className="text-sm text-[var(--muted)]">
            {info.blockedReason ?? "Pesanan tidak memenuhi syarat retur saat ini."}
          </p>
          <Link href={`/orders/${orderId}`} className="btn-ghost mt-2 w-fit">
            Kembali ke pesanan
          </Link>
        </section>
      </div>
    );
  }

  const busy = submitting || uploading;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">Ajukan Retur</h1>
        <p className="muted small">
          Retur untuk pesanan {order.orderNo} · {ORDER_STATUS_LABELS[order.status]} ·{" "}
          {formatRupiah(order.total)}
        </p>
        {info.windowEndsAt && (
          <p className="muted small">
            Masa perlindungan pembeli berakhir {formatDateTime(info.windowEndsAt)}.
          </p>
        )}
      </div>

      <section className="card !block !p-4">
        <ul className="!m-0 flex flex-col gap-1 !p-0 !shadow-none">
          {order.items.map((item) => (
            <li key={item.id} className="!block !border-t-0 !p-0 text-sm">
              {item.productName} ({item.variantName}) × {item.quantity}
            </li>
          ))}
        </ul>
        <p className="muted small mt-2">Toko: {order.sellerName}</p>
      </section>

      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor={`${uid}-reason`}>Alasan retur</label>
          <select
            id={`${uid}-reason`}
            value={reason}
            disabled={busy}
            onChange={(e) => {
              setReason(e.target.value as ReturnReason);
              setFieldError(null);
            }}
          >
            <option value="" disabled>
              Pilih alasan
            </option>
            {RETURN_REASONS.map((r) => (
              <option key={r} value={r}>
                {RETURN_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`${uid}-description`}>Ceritakan kondisi barang</label>
          <textarea
            id={`${uid}-description`}
            rows={5}
            maxLength={RETURN_DESCRIPTION_MAX}
            value={description}
            disabled={busy}
            placeholder="Jelaskan kondisi barang dan alasan retur secara detail."
            onChange={(e) => {
              setDescription(e.target.value);
              setFieldError(null);
            }}
          />
          <span className="hint">
            {description.trim().length}/{RETURN_DESCRIPTION_MAX} (minimal {RETURN_DESCRIPTION_MIN})
          </span>
        </div>

        <div className="field">
          <label htmlFor={`${uid}-files`}>Foto bukti (opsional, maks {RETURN_EVIDENCE_MAX})</label>
          <label className="upload" htmlFor={`${uid}-files`} data-busy={uploading}>
            <span>
              {uploading ? (
                "Mengunggah…"
              ) : (
                <>
                  <strong>Pilih foto</strong> — JPG, PNG, atau WEBP (maks 5MB)
                </>
              )}
            </span>
            <input
              ref={fileRef}
              id={`${uid}-files`}
              type="file"
              accept={ALLOWED_MIME.join(",")}
              multiple
              disabled={busy || evidenceUrls.length >= RETURN_EVIDENCE_MAX}
              onChange={(e) => void addFiles(e.target.files)}
            />
          </label>
          {evidenceUrls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {evidenceUrls.map((url) => (
                <div key={url} className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="Foto bukti retur" className="h-16 w-16 rounded-[var(--radius-sm)] object-cover" />
                  <button
                    type="button"
                    className="btn-link"
                    disabled={busy}
                    onClick={() => setEvidenceUrls((prev) => prev.filter((u) => u !== url))}
                  >
                    Hapus
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="form-divider" />
        <p className="muted small">
          Refund manual dikirim ke rekening berikut. Pastikan datanya benar — admin memakai data ini untuk
          mengembalikan dana.
        </p>
        <div className="field-row">
          <div className="field">
            <label htmlFor={`${uid}-bank`}>Nama bank</label>
            <input
              id={`${uid}-bank`}
              value={bankName}
              maxLength={60}
              disabled={busy}
              placeholder="mis. BCA"
              onChange={(e) => {
                setBankName(e.target.value);
                setFieldError(null);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-account`}>Nomor rekening</label>
            <input
              id={`${uid}-account`}
              value={accountNumber}
              inputMode="numeric"
              maxLength={30}
              disabled={busy}
              placeholder="1234567890"
              onChange={(e) => {
                setAccountNumber(e.target.value.replace(/\D/g, ""));
                setFieldError(null);
              }}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${uid}-holder`}>Nama pemilik rekening</label>
          <input
            id={`${uid}-holder`}
            value={accountHolder}
            maxLength={80}
            disabled={busy}
            onChange={(e) => {
              setAccountHolder(e.target.value);
              setFieldError(null);
            }}
          />
        </div>

        {fieldError && (
          <p role="alert" className="field-error">
            {fieldError}
          </p>
        )}
        {submitError && <ErrorBanner message={submitError} />}

        <div className="form-actions">
          <Link href={`/orders/${orderId}`} className="btn-ghost" aria-disabled={busy}>
            Batal
          </Link>
          <button type="submit" className="btn" disabled={busy}>
            {submitting ? "Mengirim…" : uploading ? "Menunggu upload…" : "Kirim pengajuan retur"}
          </button>
        </div>
      </form>
    </div>
  );
}
