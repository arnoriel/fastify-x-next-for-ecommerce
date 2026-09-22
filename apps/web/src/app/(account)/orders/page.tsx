import type { Metadata } from "next";
import { OrderHistoryView } from "@/components/orders/order-history-view";

export const metadata: Metadata = { title: "Riwayat Pesanan" };
export const dynamic = "force-dynamic";

export default function OrdersPage() {
  return <OrderHistoryView />;
}
