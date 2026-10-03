import { CHECKOUT_COURIERS, checkoutCourierSchema, type CheckoutCourier, type ShippingRate } from "@ecommerce/shared";
import { env } from "../env";
import {
  createOrder,
  fetchOrder,
  fetchRates,
  fetchTracking,
  type BiteshipCreateOrderPayload,
  type BiteshipOrder,
  type BiteshipPricing,
} from "./biteship";
import { httpError } from "./http-error";

/**
 * Adapter ongkir. Kontrak ini dipakai checkout (T-06) agar tidak coupled ke provider tertentu.
 * T-08: `BiteshipProvider` menggantikan `StubShippingProvider` di titik instansiasi (paling bawah file) —
 * signature `ShippingProvider` TIDAK berubah, checkout.routes.ts tidak disentuh.
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
export class StubShippingProvider implements ShippingProvider, ShipmentGateway {
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

  async createShipment(input: CreateShipmentInput): Promise<Shipment> {
    return stubShipment(input);
  }

  async trackShipment(): Promise<TrackedShipment | null> {
    return null; // stub tidak punya sumber tracking; status digerakkan lewat webhook simulasi.
  }
}

// ---------- Shipment (booking kurir & tracking) — T-08 ----------

export interface ShipmentAddress {
  contactName: string;
  phone: string;
  address: string;
  postalCode: string;
  areaId: string | null;
  note?: string;
}

export interface CreateShipmentInput {
  /** Unik per upaya booking (idempotency di sisi provider) — mis. orderNo. */
  referenceId: string;
  origin: ShipmentAddress;
  destination: ShipmentAddress;
  courierCode: string;
  courierService: string;
  items: { name: string; value: number; quantity: number; weightGram: number; lengthCm?: number; widthCm?: number; heightCm?: number }[];
  note?: string | null;
}

export interface Shipment {
  shipmentId: string;
  trackingId: string | null;
  waybillId: string | null;
  status: string;
  link: string | null;
}

export interface TrackedShipment {
  status: string;
  waybillId: string | null;
  link: string | null;
  history: { status: string; note: string | null; occurredAt: Date }[];
}

/**
 * Booking pengiriman + tracking. Terpisah dari `ShippingProvider` supaya kontrak rate checkout (T-06)
 * tetap utuh. `createShipment` melempar HttpError (502) kalau provider menolak/tak terjangkau.
 */
export interface ShipmentGateway {
  createShipment(input: CreateShipmentInput): Promise<Shipment>;
  /** Null = provider tidak terjangkau / tracking tidak tersedia (caller skip, bukan error). */
  trackShipment(trackingId: string): Promise<TrackedShipment | null>;
}

// ---------- Stub: shipment simulasi (dev tanpa API key) ----------

function stubShipment(input: CreateShipmentInput): Shipment {
  return {
    shipmentId: `stub-${input.referenceId}`,
    trackingId: `stub-trk-${input.referenceId}`,
    waybillId: `STUB${input.referenceId.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(-12)}`,
    status: "confirmed",
    link: null,
  };
}

// ---------- Biteship ----------

/** Kode kurir kita → kode Biteship (selain yang tercantum, kodenya sama). */
const TO_BITESHIP_COURIER: Partial<Record<CheckoutCourier, string>> = { gosend: "gojek" };
const FROM_BITESHIP_COURIER: Record<string, string> = { gojek: "gosend" };
/** Kurir instant butuh koordinat — tidak tersedia di rate by area id, jadi tidak diminta. */
const INSTANT_COURIERS: readonly CheckoutCourier[] = ["gosend", "grab"];
const RATE_COURIERS = CHECKOUT_COURIERS.filter((c) => !INSTANT_COURIERS.includes(c)).map((c) => TO_BITESHIP_COURIER[c] ?? c);

