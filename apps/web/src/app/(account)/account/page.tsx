import type { Metadata } from "next";
import Link from "next/link";
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
      {user.role === "buyer" && (
        <Link href="/seller/onboarding" className="btn-dashed">
          Buka toko
        </Link>
      )}
      <SignOutButton />
    </section>
  );
}
