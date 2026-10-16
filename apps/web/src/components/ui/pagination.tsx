"use client";

type Props = { page: number; total: number; pageSize: number; onChange: (page: number) => void };

/** Navigasi halaman sederhana. Tidak tampil bila hanya ada satu halaman. */
export function Pagination({ page, total, pageSize, onChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  return (
    <nav aria-label="Halaman" className="flex items-center justify-between gap-3">
      <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Sebelumnya
      </button>
      <span className="muted small">
        Halaman {page} dari {totalPages}
      </span>
      <button type="button" className="btn-ghost" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Berikutnya
      </button>
    </nav>
  );
}
