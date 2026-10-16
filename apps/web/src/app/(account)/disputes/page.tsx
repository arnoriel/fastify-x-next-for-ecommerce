import type { Metadata } from "next";
import { DisputeListView } from "@/components/dispute/dispute-list-view";

export const metadata: Metadata = { title: "Laporan & Sengketa" };
export const dynamic = "force-dynamic";

export default function DisputesPage() {
  return <DisputeListView mode="participant" />;
}
