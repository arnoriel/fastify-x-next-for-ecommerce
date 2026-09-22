import type { FastifyPluginAsync } from "fastify";
import { eq, sql } from "drizzle-orm";
import {
  type AddressSnapshotInput,
  checkoutViewSchema,
  createCheckoutSchema,
  type OrderView,
  shippingRateRequestSchema,
} from "@ecommerce/shared";
import { db, schema } from "../../db";
import { httpError } from "../../lib/http-error";
import { generateInvoiceNo, generateOrderNo } from "../../lib/order-number";
import { shippingProvider } from "../../lib/shipping";
import { requireAuth } from "../../plugins/auth";

type CartItemWithVariant = Awaited<ReturnType<typeof loadCartForCheckout>>[number];

/** Cart item milik user, join varian+produk+seller — dipakai rate lookup & create checkout. */
async function loadCartForCheckout(userId: string) {
  const cart = await db.query.carts.findFirst({ where: (c, { eq: eqq }) => eqq(c.userId, userId) });
  if (!cart) return [];
  return db.query.cartItems.findMany({
    where: (ci, { eq: eqq }) => eqq(ci.cartId, cart.id),
    with: { variant: { with: { product: { with: { seller: true } } } } },
  });
}

/** Kelompokkan item cart per seller, hitung berat total (gram) untuk rate ongkir. */
function groupBySeller(items: CartItemWithVariant[]) {
  const bySeller = new Map<string, { sellerId: string; items: typeof items; weightGram: number }>();
  for (const item of items) {
    const product = item.variant?.product;
    const seller = product?.seller;
    if (!product || !seller) continue;
    const entry = bySeller.get(seller.id) ?? { sellerId: seller.id, items: [], weightGram: 0 };
    entry.items.push(item);
    const unitWeight = item.variant!.weightGram ?? product.weightGram;
    entry.weightGram += unitWeight * item.quantity;
    bySeller.set(seller.id, entry);
  }
  return bySeller;
}

async function loadOwnedAddress(userId: string, addressId: string) {
  const address = await db.query.addresses.findFirst({
    where: (a, { and: andd, eq: eqq }) => andd(eqq(a.id, addressId), eqq(a.userId, userId)),
  });
  if (!address) throw httpError(404, "ADDRESS_NOT_FOUND", "Alamat tidak ditemukan.");
  return address;
}

function addressSnapshot(address: NonNullable<Awaited<ReturnType<typeof loadOwnedAddress>>>): AddressSnapshotInput {
  return {
    recipientName: address.recipientName,
    phone: address.phone,
    province: address.province,
    city: address.city,
    district: address.district,
    postalCode: address.postalCode,
    street: address.street,
    biteshipAreaId: address.biteshipAreaId ?? null,
  };
}

/**
 * Validasi + hitung diskon 1 voucher terhadap subtotal tertentu. Melempar HttpError kalau
 * voucher invalid/expired/quota habis/tidak memenuhi syarat — tidak silently ignore, supaya
 * buyer tahu kenapa kode promo mereka tidak berlaku.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** `executor` = `tx` dari transaksi checkout — memastikan cek quota/limit dibaca dalam transaksi
 * yang sama dengan increment `usedCount` di bawah (FOR UPDATE implicit lewat row lock Postgres
 * saat update), bukan dari snapshot db di luar transaksi yang bisa basi akibat race. */
