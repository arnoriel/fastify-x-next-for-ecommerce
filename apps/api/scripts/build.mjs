// Build production API: bundle src + SEMUA dependency → dist/*.mjs dengan esbuild.
// Image runtime tidak butuh node_modules (npm 10 tidak bisa menyaring `npm ci` per workspace, jadi install
// prod-only selalu membawa dev/web deps). Versi dependency di bundle = persis lockfile.
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });

await build({
  absWorkingDir: root,
  entryPoints: { server: "src/server.ts", migrate: "src/db/migrate.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  // Jaga-jaga bila ada kode CJS ikut ter-bundle di output ESM.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "info",
});
