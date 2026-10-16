"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FaReceipt } from "react-icons/fa6";
import { ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatusValue } from "@ecommerce/shared";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Pagination } from "@/components/ui/pagination";
import { listAdminOrders } from "@/lib/admin-api";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { usePaged } from "@/lib/use-paged";
import { useRemoteData } from "@/lib/use-remote-data";

const PAGE_SIZE = 15;
const REFRESH_MS = 30_000;

export function OrdersView() {
  const [status, setStatus] = useState<OrderStatusValue | "">("");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput.trim());
  const [page, setPage] = usePaged(`${status}|${search}`);

  const fetcher = useCallback(
    () => listAdminOrders({ status: status || undefined, q: search, page, pageSize: PAGE_SIZE }),
    [status, search, page],
  );
  const { data, error, retry } = useRemoteData(fetcher, { errorMessage: "Gagal memuat transaksi.", pollMs: REFRESH_MS });

  // Halaman terakhir mendadak kosong (data bergeser oleh admin lain) → mundur ke halaman valid terakhir.
  useEffect(() => {
    if (data && data.items.length === 0 && data.page > 1) setPage(Math.ceil(data.total / data.pageSize));
  }, [data, setPage]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">Monitoring Transaksi</h1>
        {data && <span className="muted small">{data.total} pesanan</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        <div className="field">
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Cari nomor pesanan, pembeli, atau toko..."
            aria-label="Cari pesanan"
            maxLength={60}
          />
        </div>
        <div className="field">
          <select value={status} onChange={(e) => setStatus(e.target.value as OrderStatusValue | "")} aria-label="Filter status">
            <option value="">Semua status</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={retry} />}
      {!data && !error && <p className="muted" aria-busy="true">Memuat transaksi...</p>}

      {data && data.items.length === 0 && (
        <div className="glass flex flex-col items-center gap-2 p-10 text-center">
          <FaReceipt aria-hidden className="text-2xl text-[var(--muted)]" />
          <p className="font-semibold text-[var(--fg)]">Tidak ada pesanan</p>
          <p className="text-sm text-[var(--muted)]">
            {search || status ? "Coba ubah kata kunci atau filter status." : "Pesanan akan muncul di sini setelah ada checkout."}
          </p>
        </div>
      )}

      {data && data.items.length > 0 && (
        <ul className="!m-0 flex flex-col gap-2 !p-0 !shadow-none">
          {data.items.map((o) => (
            <li key={o.id} className="card !block !p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-bold text-[var(--fg)]">{o.orderNo}</span>
                  <span className="muted small">{formatDateTime(o.createdAt)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {o.activeDisputeId && (
                    <Link href={`/admin/disputes/${o.activeDisputeId}`} className="pill !text-[var(--down)]">
                      Ada sengketa
                    </Link>
                  )}
                  <span className="pill">{ORDER_STATUS_LABELS[o.status]}</span>
                </div>
              </div>
              <dl className="kv mt-2 text-sm">
                <dt>Pembeli</dt>
                <dd>{o.buyerName ? `${o.buyerName} · ${o.buyerEmail}` : "Guest"}</dd>
                <dt>Toko</dt>
                <dd>{o.storeName}</dd>
                <dt>Pengiriman</dt>
                <dd>{o.shippingStatusLabel ?? "Belum dikirim"}</dd>
                <dt>Total</dt>
                <dd>
                  <strong>{formatRupiah(o.total)}</strong> · {o.itemCount} barang
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      )}

      {data && <Pagination page={data.page} total={data.total} pageSize={data.pageSize} onChange={setPage} />}
    </div>
  );
}
