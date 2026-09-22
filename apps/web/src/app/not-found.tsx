import Link from "next/link";
import { FaMagnifyingGlass } from "react-icons/fa6";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="glass flex flex-col items-center gap-2 p-10 text-center">
        <FaMagnifyingGlass aria-hidden className="text-2xl text-[var(--muted)]" />
        <p className="font-semibold text-[var(--fg)]">Halaman tidak ditemukan</p>
        <p className="text-sm text-[var(--muted)]">Produk atau halaman yang Anda cari mungkin sudah dihapus.</p>
        <Link href="/" className="btn mt-2">
          Kembali ke beranda
        </Link>
      </div>
    </main>
  );
}