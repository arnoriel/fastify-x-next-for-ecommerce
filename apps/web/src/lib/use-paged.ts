"use client";

import { useCallback, useState } from "react";

/**
 * Nomor halaman yang otomatis kembali ke 1 saat filter berubah — tanpa effect, jadi tidak ada
 * request ganda (halaman lama + filter baru). `filterKey` = ringkasan semua filter aktif.
 */
export function usePaged(filterKey: string) {
  const [state, setState] = useState({ key: filterKey, page: 1 });
  const page = state.key === filterKey ? state.page : 1;
  const setPage = useCallback((next: number) => setState({ key: filterKey, page: Math.max(1, next) }), [filterKey]);
  return [page, setPage] as const;
}
