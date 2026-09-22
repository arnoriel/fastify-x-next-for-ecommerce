"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { type CreateAddressInput, createAddressSchema } from "@ecommerce/shared";
import { createAddress } from "@/lib/address-api";

export function AddressForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateAddressInput>({ defaultValues: { label: "Rumah", isDefault: true } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const parsed = createAddressSchema.parse(values);
      const address = await createAddress(parsed);
      onCreated(address.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan alamat.");
    }
  });

  return (
    <form className="form-section" onSubmit={onSubmit}>
      {formError && <p className="field-error">{formError}</p>}
      <div className="field-row">
        <div className="field">
          <label htmlFor="label">Label</label>
          <input id="label" {...register("label")} placeholder="Rumah / Kantor" />
        </div>
        <div className="field">
          <label htmlFor="recipientName">Nama penerima</label>
          <input id="recipientName" {...register("recipientName")} aria-invalid={Boolean(errors.recipientName)} />
          {errors.recipientName && <span className="field-error">{errors.recipientName.message}</span>}
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="phone">No. HP</label>
          <input id="phone" {...register("phone")} placeholder="08xxxxxxxxxx" aria-invalid={Boolean(errors.phone)} />
          {errors.phone && <span className="field-error">{errors.phone.message}</span>}
        </div>
        <div className="field">
          <label htmlFor="postalCode">Kode pos</label>
          <input id="postalCode" {...register("postalCode")} aria-invalid={Boolean(errors.postalCode)} />
          {errors.postalCode && <span className="field-error">{errors.postalCode.message}</span>}
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="province">Provinsi</label>
          <input id="province" {...register("province")} aria-invalid={Boolean(errors.province)} />
        </div>
        <div className="field">
          <label htmlFor="city">Kota/Kabupaten</label>
          <input id="city" {...register("city")} aria-invalid={Boolean(errors.city)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="district">Kecamatan</label>
        <input id="district" {...register("district")} aria-invalid={Boolean(errors.district)} />
      </div>
      <div className="field">
        <label htmlFor="street">Alamat lengkap</label>
        <textarea id="street" {...register("street")} aria-invalid={Boolean(errors.street)} />
        {errors.street && <span className="field-error">{errors.street.message}</span>}
      </div>
      <div className="form-actions">
        <button type="submit" className="btn" disabled={isSubmitting}>
          {isSubmitting ? "Menyimpan..." : "Simpan & gunakan alamat ini"}
        </button>
      </div>
    </form>
  );
}
