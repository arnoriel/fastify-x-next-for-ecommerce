"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { loginSchema, registerSchema } from "@ecommerce/shared";
import { authClient } from "@/lib/auth-client";
import { mergeGuestCart } from "@/lib/cart-api";
import { clearGuestCart, readGuestCart } from "@/lib/guest-cart";
import { safeNext } from "@/lib/redirect";

type Mode = "login" | "register";
type FieldErrors = Partial<Record<"name" | "email" | "password" | "phone", string>>;

const COPY = {
  login: {
    title: "Masuk",
    submit: "Masuk",
    pending: "Memproses…",
    alt: { text: "Belum punya akun?", href: "/register", label: "Daftar" },
  },
  register: {
    title: "Daftar",
    submit: "Buat akun",
    pending: "Memproses…",
    alt: { text: "Sudah punya akun?", href: "/login", label: "Masuk" },
  },
} as const;

// Pesan ramah untuk error umum Better Auth; sisanya tampil apa adanya dari server.
function humanize(status: number | undefined, message: string | undefined): string {
  if (status === 429) return "Terlalu banyak percobaan. Coba lagi sebentar lagi.";
  if (status === 401) return "Email atau password salah.";
  if (status === 403) return message ?? "Akses ditolak.";
  if (status === 422 || status === 409) return message ?? "Data tidak dapat diproses.";
  return message ?? "Terjadi kesalahan. Coba lagi.";
}

export function AuthForm({ mode, next }: { mode: Mode; next?: string }) {
  const router = useRouter();
  const copy = COPY[mode];
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return; // cegah double submit
    setFormError(null);

    const raw = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const parsed = (mode === "login" ? loginSchema : registerSchema).safeParse(raw);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FieldErrors;
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setPending(true);

    try {
      const result =
        mode === "login"
          ? await authClient.signIn.email(parsed.data as { email: string; password: string })
          : await authClient.signUp.email(
              parsed.data as { name: string; email: string; password: string; phone?: string },
            );

      if (result.error) {
        setFormError(humanize(result.error.status, result.error.message));
        return;
      }

      // T-03 [V3]: guest cart (localStorage) di-merge ke cart backend akun yang baru login.
      // Gagal merge TIDAK memblokir login (best-effort) — buyer tetap masuk, hanya cart
      // guest-nya yang mungkin tidak ikut, lebih baik daripada login gagal karena hal lain.
      const guestItems = readGuestCart();
      if (guestItems.length > 0) {
        try {
          await mergeGuestCart(guestItems);
          clearGuestCart();
        } catch {
          // biarkan guest cart tersimpan — bisa dicoba lagi lain waktu, tidak hilang diam-diam.
        }
      }

      // refresh() agar server component (guard/getSession) membaca cookie baru.
      router.replace(safeNext(next));
      router.refresh();
    } catch {
      setFormError("Tidak dapat terhubung ke server. Periksa koneksi Anda.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit} noValidate aria-busy={pending}>
      <h1>{copy.title}</h1>

      {formError && (
        <p className="alert" role="alert">
          {formError}
        </p>
      )}

      {mode === "register" && (
        <Field label="Nama lengkap" name="name" autoComplete="name" error={errors.name} />
      )}
      <Field label="Email" name="email" type="email" autoComplete="email" error={errors.email} />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        error={errors.password}
        hint={mode === "register" ? "Minimal 8 karakter, kombinasi huruf dan angka." : undefined}
      />
      {mode === "register" && (
        <Field
          label="No. HP (opsional)"
          name="phone"
          type="tel"
          autoComplete="tel"
          error={errors.phone}
          hint="Contoh: 081234567890"
        />
      )}

      <button className="btn" type="submit" disabled={pending}>
        {pending ? copy.pending : copy.submit}
      </button>

      <p className="muted small">
        {copy.alt.text}{" "}
        <Link href={next ? `${copy.alt.href}?next=${encodeURIComponent(next)}` : copy.alt.href}>
          {copy.alt.label}
        </Link>
      </p>
    </form>
  );
}

function Field(props: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  error?: string;
  hint?: string;
}) {
  const id = `f-${props.name}`;
  const describedBy = props.error ? `${id}-err` : props.hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        name={props.name}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy}
      />
      {props.error ? (
        <span id={`${id}-err`} className="field-error">
          {props.error}
        </span>
      ) : props.hint ? (
        <span id={`${id}-hint`} className="muted small">
          {props.hint}
        </span>
      ) : null}
    </div>
  );
}
