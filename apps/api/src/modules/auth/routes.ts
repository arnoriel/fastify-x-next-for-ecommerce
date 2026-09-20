import type { FastifyPluginAsync } from "fastify";
import type { MeResponse } from "@ecommerce/shared";
import { requireAuth, requireRole } from "../../plugins/auth";

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Profil user saat ini — dipakai FE untuk hydrate state login.
  app.get("/api/me", { preHandler: requireAuth }, async (req): Promise<MeResponse> => ({
    user: req.user!,
  }));

  // Endpoint contoh per role: bukti guard bekerja & dipakai di test flow PRD.
  // Akan dicabut/diganti oleh modul seller/admin yang sebenarnya.
  app.get("/api/seller/ping", { preHandler: requireRole(["seller"]) }, async (req) => ({
    ok: true,
    role: req.user!.role,
  }));

  app.get("/api/admin/ping", { preHandler: requireRole(["admin"]) }, async (req) => ({
    ok: true,
    role: req.user!.role,
  }));
};
