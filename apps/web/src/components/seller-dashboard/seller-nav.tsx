"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/seller/dashboard", label: "Dashboard" },
  { href: "/seller/orders", label: "Pesanan" },
  { href: "/seller/products/new", label: "Tambah Produk" },
] as const;

export function SellerNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Menu toko" className="flex flex-wrap items-center gap-2">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={active ? "tab tab-active" : "tab"}
          >
            {link.label}
          </Link>
        );
      })}
      <Link href="/" className="tab ml-auto">
        Ke toko
      </Link>
    </nav>
  );
}
