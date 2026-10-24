import type { Metadata } from "next";
import { WishlistView } from "@/components/wishlist/wishlist-view";
import { requireFeature } from "@/lib/features";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Wishlist" };
export const dynamic = "force-dynamic";

export default async function WishlistPage() {
  requireFeature("wishlist");
  await requireUser({ next: "/wishlist" });
  return <WishlistView />;
}
