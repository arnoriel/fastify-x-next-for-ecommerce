/**
 * T-12: review & rating produk. Aturan inti:
 *   - hanya pembeli item tsb, hanya saat order `completed`, 1 review per item (unique index DB)
 *   - rating/jumlah review produk (denormalisasi di `products`) dihitung ulang dari tabel reviews
 *     di bawah row lock produk → dua review bersamaan tidak saling menimpa
 *   - buyer bisa mengubah review sampai REVIEW_EDIT_WINDOW_DAYS hari
 * Non-pemilik selalu mendapat 404 (bukan 403) agar keberadaan item/review orang lain tidak bocor.
 */

import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  REVIEW_EDIT_WINDOW_DAYS,
  type MyReview,
  type OrderReviewsResponse,
  type ProductReviewsQuery,
  type ProductReviewsResponse,
  type ReviewInput,
  type ReviewSummary,
  myReviewSchema,
  orderReviewsResponseSchema,
  productReviewsResponseSchema,
} from "@ecommerce/shared";
import { db, schema } from "../../db";
import { httpError } from "../../lib/http-error";
import { uniqueViolationConstraint } from "../../lib/pg-error";
import { pageOffset } from "../../lib/sql";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ReviewRow = typeof schema.reviews.$inferSelect;

const DAY_MS = 86_400_000;

/** "Budi Santoso" → "B***o": cukup dikenali pemilik, tidak membuka identitas ke publik. */
export function maskName(name: string): string {
  const clean = name.trim();
  if (clean.length <= 2) return `${clean.charAt(0) || "P"}*`;
  return `${clean.charAt(0)}***${clean.charAt(clean.length - 1)}`;
}

const canEditReview = (row: Pick<ReviewRow, "createdAt">, now = Date.now()) =>
  now - row.createdAt.getTime() <= REVIEW_EDIT_WINDOW_DAYS * DAY_MS;

function toMyReview(row: ReviewRow): MyReview {
  return myReviewSchema.parse({
    id: row.id,
    orderItemId: row.orderItemId,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
    canEdit: canEditReview(row),
  });
}

/**
 * Hitung ulang rating produk dari semua review. WAJIB dipanggil di dalam transaksi yang sudah
 * mengunci baris produk (`lockProduct`), supaya hasilnya tidak tertimpa review lain yang bersamaan.
 */
async function recomputeProductRating(tx: Tx, productId: string) {
  const [agg] = await tx
    .select({ avg: sql<string>`coalesce(avg(${schema.reviews.rating}), 0)`, n: count() })
    .from(schema.reviews)
    .where(eq(schema.reviews.productId, productId));
  await tx
    .update(schema.products)
    .set({ ratingAvg: Math.round(Number(agg?.avg ?? 0) * 10), ratingCount: agg?.n ?? 0 })
    .where(eq(schema.products.id, productId));
}

const lockProduct = (tx: Tx, productId: string) =>
  tx.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.id, productId)).for("update");

// ---------- Publik: review per produk ----------

export async function listProductReviews(slug: string, query: ProductReviewsQuery): Promise<ProductReviewsResponse> {
  const product = await db.query.products.findFirst({
    where: (p, { and: andd, eq: eqq, isNull: isNul }) => andd(eqq(p.slug, slug), isNul(p.deletedAt)),
    columns: { id: true },
  });
  if (!product) throw httpError(404, "PRODUCT_NOT_FOUND", "Produk tidak ditemukan.");

  const forProduct = eq(schema.reviews.productId, product.id);
  const filtered = query.rating ? and(forProduct, eq(schema.reviews.rating, query.rating)) : forProduct;

  const [rows, distributionRows] = await Promise.all([
    db
      .select({
        id: schema.reviews.id,
        rating: schema.reviews.rating,
        comment: schema.reviews.comment,
        createdAt: schema.reviews.createdAt,
        updatedAt: schema.reviews.updatedAt,
        authorName: schema.users.name,
      })
      .from(schema.reviews)
      .innerJoin(schema.users, eq(schema.reviews.userId, schema.users.id))
      .where(filtered)
      .orderBy(desc(schema.reviews.createdAt), desc(schema.reviews.id))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ rating: schema.reviews.rating, n: count() })
      .from(schema.reviews)
      .where(forProduct)
      .groupBy(schema.reviews.rating),
  ]);

  const distribution = [0, 0, 0, 0, 0];
  for (const row of distributionRows) distribution[row.rating - 1] = row.n;
  const totalAll = distribution.reduce((a, b) => a + b, 0);
  const weighted = distribution.reduce((sum, n, i) => sum + n * (i + 1), 0);
  const summary: ReviewSummary = {
    average: totalAll > 0 ? Math.round((weighted / totalAll) * 10) / 10 : 0,
    count: totalAll,
    distribution,
  };

  return productReviewsResponseSchema.parse({
    items: rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      authorName: maskName(r.authorName),
      createdAt: r.createdAt.toISOString(),
      // Diubah = updatedAt bergeser jauh dari createdAt (selisih kecil = jitter penulisan awal).
      edited: r.updatedAt.getTime() - r.createdAt.getTime() > 1000,
    })),
    page: query.page,
    pageSize: query.pageSize,
    total: query.rating ? (distribution[query.rating - 1] ?? 0) : totalAll,
    summary,
  });
}

