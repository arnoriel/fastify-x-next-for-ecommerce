import "server-only";

import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { checkoutViewSchema } from "@ecommerce/shared";
import { env } from "@/env";
import { formatRupiah } from "@/lib/format";

export const metadata: Metadata = { title: "Invoice" };
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

export default async function CheckoutDetailPage({ params }: { params: Promise<{ checkoutId: string }> }) {
  const { checkoutId } = await params;
  const checkout = await getCheckout(checkoutId);
  if (!checkout) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div className="alert" style={{ background: "var(--card)" }}>
        <span>
          Pesanan berhasil dibuat! Invoice <strong>{checkout.invoiceNo}</strong>
        </span>
      </div>

      {checkout.orders.map((order) => (
        <section key={order.id} className="card">
          <div className="flex items-center justify-between py-2">
            <h2 className="text-sm font-semibold text-[var(--fg)]">{order.sellerName}</h2>
            <span className="pill">{order.orderNo}</span>
          </div>
          <ul className="!m-0 !p-0 !shadow-none">
            {order.items.map((item) => (
              <li key={item.id}>
                <span className="text-sm">
                  {item.productName} ({item.variantName}) × {item.quantity}
                </span>
                <span className="text-sm font-medium">{formatRupiah(item.subtotal)}</span>
              </li>
            ))}
            <li>
              <span className="muted small">Ongkir ({order.courierCode?.toUpperCase()} {order.courierService})</span>
              <span className="text-sm">{formatRupiah(order.shippingCost)}</span>
            </li>
            {order.discount > 0 && (
              <li>
                <span className="muted small">Diskon</span>
                <span className="text-sm text-[var(--up)]">-{formatRupiah(order.discount)}</span>
              </li>
            )}
            <li>
              <span className="font-semibold text-[var(--fg)]">Total toko ini</span>
              <span className="font-bold text-[var(--fg)]">{formatRupiah(order.total)}</span>
            </li>
          </ul>
        </section>
      ))}

      <ul className="card">
        <li>
          <span className="muted small">Subtotal</span>
          <span className="text-sm">{formatRupiah(checkout.subtotal)}</span>
        </li>
        <li>
          <span className="muted small">Ongkos kirim</span>
          <span className="text-sm">{formatRupiah(checkout.shippingTotal)}</span>
        </li>
        {checkout.discountTotal > 0 && (
          <li>
            <span className="muted small">Total diskon</span>
            <span className="text-sm text-[var(--up)]">-{formatRupiah(checkout.discountTotal)}</span>
          </li>
        )}
        <li>
          <span className="font-semibold text-[var(--fg)]">Grand total</span>
          <span className="text-lg font-bold text-[var(--fg)]">{formatRupiah(checkout.grandTotal)}</span>
        </li>
      </ul>

      <Link href="/account" className="btn">
        Lihat pesanan saya
      </Link>
    </div>
  );
}
