/**
 * T-11: chat realtime buyer ↔ seller. Satu percakapan per (buyer, seller); konteks produk opsional.
 * Semua aturan akses ada di sini (bukan di route): non-peserta selalu mendapat 404, bukan 403,
 * supaya keberadaan percakapan orang lain tidak bocor.
 */

import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  CHAT_MESSAGE_EVENT,
  CHAT_RATE_LIMIT_PER_MINUTE,
  CHAT_READ_EVENT,
  type ChatMessage,
  type ChatMessagesResponse,
  type ChatParty,
  type ChatProductContext,
  type ChatUnread,
  type ConversationListResponse,
  type ConversationMeta,
  type ListChatMessagesQuery,
  type ListConversationsQuery,
  type SendChatMessageInput,
  type StartConversationInput,
  chatMessageSchema,
  chatMessagesResponseSchema,
  chatReadEventSchema,
  conversationChannelName,
  conversationListResponseSchema,
  conversationMetaSchema,
} from "@ecommerce/shared";
import { db, schema } from "../../db";
import { httpError } from "../../lib/http-error";
import { uniqueViolationConstraint } from "../../lib/pg-error";
import { publishToChannel } from "../../lib/pusher";
import { pageOffset } from "../../lib/sql";
import { createNotification } from "../notification/notification.service";

const PREVIEW_LENGTH = 140;
const preview = (text: string) => (text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text);

// ---------- Konteks percakapan & peserta ----------

async function loadContext(conversationId: string) {
  return db.query.conversations.findFirst({
    where: (c, { eq: eqq }) => eqq(c.id, conversationId),
    with: {
      buyer: { columns: { id: true, name: true, status: true } },
      seller: { columns: { id: true, userId: true, storeName: true, status: true } },
      product: { columns: { id: true, name: true, slug: true, images: true, status: true, deletedAt: true } },
    },
  });
}
type Context = NonNullable<Awaited<ReturnType<typeof loadContext>>>;

function partyOf(ctx: Context, userId: string): ChatParty | null {
  if (ctx.buyerId === userId) return "buyer";
  if (ctx.seller.userId === userId) return "seller";
  return null;
}

async function requireParticipant(conversationId: string, userId: string) {
  const ctx = await loadContext(conversationId);
  const role = ctx ? partyOf(ctx, userId) : null;
  if (!ctx || !role) throw httpError(404, "CONVERSATION_NOT_FOUND", "Percakapan tidak ditemukan.");
  return { ctx, role };
}

/** Dipakai otorisasi channel Pusher: true hanya untuk buyer/seller percakapan tsb. */
export async function isConversationParticipant(conversationId: string, userId: string): Promise<boolean> {
  const ctx = await loadContext(conversationId);
  return Boolean(ctx && partyOf(ctx, userId));
}

/** Alasan pesan tidak bisa dikirim (null = boleh). Membaca tetap boleh untuk peserta. */
function sendBlockedReason(ctx: Context): string | null {
  if (ctx.seller.status !== "approved") return "Toko ini sedang tidak aktif, sehingga chat tidak bisa dikirim.";
  if (ctx.buyer.status !== "active") return "Akun pembeli sedang tidak aktif, sehingga chat tidak bisa dikirim.";
  return null;
}

// ---------- Serialisasi ----------

function serializeProduct(product: Context["product"]): ChatProductContext | null {
  if (!product) return null;
  const available = !product.deletedAt && product.status === "active";
  return { id: product.id, name: product.name, slug: available ? product.slug : null, imageUrl: product.images[0] ?? null };
}

type MessageRow = typeof schema.messages.$inferSelect;

function serializeMessage(row: MessageRow, buyerId: string): ChatMessage {
  return chatMessageSchema.parse({
    id: row.id,
    clientId: row.clientId,
    senderRole: row.senderId === buyerId ? "buyer" : "seller",
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  });
}

