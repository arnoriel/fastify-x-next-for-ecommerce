import type { ReactNode } from "react";
import { requireUser } from "@/lib/session";

export default async function CartLayout({ children }: { children: ReactNode }) {
  // Wajib login untuk cart/checkout — tidak dibatasi role (buyer/seller/admin semua boleh belanja).
  await requireUser({ next: "/cart" });
  return <main className="mx-auto flex w-full max-w-3xl flex-col gap-5">{children}</main>;
}