const RATE_CACHE_TTL_MS = 10 * 60 * 1000;
const RATE_CACHE_MAX = 500;
const DURATION_UNIT_ID: Record<string, string> = { days: "hari", day: "hari", hours: "jam", hour: "jam", minutes: "menit" };

const toBiteshipCourier = (code: string) => TO_BITESHIP_COURIER[code as CheckoutCourier] ?? code;

function formatEtd(p: BiteshipPricing): string {
  if (p.shipment_duration_range) {
    const unit = DURATION_UNIT_ID[p.shipment_duration_unit ?? "days"] ?? p.shipment_duration_unit ?? "hari";
    return `${p.shipment_duration_range} ${unit}`;
  }
  return p.duration ?? "-";
}

/** Pricing Biteship → ShippingRate kita. Kurir di luar daftar CHECKOUT_COURIERS dibuang. */
function toShippingRate(p: BiteshipPricing): ShippingRate | null {
  const code = checkoutCourierSchema.safeParse(FROM_BITESHIP_COURIER[p.courier_code] ?? p.courier_code);
  if (!code.success || !Number.isFinite(p.price) || p.price < 0) return null;
  return {
    courierCode: code.data,
    courierName: p.courier_name,
    service: p.courier_service_code,
    serviceName: p.courier_service_name,
    price: Math.round(p.price),
    etd: formatEtd(p),
  };
}

/**
 * Implementasi Biteship. Rate di-cache singkat per (origin, destination, berat) supaya:
 * (1) harga yang dilihat buyer saat memilih kurir sama dengan hasil `resolveRate` saat submit,
 * (2) hemat request ke Biteship (1 rate-call per toko per pilihan, bukan per interaksi).
 */
export class BiteshipProvider implements ShippingProvider, ShipmentGateway {
  private readonly rateCache = new Map<string, { at: number; rates: ShippingRate[] }>();

  private async loadRates(originAreaId: string | null, destinationAreaId: string | null, weightGram: number) {
    if (!destinationAreaId) {
      throw httpError(
        422,
        "SHIPPING_AREA_UNRESOLVED",
        "Lokasi pengiriman belum dikenali kurir. Perbarui alamat (kecamatan & kode pos) lalu coba lagi.",
      );
    }
    if (!originAreaId) {
      throw httpError(
        422,
        "SELLER_PICKUP_UNRESOLVED",
        "Alamat pickup toko ini belum valid sehingga ongkir tidak bisa dihitung. Hubungi penjual.",
      );
    }

    const key = `${originAreaId}|${destinationAreaId}|${weightGram}`;
    const cached = this.rateCache.get(key);
    if (cached && Date.now() - cached.at < RATE_CACHE_TTL_MS) return cached.rates;

    const pricing = await fetchRates({ originAreaId, destinationAreaId, couriers: RATE_COURIERS, weightGram });
    if (!pricing) {
      throw httpError(503, "SHIPPING_UNAVAILABLE", "Layanan ongkir sedang tidak tersedia. Silakan coba lagi dalam beberapa saat.");
    }

    // Satu entri per (kurir, layanan) — jaga-jaga duplikat dari provider.
    const unique = new Map<string, ShippingRate>();
    for (const p of pricing) {
      const rate = toShippingRate(p);
      if (rate) unique.set(`${rate.courierCode}::${rate.service}`, rate);
    }
    const rates = [...unique.values()];

    if (rates.length > 0) {
      if (this.rateCache.size >= RATE_CACHE_MAX) this.rateCache.delete(this.rateCache.keys().next().value!);
      this.rateCache.set(key, { at: Date.now(), rates });
    }
    return rates;
  }

  async getShippingRates(input: { originAreaId: string | null; destinationAreaId: string | null; weightGram: number }) {
    return this.loadRates(input.originAreaId, input.destinationAreaId, input.weightGram);
  }

