"use client";

import Image from "next/image";
import Link from "next/link";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { FaArrowDown, FaPaperPlane, FaXmark } from "react-icons/fa6";
import { CHAT_MESSAGE_MAX, type ChatMessage, type ChatParty } from "@ecommerce/shared";
import { ErrorBanner } from "@/components/ui/error-banner";
import { type PendingMessage, useChatThread } from "@/lib/use-chat-thread";

const FALLBACK_IMAGE = "/product-placeholder.svg";
const NEAR_BOTTOM_PX = 80;
const COMPOSER_MAX_HEIGHT_PX = 120;
const COUNTER_SHOWN_FROM = Math.floor(CHAT_MESSAGE_MAX * 0.9);

const draftKey = (id: string) => `chat-draft:${id}`;
function readDraft(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(key: string, value: string) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // storage penuh / diblokir — draft tidak tersimpan, pengetikan tetap normal
  }
}

// ---------- Format waktu (WIB) ----------

const clockFormat = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });
const dayLabelFormat = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Jakarta",
});

const dayKey = (iso: string) => dayKeyFormat.format(new Date(iso));

function dayLabel(iso: string): string {
  const key = dayKey(iso);
  if (key === dayKeyFormat.format(new Date())) return "Hari ini";
  if (key === dayKeyFormat.format(new Date(Date.now() - 86_400_000))) return "Kemarin";
  return dayLabelFormat.format(new Date(iso));
}

// ---------- Baris ----------

type Row =
  | { kind: "day"; key: string; label: string }
  | { kind: "message"; key: string; message: ChatMessage }
  | { kind: "pending"; key: string; pending: PendingMessage };

function buildRows(messages: ChatMessage[], pending: PendingMessage[]): Row[] {
  const rows: Row[] = [];
  let lastDay = "";
  const pushDay = (iso: string) => {
    const key = dayKey(iso);
    if (key === lastDay) return;
    lastDay = key;
    rows.push({ kind: "day", key: `day-${key}`, label: dayLabel(iso) });
  };
  for (const message of messages) {
    pushDay(message.createdAt);
    rows.push({ kind: "message", key: message.id, message });
  }
  for (const item of pending) {
    pushDay(item.createdAt);
    rows.push({ kind: "pending", key: `pending-${item.clientId}`, pending: item });
  }
  return rows;
}

function Bubble({
  mine,
  body,
  time,
  footer,
  dimmed = false,
  failed = false,
}: {
  mine: boolean;
  body: string;
  time?: string;
  footer?: ReactNode;
  dimmed?: boolean;
  failed?: boolean;
}) {
  return (
    <li className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div
        className={`flex max-w-[85%] flex-col gap-1 rounded-[var(--radius)] px-3 py-2 ${mine ? "glass" : "clay-inset"} ${
          dimmed ? "opacity-70" : ""
        } ${failed ? "!border-[var(--danger)]" : ""}`}
      >
        <p className="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--fg)]">{body}</p>
        {time && <span className="self-end text-[0.68rem] text-[var(--muted)]">{time}</span>}
      </div>
      {footer}
    </li>
  );
}

type Props = {
  conversationId: string;
  /** page = isi halaman /chat/[id]; widget = panel melayang (tinggi mengikuti induk). */
  variant?: "page" | "widget";
  /** Tombol tutup di header (widget). */
  onClose?: () => void;
  /** Link "buka di halaman penuh" di header (widget). */
  fullPageHref?: string;
  autoFocus?: boolean;
};

