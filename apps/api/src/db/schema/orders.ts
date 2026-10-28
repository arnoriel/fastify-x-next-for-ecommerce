import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { newId, timestamps } from "./_helpers";
import { productVariants, products } from "./catalog";
import { checkoutStatus, escrowStatus, orderStatus, refundMode, returnReason, returnStatus } from "./enums";
import { sellers } from "./sellers";
import { users } from "./users";
import { vouchers } from "./vouchers";

export type AddressSnapshot = {
  recipientName: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  postalCode: string;
  street: string;
  biteshipAreaId?: string | null;
};

// 1 checkout = 1 pembayaran Midtrans, bisa berisi banyak order (split per seller).
export const checkouts = pgTable(
  "checkouts",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    // Nullable: guest checkout (T-20).
    userId: text("user_id").references(() => users.id, { onDelete: "restrict" }),
    guestEmail: text("guest_email"),
    guestPhone: text("guest_phone"),
    invoiceNo: text("invoice_no").notNull(),
    // T-06 [V3]: idempotency key per checkout attempt (dikirim FE, mis. UUID dibuat saat
    // form checkout dibuka). Unique per user — submit ganda dengan key sama mengembalikan
    // checkout yang sudah ada, bukan membuat order duplikat.
    idempotencyKey: text("idempotency_key"),
    status: checkoutStatus("status").notNull().default("pending"),
    subtotal: integer("subtotal").notNull(),
    shippingTotal: integer("shipping_total").notNull().default(0),
    discountTotal: integer("discount_total").notNull().default(0),
    grandTotal: integer("grand_total").notNull(),
    // Midtrans (T-07).
    paymentMethod: text("payment_method"),
    paymentReference: text("payment_reference"), // Snap token
    paymentUrl: text("payment_url"), // Snap redirect_url (dibuka buyer untuk bayar)
    paidAt: timestamp("paid_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("checkouts_invoice_uq").on(t.invoiceNo),
    index("checkouts_user_idx").on(t.userId),
    // Partial unique: hanya berlaku per (user, key) saat key terisi — NULL tidak dianggap
    // duplikat oleh Postgres, jadi baris lama tanpa idempotencyKey tetap aman.
    uniqueIndex("checkouts_user_idempotency_uq")
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    check("checkouts_owner_chk", sql`${t.userId} is not null or ${t.guestEmail} is not null or ${t.guestPhone} is not null`),
    check("checkouts_amounts_chk", sql`${t.subtotal} >= 0 and ${t.shippingTotal} >= 0 and ${t.discountTotal} >= 0 and ${t.grandTotal} >= 0`),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    checkoutId: text("checkout_id")
      .notNull()
      .references(() => checkouts.id, { onDelete: "restrict" }),
    orderNo: text("order_no").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "restrict" }),
    sellerId: text("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    status: orderStatus("status").notNull().default("pending_payment"),
    // Snapshot alamat saat checkout (alamat asli boleh berubah/dihapus).
    shippingAddress: jsonb("shipping_address").$type<AddressSnapshot>().notNull(),
    courierCode: text("courier_code"),
    courierService: text("courier_service"),
    subtotal: integer("subtotal").notNull(),
    shippingCost: integer("shipping_cost").notNull().default(0),
    discount: integer("discount").notNull().default(0),
    total: integer("total").notNull(),
    // Biteship (T-08).
    biteshipOrderId: text("biteship_order_id"),
    biteshipTrackingId: text("biteship_tracking_id"), // id untuk GET /v1/trackings/:id
    trackingNumber: text("tracking_number"), // waybill / resi kurir
    // Status pengiriman terakhir dari Biteship (confirmed, picked, in_transit, delivered, ...).
    shippingStatus: text("shipping_status"),
    trackingLink: text("tracking_link"),
    // Terakhir sinkron ke tracking API (throttle refresh saat buyer membuka detail order).
    trackingSyncedAt: timestamp("tracking_synced_at", { withTimezone: true }),
    note: text("note"),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // T-15: escrow — dana ditahan sampai buyer protection window lewat / refund selesai.
    escrowStatus: escrowStatus("escrow_status").notNull().default("pending"),
    escrowAmount: integer("escrow_amount").notNull().default(0),
    escrowHeldAt: timestamp("escrow_held_at", { withTimezone: true }),
    escrowReleaseDueAt: timestamp("escrow_release_due_at", { withTimezone: true }),
    escrowReleasedAt: timestamp("escrow_released_at", { withTimezone: true }),
    escrowRefundedAt: timestamp("escrow_refunded_at", { withTimezone: true }),
    // Retur masih diterima sampai waktu ini (diisi saat order completed).
    returnWindowEndsAt: timestamp("return_window_ends_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("orders_order_no_uq").on(t.orderNo),
    index("orders_escrow_release_idx").on(t.escrowStatus, t.escrowReleaseDueAt),
    // Satu order per seller dalam satu checkout.
    uniqueIndex("orders_checkout_seller_uq").on(t.checkoutId, t.sellerId),
    // Lookup webhook Biteship (order_id Biteship → order kita). Partial: order tanpa shipment boleh banyak.
    uniqueIndex("orders_biteship_order_uq").on(t.biteshipOrderId).where(sql`${t.biteshipOrderId} is not null`),
    index("orders_user_idx").on(t.userId),
    index("orders_seller_status_idx").on(t.sellerId, t.status),
    check("orders_amounts_chk", sql`${t.subtotal} >= 0 and ${t.shippingCost} >= 0 and ${t.discount} >= 0 and ${t.total} >= 0`),
    check("orders_escrow_amount_chk", sql`${t.escrowAmount} >= 0`),
  ],
);

