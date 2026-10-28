/**
 * T-10: tiket sengketa order. Pelapor = buyer atau seller dari order; admin memutuskan.
 * Semua aturan akses ada di sini (bukan di route): non-peserta selalu mendapat 404, bukan 403,
 * supaya keberadaan tiket/order orang lain tidak bocor.
 */

import { and, count, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import {
  ACTIVE_DISPUTE_STATUSES,
  type CreateDisputeInput,
  DISPUTE_DAILY_LIMIT,
  DISPUTE_DECISION_LABELS,
  DISPUTE_ELIGIBLE_ORDER_STATUSES,
  DISPUTE_MESSAGE_LIMIT,
  DISPUTE_REASONS_BY_ROLE,
  DISPUTE_REASON_LABELS,
  DISPUTE_STATUS_LABELS,
  DISPUTE_WINDOW_DAYS,
  type AdminListDisputesQuery,
  type DisputeDetail,
  type DisputeEligibility,
  type DisputeListResponse,
  type DisputeMessage,
  type DisputeMessageInput,
  type DisputeStatus,
  type DisputeSummary,
  type DisputeViewerRole,
  type ListDisputesQuery,
  type OrderDisputeInfo,
  type ResolveDisputeInput,
  disputeDetailSchema,
  disputeEligibilitySchema,
  disputeListResponseSchema,
  disputeMessageSchema,
  isActiveDispute,
  shippingStatusLabel,
} from "@ecommerce/shared";
import { db, schema } from "../../db";
import { httpError } from "../../lib/http-error";
import { generateDisputeTicketNo } from "../../lib/order-number";
import { uniqueViolationConstraint } from "../../lib/pg-error";
import { escapeLike, pageOffset } from "../../lib/sql";
import { notifySafely } from "../notification/notification.service";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Party = "buyer" | "seller";
type NotifyParams = Parameters<typeof notifySafely>[1];

const DAY_MS = 86_400_000;
/** Pesan identik dari penulis yang sama dalam jendela ini dianggap kirim ganda (klik ganda/retry jaringan). */
const DUPLICATE_MESSAGE_WINDOW_MS = 10_000;
const MAX_ADMIN_RECIPIENTS = 20;
const PREVIEW_LENGTH = 140;

const preview = (text: string) => (text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text);

// ---------- Order & peserta ----------

const orderContextWith = {
  items: true,
  user: { columns: { id: true, name: true } },
  seller: { with: { user: { columns: { id: true, name: true } } } },
} as const;

async function loadOrderContext(orderId: string) {
  return db.query.orders.findFirst({
    where: (o, { eq: eqq }) => eqq(o.id, orderId),
    with: orderContextWith,
  });
}
type OrderContext = NonNullable<Awaited<ReturnType<typeof loadOrderContext>>>;

/** Peran user pada order, atau null bila bukan peserta. Order milik sendiri (buyer = seller) dihitung buyer. */
function partyRoleOf(order: OrderContext, userId: string): Party | null {
  if (order.userId === userId) return "buyer";
  if (order.seller.userId === userId) return "seller";
  return null;
}

// ---------- Kelayakan pengajuan ----------

type DisputeState = { activeId: string | null; decided: boolean };

/** Status tiket per order: ada yang aktif? pernah diputuskan admin (resolved/dismissed)? */
async function loadDisputeStates(orderIds: string[]): Promise<Map<string, DisputeState>> {
  const states = new Map<string, DisputeState>();
  if (orderIds.length === 0) return states;

  const rows = await db
    .select({ orderId: schema.disputes.orderId, id: schema.disputes.id, status: schema.disputes.status })
    .from(schema.disputes)
    .where(
      and(
        inArray(schema.disputes.orderId, orderIds),
        inArray(schema.disputes.status, ["open", "in_review", "resolved", "dismissed"]),
      ),
    )
    .orderBy(desc(schema.disputes.createdAt));

  for (const row of rows) {
    const state = states.get(row.orderId) ?? { activeId: null, decided: false };
    if (isActiveDispute(row.status)) state.activeId ??= row.id;
    else state.decided = true;
    states.set(row.orderId, state);
  }
  return states;
}

const STATUS_BLOCK_MESSAGE: Partial<Record<OrderContext["status"], string>> = {
  pending_payment: "Pesanan belum dibayar.",
  cancelled: "Pesanan sudah dibatalkan.",
  refunded: "Dana pesanan sudah dikembalikan.",
  return_requested: "Pesanan sedang dalam proses retur.",
  refund_pending_manual: "Refund pesanan sedang diproses admin.",
};

type EligibilityInput = {
  status: OrderContext["status"];
  completedAt: Date | null;
  userId: string | null;
  sellerUserId: string;
};

function blockedReason(order: EligibilityInput, role: Party, state: DisputeState | undefined, now: Date): string | null {
  if (state?.activeId) return "Sudah ada laporan aktif untuk pesanan ini.";
  if (order.userId === order.sellerUserId) return "Pesanan dari toko Anda sendiri tidak bisa dilaporkan.";
  if (!DISPUTE_ELIGIBLE_ORDER_STATUSES.includes(order.status)) {
    return STATUS_BLOCK_MESSAGE[order.status] ?? "Status pesanan ini tidak bisa dilaporkan.";
  }
  if (role === "seller" && order.status === "paid") {
    return "Proses pesanan terlebih dahulu sebelum melaporkan masalah pengiriman.";
  }
  if (order.status === "completed" && order.completedAt && now.getTime() - order.completedAt.getTime() > DISPUTE_WINDOW_DAYS * DAY_MS) {
    return `Batas waktu pelaporan ${DISPUTE_WINDOW_DAYS} hari setelah pesanan selesai sudah lewat.`;
  }
  if (state?.decided) return "Laporan untuk pesanan ini sudah diputuskan admin.";
  return null;
}

function buildDisputeInfo(order: EligibilityInput, role: Party, state: DisputeState | undefined, now = new Date()): OrderDisputeInfo {
  const reason = blockedReason(order, role, state, now);
  return {
    activeId: state?.activeId ?? null,
    canOpen: reason === null,
    // Tiket aktif ditampilkan sebagai tombol "Lihat laporan", bukan sebagai alasan terblokir.
    blockedReason: state?.activeId ? null : reason,
  };
}

/** Info tombol sengketa untuk banyak order sekaligus (1 query) — dipakai detail order buyer & daftar order seller. */
export async function loadOrderDisputeInfos(
  orders: { id: string; status: OrderContext["status"]; completedAt: Date | null; userId: string | null }[],
  role: Party,
  sellerUserId: string,
): Promise<Map<string, OrderDisputeInfo>> {
  const states = await loadDisputeStates(orders.map((o) => o.id));
  const now = new Date();
  return new Map(
    orders.map((o) => [o.id, buildDisputeInfo({ ...o, sellerUserId }, role, states.get(o.id), now)] as const),
  );
}

export async function hasActiveDispute(orderId: string): Promise<boolean> {
  const row = await db.query.disputes.findFirst({
    where: (d, { and: andd, eq: eqq, inArray: inArr }) => andd(eqq(d.orderId, orderId), inArr(d.status, [...ACTIVE_DISPUTE_STATUSES])),
    columns: { id: true },
  });
  return Boolean(row);
}

// ---------- Serialisasi ----------

function serializeOrder(order: OrderContext) {
  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status,
    total: order.total,
    shippingStatusLabel: order.shippingStatus ? shippingStatusLabel(order.shippingStatus) : null,
    trackingNumber: order.trackingNumber,
    items: order.items.map((i) => ({ productName: i.productName, variantName: i.variantName, quantity: i.quantity })),
    createdAt: order.createdAt.toISOString(),
    completedAt: order.completedAt ? order.completedAt.toISOString() : null,
  };
}

