import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-[calc(100dvh-6rem)] w-full items-center justify-center">
      <div className="auth-shell">{children}</div>
    </main>
  );
}