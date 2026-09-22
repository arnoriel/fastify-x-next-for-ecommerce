import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FaChevronLeft, FaTriangleExclamation } from "react-icons/fa6";
import { ProductDetailView } from "@/components/product/product-detail-view";
import { getProductBySlug } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const result = await getProductBySlug(slug);
  if (!("product" in result) || !result.product) return { title: "Produk" };
  return { title: result.product.name };
}

export default async function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getProductBySlug(slug);

  // Edge case: slug tidak ada di DB / produk soft-deleted → 404 asli (Next.js not-found).
  if ("notFound" in result && result.notFound) notFound();

  // Edge case: API tidak terjangkau — beda dari 404, jangan bilang "produk tidak ditemukan".
  if (!result.product) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <div className="glass flex flex-col items-center gap-2 p-10 text-center">
          <FaTriangleExclamation aria-hidden className="text-2xl text-[var(--danger)]" />
          <p className="font-semibold text-[var(--fg)]">Tidak bisa memuat produk</p>
          <p className="text-sm text-[var(--muted)]">Server sedang bermasalah. Coba muat ulang halaman.</p>
          <Link href="/" className="btn-ghost mt-2">
            Kembali ke beranda
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <Link href="/" className="btn-ghost inline-flex w-fit items-center gap-1.5 !px-2">
        <FaChevronLeft aria-hidden size={12} />
        Kembali
      </Link>
      <ProductDetailView product={result.product} />
    </main>
  );
}