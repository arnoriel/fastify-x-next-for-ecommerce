import { z } from "zod";

export const checkStatusSchema = z.enum(["up", "down"]);

export const healthSchema = z.object({
  status: z.literal("ok"),
  uptime: z.number(),
  timestamp: z.iso.datetime(),
});

export const readinessSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.object({
    database: checkStatusSchema,
    redis: checkStatusSchema,
  }),
  timestamp: z.iso.datetime(),
});

export type CheckStatus = z.infer<typeof checkStatusSchema>;
export type HealthResponse = z.infer<typeof healthSchema>;
export type ReadinessResponse = z.infer<typeof readinessSchema>;
