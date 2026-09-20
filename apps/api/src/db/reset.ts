import { sql } from "../lib/db";
import { env } from "../env";

// Guard: reset menghapus SEMUA data. Tolak di production.
if (env.NODE_ENV === "production") {
  console.error("db:reset diblokir di NODE_ENV=production");
  process.exit(1);
}

try {
  await sql`drop schema if exists public cascade`;
  await sql`drop schema if exists drizzle cascade`;
  await sql`create schema public`;
  console.log("reset    schema public & drizzle dibersihkan");
} catch (error) {
  console.error("reset    gagal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
