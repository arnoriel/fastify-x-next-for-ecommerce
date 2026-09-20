import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { newId, timestamps } from "./_helpers";
import { productStatus } from "./enums";
import { sellers } from "./sellers";

export const categories = pgTable(
  "categories",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    parentId: text("parent_id").references((): AnyPgColumn => categories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    iconUrl: text("icon_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    // Atribut kategori (T-04), mis. [{ "key": "size", "label": "Ukuran", "type": "select", "options": ["S","M"] }].
    attributes: jsonb("attributes")
      .$type<Array<{ key: string; label: string; type: "text" | "select" | "number"; options?: string[] }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    ...timestamps,
  },
  (t) => [uniqueIndex("categories_slug_uq").on(t.slug), index("categories_parent_idx").on(t.parentId)],
);

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    sellerId: text("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    status: productStatus("status").notNull().default("draft"),
    // URL gambar (R2/CDN), urutan pertama = thumbnail.
    images: text("images").array().notNull().default(sql`'{}'::text[]`),
    // Nilai atribut kategori.
    attributes: jsonb("attributes").$type<Record<string, string | number>>().notNull().default(sql`'{}'::jsonb`),
    // Denormalisasi untuk listing cepat; di-update saat review/varian berubah.
    minPrice: integer("min_price").notNull().default(0),
    ratingAvg: integer("rating_avg_x10").notNull().default(0), // rating * 10 (mis. 47 = 4.7)
    ratingCount: integer("rating_count").notNull().default(0),
    soldCount: integer("sold_count").notNull().default(0),
    // Berat default (gram) & dimensi (cm) untuk rate Biteship.
    weightGram: integer("weight_gram").notNull().default(500),
    lengthCm: integer("length_cm"),
    widthCm: integer("width_cm"),
    heightCm: integer("height_cm"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("products_slug_uq").on(t.slug),
    index("products_seller_idx").on(t.sellerId),
    index("products_category_idx").on(t.categoryId),
    index("products_listing_idx").on(t.status, t.categoryId).where(sql`${t.deletedAt} is null`),
    check("products_weight_chk", sql`${t.weightGram} > 0`),
    check("products_rating_chk", sql`${t.ratingAvg} between 0 and 50`),
    check("products_min_price_chk", sql`${t.minPrice} >= 0`),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku"),
    name: text("name").notNull(), // mis. "Merah / XL"
    // Opsi terstruktur, mis. { "warna": "Merah", "ukuran": "XL" }.
    options: jsonb("options").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    price: integer("price").notNull(),
    stock: integer("stock").notNull().default(0),
    weightGram: integer("weight_gram"), // override berat produk bila ada
    imageUrl: text("image_url"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("product_variants_product_idx").on(t.productId),
    uniqueIndex("product_variants_sku_uq").on(t.productId, t.sku).where(sql`${t.sku} is not null`),
    check("product_variants_price_chk", sql`${t.price} >= 0`),
    check("product_variants_stock_chk", sql`${t.stock} >= 0`),
  ],
);
