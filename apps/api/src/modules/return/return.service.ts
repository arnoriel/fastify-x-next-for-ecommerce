/**
 * T-15: retur/refund + escrow. Status order adalah sumber kebenaran state machine:
 *   shipped/delivered/completed → return_requested → refund_pending_manual → refunded
 * Retur ditolak/dibatalkan mengembalikan order ke status semula. Dana ditahan sampai buyer
 * protection window lewat, lalu dilepas ke saldo seller oleh `runReturnMaintenance`.
 */

import { and, count, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import {
  ACTIVE_DISPUTE_STATUSES,
  type AdminReturnListResponse,
  type AdminReturnsQuery,
  type CompleteRefundInput,
  type CreateReturnInput,
  type OrderReturnInfo,
  type RefundMode,
  type ReturnDetail,
  type ReturnStatus,
  type ReturnSummary,
  adminReturnListResponseSchema,
  isFeatureEnabled,
  orderReturnInfoSchema,
  returnDetailSchema,
  returnSummarySchema,
  storeConfig,
} from "@ecommerce/shared";
import { db, schema } from "../../db";
import { env } from "../../env";
import { httpError } from "../../lib/http-error";
import { requestRefund } from "../../lib/midtrans";
import { generateReturnNo } from "../../lib/order-number";
import { escapeLike, pageOffset } from "../../lib/sql";
import { isOwnedR2Url } from "../../lib/storage";
import { createNotification, notifySafely } from "../notification/notification.service";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ReturnRow = typeof schema.orderReturns.$inferSelect;
type OrderRow = typeof schema.orders.$inferSelect;
type Actor = { id: string; isAdmin: boolean };

const DAY_MS = 86_400_000;
const ACTIVE_RETURN_STATUSES: readonly ReturnStatus[] = ["requested", "approved"];
const ACTIVE_DISPUTES = [...ACTIVE_DISPUTE_STATUSES];
const BATCH_SIZE = 100;
const PROTECTION_DAYS = storeConfig.protection.returnWindowDays;
const AUTO_COMPLETE_DAYS = storeConfig.protection.autoCompleteDays;

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

function windowFor(completedAt: Date | null): Date | null {
  return completedAt ? addDays(completedAt, PROTECTION_DAYS) : null;
}

function requireReturnsFeature() {
  if (!isFeatureEnabled("returns")) {
    throw httpError(403, "FEATURE_DISABLED", "Fitur retur dinonaktifkan di toko ini.");
  }
}

// ---------- Serialisasi ----------

function serializeReturn(row: ReturnRow, includeBank: boolean): ReturnSummary {
  return returnSummarySchema.parse({
    id: row.id,
    returnNo: row.returnNo,
    orderId: row.orderId,
    status: row.status,
    reason: row.reason,
    description: row.description,
    evidenceUrls: row.evidenceUrls,
    amount: row.amount,
    refundBank: includeBank
      ? {
          bankName: row.refundBankName,
          accountNumber: row.refundAccountNumber,
          accountHolder: row.refundAccountHolder,
        }
      : null,
    resolutionNote: row.resolutionNote,
    refundReference: row.refundReference,
    refundMode: row.refundMode,
    requestedAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    refundedAt: row.refundedAt?.toISOString() ?? null,
  });
}

function serializeEscrow(order: OrderRow) {
  return {
    status: order.escrowStatus,
    amount: order.escrowAmount,
    releaseAt: order.escrowReleaseDueAt?.toISOString() ?? null,
    releasedAt: order.escrowReleasedAt?.toISOString() ?? null,
  };
}

// ---------- Query dasar ----------

async function loadReturnRow(returnId: string) {
  return db.query.orderReturns.findFirst({ where: (r, { eq: eqq }) => eqq(r.id, returnId) });
}

async function txFindActiveDispute(tx: Tx, orderId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.disputes.id })
    .from(schema.disputes)
    .where(and(eq(schema.disputes.orderId, orderId), inArray(schema.disputes.status, ACTIVE_DISPUTES)))
    .limit(1);
  return Boolean(row);
}

async function txFindActiveReturn(tx: Tx, orderId: string) {
  const [row] = await tx
    .select()
    .from(schema.orderReturns)
    .where(and(eq(schema.orderReturns.orderId, orderId), inArray(schema.orderReturns.status, [...ACTIVE_RETURN_STATUSES])))
    .limit(1);
  return row ?? null;
}

