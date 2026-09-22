"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FaCircleCheck, FaClock, FaTriangleExclamation } from "react-icons/fa6";
import type { SellerOnboardingStatus } from "@ecommerce/shared";
import { getSellerOnboardingStatus } from "@/lib/seller-onboarding-api";

const POLL_INTERVAL_MS = 5000;

export function SellerOnboardingStatusView({ initial }: { initial: SellerOnboardingStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);

  useEffect(() => {
    // T-03B: polling ringan sampai status berubah dari pending — begitu admin approve/reject,
    // buyer (tab masih terbuka) otomatis melihat perubahan tanpa reload manual.
    if (status.status !== "pending") return;
    const interval = setInterval(() => {
      getSellerOnboardingStatus()
        .then((next) => {
          if (next && next.status !== "pending") setStatus(next);
        })
        .catch(() => {
          // polling gagal sementara (network) — coba lagi di interval berikutnya, jangan crash UI.
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [status.status]);

  if (status.status === "pending") {
    return (
      <div className="glass flex flex-col items-center gap-3 p-10 text-center">
        <FaClock aria-hidden className="text-2xl text-[var(--muted)]" />
        <p className="font-semibold text-[var(--fg)]">Menunggu persetujuan</p>
        <p className="text-sm text-[var(--muted)]">
          Pengajuan toko <strong>{status.storeName}</strong> sedang ditinjau oleh Admin. Halaman ini akan
          otomatis ter-update begitu ada keputusan.
        </p>
      </div>
    );
  }

  if (status.status === "approved") {
    return (
      <div className="glass flex flex-col items-center gap-3 p-10 text-center">
        <FaCircleCheck aria-hidden className="text-2xl text-[var(--up)]" />
        <p className="font-semibold text-[var(--fg)]">Toko disetujui!</p>
        <p className="text-sm text-[var(--muted)]">
          Selamat, toko <strong>{status.storeName}</strong> sudah aktif.
        </p>
        <button type="button" className="btn mt-2" onClick={() => router.push("/seller/products/new")}>
          Buka Dashboard Toko
        </button>
      </div>
    );
  }

  // rejected
  return (
    <div className="glass flex flex-col items-center gap-3 p-10 text-center">
      <FaTriangleExclamation aria-hidden className="text-2xl text-[var(--down)]" />
      <p className="font-semibold text-[var(--fg)]">Pengajuan ditolak</p>
      {status.rejectionReason && <p className="text-sm text-[var(--muted)]">Alasan: {status.rejectionReason}</p>}
      <Link href="/seller/onboarding" className="btn mt-2">
        Ajukan Ulang
      </Link>
    </div>
  );
}
