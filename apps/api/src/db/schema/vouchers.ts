import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { newId, timestamps } from "./_helpers";
import { voucherScope, voucherType } from "./enums";
import { sellers } from "./sellers";

export const vouchers = pgTable(
  "vouchers",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    code: text("code").notNull(),
    scope: voucherScope("scope").notNull().default("platform"),
    // Wajib terisi jika scope = seller.
    sellerId: text("seller_id").references(() => sellers.id, { onDelete: "cascade" }),
    type: voucherType("type").notNull(),
    // percent: 1-100, fixed: Rupiah.
    value: integer("value").notNull(),
    maxDiscount: integer("max_discount"), // cap untuk tipe percent
    minPurchase: integer("min_purchase").notNull().default(0),
    quota: integer("quota").notNull(),
    usedCount: integer("used_count").notNull().default(0),
    perUserLimit: integer("per_user_limit").notNull().default(1),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("vouchers_code_uq").on(sql`upper(${t.code})`),
    index("vouchers_seller_idx").on(t.sellerId),
    check("vouchers_value_chk", sql`${t.value} > 0 and (${t.type} <> 'percent' or ${t.value} <= 100)`),
    check("vouchers_quota_chk", sql`${t.quota} > 0 and ${t.usedCount} >= 0 and ${t.usedCount} <= ${t.quota}`),
    check("vouchers_period_chk", sql`${t.expiresAt} > ${t.startsAt}`),
    check("vouchers_scope_chk", sql`(${t.scope} = 'seller') = (${t.sellerId} is not null)`),
    check("vouchers_min_purchase_chk", sql`${t.minPurchase} >= 0`),
    check("vouchers_per_user_chk", sql`${t.perUserLimit} > 0`),
  ],
);