async function txFindAnyReturn(tx: Tx, orderId: string) {
  const [row] = await tx.select().from(schema.orderReturns).where(eq(schema.orderReturns.orderId, orderId)).limit(1);
  return row ?? null;
}

/** Info retur untuk halaman detail order buyer. */
export async function getOrderReturnInfo(order: OrderRow, now = new Date()): Promise<OrderReturnInfo> {
  const existing = await db.query.orderReturns.findFirst({
    where: (r, { eq: eqq }) => eqq(r.orderId, order.id),
  });
  const windowEndsAt = order.returnWindowEndsAt ?? windowFor(order.completedAt);
  const blockedReason = await returnBlockedReason(order, existing, now);

  return orderReturnInfoSchema.parse({
    request: existing ? serializeReturn(existing, true) : null,
    canRequest: blockedReason === null,
    canCancel: existing?.status === "requested",
    blockedReason,
    windowEndsAt: windowEndsAt?.toISOString() ?? null,
    windowDays: PROTECTION_DAYS,
  });
}

async function returnBlockedReason(order: OrderRow, existing: ReturnRow | null | undefined, now: Date): Promise<string | null> {
  if (!isFeatureEnabled("returns")) return "Fitur retur dinonaktifkan di toko ini.";
  if (existing) {
    if (existing.status === "requested") return "Sudah ada pengajuan retur yang menunggu penjual.";
    if (existing.status === "approved") return "Retur sudah disetujui dan sedang menunggu refund.";
    if (existing.status === "refunded") return "Dana pesanan ini sudah dikembalikan.";
    return "Pesanan ini sudah pernah diajukan retur. Hubungi admin bila perlu bantuan.";
  }
  if (!["shipped", "delivered", "completed"].includes(order.status)) {
    if (order.status === "pending_payment" || order.status === "paid" || order.status === "processing") {
      return "Retur bisa diajukan setelah pesanan dikirim.";
    }
    if (order.status === "return_requested") return "Pesanan sedang dalam proses retur.";
    if (order.status === "refund_pending_manual") return "Refund pesanan ini sedang diproses admin.";
    if (order.status === "refunded") return "Dana pesanan ini sudah dikembalikan.";
    return "Status pesanan ini tidak bisa diajukan retur.";
  }
  if (order.status === "completed") {
    const deadline = order.returnWindowEndsAt ?? windowFor(order.completedAt);
    if (deadline && now.getTime() > deadline.getTime()) {
      return `Masa perlindungan pembeli ${PROTECTION_DAYS} hari setelah pesanan selesai sudah berakhir.`;
    }
  }
  if (await hasActiveDispute(order.id)) {
    return "Selesaikan atau batalkan laporan sengketa terlebih dahulu sebelum mengajukan retur.";
  }
  return null;
}

async function hasActiveDispute(orderId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.disputes.id })
    .from(schema.disputes)
    .where(and(eq(schema.disputes.orderId, orderId), inArray(schema.disputes.status, ACTIVE_DISPUTES)))
    .limit(1);
  return Boolean(row);
}

/** Dipakai halaman daftar order seller — satu query untuk seluruh halaman. */
export async function loadReturnSummaries(orderIds: string[], includeBank = false): Promise<Map<string, ReturnSummary>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(schema.orderReturns)
    .where(inArray(schema.orderReturns.orderId, orderIds));
  return new Map(rows.map((r) => [r.orderId, serializeReturn(r, includeBank)]));
}

export function escrowView(order: OrderRow) {
  return serializeEscrow(order);
}

// ---------- Detail ----------

async function buildReturnDetail(row: ReturnRow, includeBank: boolean): Promise<ReturnDetail> {
  const order = await db.query.orders.findFirst({
    where: (o, { eq: eqq }) => eqq(o.id, row.orderId),
    with: {
      items: true,
      user: { columns: { name: true, email: true } },
      seller: { columns: { storeName: true, userId: true } },
    },
  });
  if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Pesanan tidak ditemukan.");

  return returnDetailSchema.parse({
    ...serializeReturn(row, includeBank),
    order: {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      total: order.total,
      buyerName: order.user?.name ?? null,
      buyerEmail: order.user?.email ?? null,
      storeName: order.seller.storeName,
      items: order.items.map((i) => ({
        productName: i.productName,
        variantName: i.variantName,
        quantity: i.quantity,
      })),
      createdAt: order.createdAt.toISOString(),
    },
    canReview: row.status === "requested",
  });
}

