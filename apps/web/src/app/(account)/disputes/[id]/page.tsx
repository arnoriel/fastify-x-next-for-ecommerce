import type { Metadata } from "next";
import { DisputeThreadView } from "@/components/dispute/dispute-thread-view";

export const metadata: Metadata = { title: "Detail Laporan" };
export const dynamic = "force-dynamic";

export default async function DisputeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DisputeThreadView id={id} mode="participant" />;
}
