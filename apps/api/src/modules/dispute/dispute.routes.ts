/**
 * T-10: sengketa order.
 *
 * Peserta (buyer/seller dari order):
 *   GET  /api/disputes                    daftar tiket saya (view=active|closed|all)
 *   GET  /api/disputes/eligibility?orderId=   data awal form + apakah boleh mengajukan
 *   POST /api/disputes                    ajukan tiket
 *   GET  /api/disputes/:id                detail + percakapan
 *   POST /api/disputes/:id/messages       balas
 *   POST /api/disputes/:id/withdraw       batalkan (pelapor)
 *
 * Admin:
 *   GET  /api/admin/disputes              antrian (view=active|needs_reply|closed|all, q)
 *   GET  /api/admin/disputes/:id          detail
 *   POST /api/admin/disputes/:id/messages balas
 *   POST /api/admin/disputes/:id/resolve  putuskan
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  adminListDisputesQuerySchema,
  createDisputeSchema,
  disputeMessageInputSchema,
  listDisputesQuerySchema,
  resolveDisputeSchema,
} from "@ecommerce/shared";
import { requireAuth, requireRole } from "../../plugins/auth";
import {
  addDisputeMessage,
  createDispute,
  getDisputeDetail,
  getDisputeEligibility,
  listDisputesForAdmin,
  listMyDisputes,
  resolveDispute,
  withdrawDispute,
} from "./dispute.service";

const idParams = z.object({ id: z.string().min(1) });
const eligibilityQuery = z.object({ orderId: z.string().min(1) });

export const disputeRoutes: FastifyPluginAsync = async (app) => {
  // ---------- Peserta ----------

  app.get("/api/disputes", { preHandler: requireAuth }, async (req) =>
    listMyDisputes(req.user!.id, listDisputesQuerySchema.parse(req.query)),
  );

  app.get("/api/disputes/eligibility", { preHandler: requireAuth }, async (req) => {
    const { orderId } = eligibilityQuery.parse(req.query);
    return getDisputeEligibility(req.user!.id, orderId);
  });

  app.post("/api/disputes", { preHandler: requireAuth }, async (req, reply) => {
    const input = createDisputeSchema.parse(req.body);
    const detail = await createDispute(req.user!, input);
    reply.code(201);
    return detail;
  });

  app.get("/api/disputes/:id", { preHandler: requireAuth }, async (req) => {
    const { id } = idParams.parse(req.params);
    // Admin membaca lewat /api/admin/disputes agar jalur peserta tidak pernah memberi akses admin.
    return getDisputeDetail(id, { id: req.user!.id, isAdmin: false });
  });

  app.post("/api/disputes/:id/messages", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const message = await addDisputeMessage(id, { id: req.user!.id, isAdmin: false }, disputeMessageInputSchema.parse(req.body));
    reply.code(201);
    return message;
  });

  app.post("/api/disputes/:id/withdraw", { preHandler: requireAuth }, async (req) => {
    const { id } = idParams.parse(req.params);
    return withdrawDispute(id, req.user!);
  });

  // ---------- Admin ----------

  app.get("/api/admin/disputes", { preHandler: requireRole(["admin"]) }, async (req) =>
    listDisputesForAdmin(adminListDisputesQuerySchema.parse(req.query)),
  );

  app.get("/api/admin/disputes/:id", { preHandler: requireRole(["admin"]) }, async (req) => {
    const { id } = idParams.parse(req.params);
    return getDisputeDetail(id, { id: req.user!.id, isAdmin: true });
  });

  app.post("/api/admin/disputes/:id/messages", { preHandler: requireRole(["admin"]) }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const message = await addDisputeMessage(id, { id: req.user!.id, isAdmin: true }, disputeMessageInputSchema.parse(req.body));
    reply.code(201);
    return message;
  });

  app.post("/api/admin/disputes/:id/resolve", { preHandler: requireRole(["admin"]) }, async (req) => {
    const { id } = idParams.parse(req.params);
    return resolveDispute(id, req.user!, resolveDisputeSchema.parse(req.body));
  });
};
