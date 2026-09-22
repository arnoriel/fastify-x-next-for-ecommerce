import { z } from "zod";
import { orderItemViewSchema, orderStatusSchema } from "./cart";

// ---------- Order list & detail (T-06C) ----------

export const listOrdersQuerySchema = z.object({
  status: orderStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

const addressSnapshotViewSchema = z.object({
  recipientName: z.string(),
  phone: z.string(),
  province: z.string(),
  city: z.string(),
  district: z.string(),
  postalCode: z.string(),
  street: z.string(),
});

/** Order milik buyer, dipakai baris riwayat & detail — superset dari OrderView T-06 (checkout). */
export const orderDetailSchema = z.object({
  id: z.string(),
  orderNo: z.string(),
  sellerId: z.string(),
  sellerName: z.string(),
  status: orderStatusSchema,
  shippingAddress: addressSnapshotViewSchema,
  courierCode: z.string().nullable(),
  courierService: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  subtotal: z.number(),
  shippingCost: z.number(),
  discount: z.number(),
  total: z.number(),
  note: z.string().nullable(),
  items: z.array(orderItemViewSchema),
  // Buyer bisa konfirmasi terima barang hanya saat status shipped/delivered.
  canConfirmReceived: z.boolean(),
  // Order completed → item bisa direview (dicek per-item lagi di endpoint review nanti/T-12).
  canReview: z.boolean(),
  createdAt: z.iso.datetime(),
  shippedAt: z.iso.datetime().nullable(),
  deliveredAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
});
export type OrderDetail = z.infer<typeof orderDetailSchema>;

export const orderListItemSchema = orderDetailSchema.omit({ items: true }).extend({
  itemCount: z.number(),
  thumbnailUrl: z.string().nullable(),
});
export type OrderListItem = z.infer<typeof orderListItemSchema>;

export const orderListResponseSchema = z.object({
  items: z.array(orderListItemSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});
export type OrderListResponse = z.infer<typeof orderListResponseSchema>;

/** Order statuses buyer boleh klik "Konfirmasi Terima Barang" (PRD T-06C). */
export const CONFIRMABLE_ORDER_STATUSES = ["shipped", "delivered"] as const;
