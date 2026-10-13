import Pusher from "pusher";
import { type RealtimeConfig, userChannelName } from "@ecommerce/shared";
import { env } from "../env";

/**
 * Pusher Channels (T-09B). Opsional di dev: tanpa kredensial, `realtimeConfig.enabled = false`,
 * publish menjadi no-op, dan web jatuh ke polling. Di production env.ts mewajibkannya.
 */
const client =
  env.PUSHER_APP_ID && env.PUSHER_KEY && env.PUSHER_SECRET && env.PUSHER_CLUSTER
    ? new Pusher({
        appId: env.PUSHER_APP_ID,
        key: env.PUSHER_KEY,
        secret: env.PUSHER_SECRET,
        cluster: env.PUSHER_CLUSTER,
        useTLS: true,
        timeout: 4000,
      })
    : null;

export const isRealtimeEnabled = client !== null;

/** Hanya key + cluster yang dibagikan ke browser — secret tidak pernah keluar dari API. */
export const realtimeConfig: RealtimeConfig =
  client && env.PUSHER_KEY && env.PUSHER_CLUSTER
    ? { enabled: true, key: env.PUSHER_KEY, cluster: env.PUSHER_CLUSTER }
    : { enabled: false };

/**
 * Kirim event ke channel private milik 1 user. Best-effort: kegagalan Pusher TIDAK boleh
 * menggagalkan flow bisnis — notifikasi sudah tersimpan di DB dan akan muncul lewat resync/polling.
 */
export async function publishToUser(userId: string, event: string, data: unknown): Promise<void> {
  if (!client) return;
  try {
    await client.trigger(userChannelName(userId), event, data);
  } catch (err) {
    console.warn(`[pusher] gagal publish "${event}":`, err instanceof Error ? err.message : err);
  }
}

/**
 * Tanda tangan otorisasi channel private. Caller WAJIB sudah memastikan `channelName` milik user
 * yang sedang login — fungsi ini hanya menandatangani.
 */
export function signChannelAuth(socketId: string, channelName: string) {
  if (!client) return null;
  return client.authorizeChannel(socketId, channelName);
}
