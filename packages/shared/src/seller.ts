import { z } from "zod";

export const SELLER_STATUSES = ["pending", "approved", "rejected", "suspended"] as const;
export const sellerStatusSchema = z.enum(SELLER_STATUSES);
export type SellerStatusValue = z.infer<typeof sellerStatusSchema>;

const idPhone = /^(?:\+?62|0)8\d{8,11}$/;

/** Dokumen opsional (KTP/NPWP) — key R2 hasil presign upload, bukan file mentah. */
export const sellerOnboardingSchema = z.object({
  storeName: z.string().trim().min(3, "Nama toko minimal 3 karakter").max(100),
  pickupContactName: z.string().trim().min(2).max(100),
  pickupPhone: z.string().trim().regex(idPhone, "Nomor HP tidak valid"),
  pickupProvince: z.string().trim().min(2).max(100),
  pickupCity: z.string().trim().min(2).max(100),
  pickupDistrict: z.string().trim().min(2).max(100),
  pickupPostalCode: z.string().trim().regex(/^\d{5}$/, "Kode pos harus 5 digit"),
  pickupStreet: z.string().trim().min(5).max(300),
  documentUrl: z.string().trim().url().nullable().optional(),
});
export type SellerOnboardingInput = z.infer<typeof sellerOnboardingSchema>;

export const sellerOnboardingStatusSchema = z.object({
  status: sellerStatusSchema,
  storeName: z.string(),
  rejectionReason: z.string().nullable(),
  submittedAt: z.iso.datetime(),
});
export type SellerOnboardingStatus = z.infer<typeof sellerOnboardingStatusSchema>;

export const rejectSellerSchema = z.object({
  reason: z.string().trim().min(5, "Alasan minimal 5 karakter").max(500),
});
export type RejectSellerInput = z.infer<typeof rejectSellerSchema>;