/** "Perlu dibalas" dari sudut pandang viewer: tiket aktif yang pesan terakhirnya BUKAN darinya. */
const needsReplyFor = (viewer: DisputeViewerRole, status: DisputeStatus, lastMessageRole: DisputeViewerRole | null) =>
  isActiveDispute(status) && lastMessageRole !== null && lastMessageRole !== viewer;

const summaryColumns = {
  id: schema.disputes.id,
  ticketNo: schema.disputes.ticketNo,
  orderId: schema.disputes.orderId,
  orderNo: schema.orders.orderNo,
  orderUserId: schema.orders.userId,
  status: schema.disputes.status,
  reason: schema.disputes.reason,
  reporterRole: schema.disputes.reporterRole,
  outcome: schema.disputes.outcome,
  lastMessageRole: schema.disputes.lastMessageRole,
  createdAt: schema.disputes.createdAt,
  updatedAt: schema.disputes.updatedAt,
  buyerName: schema.users.name,
  storeName: schema.sellers.storeName,
} as const;

function summaryQuery() {
  return db
    .select(summaryColumns)
    .from(schema.disputes)
    .innerJoin(schema.orders, eq(schema.disputes.orderId, schema.orders.id))
    .innerJoin(schema.sellers, eq(schema.orders.sellerId, schema.sellers.id))
    .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id));
}

