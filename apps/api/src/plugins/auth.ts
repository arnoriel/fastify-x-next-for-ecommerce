import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { fromNodeHeaders } from "better-auth/node";
import type { Role, SessionUser } from "@ecommerce/shared";
import { roleSchema, userStatusSchema } from "@ecommerce/shared";
import { auth } from "../lib/auth";
import { db } from "../db";
import { env } from "../env";
import { httpError } from "../lib/http-error";
import { TRUSTED_IP_HEADER } from "../lib/trusted-ip";

declare module "fastify" {
  interface FastifyRequest {
    /** Diisi oleh `requireAuth`/`requireRole`. `null` = belum login / belum di-resolve. */
    user: SessionUser | null;
    sessionId: string | null;
  }
}

const apiOrigin = new URL(env.BETTER_AUTH_URL ?? `http://${env.API_HOST}:${env.API_PORT}`).origin;

/**
 * Ambil session dari cookie & normalisasi ke SessionUser. `null` jika tidak valid.
 *
 * `role` dan `status` SELALU dibaca ulang dari DB (bukan dari cache session di Redis),
 * supaya suspend/ban/ubah role oleh admin berlaku seketika, bukan setelah cache habis.
 */
export async function resolveSession(req: FastifyRequest) {
  const data = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!data) return null;

  const fresh = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, data.user.id),
    columns: { role: true, status: true },
  });
  // User sudah dihapus tapi session masih tersisa → tidak valid.
  if (!fresh) return null;

  const role = roleSchema.safeParse(fresh.role);
  const status = userStatusSchema.safeParse(fresh.status);
  // Data korup / role tak dikenal → perlakukan sebagai tidak terautentikasi (fail closed).
  if (!role.success || !status.success) return null;

  const user: SessionUser = {
    id: data.user.id,
    name: data.user.name,
    email: data.user.email,
    emailVerified: data.user.emailVerified,
    image: data.user.image ?? null,
    role: role.data,
    status: status.data,
  };
  return { user, sessionId: data.session.id };
}

/** Wajib login. 401 jika tidak ada session, 403 jika akun tidak aktif. */
export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  const resolved = await resolveSession(req);
  if (!resolved) throw httpError(401, "UNAUTHENTICATED", "Silakan login terlebih dahulu.");
  if (resolved.user.status !== "active") {
    throw httpError(403, "ACCOUNT_INACTIVE", "Akun Anda tidak aktif.");
  }
  req.user = resolved.user;
  req.sessionId = resolved.sessionId;
}

/**
 * Wajib login DAN salah satu role. 401 = belum login, 403 = role tidak cukup.
 * Contoh: `app.get("/x", { preHandler: requireRole(["seller"]) }, handler)`
 */
export function requireRole(allowed: readonly Role[]) {
  if (allowed.length === 0) throw new Error("requireRole: daftar role tidak boleh kosong");
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(req, reply);
    if (!req.user || !allowed.includes(req.user.role)) {
      throw httpError(403, "FORBIDDEN", "Anda tidak punya akses ke resource ini.");
    }
  };
}

export const authPlugin: FastifyPluginAsync = fp(async (app) => {
  app.decorateRequest("user", null);
  app.decorateRequest("sessionId", null);

  // Semua endpoint Better Auth (sign-up/in/out, get-session, OAuth callback, dll).
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    // Rate limit global route ini dikelola Better Auth (Redis), bukan Fastify.
    handler: async (req, reply) => {
      const url = new URL(req.url, apiOrigin);
      const headers = fromNodeHeaders(req.headers);
      // Buang header IP kiriman client, lalu isi dari `req.ip` (socket, atau XFF bila proxy
      // terdaftar di TRUSTED_PROXIES via opsi `trustProxy` Fastify).
      headers.delete(TRUSTED_IP_HEADER);
      headers.set(TRUSTED_IP_HEADER, req.ip);
      const hasBody = req.method !== "GET" && req.body !== undefined && req.body !== null;

      const webReq = new Request(url, {
        method: req.method,
        headers,
        body: hasBody ? JSON.stringify(req.body) : undefined,
      });

      const res = await auth.handler(webReq);

      reply.status(res.status);
      res.headers.forEach((value, key) => {
        // set-cookie bisa lebih dari satu → tangani terpisah.
        if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
      });
      const cookies = res.headers.getSetCookie();
      if (cookies.length > 0) reply.header("set-cookie", cookies);

      return reply.send(res.body ? Buffer.from(await res.arrayBuffer()) : null);
    },
  });
});