export function ChatThread({ conversationId, variant = "page", onClose, fullPageHref, autoFocus = false }: Props) {
  const uid = useId();
  const {
    meta,
    messages,
    pending,
    hasMore,
    loadState,
    loadError,
    loadingOlder,
    olderError,
    live,
    reload,
    loadOlder,
    send,
    retry,
    discard,
  } = useChatThread(conversationId);

  const [draft, setDraft] = useState("");
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [announcement, setAnnouncement] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ---------- Draft (bertahan bila user tak sengaja pindah halaman) ----------

  const key = draftKey(conversationId);
  useEffect(() => {
    setDraft(readDraft(key));
    setDraftLoaded(true);
  }, [key]);
  useEffect(() => {
    if (draftLoaded) writeDraft(key, draft);
  }, [key, draft, draftLoaded]);

  // Textarea tumbuh mengikuti isi (maks beberapa baris).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
  }, [draft, loadState]);

  useEffect(() => {
    if (autoFocus && loadState === "ready" && meta?.canSend) textareaRef.current?.focus();
  }, [autoFocus, loadState, meta?.canSend]);

  // ---------- Gulir ----------

  const stickRef = useRef(true);
  const firstIdRef = useRef<string | null>(null);
  const lastKeyRef = useRef("");
  const heightRef = useRef(0);
  const viewerRole: ChatParty | undefined = meta?.viewerRole;

  const lastPending = pending[pending.length - 1];
  const lastMessage = messages[messages.length - 1];
  const lastKey = lastPending ? `p:${lastPending.clientId}` : `m:${lastMessage?.id ?? ""}`;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || loadState !== "ready") return;

    const firstId = messages[0]?.id ?? null;
    const initial = lastKeyRef.current === "";
    const prepended = !initial && firstIdRef.current !== null && firstId !== firstIdRef.current && lastKeyRef.current === lastKey;

    if (prepended) {
      // Riwayat lama dimuat di atas: posisi baca user tidak boleh loncat.
      el.scrollTop += el.scrollHeight - heightRef.current;
    } else if (initial || lastKeyRef.current !== lastKey) {
      const lastIsMine = Boolean(lastPending) || (lastMessage !== undefined && lastMessage.senderRole === viewerRole);
      if (initial || lastIsMine || stickRef.current) {
        el.scrollTop = el.scrollHeight;
      } else {
        // User sedang membaca riwayat: jangan tarik ke bawah, tawarkan lompat.
        setUnseen((n) => n + 1);
      }
      if (!initial && !lastIsMine && lastMessage) setAnnouncement(`Pesan baru: ${lastMessage.body.slice(0, 80)}`);
    }

    firstIdRef.current = firstId;
    lastKeyRef.current = lastKey;
    heightRef.current = el.scrollHeight;
  }, [messages, lastKey, lastPending, lastMessage, viewerRole, loadState]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (stickRef.current) setUnseen(0);
  }

  function jumpToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setUnseen(0);
  }

  // ---------- Kirim ----------

  function submit() {
    const text = draft.trim();
    if (!text || !meta?.canSend) return;
    // Kosongkan input SEGERA: Enter kedua tidak mengirim ulang teks yang sama.
    setDraft("");
    stickRef.current = true;
    send(text);
    textareaRef.current?.focus();
  }

  // ---------- Render ----------

  if (loadState === "error") {
    return (
      <div className="flex flex-col gap-3 p-3">
        <ErrorBanner message={loadError ?? "Gagal memuat percakapan."} onRetry={reload} />
        {onClose && (
          <button type="button" className="btn-ghost w-fit" onClick={onClose}>
            Tutup
          </button>
        )}
      </div>
    );
  }

  const frame = variant === "page" ? "glass h-[calc(100dvh-13rem)] min-h-[26rem]" : "h-full";
  const rows = buildRows(messages, pending);
  const lastOwn = [...messages].reverse().find((m) => m.senderRole === viewerRole);
  const readByCounterpart = Boolean(
    lastOwn && meta?.readByCounterpartAt && lastOwn.createdAt <= meta.readByCounterpartAt,
  );

  return (
    <div className={`flex min-h-0 flex-col overflow-hidden ${frame}`}>
      <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="m-0 truncate text-sm font-extrabold tracking-tight text-[var(--fg)]">
            {meta ? meta.counterpartName : "Memuat..."}
          </h2>
          <span className="muted small">
            {meta ? (meta.viewerRole === "buyer" ? "Penjual" : "Pembeli") : ""}
            {meta ? " · " : ""}
            {live ? "Realtime" : "Diperbarui berkala"}
          </span>
        </div>
        {fullPageHref && (
          <Link href={fullPageHref} className="btn-ghost !px-2.5 !py-1.5 text-xs">
            Buka penuh
          </Link>
        )}
        {onClose && (
          <button type="button" className="btn-ghost !px-2.5 !py-2" aria-label="Tutup chat" onClick={onClose}>
            <FaXmark aria-hidden size={13} />
          </button>
        )}
      </header>

      {meta?.product && (
        <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-4 py-2">
          <div className="clay-inset relative h-9 w-9 shrink-0 overflow-hidden !rounded-xl">
            <Image
              src={meta.product.imageUrl ?? FALLBACK_IMAGE}
              alt=""
              fill
              sizes="36px"
              className="object-cover"
              unoptimized={!meta.product.imageUrl}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="muted small">Membahas produk</span>
            {meta.product.slug ? (
              <Link
                href={`/product/${encodeURIComponent(meta.product.slug)}`}
                className="truncate text-xs font-semibold text-[var(--fg)] underline"
              >
                {meta.product.name}
              </Link>
            ) : (
              <span className="truncate text-xs font-semibold text-[var(--fg)]">{meta.product.name} (tidak tersedia)</span>
            )}
          </div>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3"
          role="log"
          aria-label="Percakapan"
          aria-busy={loadState === "loading"}
        >
          {loadState === "loading" && <p className="muted small m-auto">Memuat percakapan...</p>}

          {loadState === "ready" && hasMore && (
            <div className="flex flex-col items-center gap-1">
              <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" disabled={loadingOlder} onClick={() => void loadOlder()}>
                {loadingOlder ? "Memuat..." : "Muat pesan sebelumnya"}
              </button>
              {olderError && <span className="field-error">{olderError}</span>}
            </div>
          )}

          {loadState === "ready" && rows.length === 0 && (
            <p className="muted small m-auto text-center">
              Belum ada pesan. Tulis pesan pertama Anda
              {meta ? ` untuk ${meta.counterpartName}` : ""}.
            </p>
          )}

          <ul className="!m-0 flex list-none flex-col gap-2 !p-0 !shadow-none">
            {rows.map((row) => {
              if (row.kind === "day") {
                return (
                  <li key={row.key} className="!block !border-t-0 !p-0 py-1 text-center">
                    <span className="pill !text-[0.7rem]">{row.label}</span>
                  </li>
                );
              }
              if (row.kind === "message") {
                const m = row.message;
                const mine = m.senderRole === viewerRole;
                return (
                  <Bubble
                    key={row.key}
                    mine={mine}
                    body={m.body}
                    time={clockFormat.format(new Date(m.createdAt))}
                    footer={
                      mine && lastOwn?.id === m.id && readByCounterpart && pending.length === 0 ? (
                        <span className="mt-0.5 text-[0.68rem] text-[var(--muted)]">Dibaca</span>
                      ) : undefined
                    }
                  />
                );
              }
              const p = row.pending;
              return (
                <Bubble
                  key={row.key}
                  mine
                  body={p.body}
                  dimmed={p.status === "sending"}
                  failed={p.status === "failed"}
                  footer={
                    p.status === "sending" ? (
                      <span className="mt-0.5 text-[0.68rem] text-[var(--muted)]">Mengirim...</span>
                    ) : (
                      <span className="mt-0.5 flex flex-wrap items-center justify-end gap-x-2 text-[0.72rem]">
                        <span role="alert" className="text-[var(--danger)]">
                          {p.error ?? "Pesan gagal terkirim."}
                        </span>
                        <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-semibold underline" onClick={() => retry(p.clientId)}>
                          Kirim ulang
                        </button>
                        <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-[var(--muted)] underline" onClick={() => discard(p.clientId)}>
                          Hapus
                        </button>
                      </span>
                    )
                  }
                />
              );
            })}
          </ul>
        </div>

        {unseen > 0 && (
          <button
            type="button"
            className="btn absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 !px-3.5 !py-1.5 text-xs shadow-[var(--shadow)]"
            onClick={jumpToBottom}
          >
            <FaArrowDown aria-hidden size={11} />
            Pesan baru
          </button>
        )}
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>

      {loadState === "ready" && meta && (
        <div className="border-t border-[var(--border)] px-4 py-3">
          {meta.canSend ? (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="field min-w-0 flex-1">
                <label htmlFor={`${uid}-message`} className="sr-only">
                  Tulis pesan
                </label>
                <textarea
                  ref={textareaRef}
                  id={`${uid}-message`}
                  value={draft}
                  rows={1}
                  maxLength={CHAT_MESSAGE_MAX}
                  placeholder="Tulis pesan..."
                  className="!min-h-0 resize-none"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter kirim, Shift+Enter baris baru. Jangan ganggu IME (komposisi huruf).
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
                {draft.length >= COUNTER_SHOWN_FROM && (
                  <span className="hint">
                    {draft.length}/{CHAT_MESSAGE_MAX}
                  </span>
                )}
              </div>
              <button type="submit" className="btn flex items-center gap-1.5 !px-3.5" disabled={draft.trim().length === 0}>
                <FaPaperPlane aria-hidden size={12} />
                <span className="sr-only sm:not-sr-only">Kirim</span>
              </button>
            </form>
          ) : (
            <p className="muted small" role="status">
              {meta.sendBlockedReason ?? "Chat tidak bisa dikirim saat ini."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
