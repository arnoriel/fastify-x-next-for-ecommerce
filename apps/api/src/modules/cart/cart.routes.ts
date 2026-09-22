import type { FastifyPluginAsync } from "fastify";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { addCartItemSchema, type CartGroup, type CartResponse, updateCartItemSchema } from "@ecommerce/shared";
import { db, schema } from "../../db";
import { httpError } from "../../lib/http-error";
import { requireAuth } from "../../plugins/auth";

// T-03 [V3]: cart guest (disimpan client, localStorage) dikirim ke sini saat login sukses.
const mergeCartSchema = z.object({
  items: z.array(z.object({ variantId: z.string().min(1), quantity: z.number().int().min(1).max(999) })).max(100),
});

/** Cart user login, dibuat otomatis kalau belum ada (lazy create — 1 user selalu punya <=1 cart). */
async function getOrCreateCart(userId: string) {
  const existing = await db.query.carts.findFirst({ where: (c, { eq: eqq }) => eqq(c.userId, userId) });
  if (existing) return existing;

  const [created] = await db
    .insert(schema.carts)
    .values({ userId })
    .onConflictDoNothing({ target: schema.carts.userId })
    .returning();
  if (created) return created;

  // Race: request paralel lain sudah membuat cart di antara SELECT dan INSERT di atas.
  const row = await db.query.carts.findFirst({ where: (c, { eq: eqq }) => eqq(c.userId, userId) });
  if (!row) throw httpError(500, "CART_INIT_FAILED", "Gagal menyiapkan keranjang.");
  return row;
}

/** Bentuk response cart (grouped per seller) dari cart id. Item produk terhapus/nonaktif tetap tampil (flag isAvailable=false) agar buyer sadar & bisa hapus manual. */
async function buildCartResponse(cartId: string): Promise<CartResponse> {
  const items = await db.query.cartItems.findMany({
    where: (ci, { eq: eqq }) => eqq(ci.cartId, cartId),
    with: {
      variant: {
        with: {
          product: { with: { seller: true } },
        },
      },
    },
    orderBy: (ci, { asc }) => asc(ci.createdAt),
  });

  const groupsMap = new Map<string, CartGroup>();

  for (const item of items) {
    const variant = item.variant;
    const product = variant?.product;
    const seller = product?.seller;
    if (!variant || !product || !seller) continue; // data korup (seharusnya tidak mungkin lewat FK) — skip defensif

    const isAvailable =
      variant.isActive && product.status === "active" && !product.deletedAt && variant.stock >= item.quantity;

    const view = {
      id: item.id,
      variantId: variant.id,
      productId: product.id,
      sellerId: seller.id,
      sellerName: seller.storeName,
      productName: product.name,
      productSlug: product.slug,
      variantName: variant.name,
      imageUrl: variant.imageUrl ?? product.images[0] ?? null,
      unitPrice: variant.price,
      quantity: item.quantity,
      stock: variant.stock,
      isAvailable,
      subtotal: variant.price * item.quantity,
    };

    const group = groupsMap.get(seller.id) ?? {
      sellerId: seller.id,
      sellerName: seller.storeName,
      sellerSlug: seller.slug,
      items: [],
      subtotal: 0,
    };
    group.items.push(view);
    if (isAvailable) group.subtotal += view.subtotal;
    groupsMap.set(seller.id, group);
  }

  const groups = [...groupsMap.values()];
  const itemCount = groups.reduce((sum, g) => sum + g.items.reduce((s, i) => s + i.quantity, 0), 0);
  const subtotal = groups.reduce((sum, g) => sum + g.subtotal, 0);

  return { groups, itemCount, subtotal };
}

async function loadOwnedCartItem(cartId: string, itemId: string) {
  const item = await db.query.cartItems.findFirst({
    where: (ci, { and: andd, eq: eqq }) => andd(eqq(ci.id, itemId), eqq(ci.cartId, cartId)),
  });
  if (!item) throw httpError(404, "CART_ITEM_NOT_FOUND", "Item keranjang tidak ditemukan.");
  return item;
}

