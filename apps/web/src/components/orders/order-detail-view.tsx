"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FaCircleCheck, FaTriangleExclamation } from "react-icons/fa6";
import {
  ESCROW_STATUS_LABELS,
  type OrderDetail,
  type OrderStatusValue,
  RETURN_REASON_LABELS,
  RETURN_STATUS_LABELS,
} from "@ecommerce/shared";
import { ChatStartButton } from "@/components/chat/chat-start-button";
import { OrderReviewSection } from "@/components/review/order-review-section";
import { sellerLabel } from "@/lib/features";
import { confirmOrderReceived, getOrder } from "@/lib/order-api";
import { cancelReturn } from "@/lib/return-api";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { TrackingTimeline } from "./tracking-timeline";

/** Interval refresh otomatis selama pesanan masih bergerak (server membatasi sinkron ke kurir tiap ≥3 menit). */
const TRACKING_POLL_MS = 30_000;
const POLLED_STATUSES: readonly OrderStatusValue[] = [
  "paid",
  "processing",
  "shipped",
  "return_requested",
  "refund_pending_manual",
];

const STATUS_LABEL: Record<OrderStatusValue, string> = {
  pending_payment: "Menunggu pembayaran",
  paid: "Dibayar",
  processing: "Diproses penjual",
  shipped: "Dikirim",
  delivered: "Tiba di tujuan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  return_requested: "Retur diajukan",
  refund_pending_manual: "Menunggu refund",
  refunded: "Dana dikembalikan",
};

export function OrderDetailView({ order: initial }: { order: OrderDetail }) {
  const [order, setOrder] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [cancellingReturn, setCancellingReturn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  // T-08: perubahan status pengiriman (webhook Biteship) tampil tanpa buyer perlu reload manual.
  // Berhenti saat tab tersembunyi, pesanan sudah tidak bergerak, atau tracking sudah final.
  const shouldPoll =
    POLLED_STATUSES.includes(order.status) &&
    (order.status === "return_requested" || order.status === "refund_pending_manual" || !order.tracking.isFinal);
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

  async function handleCancelReturn() {
    const request = order.return.request;
    if (!request || cancellingReturn) return;
    setCancellingReturn(true);
    setError(null);
    try {
      await cancelReturn(request.id);
      setOrder(await getOrder(order.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membatalkan pengajuan retur.");
    } finally {
      setCancellingReturn(false);
    }
  }

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
        <div className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div className="flex flex-col">
            <h2 className="text-sm font-semibold text-[var(--fg)]">{sellerLabel(order.sellerName)}</h2>
            <span className="muted small">{order.orderNo}</span>
          </div>
          <ChatStartButton
            target={{ orderId: order.id }}
            loginNext={`/orders/${order.id}`}
            className="btn-ghost !px-3 !py-1.5 text-xs"
          />
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

      {order.dispute.activeId && (
        <section className="glass flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex flex-col">
            <span className="font-semibold text-[var(--fg)]">Ada laporan aktif untuk pesanan ini</span>
            <span className="muted small">Konfirmasi terima barang ditahan sampai laporan selesai atau dibatalkan.</span>
          </div>
          <Link href={`/disputes/${order.dispute.activeId}`} className="btn-ghost">
            Lihat laporan
          </Link>
        </section>
      )}

      {order.return.request && (
        <section className="card !block !p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--fg)]">Retur & refund</h2>
            <span className="pill">{RETURN_STATUS_LABELS[order.return.request.status]}</span>
          </div>
          <p className="muted small mt-1">
            {order.return.request.returnNo} · {RETURN_REASON_LABELS[order.return.request.reason]} ·{" "}
            {formatRupiah(order.return.request.amount)}
          </p>
          <p className="text-sm mt-1">{order.return.request.description}</p>
          {order.return.request.resolutionNote && (
            <p className="muted small mt-1">Catatan penjual/admin: {order.return.request.resolutionNote}</p>
          )}
          {order.return.request.refundReference && (
            <p className="muted small mt-1">Referensi refund: {order.return.request.refundReference}</p>
          )}
          {order.return.canCancel && (
            <button
              type="button"
              className="btn-ghost mt-3"
              disabled={cancellingReturn}
              onClick={() => void handleCancelReturn()}
            >
              {cancellingReturn ? "Membatalkan..." : "Batalkan pengajuan retur"}
            </button>
          )}
        </section>
      )}

      {(order.return.windowEndsAt || order.escrow.status !== "pending") && (
        <section className="card !block !p-4">
          <h2 className="text-sm font-semibold text-[var(--fg)]">Perlindungan pembeli</h2>
          <p className="muted small mt-1">{ESCROW_STATUS_LABELS[order.escrow.status]}</p>
          {order.escrow.status === "held" && order.escrow.releaseAt && (
            <p className="muted small">
              Dana baru diteruskan ke penjual setelah {formatDateTime(order.escrow.releaseAt)}.
            </p>
          )}
          {order.return.windowEndsAt && (
            <p className="muted small">
              Retur/komplain masih bisa diajukan sampai {formatDateTime(order.return.windowEndsAt)}.
            </p>
          )}
        </section>
      )}

      {order.canConfirmReceived && !confirmed && (
        <button type="button" className="btn" disabled={confirming} onClick={() => void handleConfirm()}>
          {confirming ? "Memproses..." : "Konfirmasi Terima Barang"}
        </button>
      )}

      {order.return.canRequest && !order.return.request && (
        <Link href={`/orders/${order.id}/return`} className="btn-ghost text-center">
          Ajukan Retur
        </Link>
      )}
      {!order.return.canRequest &&
        !order.return.request &&
        order.return.blockedReason &&
        ["shipped", "delivered", "completed", "refund_pending_manual"].includes(order.status) && (
          <p className="muted small text-center">{order.return.blockedReason}</p>
        )}

      {order.dispute.canOpen && (
        <Link href={`/disputes/new?orderId=${encodeURIComponent(order.id)}`} className="btn-ghost text-center">
          Laporkan masalah
        </Link>
      )}
      {!order.dispute.canOpen && !order.dispute.activeId && order.dispute.blockedReason && ["paid", "processing", "shipped", "delivered", "completed"].includes(order.status) && (
        <p className="muted small text-center">{order.dispute.blockedReason}</p>
      )}

      <OrderReviewSection orderId={order.id} items={order.items} enabled={order.status === "completed"} />
    </div>
  );
}