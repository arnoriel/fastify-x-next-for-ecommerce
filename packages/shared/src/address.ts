import { z } from "zod";

const idPhone = /^(?:\+?62|0)8\d{8,11}$/;

export const addressSnapshotSchema = z.object({
  recipientName: z.string(),
  phone: z.string(),
  province: z.string(),
  city: z.string(),
  district: z.string(),
  postalCode: z.string(),
  street: z.string(),
  biteshipAreaId: z.string().nullable().optional(),
});
export type AddressSnapshotInput = z.infer<typeof addressSnapshotSchema>;

export const createAddressSchema = z.object({
  label: z.string().trim().min(1).max(50).default("Rumah"),
  recipientName: z.string().trim().min(2).max(100),
  phone: z.string().trim().regex(idPhone, "Nomor HP tidak valid"),
  province: z.string().trim().min(2).max(100),
  city: z.string().trim().min(2).max(100),
  district: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().regex(/^\d{5}$/, "Kode pos harus 5 digit"),
  street: z.string().trim().min(5).max(300),
  biteshipAreaId: z.string().trim().nullable().optional(),
  isDefault: z.boolean().default(false),
});
export type CreateAddressInput = z.infer<typeof createAddressSchema>;

export const updateAddressSchema = createAddressSchema.partial();
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;

export const addressSchema = z.object({
  id: z.string(),
  label: z.string(),
  recipientName: z.string(),
  phone: z.string(),
  province: z.string(),
  city: z.string(),
  district: z.string(),
  postalCode: z.string(),
  street: z.string(),
  biteshipAreaId: z.string().nullable(),
  isDefault: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Address = z.infer<typeof addressSchema>;
