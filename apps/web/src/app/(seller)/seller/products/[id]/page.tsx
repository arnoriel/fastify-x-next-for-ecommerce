import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import type { ProductWithVariants } from "@ecommerce/shared";
import { env } from "@/env";

export const metadata: Metadata = { title: "Detail produk" };
export const dynamic = "force-dynamic";

async function getProduct(id: string): Promise<ProductWithVariants | null> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(new URL(`/api/seller/products/${id}`, env.NEXT_PUBLIC_API_URL), {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

export default async function SellerProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) notFound();

  return (
    <section className="form">
      <h1>{product.name}</h1>
      <p className="muted">
        Status: {product.status} · {product.variants.length} varian
      </p>
      <ul className="card">
        {product.variants.map((v) => (
          <li key={v.id}>
            <span>{v.name}</span>
            <span className="pill">
              Rp{v.price.toLocaleString("id-ID")} · stok {v.stock}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
