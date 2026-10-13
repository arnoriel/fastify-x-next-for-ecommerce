"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationView } from "@ecommerce/shared";
import { ApiError } from "@/lib/http";
import {
  getNotificationPulse,
  getRealtimeConfig,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notification-api";
import { connectUserNotifications } from "@/lib/realtime";
import { usePolling } from "@/lib/use-polling";

const MAX_ITEMS = 30; // sama dengan limit API
const FALLBACK_POLL_MS = 10_000; // realtime tidak aktif/putus: cek denyut tiap 10 dtk
const SAFETY_POLL_MS = 30_000; // realtime aktif: jaring pengaman bila ada event terlewat

type State = { items: NotificationView[]; unreadCount: number };
export type NotificationLoadState = "loading" | "ready" | "error";

const isUnauthorized = (err: unknown) => err instanceof ApiError && err.status === 401;

/**
 * State bell notifikasi: daftar + unread count dari API (sumber kebenaran), didorong realtime lewat
 * Pusher; bila realtime tidak tersedia/putus otomatis polling. Aksi baca bersifat optimistik dan
 * menyinkronkan ulang dari server bila gagal.
 */
export function useNotifications(userId: string) {
  const [state, setState] = useState<State>({ items: [], unreadCount: 0 });
  const [loadState, setLoadState] = useState<NotificationLoadState>("loading");
  const [live, setLive] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const stateRef = useRef(state);
  const loadStateRef = useRef(loadState);
  useEffect(() => {
    stateRef.current = state;
    loadStateRef.current = loadState;
  });

  // Mengabaikan respons basi: refresh yang berangkat sebelum aksi baca tidak boleh menimpa hasilnya.
  const requestId = useRef(0);
  // Event realtime yang masuk saat refresh berjalan bisa tidak ada di snapshot refresh itu →
  // tandai, lalu ulangi refresh begitu selesai supaya notifikasi baru tidak hilang dari list.
  const inFlight = useRef(false);
  const resyncAfter = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) {
      resyncAfter.current = true;
      return;
    }
    inFlight.current = true;
    const id = ++requestId.current;
    try {
      const res = await listNotifications();
      if (id !== requestId.current) return;
      setState({ items: res.items, unreadCount: res.unreadCount });
      setLoadState("ready");
    } catch (err) {
      if (id !== requestId.current) return;
      // Sesi habis: bell berhenti diam-diam; guard halaman yang mengarahkan ke login saat navigasi.
      if (isUnauthorized(err)) return setSignedOut(true);
      // Gagal saat polling tidak menghapus data yang sudah tampil.
      setLoadState((prev) => (prev === "ready" ? prev : "error"));
    } finally {
      inFlight.current = false;
      if (resyncAfter.current) {
        resyncAfter.current = false;
        void refresh();
      }
    }
  }, []);

  const handleIncoming = useCallback((incoming: NotificationView) => {
    setState((prev) =>
      prev.items.some((n) => n.id === incoming.id)
        ? prev
        : {
            items: [incoming, ...prev.items].slice(0, MAX_ITEMS),
            unreadCount: prev.unreadCount + (incoming.isRead ? 0 : 1),
          },
    );
    setAnnouncement(`Notifikasi baru: ${incoming.title}`);
    if (inFlight.current) resyncAfter.current = true;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (signedOut) return;
    let cancelled = false;
    let disconnect: (() => void) | undefined;

    (async () => {
      try {
        const config = await getRealtimeConfig();
        if (cancelled || !config.enabled) return;
        const cleanup = await connectUserNotifications(userId, config, {
          onNotification: handleIncoming,
          onLiveChange: setLive,
          onSubscribed: () => void refresh(),
        });
        if (cancelled) cleanup();
        else disconnect = cleanup;
      } catch (err) {
        // Realtime opsional: gagal apa pun → tetap jalan lewat polling.
        if (isUnauthorized(err)) setSignedOut(true);
      }
    })();

    return () => {
      cancelled = true;
      disconnect?.();
      setLive(false);
    };
  }, [userId, signedOut, handleIncoming, refresh]);

  // Polling = cek denyut murah (unread count + id terbaru); list lengkap hanya ditarik bila berubah
  // — atau bila load sebelumnya belum berhasil, supaya state error pulih sendiri.
  const poll = useCallback(async () => {
    if (loadStateRef.current !== "ready") return refresh();
    try {
      const pulse = await getNotificationPulse();
      const current = stateRef.current;
      if (pulse.unreadCount !== current.unreadCount || pulse.latestId !== (current.items[0]?.id ?? null)) {
        await refresh();
      }
    } catch (err) {
      if (isUnauthorized(err)) setSignedOut(true);
      // gagal sementara (network) → coba lagi di interval berikutnya
    }
  }, [refresh]);

  usePolling(() => void poll(), live ? SAFETY_POLL_MS : FALLBACK_POLL_MS, !signedOut);

  const markRead = useCallback(
    async (id: string) => {
      const target = stateRef.current.items.find((n) => n.id === id);
      if (!target || target.isRead) return;
      requestId.current++;
      setState((prev) => ({
        items: prev.items.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
        unreadCount: Math.max(0, prev.unreadCount - 1),
      }));
      try {
        await markNotificationRead(id);
      } catch (err) {
        if (isUnauthorized(err)) setSignedOut(true);
        else void refresh();
      }
    },
    [refresh],
  );

  const markAllRead = useCallback(async () => {
    if (stateRef.current.unreadCount === 0) return;
    requestId.current++;
    setState((prev) => ({ items: prev.items.map((n) => ({ ...n, isRead: true })), unreadCount: 0 }));
    try {
      await markAllNotificationsRead();
    } catch (err) {
      if (isUnauthorized(err)) setSignedOut(true);
      else void refresh();
    }
  }, [refresh]);

  return { ...state, loadState, announcement, signedOut, refresh, markRead, markAllRead };
}