// ---------- Buyer: review pada pesanannya ----------

export async function getOrderReviews(userId: string, orderId: string): Promise<OrderReviewsResponse> {
  const order = await db.query.orders.findFirst({
    where: (o, { and: andd, eq: eqq }) => andd(eqq(o.id, orderId), eqq(o.userId, userId)),
    columns: { id: true, status: true },
  });
  if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Pesanan tidak ditemukan.");

  const rows = await db
    .select({ review: schema.reviews })
    .from(schema.reviews)
    .innerJoin(schema.orderItems, eq(schema.reviews.orderItemId, schema.orderItems.id))
    .where(and(eq(schema.orderItems.orderId, orderId), eq(schema.reviews.userId, userId)));

  return orderReviewsResponseSchema.parse({
    canReview: order.status === "completed",
    items: rows.map((r) => toMyReview(r.review)),
  });
}

export async function createReview(userId: string, orderItemId: string, input: ReviewInput): Promise<MyReview> {
  const item = await db.query.orderItems.findFirst({
    where: (i, { eq: eqq }) => eqq(i.id, orderItemId),
    columns: { id: true, productId: true },
    with: { order: { columns: { userId: true, status: true } } },
  });
  if (!item || item.order.userId !== userId) throw httpError(404, "ORDER_ITEM_NOT_FOUND", "Item pesanan tidak ditemukan.");
  if (item.order.status !== "completed") {
    throw httpError(409, "ORDER_NOT_COMPLETED", "Review baru bisa diberikan setelah pesanan selesai.");
  }

  try {
    const row = await db.transaction(async (tx) => {
      await lockProduct(tx, item.productId);
      const [inserted] = await tx
        .insert(schema.reviews)
        .values({
          productId: item.productId,
          orderItemId: item.id,
          userId,
          rating: input.rating,
          comment: input.comment || null,
        })
        .returning();
      await recomputeProductRating(tx, item.productId);
      return inserted!;
    });
    return toMyReview(row);
  } catch (err) {
    // Dua klik/dua tab bersamaan: unique index (order_item) menjamin hanya satu review per item.
    if (uniqueViolationConstraint(err) === "reviews_order_item_uq") {
      throw httpError(409, "REVIEW_ALREADY_EXISTS", "Item ini sudah Anda review.");
    }
    throw err;
  }
}

export async function updateReview(userId: string, reviewId: string, input: ReviewInput): Promise<MyReview> {
  const existing = await db.query.reviews.findFirst({
    where: (r, { and: andd, eq: eqq }) => andd(eqq(r.id, reviewId), eqq(r.userId, userId)),
  });
  if (!existing) throw httpError(404, "REVIEW_NOT_FOUND", "Review tidak ditemukan.");
  if (!canEditReview(existing)) {
    throw httpError(409, "REVIEW_EDIT_EXPIRED", `Review hanya bisa diubah dalam ${REVIEW_EDIT_WINDOW_DAYS} hari setelah dibuat.`);
  }

  const comment = input.comment || null;
  if (existing.rating === input.rating && existing.comment === comment) return toMyReview(existing);

  const row = await db.transaction(async (tx) => {
    await lockProduct(tx, existing.productId);
    const [updated] = await tx
      .update(schema.reviews)
      .set({ rating: input.rating, comment })
      .where(eq(schema.reviews.id, reviewId))
      .returning();
    await recomputeProductRating(tx, existing.productId);
    return updated!;
  });
  return toMyReview(row);
}
