"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { FaBell } from "react-icons/fa6";
import type { NotificationView } from "@ecommerce/shared";
import { formatRelativeTime } from "@/lib/format";
import { resolveNotificationHref } from "@/lib/notification-link";
import { useNotifications } from "@/lib/use-notifications";

const ROW_CLASS =
  "flex w-full items-start gap-2.5 px-4 py-3 text-left text-inherit no-underline hover:bg-[var(--surface)] focus-visible:bg-[var(--surface)] focus-visible:outline-none";

function NotificationRow({ notification, onSelect }: { notification: NotificationView; onSelect: () => void }) {
  const href = resolveNotificationHref(notification);
  const content = (
    <>
      <span
        aria-hidden
        className={`mt-1.5 size-2 shrink-0 rounded-full ${notification.isRead ? "bg-transparent" : "bg-[var(--brand)]"}`}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`text-sm text-[var(--fg)] ${notification.isRead ? "font-medium" : "font-bold"}`}>
          {!notification.isRead && <span className="sr-only">Belum dibaca: </span>}
          {notification.title}
        </span>
        <span className="line-clamp-2 text-[0.8rem] leading-snug text-[var(--muted)]">{notification.body}</span>
        <span className="text-[0.72rem] text-[var(--muted)]">{formatRelativeTime(notification.createdAt)}</span>
      </span>
    </>
  );

  return (
    <li className="border-t border-[var(--border)] first:border-t-0">
      {href ? (
        <Link href={href} className={ROW_CLASS} onClick={onSelect}>
          {content}
        </Link>
      ) : (
        <button type="button" className={`${ROW_CLASS} cursor-pointer`} onClick={onSelect}>
          {content}
        </button>
      )}
    </li>
  );
}

function NotificationBellInner({ userId }: { userId: string }) {
  const { items, unreadCount, loadState, announcement, signedOut, refresh, markRead, markAllRead } =
    useNotifications(userId);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const pathname = usePathname();

  // Pindah halaman (link di dalam/luar dropdown) → dropdown tertutup.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (signedOut) return null;

  const badge = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="btn-ghost relative inline-flex items-center justify-center !px-3 !py-2.5"
        aria-label={unreadCount > 0 ? `Notifikasi, ${unreadCount} belum dibaca` : "Notifikasi"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (!open) void refresh(); // data segar setiap dropdown dibuka
          setOpen((v) => !v);
        }}
      >
        <FaBell aria-hidden size={15} />
        {unreadCount > 0 && <span className="tab-count tab-count-alert absolute -right-2 -top-2">{badge}</span>}
      </button>

      {/* Pembaca layar diberi tahu saat notifikasi baru masuk lewat realtime. */}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Daftar notifikasi"
          className="fixed inset-x-4 z-50 mt-2 overflow-hidden sm:absolute sm:inset-x-auto sm:right-0 sm:w-[22rem] rounded-[22px] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <h2 className="m-0 text-sm font-extrabold tracking-tight text-[var(--fg)]">Notifikasi</h2>
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-[var(--muted)] hover:text-[var(--fg)] hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
              disabled={unreadCount === 0}
              onClick={() => void markAllRead()}
            >
              Tandai semua dibaca
            </button>
          </div>

          <div className="max-h-[min(70dvh,26rem)] overflow-y-auto">
            {loadState === "loading" && <p className="muted small p-4">Memuat notifikasi...</p>}

            {loadState === "error" && (
              <div className="flex flex-col items-start gap-2 p-4">
                <p className="muted small">Notifikasi gagal dimuat.</p>
                <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => void refresh()}>
                  Coba lagi
                </button>
              </div>
            )}

            {loadState === "ready" && items.length === 0 && (
              <p className="muted small p-4">Belum ada notifikasi.</p>
            )}

            {loadState === "ready" && items.length > 0 && (
              <ul className="m-0 flex list-none flex-col p-0">
                {items.map((n) => (
                  <NotificationRow
                    key={n.id}
                    notification={n}
                    onSelect={() => {
                      void markRead(n.id);
                      setOpen(false);
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Bell + dropdown notifikasi untuk header (buyer & seller). `key` mereset state saat akun berganti. */
export function NotificationBell({ userId }: { userId: string }) {
  return <NotificationBellInner key={userId} userId={userId} />;
}
