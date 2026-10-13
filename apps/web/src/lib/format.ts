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

const RELATIVE_UNITS: readonly { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: "day", seconds: 86_400 },
  { unit: "hour", seconds: 3_600 },
  { unit: "minute", seconds: 60 },
];

/** ISO datetime -> "5 menit yang lalu" / "Baru saja"; lebih dari 7 hari jatuh ke tanggal lengkap. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const diffSec = Math.round((new Date(iso).getTime() - now) / 1000);
  const ageSec = Math.max(0, -diffSec); // jam device maju dari server → jangan tampil "dalam 2 menit"
  if (ageSec < 60) return "Baru saja";
  if (ageSec > 7 * 86_400) return formatDateTime(iso);
  const rtf = new Intl.RelativeTimeFormat("id-ID", { numeric: "auto" });
  const { unit, seconds } = RELATIVE_UNITS.find((u) => ageSec >= u.seconds)!;
  return rtf.format(-Math.floor(ageSec / seconds), unit);
}
