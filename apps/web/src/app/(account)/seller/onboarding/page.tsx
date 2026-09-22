import "server-only";

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { sellerOnboardingStatusSchema } from "@ecommerce/shared";
import { env } from "@/env";
import { requireUser } from "@/lib/session";
import { SellerOnboardingForm } from "@/components/seller/seller-onboarding-form";

export const metadata: Metadata = { title: "Buka Toko" };
export const dynamic = "force-dynamic";

async function getExistingStatus() {
  const cookieHeader = (await cookies()).toString();
  try {
    const res = await fetch(new URL("/api/sellers/onboarding/status", env.NEXT_PUBLIC_API_URL), {
      headers: { cookie: cookieHeader },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return sellerOnboardingStatusSchema.parse(await res.json());
  } catch {
    return null;
  }
}

export default async function SellerOnboardingPage() {
  await requireUser({ next: "/seller/onboarding" });

  // Sudah pernah submit dan masih pending/approved → arahkan ke halaman status, bukan form
  // kosong lagi (mencegah submit ganda / kebingungan "sudah kirim tapi kok form lagi").
  const existing = await getExistingStatus();
  if (existing && existing.status !== "rejected") {
    redirect("/seller/onboarding/status");
  }

  return <SellerOnboardingForm />;
}
