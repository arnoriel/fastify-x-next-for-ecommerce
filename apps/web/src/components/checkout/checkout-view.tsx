"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FaTriangleExclamation } from "react-icons/fa6";
import type { Address, CartGroup, CreateCheckoutInput, ShippingRate } from "@ecommerce/shared";
import { listAddresses } from "@/lib/address-api";
import { getShippingRates, submitCheckout } from "@/lib/cart-api";
import { useCartStore } from "@/lib/cart-store";
import { formatRupiah } from "@/lib/format";
import { AddressForm } from "./address-form";

type SellerSelection = { courierCode: string; service: string; voucherCode: string };

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
  const [platformVoucher, setPlatformVoucher] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
    void listAddresses().then((items) => {
      setAddresses(items);
      const def = items.find((a) => a.isDefault) ?? items[0];
      if (def) setAddressId(def.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        const nextSelections: Record<string, SellerSelection> = {};
        results.forEach((r, idx) => {
          const group = groups[idx]!;
          nextRates[r.sellerId] = r.rates;
          const cheapest = [...r.rates].sort((a, b) => a.price - b.price)[0];
          nextSelections[group.sellerId] = {
            courierCode: cheapest?.courierCode ?? "",
            service: cheapest?.service ?? "",
            voucherCode: "",
          };
        });
        setRates(nextRates);
        setSelections(nextSelections);
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

  const shippingTotal = groups.reduce((sum, g) => {
    const sel = selections[g.sellerId];
    const rate = rates[g.sellerId]?.find((r) => r.courierCode === sel?.courierCode && r.service === sel?.service);
    return sum + (rate?.price ?? 0);
  }, 0);
  const subtotal = groups.reduce((sum, g) => sum + availableItemsOf(g).reduce((s, i) => s + i.subtotal, 0), 0);
  const grandTotal = subtotal + shippingTotal;

  const allSellersHaveCourier = groups.every((g) => selections[g.sellerId]?.courierCode);
  const canSubmit = Boolean(addressId) && groups.length > 0 && allSellersHaveCourier && !ratesLoading && !submitting;

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
      };
      const checkout = await submitCheckout(payload);
      router.push(`/checkout/${checkout.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout gagal. Silakan coba lagi.");
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
            <h2 className="py-2 text-sm font-semibold text-[var(--fg)]">{group.sellerName}</h2>
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

            <div className="field pt-2">
              <label htmlFor={`voucher-${group.sellerId}`}>Kode voucher toko (opsional)</label>
              <input
                id={`voucher-${group.sellerId}`}
                value={sel?.voucherCode ?? ""}
                onChange={(e) =>
                  setSelections((prev) => ({
                    ...prev,
                    [group.sellerId]: { ...prev[group.sellerId]!, voucherCode: e.target.value },
                  }))
                }
                placeholder="Masukkan kode voucher"
              />
            </div>
          </section>
        );
      })}

      <section className="card">
        <div className="field py-2">
          <label htmlFor="platform-voucher">Kode voucher platform (opsional)</label>
          <input
            id="platform-voucher"
            value={platformVoucher}
            onChange={(e) => setPlatformVoucher(e.target.value)}
            placeholder="Masukkan kode voucher"
          />
        </div>
      </section>

      <ul className="card">
        <li>
          <span className="muted small">Subtotal produk</span>
          <span className="text-sm">{formatRupiah(subtotal)}</span>
        </li>
        <li>
          <span className="muted small">Ongkos kirim</span>
          <span className="text-sm">{formatRupiah(shippingTotal)}</span>
        </li>
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
