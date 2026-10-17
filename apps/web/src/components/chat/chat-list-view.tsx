"use client";

import Link from "next/link";
import { useCallback, useEffect } from "react";
import type { ConversationSummary } from "@ecommerce/shared";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Pagination } from "@/components/ui/pagination";
import { listConversations } from "@/lib/chat-api";
import { formatRelativeTime } from "@/lib/format";
import { usePaged } from "@/lib/use-paged";
import { useRemoteData } from "@/lib/use-remote-data";

const PAGE_SIZE = 20;
const REFRESH_MS = 10_000;

function ConversationRow({ conversation: c }: { conversation: ConversationSummary }) {
  const unread = c.unreadCount > 0;
  return (
    <li className="card !block !p-0">
      <Link href={`/chat/${encodeURIComponent(c.id)}`} className="flex flex-col gap-1 p-4 text-inherit no-underline">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-bold text-[var(--fg)]">{c.counterpartName}</span>
            <span className="pill !text-[0.68rem]">{c.viewerRole === "buyer" ? "Toko" : "Pembeli"}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="muted small">{formatRelativeTime(c.lastMessageAt)}</span>
            {unread && (
              <span className="tab-count tab-count-alert" aria-label={`${c.unreadCount} pesan belum dibaca`}>
                {c.unreadCount > 99 ? "99+" : c.unreadCount}
              </span>
            )}
          </span>
        </div>
        <span className={`line-clamp-2 text-sm ${unread ? "font-semibold text-[var(--fg)]" : "text-[var(--muted)]"}`}>
          {c.lastMessage.mine ? "Anda: " : ""}
          {c.lastMessage.body}
        </span>
        {c.productName && <span className="muted small truncate">Produk: {c.productName}</span>}
      </Link>
    </li>
  );
}

/** Daftar percakapan user (sebagai pembeli dan/atau penjual), terbaru di atas. */
export function ChatListView() {
  const [page, setPage] = usePaged("all");
  const fetcher = useCallback(() => listConversations({ page, pageSize: PAGE_SIZE }), [page]);
  const { data, error, retry } = useRemoteData(fetcher, { errorMessage: "Gagal memuat percakapan.", pollMs: REFRESH_MS });

  // Halaman terakhir menjadi kosong (percakapan berkurang) → mundur ke halaman yang masih ada.
  useEffect(() => {
    if (data && data.items.length === 0 && data.page > 1) setPage(Math.ceil(data.total / data.pageSize));
  }, [data, setPage]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">Chat</h1>
        {data && data.unreadTotal > 0 && <span className="muted small">{data.unreadTotal} pesan belum dibaca</span>}
      </div>

      {error && <ErrorBanner message={error} onRetry={retry} />}
      {!error && !data && (
        <p className="muted" aria-busy="true">
          Memuat percakapan...
        </p>
      )}

      {data && data.items.length === 0 && !error && (
        <div className="glass flex flex-col items-center gap-2 p-8 text-center">
          <p className="font-semibold text-[var(--fg)]">Belum ada percakapan</p>
          <p className="muted small">Mulai chat lewat tombol &ldquo;Chat Penjual&rdquo; di halaman produk atau detail pesanan.</p>
          <Link href="/" className="btn-ghost mt-1">
            Jelajahi produk
          </Link>
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <ul className="!m-0 flex list-none flex-col gap-3 !p-0 !shadow-none">
            {data.items.map((c) => (
              <ConversationRow key={c.id} conversation={c} />
            ))}
          </ul>
          <Pagination page={data.page} total={data.total} pageSize={data.pageSize} onChange={setPage} />
        </>
      )}
    </div>
  );
}
