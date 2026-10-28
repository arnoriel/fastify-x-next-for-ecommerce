"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FaArrowRotateLeft } from "react-icons/fa6";
import {
  RETURN_REASON_LABELS,
  RETURN_STATUS_LABELS,
  type AdminReturnsQuery,
} from "@ecommerce/shared";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Pagination } from "@/components/ui/pagination";
import { listAdminReturns } from "@/lib/return-api";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { usePaged } from "@/lib/use-paged";
import { useRemoteData } from "@/lib/use-remote-data";

const PAGE_SIZE = 15;
const REFRESH_MS = 30_000;

const TABS: { value: NonNullable<AdminReturnsQuery["view"]>; label: string }[] = [
  { value: "pending", label: "Menunggu keputusan" },
  { value: "refund_queue", label: "Antrian refund" },
  { value: "all", label: "Semua" },
];

export function ReturnsView() {
  const [view, setView] = useState<NonNullable<AdminReturnsQuery["view"]>>("pending");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput.trim());
  const [page, setPage] = usePaged(`${view}|${search}`);

  const fetcher = useCallback(
    () => listAdminReturns({ view, q: search, page, pageSize: PAGE_SIZE }),
    [view, search, page],
  );
  const { data, error, retry } = useRemoteData(fetcher, { errorMessage: "Gagal memuat antrian retur.", pollMs: REFRESH_MS });

  useEffect(() => {
    if (data && data.items.length === 0 && data.page > 1) setPage(Math.ceil(data.total / data.pageSize));
  }, [data, setPage]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">Retur & Refund</h1>
        {data && <span className="muted small">{data.total} pengajuan</span>}
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter retur">
        {TABS.map((tab) => {
          const count = data?.counts[tab.value === "refund_queue" ? "refundQueue" : "pending"];
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={view === tab.value}
              className={view === tab.value ? "tab tab-active" : "tab"}
              onClick={() => {
                setView(tab.value);
                setPage(1);
              }}
            >
              {tab.label}
              {tab.value !== "all" && count !== undefined && count > 0 && <span className="tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="field">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Cari nomor retur, pesanan, pembeli, atau toko..."
          aria-label="Cari retur"
          maxLength={60}
        />
      </div>

      {error && <ErrorBanner message={error} onRetry={retry} />}
      {!data && !error && <p className="muted" aria-busy="true">Memuat antrian retur...</p>}

      {data && data.items.length === 0 && (
        <div className="glass flex flex-col items-center gap-2 p-10 text-center">
          <FaArrowRotateLeft aria-hidden className="text-2xl text-[var(--muted)]" />
          <p className="font-semibold text-[var(--fg)]">Tidak ada pengajuan retur</p>
          <p className="text-sm text-[var(--muted)]">
            {view === "refund_queue"
              ? "Semua refund yang disetujui sudah dieksekusi."
              : "Pengajuan retur dari pembeli akan muncul di sini."}
          </p>
        </div>
      )}

      {data && data.items.length > 0 && (
        <ul className="!m-0 flex flex-col gap-2 !p-0 !shadow-none">
          {data.items.map((item) => (
            <li key={item.id} className="card !block !p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-bold text-[var(--fg)]">{item.returnNo}</span>
                  <span className="muted small">
                    {item.orderNo} · {formatDateTime(item.requestedAt)}
                  </span>
                </div>
                <span className="pill">{RETURN_STATUS_LABELS[item.status]}</span>
              </div>
              <dl className="kv mt-2 text-sm">
                <dt>Pembeli</dt>
                <dd>{item.buyerName ? `${item.buyerName} · ${item.buyerEmail}` : "Guest"}</dd>
                <dt>Toko</dt>
                <dd>{item.storeName}</dd>
                <dt>Alasan</dt>
                <dd>{RETURN_REASON_LABELS[item.reason]}</dd>
                <dt>Nominal</dt>
                <dd>{formatRupiah(item.amount)}</dd>
                <dt>Rekening</dt>
                <dd>
                  {item.refundBank
                    ? `${item.refundBank.bankName} · ${item.refundBank.accountNumber} · ${item.refundBank.accountHolder}`
                    : "-"}
                </dd>
              </dl>
              <Link href={`/admin/refunds/${item.id}`} className="btn-ghost mt-3 inline-block w-fit">
                {item.status === "approved" ? "Proses refund" : "Lihat detail"}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {data && <Pagination page={data.page} total={data.total} pageSize={data.pageSize} onChange={setPage} />}
    </div>
  );
}