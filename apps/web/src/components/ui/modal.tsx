"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

type Props = {
  open: boolean;
  title: string;
  /** Aksi sedang berjalan: dialog tidak bisa ditutup (Esc/backdrop/tombol) agar tidak kehilangan proses. */
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
};

/** Dialog form berbasis <dialog> native (focus trap, Esc, backdrop). Isi bebas; konfirmasi singkat pakai ConfirmDialog. */
export function Modal({ open, title, busy = false, onClose, children }: Props) {
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
      className="m-auto max-h-[90dvh] w-[min(94vw,560px)] overflow-y-auto rounded-[22px] border border-[var(--border)] bg-[var(--card)] p-0 text-[var(--fg)] shadow-[var(--shadow)] backdrop:bg-black/50 backdrop:backdrop-blur-sm"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      {open && (
        <div className="flex flex-col gap-4 p-5">
          <h2 id={titleId} className="text-lg font-extrabold tracking-tight">
            {title}
          </h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
