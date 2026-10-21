"use client";

import {
  availableVouchersResponseSchema,
  voucherPreviewSchema,
  type AvailableVouchersResponse,
  type ValidateVoucherInput,
  type VoucherPreview,
} from "@ecommerce/shared";
import { apiRequest } from "@/lib/http";

/** Voucher yang bisa dipilih untuk keranjang saat ini (platform + toko di keranjang). */
export async function listAvailableVouchers(): Promise<AvailableVouchersResponse> {
  return availableVouchersResponseSchema.parse(await apiRequest("/api/vouchers/available"));
}

/** Cek 1 kode terhadap keranjang. Melempar ApiError berpesan jelas (kedaluwarsa, kuota habis, minimal belanja, dst). */
export async function validateVoucher(input: ValidateVoucherInput): Promise<VoucherPreview> {
  return voucherPreviewSchema.parse(
    await apiRequest("/api/vouchers/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}
