/**
 * T-08: isi `biteship_area_id` untuk alamat buyer & alamat pickup seller yang masih kosong
 * (data lama / hasil seed / Biteship sempat down saat alamat disimpan).
 *
 *   npm run db:backfill-areas      (butuh BITESHIP_API_KEY di apps/api/.env)
 *
 * Aman dijalankan berulang: hanya menyentuh baris yang area_id-nya masih null.
 */

import { eq, isNull } from "drizzle-orm";
import { env } from "../env";
import { closeDb } from "../lib/db";
import { resolveBiteshipAreaId } from "../modules/shipping/area.service";
import { db, schema } from "./index";

const DELAY_MS = 250; // jaga rate limit Biteship

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  if (!env.BITESHIP_API_KEY) {
    console.error("backfill-areas  BITESHIP_API_KEY kosong — isi dulu di apps/api/.env");
    process.exit(1);
  }

  let resolved = 0;
  let missed = 0;
  const tally = (id: string | null) => (id ? (resolved += 1) : (missed += 1));

  const addresses = await db.select().from(schema.addresses).where(isNull(schema.addresses.biteshipAreaId));
  for (const a of addresses) {
    const id = await resolveBiteshipAreaId(a);
    if (id) await db.update(schema.addresses).set({ biteshipAreaId: id }).where(eq(schema.addresses.id, a.id));
    tally(id);
    await sleep(DELAY_MS);
  }

  const sellers = await db.select().from(schema.sellers).where(isNull(schema.sellers.pickupBiteshipAreaId));
  for (const s of sellers) {
    if (!s.pickupDistrict || !s.pickupCity || !s.pickupPostalCode) continue;
    const id = await resolveBiteshipAreaId({ district: s.pickupDistrict, city: s.pickupCity, postalCode: s.pickupPostalCode });
    if (id) await db.update(schema.sellers).set({ pickupBiteshipAreaId: id }).where(eq(schema.sellers.id, s.id));
    tally(id);
    await sleep(DELAY_MS);
  }

  console.log(`backfill-areas  ok — ter-resolve: ${resolved}, tidak ditemukan: ${missed}`);
  if (missed > 0) console.log("                Yang tidak ditemukan: cek kecamatan/kota/kode pos (harus cocok dengan data Biteship).");
} catch (error) {
  console.error("backfill-areas  gagal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