  async resolveRate(input: {
    originAreaId: string | null;
    destinationAreaId: string | null;
    weightGram: number;
    courierCode: CheckoutCourier;
    service: string;
  }) {
    const rates = await this.loadRates(input.originAreaId, input.destinationAreaId, input.weightGram);
    return rates.find((r) => r.courierCode === input.courierCode && r.service === input.service) ?? null;
  }

  async createShipment(input: CreateShipmentInput): Promise<Shipment> {
    const { origin, destination } = input;
    if (!origin.areaId && !origin.postalCode) throw httpError(422, "PICKUP_ADDRESS_INCOMPLETE", "Alamat pickup toko belum lengkap.");

    const payload: BiteshipCreateOrderPayload = {
      reference_id: input.referenceId,
      origin_contact_name: origin.contactName,
      origin_contact_phone: origin.phone,
      origin_address: origin.address,
      ...(origin.areaId ? { origin_area_id: origin.areaId } : { origin_postal_code: Number(origin.postalCode) }),
      ...(origin.note ? { origin_note: origin.note } : {}),
      destination_contact_name: destination.contactName,
      destination_contact_phone: destination.phone,
      destination_address: destination.address,
      ...(destination.areaId
        ? { destination_area_id: destination.areaId }
        : { destination_postal_code: Number(destination.postalCode) }),
      ...(destination.note ? { destination_note: destination.note } : {}),
      courier_company: toBiteshipCourier(input.courierCode),
      courier_type: input.courierService,
      delivery_type: "now",
      ...(input.note ? { order_note: input.note } : {}),
      items: input.items.map((i) => ({
        name: i.name.slice(0, 100),
        value: i.value,
        quantity: i.quantity,
        weight: Math.max(1, Math.round(i.weightGram)),
        ...(i.lengthCm ? { length: i.lengthCm } : {}),
        ...(i.widthCm ? { width: i.widthCm } : {}),
        ...(i.heightCm ? { height: i.heightCm } : {}),
      })),
    };

    const result = await createOrder(payload);
    let order: BiteshipOrder | null = null;

    if (result.ok) {
      order = result.order;
    } else if (result.reason === "duplicate" && result.existingOrderId) {
      // Booking sebelumnya sukses di Biteship tapi tidak sempat tersimpan di DB kita → adopsi, jangan gagal.
      order = await fetchOrder(result.existingOrderId);
    }

    if (!order) {
      const message = !result.ok && result.reason === "error" ? result.message : "Biteship menolak permintaan.";
      throw httpError(502, "SHIPMENT_BOOKING_FAILED", `Gagal membuat pengiriman di kurir: ${message}`);
    }

    return {
      shipmentId: order.id,
      trackingId: order.courier?.tracking_id ?? null,
      waybillId: order.courier?.waybill_id ?? null,
      status: order.status,
      link: order.courier?.link ?? null,
    };
  }

  async trackShipment(trackingId: string): Promise<TrackedShipment | null> {
    const tracking = await fetchTracking(trackingId);
    if (!tracking) return null;
    return {
      status: tracking.status,
      waybillId: tracking.waybill_id ?? null,
      link: tracking.link ?? null,
      history: tracking.history.flatMap((h) => {
        const occurredAt = new Date(h.updated_at);
        return Number.isNaN(occurredAt.getTime()) ? [] : [{ status: h.status, note: h.note ?? null, occurredAt }];
      }),
    };
  }
}

// ---------- Titik instansiasi ----------
// BITESHIP_API_KEY terisi → Biteship asli. Kosong → stub simulasi (dev/offline); production wajib key (lihat env.ts).

const provider = env.BITESHIP_API_KEY ? new BiteshipProvider() : new StubShippingProvider();
if (!env.BITESHIP_API_KEY) {
  console.warn("[shipping] BITESHIP_API_KEY kosong → memakai StubShippingProvider (ongkir & resi simulasi, hanya untuk dev).");
}

export const shippingProvider: ShippingProvider = provider;
export const shipmentGateway: ShipmentGateway = provider;
