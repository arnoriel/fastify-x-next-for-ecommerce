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
