import { storeConfig } from "@ecommerce/shared";

/** Logo toko dari config; tanpa `logoUrl` jatuh ke nama toko sebagai teks. */
export function StoreBrand({ className = "" }: { className?: string }) {
  const { storeName, logoUrl } = storeConfig;
  if (!logoUrl) return <span className={className}>{storeName}</span>;
  // <img> biasa (bukan next/image): logo bisa dari domain mana pun tanpa perlu didaftarkan di next.config.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={logoUrl} alt={storeName} className={`h-7 w-auto max-w-[10rem] object-contain ${className}`} />;
}
