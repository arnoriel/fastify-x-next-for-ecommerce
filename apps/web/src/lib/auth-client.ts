"use client";

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { env } from "@/env";

// Client (browser). Web & API beda origin → cookie session wajib ikut terkirim.
export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_API_URL,
  basePath: "/api/auth",
  fetchOptions: { credentials: "include" },
  plugins: [
    // Tipe field tambahan di user (diisi & dijaga server; client hanya membaca).
    inferAdditionalFields({
      user: {
        role: { type: "string", required: false, input: false },
        status: { type: "string", required: false, input: false },
        phone: { type: "string", required: false, input: true },
      },
    }),
  ],
});
