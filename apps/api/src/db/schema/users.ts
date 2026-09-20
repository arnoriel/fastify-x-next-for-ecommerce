import { sql } from "drizzle-orm";
import { boolean, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { newId, timestamps } from "./_helpers";
import { userRole, userStatus } from "./enums";

// Kolom dasar kompatibel Better Auth (T-03): id, name, email, emailVerified, image.
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    phone: text("phone"),
    role: userRole("role").notNull().default("buyer"),
    status: userStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_uq").on(sql`lower(${t.email})`),
    uniqueIndex("users_phone_uq").on(t.phone).where(sql`${t.phone} is not null`),
  ],
);
