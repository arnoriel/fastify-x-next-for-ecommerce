import type { Metadata } from "next";
import { DisputeListView } from "@/components/dispute/dispute-list-view";

export const metadata: Metadata = { title: "Sengketa" };
export const dynamic = "force-dynamic";

export default function AdminDisputesPage() {
  return <DisputeListView mode="admin" />;
}
