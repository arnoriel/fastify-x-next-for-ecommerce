import { z } from "zod";
import { type OrderStatusValue, orderStatusSchema } from "./cart";

// ---------- Tab manajemen order seller (T-09) ----------

/** Tab → status order. `delivered` digabung ke "dikirim" (menunggu konfirmasi buyer). */
export const SELLER_ORDER_TAB_STATUSES = {
  new: ["paid"],
  processing: ["processing"],
  shipped: ["shipped", "delivered"],
  completed: ["completed"],
} as const;

export const SELLER_ORDER_TABS = ["new", "processing", "shipped", "completed"] as const;
export const sellerOrderTabSchema = z.enum(SELLER_ORDER_TABS);
export type SellerOrderTab = z.infer<typeof sellerOrderTabSchema>;

export const SELLER_ORDER_TAB_LABELS: Record<SellerOrderTab, string> = {
  new: "Baru",
  processing: "Diproses",
  shipped: "Dikirim",
  completed: "Selesai",
};

/** Label status order dari sudut pandang seller. */
export const SELLER_STATUS_LABELS: Record<OrderStatusValue, string> = {
  pending_payment: "Menunggu pembayaran",
  paid: "Perlu diproses",
  processing: "Diproses",
  shipped: "Dikirim",
  delivered: "Tiba di tujuan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  return_requested: "Retur diajukan",
  refunded: "Dana dikembalikan",
};

/** Status yang dihitung sebagai penjualan (sudah dibayar & tidak batal/refund/retur). */
export const SALES_COUNTED_STATUSES = ["paid", "processing", "shipped", "delivered", "completed"] as const;

export const sellerOrderCountsSchema = z.object({
  new: z.number(),
  processing: z.number(),
  shipped: z.number(),
  completed: z.number(),
});
export type SellerOrderCounts = z.infer<typeof sellerOrderCountsSchema>;

export const sellerOrdersQuerySchema = z.object({
  tab: sellerOrderTabSchema.default("new"),
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});
export type SellerOrdersQuery = z.infer<typeof sellerOrdersQuerySchema>;

export const sellerOrderItemSchema = z.object({
  id: z.string(),
  productId: z.string(),
  productName: z.string(),
  variantName: z.string(),
  imageUrl: z.string().nullable(),
  unitPrice: z.number(),
  quantity: z.number(),
  subtotal: z.number(),
});

export const sellerOrderSchema = z.object({
  id: z.string(),
  orderNo: z.string(),
  status: orderStatusSchema,
  recipientName: z.string(),
  recipientPhone: z.string(),
  shippingAddress: z.string(),
  courierCode: z.string().nullable(),
  courierService: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  trackingLink: z.string().nullable(),
  shippingStatus: z.string().nullable(),
  shippingStatusLabel: z.string().nullable(),
  note: z.string().nullable(),
  subtotal: z.number(),
  shippingCost: z.number(),
  total: z.number(),
  items: z.array(sellerOrderItemSchema),
  // Seller boleh mendaftarkan pengiriman (paid, atau processing dengan booking gagal/belum ada).
  canCreateShipment: z.boolean(),
  // Pengiriman sudah terdaftar & belum diserahkan ke kurir.
  canMarkShipped: z.boolean(),
  createdAt: z.iso.datetime(),
  shippedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
});
export type SellerOrder = z.infer<typeof sellerOrderSchema>;

export const sellerOrderListResponseSchema = z.object({
  items: z.array(sellerOrderSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  counts: sellerOrderCountsSchema,
});
export type SellerOrderListResponse = z.infer<typeof sellerOrderListResponseSchema>;

export const sellerShipmentResultSchema = z.object({
  orderId: z.string(),
  orderNo: z.string(),
  orderStatus: orderStatusSchema,
  shippingStatus: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  trackingLink: z.string().nullable(),
  // false = aksi sudah pernah dilakukan (klik ganda / retry) — tidak ada perubahan baru.
  created: z.boolean(),
});
export type SellerShipmentResult = z.infer<typeof sellerShipmentResultSchema>;

// ---------- Dashboard & laporan penjualan (T-09) ----------

export const DASHBOARD_RANGES = ["7d", "30d", "90d"] as const;
export const dashboardRangeSchema = z.enum(DASHBOARD_RANGES);
export type DashboardRange = z.infer<typeof dashboardRangeSchema>;
export const DASHBOARD_RANGE_DAYS: Record<DashboardRange, number> = { "7d": 7, "30d": 30, "90d": 90 };

export const dashboardQuerySchema = z.object({ range: dashboardRangeSchema.default("30d") });

export const salesPointSchema = z.object({
  date: z.string(), // YYYY-MM-DD (Asia/Jakarta)
  revenue: z.number(),
  orders: z.number(),
});
export type SalesPoint = z.infer<typeof salesPointSchema>;

export const topProductSchema = z.object({
  productId: z.string(),
  name: z.string(),
  imageUrl: z.string().nullable(),
  quantity: z.number(),
  revenue: z.number(),
});
export type TopProduct = z.infer<typeof topProductSchema>;

export const sellerDashboardSummarySchema = z.object({
  range: dashboardRangeSchema,
  from: z.string(),
  to: z.string(),
  // GMV toko = total harga barang (subtotal) order berstatus SALES_COUNTED_STATUSES; ongkir tidak dihitung.
  totals: z.object({ revenue: z.number(), orders: z.number(), averageOrderValue: z.number() }),
  series: z.array(salesPointSchema),
  topProducts: z.array(topProductSchema),
  // Semua waktu (bukan per range) — dipakai badge tab & kartu "Perlu diproses".
  orderCounts: sellerOrderCountsSchema,
});
export type SellerDashboardSummary = z.infer<typeof sellerDashboardSummarySchema>;
