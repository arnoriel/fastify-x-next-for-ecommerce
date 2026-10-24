import path from "node:path";
import type { NextConfig } from "next";

/** Hostname gambar tambahan (CDN/custom domain R2) dari env, dipisah koma. Boleh berupa host atau URL penuh. */
const extraImageHosts = (process.env.NEXT_IMAGE_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean)
  .map((h) => new URL(h.includes("://") ? h : `https://${h}`).hostname);

// Image Docker production mengeset NEXT_OUTPUT=standalone. Dev & `next start` lokal tidak terpengaruh.
const standalone = process.env.NEXT_OUTPUT === "standalone";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(standalone && {
    output: "standalone",
    // Monorepo: telusuri dependency dari root repo agar packages/shared & node_modules ikut ter-trace.
    // `next build` selalu jalan dari apps/web (npm workspace script).
    outputFileTracingRoot: path.join(process.cwd(), "../.."),
  }),
  // @ecommerce/shared diexport sebagai source TS (tanpa build step)
  transpilePackages: ["@ecommerce/shared"],
  images: {
    remotePatterns: [
      // Seed data dev pakai picsum.photos sebagai placeholder gambar produk.
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "fastly.picsum.photos" },
      // Produk asli tersimpan di Cloudflare R2 (T-30).
      { protocol: "https", hostname: "*.r2.dev" },
      { protocol: "https", hostname: "*.r2.cloudflarestorage.com" },
      // Custom domain / CDN R2 production: isi NEXT_IMAGE_HOSTS saat build (mis. cdn.tokoku.com).
      ...extraImageHosts.map((hostname) => ({ protocol: "https" as const, hostname })),
    ],
  },
};

export default config;
