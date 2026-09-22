import type { NotificationType } from "@ecommerce/shared";
import { db, schema } from "../../db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Buat 1 notifikasi in-app. Dipanggil dari flow lain (checkout webhook T-07, order confirm
 * T-06C, seller onboarding approve/reject T-03B) — TIDAK pernah dipanggil langsung dari route
 * publik, supaya isi/payload selalu server-controlled.
 *
 * `executor` opsional: kalau dipanggil di dalam `db.transaction`, pakai `tx` yang sama supaya
 * notifikasi ikut rollback bila transaksi induk gagal (mis. confirm order gagal → notif juga
 * batal, bukan nyangkut sendirian).
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
) {
  await executor.insert(schema.notifications).values({
    userId: params.userId,
    type: params.type,
    title: params.title,
    body: params.body,
    payload: params.payload ?? {},
  });
}