function countQuery() {
  return db
    .select({ n: count() })
    .from(schema.disputes)
    .innerJoin(schema.orders, eq(schema.disputes.orderId, schema.orders.id))
    .innerJoin(schema.sellers, eq(schema.orders.sellerId, schema.sellers.id))
    .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id));
}

type SummaryRow = Awaited<ReturnType<typeof summaryQuery>>[number];

function toSummary(row: SummaryRow, viewerRole: DisputeViewerRole): DisputeSummary {
  return {
    id: row.id,
    ticketNo: row.ticketNo,
    orderId: row.orderId,
    orderNo: row.orderNo,
    status: row.status,
    reason: row.reason,
    reporterRole: row.reporterRole,
    buyerName: row.buyerName,
    storeName: row.storeName,
    viewerRole,
    outcome: row.outcome,
    lastMessageRole: row.lastMessageRole,
    needsReply: needsReplyFor(viewerRole, row.status, row.lastMessageRole),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const ACTIVE = [...ACTIVE_DISPUTE_STATUSES];

// ---------- Daftar ----------

/** Tiket milik user sebagai buyer ATAU seller dari order. */
export async function listMyDisputes(userId: string, query: ListDisputesQuery): Promise<DisputeListResponse> {
  const seller = await db.query.sellers.findFirst({
    where: (s, { eq: eqq }) => eqq(s.userId, userId),
    columns: { id: true },
  });
  const scope = seller
    ? or(eq(schema.orders.userId, userId), eq(schema.orders.sellerId, seller.id))
    : eq(schema.orders.userId, userId);

  const viewFilter =
    query.view === "active"
      ? inArray(schema.disputes.status, ACTIVE)
      : query.view === "closed"
        ? sql`${schema.disputes.status} not in ('open', 'in_review')`
        : undefined;
  const where = and(scope, viewFilter);

  const [rows, [totalRow], [activeRow]] = await Promise.all([
    summaryQuery()
      .where(where)
      .orderBy(desc(schema.disputes.updatedAt))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    countQuery().where(where),
    countQuery().where(and(scope, inArray(schema.disputes.status, ACTIVE))),
  ]);

  return disputeListResponseSchema.parse({
    items: rows.map((r) => toSummary(r, r.orderUserId === userId ? "buyer" : "seller")),
    page: query.page,
    pageSize: query.pageSize,
    total: totalRow?.n ?? 0,
    activeCount: activeRow?.n ?? 0,
  });
}

export async function listDisputesForAdmin(query: AdminListDisputesQuery): Promise<DisputeListResponse> {
  const search = query.q ? `%${escapeLike(query.q)}%` : null;
  const viewFilter =
    query.view === "active"
      ? inArray(schema.disputes.status, ACTIVE)
      : query.view === "needs_reply"
        ? and(inArray(schema.disputes.status, ACTIVE), sql`${schema.disputes.lastMessageRole} in ('buyer', 'seller')`)
        : query.view === "closed"
          ? sql`${schema.disputes.status} not in ('open', 'in_review')`
          : undefined;
  const searchFilter = search
    ? or(
        sql`${schema.disputes.ticketNo} ilike ${search}`,
        sql`${schema.orders.orderNo} ilike ${search}`,
        sql`${schema.users.name} ilike ${search}`,
        sql`${schema.users.email} ilike ${search}`,
        sql`${schema.sellers.storeName} ilike ${search}`,
      )
    : undefined;
  const where = and(viewFilter, searchFilter);
  // Antrian kerja: yang paling lama menunggu di atas; riwayat: terbaru dulu.
  const order = query.view === "closed" || query.view === "all" ? desc(schema.disputes.updatedAt) : schema.disputes.updatedAt;

  const [rows, [totalRow], [activeRow]] = await Promise.all([
    summaryQuery()
      .where(where)
      .orderBy(order)
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    countQuery().where(where),
    countQuery().where(inArray(schema.disputes.status, ACTIVE)),
  ]);

  return disputeListResponseSchema.parse({
    items: rows.map((r) => toSummary(r, "admin")),
    page: query.page,
    pageSize: query.pageSize,
    total: totalRow?.n ?? 0,
    activeCount: activeRow?.n ?? 0,
  });
}

// ---------- Detail ----------

async function loadDisputeContext(disputeId: string) {
  return db.query.disputes.findFirst({
    where: (d, { eq: eqq }) => eqq(d.id, disputeId),
    with: {
      order: { with: orderContextWith },
      resolver: { columns: { name: true } },
      messages: {
        orderBy: (m, { asc }) => asc(m.createdAt),
        with: { author: { columns: { id: true, name: true } } },
      },
    },
  });
}
type DisputeContext = NonNullable<Awaited<ReturnType<typeof loadDisputeContext>>>;

export type Actor = { id: string; isAdmin: boolean };

/** Peran viewer di tiket; null = tidak boleh melihat (dipetakan ke 404 oleh pemanggil). */
function viewerRoleOf(ctx: { order: OrderContext }, actor: Actor): DisputeViewerRole | null {
  if (actor.isAdmin) return "admin";
  return partyRoleOf(ctx.order, actor.id);
}

function authorName(role: DisputeViewerRole, ctx: DisputeContext, fallback: string): string {
  if (role === "admin") return "Admin";
  if (role === "seller") return ctx.order.seller.storeName;
  return fallback;
}

function serializeMessage(
  m: DisputeContext["messages"][number],
  ctx: DisputeContext,
  actorId: string,
): DisputeMessage {
  return disputeMessageSchema.parse({
    id: m.id,
    authorRole: m.authorRole,
    authorName: authorName(m.authorRole, ctx, m.author.name),
    body: m.body,
    mine: m.authorId === actorId,
    createdAt: m.createdAt.toISOString(),
  });
}

function serializeDetail(ctx: DisputeContext, viewerRole: DisputeViewerRole, actor: Actor): DisputeDetail {
  const active = isActiveDispute(ctx.status);
  const summary = {
    id: ctx.id,
    ticketNo: ctx.ticketNo,
    orderId: ctx.orderId,
    orderNo: ctx.order.orderNo,
    status: ctx.status,
    reason: ctx.reason,
    reporterRole: ctx.reporterRole,
    buyerName: ctx.order.user?.name ?? null,
    storeName: ctx.order.seller.storeName,
    viewerRole,
    outcome: ctx.outcome,
    lastMessageRole: ctx.lastMessageRole,
    needsReply: needsReplyFor(viewerRole, ctx.status, ctx.lastMessageRole),
    createdAt: ctx.createdAt.toISOString(),
    updatedAt: ctx.updatedAt.toISOString(),
  };

  return disputeDetailSchema.parse({
    ...summary,
    description: ctx.description,
    resolutionNote: ctx.resolutionNote,
    resolvedAt: ctx.closedAt ? ctx.closedAt.toISOString() : null,
    resolvedByName: ctx.resolver ? "Admin" : null,
    order: serializeOrder(ctx.order),
    messages: ctx.messages.map((m) => serializeMessage(m, ctx, actor.id)),
    canReply: active && ctx.messages.length < DISPUTE_MESSAGE_LIMIT,
    canWithdraw: active && !actor.isAdmin && ctx.reporterId === actor.id,
    canResolve: active && actor.isAdmin,
  });
}

export async function getDisputeDetail(disputeId: string, actor: Actor): Promise<DisputeDetail> {
  const ctx = await loadDisputeContext(disputeId);
  const role = ctx ? viewerRoleOf(ctx, actor) : null;
  if (!ctx || !role) throw httpError(404, "DISPUTE_NOT_FOUND", "Tiket tidak ditemukan.");
  return serializeDetail(ctx, role, actor);
}

// ---------- Eligibility (data awal form pengajuan) ----------

export async function getDisputeEligibility(userId: string, orderId: string): Promise<DisputeEligibility> {
  const order = await loadOrderContext(orderId);
  const role = order ? partyRoleOf(order, userId) : null;
  if (!order || !role) throw httpError(404, "ORDER_NOT_FOUND", "Pesanan tidak ditemukan.");

  const states = await loadDisputeStates([order.id]);
  const info = buildDisputeInfo({ ...order, sellerUserId: order.seller.userId }, role, states.get(order.id));
  return disputeEligibilitySchema.parse({
    order: serializeOrder(order),
    role,
    counterpartName: role === "buyer" ? order.seller.storeName : (order.user?.name ?? "Pembeli"),
    dispute: info,
  });
}

// ---------- Notifikasi ----------

async function adminRecipients(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.role, "admin"), eq(schema.users.status, "active")))
    .limit(MAX_ADMIN_RECIPIENTS);
  return rows.map((r) => r.id);
}

