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

## Biteship (T-08)

Tanpa `BITESHIP_API_KEY` aplikasi memakai **stub** ongkir & resi simulasi (dev saja). Untuk Biteship asli:

1. Dashboard Biteship → aktifkan *Testing Mode* → Integrations → buat API key → isi `BITESHIP_API_KEY` di `apps/api/.env`.
2. Karang `BITESHIP_WEBHOOK_SECRET` (min 16 karakter). Di dashboard: Integrations → Webhook → URL `https://domain.ngrok.free.app/webhook/biteship`, event `order.status` + `order.waybill_id`, kirim secret yang sama sebagai header `x-webhook-secret` (atau `Authorization`).
3. `npm run db:migrate` (migrasi 0003: kolom tracking + tabel `order_tracking_events`).
4. `npm run db:backfill-areas` — isi `biteship_area_id` untuk alamat/seed lama. Alamat & toko baru ter-resolve otomatis saat disimpan.

Alur: checkout → rate real-time (area id) → bayar → seller `POST /api/seller/orders/:id/shipment` (resi dibuat, order `processing`) → webhook `order.status` (`picked/in_transit` → `shipped`, `delivered` → `delivered`) → buyer melihat timeline di `/orders/:id` (auto-refresh 30 dtk; fallback tarik ke Biteship tiap ≥3 menit bila webhook tidak sampai). Kurir instant (GoSend/Grab) tidak muncul di rate by area id.

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
| `db:backfill-areas`   | Isi `biteship_area_id` yang masih kosong (butuh API key)   |
| `db:reset`            | **Hapus semua data** + migrate + seed (diblokir di production) |
| `db:studio`           | Drizzle Studio                                             |
| `typecheck` / `build` / `lint` | Turbo pipeline                                    |

Docker compose ada di `apps/api/docker-compose.yml`; env-nya dibaca dari `apps/api/.env` (sama dengan yang dipakai API).

## Notifikasi realtime (T-09B)

Bell notifikasi (badge unread + dropdown) ada di header buyer & seller: beranda, detail produk, akun/pesanan, keranjang/checkout, dan navigasi toko. Notifikasi order & status toko didorong realtime lewat **Pusher Channels** (channel private per user, otorisasi `POST /api/pusher/auth`).

Tanpa kredensial Pusher aplikasi tetap jalan: bell memakai polling 30 dtk (dev saja; WAJIB diisi di production).

1. https://dashboard.pusher.com → Channels → *Create app* (cluster `ap1` untuk Indonesia) → App Keys.
2. Isi `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` di `apps/api/.env` (keempatnya bersamaan). Web tidak butuh env baru — key/cluster publik diambil dari `GET /api/notifications/realtime`.
3. `npm install` (menambah `pusher` di api, `pusher-js` di web), restart `npm run dev`. Tidak ada migrasi baru (tabel `notifications` sudah dari T-02).

Endpoint: `GET /api/notifications` · `POST /api/notifications/:id/read` · `POST /api/notifications/read-all` · `GET /api/notifications/realtime` · `POST /api/pusher/auth`. Dari kode lain, buat notifikasi lewat `createNotification()` (`modules/notification/notification.service.ts`) — event realtime otomatis dikirim setelah transaksi induk commit.

## Panel admin & sengketa (T-10)

Login sebagai admin (`admin@ecommerce.test`, lihat seed) → tombol **Panel admin** di halaman akun, atau langsung `/admin`.

| Halaman | Fungsi |
|---|---|
| `/admin` | Analytics platform: GMV, pesanan, pengguna & pendaftar toko baru, toko/kategori terlaris, status pesanan, ringkasan sengketa (7/30/90 hari) |
| `/admin/sellers` | Approval seller: tab Menunggu/Disetujui/Ditolak, cari, lihat dokumen, setujui / tolak dengan alasan |
| `/admin/categories` | CRUD kategori bertingkat + atribut produk, aktif/nonaktif, hapus (diblokir bila masih ada produk/sub-kategori) |
| `/admin/orders` | Monitoring transaksi (filter status, cari nomor pesanan/pembeli/toko), penanda pesanan bersengketa |
| `/admin/disputes` | Antrian tiket sengketa (Aktif / Perlu dibalas / Selesai), balas, putuskan |
| `/disputes`, `/disputes/new?orderId=`, `/disputes/:id` | Sisi buyer & seller: ajukan laporan dari detail pesanan / kartu order seller, balas, batalkan |

Aturan sengketa: satu tiket aktif per order (dijaga unique index DB), hanya buyer/seller order itu yang bisa melapor (order `paid`–`completed`; `completed` maksimal 14 hari), maks 5 tiket/24 jam per user, tiket yang sudah diputuskan admin tidak bisa dibuka ulang untuk order yang sama (dibatalkan pelapor boleh), dan **konfirmasi terima barang ditahan selama ada tiket aktif**. Keputusan admin hanya dicatat dan diberitahukan ke kedua pihak — eksekusi refund menyusul di task retur/refund.

