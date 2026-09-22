import type { ReactNode } from "react";
import { requireUser } from "@/lib/session";

export default async function AccountAreaLayout({ children }: { children: ReactNode }) {
  await requireUser({ next: "/account" });
  return <main className="mx-auto flex w-full max-w-3xl flex-col gap-5">{children}</main>;
}
