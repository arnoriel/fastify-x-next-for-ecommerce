"use client";

import { useMemo, useState } from "react";
import { FaFolderOpen } from "react-icons/fa6";
import type { AdminCategoryItem } from "@ecommerce/shared";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner } from "@/components/ui/error-banner";
import { deleteCategory, listAdminCategories, updateCategory } from "@/lib/admin-api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useRemoteData } from "@/lib/use-remote-data";
import { CategoryFormDialog, type CategoryDialogTarget } from "./category-form-dialog";

const REFRESH_MS = 60_000;

type Row = { cat: AdminCategoryItem; depth: number };

/** Urutkan sebagai pohon (induk lalu anak-anaknya); kategori yatim (induk hilang) tetap ditampilkan di akhir. */
function flatten(items: AdminCategoryItem[]): Row[] {
  const byParent = new Map<string | null, AdminCategoryItem[]>();
  for (const c of items) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
  const rows: Row[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const c of byParent.get(parentId) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      rows.push({ cat: c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const c of items) if (!seen.has(c.id)) rows.push({ cat: c, depth: 0 });
  return rows;
}

function deleteBlocker(c: AdminCategoryItem): string | null {
  if (c.childCount > 0) return `Masih punya ${c.childCount} sub-kategori`;
  if (c.productCount > 0) return `Masih dipakai ${c.productCount} produk`;
  return null;
}

export function CategoriesView() {
  const toMessage = useApiErrorMessage();
  const [dialog, setDialog] = useState<CategoryDialogTarget | null>(null);
  const [deleting, setDeleting] = useState<AdminCategoryItem | null>(null);
  const [deactivating, setDeactivating] = useState<AdminCategoryItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, error, reload, retry } = useRemoteData(listAdminCategories, {
    errorMessage: "Gagal memuat kategori.",
    pollMs: REFRESH_MS,
    paused: dialog !== null || busyId !== null || deleting !== null || deactivating !== null,
  });

  const rows = useMemo(() => (data ? flatten(data.items) : []), [data]);

  async function mutate(id: string, run: () => Promise<unknown>, success: string, fallback: string) {
    if (busyId) return;
    setBusyId(id);
    setNotice(null);
    setActionError(null);
    try {
      await run();
      setNotice(success);
    } catch (err) {
      setActionError(toMessage(err, fallback));
    } finally {
      setBusyId(null);
      setDeleting(null);
      setDeactivating(null);
      void reload();
    }
  }

  const toggleActive = (c: AdminCategoryItem) =>
    mutate(
      c.id,
      () => updateCategory(c.id, { isActive: !c.isActive }),
      c.isActive ? `Kategori "${c.name}" dinonaktifkan.` : `Kategori "${c.name}" diaktifkan.`,
      "Gagal mengubah status kategori.",
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">Kelola Kategori</h1>
        <button type="button" className="btn" onClick={() => setDialog({ kind: "create", parentId: null })}>
          Tambah kategori
        </button>
      </div>

      {notice && (
        <p role="status" className="glass p-3 text-sm font-semibold text-[var(--up)]">
          {notice}
        </p>
      )}
      {actionError && <ErrorBanner message={actionError} />}
      {error && <ErrorBanner message={error} onRetry={retry} />}
      {!data && !error && <p className="muted" aria-busy="true">Memuat kategori...</p>}

      {data && rows.length === 0 && (
        <div className="glass flex flex-col items-center gap-2 p-10 text-center">
          <FaFolderOpen aria-hidden className="text-2xl text-[var(--muted)]" />
          <p className="font-semibold text-[var(--fg)]">Belum ada kategori</p>
          <p className="text-sm text-[var(--muted)]">Tambahkan kategori pertama supaya seller bisa mengelompokkan produknya.</p>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="!m-0 flex flex-col gap-2 !p-0 !shadow-none">
          {rows.map(({ cat, depth }) => {
            const blocker = deleteBlocker(cat);
            const busy = busyId === cat.id;
            return (
              <li key={cat.id} className="card !block !p-3" style={{ marginLeft: `${Math.min(depth, 4) * 1.25}rem` }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-[var(--fg)]">{cat.name}</span>
                      <span className={cat.isActive ? "pill" : "pill !text-[var(--muted)]"}>{cat.isActive ? "Aktif" : "Nonaktif"}</span>
                    </span>
                    <span className="muted small">
                      /{cat.slug} · {cat.productCount} produk · {cat.childCount} sub-kategori · {cat.attributes.length} atribut
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busyId !== null} onClick={() => setDialog({ kind: "create", parentId: cat.id })}>
                      Sub-kategori
                    </button>
                    <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busyId !== null} onClick={() => setDialog({ kind: "edit", category: cat })}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-ghost !px-3 !py-1.5 text-xs"
                      disabled={busyId !== null}
                      onClick={() => (cat.isActive && cat.productCount > 0 ? setDeactivating(cat) : void toggleActive(cat))}
                    >
                      {busy ? "Menyimpan..." : cat.isActive ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost !px-3 !py-1.5 text-xs"
                      disabled={busyId !== null || blocker !== null}
                      title={blocker ? `Tidak bisa dihapus: ${blocker}. Nonaktifkan bila ingin menyembunyikannya.` : undefined}
                      onClick={() => setDeleting(cat)}
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CategoryFormDialog
        target={dialog}
        items={data?.items ?? []}
        onClose={() => setDialog(null)}
        onSaved={(message) => {
          setDialog(null);
          setNotice(message);
          setActionError(null);
          void reload();
        }}
      />

      <ConfirmDialog
        open={deactivating !== null}
        title="Nonaktifkan kategori?"
        description={`"${deactivating?.name ?? ""}" disembunyikan dari beranda dan tidak bisa dipilih untuk produk baru. ${deactivating?.productCount ?? 0} produk di dalamnya tetap ada.`}
        confirmLabel="Ya, nonaktifkan"
        busy={busyId !== null}
        onConfirm={() => deactivating && void toggleActive(deactivating)}
        onCancel={() => setDeactivating(null)}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Hapus kategori?"
        description={`"${deleting?.name ?? ""}" akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.`}
        confirmLabel="Ya, hapus"
        busy={busyId !== null}
        onConfirm={() =>
          deleting && void mutate(deleting.id, () => deleteCategory(deleting.id), `Kategori "${deleting.name}" dihapus.`, "Gagal menghapus kategori.")
        }
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