async function buildMeta(ctx: Context, role: ChatParty, userId: string): Promise<ConversationMeta> {
  // Pesan saya yang sudah dibaca lawan bicara: batas atas "Dibaca" di UI.
  const [read] = await db
    .select({ at: sql`max(${schema.messages.readAt})`.mapWith(schema.messages.readAt) })
    .from(schema.messages)
    .where(and(eq(schema.messages.conversationId, ctx.id), eq(schema.messages.senderId, userId)));
  const blocked = sendBlockedReason(ctx);

  return conversationMetaSchema.parse({
    id: ctx.id,
    viewerRole: role,
    counterpartName: role === "buyer" ? ctx.seller.storeName : ctx.buyer.name,
    product: serializeProduct(ctx.product),
    canSend: blocked === null,
    sendBlockedReason: blocked,
    readByCounterpartAt: read?.at ? new Date(read.at).toISOString() : null,
    unreadCount: role === "buyer" ? ctx.buyerUnread : ctx.sellerUnread,
    createdAt: ctx.createdAt.toISOString(),
  });
}

export async function getConversationMeta(conversationId: string, userId: string): Promise<ConversationMeta> {
  const { ctx, role } = await requireParticipant(conversationId, userId);
  return buildMeta(ctx, role, userId);
}

// ---------- Mulai / buka percakapan ----------

type Target = { buyerId: string; sellerId: string; productId: string | null };

async function resolveTarget(actor: { id: string }, input: StartConversationInput): Promise<Target> {
  if (input.productId) {
    const product = await db.query.products.findFirst({
      where: (p, { and: andd, eq: eqq, isNull: isNul }) => andd(eqq(p.id, input.productId!), isNul(p.deletedAt)),
      columns: { id: true, sellerId: true },
      with: { seller: { columns: { userId: true, status: true } } },
    });
    if (!product) throw httpError(404, "PRODUCT_NOT_FOUND", "Produk tidak ditemukan.");
    if (product.seller.userId === actor.id) {
      throw httpError(400, "CHAT_SELF", "Ini produk toko Anda sendiri — tidak bisa chat dengan diri sendiri.");
    }
    if (product.seller.status !== "approved") {
      throw httpError(409, "CHAT_UNAVAILABLE", "Toko ini sedang tidak aktif, sehingga chat tidak tersedia.");
    }
    return { buyerId: actor.id, sellerId: product.sellerId, productId: product.id };
  }

  const order = await db.query.orders.findFirst({
    where: (o, { eq: eqq }) => eqq(o.id, input.orderId!),
    columns: { id: true, userId: true, sellerId: true },
    with: {
      seller: { columns: { userId: true, status: true } },
      items: { columns: { productId: true }, limit: 1 },
    },
  });
  const isBuyer = order?.userId === actor.id;
  const isSeller = order?.seller.userId === actor.id;
  if (!order || (!isBuyer && !isSeller)) throw httpError(404, "ORDER_NOT_FOUND", "Pesanan tidak ditemukan.");
  if (isBuyer && isSeller) throw httpError(400, "CHAT_SELF", "Pesanan dari toko Anda sendiri — tidak bisa chat dengan diri sendiri.");
  if (!order.userId) {
    throw httpError(400, "CHAT_GUEST_BUYER", "Pembeli ini checkout sebagai tamu dan tidak bisa dihubungi lewat chat.");
  }
  if (order.seller.status !== "approved") {
    throw httpError(409, "CHAT_UNAVAILABLE", "Toko ini sedang tidak aktif, sehingga chat tidak tersedia.");
  }
  return { buyerId: order.userId, sellerId: order.sellerId, productId: order.items[0]?.productId ?? null };
}

/**
 * Ambil percakapan buyer–seller yang sudah ada, atau buat baru. Atomic lewat unique index
 * (buyer, seller): dua klik/tab bersamaan tidak membuat percakapan ganda. Konteks produk
 * diperbarui ke produk terbaru yang ditanyakan.
 */
export async function startConversation(actor: { id: string }, input: StartConversationInput): Promise<ConversationMeta> {
  const target = await resolveTarget(actor, input);

  const [row] = await db
    .insert(schema.conversations)
    .values(target)
    .onConflictDoUpdate({
      target: [schema.conversations.buyerId, schema.conversations.sellerId],
      set: { productId: sql`coalesce(excluded.product_id, ${schema.conversations.productId})` },
    })
    .returning({ id: schema.conversations.id });

  return getConversationMeta(row!.id, actor.id);
}

