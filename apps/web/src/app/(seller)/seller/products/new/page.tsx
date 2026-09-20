import type { Metadata } from "next";
import { ProductForm } from "@/components/seller/product-form";
import { env } from "@/env";

export const metadata: Metadata = { title: "Tambah produk" };
export const dynamic = "force-dynamic";

async function getCategories() {
  const res = await fetch(new URL("/api/categories", env.NEXT_PUBLIC_API_URL), { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json()) as { items: { id: string; name: string }[] };
  return data.items;
}

export default async function NewProductPage() {
  const categories = await getCategories();
  return <ProductForm categories={categories} />;
}
