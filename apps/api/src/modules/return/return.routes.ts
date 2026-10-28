/**
 * T-15: retur/refund & escrow.
 *
 * Buyer:
 *   POST /api/orders/:id/return/upload-url   presign foto bukti
 *   POST /api/orders/:id/returns             ajukan retur
 *   GET  /api/returns/:id                    detail pengajuan
 *   POST /api/returns/:id/cancel             batalkan selama masih requested
 * Seller/admin:
 *   POST /api/seller/returns/:id/approve|reject
 *   POST /api/admin/returns/:id/approve|reject
 * Admin:
 *   GET  /api/admin/returns                  antrian retur & refund manual
 *   GET  /api/admin/returns/:id              detail
 *   POST /api/admin/returns/:id/refund       tandai refund manual selesai
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  adminReturnsQuerySchema,
  completeRefundSchema,
  createReturnSchema,
  presignUploadRequestSchema,
  reviewReturnSchema,
} from "@ecommerce/shared";
import { db } from "../../db";
import { httpError } from "../../lib/http-error";
import { presignReturnEvidenceUpload } from "../../lib/storage";
import { requireAuth, requireRole } from "../../plugins/auth";
import {
  approveReturn,
  cancelReturn,
  createReturn,
  finalizeRefund,
  getReturnDetail,
  listAdminReturns,
  rejectReturn,
} from "./return.service";

const idParams = z.object({ id: z.string().min(1) });

async function requireOrderOwner(orderId: string, userId: string) {
  const order = await db.query.orders.findFirst({
    where: (o, { and: andd, eq: eqq }) => andd(eqq(o.id, orderId), eqq(o.userId, userId)),
    columns: { id: true },
  });
  if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Pesanan tidak ditemukan.");
  return order;
}

export const returnRoutes: FastifyPluginAsync = async (app) => {
  // ---------- Buyer ----------

  app.post("/api/orders/:id/return/upload-url", { preHandler: requireAuth }, async (req) => {
    const { id } = idParams.parse(req.params);
    await requireOrderOwner(id, req.user!.id);
    return presignReturnEvidenceUpload(req.user!.id, id, presignUploadRequestSchema.parse(req.body));
  });

  app.post("/api/orders/:id/returns", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const detail = await createReturn(req.user!.id, id, createReturnSchema.parse(req.body));
    reply.code(201);
    return detail;
  });

  app.get("/api/returns/:id", { preHandler: requireAuth }, async (req) => {
    const { id } = idParams.parse(req.params);
    return getReturnDetail({ id: req.user!.id, isAdmin: false }, id);
  });

  app.post("/api/returns/:id/cancel", { preHandler: requireAuth }, async (req) => {
    const { id } = idParams.parse(req.params);
    return cancelReturn(req.user!.id, id);
  });

  // ---------- Seller ----------

  for (const decision of ["approve", "reject"] as const) {
    app.post(`/api/seller/returns/:id/${decision}`, { preHandler: requireRole(["seller"]) }, async (req) => {
      const { id } = idParams.parse(req.params);
      const { note } = reviewReturnSchema.parse(req.body);
      const actor = { id: req.user!.id, isAdmin: false };
      return decision === "approve" ? approveReturn(actor, id, note) : rejectReturn(actor, id, note);
    });
  }

  app.get("/api/seller/returns/:id", { preHandler: requireRole(["seller"]) }, async (req) => {
    const { id } = idParams.parse(req.params);
    return getReturnDetail({ id: req.user!.id, isAdmin: false }, id);
  });

  // ---------- Admin ----------

  app.get("/api/admin/returns", { preHandler: requireRole(["admin"]) }, async (req) =>
    listAdminReturns(adminReturnsQuerySchema.parse(req.query)),
  );

  app.get("/api/admin/returns/:id", { preHandler: requireRole(["admin"]) }, async (req) => {
    const { id } = idParams.parse(req.params);
    return getReturnDetail({ id: req.user!.id, isAdmin: true }, id);
  });

  for (const decision of ["approve", "reject"] as const) {
    app.post(`/api/admin/returns/:id/${decision}`, { preHandler: requireRole(["admin"]) }, async (req) => {
      const { id } = idParams.parse(req.params);
      const { note } = reviewReturnSchema.parse(req.body);
      const actor = { id: req.user!.id, isAdmin: true };
      return decision === "approve" ? approveReturn(actor, id, note) : rejectReturn(actor, id, note);
    });
  }

  app.post("/api/admin/returns/:id/refund", { preHandler: requireRole(["admin"]) }, async (req) => {
    const { id } = idParams.parse(req.params);
    return finalizeRefund(req.user!.id, id, completeRefundSchema.parse(req.body));
  });
};
