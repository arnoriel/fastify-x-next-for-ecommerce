import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/admin-nav";
import { requireUser } from "@/lib/session";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Guard: wajib login sebagai admin. Setiap endpoint /api/admin/* tetap memeriksa peran di API.
  const user = await requireUser({ roles: ["admin"], next: "/admin" });
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <AdminNav userId={user.id} />
      <main>{children}</main>
    </div>
  );
}
