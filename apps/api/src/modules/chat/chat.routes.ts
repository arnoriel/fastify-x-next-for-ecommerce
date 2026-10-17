/**
 * T-11: chat buyer ↔ seller.
 *
 *   GET  /api/chat/conversations                 daftar percakapan saya (buyer & seller)
 *   POST /api/chat/conversations                 mulai/buka dari { productId } atau { orderId }
 *   GET  /api/chat/unread-count                  total pesan belum dibaca (badge menu Chat)
 *   GET  /api/chat/conversations/:id             meta percakapan
 *   GET  /api/chat/conversations/:id/messages    riwayat (?before= / ?after= / ?limit=)
 *   POST /api/chat/conversations/:id/messages    kirim pesan (idempoten via clientId)
 *   POST /api/chat/conversations/:id/read        tandai dibaca
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  listChatMessagesQuerySchema,
  listConversationsQuerySchema,
  sendChatMessageSchema,
  startConversationSchema,
} from "@ecommerce/shared";
import { requireAuth } from "../../plugins/auth";
import {
  getConversationMeta,
  getUnreadTotal,
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
  startConversation,
} from "./chat.service";

const idParams = z.object({ id: z.string().min(1) });

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/chat/conversations", { preHandler: requireAuth }, async (req) =>
    listConversations(req.user!.id, listConversationsQuerySchema.parse(req.query)),
  );

  app.post("/api/chat/conversations", { preHandler: requireAuth }, async (req) =>
    startConversation(req.user!, startConversationSchema.parse(req.body)),
  );

  app.get("/api/chat/unread-count", { preHandler: requireAuth }, async (req) => getUnreadTotal(req.user!.id));

  app.get("/api/chat/conversations/:id", { preHandler: requireAuth }, async (req) => {
    const { id } = idParams.parse(req.params);
    return getConversationMeta(id, req.user!.id);
  });

  app.get("/api/chat/conversations/:id/messages", { preHandler: requireAuth }, async (req) => {
    const { id } = idParams.parse(req.params);
    return listMessages(id, req.user!.id, listChatMessagesQuerySchema.parse(req.query));
  });

  app.post("/api/chat/conversations/:id/messages", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const message = await sendMessage(id, req.user!, sendChatMessageSchema.parse(req.body));
    reply.code(201);
    return message;
  });

  app.post("/api/chat/conversations/:id/read", { preHandler: requireAuth }, async (req) => {
    const { id } = idParams.parse(req.params);
    return markConversationRead(id, req.user!);
  });
};