async function notifyUsers(tx: Tx, userIds: (string | null)[], build: (userId: string) => Omit<NotifyParams, "userId">) {
  // Dedupe + buang null (pembeli guest) + jangan beri tahu pelaku sendiri (sudah dibuang pemanggil).
  for (const userId of new Set(userIds.filter((id): id is string => Boolean(id)))) {
    await notifySafely(tx, { userId, ...build(userId) });
  }
}

const userPayload = (d: { id: string }, orderId: string) => ({ disputeId: d.id, orderId, audience: "user" });
const adminPayload = (d: { id: string }, orderId: string) => ({ disputeId: d.id, orderId, audience: "admin" });

// ---------- Buat tiket ----------

export async function createDispute(actor: { id: string }, input: CreateDisputeInput): Promise<DisputeDetail> {
  const order = await loadOrderContext(input.orderId);
  const role = order ? partyRoleOf(order, actor.id) : null;
  if (!order || !role) throw httpError(404, "ORDER_NOT_FOUND", "Pesanan tidak ditemukan.");

  if (!DISPUTE_REASONS_BY_ROLE[role].includes(input.reason)) {
    throw httpError(400, "INVALID_REASON", "Alasan yang dipilih tidak sesuai dengan peran Anda di pesanan ini.");
  }

  const states = await loadDisputeStates([order.id]);
  const info = buildDisputeInfo({ ...order, sellerUserId: order.seller.userId }, role, states.get(order.id));
  if (!info.canOpen) {
    throw info.activeId
      ? httpError(409, "DISPUTE_ALREADY_OPEN", "Sudah ada laporan aktif untuk pesanan ini.")
      : httpError(400, "DISPUTE_NOT_ELIGIBLE", info.blockedReason ?? "Pesanan ini tidak bisa dilaporkan.");
  }

  const [recent] = await db
    .select({ n: count() })
    .from(schema.disputes)
    .where(and(eq(schema.disputes.reporterId, actor.id), gte(schema.disputes.createdAt, new Date(Date.now() - DAY_MS))));
  if ((recent?.n ?? 0) >= DISPUTE_DAILY_LIMIT) {
    throw httpError(429, "DISPUTE_RATE_LIMIT", `Anda sudah membuat ${DISPUTE_DAILY_LIMIT} laporan dalam 24 jam terakhir. Coba lagi besok.`);
  }

  const counterpartUserId = role === "buyer" ? order.seller.userId : order.userId;
  const reasonLabel = DISPUTE_REASON_LABELS[input.reason];

  // Nomor tiket acak: tabrakan sangat jarang, tapi ditangani dengan mengulang.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.disputes)
          .values({
            ticketNo: generateDisputeTicketNo(),
            orderId: order.id,
            reporterId: actor.id,
            reporterRole: role,
            reason: input.reason,
            description: input.description,
            lastMessageRole: role,
          })
          .returning();
        const dispute = row!;

        await notifyUsers(tx, [counterpartUserId], () => ({
          type: "dispute_update",
          title: `Pesanan ${order.orderNo} dilaporkan`,
          body: `${reasonLabel}: ${preview(input.description)}`,
          payload: userPayload(dispute, order.id),
        }));
        await notifyUsers(tx, await adminRecipients(tx), () => ({
          type: "dispute_update",
          title: "Tiket sengketa baru",
          body: `${dispute.ticketNo} · ${order.orderNo}: ${reasonLabel}`,
          payload: adminPayload(dispute, order.id),
        }));
        return dispute;
      });
      return getDisputeDetail(created.id, { id: actor.id, isAdmin: false });
    } catch (err) {
      const constraint = uniqueViolationConstraint(err);
      // Dua klik/dua tab bersamaan: partial unique index menjamin hanya satu yang lolos.
      if (constraint === "disputes_order_active_uq") {
        throw httpError(409, "DISPUTE_ALREADY_OPEN", "Sudah ada laporan aktif untuk pesanan ini.");
      }
      if (constraint === "disputes_ticket_no_uq") continue;
      throw err;
    }
  }
  throw httpError(500, "TICKET_NUMBER_FAILED", "Gagal membuat nomor tiket. Coba kirim ulang.");
}

