"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FaCircleCheck, FaClock, FaRotateRight, FaTriangleExclamation } from "react-icons/fa6";
import type { CheckoutView } from "@ecommerce/shared";
import { initiatePayment, manualCheckStatus, pollCheckout } from "@/lib/checkout-status-api";
import { formatRupiah } from "@/lib/format";

const POLL_INTERVAL_MS = 4000;
// Setelah N menit tanpa bayar, tawarkan manual check ke Midtrans (fallback webhook gagal).
const MANUAL_CHECK_AFTER_MS = 90_000;
const FINAL_STATUSES = new Set(["paid", "expired", "failed", "cancelled"]);

export function PaymentStatusView({ checkout: initial }: { checkout: CheckoutView }) {
  const router = useRouter();
  const [checkout, setCheckout] = useState(initial);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [manualChecking, setManualChecking] = useState(false);
  const startedAt = useRef(Date.now());

  // T-06B: polling sampai status final — begitu webhook Midtrans (T-07) mengubah status
  // di backend, halaman ini ter-update otomatis tanpa refresh manual.
  useEffect(() => {
    if (FINAL_STATUSES.has(checkout.status)) return;
    const interval = setInterval(() => {
      pollCheckout(checkout.id)
        .then((updated) => {
          setCheckout(updated);
        })
        .catch(() => {
          // polling gagal sementara (network) — coba lagi di interval berikutnya.
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [checkout.id, checkout.status]);

  // Paid → auto-redirect ke riwayat order setelah buyer sempat lihat konfirmasi sekilas.
  useEffect(() => {
    if (checkout.status !== "paid") return;
    const timeout = setTimeout(() => router.push("/orders"), 2500);
    return () => clearTimeout(timeout);
  }, [checkout.status, router]);

  // Tawaran manual check setelah lama menunggu (webhook mungkin tidak sampai di dev tanpa tunnel).
  const elapsedMs = Date.now() - startedAt.current;
  const showManualCheck = !FINAL_STATUSES.has(checkout.status) && elapsedMs >= MANUAL_CHECK_AFTER_MS;

  async function handleRetryPayment() {
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const result = await initiatePayment(checkout.id);
      if (result.paymentUrl) {
        window.open(result.paymentUrl, "_blank", "noopener,noreferrer");
        // Juga update local state supaya tombol "Bayar Sekarang" muncul.
        setCheckout((prev) => ({ ...prev, paymentUrl: result.paymentUrl }));
      }
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Gagal menghubungi layanan pembayaran. Coba lagi.");
    } finally {
      setRetrying(false);
    }
  }

  async function handleManualCheck() {
    if (manualChecking) return;
    setManualChecking(true);
    try {
      const result = await manualCheckStatus(checkout.id);
      // Re-poll untuk sinkron state checkout lengkap.
      const updated = await pollCheckout(checkout.id);
      setCheckout(updated);
      if (result.status !== updated.status) {
        // Status berubah — perbarui dari hasil rekonsiliasi.
        setCheckout((prev) => ({ ...prev, status: result.status as CheckoutView["status"] }));
      }
    } catch {
      // silent fail — polling tetap jalan
    } finally {
      setManualChecking(false);
    }
  }

  // ---- Status: PAID ----
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

  // ---- Status: EXPIRED / FAILED / CANCELLED ----
  if (checkout.status === "expired" || checkout.status === "failed" || checkout.status === "cancelled") {
    const label =
      checkout.status === "expired" ? "Kedaluwarsa" : checkout.status === "failed" ? "Gagal" : "Dibatalkan";
    return (
      <div className="flex flex-col gap-4">
        <div className="glass flex flex-col items-center gap-3 p-10 text-center">
          <FaTriangleExclamation aria-hidden className="text-2xl text-[var(--down)]" />
          <p className="font-semibold text-[var(--fg)]">Pembayaran {label.toLowerCase()}</p>
          <p className="text-sm text-[var(--muted)]">
            Invoice <strong>{checkout.invoiceNo}</strong> tidak berhasil diselesaikan.
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Link href="/cart" className="btn">
              Kembali ke Keranjang
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ---- Status: PENDING ----
  return (
    <div className="flex flex-col gap-4">
      <div className="glass flex flex-col items-center gap-3 p-10 text-center">
        <FaClock aria-hidden className="text-2xl text-[var(--muted)]" />
        <p className="font-semibold text-[var(--fg)]">Menunggu pembayaran</p>
        <p className="text-sm text-[var(--muted)]">
          Invoice <strong>{checkout.invoiceNo}</strong> — {formatRupiah(checkout.grandTotal)}
        </p>

        {checkout.paymentUrl ? (
          // paymentUrl sudah ada — buka halaman Midtrans Snap.
          <a href={checkout.paymentUrl} className="btn mt-2" target="_blank" rel="noopener noreferrer">
            Bayar Sekarang
          </a>
        ) : (
          // paymentUrl belum ada (Midtrans sempat down saat checkout dibuat) — tawari retry.
          <div className="flex flex-col items-center gap-2 mt-2">
            <p className="text-sm text-[var(--muted)]">
              Halaman pembayaran belum tersedia. Klik tombol di bawah untuk mencoba lagi.
            </p>
            <button
              className="btn"
              onClick={handleRetryPayment}
              disabled={retrying}
              aria-busy={retrying}
            >
              {retrying ? (
                <span className="flex items-center gap-2">
                  <FaRotateRight aria-hidden className="animate-spin" /> Menghubungi payment gateway...
                </span>
              ) : (
                "Buka Halaman Bayar"
              )}
            </button>
            {retryError && (
              <p role="alert" className="text-sm text-[var(--down)]">
                {retryError}
              </p>
            )}
          </div>
        )}

        {/* Fallback: tawarkan manual check ke Midtrans kalau sudah lama menunggu */}
        {showManualCheck && (
          <button
            className="btn-dashed mt-1 text-sm"
            onClick={handleManualCheck}
            disabled={manualChecking}
            aria-busy={manualChecking}
          >
            {manualChecking ? "Mengecek status..." : "Cek ulang status pembayaran"}
          </button>
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
