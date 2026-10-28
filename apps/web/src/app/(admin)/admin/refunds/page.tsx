import type { Metadata } from "next";
import { ReturnsView } from "@/components/admin/returns-view";

export const metadata: Metadata = { title: "Retur & Refund" };
export const dynamic = "force-dynamic";

export default function AdminRefundsPage() {
  return <ReturnsView />;
}
