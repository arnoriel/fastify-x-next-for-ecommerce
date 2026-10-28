import { z } from "zod";
import { orderStatusSchema } from "./cart";

// ---------- Retur & refund (T-15) ----------

export const RETURN_STATUSES = ["requested", "approved", "rejected", "refunded", "cancelled"] as const;
export const returnStatusSchema = z.enum(RETURN_STATUSES);
export type ReturnStatus = z.infer<typeof returnStatusSchema>;

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  requested: "Menunggu penjual",
  approved: "Menunggu refund",
  rejected: "Ditolak penjual",
  refunded: "Dana dikembalikan",
  cancelled: "Dibatalkan pembeli",
};

export const RETURN_REASONS = [
  "not_as_described",
  "damaged",
  "incomplete",
  "wrong_item",
  "no_longer_needed",
  "other",
] as const;
export const returnReasonSchema = z.enum(RETURN_REASONS);
export type ReturnReason = z.infer<typeof returnReasonSchema>;

export const RETURN_REASON_LABELS: Record<ReturnReason, string> = {
  not_as_described: "Barang tidak sesuai deskripsi",
  damaged: "Barang rusak / cacat",
  incomplete: "Barang kurang / tidak lengkap",
  wrong_item: "Barang yang dikirim salah",
  no_longer_needed: "Tidak lagi dibutuhkan",
  other: "Lainnya",
};

export const RETURN_ELIGIBLE_ORDER_STATUSES = ["shipped", "delivered", "completed"] as const;
export const RETURN_DESCRIPTION_MIN = 20;
export const RETURN_DESCRIPTION_MAX = 2000;
export const RETURN_NOTE_MIN = 10;
export const RETURN_NOTE_MAX = 1000;
export const RETURN_REFERENCE_MIN = 3;
export const RETURN_REFERENCE_MAX = 120;
export const RETURN_EVIDENCE_MAX = 3;

export const REFUND_MODES = ["midtrans", "manual"] as const;
export const refundModeSchema = z.enum(REFUND_MODES);
export type RefundMode = z.infer<typeof refundModeSchema>;

export const refundBankSchema = z.object({
  bankName: z.string().trim().min(3, "Nama bank minimal 3 karakter").max(60),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{6,30}$/, "Nomor rekening 6–30 digit angka"),
  accountHolder: z.string().trim().min(3, "Nama pemilik rekening minimal 3 karakter").max(80),
});
export type RefundBank = z.infer<typeof refundBankSchema>;

export const createReturnSchema = z.object({
  reason: returnReasonSchema,
  description: z
    .string()
    .trim()
    .min(RETURN_DESCRIPTION_MIN, `Jelaskan alasan retur minimal ${RETURN_DESCRIPTION_MIN} karakter`)
    .max(RETURN_DESCRIPTION_MAX),
  evidenceUrls: z.array(z.url()).max(RETURN_EVIDENCE_MAX).default([]),
  refundBank: refundBankSchema,
});
export type CreateReturnInput = z.infer<typeof createReturnSchema>;

export const reviewReturnSchema = z.object({
  note: z.string().trim().min(RETURN_NOTE_MIN, `Catatan minimal ${RETURN_NOTE_MIN} karakter`).max(RETURN_NOTE_MAX),
});
export type ReviewReturnInput = z.infer<typeof reviewReturnSchema>;

export const completeRefundSchema = z.object({
  reference: z
    .string()
    .trim()
    .min(RETURN_REFERENCE_MIN, `Referensi refund minimal ${RETURN_REFERENCE_MIN} karakter`)
    .max(RETURN_REFERENCE_MAX),
  note: z.string().trim().max(RETURN_NOTE_MAX).optional(),
});
export type CompleteRefundInput = z.infer<typeof completeRefundSchema>;

// ---------- Escrow ----------

export const ESCROW_STATUSES = ["pending", "held", "released", "refund_pending_manual", "refunded"] as const;
export const escrowStatusSchema = z.enum(ESCROW_STATUSES);
export type EscrowStatus = z.infer<typeof escrowStatusSchema>;

export const ESCROW_STATUS_LABELS: Record<EscrowStatus, string> = {
  pending: "Menunggu pembayaran",
  held: "Dana ditahan platform",
  released: "Dana diteruskan ke penjual",
  refund_pending_manual: "Menunggu refund manual",
  refunded: "Dana dikembalikan ke pembeli",
};

export const orderEscrowInfoSchema = z.object({
  status: escrowStatusSchema,
  amount: z.number(),
  /** Dana baru bisa dilepas setelah waktu ini (buyer protection window). */
  releaseAt: z.iso.datetime().nullable(),
  releasedAt: z.iso.datetime().nullable(),
});
export type OrderEscrowInfo = z.infer<typeof orderEscrowInfoSchema>;

// ---------- View ----------

export const returnSummarySchema = z.object({
  id: z.string(),
  returnNo: z.string(),
  orderId: z.string(),
  status: returnStatusSchema,
  reason: returnReasonSchema,
  description: z.string(),
  evidenceUrls: z.array(z.string()),
  amount: z.number(),
  refundBank: refundBankSchema.nullable(),
  resolutionNote: z.string().nullable(),
  refundReference: z.string().nullable(),
  refundMode: refundModeSchema.nullable(),
  requestedAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable(),
  refundedAt: z.iso.datetime().nullable(),
});
export type ReturnSummary = z.infer<typeof returnSummarySchema>;

export const orderReturnInfoSchema = z.object({
  request: returnSummarySchema.nullable(),
  canRequest: z.boolean(),
  canCancel: z.boolean(),
  blockedReason: z.string().nullable(),
  windowEndsAt: z.iso.datetime().nullable(),
  windowDays: z.number(),
});
export type OrderReturnInfo = z.infer<typeof orderReturnInfoSchema>;

export const returnOrderSchema = z.object({
  id: z.string(),
  orderNo: z.string(),
  status: orderStatusSchema,
  total: z.number(),
  buyerName: z.string().nullable(),
  buyerEmail: z.string().nullable(),
  storeName: z.string(),
  items: z.array(z.object({ productName: z.string(), variantName: z.string(), quantity: z.number() })),
  createdAt: z.iso.datetime(),
});

export const returnDetailSchema = returnSummarySchema.extend({
  order: returnOrderSchema,
  canReview: z.boolean(),
});
export type ReturnDetail = z.infer<typeof returnDetailSchema>;

export const adminReturnsQuerySchema = z.object({
  view: z.enum(["pending", "refund_queue", "all"]).default("pending"),
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});
export type AdminReturnsQuery = z.infer<typeof adminReturnsQuerySchema>;

export const adminReturnItemSchema = returnSummarySchema.extend({
  orderNo: z.string(),
  orderStatus: orderStatusSchema,
  buyerName: z.string().nullable(),
  buyerEmail: z.string().nullable(),
  storeName: z.string(),
});
export type AdminReturnItem = z.infer<typeof adminReturnItemSchema>;

export const adminReturnListResponseSchema = z.object({
  items: z.array(adminReturnItemSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  counts: z.object({ pending: z.number(), refundQueue: z.number() }),
});
export type AdminReturnListResponse = z.infer<typeof adminReturnListResponseSchema>;
