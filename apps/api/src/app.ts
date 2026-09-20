import cors from "@fastify/cors";
import Fastify from "fastify";
import { env } from "./env";
import { closeDb } from "./lib/db";
import { attachRedisLogging, closeRedis } from "./lib/redis";
import { authRoutes } from "./modules/auth/routes";
import { categoryRoutes } from "./modules/catalog/category.routes";
import { productRoutes } from "./modules/catalog/product.routes";
import { authPlugin } from "./plugins/auth";
import { errorHandlerPlugin } from "./plugins/error-handler";
import { healthRoutes } from "./routes/health";

export async function buildApp() {
  const app = Fastify({
    // false = req.ip selalu IP socket langsung. Bila ada TRUSTED_PROXIES, Fastify menelusuri
    // X-Forwarded-For dan melewati hop proxy tepercaya (bukan header mentah dari client).
    trustProxy: env.TRUSTED_PROXIES.length > 0 ? env.TRUSTED_PROXIES : false,
    logger:
      env.NODE_ENV === "development"
        ? {
            transport: {
              target: "pino-pretty",
              options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" },
            },
          }
        : true,
  });

  attachRedisLogging(app.log);

  // Whitelist origin frontend saja (tanpa wildcard); new URL().origin membuang trailing slash.
  await app.register(cors, {
    origin: new URL(env.WEB_URL).origin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(errorHandlerPlugin);
  await app.register(healthRoutes);
  await app.register(authPlugin);
  await app.register(authRoutes);
  await app.register(categoryRoutes);
  await app.register(productRoutes);

  app.addHook("onClose", async () => {
    await Promise.allSettled([closeDb(), closeRedis()]);
  });

  return app;
}
