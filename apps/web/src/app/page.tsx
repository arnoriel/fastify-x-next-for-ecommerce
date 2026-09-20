import type { CheckStatus } from "@ecommerce/shared";
import Link from "next/link";
import { getApiReadiness } from "@/lib/api";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [readiness, user] = await Promise.all([getApiReadiness(), getSession()]);

  const rows: [label: string, status: CheckStatus][] = [
    ["API", readiness ? "up" : "down"],
    ["PostgreSQL", readiness?.checks.database ?? "down"],
    ["Redis", readiness?.checks.redis ?? "down"],
  ];

  return (
    <main>
      <h1>Ecommerce</h1>
      <p className="muted">T-03 · Auth &amp; role-based access</p>
      <ul className="card">
        {rows.map(([label, status]) => (
          <li key={label}>
            <span>{label}</span>
            <span className={`pill ${status}`}>{status}</span>
          </li>
        ))}
      </ul>
      <nav className="nav">
        {user ? (
          <Link href="/account">Akun saya ({user.name})</Link>
        ) : (
          <>
            <Link href="/login">Masuk</Link>
            <Link href="/register">Daftar</Link>
          </>
        )}
      </nav>
    </main>
  );
}
