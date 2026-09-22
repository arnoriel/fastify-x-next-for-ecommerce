import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // @ecommerce/shared diexport sebagai source TS (tanpa build step)
  transpilePackages: ["@ecommerce/shared"],
  images: {
    remotePatterns: [
      // Seed data dev pakai picsum.photos sebagai placeholder gambar produk.
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "fastly.picsum.photos" },
      // Produk asli tersimpan di Cloudflare R2 (T-30). Sesuaikan hostname bucket sebenarnya di production.
      { protocol: "https", hostname: "*.r2.dev" },
      { protocol: "https", hostname: "*.r2.cloudflarestorage.com" },
    ],
  },
};

export default config;