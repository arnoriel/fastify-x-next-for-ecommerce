import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { db, schema } from "../db";
import { env } from "../env";
import { authStorage } from "./auth-storage";
import { TRUSTED_IP_HEADER } from "./trusted-ip";

const apiOrigin = new URL(env.BETTER_AUTH_URL ?? `http://${env.API_HOST}:${env.API_PORT}`).origin;
const webOrigin = new URL(env.WEB_URL).origin;
const isProd = env.NODE_ENV === "production";

export const auth = betterAuth({
  baseURL: apiOrigin,
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET,
  // Hanya frontend kita yang boleh memanggil endpoint auth (proteksi CSRF/origin).
  trustedOrigins: [webOrigin],

  database: drizzleAdapter(db, { provider: "pg", schema, usePlural: true }),

  // Kolom "id" di schema T-02 = text UUID; biarkan DB layer yang generate.
  advanced: {
    database: { generateId: "uuid" },
    useSecureCookies: isProd,
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true, secure: isProd },
    // IP untuk rate limit dibaca HANYA dari header internal ini. Header itu diisi server
    // (plugins/auth.ts) dari IP socket / Fastify `req.ip`, dan header kiriman client dibuang,
    // jadi tidak bisa dipalsukan. Better Auth tidak pernah membaca IP dari socket sendiri.
    ipAddress: { ipAddressHeaders: [TRUSTED_IP_HEADER] },
  },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    // Verifikasi email dijadwalkan di task notifikasi; belum memblokir login.
    requireEmailVerification: false,
  },

  socialProviders:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {},

  user: {
    additionalFields: {
      // input:false → TIDAK bisa diisi client saat sign-up (cegah privilege escalation).
      role: { type: "string", required: false, defaultValue: "buyer", input: false },
      status: { type: "string", required: false, defaultValue: "active", input: false },
      phone: { type: "string", required: false, input: true },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 hari
    updateAge: 60 * 60 * 24, // perpanjang (refresh) maksimal 1x/hari saat dipakai
    // Session utama di Redis (revoke/ban langsung efektif); salinan di Postgres untuk audit.
    storeSessionInDatabase: true,
  },

  // Rate limit auth endpoint, disimpan di Redis agar konsisten antar instance.
  // NODE_ENV=test melonggarkan kuota agar suite E2E (satu IP) tidak saling menghabiskan jatah;
  // production/development memakai batas ketat.
  rateLimit: {
    enabled: true,
    window: 60,
    max: env.NODE_ENV === "test" ? 10_000 : 100,
    storage: "secondary-storage",
    customRules:
      env.NODE_ENV === "test"
        ? { "/sign-in/*": false, "/sign-up/*": false, "/forget-password": false }
        : {
            "/sign-in/email": { window: 60, max: 5 },
            "/sign-up/email": { window: 60, max: 5 },
            "/forget-password": { window: 60, max: 3 },
          },
  },
  secondaryStorage: authStorage,

  databaseHooks: {
    session: {
      create: {
        // Blokir login user yang di-suspend/ban.
        before: async (session) => {
          const user = await db.query.users.findFirst({
            where: (u, { eq }) => eq(u.id, session.userId),
            columns: { status: true },
          });
          if (user && user.status !== "active") {
            throw new APIError("FORBIDDEN", {
              message:
                user.status === "banned"
                  ? "Akun Anda diblokir permanen."
                  : "Akun Anda sedang ditangguhkan. Hubungi admin.",
            });
          }
        },
      },
    },
  },
});

export type Auth = typeof auth;
export type AuthSession = typeof auth.$Infer.Session;
