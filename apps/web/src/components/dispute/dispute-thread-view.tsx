"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  DISPUTE_DECISIONS,
  DISPUTE_DECISION_LABELS,
  DISPUTE_MESSAGE_MAX,
  DISPUTE_NOTE_MAX,
  DISPUTE_NOTE_MIN,
  DISPUTE_REASON_LABELS,
  type DisputeDecision,
  type DisputeDetail,
  type DisputeMessage,
  type DisputeViewerRole,
  ORDER_STATUS_LABELS,
  isActiveDispute,
} from "@ecommerce/shared";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner } from "@/components/ui/error-banner";
import { type DisputeMode, getDispute, postDisputeMessage, resolveDispute, withdrawDispute } from "@/lib/dispute-api";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { ApiError } from "@/lib/http";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useRemoteData } from "@/lib/use-remote-data";
import { DisputeStatusPill } from "./dispute-status-pill";

const POLL_MS = 10_000;
const ROLE_LABELS: Record<DisputeViewerRole, string> = { buyer: "Pembeli", seller: "Penjual", admin: "Admin" };
const draftKey = (mode: DisputeMode, id: string) => `dispute-draft:${mode}:${id}`;

function readDraft(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(key: string, value: string) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // storage penuh / diblokir — draft tidak tersimpan, tapi pengetikan tetap normal
  }
}

