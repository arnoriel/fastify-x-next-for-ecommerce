import { z } from "zod";

// ---------- Cart ----------

export const addCartItemSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().min(1).max(999).default(1),
});
export type AddCartItemInput = z.infer<typeof addCartItemSchema>;

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1).max(999),
});
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;

/** Ringkasan varian yang cukup untuk render 1 baris cart. Snapshot harga saat GET, bukan disimpan. */
export const cartItemSchema = z.object({
  id: z.string(),
  variantId: z.string(),
  productId: z.string(),
  sellerId: z.string(),
  sellerName: z.string(),
  productName: z.string(),
  productSlug: z.string(),
  variantName: z.string(),
  imageUrl: z.string().nullable(),
  unitPrice: z.number(),
  quantity: z.number(),
  stock: z.number(),
  // Produk/varian dihapus, nonaktif, atau stok < quantity — FE tampilkan warning & exclude dari total.
  isAvailable: z.boolean(),
  subtotal: z.number(),
});
export type CartItemView = z.infer<typeof cartItemSchema>;

export const cartGroupSchema = z.object({
  sellerId: z.string(),
  sellerName: z.string(),
  sellerSlug: z.string(),
  items: z.array(cartItemSchema),
  subtotal: z.number(),
});
export type CartGroup = z.infer<typeof cartGroupSchema>;

export const cartResponseSchema = z.object({
  groups: z.array(cartGroupSchema),
  itemCount: z.number(),
  subtotal: z.number(),
});
export type CartResponse = z.infer<typeof cartResponseSchema>;

// ---------- Checkout ----------

export const CHECKOUT_COURIERS = ["jne", "jnt", "sicepat", "anteraja", "gosend", "grab"] as const;
export const checkoutCourierSchema = z.enum(CHECKOUT_COURIERS);
export type CheckoutCourier = z.infer<typeof checkoutCourierSchema>;

export const shippingRateSchema = z.object({
  courierCode: checkoutCourierSchema,
  courierName: z.string(),
  service: z.string(),
  serviceName: z.string(),
  price: z.number().int().min(0),
  etd: z.string(), // mis. "2-3 hari"
});
export type ShippingRate = z.infer<typeof shippingRateSchema>;

/** Rate ongkir per seller — dipanggil FE per grup cart sebelum submit checkout. */
export const shippingRateRequestSchema = z.object({
  sellerId: z.string().min(1),
  addressId: z.string().min(1),
});
export type ShippingRateRequest = z.infer<typeof shippingRateRequestSchema>;

export const shippingRateResponseSchema = z.object({
  sellerId: z.string(),
  rates: z.array(shippingRateSchema),
});
export type ShippingRateResponse = z.infer<typeof shippingRateResponseSchema>;

/** Pilihan kurir + voucher per seller, dikirim FE saat submit checkout. */
export const checkoutSellerSelectionSchema = z.object({
  sellerId: z.string().min(1),
  courierCode: checkoutCourierSchema,
  service: z.string().min(1),
  voucherCode: z
    .string()
    .trim()
    .max(50)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
export type CheckoutSellerSelection = z.infer<typeof checkoutSellerSelectionSchema>;

export const createCheckoutSchema = z.object({
  addressId: z.string().min(1),
  sellers: z.array(checkoutSellerSelectionSchema).min(1, "Pilih kurir minimal untuk 1 toko"),
  platformVoucherCode: z
    .string()
    .trim()
    .max(50)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  note: z.string().trim().max(500).optional(),
  // T-06 [V3]: dibuat FE sekali per attempt (UUID), dikirim ulang kalau retry setelah
  // network error/redirect-login — cegah double-order dari klik ganda/resubmit.
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
});
export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;

export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
  "return_requested",
  "refunded",
] as const;
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatusValue = z.infer<typeof orderStatusSchema>;

export const CHECKOUT_STATUSES = ["pending", "paid", "expired", "failed", "cancelled"] as const;
export const checkoutStatusSchema = z.enum(CHECKOUT_STATUSES);
export type CheckoutStatusValue = z.infer<typeof checkoutStatusSchema>;

export const orderItemViewSchema = z.object({
  id: z.string(),
  productId: z.string(),
  variantId: z.string(),
  productName: z.string(),
  variantName: z.string(),
  imageUrl: z.string().nullable(),
  unitPrice: z.number(),
  quantity: z.number(),
  subtotal: z.number(),
});
export type OrderItemView = z.infer<typeof orderItemViewSchema>;

export const orderViewSchema = z.object({
  id: z.string(),
  orderNo: z.string(),
  sellerId: z.string(),
  sellerName: z.string(),
  status: orderStatusSchema,
  courierCode: z.string().nullable(),
  courierService: z.string().nullable(),
  subtotal: z.number(),
  shippingCost: z.number(),
  discount: z.number(),
  total: z.number(),
  trackingNumber: z.string().nullable(),
  items: z.array(orderItemViewSchema),
  createdAt: z.iso.datetime(),
});
export type OrderView = z.infer<typeof orderViewSchema>;

export const checkoutViewSchema = z.object({
  id: z.string(),
  invoiceNo: z.string(),
  status: checkoutStatusSchema,
  subtotal: z.number(),
  shippingTotal: z.number(),
  discountTotal: z.number(),
  grandTotal: z.number(),
  paymentUrl: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  orders: z.array(orderViewSchema),
  createdAt: z.iso.datetime(),
});
export type CheckoutView = z.infer<typeof checkoutViewSchema>;
