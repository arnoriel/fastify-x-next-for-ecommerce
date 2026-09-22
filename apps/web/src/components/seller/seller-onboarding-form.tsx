"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { type SellerOnboardingInput, sellerOnboardingSchema } from "@ecommerce/shared";
import { submitSellerOnboarding, uploadOnboardingDocument } from "@/lib/seller-onboarding-api";

export function SellerOnboardingForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SellerOnboardingInput>();

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setFormError(null);
    try {
      const url = await uploadOnboardingDocument(file);
      setDocumentUrl(url);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal mengunggah dokumen.");
    } finally {
      setUploading(false);
    }
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const parsed = sellerOnboardingSchema.parse({ ...values, documentUrl });
      await submitSellerOnboarding(parsed);
      router.push("/seller/onboarding/status");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal mengirim pengajuan toko.");
    }
  });

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <h1>Buka Toko</h1>
      <p className="muted small">
        Lengkapi data toko kamu. Setelah dikirim, tim Admin akan meninjau pengajuan ini.
      </p>

      {formError && (
        <p className="alert" role="alert">
          {formError}
        </p>
      )}

      <div className="field">
        <label htmlFor="storeName">Nama toko</label>
        <input id="storeName" {...register("storeName")} aria-invalid={Boolean(errors.storeName)} />
        {errors.storeName && <span className="field-error">{errors.storeName.message}</span>}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="pickupContactName">Nama kontak pickup</label>
          <input id="pickupContactName" {...register("pickupContactName")} aria-invalid={Boolean(errors.pickupContactName)} />
          {errors.pickupContactName && <span className="field-error">{errors.pickupContactName.message}</span>}
        </div>
        <div className="field">
          <label htmlFor="pickupPhone">No. HP</label>
          <input
            id="pickupPhone"
            {...register("pickupPhone")}
            placeholder="08xxxxxxxxxx"
            aria-invalid={Boolean(errors.pickupPhone)}
          />
          {errors.pickupPhone && <span className="field-error">{errors.pickupPhone.message}</span>}
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="pickupProvince">Provinsi</label>
          <input id="pickupProvince" {...register("pickupProvince")} aria-invalid={Boolean(errors.pickupProvince)} />
        </div>
        <div className="field">
          <label htmlFor="pickupCity">Kota/Kabupaten</label>
          <input id="pickupCity" {...register("pickupCity")} aria-invalid={Boolean(errors.pickupCity)} />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="pickupDistrict">Kecamatan</label>
          <input id="pickupDistrict" {...register("pickupDistrict")} aria-invalid={Boolean(errors.pickupDistrict)} />
        </div>
        <div className="field">
          <label htmlFor="pickupPostalCode">Kode pos</label>
          <input id="pickupPostalCode" {...register("pickupPostalCode")} aria-invalid={Boolean(errors.pickupPostalCode)} />
          {errors.pickupPostalCode && <span className="field-error">{errors.pickupPostalCode.message}</span>}
        </div>
      </div>

      <div className="field">
        <label htmlFor="pickupStreet">Alamat pickup lengkap</label>
        <textarea id="pickupStreet" {...register("pickupStreet")} aria-invalid={Boolean(errors.pickupStreet)} />
        {errors.pickupStreet && <span className="field-error">{errors.pickupStreet.message}</span>}
      </div>

      <div className="field">
        <label htmlFor="document">Dokumen (KTP/NPWP) — opsional</label>
        <input id="document" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => void handleFileChange(e)} />
        {uploading && <span className="muted small">Mengunggah...</span>}
        {documentUrl && !uploading && <span className="muted small">Dokumen terunggah ✓</span>}
      </div>

      <div className="form-actions">
        <button type="submit" className="btn" disabled={isSubmitting || uploading}>
          {isSubmitting ? "Mengirim..." : "Kirim Pengajuan"}
        </button>
      </div>
    </form>
  );
}