// ---------- Balas ----------

const closedError = (status: DisputeStatus) =>
  httpError(409, "DISPUTE_CLOSED", `Tiket ini sudah ditutup (${DISPUTE_STATUS_LABELS[status]}).`);

export async function addDisputeMessage(disputeId: string, actor: Actor, input: DisputeMessageInput): Promise<DisputeMessage> {
  const ctx = await loadDisputeContext(disputeId);
  const role = ctx ? viewerRoleOf(ctx, actor) : null;
  if (!ctx || !role) throw httpError(404, "DISPUTE_NOT_FOUND", "Tiket tidak ditemukan.");

  const messageId = await db.transaction(async (tx) => {
    // Kunci baris tiket: balasan paralel & aksi admin (resolve) diserialkan, status dibaca ulang di bawah.
    const [locked] = await tx.select().from(schema.disputes).where(eq(schema.disputes.id, disputeId)).for("update");
    if (!locked) throw httpError(404, "DISPUTE_NOT_FOUND", "Tiket tidak ditemukan.");
    if (!isActiveDispute(locked.status)) throw closedError(locked.status);

    const [last] = await tx
      .select()
      .from(schema.disputeMessages)
      .where(eq(schema.disputeMessages.disputeId, disputeId))
      .orderBy(desc(schema.disputeMessages.createdAt))
      .limit(1);
    if (
      last &&
      last.authorId === actor.id &&
      last.body === input.body &&
      Date.now() - last.createdAt.getTime() < DUPLICATE_MESSAGE_WINDOW_MS
    ) {
      return last.id;
    }

    const [total] = await tx.select({ n: count() }).from(schema.disputeMessages).where(eq(schema.disputeMessages.disputeId, disputeId));
    if ((total?.n ?? 0) >= DISPUTE_MESSAGE_LIMIT) {
      throw httpError(409, "DISPUTE_MESSAGE_LIMIT", "Tiket ini sudah mencapai batas jumlah pesan. Hubungi admin lewat tiket baru bila perlu.");
    }

    const [message] = await tx
      .insert(schema.disputeMessages)
      .values({ disputeId, authorId: actor.id, authorRole: role, body: input.body })
      .returning();

    // Admin yang pertama kali membalas = tiket mulai ditinjau.
    const nextStatus: DisputeStatus = role === "admin" && locked.status === "open" ? "in_review" : locked.status;
    await tx
      .update(schema.disputes)
      .set({ lastMessageRole: role, status: nextStatus, updatedAt: new Date() })
      .where(eq(schema.disputes.id, disputeId));

    const buyerUserId = ctx.order.userId;
    const sellerUserId = ctx.order.seller.userId;
    const parties = role === "admin" ? [buyerUserId, sellerUserId] : [role === "buyer" ? sellerUserId : buyerUserId];
    await notifyUsers(tx, parties, () => ({
      type: "dispute_update",
      title: role === "admin" ? `Admin membalas tiket ${ctx.ticketNo}` : `Balasan baru di tiket ${ctx.ticketNo}`,
      body: preview(input.body),
      payload: userPayload(ctx, ctx.orderId),
    }));
    // Admin hanya diberi tahu bila sudah menangani tiketnya (in_review); tiket baru sudah memberi tahu semua admin.
    if (role !== "admin" && nextStatus === "in_review") {
      await notifyUsers(tx, await adminRecipients(tx), () => ({
        type: "dispute_update",
        title: `Balasan baru di tiket ${ctx.ticketNo}`,
        body: preview(input.body),
        payload: adminPayload(ctx, ctx.orderId),
      }));
    }
    return message!.id;
  });

  const fresh = await loadDisputeContext(disputeId);
  const message = fresh?.messages.find((m) => m.id === messageId);
  if (!fresh || !message) throw httpError(500, "MESSAGE_NOT_FOUND", "Pesan tersimpan tetapi gagal dimuat. Muat ulang halaman.");
  return serializeMessage(message, fresh, actor.id);
}

