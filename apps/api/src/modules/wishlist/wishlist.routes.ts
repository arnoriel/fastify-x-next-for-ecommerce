/**
 * T-12: wishlist. Aksi bersifat IDEMPOTEN (PUT = pasti ada, DELETE = pasti tidak ada) — klik ganda
 * atau retry jaringan tidak membalik state seperti "toggle" murni.
 *   GET    /api/wishlist            daftar produk (paginasi)
 *   GET    /api/wishlist/ids        semua id produk di wishlist (untuk ikon hati di grid)
 *   PUT    /api/wishlist/:productId tambah
 *   DELETE /api/wishlist/:productId hapus
 */

import type { FastifyPluginAsync } from "fastify";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  WISHLIST_MAX,
  listWishlistQuerySchema,
  wishlistIdsSchema,
  wishlistResponseSchema,
  wishlistStateSchema,
} from "@ecommerce/shared";
import { db, schema } from "../../db";
import { httpError } from "../../lib/http-error";
import { pageOffset } from "../../lib/sql";
import { requireAuth } from "../../plugins/auth";
import { serializeProductWithVariants } from "../catalog/product.routes";

const productParams = z.object({ productId: z.string().min(1) });

export const wishlistRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/wishlist", { preHandler: requireAuth }, async (req) => {
    const userId = req.user!.id;
    const query = listWishlistQuerySchema.parse(req.query);
    // Produk yang sudah dihapus (soft delete) tidak ditampilkan; nonaktif/habis tetap tampil dengan penanda.
    const where = and(eq(schema.wishlists.userId, userId), isNull(schema.products.deletedAt));

    const [rows, [totalRow]] = await Promise.all([
      db
        .select({ product: schema.products, addedAt: schema.wishlists.createdAt })
        .from(schema.wishlists)
        .innerJoin(schema.products, eq(schema.wishlists.productId, schema.products.id))
        .where(where)
        .orderBy(desc(schema.wishlists.createdAt), desc(schema.wishlists.id))
        .limit(query.pageSize)
        .offset(pageOffset(query.page, query.pageSize)),
      db
        .select({ n: count() })
        .from(schema.wishlists)
        .innerJoin(schema.products, eq(schema.wishlists.productId, schema.products.id))
        .where(where),
    ]);

    const variants = rows.length
      ? await db.query.productVariants.findMany({
          where: (v, { inArray }) => inArray(v.productId, rows.map((r) => r.product.id)),
        })
      : [];

    return wishlistResponseSchema.parse({
      items: rows.map((r) => {
        const own = variants.filter((v) => v.productId === r.product.id);
        return {
          product: serializeProductWithVariants(r.product, own),
          available: r.product.status === "active" && own.some((v) => v.isActive && v.stock > 0),
          addedAt: r.addedAt.toISOString(),
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      total: totalRow?.n ?? 0,
    });
  });

  app.get("/api/wishlist/ids", { preHandler: requireAuth }, async (req) => {
    const rows = await db
      .select({ productId: schema.wishlists.productId })
      .from(schema.wishlists)
      .where(eq(schema.wishlists.userId, req.user!.id))
      .limit(WISHLIST_MAX);
    return wishlistIdsSchema.parse({ ids: rows.map((r) => r.productId) });
  });

  app.put("/api/wishlist/:productId", { preHandler: requireAuth }, async (req) => {
    const userId = req.user!.id;
    const { productId } = productParams.parse(req.params);

    const product = await db.query.products.findFirst({
      where: (p, { and: andd, eq: eqq, isNull: isNul }) => andd(eqq(p.id, productId), eqq(p.status, "active"), isNul(p.deletedAt)),
      columns: { id: true },
    });
    if (!product) throw httpError(404, "PRODUCT_NOT_FOUND", "Produk tidak ditemukan.");

    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(schema.wishlists).where(eq(schema.wishlists.userId, userId));
    const already = await db.query.wishlists.findFirst({
      where: (w, { and: andd, eq: eqq }) => andd(eqq(w.userId, userId), eqq(w.productId, productId)),
      columns: { id: true },
    });
    if (!already && n >= WISHLIST_MAX) {
      throw httpError(409, "WISHLIST_FULL", `Wishlist penuh (maksimal ${WISHLIST_MAX} produk). Hapus beberapa produk dulu.`);
    }

    // Unique (user, product) + DO NOTHING: dua request bersamaan tidak menghasilkan duplikat maupun error.
    await db.insert(schema.wishlists).values({ userId, productId }).onConflictDoNothing();
    return wishlistStateSchema.parse({ wishlisted: true });
  });

  app.delete("/api/wishlist/:productId", { preHandler: requireAuth }, async (req) => {
    const { productId } = productParams.parse(req.params);
    await db
      .delete(schema.wishlists)
      .where(and(eq(schema.wishlists.userId, req.user!.id), eq(schema.wishlists.productId, productId)));
    return wishlistStateSchema.parse({ wishlisted: false });
  });
};
