/** Rentang tanggal harian di Asia/Jakarta (WIB tidak punya DST) — dipakai dashboard seller & analytics admin. */

export const JAKARTA_TZ = "Asia/Jakarta";
export const JAKARTA_OFFSET = "+07:00";
const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" untuk waktu `date` di Asia/Jakarta. */
export const jakartaDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: JAKARTA_TZ }).format(date);

/** Daftar `days` tanggal berurutan berakhir di hari ini (WIB), mis. 7 hari terakhir termasuk hari ini. */
export function lastDays(days: number, now = new Date()): string[] {
  return Array.from({ length: days }, (_, i) => jakartaDate(new Date(now.getTime() - (days - 1 - i) * DAY_MS)));
}

/** Awal hari pertama rentang (00:00 WIB) sebagai Date. */
export const rangeStart = (firstDate: string) => new Date(`${firstDate}T00:00:00${JAKARTA_OFFSET}`);
