import type { Metadata } from "next";
import { CartView } from "@/components/cart/cart-view";

export const metadata: Metadata = { title: "Keranjang" };
export const dynamic = "force-dynamic";

export default function CartPage() {
  return <CartView />;
}
