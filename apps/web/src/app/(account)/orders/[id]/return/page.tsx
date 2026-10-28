import type { Metadata } from "next";
import { ReturnRequestForm } from "@/components/orders/return-request-form";

export const metadata: Metadata = { title: "Ajukan Retur" };
export const dynamic = "force-dynamic";

export default async function ReturnRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReturnRequestForm orderId={id} />;
}
