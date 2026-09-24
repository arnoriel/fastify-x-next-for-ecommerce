# Ecommerce — White-Label Multi-Vendor Boilerplate

Monorepo (Turborepo + npm workspaces). Status: **T-03 Auth & Role-Based Access** (T-01 infra, T-02 database schema selesai).

```
apps/
  api/                 Fastify 5 (native dev) + docker-compose.yml (infra only)
  web/                 Next.js 16 (native dev)
packages/shared/       Zod schemas & types (FE + BE)
```

## Port map (anti-bentrok)

| Service        | Host port | Catatan                                   |
|----------------|-----------|-------------------------------------------|
| web            | 3000      | `next dev --port 3000` (error jika dipakai)|
| api            | 4000      |                                           |
| postgres       | 5434      | 5432/5433 dipakai container lain          |
| redis          | 6381      | 6379/6380 dipakai container lain          |
| meilisearch    | 7700      | optional (`profile: search`)              |

Semua port infra di-bind ke `127.0.0.1`. Container: `ecommerce_postgres`, `ecommerce_redis`, `ecommerce_meilisearch`; project compose `ecommerce`; volume `ecommerce_*_data`.

## Quick start

```bash
npm install
npm run setup          # salin .env.example -> .env (api & web), tidak menimpa yang sudah ada
npm run infra:up       # postgres + redis, menunggu healthy
npm run db:migrate     # buat tabel
npm run db:seed        # data demo + akun login
npm run dev            # web + api (turbo, hot-reload)
```

## Jalankan NGROK untuk payment

```bash
npx ngrok http 4000
```
Salin domain, simpan di midtrans ke Payment -> Notification URL -> isi Payment Notification URL nya 'https://domain.ngrok.free.app/webhook/midtrans'

- Web: http://localhost:3000 (menampilkan status API / Postgres / Redis)
- API: http://localhost:4000/health (liveness) · http://localhost:4000/ready (Postgres + Redis, 503 jika down)
- Ngrok: https://domain.ngrok.free.app/webhook/midtrans

## Scripts (root)

| Script                | Fungsi                                                     |
|-----------------------|------------------------------------------------------------|
| `dev` / `dev:web` / `dev:api` | Jalankan app native                                |
| `infra:up`            | Start postgres + redis (`--wait` sampai healthy)           |
| `infra:search`        | Start postgres + redis + meilisearch                       |
| `infra:down`          | Stop semua infra (data tetap)                              |
| `infra:reset`         | Stop + **hapus volume** + start ulang (data hilang)        |
| `infra:ps` / `infra:logs` | Status / log container                                 |
| `db:generate`         | Generate migration dari perubahan schema Drizzle           |
| `db:migrate`          | Jalankan migration                                         |
| `db:seed`             | Isi data demo (menolak jika tabel users tidak kosong)      |
| `db:reset`            | **Hapus semua data** + migrate + seed (diblokir di production) |
| `db:studio`           | Drizzle Studio                                             |
| `typecheck` / `build` / `lint` | Turbo pipeline                                    |

Docker compose ada di `apps/api/docker-compose.yml`; env-nya dibaca dari `apps/api/.env` (sama dengan yang dipakai API).

## Env

- `apps/api/.env` — `API_HOST`, `API_PORT`, `WEB_URL`, `DATABASE_URL`, `REDIS_URL` + variabel docker (`POSTGRES_*`, `REDIS_PORT`, `MEILI_*`).
- `apps/web/.env` — `NEXT_PUBLIC_API_URL`.
- Divalidasi Zod saat startup (api: `src/env.ts`, web: `src/instrumentation.ts`) — gagal cepat dengan daftar variabel yang salah.
- Ubah `POSTGRES_*`/`REDIS_PORT`? Sesuaikan juga `DATABASE_URL`/`REDIS_URL`, lalu `npm run infra:reset` bila user/password/db berubah (init hanya jalan pada volume kosong).

## Auth (T-03)

Better Auth di API (`/api/auth/*`), role `buyer | seller | admin`. Session di Redis (salinan di Postgres).

**Akun demo** (dari `db:seed`, hanya dev) — password `Password123`:

| Email                    | Role   |
|--------------------------|--------|
| `admin@ecommerce.test`   | admin  |
| `seller1@ecommerce.test` | seller |
| `buyer1@ecommerce.test`  | buyer  |

**Guard API** (`apps/api/src/plugins/auth.ts`):

```ts
app.get("/api/x", { preHandler: requireAuth }, handler);              // 401 jika belum login
app.get("/api/y", { preHandler: requireRole(["seller"]) }, handler);  // 403 jika role salah
```

`role` & `status` selalu dibaca ulang dari DB di setiap request terproteksi, jadi suspend/ban/ubah role berlaku seketika.

**Guard halaman web** (`apps/web/src/lib/session.ts`): `await requireUser({ roles: ["seller"] })` di server component; memanggil `/api/me` dengan meneruskan cookie. `proxy.ts` hanya redirect optimistik (`/login`, `/register`), bukan otorisasi.

**Env tambahan (`apps/api/.env`)**

- `BETTER_AUTH_SECRET` — min 32 karakter, generate: `openssl rand -base64 32`. Wajib diganti di production.
- `BETTER_AUTH_URL` — URL publik API.
- `TRUSTED_PROXIES` — IP/CIDR reverse proxy (pisah koma). **Kosong di dev.** Wajib diisi saat di belakang Nginx/Caddy/Cloudflare, kalau tidak semua request terbaca berasal dari IP proxy dan rate limit login jadi satu bucket untuk semua orang.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — opsional, isi keduanya atau kosongkan keduanya.

**Rate limit** (Redis, per IP): login/register 5 per menit, lainnya 100 per menit. Aktif di development & production; longgar hanya bila `NODE_ENV=test`.

**Catatan production:** cookie session milik origin API. Bila web dan API beda domain induk, cookie tidak ikut ke server Next dan guard halaman akan selalu menganggap belum login. Gunakan subdomain dari domain yang sama (`shop.com` + `api.shop.com`) dan aktifkan `crossSubDomainCookies` di `lib/auth.ts`.
