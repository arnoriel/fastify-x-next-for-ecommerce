import { sql } from "drizzle-orm";
import { boolean, doublePrecision, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { newId, timestamps } from "./_helpers";
import { users } from "./users";

export const addresses = pgTable(
  "addresses",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull().default("Rumah"),
    recipientName: text("recipient_name").notNull(),
    phone: text("phone").notNull(),
    province: text("province").notNull(),
    city: text("city").notNull(),
    district: text("district").notNull(),
    postalCode: text("postal_code").notNull(),
    street: text("street").notNull(),
    // Biteship area id — dipakai T-08 untuk rate/order.
    biteshipAreaId: text("biteship_area_id"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("addresses_user_idx").on(t.userId),
    // Maksimal 1 alamat default per user.
    uniqueIndex("addresses_one_default_uq").on(t.userId).where(sql`${t.isDefault}`),
  ],
);
