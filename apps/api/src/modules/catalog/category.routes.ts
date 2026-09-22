import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { createCategorySchema, type Category, updateCategorySchema } from "@ecommerce/shared";
import { db, schema } from "../../db";
import { httpError } from "../../lib/http-error";
import { uniqueSlug } from "../../lib/slug";
import { requireRole } from "../../plugins/auth";

function serializeCategory(row: typeof schema.categories.$inferSelect): Category {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    slug: row.slug,
    iconUrl: row.iconUrl,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    attributes: row.attributes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function assertParentValid(parentId: string | null | undefined, selfId?: string) {
  if (!parentId) return;
  if (parentId === selfId) {
    throw httpError(400, "INVALID_PARENT", "Kategori tidak bisa menjadi parent dirinya sendiri.");
  }
  const parent = await db.query.categories.findFirst({ where: (c, { eq: eqq }) => eqq(c.id, parentId) });
  if (!parent) throw httpError(404, "PARENT_NOT_FOUND", "Kategori induk tidak ditemukan.");
  // Cegah circular ref sederhana: parent yang dipilih tidak boleh salah satu descendant dari selfId.
  if (selfId) {
    let cursor = parent;
    while (cursor.parentId) {
      if (cursor.parentId === selfId) {
        throw httpError(400, "CIRCULAR_PARENT", "Tidak boleh membuat relasi kategori melingkar.");
      }
      const next = await db.query.categories.findFirst({ where: (c, { eq: eqq }) => eqq(c.id, cursor.parentId!) });
      if (!next) break;
      cursor = next;
    }
  }
}

export const categoryRoutes: FastifyPluginAsync = async (app) => {
  // Publik: dipakai homepage/kategori browsing (buyer & guest).
  app.get("/api/categories", async () => {
    const rows = await db.query.categories.findMany({
      where: (c, { eq: eqq }) => eqq(c.isActive, true),
      orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.name)],
    });
    return { items: rows.map(serializeCategory) };
  });

  app.get("/api/categories/:id", async (req) => {
    const { id } = req.params as { id: string };
    const row = await db.query.categories.findFirst({ where: (c, { eq: eqq }) => eqq(c.id, id) });
    if (!row) throw httpError(404, "CATEGORY_NOT_FOUND", "Kategori tidak ditemukan.");
    return serializeCategory(row);
  });

  app.post("/api/admin/categories", { preHandler: requireRole(["admin"]) }, async (req, reply) => {
    const input = createCategorySchema.parse(req.body);
    await assertParentValid(input.parentId ?? null);

    const slugBase = input.slug ?? input.name;
    const slug = await uniqueSlug(slugBase, async (candidate) => {
      const found = await db.query.categories.findFirst({ where: (c, { eq: eqq }) => eqq(c.slug, candidate) });
      return Boolean(found);
    });

    const [row] = await db
      .insert(schema.categories)
      .values({
        name: input.name,
        slug,
        parentId: input.parentId ?? null,
        iconUrl: input.iconUrl ?? null,
        sortOrder: input.sortOrder ?? 0,
        attributes: input.attributes,
      })
      .returning();

    if (!row) throw httpError(500, "CATEGORY_CREATE_FAILED", "Gagal membuat kategori.");
    reply.code(201);
    return serializeCategory(row);
  });

  app.patch("/api/admin/categories/:id", { preHandler: requireRole(["admin"]) }, async (req) => {
    const { id } = req.params as { id: string };
    const input = updateCategorySchema.parse(req.body);

    const existing = await db.query.categories.findFirst({ where: (c, { eq: eqq }) => eqq(c.id, id) });
    if (!existing) throw httpError(404, "CATEGORY_NOT_FOUND", "Kategori tidak ditemukan.");

    if (input.parentId !== undefined) await assertParentValid(input.parentId, id);

    let slug = existing.slug;
    if (input.slug || input.name) {
      const base = input.slug ?? input.name ?? existing.name;
      const normalizedBase = input.slug ?? base;
      if (normalizedBase !== existing.slug) {
        slug = await uniqueSlug(normalizedBase, async (candidate) => {
          const found = await db.query.categories.findFirst({
            where: (c, { and: andd, eq: eqq, ne: nee }) => andd(eqq(c.slug, candidate), nee(c.id, id)),
          });
          return Boolean(found);
        });
      }
    }

    const [row] = await db
      .update(schema.categories)
      .set({
        name: input.name ?? existing.name,
        slug,
        parentId: input.parentId === undefined ? existing.parentId : input.parentId,
        iconUrl: input.iconUrl === undefined ? existing.iconUrl : input.iconUrl,
        sortOrder: input.sortOrder ?? existing.sortOrder,
        isActive: input.isActive ?? existing.isActive,
        attributes: input.attributes ?? existing.attributes,
      })
      .where(eq(schema.categories.id, id))
      .returning();

    if (!row) throw httpError(500, "CATEGORY_UPDATE_FAILED", "Gagal memperbarui kategori.");
    return serializeCategory(row);
  });

  app.delete("/api/admin/categories/:id", { preHandler: requireRole(["admin"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const existing = await db.query.categories.findFirst({ where: (c, { eq: eqq }) => eqq(c.id, id) });
    if (!existing) throw httpError(404, "CATEGORY_NOT_FOUND", "Kategori tidak ditemukan.");

    const child = await db.query.categories.findFirst({ where: (c, { eq: eqq }) => eqq(c.parentId, id) });
    if (child) throw httpError(409, "CATEGORY_HAS_CHILDREN", "Hapus/pindahkan sub-kategori terlebih dahulu.");

    const product = await db.query.products.findFirst({
      where: (p, { and: andd, eq: eqq, isNull }) => andd(eqq(p.categoryId, id), isNull(p.deletedAt)),
    });
    if (product) {
      throw httpError(409, "CATEGORY_HAS_PRODUCTS", "Kategori masih dipakai produk aktif, tidak bisa dihapus.");
    }

    await db.delete(schema.categories).where(eq(schema.categories.id, id));
    reply.code(204);
  });
};