async function resolveVoucher(
  executor: Tx,
  params: {
    code: string;
    userId: string;
    scope: "platform" | "seller";
    sellerId?: string;
    subtotal: number;
  },
) {
  // Row lock: cegah dua checkout paralel lolos cek quota bersamaan lalu sama-sama increment
  // melewati batas (classic race condition pada voucher terbatas).
  const [voucher] = await executor
    .select()
    .from(schema.vouchers)
    .where(sql`upper(${schema.vouchers.code}) = ${params.code.toUpperCase()}`)
    .for("update");
  if (!voucher || !voucher.isActive) throw httpError(400, "VOUCHER_INVALID", `Voucher ${params.code} tidak valid.`);
  if (voucher.scope !== params.scope || (params.scope === "seller" && voucher.sellerId !== params.sellerId)) {
    throw httpError(400, "VOUCHER_INVALID", `Voucher ${params.code} tidak berlaku untuk toko ini.`);
  }
  const now = new Date();
  if (now < voucher.startsAt || now > voucher.expiresAt) {
    throw httpError(400, "VOUCHER_EXPIRED", `Voucher ${params.code} sudah tidak berlaku.`);
  }
  if (voucher.usedCount >= voucher.quota) {
    throw httpError(400, "VOUCHER_QUOTA_EXCEEDED", `Kuota voucher ${params.code} sudah habis.`);
  }
  if (params.subtotal < voucher.minPurchase) {
    throw httpError(
      400,
      "VOUCHER_MIN_PURCHASE",
      `Minimal belanja untuk voucher ${params.code} adalah Rp${voucher.minPurchase.toLocaleString("id-ID")}.`,
    );
  }

  const usageCount = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.voucherUsages)
    .where(sql`${schema.voucherUsages.voucherId} = ${voucher.id} and ${schema.voucherUsages.userId} = ${params.userId}`);
  if ((usageCount[0]?.count ?? 0) >= voucher.perUserLimit) {
    throw httpError(400, "VOUCHER_LIMIT_REACHED", `Anda sudah mencapai batas pemakaian voucher ${params.code}.`);
  }

  const rawDiscount = voucher.type === "percent" ? Math.round((params.subtotal * voucher.value) / 100) : voucher.value;
  const discount = Math.min(rawDiscount, voucher.maxDiscount ?? rawDiscount, params.subtotal);
  return { voucher, discount };
}

function serializeOrder(
  order: typeof schema.orders.$inferSelect,
  sellerName: string,
  items: (typeof schema.orderItems.$inferSelect)[],
): OrderView {
  return {
    id: order.id,
    orderNo: order.orderNo,
    sellerId: order.sellerId,
    sellerName,
    status: order.status,
    courierCode: order.courierCode,
    courierService: order.courierService,
    subtotal: order.subtotal,
    shippingCost: order.shippingCost,
    discount: order.discount,
    total: order.total,
    trackingNumber: order.trackingNumber,
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      productName: i.productName,
      variantName: i.variantName,
      imageUrl: i.imageUrl,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      subtotal: i.subtotal,
    })),
    createdAt: order.createdAt.toISOString(),
  };
}

