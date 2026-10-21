import { z } from "zod";
import { productWithVariantsSchema } from "./catalog";

/** Batas per user — cegah list tak terbatas & query berat. */
export const WISHLIST_MAX = 200;

export const listWishlistQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});
export type ListWishlistQuery = z.infer<typeof listWishlistQuerySchema>;

export const wishlistItemSchema = z.object({
  product: productWithVariantsSchema,
  /** false = produk sudah nonaktif / stok habis — tetap tampil supaya buyer bisa menghapusnya. */
  available: z.boolean(),
  addedAt: z.iso.datetime(),
});
export type WishlistItem = z.infer<typeof wishlistItemSchema>;

export const wishlistResponseSchema = z.object({
  items: z.array(wishlistItemSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export type WishlistResponse = z.infer<typeof wishlistResponseSchema>;

/** Semua id produk di wishlist user — untuk menyalakan ikon hati di grid tanpa request per kartu. */
export const wishlistIdsSchema = z.object({ ids: z.array(z.string()) });
export type WishlistIds = z.infer<typeof wishlistIdsSchema>;

export const wishlistStateSchema = z.object({ wishlisted: z.boolean() });
export type WishlistState = z.infer<typeof wishlistStateSchema>;
