import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { newId, timestamps } from "./_helpers";
import { productVariants } from "./catalog";
import { users } from "./users";

export const carts = pgTable(
  "carts",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("carts_user_uq").on(t.userId)],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    cartId: text("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("cart_items_cart_variant_uq").on(t.cartId, t.variantId),
    index("cart_items_cart_idx").on(t.cartId),
    check("cart_items_qty_chk", sql`${t.quantity} > 0`),
  ],
);
