import { z } from "zod";
import { httpUrl, parseEnv } from "@ecommerce/shared";

const schema = z.object({
  // Publik (ter-inline saat build): dipakai browser. Production → ganti = rebuild image web.
  NEXT_PUBLIC_API_URL: httpUrl,
  // Server-only, opsional: URL API lewat jaringan internal (mis. http://api:4000 di Docker) untuk fetch
  // dari server Next. Kosong = pakai NEXT_PUBLIC_API_URL.
  API_INTERNAL_URL: z.preprocess((v) => (v === "" ? undefined : v), httpUrl.optional()),
});

// NEXT_PUBLIC_* harus dirujuk eksplisit agar ter-inline saat build.
const parsed = parseEnv(
  schema,
  { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL, API_INTERNAL_URL: process.env.API_INTERNAL_URL },
  "apps/web",
);

export const env = {
  ...parsed,
  /** Base URL API untuk fetch dari SERVER Next (bukan browser). */
  API_SERVER_URL: parsed.API_INTERNAL_URL ?? parsed.NEXT_PUBLIC_API_URL,
};
