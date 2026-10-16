import { FaTriangleExclamation } from "react-icons/fa6";

/** Pesan error halaman/aksi dengan tombol coba lagi opsional. */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert flex flex-wrap items-center gap-3" role="alert">
      <FaTriangleExclamation aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <button type="button" className="btn-ghost" onClick={onRetry}>
          Coba lagi
        </button>
      )}
    </div>
  );
}