/** Detail retur untuk buyer/seller/admin; non-peserta mendapat 404. */
export async function getReturnDetail(actor: Actor, returnId: string): Promise<ReturnDetail> {
  const row = await loadReturnRow(returnId);
  if (!row) throw httpError(404, "RETURN_NOT_FOUND", "Pengajuan retur tidak ditemukan.");

  const order = await db.query.orders.findFirst({
    where: (o, { eq: eqq }) => eqq(o.id, row.orderId),
    with: { seller: { columns: { userId: true } } },
  });
  if (!order) throw httpError(404, "RETURN_NOT_FOUND", "Pengajuan retur tidak ditemukan.");

  const isBuyer = row.buyerId === actor.id;
  const isSeller = order.seller.userId === actor.id;
  if (!actor.isAdmin && !isBuyer && !isSeller) {
    throw httpError(404, "RETURN_NOT_FOUND", "Pengajuan retur tidak ditemukan.");
  }
  return buildReturnDetail(row, actor.isAdmin || isBuyer);
}

// ---------- Buat retur ----------

export async function createReturn(buyerId: string, orderId: string, input: CreateReturnInput): Promise<ReturnDetail> {
  requireReturnsFeature();

  const badEvidence = input.evidenceUrls.find((url) => !isOwnedR2Url(url));
  if (badEvidence) throw httpError(400, "INVALID_EVIDENCE", "Foto bukti harus diunggah lewat halaman retur.");

  const returnId = await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.id, orderId), eq(schema.orders.userId, buyerId)))
      .for("update");
    if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Pesanan tidak ditemukan.");

    const existing = await txFindAnyReturn(tx, order.id);
    if (existing) throw httpError(409, "RETURN_EXISTS", "Pesanan ini sudah pernah diajukan retur.");

    const blocked = await returnBlockedReason(order, existing, new Date());
    if (blocked) throw httpError(400, "RETURN_NOT_ELIGIBLE", blocked);

    const now = new Date();
    const [created] = await tx
      .insert(schema.orderReturns)
      .values({
        returnNo: generateReturnNo(),
        orderId: order.id,
        buyerId,
        sellerId: order.sellerId,
        reason: input.reason,
        description: input.description,
        evidenceUrls: input.evidenceUrls,
        amount: Math.max(order.total, 0),
        refundBankName: input.refundBank.bankName,
        refundAccountNumber: input.refundBank.accountNumber,
        refundAccountHolder: input.refundBank.accountHolder,
        previousStatus: order.status,
      })
      .returning();
    const row = created!;

    // Retur membekukan escrow & status; release otomatis tidak akan jalan selama status bukan completed.
    await tx
      .update(schema.orders)
      .set({
        status: "return_requested",
        escrowStatus: order.escrowStatus === "pending" ? "held" : order.escrowStatus,
        escrowAmount: order.escrowStatus === "pending" ? order.total : order.escrowAmount,
        escrowHeldAt: order.escrowStatus === "pending" ? now : order.escrowHeldAt,
        updatedAt: now,
      })
      .where(eq(schema.orders.id, order.id));

    const seller = await tx.query.sellers.findFirst({
      where: (s, { eq: eqq }) => eqq(s.id, order.sellerId),
      columns: { userId: true, storeName: true },
    });
    if (seller) {
      await notifySafely(tx, {
        userId: seller.userId,
        type: "return_update",
        title: "Pengajuan retur baru",
        body: `Pesanan ${order.orderNo} diajukan retur. Tinjau pengajuannya sekarang.`,
        payload: { orderId: order.id, returnId: row.id, audience: "seller", tab: "returns" },
      });
    }
    const admins = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.role, "admin"), eq(schema.users.status, "active")))
      .limit(20);
    for (const admin of admins) {
      await notifySafely(tx, {
        userId: admin.id,
        type: "return_update",
        title: "Pengajuan retur baru",
        body: `${row.returnNo} · ${order.orderNo} menunggu keputusan penjual/admin.`,
        payload: { orderId: order.id, returnId: row.id, audience: "admin" },
      });
    }
    return row.id;
  });

  const row = await loadReturnRow(returnId);
  return buildReturnDetail(row!, true);
}

// ---------- Keputusan penjual/admin ----------

