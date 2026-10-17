"use client";

import type Pusher from "pusher-js";
import {
  CHAT_MESSAGE_EVENT,
  CHAT_READ_EVENT,
  type ChatMessage,
  type ChatReadEvent,
  NOTIFICATION_EVENT,
  chatMessageSchema,
  chatReadEventSchema,
  conversationChannelName,
  notificationSchema,
  type NotificationView,
  userChannelName,
} from "@ecommerce/shared";
import { apiRequest } from "@/lib/http";

type PusherConfig = { key: string; cluster: string };

type Handlers = ChannelHandlers & {
  onNotification: (notification: NotificationView) => void;
};

/** Tunda disconnect: React StrictMode / pindah route group me-remount bell, jangan buka-tutup koneksi. */
const IDLE_DISCONNECT_MS = 5000;

// Satu koneksi WebSocket per tab, dibagi semua pemakai.
let clientPromise: Promise<Pusher> | null = null;
let clientId = "";
let subscribers = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const channelRefs = new Map<string, number>();

function getClient({ key, cluster }: PusherConfig): Promise<Pusher> {
  const id = `${key}:${cluster}`;
  if (clientPromise && clientId === id) return clientPromise;

  clientId = id;
  // Import dinamis: pusher-js (±30 KB) hanya diunduh setelah user login dan realtime aktif.
  const promise = import("pusher-js").then(({ default: PusherClient }) => {
    return new PusherClient(key, {
      cluster,
      forceTLS: true,
      channelAuthorization: {
        transport: "ajax",
        endpoint: "/api/pusher/auth", // tidak dipakai — customHandler di bawah memanggil API dengan cookie sesi
        customHandler: ({ socketId, channelName }, callback) => {
          apiRequest<{ auth: string }>("/api/pusher/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ socketId, channelName }),
          })
            .then((res) => callback(null, res))
            .catch((err: unknown) => callback(err instanceof Error ? err : new Error("Otorisasi channel gagal"), null));
        },
      },
    });
  });
  clientPromise = promise;
  // Gagal memuat library → buang promise supaya percobaan berikutnya bisa mengulang.
  promise.catch(() => {
    if (clientPromise === promise) clientPromise = null;
  });
  return promise;
}

function scheduleIdleDisconnect() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (subscribers > 0 || !clientPromise) return;
    const pending = clientPromise;
    clientPromise = null;
    void pending.then((client) => client.disconnect()).catch(() => {});
  }, IDLE_DISCONNECT_MS);
}

type ChannelHandlers = {
  /** true = terhubung DAN channel ter-subscribe; false = putus/ditolak (UI kembali ke polling). */
  onLiveChange: (live: boolean) => void;
  /** Channel (re)subscribed → resync supaya event yang terlewat saat koneksi putus tidak hilang. */
  onSubscribed: () => void;
};

/**
 * Subscribe ke 1 channel private + bind event. Koneksi WebSocket dibagi; channel yang sama dipakai
 * bersama (refcount). Mengembalikan fungsi pembersih. Melempar bila library gagal dimuat —
 * caller cukup jatuh ke polling.
 */
async function connectChannel(
  channelName: string,
  config: PusherConfig,
  events: Record<string, (data: unknown) => void>,
  handlers: ChannelHandlers,
): Promise<() => void> {
  clearTimeout(idleTimer);
  subscribers += 1;

  let pusher: Pusher;
  try {
    pusher = await getClient(config);
  } catch (err) {
    subscribers -= 1;
    scheduleIdleDisconnect();
    throw err;
  }

  const channel = pusher.subscribe(channelName);
  channelRefs.set(channelName, (channelRefs.get(channelName) ?? 0) + 1);

  let subscribed = channel.subscribed;
  const emitLive = () => handlers.onLiveChange(subscribed && pusher.connection.state === "connected");

  const onSubscribed = () => {
    subscribed = true;
    emitLive();
    handlers.onSubscribed();
  };
  const onSubscriptionError = () => {
    subscribed = false;
    emitLive();
  };
  const onConnectionState = () => {
    if (pusher.connection.state !== "connected") subscribed = false;
    emitLive();
  };

  for (const [event, callback] of Object.entries(events)) channel.bind(event, callback);
  channel.bind("pusher:subscription_succeeded", onSubscribed);
  channel.bind("pusher:subscription_error", onSubscriptionError);
  pusher.connection.bind("state_change", onConnectionState);
  emitLive();

  return () => {
    for (const [event, callback] of Object.entries(events)) channel.unbind(event, callback);
    channel.unbind("pusher:subscription_succeeded", onSubscribed);
    channel.unbind("pusher:subscription_error", onSubscriptionError);
    pusher.connection.unbind("state_change", onConnectionState);

    const remaining = (channelRefs.get(channelName) ?? 1) - 1;
    if (remaining <= 0) {
      channelRefs.delete(channelName);
      pusher.unsubscribe(channelName);
    } else {
      channelRefs.set(channelName, remaining);
    }
    subscribers -= 1;
    if (subscribers === 0) scheduleIdleDisconnect();
  };
}

/** Dengarkan notifikasi baru user di channel private-nya (T-09B). */
export function connectUserNotifications(userId: string, config: PusherConfig, handlers: Handlers): Promise<() => void> {
  return connectChannel(
    userChannelName(userId),
    config,
    {
      [NOTIFICATION_EVENT]: (data) => {
        // Payload dari luar batas kepercayaan: validasi sebelum menyentuh state UI.
        const parsed = notificationSchema.safeParse(data);
        if (parsed.success) handlers.onNotification(parsed.data);
      },
    },
    handlers,
  );
}

type ConversationHandlers = ChannelHandlers & {
  onMessage: (message: ChatMessage) => void;
  onRead: (event: ChatReadEvent) => void;
};

/** Dengarkan pesan baru & penanda baca di channel private 1 percakapan (T-11). */
export function connectConversation(
  conversationId: string,
  config: PusherConfig,
  handlers: ConversationHandlers,
): Promise<() => void> {
  return connectChannel(
    conversationChannelName(conversationId),
    config,
    {
      [CHAT_MESSAGE_EVENT]: (data) => {
        const parsed = chatMessageSchema.safeParse(data);
        if (parsed.success) handlers.onMessage(parsed.data);
      },
      [CHAT_READ_EVENT]: (data) => {
        const parsed = chatReadEventSchema.safeParse(data);
        if (parsed.success) handlers.onRead(parsed.data);
      },
    },
    handlers,
  );
}
