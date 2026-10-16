import { DISPUTE_STATUS_LABELS, type DisputeStatus } from "@ecommerce/shared";

const TONE: Record<DisputeStatus, string> = {
  open: "!text-[var(--brand)]",
  in_review: "!text-[var(--brand)]",
  resolved: "!text-[var(--up)]",
  dismissed: "!text-[var(--down)]",
  withdrawn: "!text-[var(--muted)]",
};

export function DisputeStatusPill({ status }: { status: DisputeStatus }) {
  return <span className={`pill ${TONE[status]}`}>{DISPUTE_STATUS_LABELS[status]}</span>;
}
