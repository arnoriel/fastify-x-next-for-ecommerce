/**
 * T-09: dashboard & manajemen order seller (read-only). Aksi mengubah order (buat resi, tandai dikirim)
 * ada di shipping.routes.ts bersama endpoint pengiriman T-08.
 *
 *   GET /api/seller/dashboard/summary?range=7d|30d|90d
 *   GET /api/seller/orders?tab=new|processing|shipped|completed&q=&page=&pageSize=
 */

import type { FastifyPluginAsync } from "fastify";
import { dashboardQuerySchema, sellerOrdersQuerySchema } from "@ecommerce/shared";
import { requireRole } from "../../plugins/auth";
import { requireApprovedSeller } from "../seller/seller.guard";
import { getDashboardSummary, listSellerOrders } from "./seller-dashboard.service";

export const sellerDashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/seller/dashboard/summary", { preHandler: requireRole(["seller"]) }, async (req) => {
    const seller = await requireApprovedSeller(req.user!.id);
    const { range } = dashboardQuerySchema.parse(req.query);
    return getDashboardSummary(seller.id, range);
  });

  app.get("/api/seller/orders", { preHandler: requireRole(["seller"]) }, async (req) => {
    const seller = await requireApprovedSeller(req.user!.id);
    return listSellerOrders(seller.id, sellerOrdersQuerySchema.parse(req.query));
  });
};
