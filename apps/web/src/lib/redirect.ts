/** Terima hanya path internal ("/x"). Cegah open redirect ("//evil.com", "https://evil.com", "/\evil.com"). */
export function safeNext(value: string | null | undefined, fallback = "/account"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
