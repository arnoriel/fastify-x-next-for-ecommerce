"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { FaStore } from "react-icons/fa6";
import type { AdminSellerItem, SellerStatusValue } from "@ecommerce/shared";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { approveSeller, listAdminSellers, rejectSeller } from "@/lib/admin-api";
import { formatDateTime } from "@/lib/format";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useDebounced } from "@/lib/use-debounced";
import { usePaged } from "@/lib/use-paged";
import { useRemoteData } from "@/lib/use-remote-data";

const PAGE_SIZE = 10;
const REFRESH_MS = 30_000;
const REASON_MIN = 5;
const REASON_MAX = 500;

const TAB_LABELS: Record<SellerStatusValue, string> = {
  pending: "Menunggu",
  approved: "Disetujui",
  rejected: "Ditolak",
  suspended: "Ditangguhkan",
};
const EMPTY_MESSAGE: Record<SellerStatusValue, string> = {
  pending: "Tidak ada pengajuan yang menunggu. Pengajuan baru akan muncul di sini otomatis.",
  approved: "Belum ada toko yang disetujui.",
  rejected: "Belum ada pengajuan yang ditolak.",
  suspended: "Tidak ada toko yang ditangguhkan.",
};

/** Hanya tautan http(s) yang boleh dibuka dari panel — tolak skema lain (javascript:, data:). */
const isSafeUrl = (url: string | null): url is string => Boolean(url && /^https?:\/\//i.test(url));

function SellerCard({
  seller,
  busy,
  onApprove,
  onReject,
}: {
  seller: AdminSellerItem;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <li className="card !block !p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-base font-bold text-[var(--fg)]">{seller.storeName}</span>
          <span className="muted small">
            {seller.owner.name} · {seller.owner.email}
          </span>
        </div>
        <span className="muted small">Diajukan {formatDateTime(seller.submittedAt)}</span>
      </div>

      <dl className="kv mt-3 text-sm">
        <dt>Kontak</dt>
        <dd>{[seller.contactName, seller.phone].filter(Boolean).join(" · ") || "—"}</dd>
        <dt>Alamat pickup</dt>
        <dd>{seller.pickupAddress ?? "—"}</dd>
        <dt>Dokumen</dt>
        <dd>
          {isSafeUrl(seller.documentUrl) ? (
            <a href={seller.documentUrl} target="_blank" rel="noopener noreferrer" className="underline">
              Buka dokumen verifikasi
            </a>
          ) : (
            <span className="text-[var(--muted)]">Tidak ada dokumen</span>
          )}
        </dd>
        {seller.status === "rejected" && seller.rejectionReason && (
          <>
            <dt>Alasan ditolak</dt>
            <dd>{seller.rejectionReason}</dd>
          </>
        )}
      </dl>

      {seller.status === "pending" && (
        <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-3">
          <button type="button" className="btn-ghost" disabled={busy} onClick={onReject}>
            Tolak
          </button>
          <button type="button" className="btn" disabled={busy} onClick={onApprove}>
            {busy ? "Memproses..." : "Setujui toko"}
          </button>
        </div>
      )}
    </li>
  );
}

export function SellersView() {
  const toMessage = useApiErrorMessage();
  const reasonId = useId();
  const [status, setStatus] = useState<SellerStatusValue>("pending");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput.trim());
  const [page, setPage] = usePaged(`${status}|${search}`);

  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approving, setApproving] = useState<AdminSellerItem | null>(null);
  const [rejecting, setRejecting] = useState<AdminSellerItem | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const fetcher = useCallback(
    () => listAdminSellers({ status, q: search, page, pageSize: PAGE_SIZE }),
    [status, search, page],
  );
  // Polling berhenti selama dialog terbuka / aksi berjalan agar daftar tidak bergeser di bawah admin.
  const { data, error, reload, retry } = useRemoteData(fetcher, {
    errorMessage: "Gagal memuat daftar toko.",
    pollMs: REFRESH_MS,
    paused: busyId !== null || approving !== null || rejecting !== null,
  });

  // Halaman terakhir mendadak kosong (data bergeser oleh admin lain) → mundur ke halaman valid terakhir.
  useEffect(() => {
    if (data && data.items.length === 0 && data.page > 1) setPage(Math.ceil(data.total / data.pageSize));
  }, [data, setPage]);

  function changeStatus(next: SellerStatusValue) {
    if (next === status) return;
    setStatus(next);
    setNotice(null);
    setActionError(null);
  }

  async function runApprove(seller: AdminSellerItem) {
    if (busyId) return;
    setBusyId(seller.id);
    setNotice(null);
    setActionError(null);
    try {
      await approveSeller(seller.id);
      setNotice(`Toko "${seller.storeName}" disetujui. Pemilik toko sudah diberi tahu dan dashboard toko aktif.`);
    } catch (err) {
      setActionError(toMessage(err, "Gagal menyetujui toko. Coba lagi."));
    } finally {
      setBusyId(null);
      setApproving(null);
      // Berhasil atau gagal, status toko bisa sudah berubah (admin lain / tab lain) → sinkron ulang.
      void reload();
    }
  }

  function openReject(seller: AdminSellerItem) {
    if (busyId) return;
    setReason("");
    setReasonError(null);
    setRejecting(seller);
  }

  async function runReject() {
    if (!rejecting || busyId) return;
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN) {
      setReasonError(`Alasan minimal ${REASON_MIN} karakter agar calon seller tahu apa yang perlu diperbaiki.`);
      return;
    }
    setBusyId(rejecting.id);
    setReasonError(null);
    try {
      await rejectSeller(rejecting.id, trimmed);
      setNotice(`Pengajuan "${rejecting.storeName}" ditolak. Alasan sudah dikirim ke calon seller.`);
      setRejecting(null);
    } catch (err) {
      // Dialog tetap terbuka & alasan tidak hilang — admin bisa langsung mencoba lagi.
      setReasonError(toMessage(err, "Gagal menolak pengajuan. Coba lagi."));
    } finally {
      setBusyId(null);
      void reload();
    }
  }

  const tabs = (Object.keys(TAB_LABELS) as SellerStatusValue[]).filter(
    (s) => s !== "suspended" || (data?.counts.suspended ?? 0) > 0 || status === "suspended",
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">Approval Seller</h1>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Status pengajuan">
        {tabs.map((s) => {
          const count = data?.counts[s];
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={s === status}
              className={s === status ? "tab tab-active" : "tab"}
              onClick={() => changeStatus(s)}
            >
              {TAB_LABELS[s]}
              {count !== undefined && count > 0 && (
                <span className={s === "pending" && s !== status ? "tab-count tab-count-alert" : "tab-count"}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="field">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Cari nama toko, nama pemilik, atau email..."
          aria-label="Cari toko"
          maxLength={60}
        />
      </div>

      {notice && (
        <p role="status" className="glass p-3 text-sm font-semibold text-[var(--up)]">
          {notice}
        </p>
      )}
      {actionError && <ErrorBanner message={actionError} />}
      {error && <ErrorBanner message={error} onRetry={retry} />}
      {!data && !error && <p className="muted" aria-busy="true">Memuat daftar toko...</p>}

      {data && data.items.length === 0 && (
        <div className="glass flex flex-col items-center gap-2 p-10 text-center">
          <FaStore aria-hidden className="text-2xl text-[var(--muted)]" />
          <p className="font-semibold text-[var(--fg)]">{search ? `Tidak ada toko untuk "${search}"` : "Tidak ada data"}</p>
          {!search && <p className="text-sm text-[var(--muted)]">{EMPTY_MESSAGE[status]}</p>}
        </div>
      )}

      {data && data.items.length > 0 && (
        <ul className="!m-0 flex flex-col gap-3 !p-0 !shadow-none">
          {data.items.map((seller) => (
            <SellerCard
              key={seller.id}
              seller={seller}
              busy={busyId !== null}
              onApprove={() => !busyId && setApproving(seller)}
              onReject={() => openReject(seller)}
            />
          ))}
        </ul>
      )}

      {data && <Pagination page={data.page} total={data.total} pageSize={data.pageSize} onChange={setPage} />}

      <ConfirmDialog
        open={approving !== null}
        title="Setujui toko ini?"
        description={`"${approving?.storeName ?? ""}" akan bisa menjual dan mengakses dashboard toko. Pemilik langsung diberi tahu.`}
        confirmLabel="Ya, setujui"
        busy={busyId !== null}
        onConfirm={() => approving && void runApprove(approving)}
        onCancel={() => setApproving(null)}
      />

      <Modal open={rejecting !== null} title="Tolak pengajuan toko" busy={busyId !== null} onClose={() => setRejecting(null)}>
        <p className="muted text-sm leading-relaxed">
          Alasan ini dikirim ke pemilik &quot;{rejecting?.storeName}&quot; dan ditampilkan di halaman statusnya. Jelaskan apa yang
          perlu diperbaiki supaya bisa mengajukan ulang.
        </p>
        <div className="field">
          <label htmlFor={reasonId}>Alasan penolakan</label>
          <textarea
            id={reasonId}
            value={reason}
            maxLength={REASON_MAX}
            rows={4}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={reasonError ? `${reasonId}-error` : undefined}
            disabled={busyId !== null}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(null);
            }}
            placeholder="Mis. Foto KTP buram dan alamat pickup belum lengkap."
          />
          <span className="hint">
            {reason.trim().length}/{REASON_MAX}
          </span>
          {reasonError && (
            <span id={`${reasonId}-error`} role="alert" className="field-error">
              {reasonError}
            </span>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-ghost" disabled={busyId !== null} onClick={() => setRejecting(null)}>
            Batal
          </button>
          <button type="button" className="btn" disabled={busyId !== null} onClick={() => void runReject()}>
            {busyId ? "Menolak..." : "Tolak pengajuan"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
