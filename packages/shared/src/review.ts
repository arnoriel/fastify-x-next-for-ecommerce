import { z } from "zod";

export const REVIEW_COMMENT_MAX = 1000;
/** Review masih bisa diubah buyer sampai N hari sejak dibuat. */
export const REVIEW_EDIT_WINDOW_DAYS = 7;

export const reviewRatingSchema = z.number().int("Rating harus bilangan bulat").min(1, "Pilih rating 1–5").max(5, "Pilih rating 1–5");

/** Dipakai untuk membuat DAN mengubah review. Komentar kosong = tanpa komentar. */
export const reviewInputSchema = z.object({
  rating: reviewRatingSchema,
  comment: z.string().trim().max(REVIEW_COMMENT_MAX, `Maksimal ${REVIEW_COMMENT_MAX} karakter`).optional(),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export const productReviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(30).default(10),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});
export type ProductReviewsQuery = z.infer<typeof productReviewsQuerySchema>;

/** Review publik di halaman produk. Nama pembeli disamarkan server-side. */
export const reviewSchema = z.object({
  id: z.string(),
  rating: z.number(),
  comment: z.string().nullable(),
  authorName: z.string(),
  createdAt: z.iso.datetime(),
  edited: z.boolean(),
});
export type Review = z.infer<typeof reviewSchema>;

export const reviewSummarySchema = z.object({
  /** Rata-rata 1 desimal; 0 bila belum ada review. */
  average: z.number(),
  count: z.number(),
  /** Index 0 = jumlah bintang 1 … index 4 = bintang 5. */
  distribution: z.array(z.number()).length(5),
});
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

export const productReviewsResponseSchema = z.object({
  items: z.array(reviewSchema),
  page: z.number(),
  pageSize: z.number(),
  /** Total sesuai filter rating aktif (untuk paginasi); ringkasan di `summary` selalu semua review. */
  total: z.number(),
  summary: reviewSummarySchema,
});
export type ProductReviewsResponse = z.infer<typeof productReviewsResponseSchema>;

/** Review milik buyer sendiri pada 1 item pesanan (halaman detail order). */
export const myReviewSchema = z.object({
  id: z.string(),
  orderItemId: z.string(),
  rating: z.number(),
  comment: z.string().nullable(),
  createdAt: z.iso.datetime(),
  canEdit: z.boolean(),
});
export type MyReview = z.infer<typeof myReviewSchema>;

export const orderReviewsResponseSchema = z.object({
  /** true hanya bila order `completed` — item yang belum direview boleh direview. */
  canReview: z.boolean(),
  items: z.array(myReviewSchema),
});
export type OrderReviewsResponse = z.infer<typeof orderReviewsResponseSchema>;
