"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { ApiError } from "@/lib/http";

/**
 * Ubah error jadi pesan untuk UI. Sesi habis (401) → redirect ke `/login?next=<halaman ini>`
 * alih-alih menampilkan error mentah.
 */
export function useApiErrorMessage() {
  const router = useRouter();
  const pathname = usePathname();

  return useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof ApiError && err.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return "Sesi berakhir. Mengalihkan ke halaman login...";
      }
      return err instanceof Error ? err.message : fallback;
    },
    [router, pathname],
  );
}
