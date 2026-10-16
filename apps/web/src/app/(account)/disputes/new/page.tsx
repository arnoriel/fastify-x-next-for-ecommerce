import type { Metadata } from "next";
import Link from "next/link";
import { DisputeForm } from "@/components/dispute/dispute-form";

export const metadata: Metadata = { title: "Laporkan Masalah" };
export const dynamic = "force-dynamic";

export default async function NewDisputePage({ searchParams }: { searchParams: Promise<{ orderId?: string | string[] }> }) {
  const raw = (await searchParams).orderId;
  const orderId = (Array.isArray(raw) ? raw[0] : raw)?.trim();

  // Dibuka tanpa pesanan (alamat diketik manual / link lama) → arahkan memilih pesanan, bukan form kosong.
  if (!orderId) {
    return (
      <section className="glass flex flex-col items-center gap-3 p-10 text-center">
        <h1 className="text-lg font-extrabold text-[var(--fg)]">Pilih pesanan yang bermasalah</h1>
        <p className="text-sm text-[var(--muted)]">Laporan dibuat dari halaman detail pesanan. Buka pesanannya lalu pilih Laporkan masalah.</p>
        <Link href="/orders" className="btn">
          Lihat pesanan saya
        </Link>
      </section>
    );
  }
  return <DisputeForm orderId={orderId} />;
}
