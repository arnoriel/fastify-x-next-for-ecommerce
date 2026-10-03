"use client";

import { useEffect, useRef } from "react";

/**
 * Panggil `callback` tiap `intervalMs` HANYA saat tab terlihat, dan sekali lagi begitu tab kembali
 * terlihat (data tidak basi setelah ditinggal). `callback` selalu versi terbaru tanpa mereset timer.
 */
export function usePolling(callback: () => void, intervalMs: number, enabled = true) {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    const timer = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs, enabled]);
}
