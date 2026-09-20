import { sql } from "drizzle-orm";
import { check, doublePrecision, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { newId, timestamps } from "./_helpers";
import { sellerStatus } from "./enums";
import { users } from "./users";

export const sellers = pgTable(
  "sellers",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    storeName: text("store_name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    logoUrl: text("logo_url"),
    bannerUrl: text("banner_url"),
    status: sellerStatus("status").notNull().default("pending"),
    rejectionReason: text("rejection_reason"),
    // Alamat pickup (Biteship origin) — T-08.
    pickupContactName: text("pickup_contact_name"),
    pickupPhone: text("pickup_phone"),
    pickupProvince: text("pickup_province"),
    pickupCity: text("pickup_city"),
    pickupDistrict: text("pickup_district"),
    pickupPostalCode: text("pickup_postal_code"),
    pickupStreet: text("pickup_street"),
    pickupBiteshipAreaId: text("pickup_biteship_area_id"),
    pickupLatitude: doublePrecision("pickup_latitude"),
    pickupLongitude: doublePrecision("pickup_longitude"),
    // Contoh: { "mon": ["08:00","17:00"], ... } — null = selalu buka.
    operatingHours: jsonb("operating_hours").$type<Record<string, [string, string] | null>>(),
    // Kode kurir Biteship yang didukung, mis. ["jne","sicepat"].
    couriers: text("couriers").array().notNull().default(sql`'{}'::text[]`),
    // Saldo yang bisa dicairkan (Rupiah).
    balance: integer("balance").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("sellers_user_uq").on(t.userId),
    uniqueIndex("sellers_slug_uq").on(t.slug),
    index("sellers_status_idx").on(t.status),
    check("sellers_balance_chk", sql`${t.balance} >= 0`),
  ],
);
