"use client";

import { useState } from "react";
import { FaCircleCheck, FaTriangleExclamation } from "react-icons/fa6";
import type { OrderDetail, OrderStatusValue } from "@ecommerce/shared";
import { confirmOrderReceived } from "@/lib/order-api";
import { formatRupiah } from "@/lib/format";

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
        <div className="alert" style={{ background: "var(--card)" }}>
          <FaCircleCheck aria-hidden />
          <span>Terima kasih! Pesanan dikonfirmasi selesai. Yuk beri review produk.</span>
        </div>
      )}

      {error && (
        <div className="alert">
          <FaTriangleExclamation aria-hidden />
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

      {order.trackingNumber && (
        <section className="card">
          <h2 className="py-2 text-sm font-semibold text-[var(--fg)]">Pengiriman</h2>
          <p className="text-sm">
            {order.courierCode?.toUpperCase()} {order.courierService} — No. Resi:{" "}
            <strong>{order.trackingNumber}</strong>
          </p>
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
