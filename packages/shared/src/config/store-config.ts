import { z } from "zod";

/**
 * Skema & helper config white-label (T-13). Nilai aktual ada di `store.config.ts` — itu SATU-SATUNYA file
 * yang diedit per klien. Divalidasi saat module di-import (web & api) → config salah = gagal cepat, bukan
 * tampilan rusak diam-diam.
 */

const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "harus hex, mis. #ff6a3d");
const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable().default(null);

const themeModeSchema = z.object({
  /** Warna utama brand (tombol CTA, badge, aksen). */
  brand: hexColor,
  /** Warna teks/ikon di atas `brand`. */
  brandForeground: hexColor,
  /** Warna tombol netral/aktif (tab aktif, tombol .btn). */
  accent: hexColor,
  /** Warna teks di atas `accent`. */
  accentForeground: hexColor,
});

const featuresSchema = z.object({
  /** false = mode toko tunggal: tanpa pendaftaran seller baru, satu keranjang/checkout = satu toko. */
  multiSeller: z.boolean().default(true),
  chat: z.boolean().default(true),
  wishlist: z.boolean().default(true),
  voucher: z.boolean().default(true),
});

export const storeConfigSchema = z.object({
  storeName: z.string().trim().min(1).max(40),
  tagline: z.string().trim().max(120).default(""),
  description: z.string().trim().max(300).default(""),
  /** URL absolut (https) atau path di `apps/web/public` (mis. "/logo.svg"). null = tampilkan nama toko sebagai teks. */
  logoUrl: z
    .string()
    .regex(/^(?:https?:\/\/|\/)\S+$/, "harus URL http(s) atau path diawali /")
    .nullable()
    .default(null),
  theme: z.object({ light: themeModeSchema, dark: themeModeSchema }),
  contact: z
    .object({
      email: z.email().nullable().default(null),
      phone: nullableText(30),
      /** Nomor internasional tanpa +/spasi, mis. "6281234567890". */
      whatsapp: z
        .string()
        .regex(/^\d{8,15}$/, "hanya angka 8–15 digit, tanpa + atau spasi")
        .nullable()
        .default(null),
      address: nullableText(200),
    })
    .default({ email: null, phone: null, whatsapp: null, address: null }),
  features: featuresSchema.default({ multiSeller: true, chat: true, wishlist: true, voucher: true }),
});

export type StoreConfigInput = z.input<typeof storeConfigSchema>;
export type StoreConfig = z.output<typeof storeConfigSchema>;
export type StoreTheme = StoreConfig["theme"];
export type StoreThemeMode = StoreTheme["light"];
export type StoreFeatures = StoreConfig["features"];
export type FeatureKey = keyof StoreFeatures;

/** Validasi config; melempar satu pesan yang merinci semua field bermasalah. */
export function defineStoreConfig(input: StoreConfigInput): Readonly<StoreConfig> {
  const result = storeConfigSchema.safeParse(input);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`[store.config.ts] Config tidak valid:\n${problems}`);
  }
  return Object.freeze(result.data);
}
