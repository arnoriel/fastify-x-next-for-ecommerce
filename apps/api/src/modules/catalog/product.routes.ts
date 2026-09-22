import type { FastifyPluginAsync } from "fastify";
import { and, asc, desc, eq, gte, ilike, isNull, lte, type SQL, sql } from "drizzle-orm";
import {
  createProductSchema,
  presignUploadRequestSchema,
  type Product,
  productListQuerySchema,
  type ProductWithVariants,
  updateProductSchema,
  type Variant,
} from "@ecommerce/shared";
import { db, schema } from "../../db";
import { httpError } from "../../lib/http-error";
import { isOwnedR2Url, presignProductImageUpload } from "../../lib/storage";
import { uniqueSlug } from "../../lib/slug";
import { requireRole } from "../../plugins/auth";

type ProductRow = typeof schema.products.$inferSelect;
type VariantRow = typeof schema.productVariants.$inferSelect;

function serializeVariant(row: VariantRow): Variant {
  return {
    id: row.id,
    productId: row.productId,
    sku: row.sku,
    name: row.name,
    options: row.options,
    price: row.price,
    stock: row.stock,
    weightGram: row.weightGram,
    imageUrl: row.imageUrl,
    isActive: row.isActive,
  };
}

function serializeProduct(row: ProductRow): Product {
  return {
    id: row.id,
    sellerId: row.sellerId,
    categoryId: row.categoryId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    images: row.images,
    attributes: row.attributes,
    minPrice: row.minPrice,
    ratingAvg: row.ratingAvg / 10,
    ratingCount: row.ratingCount,
    soldCount: row.soldCount,
    weightGram: row.weightGram,
    lengthCm: row.lengthCm,
    widthCm: row.widthCm,
    heightCm: row.heightCm,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeProductWithVariants(row: ProductRow, variants: VariantRow[]): ProductWithVariants {
  return { ...serializeProduct(row), variants: variants.map(serializeVariant) };
}

/** Seller aktif milik user login. 403 kalau belum jadi seller / belum approved. */
async function requireApprovedSeller(userId: string) {
  const seller = await db.query.sellers.findFirst({ where: (s, { eq: eqq }) => eqq(s.userId, userId) });
  if (!seller) throw httpError(403, "NOT_A_SELLER", "Anda belum terdaftar sebagai seller.");
  if (seller.status !== "approved") {
    throw httpError(403, "SELLER_NOT_APPROVED", "Toko Anda belum disetujui admin.");
  }
  return seller;
}

async function assertCategoryActive(categoryId: string) {
  const category = await db.query.categories.findFirst({
    where: (c, { and: andd, eq: eqq }) => andd(eqq(c.id, categoryId), eqq(c.isActive, true)),
  });
  if (!category) throw httpError(400, "INVALID_CATEGORY", "Kategori tidak valid atau tidak aktif.");
  return category;
}

/** Semua images[] harus milik bucket R2 kita sendiri — cegah hotlink/URL sembarangan. */
function assertOwnedImages(images: string[]) {
  const bad = images.find((url) => !isOwnedR2Url(url));
  if (bad) throw httpError(400, "INVALID_IMAGE_URL", `URL gambar tidak valid: ${bad}`);
}

function minPriceOf(variants: { price: number }[]): number {
  return variants.length ? Math.min(...variants.map((v) => v.price)) : 0;
}

/** Filter harga/rating + search bersama — dipakai listing publik & seller. */
function buildListingConditions(
  query: { search?: string; categoryId?: string; minPrice?: number; maxPrice?: number; minRating?: number },
  base: SQL[],
): SQL[] {
  const conditions = [...base];
  if (query.categoryId) conditions.push(eq(schema.products.categoryId, query.categoryId));
  if (query.search) conditions.push(ilike(schema.products.name, `%${query.search}%`));
  if (query.minPrice !== undefined) conditions.push(gte(schema.products.minPrice, query.minPrice));
  if (query.maxPrice !== undefined) conditions.push(lte(schema.products.minPrice, query.maxPrice));
  if (query.minRating !== undefined) conditions.push(gte(schema.products.ratingAvg, Math.round(query.minRating * 10)));
  return conditions;
}

/** Whitelist kolom sort — cegah SQL injection lewat query param sembarangan. */
function sortOrderBy(sort: string) {
  switch (sort) {
    case "price_asc":
      return [asc(schema.products.minPrice)];
    case "price_desc":
      return [desc(schema.products.minPrice)];
    case "rating":
      return [desc(schema.products.ratingAvg), desc(schema.products.ratingCount)];
    case "best_selling":
      return [desc(schema.products.soldCount)];
    case "newest":
    case "relevance":
    default:
      return [desc(schema.products.createdAt)];
  }
}

async function loadOwnedProduct(id: string, sellerId: string) {
  const product = await db.query.products.findFirst({
    where: (p, { and: andd, eq: eqq, isNull: isNulll }) => andd(eqq(p.id, id), isNulll(p.deletedAt)),
  });
  if (!product) throw httpError(404, "PRODUCT_NOT_FOUND", "Produk tidak ditemukan.");
  if (product.sellerId !== sellerId) throw httpError(403, "FORBIDDEN", "Produk ini bukan milik toko Anda.");
  return product;
}

export const productRoutes: FastifyPluginAsync = async (app) => {
  // ---------- Publik: listing & detail (buyer/guest) ----------

  app.get("/api/products", async (req) => {
    const query = productListQuerySchema.parse(req.query);
    const conditions = buildListingConditions(query, [
      isNull(schema.products.deletedAt),
      eq(schema.products.status, query.status ?? "active"),
    ]);

    const where = and(...conditions);
    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(schema.products)
        .where(where)
        .orderBy(...sortOrderBy(query.sort))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      db.select({ count: sql<number>`count(*)::int` }).from(schema.products).where(where),
    ]);

    const variantsByProduct = await db.query.productVariants.findMany({
      where: (v, { inArray }) => inArray(v.productId, rows.map((r) => r.id)),
    });

    const items = rows.map((row) =>
      serializeProductWithVariants(
        row,
        variantsByProduct.filter((v) => v.productId === row.id),
      ),
    );

    return { items, page: query.page, pageSize: query.pageSize, total: count };
  });

  app.get("/api/products/:slug", async (req) => {
    const { slug } = req.params as { slug: string };
    const product = await db.query.products.findFirst({
      where: (p, { and: andd, eq: eqq, isNull: isNulll }) => andd(eqq(p.slug, slug), isNulll(p.deletedAt)),
    });
    if (!product) throw httpError(404, "PRODUCT_NOT_FOUND", "Produk tidak ditemukan.");
    const variants = await db.query.productVariants.findMany({
      where: (v, { eq: eqq }) => eqq(v.productId, product.id),
    });
    return serializeProductWithVariants(product, variants);
  });

  // ---------- Seller: presigned upload ----------

  app.post("/api/seller/products/upload-url", { preHandler: requireRole(["seller"]) }, async (req) => {
    const seller = await requireApprovedSeller(req.user!.id);
    const input = presignUploadRequestSchema.parse(req.body);
    return presignProductImageUpload(seller.id, input);
  });

  // ---------- Seller: CRUD produk milik sendiri ----------

  app.get("/api/seller/products", { preHandler: requireRole(["seller"]) }, async (req) => {
    const seller = await requireApprovedSeller(req.user!.id);
    const query = productListQuerySchema.parse(req.query);
    const conditions = [eq(schema.products.sellerId, seller.id), isNull(schema.products.deletedAt)];
    if (query.status) conditions.push(eq(schema.products.status, query.status));
    if (query.search) conditions.push(ilike(schema.products.name, `%${query.search}%`));

    const where = and(...conditions);
    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(schema.products)
        .where(where)
        .orderBy(desc(schema.products.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      db.select({ count: sql<number>`count(*)::int` }).from(schema.products).where(where),
    ]);

    const variantsByProduct = await db.query.productVariants.findMany({
      where: (v, { inArray }) => inArray(v.productId, rows.map((r) => r.id)),
    });

    const items = rows.map((row) =>
      serializeProductWithVariants(
        row,
        variantsByProduct.filter((v) => v.productId === row.id),
      ),
    );

    return { items, page: query.page, pageSize: query.pageSize, total: count };
  });

  app.post("/api/seller/products", { preHandler: requireRole(["seller"]) }, async (req, reply) => {
    const seller = await requireApprovedSeller(req.user!.id);
    const input = createProductSchema.parse(req.body);

    await assertCategoryActive(input.categoryId);
    assertOwnedImages(input.images);

    const slug = await uniqueSlug(input.slug ?? input.name, async (candidate) => {
      const found = await db.query.products.findFirst({ where: (p, { eq: eqq }) => eqq(p.slug, candidate) });
      return Boolean(found);
    });

    const product = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.products)
        .values({
          sellerId: seller.id,
          categoryId: input.categoryId,
          name: input.name,
          slug,
          description: input.description,
          images: input.images,
          attributes: input.attributes,
          weightGram: input.weightGram,
          lengthCm: input.lengthCm ?? null,
          widthCm: input.widthCm ?? null,
          heightCm: input.heightCm ?? null,
          minPrice: minPriceOf(input.variants),
        })
        .returning();

      const variantRows = await tx
        .insert(schema.productVariants)
        .values(
          input.variants.map((v) => ({
            productId: row.id,
            sku: v.sku ?? null,
            name: v.name,
            options: v.options,
            price: v.price,
            stock: v.stock,
            weightGram: v.weightGram ?? null,
            imageUrl: v.imageUrl ?? null,
          })),
        )
        .returning();

      return { row, variantRows };
    });

    reply.code(201);
    return serializeProductWithVariants(product.row, product.variantRows);
  });

  app.get("/api/seller/products/:id", { preHandler: requireRole(["seller"]) }, async (req) => {
    const seller = await requireApprovedSeller(req.user!.id);
    const { id } = req.params as { id: string };
    const product = await loadOwnedProduct(id, seller.id);
    const variants = await db.query.productVariants.findMany({
      where: (v, { eq: eqq }) => eqq(v.productId, product.id),
    });
    return serializeProductWithVariants(product, variants);
  });

  app.patch("/api/seller/products/:id", { preHandler: requireRole(["seller"]) }, async (req) => {
    const seller = await requireApprovedSeller(req.user!.id);
    const { id } = req.params as { id: string };
    const input = updateProductSchema.parse(req.body);
    const existing = await loadOwnedProduct(id, seller.id);

    if (input.categoryId) await assertCategoryActive(input.categoryId);
    if (input.images) assertOwnedImages(input.images);

    let slug = existing.slug;
    if (input.slug || (input.name && input.name !== existing.name)) {
      const base = input.slug ?? input.name!;
      slug = await uniqueSlug(base, async (candidate) => {
        const found = await db.query.products.findFirst({
          where: (p, { and: andd, eq: eqq, ne: nee }) => andd(eqq(p.slug, candidate), nee(p.id, id)),
        });
        return Boolean(found);
      });
    }

    const result = await db.transaction(async (tx) => {
      let variantRows: VariantRow[];

      if (input.variants) {
        const existingVariants = await tx.query.productVariants.findMany({
          where: (v, { eq: eqq }) => eqq(v.productId, id),
        });
        const existingIds = new Set(existingVariants.map((v) => v.id));
        const keepIds = new Set(input.variants.filter((v) => v.id).map((v) => v.id!));

        // Hapus varian yang tidak lagi ada di payload (dianggap dihapus seller).
        const toDelete = [...existingIds].filter((vid) => !keepIds.has(vid));
        if (toDelete.length) {
          await tx.delete(schema.productVariants).where(
            sql`${schema.productVariants.id} = ANY(${toDelete})`,
          );
        }

        variantRows = [];
        for (const v of input.variants) {
          if (v.id && existingIds.has(v.id)) {
            const [updated] = await tx
              .update(schema.productVariants)
              .set({
                sku: v.sku ?? null,
                name: v.name ?? existingVariants.find((e) => e.id === v.id)!.name,
                options: v.options ?? {},
                price: v.price ?? existingVariants.find((e) => e.id === v.id)!.price,
                stock: v.stock ?? existingVariants.find((e) => e.id === v.id)!.stock,
                weightGram: v.weightGram ?? null,
                imageUrl: v.imageUrl ?? null,
                isActive: v.isActive ?? true,
              })
              .where(eq(schema.productVariants.id, v.id))
              .returning();
            variantRows.push(updated);
          } else {
            if (!v.name || v.price === undefined) {
              throw httpError(400, "VALIDATION_ERROR", "Varian baru wajib mengisi name dan price.");
            }
            const [created] = await tx
              .insert(schema.productVariants)
              .values({
                productId: id,
                sku: v.sku ?? null,
                name: v.name,
                options: v.options ?? {},
                price: v.price,
                stock: v.stock ?? 0,
                weightGram: v.weightGram ?? null,
                imageUrl: v.imageUrl ?? null,
              })
              .returning();
            variantRows.push(created);
          }
        }
      } else {
        variantRows = await tx.query.productVariants.findMany({ where: (v, { eq: eqq }) => eqq(v.productId, id) });
      }

      if (variantRows.length === 0) {
        throw httpError(400, "VALIDATION_ERROR", "Produk wajib memiliki minimal 1 varian.");
      }

      const [row] = await tx
        .update(schema.products)
        .set({
          categoryId: input.categoryId ?? existing.categoryId,
          name: input.name ?? existing.name,
          slug,
          description: input.description ?? existing.description,
          status: input.status ?? existing.status,
          images: input.images ?? existing.images,
          attributes: input.attributes ?? existing.attributes,
          weightGram: input.weightGram ?? existing.weightGram,
          lengthCm: input.lengthCm === undefined ? existing.lengthCm : input.lengthCm,
          widthCm: input.widthCm === undefined ? existing.widthCm : input.widthCm,
          heightCm: input.heightCm === undefined ? existing.heightCm : input.heightCm,
          minPrice: minPriceOf(variantRows.filter((v) => v.isActive)),
        })
        .where(eq(schema.products.id, id))
        .returning();

      return { row, variantRows };
    });

    return serializeProductWithVariants(result.row, result.variantRows);
  });

  // Soft delete — order history (FK restrict) tetap valid; produk hilang dari listing publik.
  app.delete("/api/seller/products/:id", { preHandler: requireRole(["seller"]) }, async (req, reply) => {
    const seller = await requireApprovedSeller(req.user!.id);
    const { id } = req.params as { id: string };
    await loadOwnedProduct(id, seller.id);

    await db
      .update(schema.products)
      .set({ deletedAt: new Date(), status: "inactive" })
      .where(eq(schema.products.id, id));

    reply.code(204);
  });
};
