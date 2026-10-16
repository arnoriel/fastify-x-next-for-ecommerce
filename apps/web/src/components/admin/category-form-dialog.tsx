"use client";

import { useId, useState } from "react";
import { CATEGORY_ATTR_TYPES, type AdminCategoryItem, type CreateCategoryInput } from "@ecommerce/shared";
import { Modal } from "@/components/ui/modal";
import { createCategory, updateCategory } from "@/lib/admin-api";
import { useApiErrorMessage } from "@/lib/use-api-error";

const MAX_ATTRIBUTES = 30;
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const ATTR_TYPE_LABELS = { text: "Teks", select: "Pilihan", number: "Angka" } as const;

export type CategoryDialogTarget =
  | { kind: "create"; parentId: string | null }
  | { kind: "edit"; category: AdminCategoryItem };

type AttrDraft = { key: string; label: string; type: (typeof CATEGORY_ATTR_TYPES)[number]; options: string };

/** Id kategori itu sendiri + seluruh turunannya — tidak boleh jadi parent-nya (relasi melingkar). */
function selfAndDescendants(items: AdminCategoryItem[], id: string): Set<string> {
  const blocked = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of items) {
      if (c.parentId && blocked.has(c.parentId) && !blocked.has(c.id)) {
        blocked.add(c.id);
        grew = true;
      }
    }
  }
  return blocked;
}

/** Label bertingkat untuk dropdown parent: "Fashion › Pria". */
function pathLabel(items: AdminCategoryItem[], cat: AdminCategoryItem): string {
  const parts = [cat.name];
  let cursor = cat;
  for (let i = 0; i < 10 && cursor.parentId; i += 1) {
    const parent = items.find((c) => c.id === cursor.parentId);
    if (!parent) break;
    parts.unshift(parent.name);
    cursor = parent;
  }
  return parts.join(" › ");
}

