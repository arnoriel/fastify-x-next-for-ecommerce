import { z } from "zod";
import { orderStatusSchema, type OrderStatusValue } from "./cart";

// ---------- Status, alasan, keputusan ----------

export const DISPUTE_STATUSES = ["open", "in_review", "resolved", "dismissed", "withdrawn"] as const;
export const disputeStatusSchema = z.enum(DISPUTE_STATUSES);
export type DisputeStatus = z.infer<typeof disputeStatusSchema>;

/** Tiket yang masih berjalan: boleh dibalas, dibatalkan pelapor, atau diputuskan admin. */
export const ACTIVE_DISPUTE_STATUSES = ["open", "in_review"] as const satisfies readonly DisputeStatus[];
export const isActiveDispute = (status: DisputeStatus) => (ACTIVE_DISPUTE_STATUSES as readonly string[]).includes(status);

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  open: "Menunggu admin",
  in_review: "Sedang ditinjau",
  resolved: "Selesai",
  dismissed: "Ditolak admin",
  withdrawn: "Dibatalkan pelapor",
};

export const DISPUTE_REPORTER_ROLES = ["buyer", "seller"] as const;
export const disputeReporterRoleSchema = z.enum(DISPUTE_REPORTER_ROLES);
export type DisputeReporterRole = z.infer<typeof disputeReporterRoleSchema>;

export const DISPUTE_REASONS = [
  "item_not_received",
  "item_not_as_described",
  "item_damaged",
  "item_incomplete",
  "seller_unresponsive",
  "buyer_unreachable",
  "delivery_refused",
  "false_claim",
  "other",
] as const;
export const disputeReasonSchema = z.enum(DISPUTE_REASONS);
export type DisputeReason = z.infer<typeof disputeReasonSchema>;

export const DISPUTE_REASON_LABELS: Record<DisputeReason, string> = {
  item_not_received: "Barang belum diterima",
  item_not_as_described: "Barang tidak sesuai deskripsi",
  item_damaged: "Barang rusak",
  item_incomplete: "Barang kurang / tidak lengkap",
  seller_unresponsive: "Penjual tidak merespons / tidak memproses pesanan",
  buyer_unreachable: "Pembeli tidak bisa dihubungi",
  delivery_refused: "Pembeli menolak paket",
  false_claim: "Klaim pembeli tidak benar",
  other: "Lainnya",
};

/** Alasan yang masuk akal per pelapor — server menolak alasan di luar daftar ini. */
export const DISPUTE_REASONS_BY_ROLE: Record<DisputeReporterRole, readonly DisputeReason[]> = {
  buyer: ["item_not_received", "item_not_as_described", "item_damaged", "item_incomplete", "seller_unresponsive", "other"],
  seller: ["buyer_unreachable", "delivery_refused", "false_claim", "other"],
};

/** Keputusan admin. `dismiss` = laporan tidak berdasar (tidak ada pihak yang "dimenangkan"). */
export const DISPUTE_DECISIONS = ["favor_buyer", "favor_seller", "dismiss"] as const;
export const disputeDecisionSchema = z.enum(DISPUTE_DECISIONS);
export type DisputeDecision = z.infer<typeof disputeDecisionSchema>;

export const DISPUTE_DECISION_LABELS: Record<DisputeDecision, string> = {
  favor_buyer: "Menangkan pembeli",
  favor_seller: "Menangkan penjual",
  dismiss: "Tolak laporan (tidak berdasar)",
};

export const DISPUTE_OUTCOMES = ["favor_buyer", "favor_seller"] as const;
export const disputeOutcomeSchema = z.enum(DISPUTE_OUTCOMES);
export type DisputeOutcome = z.infer<typeof disputeOutcomeSchema>;

// ---------- Aturan pengajuan ----------

/** Order yang sudah dibayar. Belum bayar / dibatalkan / sudah refund tidak punya objek sengketa. */
export const DISPUTE_ELIGIBLE_ORDER_STATUSES: readonly OrderStatusValue[] = [
  "paid",
  "processing",
  "shipped",
  "delivered",
  "completed",
];
/** Order `completed` masih bisa disengketakan sampai N hari sejak selesai. */
export const DISPUTE_WINDOW_DAYS = 14;
/** Batas anti-spam: tiket baru per user per 24 jam. */
export const DISPUTE_DAILY_LIMIT = 5;
/** Batas pesan per tiket (cegah tiket jadi ruang obrolan tanpa akhir). */
export const DISPUTE_MESSAGE_LIMIT = 200;

export const DISPUTE_DESCRIPTION_MIN = 20;
export const DISPUTE_DESCRIPTION_MAX = 2000;
export const DISPUTE_MESSAGE_MAX = 2000;
export const DISPUTE_NOTE_MIN = 10;
export const DISPUTE_NOTE_MAX = 1000;

