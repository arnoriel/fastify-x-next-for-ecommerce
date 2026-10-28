"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotificationBell } from "@/components/notification/notification-bell";
import { getAdminCounts } from "@/lib/admin-api";
import { useRemoteData } from "@/lib/use-remote-data";

const COUNTS_POLL_MS = 30_000;

const LINKS = [
  { href: "/admin", label: "Ringkasan", exact: true, badge: null },
  { href: "/admin/sellers", label: "Seller", exact: false, badge: "pendingSellers" },
  { href: "/admin/categories", label: "Kategori", exact: false, badge: null },
  { href: "/admin/orders", label: "Transaksi", exact: false, badge: null },
  { href: "/admin/disputes", label: "Sengketa", exact: false, badge: "needsReply" },
  { href: "/admin/refunds", label: "Refund", exact: false, badge: "refundQueue" },
] as const;

export function AdminNav({ userId }: { userId: string }) {
  const pathname = usePathname();
  // Badge antrian kerja admin; gagal memuat tidak mengganggu navigasi (badge sekadar tidak tampil).
  const { data: counts } = useRemoteData(getAdminCounts, { errorMessage: "", pollMs: COUNTS_POLL_MS });

  return (
    <nav aria-label="Menu admin" className="flex flex-wrap items-center gap-2">
      {LINKS.map((link) => {
        const active = link.exact ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
        const count = link.badge && counts ? counts[link.badge] : 0;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={active ? "tab tab-active" : "tab"}
          >
            {link.label}
            {count > 0 && (
              <span className={active ? "tab-count" : "tab-count tab-count-alert"}>
                <span className="sr-only">
                  {link.badge === "pendingSellers"
                    ? "menunggu persetujuan: "
                    : link.badge === "refundQueue"
                      ? "refund menunggu eksekusi: "
                      : "perlu dibalas: "}
                </span>
                {count}
              </span>
            )}
          </Link>
        );
      })}
      <Link href="/" className="tab ml-auto">
        Ke toko
      </Link>
      <NotificationBell userId={userId} />
    </nav>
  );
}
