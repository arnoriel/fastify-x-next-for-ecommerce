"use client";

import { useEffect, useState } from "react";
import { FaCircleCheck, FaTriangleExclamation } from "react-icons/fa6";
import type { OrderDetail, OrderStatusValue } from "@ecommerce/shared";
import { confirmOrderReceived, getOrder } from "@/lib/order-api";
import { formatRupiah } from "@/lib/format";
import { TrackingTimeline } from "./tracking-timeline";

/** Interval refresh otomatis selama pesanan masih bergerak (server membatasi sinkron ke kurir tiap ≥3 menit). */
const TRACKING_POLL_MS = 30_000;
const POLLED_STATUSES: readonly OrderStatusValue[] = ["paid", "processing", "shipped"];

const STATUS_LABEL: Record<OrderStatusValue, string> = {
  pending_payment: "Menunggu pembayaran",
  paid: "Dibayar",
  processing: "Diproses penjual",
  shipped: "Dikirim",
  delivered: "Tiba di tujuan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  return_requested: "Retur diajukan",
  refunded: "Dana dikembalikan",
};

export function OrderDetailView({ order: initial }: { order: OrderDetail }) {
  const [order, setOrder] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  // T-08: perubahan status pengiriman (webhook Biteship) tampil tanpa buyer perlu reload manual.
  // Berhenti saat tab tersembunyi, pesanan sudah tidak bergerak, atau tracking sudah final.
  const shouldPoll = POLLED_STATUSES.includes(order.status) && !order.tracking.isFinal;
  useEffect(() => {
    if (!shouldPoll) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      getOrder(order.id)
        .then(setOrder)
        .catch(() => undefined); // gagal sesekali (offline/timeout) tidak perlu mengganggu buyer
    }, TRACKING_POLL_MS);
    return () => clearInterval(timer);
  }, [shouldPoll, order.id]);

  async function handleConfirm() {
    setConfirming(true);
    setError(null);
    try {
      const updated = await confirmOrderReceived(order.id);
      setOrder(updated);
      setConfirmed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengonfirmasi pesanan.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">Detail Pesanan</h1>
        <span className="pill">{STATUS_LABEL[order.status]}</span>
      </div>

      {confirmed && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--up)] bg-[color-mix(in_srgb,var(--up)_10%,transparent)] px-3.5 py-3 text-sm font-semibold text-[var(--up)]"
        >
          <FaCircleCheck aria-hidden className="shrink-0" />
          <span>Terima kasih! Pesanan dikonfirmasi selesai. Yuk beri review produk.</span>
        </div>
      )}

      {error && (
        <div className="alert flex items-center gap-2" role="alert">
          <FaTriangleExclamation aria-hidden className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="card">
        <div className="flex items-center justify-between py-2">
          <h2 className="text-sm font-semibold text-[var(--fg)]">{order.sellerName}</h2>
          <span className="muted small">{order.orderNo}</span>
        </div>
        <ul className="!m-0 !p-0 !shadow-none">
          {order.items.map((item) => (
            <li key={item.id}>
              <span className="text-sm">
                {item.productName} ({item.variantName}) × {item.quantity}
              </span>
              <span className="text-sm font-medium">{formatRupiah(item.subtotal)}</span>
            </li>
          ))}
        </ul>
      </section>

      {(order.trackingNumber || order.tracking.events.length > 0) && (
        <section className="card">
          <div className="flex items-center justify-between py-2">
            <h2 className="text-sm font-semibold text-[var(--fg)]">Pengiriman</h2>
            {order.tracking.shippingStatusLabel && <span className="pill">{order.tracking.shippingStatusLabel}</span>}
          </div>
          <p className="pb-3 text-sm">
            {order.courierCode?.toUpperCase()} {order.courierService}
            {order.trackingNumber && (
              <>
                {" "}
                — No. Resi: <strong>{order.trackingNumber}</strong>
              </>
            )}
          </p>
          <TrackingTimeline tracking={order.tracking} />
          {order.tracking.trackingLink && (
            <a
              className="small mt-3 inline-block underline"
              href={order.tracking.trackingLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              Lacak di situs kurir
            </a>
          )}
        </section>
      )}

      <section className="card">
        <h2 className="py-2 text-sm font-semibold text-[var(--fg)]">Alamat pengiriman</h2>
        <p className="text-sm">
          {order.shippingAddress.recipientName} — {order.shippingAddress.phone}
          <br />
          {order.shippingAddress.street}, {order.shippingAddress.district}, {order.shippingAddress.city},{" "}
          {order.shippingAddress.province} {order.shippingAddress.postalCode}
        </p>
      </section>

      <ul className="card">
        <li>
          <span className="muted small">Subtotal</span>
          <span className="text-sm">{formatRupiah(order.subtotal)}</span>
        </li>
        <li>
          <span className="muted small">Ongkos kirim</span>
          <span className="text-sm">{formatRupiah(order.shippingCost)}</span>
        </li>
        {order.discount > 0 && (
          <li>
            <span className="muted small">Diskon</span>
            <span className="text-sm text-[var(--up)]">-{formatRupiah(order.discount)}</span>
          </li>
        )}
        <li>
          <span className="font-semibold text-[var(--fg)]">Total</span>
          <span className="text-lg font-bold text-[var(--fg)]">{formatRupiah(order.total)}</span>
        </li>
      </ul>

      {order.canConfirmReceived && !confirmed && (
        <button type="button" className="btn" disabled={confirming} onClick={() => void handleConfirm()}>
          {confirming ? "Memproses..." : "Konfirmasi Terima Barang"}
        </button>
      )}

      {(order.canReview || confirmed) && (
        <p className="muted small text-center">Fitur beri review akan segera tersedia di halaman ini.</p>
      )}
    </div>
  );
}