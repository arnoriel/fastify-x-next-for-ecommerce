/**
 * T-08: endpoint pengiriman Biteship.
 *
 *   POST /webhook/biteship                — callback Biteship (tanpa session; keamanan via shared secret)
 *   POST /api/seller/orders/:id/shipment  — seller mendaftarkan pengiriman ke kurir (resi dibuat)
 *
 * Tracking untuk buyer TIDAK punya endpoint sendiri: dibawa di GET /api/orders/:id (T-06C) supaya
 * tampil di halaman detail order, bukan halaman terpisah.
 */

import type { FastifyPluginAsync } from "fastify";
import { env } from "../../env";
import { biteshipWebhookSchema, verifyWebhookSecret } from "../../lib/biteship";
import { requireRole } from "../../plugins/auth";
import { requireApprovedSeller } from "../seller/seller.guard";
import { bookShipment } from "./shipment.service";
import { applyShippingWebhook, applyWaybillUpdate } from "./shipping.service";

export const shippingRoutes: FastifyPluginAsync = async (app) => {
  // ---------- POST /webhook/biteship ----------
  // Respons:
  //  - 503 secret belum dikonfigurasi (fail closed — webhook tanpa auth tidak boleh diterima)
  //  - 401 secret tidak ada/salah
  //  - 400 body bukan JSON object
  //  - 200 untuk semua kasus lain (event tak dikenal, order tak dikenal, duplikat/telat) supaya Biteship
  //    tidak retry tanpa henti. Error DB → 500 → Biteship retry (diinginkan).
  app.post("/webhook/biteship", async (req, reply) => {
    if (!env.BITESHIP_WEBHOOK_SECRET) {
      app.log.error("[webhook/biteship] BITESHIP_WEBHOOK_SECRET belum diset — webhook ditolak");
      reply.code(503);
      return { error: "WEBHOOK_NOT_CONFIGURED" };
    }
    if (!verifyWebhookSecret(req.headers)) {
      app.log.warn("[webhook/biteship] secret invalid — ditolak");
      reply.code(401);
      return { error: "INVALID_SECRET" };
    }

    const parsed = biteshipWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "INVALID_PAYLOAD" };
    }
    const payload = parsed.data;

    switch (payload.event) {
      case "order.status": {
        if (!payload.order_id || !payload.status) break;
        const outcome = await applyShippingWebhook({
          biteshipOrderId: payload.order_id,
          status: payload.status,
          waybillId: payload.courier_waybill_id,
          trackingId: payload.courier_tracking_id,
          link: payload.courier_link,
        });
        app.log.info({ biteshipOrderId: payload.order_id, status: payload.status, outcome }, "[webhook/biteship] order.status diproses");
        break;
      }
      case "order.waybill_id": {
        if (!payload.order_id || !payload.courier_waybill_id) break;
        const updated = await applyWaybillUpdate({
          biteshipOrderId: payload.order_id,
          waybillId: payload.courier_waybill_id,
          trackingId: payload.courier_tracking_id,
        });
        app.log.info({ biteshipOrderId: payload.order_id, updated }, "[webhook/biteship] order.waybill_id diproses");
        break;
      }
      case "order.price":
        // Selisih ongkir aktual vs rate ditanggung platform (buyer sudah membayar rate saat checkout).
        app.log.info({ biteshipOrderId: payload.order_id }, "[webhook/biteship] order.price diterima (tidak mengubah order)");
        break;
      default:
        app.log.info({ event: payload.event }, "[webhook/biteship] event diabaikan");
    }
    return { ok: true };
  });

  // ---------- POST /api/seller/orders/:id/shipment ----------
  // Idempotent: order yang sudah punya pengiriman aktif mengembalikan data yang ada (200), bukan 2nd booking.
  app.post("/api/seller/orders/:id/shipment", { preHandler: requireRole(["seller"]) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const seller = await requireApprovedSeller(req.user!.id);

    const { order, created } = await bookShipment({ orderId: id, sellerId: seller.id });

    reply.code(created ? 201 : 200);
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      orderStatus: order.status,
      shippingStatus: order.shippingStatus,
      trackingNumber: order.trackingNumber,
      trackingLink: order.trackingLink,
      created,
    };
  });
};
