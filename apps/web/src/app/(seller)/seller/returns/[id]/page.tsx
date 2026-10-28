import type { Metadata } from "next";
import { ReturnReviewView } from "@/components/returns/return-review-view";

export const metadata: Metadata = { title: "Tinjau Retur" };
export const dynamic = "force-dynamic";

export default async function SellerReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReturnReviewView mode="seller" returnId={id} />;
}
