import { z } from "zod";

// ---------- Konstanta ----------

export const CHAT_MESSAGE_MAX = 2000;
export const CHAT_PAGE_SIZE = 30;
/** Anti-spam: pesan per user per menit. Retry dengan clientId sama TIDAK dihitung (idempoten). */
export const CHAT_RATE_LIMIT_PER_MINUTE = 20;

// ---------- Realtime (Pusher) ----------

export const CHAT_MESSAGE_EVENT = "chat.message";
export const CHAT_READ_EVENT = "chat.read";
export const CHAT_CHANNEL_PREFIX = "private-chat-";

/** Channel private per percakapan — hanya buyer & seller percakapan itu yang boleh subscribe. */
export const conversationChannelName = (conversationId: string) => `${CHAT_CHANNEL_PREFIX}${conversationId}`;

/** id percakapan dari nama channel, atau null bila bukan channel chat. */
export function parseConversationChannel(channelName: string): string | null {
  if (!channelName.startsWith(CHAT_CHANNEL_PREFIX)) return null;
  const id = channelName.slice(CHAT_CHANNEL_PREFIX.length);
  return id.length > 0 ? id : null;
}

// ---------- Input ----------

export const chatPartySchema = z.enum(["buyer", "seller"]);
export type ChatParty = z.infer<typeof chatPartySchema>;

/** Mulai/buka percakapan dari halaman produk (productId) ATAU detail pesanan (orderId). */
export const startConversationSchema = z
  .object({
    productId: z.string().trim().min(1).optional(),
    orderId: z.string().trim().min(1).optional(),
  })
  .refine((v) => Boolean(v.productId) !== Boolean(v.orderId), {
    message: "Isi salah satu: productId atau orderId",
  });
export type StartConversationInput = z.infer<typeof startConversationSchema>;

export const sendChatMessageSchema = z.object({
  body: z.string().trim().min(1, "Pesan tidak boleh kosong").max(CHAT_MESSAGE_MAX, `Maksimal ${CHAT_MESSAGE_MAX} karakter`),
  /** Dibuat client per pesan; kirim ulang dengan id sama aman (tidak membuat pesan ganda). */
  clientId: z
    .string()
    .trim()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "clientId tidak valid"),
});
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;

export const listChatMessagesQuerySchema = z
  .object({
    /** id pesan: ambil pesan yang LEBIH LAMA dari ini (scroll ke atas). */
    before: z.string().trim().min(1).optional(),
    /** id pesan: ambil pesan yang LEBIH BARU dari ini (polling / sinkron ulang). */
    after: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(CHAT_PAGE_SIZE),
  })
  .refine((v) => !(v.before && v.after), { message: "Pakai salah satu: before atau after" });
export type ListChatMessagesQuery = z.infer<typeof listChatMessagesQuerySchema>;

export const listConversationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

// ---------- View ----------

export const chatMessageSchema = z.object({
  id: z.string(),
  clientId: z.string().nullable(),
  senderRole: chatPartySchema,
  body: z.string(),
  createdAt: z.iso.datetime(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatMessagesResponseSchema = z.object({
  /** Urut lama → baru. */
  items: z.array(chatMessageSchema),
  /** before: masih ada pesan lebih lama · after: masih ada pesan lebih baru dari halaman ini. */
  hasMore: z.boolean(),
});
export type ChatMessagesResponse = z.infer<typeof chatMessagesResponseSchema>;

export const chatProductContextSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** null = produk sudah dihapus/tidak aktif → tampil tanpa link. */
  slug: z.string().nullable(),
  imageUrl: z.string().nullable(),
});
export type ChatProductContext = z.infer<typeof chatProductContextSchema>;

export const conversationMetaSchema = z.object({
  id: z.string(),
  viewerRole: chatPartySchema,
  counterpartName: z.string(),
  product: chatProductContextSchema.nullable(),
  canSend: z.boolean(),
  sendBlockedReason: z.string().nullable(),
  /** Pesan viewer dengan createdAt ≤ nilai ini sudah dibaca lawan bicara. */
  readByCounterpartAt: z.iso.datetime().nullable(),
  unreadCount: z.number(),
  createdAt: z.iso.datetime(),
});
export type ConversationMeta = z.infer<typeof conversationMetaSchema>;

export const conversationSummarySchema = z.object({
  id: z.string(),
  viewerRole: chatPartySchema,
  counterpartName: z.string(),
  productName: z.string().nullable(),
  lastMessage: z.object({ body: z.string(), mine: z.boolean(), createdAt: z.iso.datetime() }),
  unreadCount: z.number(),
  lastMessageAt: z.iso.datetime(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const conversationListResponseSchema = z.object({
  items: z.array(conversationSummarySchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  unreadTotal: z.number(),
});
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;

export const chatUnreadSchema = z.object({ unreadCount: z.number() });
export type ChatUnread = z.infer<typeof chatUnreadSchema>;

/** Event `chat.read`: `role` = pihak yang baru membaca, `at` = waktu baca (jam DB). */
export const chatReadEventSchema = z.object({ role: chatPartySchema, at: z.iso.datetime() });
export type ChatReadEvent = z.infer<typeof chatReadEventSchema>;
