/** Format angka jadi Rupiah tanpa desimal, mis. 125000 -> "Rp125.000". */
export function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(
    value,
  );
}

/** Format angka besar jadi singkatan (1200 -> "1,2rb", 15000 -> "15rb"). */
export function formatCompactCount(value: number): string {
  if (value < 1000) return String(value);
  return new Intl.NumberFormat("id-ID", { notation: "compact", compactDisplay: "short" }).format(value);
}

/** Format ISO datetime ke waktu Indonesia, mis. "3 Okt 2026, 14.05 WIB". */
export function formatDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
  return `${parts} WIB`;
}


/** Rupiah ringkas untuk sumbu grafik, mis. 1500000 -> "Rp1,5 jt". */
export function formatRupiahCompact(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** "2026-10-03" -> "3 Okt" (tanggal kalender murni, tanpa konversi zona waktu). */
export function formatDayMonth(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year!, month! - 1, day!)),
  );
}
