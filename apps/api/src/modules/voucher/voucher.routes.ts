/**
 * T-12: voucher untuk halaman checkout.
 *   GET  /api/vouchers/available   voucher yang bisa dipilih untuk keranjang saat ini
 *   POST /api/vouchers/validate    cek 1 kode → preview diskon (checkout tetap validasi ulang di server)
 */

import type { FastifyPluginAsync } from "fastify";
import { validateVoucherSchema } from "@ecommerce/shared";
import { requireAuth } from "../../plugins/auth";
import { listAvailableVouchers, previewVoucher } from "./voucher.service";

export const voucherRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/vouchers/available", { preHandler: requireAuth }, async (req) => listAvailableVouchers(req.user!.id));

  app.post("/api/vouchers/validate", { preHandler: requireAuth }, async (req) =>
    previewVoucher(req.user!.id, validateVoucherSchema.parse(req.body)),
  );
};
