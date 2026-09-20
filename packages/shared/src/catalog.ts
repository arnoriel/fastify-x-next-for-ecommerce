import { z } from "zod";

export const PRODUCT_STATUSES = ["draft", "active", "inactive", "banned"] as const;
export const productStatusSchema = z.enum(PRODUCT_STATUSES);
export type ProductStatus = z.infer<typeof productStatusSchema>;

export const CATEGORY_ATTR_TYPES = ["text", "select", "number"] as const;

export const categoryAttributeSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/, "key harus lowercase, mulai huruf, boleh underscore"),
  label: z.string().trim().min(1).max(100),
  type: z.enum(CATEGORY_ATTR_TYPES),
  options: z.array(z.string().trim().min(1)).max(50).optional(),
}).refine((v) => v.type !== "select" || (v.options && v.options.length > 0), {
  message: "options wajib diisi untuk type select",
  path: ["options"],
});
export type CategoryAttribute = z.infer<typeof categoryAttributeSchema>;

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(140)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug hanya boleh huruf kecil, angka, dan tanda hubung");

// ---------- Category ----------

export const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: slugSchema.optional(),
  parentId: z.string().min(1).nullable().optional(),
  iconUrl: z.url().nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  attributes: z.array(categoryAttributeSchema).max(30).default([]),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = createCategorySchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const categorySchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  slug: z.string(),
  iconUrl: z.string().nullable(),
  sortOrder: z.number(),
  isActive: z.boolean(),
  attributes: z.array(categoryAttributeSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Category = z.infer<typeof categorySchema>;

// ---------- Product variant ----------

export const createVariantSchema = z.object({
  sku: z.string().trim().max(64).nullable().optional(),
  name: z.string().trim().min(1).max(100),
  options: z.record(z.string(), z.string().trim().min(1).max(50)).default({}),
  price: z.number().int().min(0).max(999_999_999),
  stock: z.number().int().min(0).max(999_999).default(0),
  weightGram: z.number().int().min(1).max(500_000).nullable().optional(),
  imageUrl: z.url().nullable().optional(),
});
export type CreateVariantInput = z.infer<typeof createVariantSchema>;

export const updateVariantSchema = createVariantSchema.partial().extend({
  id: z.string().optional(), // hadir = update varian existing, absen = varian baru
  isActive: z.boolean().optional(),
});
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;

export const variantSchema = z.object({
  id: z.string(),
  productId: z.string(),
  sku: z.string().nullable(),
  name: z.string(),
  options: z.record(z.string(), z.string()),
  price: z.number(),
  stock: z.number(),
  weightGram: z.number().nullable(),
  imageUrl: z.string().nullable(),
  isActive: z.boolean(),
});
export type Variant = z.infer<typeof variantSchema>;

// ---------- Product ----------

export const createProductSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().trim().min(3).max(200),
  slug: slugSchema.optional(),
  description: z.string().trim().max(20_000).default(""),
  images: z.array(z.url()).max(9).default([]),
  attributes: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  weightGram: z.number().int().min(1).max(500_000).default(500),
  lengthCm: z.number().int().min(1).max(1000).nullable().optional(),
  widthCm: z.number().int().min(1).max(1000).nullable().optional(),
  heightCm: z.number().int().min(1).max(1000).nullable().optional(),
  variants: z.array(createVariantSchema).min(1, "minimal 1 varian").max(50),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  categoryId: z.string().min(1).optional(),
  name: z.string().trim().min(3).max(200).optional(),
  slug: slugSchema.optional(),
  description: z.string().trim().max(20_000).optional(),
  status: productStatusSchema.optional(),
  images: z.array(z.url()).max(9).optional(),
  attributes: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  weightGram: z.number().int().min(1).max(500_000).optional(),
  lengthCm: z.number().int().min(1).max(1000).nullable().optional(),
  widthCm: z.number().int().min(1).max(1000).nullable().optional(),
  heightCm: z.number().int().min(1).max(1000).nullable().optional(),
  variants: z.array(updateVariantSchema).min(1).max(50).optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productSchema = z.object({
  id: z.string(),
  sellerId: z.string(),
  categoryId: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  status: productStatusSchema,
  images: z.array(z.string()),
  attributes: z.record(z.string(), z.union([z.string(), z.number()])),
  minPrice: z.number(),
  ratingAvg: z.number(),
  ratingCount: z.number(),
  soldCount: z.number(),
  weightGram: z.number(),
  lengthCm: z.number().nullable(),
  widthCm: z.number().nullable(),
  heightCm: z.number().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Product = z.infer<typeof productSchema>;

export const productWithVariantsSchema = productSchema.extend({
  variants: z.array(variantSchema),
});
export type ProductWithVariants = z.infer<typeof productWithVariantsSchema>;

export const productListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: productStatusSchema.optional(),
  categoryId: z.string().optional(),
  search: z.string().trim().max(200).optional(),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const productListResponseSchema = z.object({
  items: z.array(productWithVariantsSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export type ProductListResponse = z.infer<typeof productListResponseSchema>;

// ---------- Upload (presigned) ----------

export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

export const presignUploadRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_IMAGE_MIME),
  fileSize: z.number().int().min(1).max(5 * 1024 * 1024), // 5MB
});
export type PresignUploadRequest = z.infer<typeof presignUploadRequestSchema>;

export const presignUploadResponseSchema = z.object({
  uploadUrl: z.url(),
  publicUrl: z.url(),
  key: z.string(),
  expiresIn: z.number(),
});
export type PresignUploadResponse = z.infer<typeof presignUploadResponseSchema>;
