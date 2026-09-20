import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // @ecommerce/shared diexport sebagai source TS (tanpa build step)
  transpilePackages: ["@ecommerce/shared"],
};

export default config;
