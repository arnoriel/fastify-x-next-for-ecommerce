import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { newId, timestamps } from "./_helpers";
import { notificationType, payoutStatus } from "./enums";
import { orderItems } from "./orders";
import { products } from "./catalog";
import { sellers } from "./sellers";
import { users } from "./users";

// Review hanya untuk item order yang sudah completed (dicek di service layer T-12).
export const reviews = pgTable(
  "reviews",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    orderItemId: text("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    images: text("images").array().notNull().default(sql`'{}'::text[]`),
    sellerReply: text("seller_reply"),
    ...timestamps,
  },
  (t) => [
    // 1 review per item order.
    uniqueIndex("reviews_order_item_uq").on(t.orderItemId),
    index("reviews_product_idx").on(t.productId),
    index("reviews_user_idx").on(t.userId),
    check("reviews_rating_chk", sql`${t.rating} between 1 and 5`),
  ],
);

export const wishlists = pgTable(
  "wishlists",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("wishlists_user_product_uq").on(t.userId, t.productId)],
);

// Satu percakapan per (buyer, seller); product opsional sebagai konteks.
export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    buyerId: text("buyer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sellerId: text("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "cascade" }),
    productId: text("product_id").references(() => products.id, { onDelete: "set null" }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    buyerUnread: integer("buyer_unread").notNull().default(0),
    sellerUnread: integer("seller_unread").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("conversations_buyer_seller_uq").on(t.buyerId, t.sellerId),
    index("conversations_seller_idx").on(t.sellerId, t.lastMessageAt),
    check("conversations_unread_chk", sql`${t.buyerUnread} >= 0 and ${t.sellerUnread} >= 0`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: text("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    imageUrl: text("image_url"),
    readAt: timestamp("read_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    check("messages_body_chk", sql`length(trim(${t.body})) > 0`),
  ],
);

export const payouts = pgTable(
  "payouts",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    sellerId: text("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    amount: integer("amount").notNull(),
    status: payoutStatus("status").notNull().default("pending"),
    bankName: text("bank_name").notNull(),
    accountNumber: text("account_number").notNull(),
    accountHolder: text("account_holder").notNull(),
    note: text("note"),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("payouts_seller_idx").on(t.sellerId, t.status),
    check("payouts_amount_chk", sql`${t.amount} > 0`),
  ],
);

// Notifikasi in-app (T-09B). `payload` bebas per-type (mis. { orderId } untuk order_status,
// { conversationId } untuk chat_message, { sellerId } untuk seller_status) — dibaca FE by type.
export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationType("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    isRead: boolean("is_read").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.createdAt),
    index("notifications_user_unread_idx").on(t.userId, t.isRead),
  ],
);