function Bubble({ role, name, mine, body, at }: { role: DisputeViewerRole; name: string; mine: boolean; body: string; at: string }) {
  return (
    <li className={`!block !border-t-0 !p-0 flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`flex max-w-[88%] flex-col gap-1 rounded-[var(--radius)] p-3 ${mine ? "glass" : "clay-inset"}`}>
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-bold text-[var(--fg)]">{name}</span>
          <span className="text-[var(--muted)]">{ROLE_LABELS[role]}</span>
          <span className="text-[var(--muted)]">{formatDateTime(at)}</span>
        </div>
        <p className="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--fg)]">{body}</p>
      </div>
    </li>
  );
}

export function DisputeThreadView({ id, mode }: { id: string; mode: DisputeMode }) {
  const toMessage = useApiErrorMessage();
  const uid = useId();
  const listHref = mode === "admin" ? "/admin/disputes" : "/disputes";

  const [draft, setDraft] = useState("");
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [decision, setDecision] = useState<DisputeDecision | "">("");
  const [note, setNote] = useState("");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [confirmingResolve, setConfirmingResolve] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const fetcher = useCallback(() => getDispute(mode, id), [mode, id]);
  const [active, setActive] = useState(true);
  const { data, error, setData, reload, retry } = useRemoteData(fetcher, {
    errorMessage: "Gagal memuat tiket.",
    // Tiket yang sudah ditutup tidak akan berubah lagi → berhenti polling. Dijeda saat aksi berjalan.
    pollMs: active ? POLL_MS : undefined,
    paused: busy || sending,
  });
  useEffect(() => {
    if (data) setActive(isActiveDispute(data.status));
  }, [data]);

  // Draft balasan bertahan bila user tak sengaja pindah halaman (mis. klik notifikasi).
  const key = draftKey(mode, id);
  useEffect(() => {
    setDraft(readDraft(key));
    setDraftLoaded(true);
  }, [key]);
  useEffect(() => {
    if (draftLoaded) writeDraft(key, draft);
  }, [key, draft, draftLoaded]);

  // Gulir ke pesan terbaru hanya bila itu pesan sendiri atau user memang sedang di dasar halaman.
  const bottomRef = useRef<HTMLDivElement>(null);
  const seenCount = useRef(0);
  const messages = data?.messages;
  useEffect(() => {
    const count = messages?.length ?? 0;
    if (messages && seenCount.current > 0 && count > seenCount.current) {
      const last = messages[count - 1]!;
      const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 240;
      if (last.mine || nearBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      if (!last.mine) setAnnouncement(`Pesan baru dari ${ROLE_LABELS[last.authorRole]}`);
    }
    seenCount.current = count;
  }, [messages]);

  function mergeMessage(message: DisputeMessage) {
    setData((prev) =>
      prev && !prev.messages.some((m) => m.id === message.id) ? { ...prev, messages: [...prev.messages, message] } : prev,
    );
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const message = await postDisputeMessage(mode, id, text);
      setDraft("");
      mergeMessage(message);
    } catch (err) {
      // Draft TIDAK dihapus: user bisa mengirim ulang tanpa mengetik lagi.
      setSendError(toMessage(err, "Pesan gagal dikirim. Coba lagi."));
    } finally {
      setSending(false);
      // Selalu sinkron: status bisa berubah (admin mulai menangani) atau tiket sudah ditutup admin.
      void reload();
    }
  }

  async function runWithdraw() {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      setData(await withdrawDispute(id));
    } catch (err) {
      setActionError(toMessage(err, "Laporan gagal dibatalkan. Coba lagi."));
      void reload();
    } finally {
      setBusy(false);
      setWithdrawing(false);
    }
  }

  function askResolve() {
    if (!decision) return setResolveError("Pilih keputusan terlebih dahulu.");
    if (note.trim().length < DISPUTE_NOTE_MIN) {
      return setResolveError(`Catatan keputusan minimal ${DISPUTE_NOTE_MIN} karakter — catatan ini dibaca pembeli dan penjual.`);
    }
    setResolveError(null);
    setConfirmingResolve(true);
  }

  async function runResolve() {
    if (!decision || busy) return;
    setBusy(true);
    setResolveError(null);
    try {
      setData(await resolveDispute(id, { decision, note: note.trim() }));
    } catch (err) {
      setResolveError(toMessage(err, "Keputusan gagal disimpan. Coba lagi."));
      // Admin lain sudah menutup tiket → tampilkan keadaan terbaru.
      if (err instanceof ApiError && err.code === "DISPUTE_CLOSED") void reload();
    } finally {
      setBusy(false);
      setConfirmingResolve(false);
    }
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorBanner message={error} onRetry={retry} />
        <Link href={listHref} className="btn-ghost w-fit">
          Kembali ke daftar tiket
        </Link>
      </div>
    );
  }
  if (!data) return <p className="muted" aria-busy="true">Memuat tiket...</p>;

  const d: DisputeDetail = data;
  const closed = !isActiveDispute(d.status);
  const reporterName = d.reporterRole === "buyer" ? (d.buyerName ?? "Pembeli") : d.storeName;
  const orderHref = d.viewerRole === "buyer" ? `/orders/${d.orderId}` : d.viewerRole === "seller" ? "/seller/orders" : null;

  return (
    <div className="flex flex-col gap-4">
      <Link href={listHref} className="btn-ghost w-fit !px-2">
        Semua tiket
      </Link>

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-extrabold tracking-tight text-[var(--fg)]">{d.ticketNo}</h1>
          <DisputeStatusPill status={d.status} />
        </div>
        <p className="muted small">
          {DISPUTE_REASON_LABELS[d.reason]} · dilaporkan {ROLE_LABELS[d.reporterRole].toLowerCase()} {formatDateTime(d.createdAt)}
        </p>
      </header>

      <section className="card !block !p-4" aria-label="Pesanan terkait">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold text-[var(--fg)]">
            {orderHref ? (
              <Link href={orderHref} className="underline">
                {d.order.orderNo}
              </Link>
            ) : (
              d.order.orderNo
            )}
          </span>
          <span className="pill">{ORDER_STATUS_LABELS[d.order.status]}</span>
        </div>
        <ul className="!m-0 mt-2 flex flex-col gap-1 !p-0 !shadow-none">
          {d.order.items.map((i, idx) => (
            <li key={idx} className="!block !border-t-0 !p-0 text-sm">
              {i.productName} ({i.variantName}) × {i.quantity}
            </li>
          ))}
        </ul>
        <dl className="kv mt-2 text-sm">
          <dt>Pembeli</dt>
          <dd>{d.buyerName ?? "Guest"}</dd>
          <dt>Toko</dt>
          <dd>{d.storeName}</dd>
          <dt>Total</dt>
          <dd>{formatRupiah(d.order.total)}</dd>
          {d.order.shippingStatusLabel && (
            <>
              <dt>Pengiriman</dt>
              <dd>
                {d.order.shippingStatusLabel}
                {d.order.trackingNumber ? ` · resi ${d.order.trackingNumber}` : ""}
              </dd>
            </>
          )}
        </dl>
      </section>

      <section aria-label="Percakapan" className="flex flex-col gap-3">
        <p className="muted small">Percakapan ini terlihat oleh pembeli, penjual, dan admin.</p>
        <ul className="!m-0 flex list-none flex-col gap-3 !p-0 !shadow-none">
          <Bubble role={d.reporterRole} name={reporterName} mine={d.viewerRole === d.reporterRole} body={d.description} at={d.createdAt} />
          {d.messages.map((m) => (
            <Bubble key={m.id} role={m.authorRole} name={m.authorName} mine={m.mine} body={m.body} at={m.createdAt} />
          ))}
        </ul>
        <div ref={bottomRef} />
        <span className="sr-only" role="status" aria-live="polite">
          {announcement}
        </span>
      </section>

      {closed && (
        <section className="glass flex flex-col gap-2 p-4" aria-label="Hasil tiket">
          <h2 className="font-bold text-[var(--fg)]">
            {d.status === "withdrawn"
              ? "Laporan dibatalkan oleh pelapor"
              : d.status === "dismissed"
                ? "Laporan ditolak admin"
                : d.outcome
                  ? `Diputuskan: ${DISPUTE_DECISION_LABELS[d.outcome]}`
                  : "Tiket selesai"}
          </h2>
          {d.resolutionNote && <p className="m-0 whitespace-pre-wrap text-sm text-[var(--fg)]">{d.resolutionNote}</p>}
          {d.resolvedAt && <p className="muted small">Ditutup {formatDateTime(d.resolvedAt)}. Tiket ini tidak bisa dibalas lagi.</p>}
        </section>
      )}

      {d.canReply && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="field">
            <label htmlFor={`${uid}-reply`}>Balasan</label>
            <textarea
              id={`${uid}-reply`}
              value={draft}
              rows={3}
              maxLength={DISPUTE_MESSAGE_MAX}
              disabled={sending}
              placeholder="Tulis balasan..."
              onChange={(e) => {
                setDraft(e.target.value);
                setSendError(null);
              }}
              onKeyDown={(e) => {
                // Ctrl/Cmd + Enter mengirim; Enter biasa tetap baris baru.
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <span className="hint">
              {draft.trim().length}/{DISPUTE_MESSAGE_MAX} · Ctrl+Enter untuk kirim
            </span>
          </div>
          {sendError && <ErrorBanner message={sendError} />}
          <div className="flex justify-end">
            <button type="submit" className="btn" disabled={sending || draft.trim().length === 0}>
              {sending ? "Mengirim..." : "Kirim balasan"}
            </button>
          </div>
        </form>
      )}

      {!closed && !d.canReply && <p className="muted small">Tiket ini sudah mencapai batas jumlah pesan.</p>}

      {actionError && <ErrorBanner message={actionError} />}

      {d.canWithdraw && (
        <div className="flex justify-end">
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => setWithdrawing(true)}>
            Batalkan laporan
          </button>
        </div>
      )}

      {d.canResolve && (
        <section className="glass flex flex-col gap-3 p-4" aria-labelledby={`${uid}-resolve`}>
          <h2 id={`${uid}-resolve`} className="font-bold text-[var(--fg)]">
            Putuskan tiket
          </h2>
          <p className="muted small">Keputusan bersifat final: tiket ditutup dan pembeli serta penjual diberi tahu.</p>
          <fieldset className="flex flex-col gap-2 border-0 p-0" disabled={busy}>
            <legend className="sr-only">Keputusan</legend>
            {DISPUTE_DECISIONS.map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${uid}-decision`}
                  value={value}
                  checked={decision === value}
                  onChange={() => {
                    setDecision(value);
                    setResolveError(null);
                  }}
                />
                <span>{DISPUTE_DECISION_LABELS[value]}</span>
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor={`${uid}-note`}>Catatan keputusan</label>
            <textarea
              id={`${uid}-note`}
              value={note}
              rows={3}
              maxLength={DISPUTE_NOTE_MAX}
              disabled={busy}
              placeholder="Jelaskan dasar keputusan. Catatan ini dibaca pembeli dan penjual."
              onChange={(e) => {
                setNote(e.target.value);
                setResolveError(null);
              }}
            />
            <span className="hint">
              {note.trim().length}/{DISPUTE_NOTE_MAX} (minimal {DISPUTE_NOTE_MIN})
            </span>
          </div>
          {resolveError && (
            <p role="alert" className="field-error">
              {resolveError}
            </p>
          )}
          <div className="flex justify-end">
            <button type="button" className="btn" disabled={busy} onClick={askResolve}>
              Simpan keputusan
            </button>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={withdrawing}
        title="Batalkan laporan?"
        description="Tiket ditutup dan pihak lain diberi tahu. Anda tetap bisa membuat laporan baru untuk pesanan ini selama masih dalam batas waktu."
        confirmLabel="Ya, batalkan"
        cancelLabel="Tidak"
        busy={busy}
        onConfirm={() => void runWithdraw()}
        onCancel={() => setWithdrawing(false)}
      />

      <ConfirmDialog
        open={confirmingResolve}
        title="Simpan keputusan?"
        description={`Keputusan: ${decision ? DISPUTE_DECISION_LABELS[decision] : ""}. Tiket ${d.ticketNo} langsung ditutup dan tidak bisa dibuka lagi.`}
        confirmLabel="Ya, putuskan"
        busy={busy}
        onConfirm={() => void runResolve()}
        onCancel={() => setConfirmingResolve(false)}
      />
    </div>
  );
}
