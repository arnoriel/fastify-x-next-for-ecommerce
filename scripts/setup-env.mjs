import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

for (const app of ["apps/api", "apps/web"]) {
  const src = join(root, app, ".env.example");
  const dest = join(root, app, ".env");
  if (existsSync(dest)) {
    console.log(`skip     ${app}/.env (already exists)`);
    continue;
  }
  copyFileSync(src, dest);
  console.log(`created  ${app}/.env`);
}
