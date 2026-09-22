import {
  type Category,
  categorySchema,
  type ProductListQuery,
  productListResponseSchema,
  type ProductListResponse,
  type ProductWithVariants,
  productWithVariantsSchema,
  readinessSchema,
  type ReadinessResponse,
} from "@ecommerce/shared";
import { z } from "zod";
import { env } from "@/env";

/** Ambil /ready dari API. `null` = API tidak terjangkau. 503 tetap dibaca (body berisi detail check). */
export async function getApiReadiness(): Promise<ReadinessResponse | null> {
  try {
    const res = await fetch(new URL("/ready", env.NEXT_PUBLIC_API_URL), {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return readinessSchema.parse(await res.json());
  } catch {
    return null;
  }
}

/** Daftar kategori aktif (bento grid homepage). `[]` = API tidak terjangkau / kosong. */
export async function getCategories(): Promise<Category[]> {
  try {
    const res = await fetch(new URL("/api/categories", env.NEXT_PUBLIC_API_URL), {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const parsed = z.object({ items: z.array(categorySchema) }).parse(await res.json());
    return parsed.items;
  } catch {
    return [];
  }
}

/** Detail produk publik via slug (T-04). `null` = tidak ditemukan ATAU API tidak terjangkau — dibedakan lewat notFound flag. */
export async function getProductBySlug(
  slug: string,
): Promise<{ product: ProductWithVariants } | { product: null; notFound: boolean }> {
  try {
    const res = await fetch(new URL(`/api/products/${encodeURIComponent(slug)}`, env.NEXT_PUBLIC_API_URL), {
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return { product: null, notFound: true };
    if (!res.ok) return { product: null, notFound: false };
    return { product: productWithVariantsSchema.parse(await res.json()) };
  } catch {
    return { product: null, notFound: false };
  }
}
export async function getProducts(query: Partial<ProductListQuery>): Promise<ProductListResponse | null> {
  try {
    const url = new URL("/api/products", env.NEXT_PUBLIC_API_URL);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const res = await fetch(url, { next: { revalidate: 30 }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return productListResponseSchema.parse(await res.json());
  } catch {
    return null;
  }
}