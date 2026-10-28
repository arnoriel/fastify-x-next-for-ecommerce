import type { FastifyInstance } from "fastify";
import { env } from "../../env";
import { runReturnMaintenance } from "./return.service";

/** Sweep ringan tiap menit: auto-complete, auto-release escrow, kunci window retur. */
const INTERVAL_MS = 60_000;
const FIRST_RUN_MS = 5_000;

export function startReturnScheduler(app: FastifyInstance) {
  if (env.NODE_ENV === "test") return;

  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    runReturnMaintenance(app.log)
      .catch((err) => app.log.error({ err }, "[return] maintenance gagal"))
      .finally(() => {
        running = false;
      });
  };

  const first = setTimeout(run, FIRST_RUN_MS);
  const timer = setInterval(run, INTERVAL_MS);
  first.unref();
  timer.unref();
  app.addHook("onClose", async () => {
    clearTimeout(first);
    clearInterval(timer);
  });
}