export const createDisputeSchema = z.object({
  orderId: z.string().trim().min(1),
  reason: disputeReasonSchema,
  description: z
    .string()
    .trim()
    .min(DISPUTE_DESCRIPTION_MIN, `Jelaskan masalahnya minimal ${DISPUTE_DESCRIPTION_MIN} karakter`)
    .max(DISPUTE_DESCRIPTION_MAX),
});
export type CreateDisputeInput = z.infer<typeof createDisputeSchema>;

export const disputeMessageInputSchema = z.object({
  body: z.string().trim().min(1, "Pesan tidak boleh kosong").max(DISPUTE_MESSAGE_MAX),
});
export type DisputeMessageInput = z.infer<typeof disputeMessageInputSchema>;

export const resolveDisputeSchema = z.object({
  decision: disputeDecisionSchema,
  note: z
    .string()
    .trim()
    .min(DISPUTE_NOTE_MIN, `Catatan keputusan minimal ${DISPUTE_NOTE_MIN} karakter`)
    .max(DISPUTE_NOTE_MAX),
});
export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;

// ---------- Query ----------

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
};

export const listDisputesQuerySchema = z.object({
  view: z.enum(["active", "closed", "all"]).default("active"),
  ...pageQuery,
});
export type ListDisputesQuery = z.infer<typeof listDisputesQuerySchema>;

export const adminListDisputesQuerySchema = z.object({
  /** needs_reply = tiket aktif yang pesan terakhirnya BUKAN dari admin. */
  view: z.enum(["active", "needs_reply", "closed", "all"]).default("active"),
  q: z.string().trim().max(60).optional(),
  ...pageQuery,
});
export type AdminListDisputesQuery = z.infer<typeof adminListDisputesQuerySchema>;

// ---------- View ----------

export const disputeViewerRoleSchema = z.enum(["buyer", "seller", "admin"]);
export type DisputeViewerRole = z.infer<typeof disputeViewerRoleSchema>;

export const disputeSummarySchema = z.object({
  id: z.string(),
  ticketNo: z.string(),
  orderId: z.string(),
  orderNo: z.string(),
  status: disputeStatusSchema,
  reason: disputeReasonSchema,
  reporterRole: disputeReporterRoleSchema,
  buyerName: z.string().nullable(),
  storeName: z.string(),
  viewerRole: disputeViewerRoleSchema,
  outcome: disputeOutcomeSchema.nullable(),
  lastMessageRole: disputeViewerRoleSchema.nullable(),
  // Tiket aktif yang menunggu balasan admin (hanya bermakna untuk admin).
  needsReply: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type DisputeSummary = z.infer<typeof disputeSummarySchema>;

export const disputeListResponseSchema = z.object({
  items: z.array(disputeSummarySchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  // Badge tab: tiket aktif milik viewer / (admin) yang perlu dibalas.
  activeCount: z.number(),
});
export type DisputeListResponse = z.infer<typeof disputeListResponseSchema>;

export const disputeMessageSchema = z.object({
  id: z.string(),
  authorRole: disputeViewerRoleSchema,
  authorName: z.string(),
  body: z.string(),
  mine: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type DisputeMessage = z.infer<typeof disputeMessageSchema>;

export const disputeOrderSchema = z.object({
  id: z.string(),
  orderNo: z.string(),
  status: orderStatusSchema,
  total: z.number(),
  shippingStatusLabel: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  items: z.array(z.object({ productName: z.string(), variantName: z.string(), quantity: z.number() })),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});

export const disputeDetailSchema = disputeSummarySchema.extend({
  description: z.string(),
  resolutionNote: z.string().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  resolvedByName: z.string().nullable(),
  order: disputeOrderSchema,
  messages: z.array(disputeMessageSchema),
  canReply: z.boolean(),
  canWithdraw: z.boolean(),
  canResolve: z.boolean(),
});
export type DisputeDetail = z.infer<typeof disputeDetailSchema>;

/** Ringkasan tiket pada order (tombol "Laporkan masalah" / "Lihat laporan"). */
export const orderDisputeInfoSchema = z.object({
  /** Tiket terbaru order ini yang masih berjalan, bila ada. */
  activeId: z.string().nullable(),
  canOpen: z.boolean(),
  /** Alasan kenapa belum bisa mengajukan (null bila canOpen atau memang belum relevan). */
  blockedReason: z.string().nullable(),
});
export type OrderDisputeInfo = z.infer<typeof orderDisputeInfoSchema>;

/** Data awal form pengajuan: order, alasan yang tersedia, dan apakah boleh mengajukan. */
export const disputeEligibilitySchema = z.object({
  order: disputeOrderSchema,
  role: disputeReporterRoleSchema,
  counterpartName: z.string(),
  dispute: orderDisputeInfoSchema,
});
export type DisputeEligibility = z.infer<typeof disputeEligibilitySchema>;