async function loadActorSeller(actor: Actor, sellerId: string) {
  if (actor.isAdmin) return null;
  const seller = await db.query.sellers.findFirst({
    where: (s, { eq: eqq }) => eqq(s.userId, actor.id),
    columns: { id: true },
  });
  if (!seller || seller.id !== sellerId) {
    throw httpError(404, "RETURN_NOT_FOUND", "Pengajuan retur tidak ditemukan.");
  }
  return seller;
}

export async function approveReturn(actor: Actor, returnId: string, note: string): Promise<ReturnDetail> {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.orderReturns).where(eq(schema.orderReturns.id, returnId)).for("update");
    if (!row) throw httpError(404, "RETURN_NOT_FOUND", "Pengajuan retur tidak ditemukan.");
    await loadActorSeller(actor, row.sellerId);
    if (row.status !== "requested") throw httpError(409, "RETURN_NOT_REVIEWABLE", "Pengajuan retur ini sudah diproses.");

    const [order] = await tx.select().from(schema.orders).where(eq(schema.orders.id, row.orderId)).for("update");
    if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Pesanan tidak ditemukan.");
    if (order.status !== "return_requested") {
      throw httpError(409, "ORDER_STATUS_CHANGED", "Status pesanan sudah berubah. Muat ulang halaman.");
    }
    const [checkout] = await tx
      .select({ invoiceNo: schema.checkouts.invoiceNo })
      .from(schema.checkouts)
      .where(eq(schema.checkouts.id, order.checkoutId));

    const now = new Date();
    const refundMode: RefundMode = env.MIDTRANS_REFUND_ENABLED && order.total > 0 ? "midtrans" : "manual";
    await tx
      .update(schema.orderReturns)
      .set({ status: "approved", reviewedBy: actor.id, reviewedAt: now, resolutionNote: note, refundMode, updatedAt: now })
      .where(eq(schema.orderReturns.id, row.id));
    await tx
      .update(schema.orders)
      .set({ status: "refund_pending_manual", escrowStatus: "refund_pending_manual", updatedAt: now })
      .where(eq(schema.orders.id, order.id));

    await notifySafely(tx, {
      userId: row.buyerId,
      type: "return_update",
      title: "Retur disetujui",
      body: `Retur ${row.returnNo} disetujui. Dana akan dikembalikan ke rekening yang kamu isi.`,
      payload: { orderId: order.id, returnId: row.id },
    });
    return { row, order, refundMode, invoiceNo: checkout!.invoiceNo };
  });

  // Order tanpa nilai uang tidak perlu antrian refund manual.
  if (result.order.total === 0 || result.row.amount === 0) {
    return finalizeRefund(null, returnId, { reference: "NO_CHARGE", note: "Tidak ada dana yang perlu dikembalikan." });
  }

  if (result.refundMode === "midtrans") {
    const attempt = await requestRefund({
      orderId: result.invoiceNo,
      amount: result.row.amount,
      reason: `Retur ${result.row.returnNo}`,
      refundKey: result.row.returnNo,
    });
    if (attempt.ok) {
      return finalizeRefund(null, returnId, {
        reference: attempt.reference,
        note: "Refund otomatis via Midtrans.",
        mode: "midtrans",
      });
    }
    console.warn(`[return] refund Midtrans ${result.row.returnNo} gagal, masuk antrian manual:`, attempt.message);
    await db
      .update(schema.orderReturns)
      .set({ refundMode: "manual", updatedAt: new Date() })
      .where(eq(schema.orderReturns.id, returnId));
  }

  const detail = await getReturnDetail({ id: actor.id, isAdmin: actor.isAdmin }, returnId);
  return detail;
}

