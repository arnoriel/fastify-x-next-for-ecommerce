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

// ---------- Tracking pengiriman (T-08, Biteship) ----------

/** Status pengiriman Biteship (order.status webhook & tracking API). */
export const SHIPPING_STATUS_LABELS: Record<string, string> = {
  confirmed: "Pesanan terdaftar di kurir",
  scheduled: "Pickup dijadwalkan",
  allocated: "Kurir telah dialokasikan",
  picking_up: "Kurir menuju lokasi penjual",
  picked: "Paket diambil kurir",
  in_transit: "Paket dalam perjalanan",
  dropping_off: "Paket sedang diantar ke alamat tujuan",
  delivered: "Paket telah diterima",
  on_hold: "Pengiriman tertahan sementara",
  cancelled: "Pengiriman dibatalkan",
  return_in_transit: "Paket dalam perjalanan kembali ke penjual",
  returned: "Paket dikembalikan ke penjual",
  rejected: "Pengiriman ditolak kurir",
  disposed: "Paket dimusnahkan",
  courier_not_found: "Kurir belum ditemukan",
};

export const shippingStatusLabel = (status: string): string => SHIPPING_STATUS_LABELS[status] ?? status.replaceAll("_", " ");

export const orderTrackingEventSchema = z.object({
  status: z.string(),
  label: z.string(),
  note: z.string().nullable(),
  occurredAt: z.iso.datetime(),
});
export type OrderTrackingEvent = z.infer<typeof orderTrackingEventSchema>;

export const orderTrackingSchema = z.object({
  // null = belum ada pengiriman terdaftar di kurir (seller belum memproses).
  shippingStatus: z.string().nullable(),
  shippingStatusLabel: z.string().nullable(),
  trackingLink: z.string().nullable(),
  // true = tidak akan ada update lagi (FE berhenti polling).
  isFinal: z.boolean(),
  // Terbaru di atas.
  events: z.array(orderTrackingEventSchema),
});
export type OrderTracking = z.infer<typeof orderTrackingSchema>;

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
  tracking: orderTrackingSchema,
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

export const orderListItemSchema = orderDetailSchema.omit({ items: true, tracking: true }).extend({
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
