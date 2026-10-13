import { eq } from "drizzle-orm";
import { NOTIFICATION_EVENT, type NotificationType, type NotificationView } from "@ecommerce/shared";
import { db, schema } from "../../db";
import { isRealtimeEnabled, publishToUser } from "../../lib/pusher";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type NotificationRow = typeof schema.notifications.$inferSelect;

/** Satu-satunya bentuk serialisasi notifikasi ke client (REST list & event realtime identik). */
export function toNotificationView(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    payload: row.payload,
    isRead: row.isRead,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Jeda cek ulang visibilitas row setelah transaksi induk (±6 dtk total) sebelum menyerah. */
const COMMIT_CHECK_DELAYS_MS = [150, 500, 1500, 4000];

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    // unref: timer tunggu tidak boleh menahan proses saat shutdown.
    setTimeout(resolve, ms).unref();
  });

/**
 * Publish realtime untuk notifikasi yang dibuat DI DALAM transaksi: event baru dikirim setelah row
 * benar-benar terlihat dari koneksi lain (= transaksi induk sudah commit). Jika transaksi rollback,
 * row tidak pernah muncul → tidak ada event hantu. Caller tidak perlu tahu kapan commit terjadi.
 */
async function publishAfterCommit(view: NotificationView, userId: string) {
  for (const delay of COMMIT_CHECK_DELAYS_MS) {
    await sleep(delay);
    const visible = await db.query.notifications.findFirst({
      where: eq(schema.notifications.id, view.id),
      columns: { id: true },
    });
    if (visible) return publishToUser(userId, NOTIFICATION_EVENT, view);
  }
}

/**
 * Buat 1 notifikasi in-app + dorong realtime ke bell user (Pusher). Dipanggil dari flow lain
 * (checkout webhook T-07, order confirm T-06C, seller onboarding approve/reject T-03B, shipping
 * T-08/T-09) — TIDAK pernah dari route publik, supaya isi/payload selalu server-controlled.
 *
 * `executor` opsional: kalau dipanggil di dalam `db.transaction`, pakai `tx` yang sama supaya
 * notifikasi ikut rollback bila transaksi induk gagal (mis. confirm order gagal → notif juga
 * batal, bukan nyangkut sendirian). Event realtime-nya baru dikirim setelah commit.
 */
export async function createNotification(
  params: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
  },
  executor: Tx | typeof db = db,
): Promise<NotificationView> {
  const [row] = await executor
    .insert(schema.notifications)
    .values({
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      payload: params.payload ?? {},
    })
    .returning();
  const view = toNotificationView(row!);

  if (isRealtimeEnabled) {
    // Fire-and-forget: tidak menunda response flow bisnis, kegagalan tidak melempar.
    const publish = executor === db ? publishToUser(params.userId, NOTIFICATION_EVENT, view) : publishAfterCommit(view, params.userId);
    publish.catch((err) => console.warn("[notification] publish realtime gagal:", err));
  }
  return view;
}
