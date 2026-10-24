import { defineStoreConfig } from "./store-config";

/**
 * ============================================================
 *  WHITE-LABEL CONFIG — satu-satunya file yang diedit per klien
 * ============================================================
 * Ubah nilai di bawah → restart `npm run dev` (atau rebuild untuk production) → branding, warna tema,
 * dan fitur berubah di seluruh UI & API tanpa menyentuh kode fitur. Dibaca web DAN api, jadi JANGAN
 * menaruh secret di sini (secret tetap di `.env`).
 * Panduan lengkap: README → bagian "White-label (T-13)".
 */
export const storeConfig = defineStoreConfig({
  // ---------- Branding ----------
  storeName: "Ecommerce",
  tagline: "Marketplace multi-vendor",
  description: "White-label multi-vendor e-commerce boilerplate",
  /** Path di apps/web/public (mis. "/logo.svg") atau URL https. null = nama toko sebagai teks. */
  logoUrl: null,

  // ---------- Tema warna (hex) — mode terang & gelap ----------
  theme: {
    light: { brand: "#ff6a3d", brandForeground: "#fff8f5", accent: "#1c1b1a", accentForeground: "#f6f5f3" },
    dark: { brand: "#ff7c52", brandForeground: "#1a0d08", accent: "#f2f0ed", accentForeground: "#141312" },
  },

  // ---------- Kontak (opsional; null = tidak ditampilkan) ----------
  contact: {
    email: null,
    phone: null,
    whatsapp: null,
    address: null,
  },

  // ---------- Feature flags ----------
  features: {
    /** false = mode toko tunggal (lihat README). */
    multiSeller: true,
    chat: true,
    wishlist: true,
    voucher: true,
  },
});

/** Alias ringkas untuk pengecekan fitur. */
export const features = storeConfig.features;

export function isFeatureEnabled(feature: keyof typeof features): boolean {
  return features[feature];
}