// ---------- Daftar percakapan & unread ----------

async function sellerIdOf(userId: string): Promise<string | null> {
  const seller = await db.query.sellers.findFirst({
    where: (s, { eq: eqq }) => eqq(s.userId, userId),
    columns: { id: true },
  });
  return seller?.id ?? null;
}

export async function getUnreadTotal(userId: string): Promise<ChatUnread> {
  const sellerId = await sellerIdOf(userId);
  const [asBuyer] = await db
    .select({ n: sql<number>`coalesce(sum(${schema.conversations.buyerUnread}), 0)::int` })
    .from(schema.conversations)
    .where(eq(schema.conversations.buyerId, userId));
  const [asSeller] = sellerId
    ? await db
        .select({ n: sql<number>`coalesce(sum(${schema.conversations.sellerUnread}), 0)::int` })
        .from(schema.conversations)
        .where(eq(schema.conversations.sellerId, sellerId))
    : [undefined];
  return { unreadCount: (asBuyer?.n ?? 0) + (asSeller?.n ?? 0) };
}

/** Percakapan milik user sebagai buyer ATAU seller. Percakapan yang belum berisi pesan tidak ditampilkan. */
export async function listConversations(userId: string, query: ListConversationsQuery): Promise<ConversationListResponse> {
  const sellerId = await sellerIdOf(userId);
  const scope = sellerId
    ? sql`(${schema.conversations.buyerId} = ${userId} or ${schema.conversations.sellerId} = ${sellerId})`
    : sql`${schema.conversations.buyerId} = ${userId}`;
  const where = and(scope, sql`${schema.conversations.lastMessageAt} is not null`);

  const [rows, [totalRow], unread] = await Promise.all([
    db
      .select({
        id: schema.conversations.id,
        buyerId: schema.conversations.buyerId,
        buyerUnread: schema.conversations.buyerUnread,
        sellerUnread: schema.conversations.sellerUnread,
        lastMessageAt: schema.conversations.lastMessageAt,
        buyerName: schema.users.name,
        storeName: schema.sellers.storeName,
        productName: schema.products.name,
      })
      .from(schema.conversations)
      .innerJoin(schema.users, eq(schema.conversations.buyerId, schema.users.id))
      .innerJoin(schema.sellers, eq(schema.conversations.sellerId, schema.sellers.id))
      .leftJoin(schema.products, eq(schema.conversations.productId, schema.products.id))
      .where(where)
      .orderBy(desc(schema.conversations.lastMessageAt), desc(schema.conversations.id))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db.select({ n: count() }).from(schema.conversations).where(where),
    getUnreadTotal(userId),
  ]);

  const ids = rows.map((r) => r.id);
  const lastRows = ids.length
    ? await db
        .selectDistinctOn([schema.messages.conversationId], {
          conversationId: schema.messages.conversationId,
          senderId: schema.messages.senderId,
          body: schema.messages.body,
          createdAt: schema.messages.createdAt,
        })
        .from(schema.messages)
        .where(inArray(schema.messages.conversationId, ids))
        .orderBy(schema.messages.conversationId, desc(schema.messages.createdAt), desc(schema.messages.id))
    : [];
  const lastByConversation = new Map(lastRows.map((m) => [m.conversationId, m] as const));

  const items = rows.flatMap((r) => {
    const last = lastByConversation.get(r.id);
    if (!last || !r.lastMessageAt) return [];
    const viewerRole: ChatParty = r.buyerId === userId ? "buyer" : "seller";
    return [
      {
        id: r.id,
        viewerRole,
        counterpartName: viewerRole === "buyer" ? r.storeName : r.buyerName,
        productName: r.productName,
        lastMessage: { body: preview(last.body), mine: last.senderId === userId, createdAt: last.createdAt.toISOString() },
        unreadCount: viewerRole === "buyer" ? r.buyerUnread : r.sellerUnread,
        lastMessageAt: r.lastMessageAt.toISOString(),
      },
    ];
  });

  return conversationListResponseSchema.parse({
    items,
    page: query.page,
    pageSize: query.pageSize,
    total: totalRow?.n ?? 0,
    unreadTotal: unread.unreadCount,
  });
}

