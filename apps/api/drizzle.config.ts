import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[apps/api] DATABASE_URL kosong. Jalankan `npm run setup` lalu cek apps/api/.env");
  process.exit(1);
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
