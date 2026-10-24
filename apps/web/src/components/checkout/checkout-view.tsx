"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaTriangleExclamation } from "react-icons/fa6";
import {
  type Address,
  type AvailableVoucher,
  type CartGroup,
  type CreateCheckoutInput,
  features,
  type ShippingRate,
  type VoucherPreview,
} from "@ecommerce/shared";
import { listAddresses } from "@/lib/address-api";
import { getShippingRates, submitCheckout } from "@/lib/cart-api";
import { useCartStore } from "@/lib/cart-store";
import { isSingleSeller } from "@/lib/features";
import { formatRupiah } from "@/lib/format";
import { ApiError } from "@/lib/http";
import { listAvailableVouchers, validateVoucher } from "@/lib/voucher-api";
import { AddressForm } from "./address-form";
import { VoucherField } from "./voucher-field";

const DRAFT_KEY = "checkout_draft_v1";
const IDEMPOTENCY_KEY_STORAGE = "checkout_idempotency_v1";

/** UUID stabil per "attempt" checkout — dipakai lagi kalau submit di-retry (mis. setelah
 * redirect login akibat session expired), supaya backend tahu ini submit yang sama, bukan
 * order baru. Direset (dihapus) setelah checkout SUKSES. */
function getOrCreateIdempotencyKey(): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  let key = window.sessionStorage.getItem(IDEMPOTENCY_KEY_STORAGE);
  if (!key) {
    key = crypto.randomUUID();
    window.sessionStorage.setItem(IDEMPOTENCY_KEY_STORAGE, key);
  }
  return key;
}

function clearIdempotencyKey() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(IDEMPOTENCY_KEY_STORAGE);
}

interface CheckoutDraft {
  addressId: string | null;
  selections: Record<string, { courierCode: string; service: string; voucherCode: string }>;
  platformVoucher: string;
}

/** Fitur voucher dimatikan setelah draft tersimpan → buang kode lama agar tidak ikut terkirim. */
function withoutVouchers(draft: CheckoutDraft): CheckoutDraft {
  const selections = Object.fromEntries(
    Object.entries(draft.selections).map(([sellerId, sel]) => [sellerId, { ...sel, voucherCode: "" }]),
  );
  return { ...draft, selections, platformVoucher: "" };
}

/** T-06 [V3]: simpan pilihan alamat/kurir/voucher supaya kalau session expired di tengah
 * checkout dan buyer diarahkan ke login, setelah login balik ke checkout tanpa mengulang. */
function saveDraft(draft: CheckoutDraft) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // sessionStorage penuh/disabled — draft tidak tersimpan, bukan fatal.
  }
}

function readDraft(): CheckoutDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    const draft = raw ? (JSON.parse(raw) as CheckoutDraft) : null;
    return draft && !features.voucher ? withoutVouchers(draft) : draft;
  } catch {
    return null;
  }
}

function clearDraft() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(DRAFT_KEY);
}

type SellerSelection = { courierCode: string; service: string; voucherCode: string };

const PLATFORM_KEY = "platform";
const sellerKey = (sellerId: string) => `seller:${sellerId}`;

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

type VoucherJob = { key: string; code: string; sellerId?: string };
type VoucherCheck = { job: VoucherJob; preview: VoucherPreview } | { job: VoucherJob; error: string };

function availableItemsOf(group: CartGroup) {
  return group.items.filter((i) => i.isAvailable);
}

