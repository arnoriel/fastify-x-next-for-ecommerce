import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { meResponseSchema, type Role, type SessionUser } from "@ecommerce/shared";
import { env } from "@/env";

/**
 * Ambil user login dari API (server-side). Cookie milik origin API, jadi header cookie
 * request diteruskan mentah. `null` = belum login / session tidak valid / API tidak terjangkau.
 * Di-cache per request agar layout & page yang memanggilnya tidak menembak API berulang.
 */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader) return null;

  try {
    const res = await fetch(new URL("/api/me", env.NEXT_PUBLIC_API_URL), {
      headers: { cookie: cookieHeader },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return meResponseSchema.parse(await res.json()).user;
  } catch {
    return null;
  }
});

/** Guard halaman: wajib login (opsional: salah satu role). Selalu diverifikasi ke API. */
export async function requireUser(options: { roles?: readonly Role[]; next?: string } = {}) {
  const user = await getSession();
  if (!user) {
    const next = options.next ? `?next=${encodeURIComponent(options.next)}` : "";
    redirect(`/login${next}`);
  }
  if (options.roles && !options.roles.includes(user.role)) redirect("/?forbidden=1");
  return user;
}
