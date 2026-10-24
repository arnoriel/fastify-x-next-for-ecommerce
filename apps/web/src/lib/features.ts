import { notFound } from "next/navigation";
import { type ComponentType, createElement } from "react";
import { type FeatureKey, features, isFeatureEnabled, storeConfig } from "@ecommerce/shared";

/** Mode toko tunggal (`features.multiSeller = false`): UI tidak menampilkan konsep multi-toko. */
export const isSingleSeller = !features.multiSeller;

/** Nama penjual di UI: mode toko tunggal memakai nama toko dari config (satu brand), bukan nama seller di DB. */
export const sellerLabel = (sellerName: string): string => (isSingleSeller ? storeConfig.storeName : sellerName);

/** Dipanggil di awal halaman fitur: fitur nonaktif → 404 standar (bukan halaman rusak/API error). */
export function requireFeature(feature: FeatureKey): void {
  if (!isFeatureEnabled(feature)) notFound();
}

/**
 * Bungkus komponen fitur: saat nonaktif tidak merender apa pun DAN tidak me-mount komponen aslinya,
 * jadi efek/polling/request-nya ikut mati. Cukup dipasang sekali di definisi komponen, bukan di tiap pemakai.
 */
export function withFeature<P extends object>(feature: FeatureKey, Component: ComponentType<P>): ComponentType<P> {
  function Gated(props: P) {
    return isFeatureEnabled(feature) ? createElement(Component, props) : null;
  }
  Gated.displayName = `withFeature(${feature})`;
  return Gated;
}
