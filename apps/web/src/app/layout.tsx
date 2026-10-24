import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { storeConfig } from "@ecommerce/shared";
import { buildThemeCss } from "@/lib/theme";
import "./globals.css";

const { storeName, tagline, description, theme } = storeConfig;

export const metadata: Metadata = {
  applicationName: storeName,
  title: { default: storeName, template: `%s · ${storeName}` },
  description: description || tagline || storeName,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: theme.light.brand },
    { media: "(prefers-color-scheme: dark)", color: theme.dark.brand },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <head>
        {/* Token brand & accent berasal dari store.config.ts (bukan globals.css) → satu sumber kebenaran. */}
        <style id="store-theme" dangerouslySetInnerHTML={{ __html: buildThemeCss(theme) }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
