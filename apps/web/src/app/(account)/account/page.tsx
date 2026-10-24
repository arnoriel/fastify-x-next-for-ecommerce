import type { Metadata } from "next";
import Link from "next/link";
import { features } from "@ecommerce/shared";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Akun saya" };
export const dynamic = "force-dynamic";

const ROLE_LABEL = { buyer: "Pembeli", seller: "Penjual", admin: "Admin" } as const;

export default async function AccountPage() {
  const user = await requireUser({ next: "/account" });

  return (
    <section className="form">
      <h1>Akun saya</h1>
      <dl className="kv">
        <dt>Nama</dt>
        <dd>{user.name}</dd>
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Peran</dt>
        <dd>{ROLE_LABEL[user.role]}</dd>
      </dl>
      <Link href="/orders" className="btn">
        Riwayat pesanan
      </Link>
      {features.wishlist && (
        <Link href="/wishlist" className="btn">
          Wishlist
        </Link>
      )}
      <Link href="/disputes" className="btn">
        Laporan &amp; sengketa
      </Link>
      {user.role === "admin" && (
        <Link href="/admin" className="btn">
          Panel admin
        </Link>
      )}
      {user.role === "seller" && (
        <Link href="/seller/dashboard" className="btn">
          Dashboard toko
        </Link>
      )}
      {features.multiSeller && user.role === "buyer" && (
        <Link href="/seller/onboarding" className="btn-dashed">
          Buka toko
        </Link>
      )}
      <SignOutButton />
    </section>
  );
}
