"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaBoxOpen, FaTriangleExclamation } from "react-icons/fa6";
import {
  SELLER_ORDER_TABS,
  SELLER_ORDER_TAB_LABELS,
  type SellerOrder,
  type SellerOrderListResponse,
  type SellerOrderTab,
} from "@ecommerce/shared";
import { createShipment, listSellerOrders, markOrderShipped } from "@/lib/seller-order-api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { usePolling } from "@/lib/use-polling";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { type OrderAction, SellerOrderCard } from "./seller-order-card";

const PAGE_SIZE = 10;
/** Order baru/status berubah muncul tanpa reload manual. */
const REFRESH_MS = 30_000;
const SEARCH_DEBOUNCE_MS = 400;

const EMPTY_MESSAGE: Record<SellerOrderTab, string> = {
  new: "Belum ada pesanan baru. Pesanan yang sudah dibayar pembeli akan muncul di sini.",
  processing: "Tidak ada pesanan yang sedang diproses.",
  shipped: "Belum ada pesanan yang dikirim.",
  completed: "Belum ada pesanan selesai.",
};

export function SellerOrdersView({ initialTab }: { initialTab: SellerOrderTab }) {
  const toMessage = useApiErrorMessage();
  const [tab, setTab] = useState(initialTab);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SellerOrderListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingShip, setPendingShip] = useState<SellerOrder | null>(null);
  const [busy, setBusy] = useState<{ orderId: string; action: OrderAction } | null>(null);
  // Mengabaikan respons basi (ganti tab/ketik cepat/polling tumpang tindih).
  const requestId = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      const id = ++requestId.current;
      if (!silent) {
        setData(null);
        setError(null);
      }
      try {
        const res = await listSellerOrders({ tab, q: search, page, pageSize: PAGE_SIZE });
        if (id !== requestId.current) return;
        setData(res);
        setError(null);
        // Halaman terakhir mendadak kosong (order pindah tab) → mundur ke halaman valid terakhir.
        if (res.items.length === 0 && res.page > 1) setPage(Math.max(1, Math.ceil(res.total / res.pageSize)));
      } catch (err) {
        if (id !== requestId.current) return;
        if (!silent) setError(toMessage(err, "Gagal memuat pesanan."));
      }
    },
    [tab, search, page, toMessage],
  );

  useEffect(() => {
    void load();
  }, [load]);
  usePolling(() => void load(true), REFRESH_MS, busy === null);

  // Debounce pencarian; hasil baru selalu mulai dari halaman 1.
  useEffect(() => {
    const timer = setTimeout(() => {
      // Nilai identik tidak memicu re-render, jadi aman dipanggil juga saat mount.
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  function changeTab(next: SellerOrderTab) {
    if (next === tab) return;
    setTab(next);
    setPage(1);
    setNotice(null);
    window.history.replaceState(null, "", `?tab=${next}`);
  }

  /** Serah-terima ke kurir tidak bisa dibatalkan & memberi notifikasi ke buyer → minta konfirmasi dulu. */
  function requestAction(order: SellerOrder, action: OrderAction) {
    if (busy) return;
    if (action === "mark-shipped") {
      setPendingShip(order);
      return;
    }
    void runAction(order, action);
  }

  async function runAction(order: SellerOrder, action: OrderAction) {
    if (busy) return;
    setBusy({ orderId: order.id, action });
    setNotice(null);
    setError(null);
    try {
      const result = action === "ship-booking" ? await createShipment(order.id) : await markOrderShipped(order.id);
      setNotice(
        action === "ship-booking"
          ? `Pengiriman ${order.orderNo} didaftarkan${result.trackingNumber ? ` (resi ${result.trackingNumber})` : ""}.`
          : `Pesanan ${order.orderNo} ditandai dikirim.`,
      );
    } catch (err) {
      setError(toMessage(err, "Aksi gagal. Coba lagi."));
    } finally {
      setBusy(null);
      setPendingShip(null);
      // Selalu sinkron ulang: berhasil atau gagal, status order bisa sudah berubah (webhook/tab lain).
      void load(true);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">Manajemen Pesanan</h1>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Status pesanan">
        {SELLER_ORDER_TABS.map((t) => {
          const count = data?.counts[t];
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === tab}
              className={t === tab ? "tab tab-active" : "tab"}
              onClick={() => changeTab(t)}
            >
              {SELLER_ORDER_TAB_LABELS[t]}
              {count !== undefined && count > 0 && (
                <span className={t === "new" && t !== tab ? "tab-count tab-count-alert" : "tab-count"}>{count}</span>
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
          placeholder="Cari nomor pesanan..."
          aria-label="Cari nomor pesanan"
          maxLength={60}
        />
      </div>

      {notice && (
        <p role="status" className="glass p-3 text-sm font-semibold text-[var(--up)]">
          {notice}
        </p>
      )}

      {error && (
        <div className="alert flex flex-wrap items-center gap-3" role="alert">
          <FaTriangleExclamation aria-hidden />
          <span className="flex-1">{error}</span>
          <button type="button" className="btn-ghost" onClick={() => void load()}>
            Coba lagi
          </button>
        </div>
      )}

      {!data && !error && <p className="muted" aria-busy="true">Memuat pesanan...</p>}

      {data && data.items.length === 0 && (
        <div className="glass flex flex-col items-center gap-2 p-10 text-center">
          <FaBoxOpen aria-hidden className="text-2xl text-[var(--muted)]" />
          <p className="font-semibold text-[var(--fg)]">
            {search ? `Tidak ada pesanan untuk "${search}"` : "Tidak ada pesanan"}
          </p>
          {!search && <p className="text-sm text-[var(--muted)]">{EMPTY_MESSAGE[tab]}</p>}
        </div>
      )}

      {data && data.items.length > 0 && (
        <ul className="!m-0 flex flex-col gap-3 !p-0 !shadow-none">
          {data.items.map((order) => (
            <SellerOrderCard
              key={order.id}
              order={order}
              busyAction={busy?.orderId === order.id ? busy.action : null}
              disabled={busy !== null}
              onAction={requestAction}
            />
          ))}
        </ul>
      )}

      {data && totalPages > 1 && (
        <div className="flex items-center justify-between gap-3">
          <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Sebelumnya
          </button>
          <span className="muted small">
            Halaman {data.page} dari {totalPages}
          </span>
          <button type="button" className="btn-ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Berikutnya
          </button>
        </div>
      )}

      <ConfirmDialog
        open={pendingShip !== null}
        title="Tandai sudah dikirim?"
        description={`Pesanan ${pendingShip?.orderNo ?? ""} akan ditandai sudah diserahkan ke kurir dan pembeli diberi tahu. Tindakan ini tidak bisa dibatalkan.`}
        confirmLabel="Ya, sudah diserahkan"
        busy={busy !== null}
        onConfirm={() => pendingShip && void runAction(pendingShip, "mark-shipped")}
        onCancel={() => setPendingShip(null)}
      />
    </div>
  );
}