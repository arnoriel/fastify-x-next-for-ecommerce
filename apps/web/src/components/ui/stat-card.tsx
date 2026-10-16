export function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bento-cell flex flex-col gap-1 p-4">
      <span className="muted small">{label}</span>
      <span className="text-xl font-extrabold tracking-tight text-[var(--fg)]">{value}</span>
      {hint && <span className="muted small">{hint}</span>}
    </div>
  );
}
