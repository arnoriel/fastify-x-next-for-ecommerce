"use client";

import {
  chatMessageSchema,
  chatMessagesResponseSchema,
  chatUnreadSchema,
  conversationListResponseSchema,
  conversationMetaSchema,
  type ChatMessage,
  type ChatMessagesResponse,
  type ChatUnread,
  type ConversationListResponse,
  type ConversationMeta,
  type ListConversationsQuery,
  type SendChatMessageInput,
  type StartConversationInput,
} from "@ecommerce/shared";
import { apiRequest } from "@/lib/http";

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const conversationPath = (id: string) => `/api/chat/conversations/${encodeURIComponent(id)}`;

/** Mulai/buka percakapan dari halaman produk atau detail pesanan (get-or-create di server). */
export async function startConversation(input: StartConversationInput): Promise<ConversationMeta> {
  return conversationMetaSchema.parse(await apiRequest("/api/chat/conversations", json("POST", input)));
}

export async function listConversations(query: Partial<ListConversationsQuery>): Promise<ConversationListResponse> {
  return conversationListResponseSchema.parse(await apiRequest("/api/chat/conversations", { query }));
}

export async function getConversation(id: string): Promise<ConversationMeta> {
  return conversationMetaSchema.parse(await apiRequest(conversationPath(id)));
}

/** `before` = pesan lebih lama dari id ini · `after` = pesan lebih baru dari id ini · kosong = terbaru. */
export async function listMessages(
  id: string,
  query: { before?: string; after?: string; limit?: number } = {},
): Promise<ChatMessagesResponse> {
  return chatMessagesResponseSchema.parse(await apiRequest(`${conversationPath(id)}/messages`, { query }));
}

export async function sendChatMessage(id: string, input: SendChatMessageInput): Promise<ChatMessage> {
  return chatMessageSchema.parse(await apiRequest(`${conversationPath(id)}/messages`, json("POST", input)));
}

export async function markConversationRead(id: string): Promise<void> {
  await apiRequest(`${conversationPath(id)}/read`, { method: "POST" });
}

export async function getChatUnread(): Promise<ChatUnread> {
  return chatUnreadSchema.parse(await apiRequest("/api/chat/unread-count"));
}
