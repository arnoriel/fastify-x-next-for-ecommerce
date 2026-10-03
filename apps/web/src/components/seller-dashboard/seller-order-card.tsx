"use client";

import Image from "next/image";
import { SELLER_STATUS_LABELS, type SellerOrder } from "@ecommerce/shared";
import { formatDateTime, formatRupiah } from "@/lib/format";

const FALLBACK_IMAGE = "/product-placeholder.svg";

export type OrderAction = "ship-booking" | "mark-shipped";

type Props = {
  order: SellerOrder;
  /** Aksi yang sedang berjalan untuk order ini (tombol dinonaktifkan agar tidak double-submit). */
  busyAction: OrderAction | null;
  /** Ada aksi lain yang berjalan di order lain — hindari balapan antar-aksi. */
  disabled: boolean;
  onAction: (order: SellerOrder, action: OrderAction) => void;
};

export function SellerOrderCard({ order, busyAction, disabled, onAction }: Props) {
  const courier = [order.courierCode?.toUpperCase(), order.courierService].filter(Boolean).join(" · ");

  return (
    <li className="card !block !p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-bold text-[var(--fg)]">{order.orderNo}</span>
          <span className="muted small">{formatDateTime(order.createdAt)}</span>
        </div>
        <span className="pill">{SELLER_STATUS_LABELS[order.status]}</span>
      </div>

      <ul className="!m-0 mt-3 flex flex-col gap-2 !p-0 !shadow-none">
        {order.items.map((item) => (
          <li key={item.id} className="!border-t-0 !p-0 flex items-center gap-3">
            <div className="clay-inset relative h-12 w-12 shrink-0 overflow-hidden">
              <Image
                src={item.imageUrl ?? FALLBACK_IMAGE}
                alt={item.productName}
                fill
                sizes="48px"
                className="object-cover"
                unoptimized={!item.imageUrl}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold text-[var(--fg)]">{item.productName}</span>
              <span className="muted small">
                {item.variantName} × {item.quantity}
              </span>
            </div>
            <span className="text-sm text-[var(--fg)]">{formatRupiah(item.subtotal)}</span>
          </li>
        ))}
      </ul>

      <dl className="kv mt-3 text-sm">
        <dt>Penerima</dt>
        <dd>
          {order.recipientName} · {order.recipientPhone}
        </dd>
        <dt>Alamat</dt>
        <dd>{order.shippingAddress}</dd>
        {courier && (
          <>
            <dt>Kurir</dt>
            <dd>{courier}</dd>
          </>
        )}
        {order.trackingNumber && (
          <>
            <dt>No. resi</dt>
            <dd>
              {order.trackingLink ? (
                <a href={order.trackingLink} target="_blank" rel="noopener noreferrer" className="underline">
                  {order.trackingNumber}
                </a>
              ) : (
                order.trackingNumber
              )}
            </dd>
          </>
        )}
        {order.shippingStatusLabel && (
          <>
            <dt>Pengiriman</dt>
            <dd>{order.shippingStatusLabel}</dd>
          </>
        )}
        {order.note && (
          <>
            <dt>Catatan</dt>
            <dd>{order.note}</dd>
          </>
        )}
      </dl>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
        <div className="flex flex-col">
          <span className="muted small">Total (ongkir {formatRupiah(order.shippingCost)})</span>
          <span className="font-bold text-[var(--fg)]">{formatRupiah(order.total)}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {order.canCreateShipment && (
            <button
              type="button"
              className="btn"
              disabled={disabled || busyAction !== null}
              onClick={() => onAction(order, "ship-booking")}
            >
              {busyAction === "ship-booking" ? "Memproses..." : order.status === "paid" ? "Proses & buat resi" : "Buat ulang resi"}
            </button>
          )}
          {order.canMarkShipped && (
            <button
              type="button"
              className="btn"
              disabled={disabled || busyAction !== null}
              onClick={() => onAction(order, "mark-shipped")}
            >
              {busyAction === "mark-shipped" ? "Menyimpan..." : "Tandai sudah dikirim"}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
