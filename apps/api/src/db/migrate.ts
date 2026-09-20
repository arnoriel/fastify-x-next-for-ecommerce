import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./index";
import { closeDb } from "../lib/db";

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("migrate  ok");
} catch (error) {
  console.error("migrate  gagal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
