"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ConversationMeta } from "@ecommerce/shared";
import { getConversation, listMessages, markConversationRead, sendChatMessage } from "@/lib/chat-api";
import { ApiError } from "@/lib/http";
import { getRealtimeConfig } from "@/lib/notification-api";
import { connectConversation } from "@/lib/realtime";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { usePolling } from "@/lib/use-polling";

const FALLBACK_POLL_MS = 4_000; // realtime tidak aktif/putus: cek pesan baru tiap 4 dtk (tab terlihat)
const SAFETY_POLL_MS = 30_000; // realtime aktif: jaring pengaman bila ada event terlewat
const MAX_CATCH_UP_PAGES = 5; // batas loop sinkron setelah lama tertinggal

export type PendingMessage = {
  clientId: string;
  body: string;
  status: "sending" | "failed";
  error: string | null;
  createdAt: string;
};

export type ChatLoadState = "loading" | "ready" | "error";

/** Sisipkan pesan sesuai urutan waktu; id yang sudah ada diabaikan (event realtime + polling bisa tumpang tindih). */
function insertMessage(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (list.some((m) => m.id === message.id)) return list;
  const last = list[list.length - 1];
  if (!last || message.createdAt >= last.createdAt) return [...list, message];
  const index = list.findIndex((m) => m.createdAt > message.createdAt);
  return [...list.slice(0, index), message, ...list.slice(index)];
}

const newClientId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const isUnauthorized = (err: unknown) => err instanceof ApiError && err.status === 401;

/**
 * State 1 thread chat: meta + riwayat dari API (sumber kebenaran), didorong realtime lewat Pusher
 * (channel per percakapan); bila realtime tidak tersedia/putus otomatis polling. Kirim pesan bersifat
 * optimistik dengan clientId (kirim ulang aman), dan pesan lawan bicara otomatis ditandai terbaca
 * selama tab terlihat.
 */
