"use client";

import { useEffect, useId, useRef } from "react";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Aksi sedang berjalan: tombol dinonaktifkan dan dialog tidak bisa ditutup. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Dialog konfirmasi berbasis <dialog> native: focus trap, Esc, dan backdrop bawaan browser. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Ya, lanjutkan",
  cancelLabel = "Batal",
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="m-auto w-[min(92vw,420px)] rounded-[22px] border border-[var(--border)] bg-[var(--card)] p-0 text-[var(--fg)] shadow-[var(--shadow)] backdrop:bg-black/50 backdrop:backdrop-blur-sm"
      onCancel={(e) => {
        // Esc: state `open` dikendalikan parent, jangan biarkan browser menutup sendiri.
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="flex flex-col gap-4 p-5">
        <h2 id={titleId} className="text-lg font-extrabold tracking-tight">
          {title}
        </h2>
        <p className="muted text-sm leading-relaxed">{description}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={onConfirm}>
            {busy ? "Menyimpan..." : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
