import { config } from "dotenv";
import { z } from "zod";
import { envPort, httpUrl, parseEnv } from "@ecommerce/shared";

config({ quiet: true });

// "" (baris kosong di .env) diperlakukan sama seperti tidak diisi.
const optionalStr = z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());
const optionalUrl = z.preprocess((v) => (v === "" ? undefined : v), httpUrl.optional());

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().min(1).default("localhost"),
  API_PORT: envPort.default(4000),
  WEB_URL: httpUrl,
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  // Kunci penandatangan cookie/session. Wajib unik & rahasia di production.
  BETTER_AUTH_SECRET: z.string().min(32, "minimal 32 karakter (openssl rand -base64 32)"),
  // URL publik API (dipakai Better Auth untuk callback & cookie). Default = alamat API lokal.
  BETTER_AUTH_URL: optionalUrl,
  // Opsional: Google OAuth. Keduanya harus diisi bersamaan, atau keduanya kosong.
  // Daftar IP/CIDR reverse proxy tepercaya (pisah koma), mis. "172.18.0.0/16,10.0.0.5".
  // Kosong (dev, tanpa proxy) = header X-Forwarded-For dari client TIDAK dipercaya.
  TRUSTED_PROXIES: z.preprocess(
    (v) => (typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean) : v),
    z.array(z.string()).default([]),
  ),
  GOOGLE_CLIENT_ID: optionalStr,
  GOOGLE_CLIENT_SECRET: optionalStr,
  // --- Cloudflare R2 (S3-compatible) — upload gambar produk (T-04) ---
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  // Domain publik bucket (custom domain / r2.dev), tanpa trailing slash.
  R2_PUBLIC_URL: httpUrl,
});

const schema = baseSchema.superRefine((v, ctx) => {
  if (Boolean(v.GOOGLE_CLIENT_ID) !== Boolean(v.GOOGLE_CLIENT_SECRET)) {
    ctx.addIssue({
      code: "custom",
      path: ["GOOGLE_CLIENT_ID"],
      message: "GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET harus diisi bersamaan (atau kosongkan keduanya)",
    });
  }
  if (v.NODE_ENV === "production" && v.BETTER_AUTH_SECRET.includes("change_me")) {
    ctx.addIssue({
      code: "custom",
      path: ["BETTER_AUTH_SECRET"],
      message: "masih memakai secret contoh — generate baru dengan `openssl rand -base64 32`",
    });
  }
});

function load() {
  try {
    return parseEnv(schema, process.env, "apps/api");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export const env = load();
