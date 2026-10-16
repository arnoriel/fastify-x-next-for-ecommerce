"use client";

import { useEffect, useState } from "react";

/** Nilai yang baru ikut berubah setelah `delayMs` tanpa perubahan — untuk kotak pencarian. */
export function useDebounced<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
