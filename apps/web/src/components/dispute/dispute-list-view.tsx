"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FaCommentDots } from "react-icons/fa6";
import { DISPUTE_REASON_LABELS, type DisputeSummary } from "@ecommerce/shared";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Pagination } from "@/components/ui/pagination";
import { type DisputeMode, listAdminDisputes, listMyDisputes } from "@/lib/dispute-api";
import { formatRelativeTime } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { usePaged } from "@/lib/use-paged";
import { useRemoteData } from "@/lib/use-remote-data";
import { DisputeStatusPill } from "./dispute-status-pill";

const PAGE_SIZE = 10;
const REFRESH_MS = 20_000;

type View = "active" | "needs_reply" | "closed" | "all";
const ADMIN_VIEWS: { view: View; label: string }[] = [
  { view: "active", label: "Aktif" },
  { view: "needs_reply", label: "Perlu dibalas" },
  { view: "closed", label: "Selesai" },
  { view: "all", label: "Semua" },
];
const PARTICIPANT_VIEWS: { view: View; label: string }[] = [
  { view: "active", label: "Aktif" },
  { view: "closed", label: "Selesai" },
];

function DisputeRow({ dispute, mode }: { dispute: DisputeSummary; mode: DisputeMode }) {
  const href = mode === "admin" ? `/admin/disputes/${dispute.id}` : `/disputes/${dispute.id}`;
  const parties =
    mode === "admin"
      ? `${dispute.buyerName ?? "Guest"} dan ${dispute.storeName}`
      : dispute.viewerRole === "buyer"
        ? `Toko ${dispute.storeName}`
        : `Pembeli ${dispute.buyerName ?? "Guest"}`;

  return (
    <li className="card !block !p-0">
      <Link href={href} className="flex flex-col gap-1.5 p-4 text-inherit no-underline">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold text-[var(--fg)]">{dispute.ticketNo}</span>
          <span className="flex flex-wrap items-center gap-2">
            {dispute.needsReply && (
              <span className="tab-count tab-count-alert !w-auto !px-2">{mode === "admin" ? "Perlu dibalas" : "Menunggu balasan Anda"}</span>
            )}
            <DisputeStatusPill status={dispute.status} />
          </span>
        </div>
        <span className="text-sm text-[var(--fg)]">{DISPUTE_REASON_LABELS[dispute.reason]}</span>
        <span className="muted small">
          Pesanan {dispute.orderNo} · {parties} · diperbarui {formatRelativeTime(dispute.updatedAt)}
        </span>
      </Link>
    </li>
  );
}

export function DisputeListView({ mode }: { mode: DisputeMode }) {
  const views = mode === "admin" ? ADMIN_VIEWS : PARTICIPANT_VIEWS;
  const params = useSearchParams();
  const requested = params.get("view");
  const [view, setView] = useState<View>(views.some((v) => v.view === requested) ? (requested as View) : "active");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput.trim());
  const [page, setPage] = usePaged(`${view}|${search}`);

  const fetcher = useCallback(
    () =>
      mode === "admin"
        ? listAdminDisputes({ view, q: search, page, pageSize: PAGE_SIZE })
        : listMyDisputes({ view: view as "active" | "closed" | "all", page, pageSize: PAGE_SIZE }),
    [mode, view, search, page],
  );
  const { data, error, retry } = useRemoteData(fetcher, { errorMessage: "Gagal memuat tiket.", pollMs: REFRESH_MS });

  useEffect(() => {
    if (data && data.items.length === 0 && data.page > 1) setPage(Math.ceil(data.total / data.pageSize));
  }, [data, setPage]);

  function changeView(next: View) {
    if (next === view) return;
    setView(next);
    window.history.replaceState(null, "", `?view=${next}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">
        {mode === "admin" ? "Sengketa" : "Laporan & sengketa saya"}
      </h1>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Status tiket">
        {views.map((v) => (
          <button
            key={v.view}
            type="button"
            role="tab"
            aria-selected={v.view === view}
            className={v.view === view ? "tab tab-active" : "tab"}
            onClick={() => changeView(v.view)}
          >
            {v.label}
            {v.view === "active" && data && data.activeCount > 0 && <span className="tab-count">{data.activeCount}</span>}
          </button>
        ))}
      </div>

      {mode === "admin" && (
        <div className="field">
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Cari nomor tiket, nomor pesanan, pembeli, atau toko..."
            aria-label="Cari tiket"
            maxLength={60}
          />
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={retry} />}
      {!data && !error && <p className="muted" aria-busy="true">Memuat tiket...</p>}

      {data && data.items.length === 0 && (
        <div className="glass flex flex-col items-center gap-2 p-10 text-center">
          <FaCommentDots aria-hidden className="text-2xl text-[var(--muted)]" />
          <p className="font-semibold text-[var(--fg)]">{search ? `Tidak ada tiket untuk "${search}"` : "Belum ada tiket"}</p>
          {!search && (
            <p className="text-sm text-[var(--muted)]">
              {mode === "admin"
                ? view === "needs_reply"
                  ? "Semua tiket aktif sudah dibalas."
                  : "Tiket sengketa dari pembeli dan penjual akan muncul di sini."
                : "Ada masalah dengan pesanan? Buka detail pesanan lalu pilih Laporkan masalah."}
            </p>
          )}
          {!search && mode === "participant" && (
            <Link href="/orders" className="btn-ghost mt-1">
              Lihat pesanan saya
            </Link>
          )}
        </div>
      )}

      {data && data.items.length > 0 && (
        <ul className="!m-0 flex flex-col gap-2 !p-0 !shadow-none">
          {data.items.map((d) => (
            <DisputeRow key={d.id} dispute={d} mode={mode} />
          ))}
        </ul>
      )}

      {data && <Pagination page={data.page} total={data.total} pageSize={data.pageSize} onChange={setPage} />}
    </div>
  );
}
