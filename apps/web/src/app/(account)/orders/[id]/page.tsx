import "server-only";

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { orderDetailSchema } from "@ecommerce/shared";
import { env } from "@/env";
import { OrderDetailView } from "@/components/orders/order-detail-view";

export const metadata: Metadata = { title: "Detail Pesanan" };
export const dynamic = "force-dynamic";

async function getOrder(id: string) {
  const cookieHeader = (await cookies()).toString();
  try {
    const res = await fetch(new URL(`/api/orders/${id}`, env.NEXT_PUBLIC_API_URL), {
      headers: { cookie: cookieHeader },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return orderDetailSchema.parse(await res.json());
  } catch {
    return null;
  }
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();

  return <OrderDetailView order={order} />;
}
