import cors from "@fastify/cors";
import Fastify from "fastify";
import { env } from "./env";
import { closeDb } from "./lib/db";
import { attachRedisLogging, closeRedis } from "./lib/redis";
import { addressRoutes } from "./modules/address/address.routes";
import { authRoutes } from "./modules/auth/routes";
import { cartRoutes } from "./modules/cart/cart.routes";
import { categoryRoutes } from "./modules/catalog/category.routes";
import { productRoutes } from "./modules/catalog/product.routes";
import { checkoutRoutes } from "./modules/checkout/checkout.routes";
import { notificationRoutes } from "./modules/notification/notification.routes";
import { orderRoutes } from "./modules/order/order.routes";
import { paymentRoutes } from "./modules/payment/payment.routes";
import { sellerOnboardingRoutes } from "./modules/seller/seller-onboarding.routes";
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
  await app.register(addressRoutes);
  await app.register(cartRoutes);
  await app.register(checkoutRoutes);
  await app.register(orderRoutes);
  await app.register(notificationRoutes);
  await app.register(paymentRoutes);
  await app.register(sellerOnboardingRoutes);

  app.addHook("onClose", async () => {
    await Promise.allSettled([closeDb(), closeRedis()]);
  });

  return app;
}