// ---------- Riwayat pesan ----------

// Perbandingan baris (created_at, id) terhadap pesan acuan: urutan stabil walau dua pesan
// punya timestamp sama persis, dan presisi mikrodetik DB tidak hilang lewat JS Date.
const cursorOf = (conversationId: string, messageId: string) =>
  sql`(select m2.created_at, m2.id from messages m2 where m2.id = ${messageId} and m2.conversation_id = ${conversationId})`;

export async function listMessages(
  conversationId: string,
  userId: string,
  query: ListChatMessagesQuery,
): Promise<ChatMessagesResponse> {
  const { ctx } = await requireParticipant(conversationId, userId);
  const m = schema.messages;
  const inConversation = eq(m.conversationId, conversationId);

  // after: pesan baru (naik). Selain itu: halaman terbaru / lebih lama (turun, lalu dibalik).
  const ascending = Boolean(query.after);
  const cursor = query.after
    ? sql`(${m.createdAt}, ${m.id}) > ${cursorOf(conversationId, query.after)}`
    : query.before
      ? sql`(${m.createdAt}, ${m.id}) < ${cursorOf(conversationId, query.before)}`
      : undefined;

  const rows = await db
    .select()
    .from(m)
    .where(cursor ? and(inConversation, cursor) : inConversation)
    .orderBy(...(ascending ? [m.createdAt, m.id] : [desc(m.createdAt), desc(m.id)]))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  if (!ascending) page.reverse();

  return chatMessagesResponseSchema.parse({
    items: page.map((row) => serializeMessage(row, ctx.buyerId)),
    hasMore,
  });
}

// ---------- Kirim pesan ----------

async function findByClientId(conversationId: string, senderId: string, clientId: string) {
  const [row] = await db
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.senderId, senderId),
        eq(schema.messages.clientId, clientId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Notifikasi bell untuk penerima. Digabung: selama masih ada notifikasi chat BELUM DIBACA untuk
 * percakapan yang sama, pesan berikutnya tidak membuat baris baru (cegah bell dibanjiri) —
 * badge unread di menu Chat tetap menghitung semua pesan. Best-effort: gagal tidak membatalkan kirim.
 */
async function notifyRecipient(ctx: Context, senderRole: ChatParty, body: string) {
  const recipientRole: ChatParty = senderRole === "buyer" ? "seller" : "buyer";
  const recipientId = recipientRole === "seller" ? ctx.seller.userId : ctx.buyerId;

  const existing = await db.query.notifications.findFirst({
    where: (n, { and: andd, eq: eqq, sql: raw }) =>
      andd(
        eqq(n.userId, recipientId),
        eqq(n.type, "chat_message"),
        eqq(n.isRead, false),
        raw`${n.payload}->>'conversationId' = ${ctx.id}`,
      ),
    columns: { id: true },
  });
  if (existing) return;

  await createNotification({
    userId: recipientId,
    type: "chat_message",
    title: `Pesan baru dari ${senderRole === "buyer" ? ctx.buyer.name : ctx.seller.storeName}`,
    body: preview(body),
    payload: { conversationId: ctx.id, audience: recipientRole },
  });
}

export async function sendMessage(
  conversationId: string,
  actor: { id: string },
  input: SendChatMessageInput,
): Promise<ChatMessage> {
  const { ctx, role } = await requireParticipant(conversationId, actor.id);

  const blocked = sendBlockedReason(ctx);
  if (blocked) throw httpError(409, "CHAT_UNAVAILABLE", blocked);

  // Idempoten: kirim ulang dengan clientId sama mengembalikan pesan yang sudah tersimpan
  // (response sebelumnya hilang di jaringan). Dicek SEBELUM rate limit supaya retry tidak ditolak.
  const duplicate = await findByClientId(conversationId, actor.id, input.clientId);
  if (duplicate) return serializeMessage(duplicate, ctx.buyerId);

  const [recent] = await db
    .select({ n: count() })
    .from(schema.messages)
    .where(and(eq(schema.messages.senderId, actor.id), gte(schema.messages.createdAt, new Date(Date.now() - 60_000))));
  if ((recent?.n ?? 0) >= CHAT_RATE_LIMIT_PER_MINUTE) {
    throw httpError(429, "CHAT_RATE_LIMIT", "Terlalu banyak pesan dalam waktu singkat. Tunggu sebentar lalu coba lagi.");
  }

  let row: MessageRow;
  try {
    row = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(schema.messages)
        .values({ conversationId, senderId: actor.id, body: input.body, clientId: input.clientId })
        .returning();
      const message = inserted!;

      // Counter unread naik atomic di SQL (bukan read-then-write) → dua pesan bersamaan tidak saling menimpa.
      const bump =
        role === "buyer"
          ? { sellerUnread: sql`${schema.conversations.sellerUnread} + 1` }
          : { buyerUnread: sql`${schema.conversations.buyerUnread} + 1` };
      await tx
        .update(schema.conversations)
        .set({ lastMessageAt: message.createdAt, ...bump })
        .where(eq(schema.conversations.id, conversationId));
      return message;
    });
  } catch (err) {
    // Dua request dengan clientId sama tiba bersamaan: unique index menahan yang kedua.
    if (uniqueViolationConstraint(err) === "messages_client_uq") {
      const existing = await findByClientId(conversationId, actor.id, input.clientId);
      if (existing) return serializeMessage(existing, ctx.buyerId);
    }
    throw err;
  }

  const view = serializeMessage(row, ctx.buyerId);
  // Setelah commit: realtime ke yang sedang membuka thread + bell untuk penerima. Keduanya best-effort.
  void publishToChannel(conversationChannelName(conversationId), CHAT_MESSAGE_EVENT, view);
  void notifyRecipient(ctx, role, input.body).catch((err) => console.warn("[chat] notifikasi pesan gagal:", err));
  return view;
}