export async function rejectReturn(actor: Actor, returnId: string, note: string): Promise<ReturnDetail> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.orderReturns).where(eq(schema.orderReturns.id, returnId)).for("update");
    if (!row) throw httpError(404, "RETURN_NOT_FOUND", "Pengajuan retur tidak ditemukan.");
    await loadActorSeller(actor, row.sellerId);
    if (row.status !== "requested") throw httpError(409, "RETURN_NOT_REVIEWABLE", "Pengajuan retur ini sudah diproses.");

    const [order] = await tx.select().from(schema.orders).where(eq(schema.orders.id, row.orderId)).for("update");
    if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Pesanan tidak ditemukan.");

    const now = new Date();
    await tx
      .update(schema.orderReturns)
      .set({ status: "rejected", reviewedBy: actor.id, reviewedAt: now, resolutionNote: note, updatedAt: now })
      .where(eq(schema.orderReturns.id, row.id));
    if (order.status === "return_requested") {
      await tx
        .update(schema.orders)
        .set({ status: row.previousStatus, updatedAt: now })
        .where(eq(schema.orders.id, order.id));
    }

    await notifySafely(tx, {
      userId: row.buyerId,
      type: "return_update",
      title: "Retur ditolak",
      body: `Retur ${row.returnNo} ditolak: ${note}`,
      payload: { orderId: order.id, returnId: row.id },
    });
  });
  return getReturnDetail({ id: actor.id, isAdmin: actor.isAdmin }, returnId);
}

export async function cancelReturn(buyerId: string, returnId: string): Promise<ReturnDetail> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.orderReturns).where(eq(schema.orderReturns.id, returnId)).for("update");
    if (!row) throw httpError(404, "RETURN_NOT_FOUND", "Pengajuan retur tidak ditemukan.");
    if (row.buyerId !== buyerId) throw httpError(404, "RETURN_NOT_FOUND", "Pengajuan retur tidak ditemukan.");
    if (row.status !== "requested") {
      throw httpError(409, "RETURN_NOT_CANCELLABLE", "Pengajuan retur ini sudah diproses dan tidak bisa dibatalkan.");
    }

    const [order] = await tx.select().from(schema.orders).where(eq(schema.orders.id, row.orderId)).for("update");
    if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Pesanan tidak ditemukan.");

    const now = new Date();
    await tx
      .update(schema.orderReturns)
      .set({ status: "cancelled", updatedAt: now })
      .where(eq(schema.orderReturns.id, row.id));
    if (order.status === "return_requested") {
      await tx
        .update(schema.orders)
        .set({ status: row.previousStatus, updatedAt: now })
        .where(eq(schema.orders.id, order.id));
    }
    const seller = await tx.query.sellers.findFirst({
      where: (s, { eq: eqq }) => eqq(s.id, row.sellerId),
      columns: { userId: true },
    });
    if (seller) {
      await notifySafely(tx, {
        userId: seller.userId,
        type: "return_update",
        title: "Retur dibatalkan pembeli",
        body: `Pengajuan retur ${row.returnNo} dibatalkan pembeli.`,
        payload: { orderId: order.id, returnId: row.id, audience: "seller", tab: "returns" },
      });
    }
  });
  return getReturnDetail({ id: buyerId, isAdmin: false }, returnId);
}

// ---------- Refund manual (admin) ----------

export async function finalizeRefund(
  adminId: string | null,
  returnId: string,
  input: CompleteRefundInput & { mode?: RefundMode },
): Promise<ReturnDetail> {
  const detail = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.orderReturns).where(eq(schema.orderReturns.id, returnId)).for("update");
    if (!row) throw httpError(404, "RETURN_NOT_FOUND", "Pengajuan retur tidak ditemukan.");
    if (row.status === "refunded") throw httpError(409, "REFUND_ALREADY_DONE", "Refund untuk retur ini sudah ditandai selesai.");
    if (row.status !== "approved") throw httpError(409, "RETURN_NOT_APPROVED", "Setujui retur sebelum menandai refund selesai.");

    const [order] = await tx.select().from(schema.orders).where(eq(schema.orders.id, row.orderId)).for("update");
    if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Pesanan tidak ditemukan.");

    const now = new Date();
    await tx
      .update(schema.orderReturns)
      .set({
        status: "refunded",
        refundReference: input.reference,
        refundMode: input.mode ?? "manual",
        resolutionNote: input.note ?? row.resolutionNote,
        refundedAt: now,
        reviewedBy: adminId ?? row.reviewedBy,
        updatedAt: now,
      })
      .where(eq(schema.orderReturns.id, row.id));
    await tx
      .update(schema.orders)
      .set({
        status: "refunded",
        escrowStatus: "refunded",
        escrowRefundedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.orders.id, order.id));

    await notifySafely(tx, {
      userId: row.buyerId,
      type: "return_update",
      title: "Refund selesai",
      body: `Dana retur ${row.returnNo} sudah dikembalikan. Referensi: ${input.reference}.`,
      payload: { orderId: order.id, returnId: row.id },
    });
    return { row, order };
  });

  const seller = await db.query.sellers.findFirst({
    where: (s, { eq: eqq }) => eqq(s.id, detail.row.sellerId),
    columns: { userId: true },
  });
  if (seller) {
    await createNotification({
      userId: seller.userId,
      type: "return_update",
      title: "Refund retur selesai",
      body: `Refund ${detail.row.returnNo} untuk pesanan ${detail.order.orderNo} sudah dieksekusi.`,
      payload: { orderId: detail.order.id, returnId: detail.row.id, audience: "seller", tab: "returns" },
    }).catch((err) => console.warn("[return] gagal notifikasi seller:", err));
  }
  return buildReturnDetail((await loadReturnRow(returnId))!, true);
}

