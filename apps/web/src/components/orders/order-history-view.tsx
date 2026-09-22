"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FaBoxOpen, FaTriangleExclamation } from "react-icons/fa6";
import type { OrderListItem, OrderStatusValue } from "@ecommerce/shared";
import { listOrders } from "@/lib/order-api";
import { formatRupiah } from "@/lib/format";

const FALLBACK_IMAGE = "/product-placeholder.svg";

const TABS: { label: string; value: OrderStatusValue | "all" }[] = [
  { label: "Semua", value: "all" },
  { label: "Belum bayar", value: "pending_payment" },
  { label: "Diproses", value: "processing" },
  { label: "Dikirim", value: "shipped" },
  { label: "Selesai", value: "completed" },
  { label: "Dibatalkan", value: "cancelled" },
];

const STATUS_LABEL: Record<OrderStatusValue, string> = {
  pending_payment: "Menunggu pembayaran",
  paid: "Dibayar",
  processing: "Diproses",
  shipped: "Dikirim",
  delivered: "Tiba di tujuan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  return_requested: "Retur diajukan",
  refunded: "Dana dikembalikan",
};

export function OrderHistoryView() {
  const [tab, setTab] = useState<OrderStatusValue | "all">("all");
  const [orders, setOrders] = useState<OrderListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOrders(null);
    setError(null);
    listOrders(tab === "all" ? {} : { status: tab })
      .then((res) => setOrders(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : "Gagal memuat riwayat order."));
  }, [tab]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">Riwayat Pesanan</h1>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={t.value === tab ? "pill pill-active" : "pill"}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="alert">
          <FaTriangleExclamation aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {orders === null && !error && <p className="muted">Memuat pesanan...</p>}

      {orders !== null && orders.length === 0 && (
        <div className="glass flex flex-col items-center gap-2 p-10 text-center">
          <FaBoxOpen aria-hidden className="text-2xl text-[var(--muted)]" />
          <p className="font-semibold text-[var(--fg)]">Belum ada pesanan</p>
          <p className="text-sm text-[var(--muted)]">Pesanan yang kamu buat akan muncul di sini.</p>
          <Link href="/" className="btn mt-2">
            Mulai belanja
          </Link>
        </div>
      )}

      {orders !== null && orders.length > 0 && (
        <ul className="!m-0 flex flex-col gap-3 !p-0 !shadow-none">
          {orders.map((order) => (
            <li key={order.id} className="card">
              <Link href={`/orders/${order.id}`} className="flex flex-col gap-2 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[var(--fg)]">{order.sellerName}</span>
                  <span className="pill">{STATUS_LABEL[order.status]}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="clay-inset relative h-14 w-14 shrink-0 overflow-hidden">
                    <Image
                      src={order.thumbnailUrl ?? FALLBACK_IMAGE}
                      alt={order.orderNo}
                      fill
                      sizes="56px"
                      className="object-cover"
                      unoptimized={!order.thumbnailUrl}
                    />
                  </div>
                  <div className="flex flex-1 flex-col text-sm">
                    <span className="muted small">{order.orderNo}</span>
                    <span className="text-[var(--muted)]">{order.itemCount} item</span>
                  </div>
                  <span className="font-bold text-[var(--fg)]">{formatRupiah(order.total)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
