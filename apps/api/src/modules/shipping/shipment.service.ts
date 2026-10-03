/**
 * T-08: booking pengiriman (Biteship createOrder) oleh seller.
 * Dipanggil dari POST /api/seller/orders/:id/shipment — UI manajemen order seller menyusul di T-09.
 */

import { and, eq } from "drizzle-orm";
import { db, schema } from "../../db";
import { httpError } from "../../lib/http-error";
import { type ShipmentAddress, shipmentGateway } from "../../lib/shipping";
import { FAILED_BOOKING_STATUSES, notifySafely } from "./shipping.service";

type SellerRow = typeof schema.sellers.$inferSelect;
type AddressParts = { street: string; district: string; city: string; province: string; postalCode: string };

const fullAddress = (a: AddressParts) => `${a.street}, ${a.district}, ${a.city}, ${a.province} ${a.postalCode}`;

/** Alamat pickup seller → ShipmentAddress; 422 kalau data wajib belum lengkap. */
function toOrigin(seller: SellerRow): ShipmentAddress {
  const { pickupContactName, pickupPhone, pickupStreet, pickupDistrict, pickupCity, pickupProvince, pickupPostalCode } = seller;
  if (!pickupContactName || !pickupPhone || !pickupStreet || !pickupDistrict || !pickupCity || !pickupProvince || !pickupPostalCode) {
    throw httpError(422, "PICKUP_ADDRESS_INCOMPLETE", "Lengkapi alamat pickup toko sebelum membuat pengiriman.");
  }
  return {
    contactName: pickupContactName,
    phone: pickupPhone,
    address: fullAddress({
      street: pickupStreet,
      district: pickupDistrict,
      city: pickupCity,
      province: pickupProvince,
      postalCode: pickupPostalCode,
    }),
    postalCode: pickupPostalCode,
    areaId: seller.pickupBiteshipAreaId,
  };
}

/**
 * Daftarkan pengiriman order ke kurir, lalu majukan order `paid` → `processing` dan simpan resi.
 *
 * Edge cases:
 * - Klik ganda / retry → row lock + guard `biteshipOrderId`: pengiriman aktif dikembalikan apa adanya
 *   (`created: false`), tidak ada booking kedua (juga dijaga `reference_id` unik di sisi Biteship).
 * - Order milik seller lain / tidak ada → 404 (tidak membocorkan keberadaan order).
 * - Order belum dibayar / sudah selesai/batal → 409.
 * - Booking sebelumnya gagal di kurir (cancelled/rejected/courier_not_found) → boleh booking ulang
 *   dengan reference_id baru.
 * - Biteship menolak/tak terjangkau → 502 dan seluruh transaksi di-rollback (order tidak berubah).
 */
export async function bookShipment(params: { orderId: string; sellerId: string }) {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.id, params.orderId), eq(schema.orders.sellerId, params.sellerId)))
      .for("update");
    if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Pesanan tidak ditemukan.");

    if (order.status !== "paid" && order.status !== "processing") {
      throw httpError(409, "ORDER_NOT_SHIPPABLE", "Pesanan belum dibayar atau sudah tidak bisa dikirim.");
    }

    const hasActiveShipment = Boolean(order.biteshipOrderId) && !FAILED_BOOKING_STATUSES.has(order.shippingStatus ?? "");
    if (hasActiveShipment) return { order, created: false };

    if (!order.courierCode || !order.courierService) {
      throw httpError(422, "ORDER_NO_COURIER", "Pesanan ini tidak memiliki pilihan kurir.");
    }

    const [seller] = await tx.select().from(schema.sellers).where(eq(schema.sellers.id, order.sellerId));
    if (!seller) throw httpError(404, "SELLER_NOT_FOUND", "Toko tidak ditemukan.");

    const lines = await tx
      .select({
        name: schema.orderItems.productName,
        variantName: schema.orderItems.variantName,
        unitPrice: schema.orderItems.unitPrice,
        quantity: schema.orderItems.quantity,
        variantWeight: schema.productVariants.weightGram,
        productWeight: schema.products.weightGram,
        lengthCm: schema.products.lengthCm,
        widthCm: schema.products.widthCm,
        heightCm: schema.products.heightCm,
      })
      .from(schema.orderItems)
      .innerJoin(schema.productVariants, eq(schema.orderItems.variantId, schema.productVariants.id))
      .innerJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
      .where(eq(schema.orderItems.orderId, order.id));

    const dest = order.shippingAddress;
    const shipment = await shipmentGateway.createShipment({
      // Booking ulang setelah gagal butuh reference_id baru (Biteship menolak reference_id yang pernah dipakai).
      referenceId: order.biteshipOrderId ? `${order.orderNo}-${Date.now().toString(36)}` : order.orderNo,
      origin: toOrigin(seller),
      destination: {
        contactName: dest.recipientName,
        phone: dest.phone,
        address: fullAddress(dest),
        postalCode: dest.postalCode,
        areaId: dest.biteshipAreaId ?? null,
      },
      courierCode: order.courierCode,
      courierService: order.courierService,
      items: lines.map((l) => ({
        name: `${l.name} (${l.variantName})`,
        value: l.unitPrice,
        quantity: l.quantity,
        weightGram: l.variantWeight ?? l.productWeight,
        lengthCm: l.lengthCm ?? undefined,
        widthCm: l.widthCm ?? undefined,
        heightCm: l.heightCm ?? undefined,
      })),
      note: order.note,
    });

    const now = new Date();
    const [updated] = await tx
      .update(schema.orders)
      .set({
        status: "processing",
        biteshipOrderId: shipment.shipmentId,
        biteshipTrackingId: shipment.trackingId,
        trackingNumber: shipment.waybillId ?? order.trackingNumber,
        shippingStatus: shipment.status,
        trackingLink: shipment.link,
        trackingSyncedAt: null,
        updatedAt: now,
      })
      .where(eq(schema.orders.id, order.id))
      .returning();

    await tx
      .insert(schema.orderTrackingEvents)
      .values({
        orderId: order.id,
        status: shipment.status,
        note: "Pesanan didaftarkan ke kurir",
        occurredAt: now,
        source: "system",
      })
      .onConflictDoNothing();

    if (order.userId) {
      await notifySafely(tx, {
        userId: order.userId,
        type: "order_status",
        title: "Pesanan diproses penjual",
        body: `Pesanan ${order.orderNo} sedang disiapkan.${shipment.waybillId ? ` No. resi: ${shipment.waybillId}.` : ""}`,
        payload: { orderId: order.id, shippingStatus: shipment.status },
      });
    }

    return { order: updated!, created: true };
  });
}
