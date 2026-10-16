"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useState } from "react";
import { FaBoxOpen } from "react-icons/fa6";
import { DASHBOARD_RANGES, DASHBOARD_RANGE_DAYS, type DashboardRange, ORDER_STATUS_LABELS } from "@ecommerce/shared";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatCard } from "@/components/ui/stat-card";
import { getAdminAnalytics } from "@/lib/admin-api";
import { formatCompactCount, formatRupiah } from "@/lib/format";
import { useRemoteData } from "@/lib/use-remote-data";

const REFRESH_MS = 60_000;

// Recharts hanya dimuat di browser dan tidak membebani bundle halaman lain.
const SalesChart = dynamic(() => import("@/components/seller-dashboard/sales-chart").then((m) => m.SalesChart), {
  ssr: false,
  loading: () => <div className="clay-inset h-64 w-full animate-pulse" aria-hidden />,
});

export function AnalyticsView() {
  const [range, setRange] = useState<DashboardRange>("30d");
  const fetcher = useCallback(() => getAdminAnalytics(range), [range]);
  const { data, error, retry } = useRemoteData(fetcher, { errorMessage: "Gagal memuat analytics.", pollMs: REFRESH_MS });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">Ringkasan Platform</h1>
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

      {error && <ErrorBanner message={error} onRetry={retry} />}

      {!data && !error && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="clay-inset h-24 animate-pulse" />
          ))}
        </div>
      )}

      {data && (
        <>
          {(data.platform.pendingSellers > 0 || data.disputes.needsReply > 0) && (
            <div className="flex flex-col gap-2">
              {data.platform.pendingSellers > 0 && (
                <Link href="/admin/sellers" className="glass flex items-center justify-between gap-3 p-4">
                  <span className="font-semibold text-[var(--fg)]">
                    {data.platform.pendingSellers} pengajuan toko menunggu persetujuan
                  </span>
                  <span className="text-sm font-semibold text-[var(--brand)]">Tinjau sekarang →</span>
                </Link>
              )}
              {data.disputes.needsReply > 0 && (
                <Link href="/admin/disputes?view=needs_reply" className="glass flex items-center justify-between gap-3 p-4">
                  <span className="font-semibold text-[var(--fg)]">{data.disputes.needsReply} tiket sengketa perlu dibalas</span>
                  <span className="text-sm font-semibold text-[var(--brand)]">Buka antrian →</span>
                </Link>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="GMV" value={formatRupiah(data.totals.gmv)} hint={`${DASHBOARD_RANGE_DAYS[data.range]} hari terakhir`} />
            <StatCard label="Pesanan dibayar" value={formatCompactCount(data.totals.orders)} />
            <StatCard label="Rata-rata per pesanan" value={formatRupiah(data.totals.averageOrderValue)} />
            <StatCard label="Pengguna baru" value={formatCompactCount(data.totals.newUsers)} />
            <StatCard label="Pendaftar toko" value={formatCompactCount(data.totals.newSellers)} />
          </div>

          <section className="glass flex flex-col gap-3 p-4" aria-labelledby="gmv-heading">
            <h2 id="gmv-heading" className="font-bold text-[var(--fg)]">
              GMV harian
            </h2>
            {data.totals.orders === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
                <FaBoxOpen aria-hidden className="text-2xl text-[var(--muted)]" />
                <p className="muted">Belum ada transaksi dibayar pada periode ini.</p>
              </div>
            ) : (
              <SalesChart series={data.series} valueLabel="GMV" />
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="glass flex flex-col gap-3 p-4" aria-labelledby="sellers-heading">
              <h2 id="sellers-heading" className="font-bold text-[var(--fg)]">
                Toko terlaris
              </h2>
              {data.topSellers.length === 0 ? (
                <p className="muted">Belum ada penjualan pada periode ini.</p>
              ) : (
                <ol className="!m-0 flex list-none flex-col gap-2 !p-0">
                  {data.topSellers.map((s) => (
                    <li key={s.sellerId} className="!block !border-t-0 !p-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-semibold text-[var(--fg)]">{s.storeName}</span>
                          <span className="muted small">{s.orders} pesanan</span>
                        </div>
                        <span className="text-sm font-bold text-[var(--fg)]">{formatRupiah(s.revenue)}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="glass flex flex-col gap-3 p-4" aria-labelledby="cats-heading">
              <h2 id="cats-heading" className="font-bold text-[var(--fg)]">
                Kategori terlaris
              </h2>
              {data.topCategories.length === 0 ? (
                <p className="muted">Belum ada produk terjual pada periode ini.</p>
              ) : (
                <ol className="!m-0 flex list-none flex-col gap-2 !p-0">
                  {data.topCategories.map((c) => (
                    <li key={c.categoryId} className="!block !border-t-0 !p-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-semibold text-[var(--fg)]">{c.name}</span>
                          <span className="muted small">{c.quantity} terjual</span>
                        </div>
                        <span className="text-sm font-bold text-[var(--fg)]">{formatRupiah(c.revenue)}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <section className="glass flex flex-col gap-3 p-4" aria-labelledby="status-heading">
              <h2 id="status-heading" className="font-bold text-[var(--fg)]">
                Status pesanan
              </h2>
              {data.statusBreakdown.length === 0 ? (
                <p className="muted">Belum ada pesanan pada periode ini.</p>
              ) : (
                <ul className="!m-0 flex flex-col gap-2 !p-0 !shadow-none">
                  {data.statusBreakdown.map((s) => {
                    const total = data.statusBreakdown.reduce((acc, x) => acc + x.count, 0);
                    return (
                      <li key={s.status} className="!block !border-t-0 !p-0">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-[var(--fg)]">{ORDER_STATUS_LABELS[s.status]}</span>
                          <span className="font-semibold text-[var(--fg)]">{s.count}</span>
                        </div>
                        <div className="clay-inset mt-1 h-1.5 overflow-hidden" aria-hidden>
                          <div className="h-full bg-[var(--brand)]" style={{ width: `${Math.max(4, (s.count / total) * 100)}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="glass flex flex-col gap-3 p-4" aria-labelledby="platform-heading">
              <h2 id="platform-heading" className="font-bold text-[var(--fg)]">
                Kondisi platform
              </h2>
              <dl className="kv text-sm">
                <dt>Pengguna</dt>
                <dd>{formatCompactCount(data.platform.users)}</dd>
                <dt>Toko aktif</dt>
                <dd>{data.platform.activeSellers}</dd>
                <dt>Toko menunggu</dt>
                <dd>
                  <Link href="/admin/sellers" className="underline">
                    {data.platform.pendingSellers}
                  </Link>
                </dd>
                <dt>Produk aktif</dt>
                <dd>{formatCompactCount(data.platform.activeProducts)}</dd>
              </dl>
            </section>

            <section className="glass flex flex-col gap-3 p-4" aria-labelledby="dispute-heading">
              <h2 id="dispute-heading" className="font-bold text-[var(--fg)]">
                Sengketa
              </h2>
              <dl className="kv text-sm">
                <dt>Tiket aktif</dt>
                <dd>
                  <Link href="/admin/disputes" className="underline">
                    {data.disputes.active}
                  </Link>
                </dd>
                <dt>Perlu dibalas</dt>
                <dd>{data.disputes.needsReply}</dd>
                <dt>Dibuka ({DASHBOARD_RANGE_DAYS[data.range]} hari)</dt>
                <dd>{data.disputes.openedInRange}</dd>
                <dt>Ditutup ({DASHBOARD_RANGE_DAYS[data.range]} hari)</dt>
                <dd>{data.disputes.closedInRange}</dd>
              </dl>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