Setelah `git pull`/ganti project: `npm run db:migrate` (migrasi `0004_admin_panel`: tabel `disputes`, `dispute_messages`, kolom `sellers.document_url`, nilai notifikasi `dispute_update`). Tidak ada env baru.

## Chat realtime buyer ↔ seller (T-11)

| Halaman / komponen | Fungsi |
|---|---|
| Tombol **Chat Penjual** di `/product/[slug]` dan di `/orders/[id]` | Membuat/membuka percakapan lalu membuka widget chat melayang di halaman yang sama (guest → login dulu, balik ke halaman itu) |
| Tombol **Chat pembeli** di kartu pesanan seller (`/seller/orders`) | Seller memulai chat dari pesanan (pembeli tamu/guest tidak bisa dihubungi) |
| `/chat`, `/chat/[id]` | Daftar percakapan (sebagai pembeli dan/atau penjual) dan thread penuh |
| Menu **Chat** + badge | Di header beranda, produk, akun/keranjang, dan navigasi toko; badge = total pesan belum dibaca |

Cara kerja: satu percakapan per pasangan (buyer, seller) — dijaga unique index DB, konteks produk selalu mengikuti produk terakhir yang ditanyakan. Pesan dikirim optimistik dengan `clientId` (kirim ulang aman, tidak membuat pesan ganda), realtime lewat **channel Pusher private per percakapan** (`private-chat-<id>`, otorisasi `POST /api/pusher/auth` memastikan hanya buyer/seller percakapan itu). Tanpa kredensial Pusher thread memakai polling 4 dtk (tab terlihat). Pesan baru masuk ke bell notifikasi (digabung: maksimal 1 notifikasi chat belum dibaca per percakapan); membuka thread menandai pesan dan notifikasinya terbaca, lawan bicara melihat penanda "Dibaca".

Aturan: maks 2000 karakter/pesan, 20 pesan/menit/user, toko non-aktif (suspend) atau akun pembeli non-aktif tidak bisa menerima pesan baru (riwayat tetap terbaca), tidak bisa chat dengan toko sendiri, percakapan tanpa pesan tidak muncul di daftar, non-peserta selalu mendapat 404.

Endpoint: `GET/POST /api/chat/conversations` · `GET /api/chat/unread-count` · `GET /api/chat/conversations/:id` · `GET/POST /api/chat/conversations/:id/messages` (`?before=` / `?after=`) · `POST /api/chat/conversations/:id/read`.

Setelah ganti project: `npm run db:migrate` (migrasi `0005_chat`: kolom `messages.client_id` + unique index idempotensi, index `conversations_buyer_idx`). Tidak ada env atau dependency baru (Pusher dari T-09B).

## Review, wishlist & voucher (T-12)

**Review** — di detail pesanan (`/orders/[id]`) yang berstatus `completed`, tiap item punya form bintang 1–5 + ulasan opsional (maks 1000 karakter). Satu review per item (unique index DB), hanya pembeli item tsb, bisa diubah sampai 7 hari. Rating & jumlah review produk dihitung ulang dari tabel `reviews` di bawah row lock produk (dua review bersamaan tidak saling menimpa). Ulasan publik tampil di `/product/[slug]` (ringkasan, distribusi bintang yang bisa jadi filter, muat lebih banyak); nama pembeli disamarkan (`B***o`). Ulasan bergambar & balasan seller belum termasuk.

**Wishlist** — ikon hati di kartu produk & halaman produk, daftar di `/wishlist`. Aksi idempoten (`PUT`/`DELETE`, bukan toggle) + optimistik; guest yang menekan hati diarahkan ke login lalu kembali. Maks 200 produk; produk nonaktif/habis tetap tampil dengan penanda supaya bisa dihapus.

**Voucher** — kolom voucher di checkout kini punya tombol **Pakai** (validasi server terhadap keranjang saat ini, pesan jelas: kedaluwarsa / belum mulai / kuota habis / minimal belanja / batas pemakaian / salah kolom), daftar voucher yang bisa dipilih, dan diskon tampil di ringkasan. Hanya voucher yang lolos validasi yang dikirim; server tetap memvalidasi ulang dengan row lock saat submit. Voucher dari draft (setelah login ulang) dicek ulang otomatis. Kode seed: `WELCOME10`, `HEMAT20K` (platform), `SELLER15` (toko), `EXPIRED5` (uji ditolak).

Endpoint: `GET /api/products/:slug/reviews` · `GET /api/orders/:id/reviews` · `POST /api/order-items/:id/review` · `PATCH /api/reviews/:id` · `GET /api/wishlist` · `GET /api/wishlist/ids` · `PUT|DELETE /api/wishlist/:productId` · `GET /api/vouchers/available` · `POST /api/vouchers/validate`.

Tidak ada migrasi baru dan tidak ada env/dependency baru (tabel `reviews`, `wishlists`, `vouchers` sudah dari T-02).

## Env

- `apps/api/.env` — `API_HOST`, `API_PORT`, `WEB_URL`, `DATABASE_URL`, `REDIS_URL` + variabel docker (`POSTGRES_*`, `REDIS_PORT`, `MEILI_*`) + `PUSHER_*` (T-09B, opsional di dev).
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
