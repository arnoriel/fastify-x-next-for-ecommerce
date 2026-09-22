"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FaCircleCheck, FaClock, FaTriangleExclamation } from "react-icons/fa6";
import type { CheckoutView } from "@ecommerce/shared";
import { pollCheckout } from "@/lib/checkout-status-api";
import { formatRupiah } from "@/lib/format";

const POLL_INTERVAL_MS = 4000;
const FINAL_STATUSES = new Set(["paid", "expired", "failed", "cancelled"]);

export function PaymentStatusView({ checkout: initial }: { checkout: CheckoutView }) {
  const router = useRouter();
  const [checkout, setCheckout] = useState(initial);

  useEffect(() => {
    // T-06B: polling sampai status final (paid/expired/failed/cancelled) — begitu webhook
    // Duitku (T-07) mengubah status di backend, halaman ini ter-update otomatis tanpa refresh.
    if (FINAL_STATUSES.has(checkout.status)) return;
    const interval = setInterval(() => {
      pollCheckout(checkout.id)
        .then(setCheckout)
        .catch(() => {
          // polling gagal sementara (network) — coba lagi di interval berikutnya.
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [checkout.id, checkout.status]);

  useEffect(() => {
    // Paid → auto-redirect ke riwayat order setelah beri waktu buyer melihat konfirmasi sekilas.
    if (checkout.status !== "paid") return;
    const timeout = setTimeout(() => router.push("/orders"), 2500);
    return () => clearTimeout(timeout);
  }, [checkout.status, router]);

  if (checkout.status === "paid") {
    return (
      <div className="flex flex-col gap-4">
        <div className="glass flex flex-col items-center gap-3 p-10 text-center">
          <FaCircleCheck aria-hidden className="text-2xl text-[var(--up)]" />
          <p className="font-semibold text-[var(--fg)]">Pembayaran berhasil!</p>
          <p className="text-sm text-[var(--muted)]">
            Invoice <strong>{checkout.invoiceNo}</strong> — {formatRupiah(checkout.grandTotal)}
          </p>
          <p className="muted small">Mengarahkan ke riwayat pesanan...</p>
        </div>
      </div>
    );
  }

  if (checkout.status === "expired" || checkout.status === "failed" || checkout.status === "cancelled") {
    const label = checkout.status === "expired" ? "Kedaluwarsa" : checkout.status === "failed" ? "Gagal" : "Dibatalkan";
    return (
      <div className="flex flex-col gap-4">
        <div className="glass flex flex-col items-center gap-3 p-10 text-center">
          <FaTriangleExclamation aria-hidden className="text-2xl text-[var(--down)]" />
          <p className="font-semibold text-[var(--fg)]">Pembayaran {label.toLowerCase()}</p>
          <p className="text-sm text-[var(--muted)]">
            Invoice <strong>{checkout.invoiceNo}</strong> tidak berhasil diselesaikan.
          </p>
          <div className="flex gap-2 pt-2">
            <Link href="/cart" className="btn">
              Kembali ke Keranjang
            </Link>
            <Link href="/checkout" className="btn-dashed">
              Coba Bayar Lagi
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // pending — status default menunggu webhook T-07.
  return (
    <div className="flex flex-col gap-4">
      <div className="glass flex flex-col items-center gap-3 p-10 text-center">
        <FaClock aria-hidden className="text-2xl text-[var(--muted)]" />
        <p className="font-semibold text-[var(--fg)]">Menunggu pembayaran</p>
        <p className="text-sm text-[var(--muted)]">
          Invoice <strong>{checkout.invoiceNo}</strong> — {formatRupiah(checkout.grandTotal)}
        </p>
        {checkout.paymentUrl ? (
          <a href={checkout.paymentUrl} className="btn mt-2" target="_blank" rel="noopener noreferrer">
            Bayar Sekarang
          </a>
        ) : (
          <p className="muted small mt-2">
            Instruksi pembayaran sedang disiapkan. Halaman ini akan ter-update otomatis begitu
            tersedia.
          </p>
        )}
      </div>

      {checkout.orders.map((order) => (
        <section key={order.id} className="card">
          <div className="flex items-center justify-between py-2">
            <h2 className="text-sm font-semibold text-[var(--fg)]">{order.sellerName}</h2>
            <span className="pill">{order.orderNo}</span>
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
      ))}

      <ul className="card">
        <li>
          <span className="font-semibold text-[var(--fg)]">Grand total</span>
          <span className="text-lg font-bold text-[var(--fg)]">{formatRupiah(checkout.grandTotal)}</span>
        </li>
      </ul>
    </div>
  );
}
