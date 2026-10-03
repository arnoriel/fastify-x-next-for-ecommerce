import type { OrderTracking } from "@ecommerce/shared";
import { formatDateTime } from "@/lib/format";

/** Timeline histori pengiriman (terbaru di atas). Event pertama = status terkini. */
export function TrackingTimeline({ tracking }: { tracking: OrderTracking }) {
  if (tracking.events.length === 0) {
    return <p className="muted small">Belum ada informasi pengiriman. Penjual sedang menyiapkan pesananmu.</p>;
  }

  return (
    <ol className="!m-0 flex list-none flex-col gap-0 !p-0" aria-label="Riwayat pengiriman">
      {tracking.events.map((event, index) => (
        <li
          key={`${event.status}-${event.occurredAt}`}
          className="relative !block !border-t-0 border-l-2 border-[var(--border)] !py-0 !pb-4 !pl-5 last:!pb-0"
        >
          <span
            aria-hidden
            className={`absolute -left-[7px] top-1 h-3 w-3 rounded-full ${index === 0 ? "bg-[var(--fg)]" : "bg-[var(--border)]"}`}
          />
          <p className={`text-sm ${index === 0 ? "font-semibold text-[var(--fg)]" : ""}`}>{event.label}</p>
          {event.note && <p className="muted small">{event.note}</p>}
          <p className="muted small">{formatDateTime(event.occurredAt)}</p>
        </li>
      ))}
    </ol>
  );
}