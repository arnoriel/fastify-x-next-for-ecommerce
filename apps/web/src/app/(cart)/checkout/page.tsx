import type { Metadata } from "next";
import { CheckoutView } from "@/components/checkout/checkout-view";

export const metadata: Metadata = { title: "Checkout" };
export const dynamic = "force-dynamic";

export default function CheckoutPage() {
  return <CheckoutView />;
}