export const cartRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/cart", { preHandler: requireAuth }, async (req) => {
    const cart = await getOrCreateCart(req.user!.id);
    return buildCartResponse(cart.id);
  });

  app.post("/api/cart/items", { preHandler: requireAuth }, async (req) => {
    const input = addCartItemSchema.parse(req.body);
    const cart = await getOrCreateCart(req.user!.id);

    const variant = await db.query.productVariants.findFirst({
      where: (v, { eq: eqq }) => eqq(v.id, input.variantId),
      with: { product: true },
    });
    if (!variant || !variant.product || variant.product.deletedAt) {
      throw httpError(404, "VARIANT_NOT_FOUND", "Varian produk tidak ditemukan.");
    }
    if (!variant.isActive || variant.product.status !== "active") {
      throw httpError(400, "VARIANT_UNAVAILABLE", "Varian ini sedang tidak tersedia.");
    }

    // Upsert: kalau varian sudah ada di cart, tambahkan qty (bukan duplicate row) — cap di stok
    // supaya add-to-cart berulang tidak bisa melewati stok riil.
    const existing = await db.query.cartItems.findFirst({
      where: (ci, { and: andd, eq: eqq }) => andd(eqq(ci.cartId, cart.id), eqq(ci.variantId, input.variantId)),
    });

    const desiredQty = (existing?.quantity ?? 0) + input.quantity;
    if (desiredQty > variant.stock) {
      throw httpError(
        400,
        "INSUFFICIENT_STOCK",
        `Stok tidak cukup. Tersisa ${variant.stock}, di keranjang akan menjadi ${desiredQty}.`,
      );
    }

    if (existing) {
      await db.update(schema.cartItems).set({ quantity: desiredQty }).where(eq(schema.cartItems.id, existing.id));
    } else {
      await db.insert(schema.cartItems).values({ cartId: cart.id, variantId: input.variantId, quantity: input.quantity });
    }

    return buildCartResponse(cart.id);
  });

  app.patch("/api/cart/items/:id", { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const input = updateCartItemSchema.parse(req.body);
    const cart = await getOrCreateCart(req.user!.id);
    const item = await loadOwnedCartItem(cart.id, id);

    const variant = await db.query.productVariants.findFirst({ where: (v, { eq: eqq }) => eqq(v.id, item.variantId) });
    if (!variant) throw httpError(404, "VARIANT_NOT_FOUND", "Varian produk tidak ditemukan.");
    if (input.quantity > variant.stock) {
      throw httpError(400, "INSUFFICIENT_STOCK", `Stok tersisa hanya ${variant.stock}.`);
    }

    await db.update(schema.cartItems).set({ quantity: input.quantity }).where(eq(schema.cartItems.id, id));
    return buildCartResponse(cart.id);
  });

  app.delete("/api/cart/items/:id", { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const cart = await getOrCreateCart(req.user!.id);
    await loadOwnedCartItem(cart.id, id);
    await db.delete(schema.cartItems).where(eq(schema.cartItems.id, id));
    return buildCartResponse(cart.id);
  });

  app.delete("/api/cart", { preHandler: requireAuth }, async (req, reply) => {
    const cart = await getOrCreateCart(req.user!.id);
    await db.delete(schema.cartItems).where(eq(schema.cartItems.cartId, cart.id));
    reply.code(204);
  });

  // T-03 [V3]: merge cart guest (client) → cart backend akun yang baru login. Item sama
  // (variantId sama) → qty dijumlahkan, dicap di stok tersedia (bukan ditolak/hilang).
  // Item stok tidak cukup → di-cap ke stok max, bukan gagal seluruh request (partial success,
  // supaya item lain yang valid tidak ikut batal karena 1 item bermasalah).
  app.post("/api/cart/merge", { preHandler: requireAuth }, async (req) => {
    const input = mergeCartSchema.parse(req.body);
    if (input.items.length === 0) return buildCartResponse((await getOrCreateCart(req.user!.id)).id);

    const cart = await getOrCreateCart(req.user!.id);
    const variantIds = input.items.map((i) => i.variantId);
    const variants = await db.query.productVariants.findMany({
      where: (v, { and: andd, eq: eqq, inArray: inArr }) =>
        andd(inArr(v.id, variantIds), eqq(v.isActive, true)),
      with: { product: true },
    });
    const variantMap = new Map(variants.map((v) => [v.id, v]));

    const existingItems = await db.query.cartItems.findMany({
      where: (ci, { eq: eqq }) => eqq(ci.cartId, cart.id),
    });
    const existingByVariant = new Map(existingItems.map((i) => [i.variantId, i]));

    for (const guestItem of input.items) {
      const variant = variantMap.get(guestItem.variantId);
      // Varian sudah dihapus/nonaktif sejak disimpan di guest cart → skip diam-diam, bukan
      // gagalkan merge (buyer sudah tidak bisa berbuat apa-apa soal item yang sudah invalid).
      if (!variant || !variant.product || variant.product.deletedAt || variant.product.status !== "active") continue;

      const existing = existingByVariant.get(guestItem.variantId);
      const desiredQty = Math.min((existing?.quantity ?? 0) + guestItem.quantity, variant.stock);
      if (desiredQty <= 0) continue;

      if (existing) {
        await db.update(schema.cartItems).set({ quantity: desiredQty }).where(eq(schema.cartItems.id, existing.id));
      } else {
        await db.insert(schema.cartItems).values({ cartId: cart.id, variantId: guestItem.variantId, quantity: desiredQty });
      }
    }

    return buildCartResponse(cart.id);
  });

  // Dipakai halaman checkout untuk resolve beberapa varian by id sekaligus (edge case: item
  // sudah dihapus dari cart tapi FE masih render dari cache lama) — bukan bagian cart utama,
  // tapi kecil & terkait erat, jadi disatukan di module ini.
  app.get("/api/cart/items/by-variant", { preHandler: requireAuth }, async (req) => {
    const query = req.query as { variantIds?: string };
    const ids = (query.variantIds ?? "").split(",").filter(Boolean);
    if (ids.length === 0) return { items: [] };
    const cart = await getOrCreateCart(req.user!.id);
    const rows = await db.query.cartItems.findMany({
      where: (ci, { and: andd, eq: eqq }) => andd(eqq(ci.cartId, cart.id), inArray(ci.variantId, ids)),
    });
    return { items: rows };
  });
};
