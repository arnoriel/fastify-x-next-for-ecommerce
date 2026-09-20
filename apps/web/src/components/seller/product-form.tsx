"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import {
  type CreateProductInput,
  createProductSchema,
  type ProductWithVariants,
  updateProductSchema,
} from "@ecommerce/shared";
import { createProduct, updateProduct, uploadProductImage } from "@/lib/seller-api";

type CategoryOption = { id: string; name: string };
// Superset create+update: field `id` opsional per varian dipakai saat edit untuk menandai varian existing.
type FormValues = Omit<CreateProductInput, "variants"> & {
  variants: (CreateProductInput["variants"][number] & { id?: string })[];
};

const emptyVariant = { name: "", options: {}, price: 0, stock: 0 };

function toDefaultValues(product?: ProductWithVariants, firstCategoryId = ""): FormValues {
  if (!product) {
    return {
      categoryId: firstCategoryId,
      name: "",
      description: "",
      images: [],
      attributes: {},
      weightGram: 500,
      variants: [emptyVariant],
    };
  }
  return {
    categoryId: product.categoryId,
    name: product.name,
    description: product.description,
    images: product.images,
    attributes: product.attributes,
    weightGram: product.weightGram,
    lengthCm: product.lengthCm ?? undefined,
    widthCm: product.widthCm ?? undefined,
    heightCm: product.heightCm ?? undefined,
    variants: product.variants.map((v) => ({
      id: v.id,
      sku: v.sku ?? undefined,
      name: v.name,
      options: v.options,
      price: v.price,
      stock: v.stock,
      weightGram: v.weightGram ?? undefined,
      imageUrl: v.imageUrl ?? undefined,
    })) as FormValues["variants"],
  };
}

/** Path Zod issue (mis. ["variants", 0, "name"]) → path RHF ("variants.0.name"). */
function issuePathToFieldName(path: readonly PropertyKey[]): string {
  return path.map(String).join(".");
}

