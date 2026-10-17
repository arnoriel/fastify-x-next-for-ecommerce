"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FaCommentDots } from "react-icons/fa6";
import { getChatUnread } from "@/lib/chat-api";
import { ApiError } from "@/lib/http";
import { usePolling } from "@/lib/use-polling";

const POLL_MS = 20_000;

/**
 * Link ke daftar chat + badge total pesan belum dibaca (buyer & seller). Badge disegarkan tiap 20 dtk
 * saat tab terlihat dan setiap pindah halaman (mis. setelah membaca thread). Sesi habis → link disembunyikan.
 */
export function ChatNavLink({ variant = "ghost" }: { variant?: "ghost" | "tab" }) {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const [signedOut, setSignedOut] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setUnread((await getChatUnread()).unreadCount);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setSignedOut(true);
      // gagal sementara (network) → angka lama tetap, dicoba lagi di interval berikutnya
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  usePolling(() => void refresh(), POLL_MS, !signedOut);

  if (signedOut) return null;

  const active = pathname === "/chat" || pathname.startsWith("/chat/");
  const className =
    variant === "tab"
      ? active
        ? "tab tab-active relative"
        : "tab relative"
      : "btn-ghost relative inline-flex items-center justify-center gap-1.5 !px-3 !py-2.5";
  const badge = unread > 99 ? "99+" : String(unread);

  return (
    <Link
      href="/chat"
      className={className}
      aria-current={active ? "page" : undefined}
      aria-label={unread > 0 ? `Chat, ${unread} pesan belum dibaca` : "Chat"}
    >
      <FaCommentDots aria-hidden size={14} />
      <span className={variant === "ghost" ? "sr-only sm:not-sr-only" : undefined}>Chat</span>
      {unread > 0 && <span className="tab-count tab-count-alert absolute -right-2 -top-2">{badge}</span>}
    </Link>
  );
}
