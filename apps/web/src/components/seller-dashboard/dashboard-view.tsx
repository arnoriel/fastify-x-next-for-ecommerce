"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaBoxOpen, FaTriangleExclamation } from "react-icons/fa6";
import {
  DASHBOARD_RANGES,
  DASHBOARD_RANGE_DAYS,
  type DashboardRange,
  SELLER_ORDER_TABS,
  SELLER_ORDER_TAB_LABELS,
  type SellerDashboardSummary,
} from "@ecommerce/shared";
import { formatRupiah } from "@/lib/format";
import { getSellerDashboard } from "@/lib/seller-order-api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { usePolling } from "@/lib/use-polling";

const FALLBACK_IMAGE = "/product-placeholder.svg";
const REFRESH_MS = 60_000;

// Recharts hanya dimuat di browser (butuh ukuran DOM) dan tidak membebani bundle halaman lain.
const SalesChart = dynamic(() => import("./sales-chart").then((m) => m.SalesChart), {
  ssr: false,
  loading: () => <div className="clay-inset h-64 w-full animate-pulse" aria-hidden />,
});

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bento-cell flex flex-col gap-1 p-4">
      <span className="muted small">{label}</span>
      <span className="text-xl font-extrabold tracking-tight text-[var(--fg)]">{value}</span>
      {hint && <span className="muted small">{hint}</span>}
    </div>
  );
}

export function DashboardView() {
  const toMessage = useApiErrorMessage();
  const [range, setRange] = useState<DashboardRange>("30d");
  const [data, setData] = useState<SellerDashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Mengabaikan respons basi saat range diganti cepat / polling tumpang tindih.
  const requestId = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      const id = ++requestId.current;
      if (!silent) {
        setData(null);
        setError(null);
      }
      try {
        const res = await getSellerDashboard(range);
        if (id !== requestId.current) return;
        setData(res);
        setError(null);
      } catch (err) {
        if (id !== requestId.current) return;
        // Polling gagal sesekali tidak menghapus data yang sudah tampil.
        if (!silent) setError(toMessage(err, "Gagal memuat dashboard."));
      }
    },
    [range, toMessage],
  );

  useEffect(() => {
    void load();
  }, [load]);
  usePolling(() => void load(true), REFRESH_MS);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">Dashboard Toko</h1>
        <div className="flex gap-2" role="group" aria-label="Rentang waktu">
          {DASHBOARD_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={r === range}
              className={r === range ? "tab tab-active" : "tab"}
              onClick={() => setRange(r)}
            >
              {DASHBOARD_RANGE_DAYS[r]} hari
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="alert flex flex-wrap items-center gap-3" role="alert">
          <FaTriangleExclamation aria-hidden />
          <span className="flex-1">{error}</span>
          <button type="button" className="btn-ghost" onClick={() => void load()}>
            Coba lagi
          </button>
        </div>
      )}

      {!data && !error && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="clay-inset h-24 animate-pulse" />
          ))}
        </div>
      )}

      {data && (
        <>
          {data.orderCounts.new > 0 && (
            <Link href="/seller/orders?tab=new" className="glass flex items-center justify-between gap-3 p-4">
              <span className="font-semibold text-[var(--fg)]">
                {data.orderCounts.new} pesanan baru menunggu diproses
              </span>
              <span className="text-sm font-semibold text-[var(--brand)]">Proses sekarang →</span>
            </Link>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Omzet" value={formatRupiah(data.totals.revenue)} hint={`${DASHBOARD_RANGE_DAYS[data.range]} hari terakhir`} />
            <StatCard label="Pesanan" value={String(data.totals.orders)} hint="Sudah dibayar" />
            <StatCard label="Rata-rata per pesanan" value={formatRupiah(data.totals.averageOrderValue)} />
            <StatCard label="Perlu diproses" value={String(data.orderCounts.new)} hint="Semua waktu" />
          </div>

          <section className="glass flex flex-col gap-3 p-4" aria-labelledby="sales-heading">
            <h2 id="sales-heading" className="font-bold text-[var(--fg)]">
              Penjualan harian
            </h2>
            {data.totals.orders === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
                <FaBoxOpen aria-hidden className="text-2xl text-[var(--muted)]" />
                <p className="muted">Belum ada penjualan pada periode ini.</p>
              </div>
            ) : (
              <SalesChart series={data.series} />
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="glass flex flex-col gap-3 p-4" aria-labelledby="status-heading">
              <h2 id="status-heading" className="font-bold text-[var(--fg)]">
                Status pesanan
              </h2>
              <ul className="!m-0 grid grid-cols-2 gap-3 !p-0 !shadow-none">
                {SELLER_ORDER_TABS.map((tab) => (
                  <li key={tab} className="!block !border-t-0 !p-0">
                    <Link href={`/seller/orders?tab=${tab}`} className="clay-inset flex flex-col gap-1 p-3">
                      <span className="muted small">{SELLER_ORDER_TAB_LABELS[tab]}</span>
                      <span className="text-lg font-bold text-[var(--fg)]">{data.orderCounts[tab]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section className="glass flex flex-col gap-3 p-4" aria-labelledby="top-heading">
              <h2 id="top-heading" className="font-bold text-[var(--fg)]">
                Produk terlaris
              </h2>
              {data.topProducts.length === 0 ? (
                <p className="muted">Belum ada produk terjual pada periode ini.</p>
              ) : (
                <ol className="!m-0 flex list-none flex-col gap-2 !p-0">
                  {data.topProducts.map((p) => (
                    <li key={p.productId} className="!block !border-t-0 !p-0">
                      <Link href={`/seller/products/${p.productId}`} className="flex items-center gap-3">
                        <div className="clay-inset relative h-11 w-11 shrink-0 overflow-hidden">
                          <Image
                            src={p.imageUrl ?? FALLBACK_IMAGE}
                            alt={p.name}
                            fill
                            sizes="44px"
                            className="object-cover"
                            unoptimized={!p.imageUrl}
                          />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-semibold text-[var(--fg)]">{p.name}</span>
                          <span className="muted small">{p.quantity} terjual</span>
                        </div>
                        <span className="text-sm font-bold text-[var(--fg)]">{formatRupiah(p.revenue)}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
