"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    if (pending) return;
    setPending(true);
    try {
      await authClient.signOut();
    } finally {
      // Tetap kembali ke /login walau request gagal; server akan menolak session lama.
      router.replace("/login");
      router.refresh();
      setPending(false);
    }
  }

  return (
    <button className="btn btn-ghost" type="button" onClick={onClick} disabled={pending}>
      {pending ? "Keluar…" : "Keluar"}
    </button>
  );
}