// Pengajuan retur/refund (T-15). Satu order maksimal satu retur; status order tetap sumber
// kebenaran state machine, tabel ini menyimpan alasan, bukti, dan tujuan refund manual.
export const orderReturns = pgTable(
  "order_returns",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    returnNo: text("return_no").notNull(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    buyerId: text("buyer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    sellerId: text("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    status: returnStatus("status").notNull().default("requested"),
    reason: returnReason("reason").notNull(),
    description: text("description").notNull(),
    evidenceUrls: text("evidence_urls").array().notNull().default(sql`'{}'::text[]`),
    amount: integer("amount").notNull(),
    // Tujuan refund manual — diisi buyer saat mengajukan.
    refundBankName: text("refund_bank_name").notNull(),
    refundAccountNumber: text("refund_account_number").notNull(),
    refundAccountHolder: text("refund_account_holder").notNull(),
    // Status order sebelum retur (dipulihkan bila retur ditolak/dibatalkan).
    previousStatus: orderStatus("previous_status").notNull(),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    refundMode: refundMode("refund_mode"),
    refundReference: text("refund_reference"),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("order_returns_no_uq").on(t.returnNo),
    uniqueIndex("order_returns_order_uq").on(t.orderId),
    index("order_returns_status_idx").on(t.status, t.createdAt),
    index("order_returns_seller_idx").on(t.sellerId, t.status),
    check("order_returns_amount_chk", sql`${t.amount} >= 0`),
    check(
      "order_returns_evidence_chk",
      sql`array_length(${t.evidenceUrls}, 1) is null or array_length(${t.evidenceUrls}, 1) <= 3`,
    ),
  ],
);

// Histori pengiriman per order (T-08). Diisi webhook Biteship, booking seller, dan sinkron tracking API.
export const orderTrackingEvents = pgTable(
  "order_tracking_events",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    status: text("status").notNull(), // status Biteship
    note: text("note"),
    // Waktu kejadian: dari tracking API = waktu kurir; dari webhook/booking = waktu diterima server.
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    source: text("source").$type<"webhook" | "sync" | "system">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("order_tracking_events_order_idx").on(t.orderId, t.occurredAt),
    // Cegah duplikat dari sinkron paralel / webhook retry pada kejadian yang sama persis.
    uniqueIndex("order_tracking_events_uq").on(t.orderId, t.status, t.occurredAt),
  ],
);

// Snapshot nama/harga: riwayat tidak berubah walau produk diedit atau dihapus.
export const orderItems = pgTable(
  "order_items",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    productName: text("product_name").notNull(),
    variantName: text("variant_name").notNull(),
    imageUrl: text("image_url"),
    unitPrice: integer("unit_price").notNull(),
    quantity: integer("quantity").notNull(),
    subtotal: integer("subtotal").notNull(),
    ...timestamps,
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    index("order_items_product_idx").on(t.productId),
    check("order_items_qty_chk", sql`${t.quantity} > 0`),
    check("order_items_price_chk", sql`${t.unitPrice} >= 0 and ${t.subtotal} = ${t.unitPrice} * ${t.quantity}`),
  ],
);

// unique(voucher, checkout) mencegah voucher yang sama dipakai dua kali di satu checkout.
export const voucherUsages = pgTable(
  "voucher_usages",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    voucherId: text("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    checkoutId: text("checkout_id")
      .notNull()
      .references(() => checkouts.id, { onDelete: "cascade" }),
    discount: integer("discount").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("voucher_usages_voucher_checkout_uq").on(t.voucherId, t.checkoutId),
    index("voucher_usages_user_voucher_idx").on(t.userId, t.voucherId),
    check("voucher_usages_discount_chk", sql`${t.discount} >= 0`),
  ],
);
