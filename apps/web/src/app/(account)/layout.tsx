import type { ReactNode } from "react";
import { AppBar } from "@/components/layout/app-bar";
import { requireUser } from "@/lib/session";

export default async function AccountAreaLayout({ children }: { children: ReactNode }) {
  const user = await requireUser({ next: "/account" });
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <AppBar userId={user.id} />
      <main className="flex flex-col gap-5">{children}</main>
    </div>
  );
}
