import { env } from "../../env";
import { searchAreas, type BiteshipArea } from "../../lib/biteship";

/** "Kec. Cilandak" / "Kota Jakarta Selatan" → "cilandak" / "jakarta selatan" untuk perbandingan longgar. */
const normalize = (v: string) =>
  v
    .toLowerCase()
    .replace(/^(kec(amatan)?\.?|kota|kabupaten|kab\.?)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Cari Biteship `area_id` (akurasi rate tertinggi) dari kecamatan + kota + kode pos.
 *
 * Aman dipanggil dari alur tulis (alamat/onboarding): TIDAK pernah throw dan mengembalikan null
 * kalau Biteship tidak terjangkau, API key kosong (mode stub), atau tidak ada area dengan kode pos
 * yang sama persis — lebih baik null daripada menebak area yang salah (ongkir salah).
 * Area null di-backfill nanti via `npm run db:backfill-areas`.
 */
export async function resolveBiteshipAreaId(loc: { district: string; city: string; postalCode: string }): Promise<string | null> {
  if (!env.BITESHIP_API_KEY) return null;

  const postal = loc.postalCode.trim();
  const samePostal = (areas: BiteshipArea[] | null) => (areas ?? []).filter((a) => String(a.postal_code ?? "") === postal);

  let candidates = samePostal(await searchAreas(`${loc.district} ${loc.city}`));
  if (candidates.length === 0) candidates = samePostal(await searchAreas(postal));

  const district = normalize(loc.district);
  const best =
    candidates.find((a) => normalize(a.administrative_division_level_3_name ?? "") === district) ?? candidates[0] ?? null;
  return best?.id ?? null;
}
