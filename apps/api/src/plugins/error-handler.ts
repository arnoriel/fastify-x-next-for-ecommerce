import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { ZodError } from "zod";
import type { ErrorResponse } from "@ecommerce/shared";
import { env } from "../env";
import { HttpError } from "../lib/http-error";

const body = (code: string, message: string): ErrorResponse => ({ error: { code, message } });

export const errorHandlerPlugin: FastifyPluginAsync = fp(async (app) => {
  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send(body("NOT_FOUND", "Endpoint tidak ditemukan."));
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send(body(error.code, error.message));
    }
    if (error instanceof ZodError) {
      const message = error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
      return reply.code(400).send(body("VALIDATION_ERROR", message));
    }
    // Error bawaan Fastify yang membawa statusCode 4xx (mis. body JSON rusak, payload terlalu besar).
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send(body("BAD_REQUEST", "Permintaan tidak valid."));
    }
    // 5xx: log detail, jangan bocorkan ke client (kecuali dev).
    req.log.error({ err: error }, "unhandled error");
    const message = env.NODE_ENV === "development" && error instanceof Error ? error.message : "Terjadi kesalahan pada server.";
    return reply.code(500).send(body("INTERNAL_ERROR", message));
  });
});