// ---------- Tandai dibaca ----------

export async function markConversationRead(conversationId: string, actor: { id: string }): Promise<{ ok: true }> {
  const { ctx, role } = await requireParticipant(conversationId, actor.id);
  const m = schema.messages;

  const readAt = await db.transaction(async (tx) => {
    // Pesan dari lawan bicara yang belum dibaca → dibaca. Jam DB (now()) dipakai agar konsisten
    // dengan created_at pesan pada penanda "Dibaca".
    const updated = await tx
      .update(m)
      .set({ readAt: sql`now()` })
      .where(and(eq(m.conversationId, conversationId), sql`${m.senderId} <> ${actor.id}`, sql`${m.readAt} is null`))
      .returning({ readAt: m.readAt });

    // Counter dihitung ulang dari pesan (bukan di-set 0) → pesan yang masuk bersamaan tidak "hilang" dari badge.
    const unreadFromOther =
      role === "buyer"
        ? sql`(select count(*)::int from messages where conversation_id = ${conversationId} and sender_id <> ${ctx.buyerId} and read_at is null)`
        : sql`(select count(*)::int from messages where conversation_id = ${conversationId} and sender_id = ${ctx.buyerId} and read_at is null)`;
    await tx
      .update(schema.conversations)
      .set(role === "buyer" ? { buyerUnread: unreadFromOther } : { sellerUnread: unreadFromOther })
      .where(eq(schema.conversations.id, conversationId));

    // Notifikasi chat percakapan ini ikut terbaca → badge bell turun tanpa user menandai manual.
    await tx
      .update(schema.notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(schema.notifications.userId, actor.id),
          eq(schema.notifications.type, "chat_message"),
          eq(schema.notifications.isRead, false),
          sql`${schema.notifications.payload}->>'conversationId' = ${conversationId}`,
        ),
      );

    return updated[0]?.readAt ?? null;
  });

  if (readAt) {
    const event = chatReadEventSchema.parse({ role, at: readAt.toISOString() });
    void publishToChannel(conversationChannelName(conversationId), CHAT_READ_EVENT, event);
  }
  return { ok: true };
}