export function CheckoutView() {
  const router = useRouter();
  const { cart, hasLoaded, refresh } = useCartStore();

  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [showNewAddress, setShowNewAddress] = useState(false);

  const [rates, setRates] = useState<Record<string, ShippingRate[]>>({});
  const [ratesLoading, setRatesLoading] = useState(false);
  const [selections, setSelections] = useState<Record<string, SellerSelection>>({});
  // `selections[..].voucherCode` / `platformVoucher` = kode yang SUDAH lolos validasi server (dikirim saat checkout).
  const [platformVoucher, setPlatformVoucher] = useState("");
  const [previews, setPreviews] = useState<Record<string, VoucherPreview>>({});
  const [voucherErrors, setVoucherErrors] = useState<Record<string, string>>({});
  const [availableVouchers, setAvailableVouchers] = useState<AvailableVoucher[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRestored = useRef(false);

  useEffect(() => {
    void refresh();
    // T-06 [V3]: kalau ada draft tersisa (dari sebelum redirect login), pulihkan alamat &
    // pilihan kurir/voucher; kalau tidak, pakai default seperti biasa.
    const draft = readDraft();
    void listAddresses().then((items) => {
      setAddresses(items);
      if (draft?.addressId && items.some((a) => a.id === draft.addressId)) {
        setAddressId(draft.addressId);
      } else {
        const def = items.find((a) => a.isDefault) ?? items[0];
        if (def) setAddressId(def.id);
      }
    });
    if (draft) {
      if (Object.keys(draft.selections).length > 0) setSelections(draft.selections);
      if (draft.platformVoucher) setPlatformVoucher(draft.platformVoucher);
      draftRestored.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Simpan draft setiap kali pilihan berubah — bukan hanya saat submit, supaya kalau session
  // habis SEBELUM sempat klik "Bayar Sekarang", draft tetap ada.
  useEffect(() => {
    if (!addressId && Object.keys(selections).length === 0) return;
    saveDraft({ addressId, selections, platformVoucher });
  }, [addressId, selections, platformVoucher]);

  const groups = useMemo(
    () => (cart?.groups ?? []).filter((g) => availableItemsOf(g).length > 0),
    [cart],
  );

  const loadRates = useCallback(
    async (currentAddressId: string) => {
      if (groups.length === 0) return;
      setRatesLoading(true);
      setError(null);
      try {
        const results = await Promise.all(
          groups.map((g) => getShippingRates({ sellerId: g.sellerId, addressId: currentAddressId })),
        );
        const nextRates: Record<string, ShippingRate[]> = {};
        results.forEach((r) => {
          nextRates[r.sellerId] = r.rates;
        });
        setRates(nextRates);
        // Kurir pilihan sebelumnya dipertahankan bila masih tersedia (mis. pulih dari draft setelah login);
        // voucher yang sudah dipakai tidak ikut hilang saat ongkir dimuat ulang.
        setSelections((prev) => {
          const next: Record<string, SellerSelection> = {};
          results.forEach((r, idx) => {
            const group = groups[idx]!;
            const before = prev[group.sellerId];
            const kept = before
              ? r.rates.find((x) => x.courierCode === before.courierCode && x.service === before.service)
              : undefined;
            const cheapest = [...r.rates].sort((a, b) => a.price - b.price)[0];
            const pick = kept ?? cheapest;
            next[group.sellerId] = {
              courierCode: pick?.courierCode ?? "",
              service: pick?.service ?? "",
              voucherCode: before?.voucherCode ?? "",
            };
          });
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal memuat ongkos kirim.");
      } finally {
        setRatesLoading(false);
      }
    },
    [groups],
  );

  useEffect(() => {
    if (addressId && groups.length > 0) void loadRates(addressId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressId, groups.length]);

  // ---------- Voucher ----------

  /** Cek ulang voucher yang sudah terpasang terhadap keranjang terkini (pulih dari draft / checkout ditolak
   * karena voucher). Yang tidak lagi valid dilepas dengan pesan jelas — bukan dibiarkan diam-diam gagal. */
  const revalidateVouchers = useCallback(async () => {
    const jobs: VoucherJob[] = [];
    for (const g of groups) {
      const code = selections[g.sellerId]?.voucherCode;
      if (code) jobs.push({ key: sellerKey(g.sellerId), code, sellerId: g.sellerId });
    }
    if (platformVoucher) jobs.push({ key: PLATFORM_KEY, code: platformVoucher });
    if (jobs.length === 0) return;

    const checks: VoucherCheck[] = await Promise.all(
      jobs.map(async (job): Promise<VoucherCheck> => {
        try {
          return { job, preview: await validateVoucher({ code: job.code, sellerId: job.sellerId }) };
        } catch (err) {
          return { job, error: err instanceof Error ? err.message : "Voucher tidak valid." };
        }
      }),
    );

    const nextPreviews: Record<string, VoucherPreview> = {};
    const nextErrors: Record<string, string> = {};
    for (const check of checks) {
      if ("preview" in check) nextPreviews[check.job.key] = check.preview;
      else nextErrors[check.job.key] = check.error;
    }
    setPreviews(nextPreviews);
    setVoucherErrors(nextErrors);
    setSelections((prev) => {
      const next = { ...prev };
      for (const check of checks) {
        const sellerId = check.job.sellerId;
        if ("error" in check && sellerId && next[sellerId]) next[sellerId] = { ...next[sellerId]!, voucherCode: "" };
      }
      return next;
    });
    if (nextErrors[PLATFORM_KEY]) setPlatformVoucher("");
  }, [groups, selections, platformVoucher]);

  const vouchersChecked = useRef(false);
  useEffect(() => {
    if (vouchersChecked.current || !hasLoaded || groups.length === 0) return;
    vouchersChecked.current = true;
    void revalidateVouchers();
  }, [hasLoaded, groups.length, revalidateVouchers]);

  useEffect(() => {
    if (!features.voucher || !hasLoaded || groups.length === 0) return;
    let cancelled = false;
    // Saran voucher bersifat tambahan: gagal memuat tidak mengganggu checkout (kode tetap bisa diketik).
    listAvailableVouchers()
      .then((res) => {
        if (!cancelled) setAvailableVouchers(res.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hasLoaded, groups.length]);

  function setSellerVoucher(sellerId: string, preview: VoucherPreview | null) {
    setSelections((prev) => ({
      ...prev,
      [sellerId]: { courierCode: "", service: "", ...prev[sellerId], voucherCode: preview?.code ?? "" },
    }));
    setPreviews((prev) => (preview ? { ...prev, [sellerKey(sellerId)]: preview } : omitKey(prev, sellerKey(sellerId))));
    setVoucherErrors((prev) => omitKey(prev, sellerKey(sellerId)));
  }

  function setPlatformVoucherPreview(preview: VoucherPreview | null) {
    setPlatformVoucher(preview?.code ?? "");
    setPreviews((prev) => (preview ? { ...prev, [PLATFORM_KEY]: preview } : omitKey(prev, PLATFORM_KEY)));
    setVoucherErrors((prev) => omitKey(prev, PLATFORM_KEY));
  }

  const shippingTotal = groups.reduce((sum, g) => {
    const sel = selections[g.sellerId];
    const rate = rates[g.sellerId]?.find((r) => r.courierCode === sel?.courierCode && r.service === sel?.service);
    return sum + (rate?.price ?? 0);
  }, 0);
  const subtotal = groups.reduce((sum, g) => sum + availableItemsOf(g).reduce((s, i) => s + i.subtotal, 0), 0);
  const discountTotal = [...groups.map((g) => sellerKey(g.sellerId)), PLATFORM_KEY].reduce(
    (sum, key) => sum + (previews[key]?.discount ?? 0),
    0,
  );
  const grandTotal = Math.max(0, subtotal + shippingTotal - discountTotal);

  const allSellersHaveCourier = groups.every((g) => selections[g.sellerId]?.courierCode);
  // Mode toko tunggal: keranjang campuran (terbentuk sebelum flag dimatikan) harus dirapikan di keranjang dulu.
  const mixedSellers = isSingleSeller && groups.length > 1;
  const showSellerHeader = !isSingleSeller || mixedSellers;
  const canSubmit =
    Boolean(addressId) && groups.length > 0 && !mixedSellers && allSellersHaveCourier && !ratesLoading && !submitting;

  async function handleSubmit() {
    if (!addressId) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload: CreateCheckoutInput = {
        addressId,
        sellers: groups.map((g) => {
          const sel = selections[g.sellerId]!;
          return {
            sellerId: g.sellerId,
            courierCode: sel.courierCode as CreateCheckoutInput["sellers"][number]["courierCode"],
            service: sel.service,
            voucherCode: sel.voucherCode || undefined,
          };
        }),
        platformVoucherCode: platformVoucher || undefined,
        // T-06 [V3]: idempotency key sama dipakai lagi bila attempt ini adalah retry —
        // backend mengembalikan checkout yang sama, bukan membuat order kedua.
        idempotencyKey: getOrCreateIdempotencyKey(),
      };
      const checkout = await submitCheckout(payload);
      // Sukses → draft & idempotency key tidak relevan lagi untuk attempt berikutnya.
      clearDraft();
      clearIdempotencyKey();
      router.push(`/checkout/${checkout.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      // T-06 [V3]: session expired di tengah submit → redirect login, draft SUDAH tersimpan
      // (efek di atas menyimpan tiap perubahan), jadi setelah login balik ke checkout dengan
      // pilihan masih ada — bukan 401 mentah atau checkout gagal diam-diam.
      if (msg.includes("401") || /unauthor/i.test(msg)) {
        router.push(`/login?next=${encodeURIComponent("/checkout")}`);
        return;
      }
      // Voucher ditolak server (kuota habis/kedaluwarsa saat submit): periksa ulang & lepas yang tidak valid.
      if (err instanceof ApiError && err.code.startsWith("VOUCHER_")) void revalidateVouchers();
      setError(msg || "Checkout gagal. Silakan coba lagi.");
      setSubmitting(false);
    }
  }

  if (!hasLoaded || addresses === null) {
    return <p className="muted">Memuat checkout...</p>;
  }

  if (groups.length === 0) {
    return (
      <div className="alert">
        <FaTriangleExclamation aria-hidden />
        <span>Keranjang Anda kosong atau semua item tidak tersedia.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">Checkout</h1>

      {mixedSellers && (
        <div className="alert" role="alert">
          <FaTriangleExclamation aria-hidden />
          <span>
            Toko ini hanya melayani satu penjual per keranjang. Kembali ke{" "}
            <Link href="/cart" className="underline">
              keranjang
            </Link>{" "}
            dan hapus produk dari toko lain.
          </span>
        </div>
      )}
      {error && (
        <div className="alert">
          <FaTriangleExclamation aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <section className="card">
        <h2 className="py-2 text-sm font-semibold text-[var(--fg)]">Alamat pengiriman</h2>
        {addresses.length === 0 && !showNewAddress && (
          <p className="muted small py-2">Anda belum punya alamat tersimpan.</p>
        )}
        <ul className="!m-0 !p-0 !shadow-none">
          {addresses.map((a) => (
            <li key={a.id}>
              <label className="flex w-full cursor-pointer items-center gap-3">
                <input type="radio" name="address" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
                <span className="flex flex-col text-sm">
                  <span className="font-medium text-[var(--fg)]">
                    {a.label} — {a.recipientName}
                  </span>
                  <span className="muted small">
                    {a.street}, {a.district}, {a.city}, {a.province} {a.postalCode}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {showNewAddress ? (
        <section className="card">
          <AddressForm
            onCreated={(id) => {
              setShowNewAddress(false);
              void listAddresses().then(setAddresses);
              setAddressId(id);
            }}
          />
        </section>
      ) : (
        <button type="button" className="btn-dashed" onClick={() => setShowNewAddress(true)}>
          + Tambah alamat baru
        </button>
      )}

      {groups.map((group) => {
        const sellerRates = rates[group.sellerId] ?? [];
        const sel = selections[group.sellerId];
        return (
          <section key={group.sellerId} className="card">
            <h2 className="py-2 text-sm font-semibold text-[var(--fg)]">
              {showSellerHeader ? group.sellerName : "Ringkasan pesanan"}
            </h2>
            <ul className="!m-0 !p-0 !shadow-none">
              {availableItemsOf(group).map((item) => (
                <li key={item.id}>
                  <span className="text-sm">
                    {item.productName} × {item.quantity}
                  </span>
                  <span className="text-sm font-medium">{formatRupiah(item.subtotal)}</span>
                </li>
              ))}
            </ul>

            <div className="field pt-2">
              <label htmlFor={`courier-${group.sellerId}`}>Kurir</label>
              {ratesLoading ? (
                <p className="muted small">Memuat ongkir...</p>
              ) : (
                <select
                  id={`courier-${group.sellerId}`}
                  value={sel ? `${sel.courierCode}::${sel.service}` : ""}
                  onChange={(e) => {
                    const [courierCode, service] = e.target.value.split("::");
                    setSelections((prev) => ({
                      ...prev,
                      [group.sellerId]: { ...prev[group.sellerId]!, courierCode: courierCode!, service: service! },
                    }));
                  }}
                >
                  {sellerRates.length === 0 && <option value="">Tidak ada kurir tersedia</option>}
                  {sellerRates.map((r) => (
                    <option key={`${r.courierCode}::${r.service}`} value={`${r.courierCode}::${r.service}`}>
                      {r.courierName} {r.serviceName} — {formatRupiah(r.price)} ({r.etd})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {features.voucher && (
              <VoucherField
                label="Voucher toko (opsional)"
                sellerId={group.sellerId}
                applied={previews[sellerKey(group.sellerId)] ?? null}
                suggestions={availableVouchers.filter((v) => v.scope === "seller" && v.sellerId === group.sellerId)}
                externalError={voucherErrors[sellerKey(group.sellerId)]}
                disabled={submitting}
                onApplied={(preview) => setSellerVoucher(group.sellerId, preview)}
                onRemoved={() => setSellerVoucher(group.sellerId, null)}
              />
            )}
          </section>
        );
      })}

      {features.voucher && (
        <section className="card">
          <VoucherField
            label="Voucher platform (opsional)"
            applied={previews[PLATFORM_KEY] ?? null}
            suggestions={availableVouchers.filter((v) => v.scope === "platform")}
            externalError={voucherErrors[PLATFORM_KEY]}
            disabled={submitting}
            onApplied={setPlatformVoucherPreview}
            onRemoved={() => setPlatformVoucherPreview(null)}
          />
        </section>
      )}

      <ul className="card">
        <li>
          <span className="muted small">Subtotal produk</span>
          <span className="text-sm">{formatRupiah(subtotal)}</span>
        </li>
        <li>
          <span className="muted small">Ongkos kirim</span>
          <span className="text-sm">{formatRupiah(shippingTotal)}</span>
        </li>
        {discountTotal > 0 && (
          <li>
            <span className="muted small">Diskon voucher</span>
            <span className="text-sm text-[var(--up)]">-{formatRupiah(discountTotal)}</span>
          </li>
        )}
        <li>
          <span className="font-semibold text-[var(--fg)]">Total</span>
          <span className="text-lg font-bold text-[var(--fg)]">{formatRupiah(grandTotal)}</span>
        </li>
      </ul>

      <button type="button" className="btn" disabled={!canSubmit} onClick={() => void handleSubmit()}>
        {submitting ? "Memproses..." : "Buat Pesanan"}
      </button>
    </div>
  );
}