// ---------- Admin list ----------

export async function listAdminReturns(query: AdminReturnsQuery): Promise<AdminReturnListResponse> {
  const search = query.q ? `%${escapeLike(query.q)}%` : null;
  const viewFilter =
    query.view === "pending"
      ? eq(schema.orderReturns.status, "requested")
      : query.view === "refund_queue"
        ? eq(schema.orderReturns.status, "approved")
        : undefined;
  const searchFilter = search
    ? or(
        sql`${schema.orderReturns.returnNo} ilike ${search}`,
        sql`${schema.orders.orderNo} ilike ${search}`,
        sql`${schema.users.name} ilike ${search}`,
        sql`${schema.sellers.storeName} ilike ${search}`,
      )
    : undefined;
  const where = and(viewFilter, searchFilter);

  const [rows, [totalRow], [pendingRow], [queueRow]] = await Promise.all([
    db
      .select({
        ret: schema.orderReturns,
        orderNo: schema.orders.orderNo,
        orderStatus: schema.orders.status,
        buyerName: schema.users.name,
        buyerEmail: schema.users.email,
        storeName: schema.sellers.storeName,
      })
      .from(schema.orderReturns)
      .innerJoin(schema.orders, eq(schema.orderReturns.orderId, schema.orders.id))
      .innerJoin(schema.sellers, eq(schema.orderReturns.sellerId, schema.sellers.id))
      .leftJoin(schema.users, eq(schema.orderReturns.buyerId, schema.users.id))
      .where(where)
      .orderBy(desc(schema.orderReturns.createdAt))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ n: count() })
      .from(schema.orderReturns)
      .innerJoin(schema.orders, eq(schema.orderReturns.orderId, schema.orders.id))
      .innerJoin(schema.sellers, eq(schema.orderReturns.sellerId, schema.sellers.id))
      .leftJoin(schema.users, eq(schema.orderReturns.buyerId, schema.users.id))
      .where(where),
    db.select({ n: count() }).from(schema.orderReturns).where(eq(schema.orderReturns.status, "requested")),
    db.select({ n: count() }).from(schema.orderReturns).where(eq(schema.orderReturns.status, "approved")),
  ]);

  return adminReturnListResponseSchema.parse({
    items: rows.map((r) => ({
      ...serializeReturn(r.ret, true),
      orderNo: r.orderNo,
      orderStatus: r.orderStatus,
      buyerName: r.buyerName,
      buyerEmail: r.buyerEmail,
      storeName: r.storeName,
    })),
    page: query.page,
    pageSize: query.pageSize,
    total: totalRow?.n ?? 0,
    counts: { pending: pendingRow?.n ?? 0, refundQueue: queueRow?.n ?? 0 },
  });
}

// ---------- Scheduler: auto-complete, auto-release, auto-lock ----------

