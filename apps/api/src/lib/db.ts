import postgres from "postgres";
import { env } from "../env";

// Lazy: koneksi baru dibuat saat query pertama, jadi API tetap boot walau DB belum nyala.
export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  connect_timeout: 5,
  onnotice: () => {},
});

export const pingDb = () => sql`select 1`;
export const closeDb = () => sql.end({ timeout: 5 });
