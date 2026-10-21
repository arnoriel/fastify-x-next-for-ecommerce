/**
 * T-12: voucher. Satu sumber aturan untuk dua pemakai:
 *   - checkout (dalam transaksi, dengan row lock) → `resolveVoucher(tx, ..., { lock: true })`
 *   - preview di halaman checkout (tanpa lock, hanya baca) → `previewVoucher` / `listAvailableVouchers`
 * Error selalu HttpError berpesan jelas — kode promo tidak pernah ditolak diam-diam.
 */

import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";
import {
  type AvailableVoucher,
  type AvailableVouchersResponse,
  type ValidateVoucherInput,
  type VoucherPreview,
  availableVouchersResponseSchema,
  voucherPreviewSchema,
} from "@ecommerce/shared";
import { db, schema } from "../../db";
import { httpError } from "../../lib/http-error";
import { loadCartForCheckout, summarizeCart } from "../checkout/checkout.cart";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type VoucherRow = typeof schema.vouchers.$inferSelect;

const rupiah = (value: number) => `Rp${value.toLocaleString("id-ID")}`;
const MAX_AVAILABLE = 20;

/** Diskon yang didapat dari `subtotal`: persen (dengan batas maks) atau nominal, tidak pernah melebihi subtotal. */
export function computeDiscount(voucher: Pick<VoucherRow, "type" | "value" | "maxDiscount">, subtotal: number): number {
  const raw = voucher.type === "percent" ? Math.round((subtotal * voucher.value) / 100) : voucher.value;
  return Math.max(0, Math.min(raw, voucher.maxDiscount ?? raw, subtotal));
}

export function describeVoucher(voucher: Pick<VoucherRow, "type" | "value" | "maxDiscount" | "minPurchase">): string {
  const benefit =
    voucher.type === "percent"
      ? `Diskon ${voucher.value}%${voucher.maxDiscount ? ` (maks ${rupiah(voucher.maxDiscount)})` : ""}`
      : `Potongan ${rupiah(voucher.value)}`;
  return voucher.minPurchase > 0 ? `${benefit} · min. belanja ${rupiah(voucher.minPurchase)}` : benefit;
}

/**
 * Validasi + hitung diskon 1 voucher terhadap `subtotal`. `lock: true` (hanya di dalam transaksi
 * checkout) mengunci baris voucher: dua checkout paralel tidak bisa sama-sama lolos kuota terbatas.
 */
export async function resolveVoucher(
  executor: Tx | typeof db,
  params: { code: string; userId: string; scope: "platform" | "seller"; sellerId?: string; subtotal: number },
  { lock = false }: { lock?: boolean } = {},
) {
  const query = executor
    .select()
    .from(schema.vouchers)
    .where(sql`upper(${schema.vouchers.code}) = ${params.code.toUpperCase()}`);
  const [voucher] = lock ? await query.for("update") : await query;

  if (!voucher || !voucher.isActive) throw httpError(400, "VOUCHER_INVALID", `Voucher ${params.code} tidak valid.`);
  if (voucher.scope !== params.scope) {
    throw httpError(
      400,
      "VOUCHER_INVALID",
      params.scope === "platform"
        ? `Voucher ${params.code} adalah voucher toko — masukkan di kolom voucher toko yang sesuai.`
        : `Voucher ${params.code} adalah voucher platform — masukkan di kolom voucher platform.`,
    );
  }
  if (params.scope === "seller" && voucher.sellerId !== params.sellerId) {
    throw httpError(400, "VOUCHER_INVALID", `Voucher ${params.code} tidak berlaku untuk toko ini.`);
  }
  const now = new Date();
  if (now < voucher.startsAt) {
    throw httpError(400, "VOUCHER_NOT_STARTED", `Voucher ${params.code} belum bisa dipakai.`);
  }
  if (now > voucher.expiresAt) {
    throw httpError(400, "VOUCHER_EXPIRED", `Voucher ${params.code} sudah kedaluwarsa.`);
  }
  if (voucher.usedCount >= voucher.quota) {
    throw httpError(400, "VOUCHER_QUOTA_EXCEEDED", `Kuota voucher ${params.code} sudah habis.`);
  }
  if (params.subtotal < voucher.minPurchase) {
    throw httpError(
      400,
      "VOUCHER_MIN_PURCHASE",
      `Minimal belanja untuk voucher ${params.code} adalah ${rupiah(voucher.minPurchase)}.`,
    );
  }

  const [usage] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.voucherUsages)
    .where(and(eq(schema.voucherUsages.voucherId, voucher.id), eq(schema.voucherUsages.userId, params.userId)));
  if ((usage?.count ?? 0) >= voucher.perUserLimit) {
    throw httpError(400, "VOUCHER_LIMIT_REACHED", `Anda sudah mencapai batas pemakaian voucher ${params.code}.`);
  }

  return { voucher, discount: computeDiscount(voucher, params.subtotal) };
}

