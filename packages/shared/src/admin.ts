import { z } from "zod";
import { categorySchema } from "./catalog";
import { type OrderStatusValue, orderStatusSchema } from "./cart";
import { dashboardRangeSchema, salesPointSchema } from "./seller-dashboard";
import { sellerStatusSchema } from "./seller";

/** Label status order netral (sudut pandang admin/platform). */
export const ORDER_STATUS_LABELS: Record<OrderStatusValue, string> = {
  pending_payment: "Menunggu pembayaran",
  paid: "Dibayar",
  processing: "Diproses penjual",
  shipped: "Dikirim",
  delivered: "Tiba di tujuan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  return_requested: "Retur diajukan",
  refunded: "Dana dikembalikan",
};

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
};

// ---------- Badge navigasi admin ----------

export const adminCountsSchema = z.object({
  pendingSellers: z.number(),
  activeDisputes: z.number(),
  needsReply: z.number(),
});
export type AdminCounts = z.infer<typeof adminCountsSchema>;

// ---------- Approval seller ----------

export const adminSellersQuerySchema = z.object({
  status: sellerStatusSchema.default("pending"),
  q: z.string().trim().max(60).optional(),
  ...pageQuery,
});
export type AdminSellersQuery = z.infer<typeof adminSellersQuerySchema>;

export const adminSellerItemSchema = z.object({
  id: z.string(),
  storeName: z.string(),
  status: sellerStatusSchema,
  rejectionReason: z.string().nullable(),
  owner: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  contactName: z.string().nullable(),
  phone: z.string().nullable(),
  pickupAddress: z.string().nullable(),
  documentUrl: z.string().nullable(),
  submittedAt: z.iso.datetime(),
});
export type AdminSellerItem = z.infer<typeof adminSellerItemSchema>;

export const adminSellersResponseSchema = z.object({
  items: z.array(adminSellerItemSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  counts: z.object({ pending: z.number(), approved: z.number(), rejected: z.number(), suspended: z.number() }),
});
export type AdminSellersResponse = z.infer<typeof adminSellersResponseSchema>;

// ---------- Kategori ----------

export const adminCategoryItemSchema = categorySchema.extend({
  productCount: z.number(),
  childCount: z.number(),
});
export type AdminCategoryItem = z.infer<typeof adminCategoryItemSchema>;

export const adminCategoriesResponseSchema = z.object({ items: z.array(adminCategoryItemSchema) });
export type AdminCategoriesResponse = z.infer<typeof adminCategoriesResponseSchema>;

// ---------- Monitoring transaksi ----------

export const adminOrdersQuerySchema = z.object({
  status: orderStatusSchema.optional(),
  q: z.string().trim().max(60).optional(),
  ...pageQuery,
});
export type AdminOrdersQuery = z.infer<typeof adminOrdersQuerySchema>;

export const adminOrderItemSchema = z.object({
  id: z.string(),
  orderNo: z.string(),
  status: orderStatusSchema,
  total: z.number(),
  buyerName: z.string().nullable(),
  buyerEmail: z.string().nullable(),
  storeName: z.string(),
  itemCount: z.number(),
  shippingStatusLabel: z.string().nullable(),
  activeDisputeId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminOrderItem = z.infer<typeof adminOrderItemSchema>;

export const adminOrdersResponseSchema = z.object({
  items: z.array(adminOrderItemSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export type AdminOrdersResponse = z.infer<typeof adminOrdersResponseSchema>;

// ---------- Analytics platform ----------

export const adminAnalyticsQuerySchema = z.object({ range: dashboardRangeSchema.default("30d") });

export const adminAnalyticsSchema = z.object({
  range: dashboardRangeSchema,
  from: z.string(),
  to: z.string(),
  // GMV = total (barang + ongkir - diskon) order berstatus SALES_COUNTED_STATUSES dalam rentang.
  totals: z.object({
    gmv: z.number(),
    orders: z.number(),
    averageOrderValue: z.number(),
    newUsers: z.number(),
    newSellers: z.number(),
  }),
  // Semua waktu — kondisi platform saat ini, tidak terpengaruh rentang.
  platform: z.object({
    users: z.number(),
    activeSellers: z.number(),
    pendingSellers: z.number(),
    activeProducts: z.number(),
  }),
  series: z.array(salesPointSchema),
  statusBreakdown: z.array(z.object({ status: orderStatusSchema, count: z.number() })),
  topSellers: z.array(
    z.object({ sellerId: z.string(), storeName: z.string(), orders: z.number(), revenue: z.number() }),
  ),
  topCategories: z.array(
    z.object({ categoryId: z.string(), name: z.string(), quantity: z.number(), revenue: z.number() }),
  ),
  disputes: z.object({
    active: z.number(),
    needsReply: z.number(),
    openedInRange: z.number(),
    closedInRange: z.number(),
  }),
});
export type AdminAnalytics = z.infer<typeof adminAnalyticsSchema>;
