"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FaCommentDots } from "react-icons/fa6";
import type { StartConversationInput } from "@ecommerce/shared";
import { startConversation } from "@/lib/chat-api";
import { withFeature } from "@/lib/features";
import { ApiError } from "@/lib/http";
import { ChatThread } from "./chat-thread";

type Props = {
  /** Dari mana percakapan dimulai: halaman produk (productId) atau detail pesanan (orderId). */
  target: StartConversationInput;
  /** Tujuan balik setelah login bila user belum login (halaman tempat tombol ini berada). */
  loginNext: string;
  label?: string;
  className?: string;
};

/**
 * Tombol "Chat Penjual/Pembeli": membuat/membuka percakapan lalu membuka widget chat melayang di
 * halaman yang sama. Guest → login dulu dengan `next` kembali ke halaman ini.
 */
function ChatStartButtonImpl({ target, loginNext, label = "Chat Penjual", className = "btn-ghost" }: Props) {
  const router = useRouter();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc menutup widget & fokus kembali ke tombol (panel non-modal, halaman di belakangnya tetap bisa dipakai).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function handleClick() {
    if (starting) return;
    // Percakapan sudah dibuat sebelumnya → langsung buka lagi, tanpa request ulang.
    if (conversationId) return setOpen((v) => !v);

    setStarting(true);
    setError(null);
    try {
      const meta = await startConversation(target);
      setConversationId(meta.id);
      setOpen(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push(`/login?next=${encodeURIComponent(loginNext)}`);
        return;
      }
      setError(err instanceof Error ? err.message : "Gagal membuka chat. Coba lagi.");
    } finally {
      setStarting(false);
    }
  }

  const panel =
    open && conversationId
      ? createPortal(
          // Portal ke <body>: induk bertipe glass (backdrop-filter) membuat position:fixed ikut terpotong.
          <div
            id={panelId}
            role="dialog"
            aria-label="Chat"
            className="fixed inset-x-0 bottom-0 z-50 h-[min(82dvh,36rem)] overflow-hidden rounded-t-[22px] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow)] sm:inset-x-auto sm:bottom-4 sm:right-4 sm:h-[min(80dvh,34rem)] sm:w-[24rem] sm:rounded-[22px]"
          >
            <ChatThread
              conversationId={conversationId}
              variant="widget"
              autoFocus
              fullPageHref={`/chat/${encodeURIComponent(conversationId)}`}
              onClose={() => {
                setOpen(false);
                buttonRef.current?.focus();
              }}
            />
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="flex flex-col gap-1.5">
      <button
        ref={buttonRef}
        type="button"
        className={`${className} inline-flex items-center justify-center gap-2`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={starting}
        onClick={() => void handleClick()}
      >
        <FaCommentDots aria-hidden />
        {starting ? "Membuka chat..." : label}
      </button>
      {error && (
        <span role="alert" className="field-error">
          {error}
        </span>
      )}
      {panel}
    </div>
  );
}

export const ChatStartButton = withFeature("chat", ChatStartButtonImpl);
