import { randomInt } from "node:crypto";

function datePart(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** Random base36, bukan increment counter — hindari kontensi lock di tabel bertraffic tinggi. */
function randomSuffix(len = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa karakter ambigu (0/O, 1/I)
  let out = "";
  for (let i = 0; i < len; i += 1) out += chars[randomInt(chars.length)];
  return out;
}

export function generateInvoiceNo(): string {
  return `INV-${datePart()}-${randomSuffix()}`;
}

export function generateOrderNo(): string {
  return `ORD-${datePart()}-${randomSuffix()}`;
}
