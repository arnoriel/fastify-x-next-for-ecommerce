import type { Metadata } from "next";
import { SellersView } from "@/components/admin/sellers-view";

export const metadata: Metadata = { title: "Approval Seller" };
export const dynamic = "force-dynamic";

export default function AdminSellersPage() {
  return <SellersView />;
}
