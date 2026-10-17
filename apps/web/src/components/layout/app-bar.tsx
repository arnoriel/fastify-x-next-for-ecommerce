import Link from "next/link";
import { ChatNavLink } from "@/components/chat/chat-nav-link";
import { NotificationBell } from "@/components/notification/notification-bell";

/** Header ringkas untuk area login (akun, keranjang/checkout): brand + bell notifikasi. */
export function AppBar({ userId }: { userId: string }) {
  return (
    <header className="flex items-center justify-between gap-3">
      <Link href="/" className="text-lg font-extrabold tracking-tight text-[var(--fg)] no-underline">
        Ecommerce
      </Link>
      <div className="flex items-center gap-2">
        <ChatNavLink />
        <NotificationBell userId={userId} />
      </div>
    </header>
  );
}