export const checkoutRoutes: FastifyPluginAsync = async (app) => {
  // ---------- Rate ongkir per seller (dipanggil FE sebelum submit checkout) ----------

  app.post("/api/checkout/shipping-rates", { preHandler: requireAuth }, async (req) => {
    const input = shippingRateRequestSchema.parse(req.body);
    const address = await loadOwnedAddress(req.user!.id, input.addressId);

    const cartItems = await loadCartForCheckout(req.user!.id);
    const group = groupBySeller(cartItems).get(input.sellerId);
    if (!group) throw httpError(400, "SELLER_NOT_IN_CART", "Toko ini tidak ada di keranjang Anda.");

    const seller = group.items[0]!.variant!.product!.seller!;
    const rates = await shippingProvider.getShippingRates({
      originAreaId: seller.pickupBiteshipAreaId,
      destinationAreaId: address.biteshipAreaId,
      weightGram: group.weightGram,
    });
    return { sellerId: input.sellerId, rates };
  });

  // ---------- Submit checkout: split order per seller, validasi stok+ongkir+voucher server-side ----------

  app.post("/api/checkout", { preHandler: requireAuth }, async (req, reply) => {
    const input = createCheckoutSchema.parse(req.body);
    const userId = req.user!.id;

    // T-06 [V3] idempotency: submit ganda (double-click, atau retry setelah redirect
    // login akibat session expired di tengah checkout) dengan key yang sama mengembalikan
    // checkout yang SUDAH dibuat, bukan membuat order duplikat kedua kalinya.
    if (input.idempotencyKey) {
      const existing = await db.query.checkouts.findFirst({
        where: (c, { and: andd, eq: eqq }) => andd(eqq(c.userId, userId), eqq(c.idempotencyKey, input.idempotencyKey!)),
      });
      if (existing) {
        const orders = await db.query.orders.findMany({
          where: (o, { eq: eqq }) => eqq(o.checkoutId, existing.id),
          with: { items: true, seller: true },
        });
        reply.code(200); // bukan 201 — bukan resource baru, mengembalikan yang sudah ada.
        return checkoutViewSchema.parse({
          id: existing.id,
          invoiceNo: existing.invoiceNo,
          status: existing.status,
          subtotal: existing.subtotal,
          shippingTotal: existing.shippingTotal,
          discountTotal: existing.discountTotal,
          grandTotal: existing.grandTotal,
          paymentUrl: existing.paymentUrl,
          expiresAt: existing.expiresAt ? existing.expiresAt.toISOString() : null,
          orders: orders.map((o) => serializeOrder(o, o.seller!.storeName, o.items)),
          createdAt: existing.createdAt.toISOString(),
        });
      }
    }

    const address = await loadOwnedAddress(userId, input.addressId);
    const cartItems = await loadCartForCheckout(userId);
    if (cartItems.length === 0) throw httpError(400, "CART_EMPTY", "Keranjang Anda kosong.");

    const bySeller = groupBySeller(cartItems);

    // Setiap seller yang punya item di cart wajib punya pilihan kurir — cegah checkout parsial
    // yang membingungkan (sebagian toko checkout, sebagian tidak, tanpa buyer sadar).
    for (const sellerId of bySeller.keys()) {
      if (!input.sellers.some((s) => s.sellerId === sellerId)) {
        throw httpError(400, "MISSING_COURIER_SELECTION", "Pilih kurir untuk semua toko di keranjang.");
      }
    }
    for (const sel of input.sellers) {
      if (!bySeller.has(sel.sellerId)) {
        throw httpError(400, "SELLER_NOT_IN_CART", "Toko yang dipilih tidak ada di keranjang.");
      }
    }

    const invoiceNo = generateInvoiceNo();

    const result = await db.transaction(async (tx) => {
      // Checkout dibuat lebih dulu dengan total sementara 0, lalu di-update di akhir transaksi
      // setelah semua order per-seller selesai dihitung. Dibuat di awal (bukan di akhir) supaya
      // setiap insert order sudah punya checkoutId asli — menghindari placeholder string kosong
      // yang bisa bentrok dengan unique index (checkoutId, sellerId) saat >1 seller di-loop.
      const [checkoutRow0] = await tx
        .insert(schema.checkouts)
        .values({
          userId,
          invoiceNo,
          idempotencyKey: input.idempotencyKey ?? null,
          status: "pending",
          subtotal: 0,
          shippingTotal: 0,
          discountTotal: 0,
          grandTotal: 0,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returning();
      const checkoutId = checkoutRow0!.id;

      let checkoutSubtotal = 0;
      let checkoutShipping = 0;
      let checkoutDiscount = 0;
      const orderRows: { row: typeof schema.orders.$inferSelect; sellerName: string; items: (typeof schema.orderItems.$inferSelect)[] }[] = [];
      const voucherUsageInserts: { voucherId: string; userId: string; discount: number }[] = [];

      for (const selection of input.sellers) {
        const group = bySeller.get(selection.sellerId)!;
        const seller = group.items[0]!.variant!.product!.seller!;

        // Re-validasi & re-hitung ongkir di server — jangan pernah percaya angka price dari client.
        const rate = await shippingProvider.resolveRate({
          originAreaId: seller.pickupBiteshipAreaId,
          destinationAreaId: address.biteshipAreaId,
          weightGram: group.weightGram,
          courierCode: selection.courierCode,
          service: selection.service,
        });
        if (!rate) throw httpError(400, "INVALID_COURIER", `Kurir/layanan tidak tersedia untuk toko ${seller.storeName}.`);

        let sellerSubtotal = 0;
        const orderItemValues: (typeof schema.orderItems.$inferInsert)[] = [];

        for (const item of group.items) {
          const variant = item.variant!;
          const product = variant.product!;

          if (!variant.isActive || product.status !== "active" || product.deletedAt) {
            throw httpError(
              400,
              "PRODUCT_UNAVAILABLE",
              `${product.name} (${variant.name}) sudah tidak tersedia. Hapus dari keranjang untuk melanjutkan.`,
            );
          }

          // Atomic conditional decrement: WHERE stock >= qty. Kalau 0 baris ter-update, berarti
          // stok berubah (race dengan checkout lain) di antara load cart & transaksi ini — tolak
          // checkout daripada stok jadi negatif.
          const updated = await tx
            .update(schema.productVariants)
            .set({ stock: sql`${schema.productVariants.stock} - ${item.quantity}` })
            .where(sql`${schema.productVariants.id} = ${variant.id} and ${schema.productVariants.stock} >= ${item.quantity}`)
            .returning({ id: schema.productVariants.id });
          if (updated.length === 0) {
            throw httpError(
              409,
              "INSUFFICIENT_STOCK",
              `Stok ${product.name} (${variant.name}) berubah. Silakan cek ulang keranjang Anda.`,
            );
          }

          const lineSubtotal = variant.price * item.quantity;
          sellerSubtotal += lineSubtotal;
          orderItemValues.push({
            orderId: "", // diisi setelah order dibuat
            productId: product.id,
            variantId: variant.id,
            productName: product.name,
            variantName: variant.name,
            imageUrl: variant.imageUrl ?? product.images[0] ?? null,
            unitPrice: variant.price,
            quantity: item.quantity,
            subtotal: lineSubtotal,
          });
        }

        let sellerDiscount = 0;
        if (selection.voucherCode) {
          const { voucher, discount } = await resolveVoucher(tx, {
            code: selection.voucherCode,
            userId,
            scope: "seller",
            sellerId: seller.id,
            subtotal: sellerSubtotal,
          });
          sellerDiscount = discount;
          voucherUsageInserts.push({ voucherId: voucher.id, userId, discount });
          await tx
            .update(schema.vouchers)
            .set({ usedCount: sql`${schema.vouchers.usedCount} + 1` })
            .where(eq(schema.vouchers.id, voucher.id));
        }

        const sellerTotal = sellerSubtotal + rate.price - sellerDiscount;

        const [orderRow] = await tx
          .insert(schema.orders)
          .values({
            checkoutId,
            orderNo: generateOrderNo(),
            userId,
            sellerId: seller.id,
            status: "pending_payment",
            shippingAddress: addressSnapshot(address),
            courierCode: rate.courierCode,
            courierService: rate.service,
            subtotal: sellerSubtotal,
            shippingCost: rate.price,
            discount: sellerDiscount,
            total: sellerTotal,
            note: input.note,
          })
          .returning();

        const insertedItems = await tx
          .insert(schema.orderItems)
          .values(orderItemValues.map((v) => ({ ...v, orderId: orderRow!.id })))
          .returning();

        orderRows.push({ row: orderRow!, sellerName: seller.storeName, items: insertedItems });
        checkoutSubtotal += sellerSubtotal;
        checkoutShipping += rate.price;
        checkoutDiscount += sellerDiscount;
      }

      // Voucher platform-wide dihitung terhadap subtotal gabungan semua seller, lalu proporsikan
      // ke tiap order berdasarkan share subtotal-nya (order kecil dapat diskon kecil, adil).
      if (input.platformVoucherCode) {
        const { voucher, discount } = await resolveVoucher(tx, {
          code: input.platformVoucherCode,
          userId,
          scope: "platform",
          subtotal: checkoutSubtotal,
        });
        if (discount > 0 && checkoutSubtotal > 0) {
          let distributed = 0;
          for (let i = 0; i < orderRows.length; i += 1) {
            const entry = orderRows[i]!;
            const isLast = i === orderRows.length - 1;
            const share = isLast
              ? discount - distributed
              : Math.round((discount * entry.row.subtotal) / checkoutSubtotal);
            distributed += share;
            if (share > 0) {
              const newDiscount = entry.row.discount + share;
              const newTotal = entry.row.total - share;
              const [updatedOrder] = await tx
                .update(schema.orders)
                .set({ discount: newDiscount, total: newTotal })
                .where(eq(schema.orders.id, entry.row.id))
                .returning();
              orderRows[i] = { ...entry, row: updatedOrder! };
            }
          }
          checkoutDiscount += discount;
          voucherUsageInserts.push({ voucherId: voucher.id, userId, discount });
          await tx
            .update(schema.vouchers)
            .set({ usedCount: sql`${schema.vouchers.usedCount} + 1` })
            .where(eq(schema.vouchers.id, voucher.id));
        }
      }

      const grandTotal = checkoutSubtotal + checkoutShipping - checkoutDiscount;
      if (grandTotal < 0) throw httpError(400, "INVALID_TOTAL", "Total checkout tidak valid.");

      const [checkoutRow] = await tx
        .update(schema.checkouts)
        .set({
          subtotal: checkoutSubtotal,
          shippingTotal: checkoutShipping,
          discountTotal: checkoutDiscount,
          grandTotal,
        })
        .where(eq(schema.checkouts.id, checkoutId))
        .returning();

      if (voucherUsageInserts.length > 0) {
        await tx.insert(schema.voucherUsages).values(
          voucherUsageInserts.map((v) => ({ ...v, checkoutId })),
        );
      }

      // Checkout sukses → kosongkan cart (semua item dalam cart sudah terwakili di checkout ini).
      const cart = await tx.query.carts.findFirst({ where: (c, { eq: eqq }) => eqq(c.userId, userId) });
      if (cart) await tx.delete(schema.cartItems).where(eq(schema.cartItems.cartId, cart.id));

      return { checkoutRow: checkoutRow!, orderRows };
    });

    reply.code(201);
    return checkoutViewSchema.parse({
      id: result.checkoutRow.id,
      invoiceNo: result.checkoutRow.invoiceNo,
      status: result.checkoutRow.status,
      subtotal: result.checkoutRow.subtotal,
      shippingTotal: result.checkoutRow.shippingTotal,
      discountTotal: result.checkoutRow.discountTotal,
      grandTotal: result.checkoutRow.grandTotal,
      paymentUrl: result.checkoutRow.paymentUrl,
      expiresAt: result.checkoutRow.expiresAt ? result.checkoutRow.expiresAt.toISOString() : null,
      orders: result.orderRows.map((o) => serializeOrder(o.row, o.sellerName, o.items)),
      createdAt: result.checkoutRow.createdAt.toISOString(),
    });
  });

  // ---------- Detail checkout (invoice) milik user login ----------

  app.get("/api/checkout/:id", { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const checkout = await db.query.checkouts.findFirst({
      where: (c, { and: andd, eq: eqq }) => andd(eqq(c.id, id), eqq(c.userId, req.user!.id)),
    });
    if (!checkout) throw httpError(404, "CHECKOUT_NOT_FOUND", "Checkout tidak ditemukan.");

    const orders = await db.query.orders.findMany({
      where: (o, { eq: eqq }) => eqq(o.checkoutId, checkout.id),
      with: { items: true, seller: true },
    });

    return checkoutViewSchema.parse({
      id: checkout.id,
      invoiceNo: checkout.invoiceNo,
      status: checkout.status,
      subtotal: checkout.subtotal,
      shippingTotal: checkout.shippingTotal,
      discountTotal: checkout.discountTotal,
      grandTotal: checkout.grandTotal,
      paymentUrl: checkout.paymentUrl,
      expiresAt: checkout.expiresAt ? checkout.expiresAt.toISOString() : null,
      orders: orders.map((o) => serializeOrder(o, o.seller!.storeName, o.items)),
      createdAt: checkout.createdAt.toISOString(),
    });
  });
};
