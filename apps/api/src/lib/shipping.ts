import type { CheckoutCourier, ShippingRate } from "@ecommerce/shared";

/**
 * Adapter ongkir. Kontrak ini dipakai checkout (T-06) agar tidak coupled ke provider tertentu.
 * Implementasi nyata (Biteship REST, cek origin/destination area id, dsb) adalah scope T-08 —
 * ganti isi `getShippingRates`/`resolveRate` di sana, signature & pemanggil tidak perlu berubah.
 */
export interface ShippingProvider {
  /** Daftar rate kurir dari titik pickup seller ke alamat tujuan. */
  getShippingRates(input: {
    originAreaId: string | null;
    destinationAreaId: string | null;
    weightGram: number;
  }): Promise<ShippingRate[]>;

  /** Validasi ulang 1 rate yang dipilih FE saat submit checkout (harga final, anti tampering). */
  resolveRate(input: {
    originAreaId: string | null;
    destinationAreaId: string | null;
    weightGram: number;
    courierCode: CheckoutCourier;
    service: string;
  }): Promise<ShippingRate | null>;
}

const COURIER_CATALOG: { code: CheckoutCourier; name: string; service: string; serviceName: string; base: number; perKg: number; etd: string }[] = [
  { code: "jne", name: "JNE", service: "reg", serviceName: "REG", base: 9000, perKg: 3000, etd: "2-3 hari" },
  { code: "jne", name: "JNE", service: "yes", serviceName: "YES (1 hari)", base: 18000, perKg: 5000, etd: "1 hari" },
  { code: "jnt", name: "J&T Express", service: "reg", serviceName: "Reguler", base: 8500, perKg: 2800, etd: "2-4 hari" },
  { code: "sicepat", name: "SiCepat", service: "reg", serviceName: "Reguler", base: 8000, perKg: 2700, etd: "2-3 hari" },
  { code: "sicepat", name: "SiCepat", service: "best", serviceName: "BEST (1 hari)", base: 16000, perKg: 4500, etd: "1 hari" },
  { code: "anteraja", name: "AnterAja", service: "reg", serviceName: "Reguler", base: 8000, perKg: 2600, etd: "2-3 hari" },
  { code: "gosend", name: "GoSend", service: "instant", serviceName: "Instant", base: 15000, perKg: 2000, etd: "1-3 jam" },
];

function computePrice(base: number, perKg: number, weightGram: number): number {
  const kg = Math.max(1, Math.ceil(weightGram / 1000));
  return base + perKg * (kg - 1);
}

/**
 * Stub deterministik (tanpa network call) — cukup untuk mengembangkan & menguji alur checkout
 * secara lokal tanpa kredensial Biteship. Harga dihitung dari berat, bukan random, supaya
 * hasil `getShippingRates` dan `resolveRate` konsisten satu sama lain.
 */
export class StubShippingProvider implements ShippingProvider {
  async getShippingRates({ weightGram }: { originAreaId: string | null; destinationAreaId: string | null; weightGram: number }) {
    return COURIER_CATALOG.map((c) => ({
      courierCode: c.code,
      courierName: c.name,
      service: c.service,
      serviceName: c.serviceName,
      price: computePrice(c.base, c.perKg, weightGram),
      etd: c.etd,
    }));
  }

  async resolveRate({
    weightGram,
    courierCode,
    service,
  }: {
    originAreaId: string | null;
    destinationAreaId: string | null;
    weightGram: number;
    courierCode: CheckoutCourier;
    service: string;
  }) {
    const entry = COURIER_CATALOG.find((c) => c.code === courierCode && c.service === service);
    if (!entry) return null;
    return {
      courierCode: entry.code,
      courierName: entry.name,
      service: entry.service,
      serviceName: entry.serviceName,
      price: computePrice(entry.base, entry.perKg, weightGram),
      etd: entry.etd,
    } satisfies ShippingRate;
  }
}

export const shippingProvider: ShippingProvider = new StubShippingProvider();
