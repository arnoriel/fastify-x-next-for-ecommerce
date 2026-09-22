import "server-only";

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { sellerOnboardingStatusSchema } from "@ecommerce/shared";
import { env } from "@/env";
import { requireUser } from "@/lib/session";
import { SellerOnboardingStatusView } from "@/components/seller/seller-onboarding-status-view";

export const metadata: Metadata = { title: "Status Pengajuan Toko" };
export const dynamic = "force-dynamic";

async function getStatus() {
  const cookieHeader = (await cookies()).toString();
  try {
    const res = await fetch(new URL("/api/sellers/onboarding/status", env.NEXT_PUBLIC_API_URL), {
      headers: { cookie: cookieHeader },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return sellerOnboardingStatusSchema.parse(await res.json());
  } catch {
    return null;
  }
}

export default async function SellerOnboardingStatusPage() {
  await requireUser({ next: "/seller/onboarding/status" });

  const status = await getStatus();
  // Belum pernah submit onboarding sama sekali → tidak ada status untuk ditampilkan,
  // arahkan ke form, bukan halaman status kosong.
  if (!status) redirect("/seller/onboarding");

  return <SellerOnboardingStatusView initial={status} />;
}