// ---------- Batalkan (pelapor) ----------

export async function withdrawDispute(disputeId: string, actor: { id: string }): Promise<DisputeDetail> {
  const ctx = await loadDisputeContext(disputeId);
  const role = ctx ? partyRoleOf(ctx.order, actor.id) : null;
  if (!ctx || !role) throw httpError(404, "DISPUTE_NOT_FOUND", "Tiket tidak ditemukan.");
  if (ctx.reporterId !== actor.id) {
    throw httpError(403, "NOT_REPORTER", "Hanya pelapor yang dapat membatalkan laporan ini.");
  }

  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(schema.disputes).where(eq(schema.disputes.id, disputeId)).for("update");
    if (!locked) throw httpError(404, "DISPUTE_NOT_FOUND", "Tiket tidak ditemukan.");
    if (!isActiveDispute(locked.status)) throw closedError(locked.status);

    await tx
      .update(schema.disputes)
      .set({ status: "withdrawn", closedAt: new Date() })
      .where(eq(schema.disputes.id, disputeId));

    const counterpart = role === "buyer" ? ctx.order.seller.userId : ctx.order.userId;
    await notifyUsers(tx, [counterpart], () => ({
      type: "dispute_update",
      title: `Laporan ${ctx.ticketNo} dibatalkan`,
      body: `Pelapor membatalkan laporan untuk pesanan ${ctx.order.orderNo}.`,
      payload: userPayload(ctx, ctx.orderId),
    }));
    // Admin yang sudah menangani perlu tahu tiketnya tidak perlu diputuskan lagi.
    if (locked.status === "in_review") {
      await notifyUsers(tx, await adminRecipients(tx), () => ({
        type: "dispute_update",
        title: `Laporan ${ctx.ticketNo} dibatalkan`,
        body: `Pelapor membatalkan laporan untuk pesanan ${ctx.order.orderNo}.`,
        payload: adminPayload(ctx, ctx.orderId),
      }));
    }
  });

  return getDisputeDetail(disputeId, { id: actor.id, isAdmin: false });
}