function CategoryForm({
  target,
  items,
  onClose,
  onSaved,
}: {
  target: CategoryDialogTarget;
  items: AdminCategoryItem[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const toMessage = useApiErrorMessage();
  const uid = useId();
  const editing = target.kind === "edit" ? target.category : null;

  const [name, setName] = useState(editing?.name ?? "");
  const [slug, setSlug] = useState(editing?.slug ?? "");
  const [parentId, setParentId] = useState<string>(editing ? (editing.parentId ?? "") : (target.kind === "create" ? (target.parentId ?? "") : ""));
  const [sortOrder, setSortOrder] = useState(String(editing?.sortOrder ?? 0));
  const [iconUrl, setIconUrl] = useState(editing?.iconUrl ?? "");
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [attrs, setAttrs] = useState<AttrDraft[]>(
    (editing?.attributes ?? []).map((a) => ({ key: a.key, label: a.label, type: a.type, options: (a.options ?? []).join(", ") })),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const blocked = editing ? selfAndDescendants(items, editing.id) : new Set<string>();
  const parentOptions = items.filter((c) => !blocked.has(c.id));

  function updateAttr(index: number, patch: Partial<AttrDraft>) {
    setAttrs((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
    setError(null);
  }

  function validate(): string | null {
    if (name.trim().length < 2) return "Nama kategori minimal 2 karakter.";
    const order = Number(sortOrder);
    if (!Number.isInteger(order) || order < 0 || order > 9999) return "Urutan harus bilangan bulat 0–9999.";
    if (iconUrl.trim() && !/^https?:\/\//i.test(iconUrl.trim())) return "URL ikon harus diawali http:// atau https://.";
    const seen = new Set<string>();
    for (const [i, a] of attrs.entries()) {
      const n = i + 1;
      if (!KEY_PATTERN.test(a.key.trim())) return `Atribut ${n}: key harus huruf kecil, diawali huruf, boleh angka dan underscore (mis. ukuran_layar).`;
      if (seen.has(a.key.trim())) return `Atribut ${n}: key "${a.key.trim()}" dipakai dua kali.`;
      seen.add(a.key.trim());
      if (!a.label.trim()) return `Atribut ${n}: label wajib diisi.`;
      if (a.type === "select" && splitOptions(a.options).length === 0) return `Atribut ${n}: isi minimal satu pilihan (pisahkan dengan koma).`;
    }
    return null;
  }

  async function submit() {
    if (busy) return;
    const problem = validate();
    if (problem) return setError(problem);

    const payload: CreateCategoryInput = {
      name: name.trim(),
      slug: slug.trim() || undefined,
      parentId: parentId || null,
      sortOrder: Number(sortOrder),
      iconUrl: iconUrl.trim() || null,
      attributes: attrs.map((a) => ({
        key: a.key.trim(),
        label: a.label.trim(),
        type: a.type,
        ...(a.type === "select" ? { options: splitOptions(a.options) } : {}),
      })),
    };

    setBusy(true);
    setError(null);
    try {
      if (editing) await updateCategory(editing.id, { ...payload, isActive });
      else await createCategory(payload);
      onSaved(editing ? `Kategori "${payload.name}" diperbarui.` : `Kategori "${payload.name}" ditambahkan.`);
    } catch (err) {
      // Dialog tetap terbuka dengan semua isian — admin cukup memperbaiki lalu simpan lagi.
      setError(toMessage(err, "Gagal menyimpan kategori. Coba lagi."));
      setBusy(false);
    }
  }

  return (
    <>
      <div className="form-section">
        <div className="field">
          <label htmlFor={`${uid}-name`}>Nama kategori</label>
          <input id={`${uid}-name`} value={name} maxLength={100} disabled={busy} onChange={(e) => { setName(e.target.value); setError(null); }} />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={`${uid}-parent`}>Induk kategori</label>
            <select id={`${uid}-parent`} value={parentId} disabled={busy} onChange={(e) => setParentId(e.target.value)}>
              <option value="">Tanpa induk (kategori utama)</option>
              {parentOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {pathLabel(items, c)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${uid}-order`}>Urutan tampil</label>
            <input id={`${uid}-order`} type="number" inputMode="numeric" min={0} max={9999} value={sortOrder} disabled={busy} onChange={(e) => { setSortOrder(e.target.value); setError(null); }} />
            <span className="hint">Angka kecil tampil lebih dulu.</span>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={`${uid}-slug`}>Slug (URL)</label>
            <input id={`${uid}-slug`} value={slug} maxLength={140} disabled={busy} placeholder="dibuat otomatis dari nama" onChange={(e) => { setSlug(e.target.value); setError(null); }} />
            <span className="hint">{editing ? "Mengubah slug mengubah alamat halaman kategori." : "Kosongkan agar dibuat otomatis."}</span>
          </div>
          <div className="field">
            <label htmlFor={`${uid}-icon`}>URL ikon (opsional)</label>
            <input id={`${uid}-icon`} value={iconUrl} disabled={busy} placeholder="https://..." onChange={(e) => { setIconUrl(e.target.value); setError(null); }} />
          </div>
        </div>

        {editing && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} disabled={busy} onChange={(e) => setIsActive(e.target.checked)} />
            <span>Aktif (tampil di beranda dan bisa dipilih seller)</span>
          </label>
        )}
      </div>

      <fieldset className="flex flex-col gap-3 border-0 p-0" disabled={busy}>
        <legend className="mb-1 text-sm font-bold text-[var(--fg)]">Atribut produk</legend>
        <p className="muted small">Kolom tambahan yang diisi seller saat membuat produk di kategori ini (mis. ukuran, warna).</p>
        {attrs.map((a, i) => (
          <div key={i} className="clay-inset flex flex-col gap-2 p-3">
            <div className="field-row">
              <div className="field">
                <label htmlFor={`${uid}-ak-${i}`}>Key</label>
                <input id={`${uid}-ak-${i}`} value={a.key} maxLength={50} placeholder="ukuran_layar" onChange={(e) => updateAttr(i, { key: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`${uid}-al-${i}`}>Label</label>
                <input id={`${uid}-al-${i}`} value={a.label} maxLength={100} placeholder="Ukuran layar" onChange={(e) => updateAttr(i, { label: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`${uid}-at-${i}`}>Tipe</label>
                <select id={`${uid}-at-${i}`} value={a.type} onChange={(e) => updateAttr(i, { type: e.target.value as AttrDraft["type"] })}>
                  {CATEGORY_ATTR_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ATTR_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {a.type === "select" && (
              <div className="field">
                <label htmlFor={`${uid}-ao-${i}`}>Pilihan (pisahkan dengan koma)</label>
                <input id={`${uid}-ao-${i}`} value={a.options} placeholder="S, M, L, XL" onChange={(e) => updateAttr(i, { options: e.target.value })} />
              </div>
            )}
            <button type="button" className="btn-ghost self-end !px-3 !py-1.5 text-xs" onClick={() => setAttrs((prev) => prev.filter((_, idx) => idx !== i))}>
              Hapus atribut
            </button>
          </div>
        ))}
        {attrs.length < MAX_ATTRIBUTES && (
          <button type="button" className="btn-dashed self-start" onClick={() => setAttrs((prev) => [...prev, { key: "", label: "", type: "text", options: "" }])}>
            Tambah atribut
          </button>
        )}
      </fieldset>

      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>
          Batal
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void submit()}>
          {busy ? "Menyimpan..." : "Simpan kategori"}
        </button>
      </div>
    </>
  );
}

const splitOptions = (raw: string) =>
  [...new Set(raw.split(",").map((o) => o.trim()).filter(Boolean))];

export function CategoryFormDialog({
  target,
  items,
  onClose,
  onSaved,
}: {
  target: CategoryDialogTarget | null;
  items: AdminCategoryItem[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  return (
    <Modal open={target !== null} title={target?.kind === "edit" ? "Edit kategori" : "Tambah kategori"} onClose={onClose}>
      {/* Form hanya di-mount saat dialog terbuka → state selalu mulai dari data kategori yang dipilih. */}
      {target && <CategoryForm target={target} items={items} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}
