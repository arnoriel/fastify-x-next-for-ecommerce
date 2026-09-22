import "server-only";

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { checkoutViewSchema } from "@ecommerce/shared";
import { env } from "@/env";
import { PaymentStatusView } from "@/components/checkout/payment-status-view";

export const metadata: Metadata = { title: "Status Pembayaran" };
export const dynamic = "force-dynamic";

async function getCheckout(id: string) {
  const cookieHeader = (await cookies()).toString();
  try {
    const res = await fetch(new URL(`/api/checkout/${id}`, env.NEXT_PUBLIC_API_URL), {
      headers: { cookie: cookieHeader },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return checkoutViewSchema.parse(await res.json());
  } catch {
    return null;
  }
}

// T-06B: halaman ini adalah "halaman penutup" buyer setelah submit checkout — menampilkan
// status pembayaran real-time (pending/paid/expired/failed) via polling client-side, karena
// webhook Duitku (T-07) mengubah status di backend tanpa buyer perlu refresh manual.
export default async function CheckoutStatusPage({ params }: { params: Promise<{ checkoutId: string }> }) {
  const { checkoutId } = await params;
  const checkout = await getCheckout(checkoutId);
  if (!checkout) notFound();

  return <PaymentStatusView checkout={checkout} />;
}
