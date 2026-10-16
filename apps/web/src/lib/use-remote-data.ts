"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { usePolling } from "@/lib/use-polling";

type Options = {
  /** Pesan bila error bukan ApiError (401 otomatis diarahkan ke login). */
  errorMessage: string;
  /** Muat ulang diam-diam tiap N ms saat tab terlihat. Kosong = tanpa polling. */
  pollMs?: number;
  /** Jeda polling (mis. saat dialog/aksi berjalan). */
  paused?: boolean;
};

/**
 * Muat data + polling untuk halaman panel. `fetcher` WAJIB stabil (useCallback) — identitasnya baru
 * berarti query baru (filter/halaman berganti): data dikosongkan dan dimuat ulang dengan indikator.
 * Respons basi (ganti filter cepat / polling tumpang tindih) diabaikan; polling yang gagal tidak
 * menghapus data yang sudah tampil.
 */
export function useRemoteData<T>(fetcher: () => Promise<T>, { errorMessage, pollMs, paused = false }: Options) {
  const toMessage = useApiErrorMessage();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      const id = ++requestId.current;
      if (!silent) {
        setData(null);
        setError(null);
      }
      try {
        const result = await fetcher();
        if (id !== requestId.current) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (id !== requestId.current) return;
        if (!silent) setError(toMessage(err, errorMessage));
      }
    },
    [fetcher, toMessage, errorMessage],
  );

  useEffect(() => {
    void load();
  }, [load]);

  usePolling(() => void load(true), pollMs ?? 60_000, Boolean(pollMs) && !paused);

  /** Muat ulang tanpa mengosongkan tampilan (setelah aksi berhasil/gagal). */
  const reload = useCallback(() => load(true), [load]);
  /** Coba lagi setelah error (dengan indikator memuat). */
  const retry = useCallback(() => load(), [load]);

  return { data, error, setData, reload, retry };
}
