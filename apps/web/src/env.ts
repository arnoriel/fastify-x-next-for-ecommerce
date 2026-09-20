import { z } from "zod";
import { httpUrl, parseEnv } from "@ecommerce/shared";

const schema = z.object({ NEXT_PUBLIC_API_URL: httpUrl });

// NEXT_PUBLIC_* harus dirujuk eksplisit agar ter-inline saat build.
export const env = parseEnv(
  schema,
  { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL },
  "apps/web",
);
