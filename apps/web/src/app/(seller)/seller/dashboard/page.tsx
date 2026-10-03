import type { Metadata } from "next";
import { DashboardView } from "@/components/seller-dashboard/dashboard-view";

export const metadata: Metadata = { title: "Dashboard Toko" };
export const dynamic = "force-dynamic";

export default function SellerDashboardPage() {
  return <DashboardView />;
}
