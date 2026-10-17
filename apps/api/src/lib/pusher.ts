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
 * Kirim event ke channel mana pun (user / percakapan). Best-effort: kegagalan Pusher TIDAK boleh
 * menggagalkan flow bisnis — data sudah tersimpan di DB dan akan muncul lewat resync/polling.
 */
export async function publishToChannel(channelName: string, event: string, data: unknown): Promise<void> {
  if (!client) return;
  try {
    await client.trigger(channelName, event, data);
  } catch (err) {
    console.warn(`[pusher] gagal publish "${event}":`, err instanceof Error ? err.message : err);
  }
}

/** Kirim event ke channel private milik 1 user (notifikasi, T-09B). */
export const publishToUser = (userId: string, event: string, data: unknown): Promise<void> =>
  publishToChannel(userChannelName(userId), event, data);

/**
 * Tanda tangan otorisasi channel private. Caller WAJIB sudah memastikan user yang sedang login
 * berhak atas `channelName` (channel user sendiri / percakapan yang diikuti) — fungsi ini hanya menandatangani.
 */
export function signChannelAuth(socketId: string, channelName: string) {
  if (!client) return null;
  return client.authorizeChannel(socketId, channelName);
}