/** Preview diskon untuk kode yang diketik buyer — dihitung dari keranjang SAAT INI (item tersedia saja). */
export async function previewVoucher(userId: string, input: ValidateVoucherInput): Promise<VoucherPreview> {
  const cart = summarizeCart(await loadCartForCheckout(userId));
  if (cart.total === 0) throw httpError(400, "CART_EMPTY", "Keranjang Anda kosong atau tidak ada item yang tersedia.");

  if (input.sellerId) {
    const seller = cart.bySeller.get(input.sellerId);
    if (!seller) throw httpError(400, "SELLER_NOT_IN_CART", "Toko ini tidak ada di keranjang Anda.");
    const { voucher, discount } = await resolveVoucher(db, {
      code: input.code,
      userId,
      scope: "seller",
      sellerId: input.sellerId,
      subtotal: seller.subtotal,
    });
    return voucherPreviewSchema.parse({
      code: voucher.code,
      scope: "seller",
      sellerId: input.sellerId,
      title: describeVoucher(voucher),
      discount,
    });
  }

  const { voucher, discount } = await resolveVoucher(db, {
    code: input.code,
    userId,
    scope: "platform",
    subtotal: cart.total,
  });
  return voucherPreviewSchema.parse({
    code: voucher.code,
    scope: "platform",
    sellerId: null,
    title: describeVoucher(voucher),
    discount,
  });
}

/**
 * Voucher yang bisa dipilih buyer untuk keranjang saat ini: platform + milik toko-toko di keranjang,
 * masih berlaku, kuota tersisa, dan batas per-user belum tercapai. Yang belum memenuhi minimal belanja
 * tetap ditampilkan (eligible=false) lengkap dengan kekurangannya.
 */
export async function listAvailableVouchers(userId: string): Promise<AvailableVouchersResponse> {
  const cart = summarizeCart(await loadCartForCheckout(userId));
  if (cart.total === 0) return availableVouchersResponseSchema.parse({ items: [] });

  const now = new Date();
  const sellerIds = [...cart.bySeller.keys()];
  const rows = await db
    .select()
    .from(schema.vouchers)
    .where(
      and(
        eq(schema.vouchers.isActive, true),
        lte(schema.vouchers.startsAt, now),
        gt(schema.vouchers.expiresAt, now),
        sql`${schema.vouchers.usedCount} < ${schema.vouchers.quota}`,
        sql`(${schema.vouchers.scope} = 'platform' or ${schema.vouchers.sellerId} in ${sellerIds})`,
      ),
    )
    .limit(100);
  if (rows.length === 0) return availableVouchersResponseSchema.parse({ items: [] });

  const usages = await db
    .select({ voucherId: schema.voucherUsages.voucherId, count: sql<number>`count(*)::int` })
    .from(schema.voucherUsages)
    .where(and(eq(schema.voucherUsages.userId, userId), inArray(schema.voucherUsages.voucherId, rows.map((r) => r.id))))
    .groupBy(schema.voucherUsages.voucherId);
  const usedByUser = new Map(usages.map((u) => [u.voucherId, u.count] as const));

  const items: AvailableVoucher[] = [];
  for (const v of rows) {
    if ((usedByUser.get(v.id) ?? 0) >= v.perUserLimit) continue;
    const seller = v.sellerId ? cart.bySeller.get(v.sellerId) : undefined;
    const basis = v.scope === "seller" ? (seller?.subtotal ?? 0) : cart.total;
    const shortfall = v.minPurchase - basis;
    items.push({
      code: v.code,
      scope: v.scope,
      sellerId: v.sellerId,
      sellerName: seller?.sellerName ?? null,
      title: describeVoucher(v),
      expiresAt: v.expiresAt.toISOString(),
      eligible: shortfall <= 0,
      ineligibleReason: shortfall > 0 ? `Belanja ${rupiah(shortfall)} lagi untuk memakai voucher ini.` : null,
      estimatedDiscount: shortfall <= 0 ? computeDiscount(v, basis) : 0,
    });
  }

  // Yang bisa dipakai dulu, diskon terbesar di atas.
  items.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.estimatedDiscount - a.estimatedDiscount);
  return availableVouchersResponseSchema.parse({ items: items.slice(0, MAX_AVAILABLE) });
}
