import type { FastifyBaseLogger } from "fastify";
import { Redis } from "ioredis";
import { env } from "../env";

// BullMQ (T-15+) membuat koneksi sendiri dengan maxRetriesPerRequest: null.
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });

export const pingRedis = () => redis.ping();

export async function closeRedis() {
  if (redis.status === "ready") await redis.quit();
  else redis.disconnect();
}

/** ioredis retry tiap ~2s saat Redis mati; log sekali per outage supaya tidak spam. */
export function attachRedisLogging(log: FastifyBaseLogger) {
  let reported = false;
  redis.on("error", (err) => {
    if (reported) return;
    reported = true;
    log.warn({ err: err.message }, "redis unavailable, retrying in background");
  });
  redis.on("ready", () => {
    reported = false;
    log.info("redis ready");
  });
}
