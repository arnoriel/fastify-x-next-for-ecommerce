import type { ReactNode } from "react";
import { SellerNav } from "@/components/seller-dashboard/seller-nav";
import { requireUser } from "@/lib/session";

export default async function SellerLayout({ children }: { children: ReactNode }) {
  // Guard: wajib login sebagai seller. Approval status dicek ulang di API tiap request.
  await requireUser({ roles: ["seller"], next: "/seller/dashboard" });
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <SellerNav />
      <main>{children}</main>
    </div>
  );
}
