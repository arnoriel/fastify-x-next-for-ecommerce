import type { Metadata } from "next";
import { AnalyticsView } from "@/components/admin/analytics-view";

export const metadata: Metadata = { title: "Ringkasan Platform" };
export const dynamic = "force-dynamic";

export default function AdminHomePage() {
  return <AnalyticsView />;
}
