import type { ReactNode } from "react";
import { AppBar } from "@/components/layout/app-bar";
import { requireUser } from "@/lib/session";

export default async function CartLayout({ children }: { children: ReactNode }) {
  // Wajib login untuk cart/checkout — tidak dibatasi role (buyer/seller/admin semua boleh belanja).
  const user = await requireUser({ next: "/cart" });
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <AppBar userId={user.id} />
      <main className="flex flex-col gap-5">{children}</main>
    </div>
  );
}
