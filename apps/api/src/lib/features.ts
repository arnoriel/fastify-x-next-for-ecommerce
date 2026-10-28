import type { FastifyPluginAsync } from "fastify";
import { type FeatureKey, isFeatureEnabled } from "@ecommerce/shared";
import { httpError } from "./http-error";

const FEATURE_LABEL: Record<FeatureKey, string> = {
  multiSeller: "multi-seller (pendaftaran toko baru)",
  chat: "chat",
  wishlist: "wishlist",
  voucher: "voucher",
  returns: "retur & refund",
};

/** Lempar 403 FEATURE_DISABLED bila fitur dimatikan di `store.config.ts`. */
export function requireFeature(feature: FeatureKey): void {
  if (!isFeatureEnabled(feature)) {
    throw httpError(403, "FEATURE_DISABLED", `Fitur ${FEATURE_LABEL[feature]} dinonaktifkan di toko ini.`);
  }
}

/** Bungkus plugin route: semua endpoint-nya menjawab 403 FEATURE_DISABLED saat fitur nonaktif. */
export function whenFeature(feature: FeatureKey, plugin: FastifyPluginAsync): FastifyPluginAsync {
  return async (app) => {
    app.addHook("onRequest", async () => requireFeature(feature));
    await app.register(plugin);
  };
}

/**
 * Mode toko tunggal (`features.multiSeller = false`): satu keranjang/checkout hanya boleh berisi satu toko.
 * Pengaman server — UI sudah menyembunyikan konsep multi-toko, ini menutup keranjang campuran yang
 * terbentuk sebelum flag dimatikan atau lewat request manual.
 */
export function ensureSingleSeller(sellerIds: Iterable<string>): void {
  if (isFeatureEnabled("multiSeller")) return;
  if (new Set(sellerIds).size > 1) {
    throw httpError(
      409,
      "SINGLE_SELLER_ONLY",
      "Toko ini hanya melayani satu penjual per keranjang. Hapus produk dari toko lain untuk melanjutkan.",
    );
  }
}
