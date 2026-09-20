import type { SecondaryStorage } from "better-auth";
import { redis } from "./redis";

// INCR + EXPIRE atomik: TTL hanya di-set saat key baru dibuat (window tetap, tidak diperpanjang).
const INCREMENT_LUA = `
local v = redis.call("INCR", KEYS[1])
if v == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
return v
`;

/** Session cache & rate-limit counter Better Auth di Redis. Prefix `ba:` agar tidak tabrakan dengan key lain. */
export const authStorage: SecondaryStorage = {
  get: (key) => redis.get(`ba:${key}`),
  getAndDelete: (key) => redis.getdel(`ba:${key}`),
  set: async (key, value, ttl) => {
    if (ttl) await redis.set(`ba:${key}`, value, "EX", ttl);
    else await redis.set(`ba:${key}`, value);
  },
  delete: async (key) => {
    await redis.del(`ba:${key}`);
  },
  increment: async (key, ttl) => Number(await redis.eval(INCREMENT_LUA, 1, `ba:${key}`, ttl)),
};