export function useChatThread(conversationId: string) {
  const toMessage = useApiErrorMessage();
  const toMessageRef = useRef(toMessage);
  useEffect(() => {
    toMessageRef.current = toMessage;
  });

  const [meta, setMeta] = useState<ConversationMeta | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadState, setLoadState] = useState<ChatLoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const metaRef = useRef(meta);
  const messagesRef = useRef(messages);
  useEffect(() => {
    metaRef.current = meta;
    messagesRef.current = messages;
  });

  // ---------- Tandai dibaca ----------

  const needsReadRef = useRef(false);
  const readInFlight = useRef(false);

  const flushRead = useCallback(() => {
    if (!needsReadRef.current || readInFlight.current || document.visibilityState !== "visible") return;
    needsReadRef.current = false;
    readInFlight.current = true;
    markConversationRead(conversationId)
      .then(() => {
        readInFlight.current = false;
        // Pesan masuk saat request berjalan → tandai lagi.
        flushRead();
      })
      .catch((err: unknown) => {
        readInFlight.current = false;
        if (isUnauthorized(err)) return void toMessageRef.current(err, "");
        // Gagal sementara: dicoba lagi saat pesan baru masuk / tab kembali aktif (bukan loop langsung).
        needsReadRef.current = true;
      });
  }, [conversationId]);

  // ---------- Pesan masuk ----------

  const acceptMessages = useCallback(
    (incoming: ChatMessage[]) => {
      if (incoming.length === 0) return;
      setMessages((prev) => incoming.reduce(insertMessage, prev));

      // Pesan sendiri yang sudah terkonfirmasi server menggantikan versi optimistiknya.
      const confirmed = new Set(incoming.flatMap((m) => (m.clientId ? [m.clientId] : [])));
      if (confirmed.size > 0) setPending((prev) => prev.filter((p) => !confirmed.has(p.clientId)));

      const viewer = metaRef.current?.viewerRole;
      if (viewer && incoming.some((m) => m.senderRole !== viewer)) {
        needsReadRef.current = true;
        flushRead();
      }
    },
    [flushRead],
  );

  // ---------- Muat awal ----------

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    setLoadError(null);
    (async () => {
      try {
        const [conversation, page] = await Promise.all([getConversation(conversationId), listMessages(conversationId)]);
        if (cancelled) return;
        setMeta(conversation);
        setMessages(page.items);
        setHasMore(page.hasMore);
        setLoadState("ready");
        needsReadRef.current = conversation.unreadCount > 0;
        flushRead();
      } catch (err) {
        if (cancelled) return;
        setLoadError(toMessageRef.current(err, "Gagal memuat percakapan."));
        setLoadState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, reloadToken, flushRead]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  // ---------- Sinkron (polling / resync setelah reconnect) ----------

  const syncing = useRef(false);
  const sync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      // Kursor lokal (bukan dari state): state baru terbaca setelah render, loop tidak boleh menunggunya.
      let after = messagesRef.current[messagesRef.current.length - 1]?.id;
      for (let page = 0; page < MAX_CATCH_UP_PAGES; page += 1) {
        const res = await listMessages(conversationId, after ? { after } : {});
        acceptMessages(res.items);
        const newest = res.items[res.items.length - 1];
        if (!after || !res.hasMore || !newest) break;
        after = newest.id;
      }
      // Meta ikut disegarkan: penanda "Dibaca" & status toko (mis. dinonaktifkan admin).
      setMeta(await getConversation(conversationId));
    } catch (err) {
      // Gagal sesekali (offline/timeout) tidak mengganggu; sesi habis → arahkan ke login.
      if (isUnauthorized(err)) void toMessageRef.current(err, "");
    } finally {
      syncing.current = false;
    }
  }, [conversationId, acceptMessages]);

  const ready = loadState === "ready";
  usePolling(
    () => {
      void sync();
      flushRead();
    },
    live ? SAFETY_POLL_MS : FALLBACK_POLL_MS,
    ready,
  );

  // ---------- Realtime ----------

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let disconnect: (() => void) | undefined;

    (async () => {
      try {
        const config = await getRealtimeConfig();
        if (cancelled || !config.enabled) return;
        const cleanup = await connectConversation(conversationId, config, {
          onMessage: (message) => acceptMessages([message]),
          onRead: (event) =>
            setMeta((prev) => (prev && event.role !== prev.viewerRole ? { ...prev, readByCounterpartAt: event.at } : prev)),
          onLiveChange: setLive,
          onSubscribed: () => void sync(),
        });
        if (cancelled) cleanup();
        else disconnect = cleanup;
      } catch {
        // Realtime opsional: gagal apa pun → tetap jalan lewat polling.
      }
    })();

    return () => {
      cancelled = true;
      disconnect?.();
      setLive(false);
    };
  }, [conversationId, ready, acceptMessages, sync]);

  // ---------- Riwayat lebih lama ----------

  const loadingOlderRef = useRef(false);
  const loadOlder = useCallback(async () => {
    const oldest = messagesRef.current[0];
    if (!oldest || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const res = await listMessages(conversationId, { before: oldest.id });
      setMessages((prev) => res.items.reduce(insertMessage, prev));
      setHasMore(res.hasMore);
    } catch (err) {
      setOlderError(toMessageRef.current(err, "Gagal memuat pesan sebelumnya."));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [conversationId]);

  // ---------- Kirim ----------

  const deliver = useCallback(
    async (clientId: string, body: string) => {
      try {
        const message = await sendChatMessage(conversationId, { body, clientId });
        acceptMessages([message]);
      } catch (err) {
        if (err instanceof ApiError && err.code === "CHAT_UNAVAILABLE") {
          setMeta((prev) => (prev ? { ...prev, canSend: false, sendBlockedReason: err.message } : prev));
        }
        const error = toMessageRef.current(err, "Pesan gagal terkirim.");
        // Pesan tetap tampil sebagai "gagal" dengan opsi kirim ulang — teks user tidak hilang.
        setPending((prev) => prev.map((p) => (p.clientId === clientId ? { ...p, status: "failed", error } : p)));
      }
    },
    [conversationId, acceptMessages],
  );

  const send = useCallback(
    (rawBody: string) => {
      const body = rawBody.trim();
      if (!body) return;
      const clientId = newClientId();
      setPending((prev) => [
        ...prev,
        { clientId, body, status: "sending", error: null, createdAt: new Date().toISOString() },
      ]);
      void deliver(clientId, body);
    },
    [deliver],
  );

  /** Kirim ulang dengan clientId SAMA: bila request sebelumnya sebenarnya sudah masuk, server tidak menggandakan. */
  const retry = useCallback(
    (clientId: string) => {
      const target = pending.find((p) => p.clientId === clientId);
      if (!target || target.status === "sending") return;
      setPending((prev) => prev.map((p) => (p.clientId === clientId ? { ...p, status: "sending", error: null } : p)));
      void deliver(clientId, target.body);
    },
    [pending, deliver],
  );

  const discard = useCallback((clientId: string) => {
    setPending((prev) => prev.filter((p) => p.clientId !== clientId));
  }, []);

  return {
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
  };
}
