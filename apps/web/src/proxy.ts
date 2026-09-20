import { NextResponse, type NextRequest } from "next/server";

// Nama cookie session Better Auth (basePath default, tanpa prefix kustom).
const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

/**
 * Cek OPTIMISTIK saja: ada cookie session atau tidak, tanpa memanggil API (proxy tidak
 * untuk fetch lambat). Ini hanya mempercepat redirect; keamanan sebenarnya ada di
 * `requireUser()` (server component) dan di API (`requireRole`).
 * Hanya berguna bila cookie API terbaca oleh web (localhost dev / domain induk yang sama);
 * bila tidak, proxy membiarkan lewat dan `requireUser()` yang memutuskan.
 */
export function proxy(request: NextRequest) {
  const hasCookie = SESSION_COOKIES.some((name) => request.cookies.has(name));
  const { pathname } = request.nextUrl;

  // Sudah login → tak perlu ke /login atau /register.
  if (hasCookie && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/account", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/login", "/register"],
};
