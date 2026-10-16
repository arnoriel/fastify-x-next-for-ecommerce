import { type NotificationView, sellerOrderTabSchema } from "@ecommerce/shared";

const asString = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null);

/**
 * Tujuan klik notifikasi, ditentukan dari type + payload (payload dibuat server, bukan input user).
 * `null` = belum ada halaman tujuan → klik hanya menandai terbaca.
 */
export function resolveNotificationHref(n: Pick<NotificationView, "type" | "payload">): string | null {
  switch (n.type) {
    case "seller_status":
      return "/seller/onboarding/status";

    case "order_status": {
      // Notifikasi untuk seller (order baru / pengiriman gagal) → dashboard order toko, bukan /orders buyer.
      if (n.payload.audience === "seller") {
        const tab = sellerOrderTabSchema.safeParse(n.payload.tab);
        return `/seller/orders?tab=${tab.success ? tab.data : n.payload.shippingStatus ? "processing" : "new"}`;
      }
      const orderId = asString(n.payload.orderId);
      if (orderId) return `/orders/${encodeURIComponent(orderId)}`;
      // Status pembayaran checkout (belum ada orderId) → halaman status pembayaran.
      const checkoutId = asString(n.payload.checkoutId);
      return checkoutId ? `/checkout/${encodeURIComponent(checkoutId)}` : "/orders";
    }

    case "dispute_update": {
      const disputeId = asString(n.payload.disputeId);
      if (!disputeId) return "/disputes";
      // Notifikasi untuk admin membuka antrian admin; peserta membuka tiketnya sendiri.
      return n.payload.audience === "admin"
        ? `/admin/disputes/${encodeURIComponent(disputeId)}`
        : `/disputes/${encodeURIComponent(disputeId)}`;
    }

    // Halaman chat dibuat di T-11 (payload: { conversationId }); sampai itu ada tidak ada tujuan.
    case "chat_message":
      return null;
  }
}