async function autoCompleteDelivered(log: FastifyBaseLogger): Promise<number> {
  const threshold = new Date(Date.now() - AUTO_COMPLETE_DAYS * DAY_MS);
  const candidates = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(and(eq(schema.orders.status, "delivered"), lte(schema.orders.deliveredAt, threshold)))
    .limit(BATCH_SIZE);

  let completed = 0;
  for (const candidate of candidates) {
    const done = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(schema.orders).where(eq(schema.orders.id, candidate.id)).for("update");
      if (!order || order.status !== "delivered") return false;
      if (!order.deliveredAt || order.deliveredAt > threshold) return false;
      if (await txFindActiveDispute(tx, order.id)) return false;
      if (await txFindActiveReturn(tx, order.id)) return false;

      const now = new Date();
      const windowEndsAt = addDays(now, PROTECTION_DAYS);
      await tx
        .update(schema.orders)
        .set({
          status: "completed",
          completedAt: now,
          returnWindowEndsAt: windowEndsAt,
          escrowStatus: order.escrowStatus === "pending" ? "held" : order.escrowStatus,
          escrowAmount: order.escrowStatus === "pending" ? order.total : order.escrowAmount,
          escrowHeldAt: order.escrowStatus === "pending" ? now : order.escrowHeldAt,
          escrowReleaseDueAt: windowEndsAt,
          updatedAt: now,
        })
        .where(eq(schema.orders.id, order.id));

      if (order.userId) {
        await notifySafely(tx, {
          userId: order.userId,
          type: "order_status",
          title: "Pesanan selesai otomatis",
          body: `Pesanan ${order.orderNo} otomatis selesai karena tidak ada konfirmasi. Retur masih bisa diajukan dalam ${PROTECTION_DAYS} hari.`,
          payload: { orderId: order.id },
        });
      }
      const seller = await tx.query.sellers.findFirst({
        where: (s, { eq: eqq }) => eqq(s.id, order.sellerId),
        columns: { userId: true },
      });
      if (seller) {
        await notifySafely(tx, {
          userId: seller.userId,
          type: "order_status",
          title: "Pesanan selesai otomatis",
          body: `Pesanan ${order.orderNo} selesai otomatis. Dana ditahan sampai masa perlindungan pembeli berakhir.`,
          payload: { orderId: order.id, audience: "seller", tab: "completed" },
        });
      }
      return true;
    });
    if (done) completed += 1;
  }
  if (completed > 0) log.info({ completed }, "[return] auto-complete pesanan delivered selesai");
  return completed;
}

async function releaseDueEscrow(log: FastifyBaseLogger): Promise<number> {
  const now = new Date();
  const candidates = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.status, "completed"),
        eq(schema.orders.escrowStatus, "held"),
        or(lte(schema.orders.escrowReleaseDueAt, now), isNull(schema.orders.escrowReleaseDueAt)),
      ),
    )
    .limit(BATCH_SIZE);

  let released = 0;
  for (const candidate of candidates) {
    const done = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(schema.orders).where(eq(schema.orders.id, candidate.id)).for("update");
      if (!order || order.status !== "completed" || order.escrowStatus !== "held") return false;

      const due = order.escrowReleaseDueAt ?? windowFor(order.completedAt);
      if (due && due > now) {
        if (!order.escrowReleaseDueAt) {
          await tx.update(schema.orders).set({ escrowReleaseDueAt: due }).where(eq(schema.orders.id, order.id));
        }
        return false;
      }
      if (await txFindActiveDispute(tx, order.id)) return false;
      if (await txFindActiveReturn(tx, order.id)) return false;

      const [updated] = await tx
        .update(schema.orders)
        .set({ escrowStatus: "released", escrowReleasedAt: now, updatedAt: now })
        .where(and(eq(schema.orders.id, order.id), eq(schema.orders.escrowStatus, "held")))
        .returning({ id: schema.orders.id, amount: schema.orders.escrowAmount, sellerId: schema.orders.sellerId });
      if (!updated) return false;

      await tx
        .update(schema.sellers)
        .set({ balance: sql`${schema.sellers.balance} + ${updated.amount}` })
        .where(eq(schema.sellers.id, updated.sellerId));

      const seller = await tx.query.sellers.findFirst({
        where: (s, { eq: eqq }) => eqq(s.id, updated.sellerId),
        columns: { userId: true },
      });
      if (seller) {
        await notifySafely(tx, {
          userId: seller.userId,
          type: "order_status",
          title: "Dana pesanan cair",
          body: `Dana pesanan ${order.orderNo} sebesar Rp${updated.amount.toLocaleString("id-ID")} sudah masuk ke saldo toko.`,
          payload: { orderId: order.id, audience: "seller", tab: "completed" },
        });
      }
      return true;
    });
    if (done) released += 1;
  }
  if (released > 0) log.info({ released }, "[return] auto-release escrow selesai");
  return released;
}

/** Dipanggil berkala oleh API (lihat return.scheduler.ts). Idempotent & aman multi-instance. */
export async function runReturnMaintenance(log: FastifyBaseLogger): Promise<void> {
  if (!isFeatureEnabled("returns")) return;
  await autoCompleteDelivered(log);
  await releaseDueEscrow(log);
}
