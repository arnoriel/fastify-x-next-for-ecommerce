import { z } from "zod";

export const VOUCHER_SCOPES = ["platform", "seller"] as const;
export const voucherScopeSchema = z.enum(VOUCHER_SCOPES);
export type VoucherScope = z.infer<typeof voucherScopeSchema>;

/** Cek 1 kode voucher terhadap isi keranjang. `sellerId` terisi = kolom voucher toko, kosong = voucher platform. */
export const validateVoucherSchema = z.object({
  code: z.string().trim().min(1, "Masukkan kode voucher").max(50),
  sellerId: z.string().trim().min(1).optional(),
});
export type ValidateVoucherInput = z.infer<typeof validateVoucherSchema>;

/** Hasil validasi: diskon dihitung server dari keranjang (bukan angka dari client). Checkout tetap memvalidasi ulang. */
export const voucherPreviewSchema = z.object({
  code: z.string(),
  scope: voucherScopeSchema,
  sellerId: z.string().nullable(),
  title: z.string(),
  discount: z.number(),
});
export type VoucherPreview = z.infer<typeof voucherPreviewSchema>;

export const availableVoucherSchema = z.object({
  code: z.string(),
  scope: voucherScopeSchema,
  sellerId: z.string().nullable(),
  sellerName: z.string().nullable(),
  title: z.string(),
  expiresAt: z.iso.datetime(),
  /** false = belum memenuhi syarat (mis. kurang belanja) — tetap ditampilkan agar buyer tahu kekurangannya. */
  eligible: z.boolean(),
  ineligibleReason: z.string().nullable(),
  estimatedDiscount: z.number(),
});
export type AvailableVoucher = z.infer<typeof availableVoucherSchema>;

export const availableVouchersResponseSchema = z.object({ items: z.array(availableVoucherSchema) });
export type AvailableVouchersResponse = z.infer<typeof availableVouchersResponseSchema>;
