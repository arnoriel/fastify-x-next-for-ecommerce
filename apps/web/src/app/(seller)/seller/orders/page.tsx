import type { Metadata } from "next";
import { sellerOrderTabSchema } from "@ecommerce/shared";
import { SellerOrdersView } from "@/components/seller-dashboard/seller-orders-view";

export const metadata: Metadata = { title: "Pesanan Toko" };
export const dynamic = "force-dynamic";

export default async function SellerOrdersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  // Tab tidak valid di URL → jatuh ke "new" (bukan error).
  const initialTab = sellerOrderTabSchema.catch("new").parse(tab);
  return <SellerOrdersView initialTab={initialTab} />;
}