// ---------- Putuskan (admin) ----------

export async function resolveDispute(disputeId: string, admin: { id: string }, input: ResolveDisputeInput): Promise<DisputeDetail> {
  const ctx = await loadDisputeContext(disputeId);
  if (!ctx) throw httpError(404, "DISPUTE_NOT_FOUND", "Tiket tidak ditemukan.");

  await db.transaction(async (tx) => {
    // Dua admin menekan "putuskan" bersamaan: yang kedua melihat status sudah tertutup → 409, bukan menimpa.
    const [locked] = await tx.select().from(schema.disputes).where(eq(schema.disputes.id, disputeId)).for("update");
    if (!locked) throw httpError(404, "DISPUTE_NOT_FOUND", "Tiket tidak ditemukan.");
    if (!isActiveDispute(locked.status)) throw closedError(locked.status);

    const outcome = input.decision === "dismiss" ? null : input.decision;
    await tx
      .update(schema.disputes)
      .set({
        status: outcome ? "resolved" : "dismissed",
        outcome,
        resolutionNote: input.note,
        resolvedBy: admin.id,
        closedAt: new Date(),
      })
      .where(eq(schema.disputes.id, disputeId));

    await notifyUsers(tx, [ctx.order.userId, ctx.order.seller.userId], () => ({
      type: "dispute_update",
      title: `Tiket ${ctx.ticketNo} diputuskan`,
      body: `Keputusan admin: ${DISPUTE_DECISION_LABELS[input.decision]}. ${preview(input.note)}`,
      payload: userPayload(ctx, ctx.orderId),
    }));
  });

  return getDisputeDetail(disputeId, { id: admin.id, isAdmin: true });
}

export { loadDisputeStates };
