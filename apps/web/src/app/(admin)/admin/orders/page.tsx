import type { Metadata } from "next";
import { OrdersView } from "@/components/admin/orders-view";

export const metadata: Metadata = { title: "Monitoring Transaksi" };
export const dynamic = "force-dynamic";

export default function AdminOrdersPage() {
  return <OrdersView />;
}