export function ProductForm({
  categories,
  product,
}: {
  categories: CategoryOption[];
  /** Diisi = mode edit; kosong = mode tambah produk baru. */
  product?: ProductWithVariants;
}) {
  const router = useRouter();
  const isEdit = Boolean(product);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    // SENGAJA tanpa `resolver` (zodResolver). Validasi dijalankan manual di onSubmit lewat
    // safeParse — integrasi zodResolver langsung terbukti rapuh terhadap Turbopack Fast
    // Refresh di dev (module Zod ter-reload di tengah render, error lolos mentah ke Next.js
    // overlay alih-alih masuk ke `errors`). safeParse manual tidak punya masalah ini karena
    // tidak bergantung ke lifecycle resolver RHF sama sekali.
    defaultValues: toDefaultValues(product, categories[0]?.id ?? ""),
  });

  const { fields, append, remove } = useFieldArray({ control, name: "variants" });
  const images = watch("images");

  async function onPickImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setFormError(null);
    try {
      const url = await uploadProductImage(file);
      setValue("images", [...images, url]);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Upload gambar gagal.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  function removeImage(url: string) {
    setValue(
      "images",
      images.filter((i) => i !== url),
    );
  }

  async function onSubmit(raw: FormValues) {
    setFormError(null);
    clearErrors();

    const schema = isEdit ? updateProductSchema : createProductSchema;
    const parsed = schema.safeParse(raw);

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        setError(issuePathToFieldName(issue.path) as never, { type: "manual", message: issue.message });
      }
      setFormError("Periksa kembali isian yang ditandai di bawah.");
      return;
    }

    try {
      const saved = isEdit ? await updateProduct(product!.id, parsed.data) : await createProduct(parsed.data);
      router.push(`/seller/products/${saved.id}`);
      router.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan produk.");
    }
  }

  const busy = isSubmitting || uploading;

  return (
    <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      <header className="form-header">
        <h1>{isEdit ? "Edit produk" : "Tambah produk"}</h1>
        <p className="muted">Lengkapi detail produk dan minimal satu varian sebelum menyimpan.</p>
      </header>

      {formError && (
        <p className="alert" role="alert">
          {formError}
        </p>
      )}

      <section className="form-section">
        <div className="field">
          <label htmlFor="name">Nama produk</label>
          <input
            id="name"
            placeholder="Contoh: Kaos Polos Cotton Combed 30s"
            {...register("name")}
            aria-invalid={Boolean(errors.name)}
          />
          {errors.name && <span className="field-error">{errors.name.message}</span>}
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="categoryId">Kategori</label>
            <select id="categoryId" {...register("categoryId")} aria-invalid={Boolean(errors.categoryId)}>
              {categories.length === 0 && <option value="">Kategori belum tersedia</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {errors.categoryId && <span className="field-error">{errors.categoryId.message}</span>}
          </div>

          <div className="field">
            <label htmlFor="weightGram">Berat (gram)</label>
            <input
              id="weightGram"
              type="number"
              inputMode="numeric"
              min={1}
              {...register("weightGram", { valueAsNumber: true })}
              aria-invalid={Boolean(errors.weightGram)}
            />
            {errors.weightGram ? (
              <span className="field-error">{errors.weightGram.message}</span>
            ) : (
              <span className="hint">Dipakai untuk menghitung ongkos kirim.</span>
            )}
          </div>
        </div>

        <div className="field">
          <label htmlFor="description">Deskripsi</label>
          <textarea
            id="description"
            rows={5}
            placeholder="Jelaskan bahan, ukuran, dan keunggulan produk."
            {...register("description")}
          />
        </div>
      </section>

      <hr className="form-divider" />

      <section className="form-section">
        <div className="field">
          <label htmlFor="image-upload">Gambar produk</label>
          <label className="upload" htmlFor="image-upload" data-busy={uploading}>
            <span>
              {uploading ? "Mengupload…" : <><strong>Pilih gambar</strong> — JPG, PNG, atau WEBP</>}
            </span>
            <input
              id="image-upload"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={onPickImage}
              disabled={uploading}
            />
          </label>
          {images.length > 0 && (
            <ul className="image-preview-list">
              {images.map((url) => (
                <li key={url}>
                  <img src={url} alt="" />
                  <button
                    type="button"
                    className="image-remove"
                    onClick={() => removeImage(url)}
                    aria-label="Hapus gambar"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <hr className="form-divider" />

      <fieldset className="variant-set">
        <legend>Varian</legend>
        {errors.variants?.message && <span className="field-error">{errors.variants.message}</span>}

        {fields.map((field, index) => (
          <div key={field.id} className="variant-row">
            <div className="variant-head">
              <span>Varian {index + 1}</span>
              {fields.length > 1 && (
                <button type="button" className="btn-link" onClick={() => remove(index)}>
                  Hapus
                </button>
              )}
            </div>

            <div className="field">
              <label htmlFor={`variants.${index}.name`}>Nama varian</label>
              <input
                id={`variants.${index}.name`}
                {...register(`variants.${index}.name` as const)}
                placeholder="Contoh: Merah / XL"
                aria-invalid={Boolean(errors.variants?.[index]?.name)}
              />
              {errors.variants?.[index]?.name && (
                <span className="field-error">{errors.variants[index]?.name?.message}</span>
              )}
            </div>

            <div className="field">
              <label htmlFor={`variants.${index}.price`}>Harga (Rp)</label>
              <input
                id={`variants.${index}.price`}
                type="number"
                inputMode="numeric"
                min={0}
                {...register(`variants.${index}.price` as const, { valueAsNumber: true })}
                aria-invalid={Boolean(errors.variants?.[index]?.price)}
              />
              {errors.variants?.[index]?.price && (
                <span className="field-error">{errors.variants[index]?.price?.message}</span>
              )}
            </div>

            <div className="field">
              <label htmlFor={`variants.${index}.stock`}>Stok</label>
              <input
                id={`variants.${index}.stock`}
                type="number"
                inputMode="numeric"
                min={0}
                {...register(`variants.${index}.stock` as const, { valueAsNumber: true })}
                aria-invalid={Boolean(errors.variants?.[index]?.stock)}
              />
              {errors.variants?.[index]?.stock && (
                <span className="field-error">{errors.variants[index]?.stock?.message}</span>
              )}
            </div>
          </div>
        ))}

        <button type="button" className="btn-dashed" onClick={() => append(emptyVariant)}>
          + Tambah varian
        </button>
      </fieldset>

      <div className="form-actions">
        <button type="button" className="btn-ghost" onClick={() => router.back()} disabled={busy}>
          Batal
        </button>
        <button className="btn" type="submit" disabled={busy}>
          {isSubmitting ? "Menyimpan…" : isEdit ? "Simpan perubahan" : "Simpan produk"}
        </button>
      </div>
    </form>
  );
}