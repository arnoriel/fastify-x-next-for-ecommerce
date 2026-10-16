/**
 * T-10: panel admin (read-only; aksi mengubah data ada di modul masing-masing:
 * approve/reject seller → seller-onboarding.routes, CRUD kategori → category.routes,
 * sengketa → dispute.routes).
 *
 *   GET /api/admin/counts       badge navigasi (seller pending, tiket aktif, perlu dibalas)
 *   GET /api/admin/analytics?range=7d|30d|90d
 *   GET /api/admin/sellers?status=&q=&page=&pageSize=
 *   GET /api/admin/categories   semua kategori + jumlah produk
 *   GET /api/admin/orders?status=&q=&page=&pageSize=
 */

import type { FastifyPluginAsync } from "fastify";
import {
  adminAnalyticsQuerySchema,
  adminOrdersQuerySchema,
  adminSellersQuerySchema,
} from "@ecommerce/shared";
import { requireRole } from "../../plugins/auth";
import {
  getAdminAnalytics,
  getAdminCounts,
  listAdminCategories,
  listAdminOrders,
  listAdminSellers,
} from "./admin.service";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  const admin = { preHandler: requireRole(["admin"]) };

  app.get("/api/admin/counts", admin, async () => getAdminCounts());
  app.get("/api/admin/analytics", admin, async (req) => getAdminAnalytics(adminAnalyticsQuerySchema.parse(req.query).range));
  app.get("/api/admin/sellers", admin, async (req) => listAdminSellers(adminSellersQuerySchema.parse(req.query)));
  app.get("/api/admin/categories", admin, async () => listAdminCategories());
  app.get("/api/admin/orders", admin, async (req) => listAdminOrders(adminOrdersQuerySchema.parse(req.query)));
};
