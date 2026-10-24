import type { StoreThemeMode, StoreTheme } from "@ecommerce/shared";

const vars = (m: StoreThemeMode) =>
  `--brand:${m.brand};--brand-fg:${m.brandForeground};--accent:${m.accent};--accent-fg:${m.accentForeground};`;

/**
 * CSS variable tema dari `store.config.ts`. Aman diinjeksi mentah: semua nilai sudah lolos validasi
 * hex (`storeConfigSchema`), jadi tidak ada karakter yang bisa keluar dari deklarasi CSS.
 */
export function buildThemeCss(theme: StoreTheme): string {
  return `:root{${vars(theme.light)}}@media (prefers-color-scheme: dark){:root{${vars(theme.dark)}}}`;
}
