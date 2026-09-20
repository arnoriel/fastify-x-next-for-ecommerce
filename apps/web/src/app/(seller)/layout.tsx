import type { ReactNode } from "react";
import { requireUser } from "@/lib/session";

export default async function SellerLayout({ children }: { children: ReactNode }) {
  // Guard: wajib login sebagai seller. Approval status dicek ulang di API tiap request.
  await requireUser({ roles: ["seller"], next: "/seller/products/new" });
  return <main className="auth-shell wide">{children}</main>;
}
