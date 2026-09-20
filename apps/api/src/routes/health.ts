import type { FastifyPluginAsync } from "fastify";
import type { HealthResponse, ReadinessResponse } from "@ecommerce/shared";
import { pingDb } from "../lib/db";
import { probe } from "../lib/probe";
import { pingRedis } from "../lib/redis";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  // Liveness: proses hidup.
  app.get("/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }));

  // Readiness: dependency (Postgres + Redis) terjangkau.
  app.get("/ready", async (_req, reply): Promise<ReadinessResponse> => {
    const [database, redis] = await Promise.all([probe(pingDb), probe(pingRedis)]);
    const ok = database === "up" && redis === "up";
    if (!ok) reply.code(503);
    return {
      status: ok ? "ok" : "degraded",
      checks: { database, redis },
      timestamp: new Date().toISOString(),
    };
  });
};
