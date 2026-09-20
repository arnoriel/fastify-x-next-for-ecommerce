import { z } from "zod";

// Sumber kebenaran tunggal untuk role & status user (dipakai DB enum, guard API, dan UI).
export const ROLES = ["buyer", "seller", "admin"] as const;
export const USER_STATUSES = ["active", "suspended", "banned"] as const;

export const roleSchema = z.enum(ROLES);
export const userStatusSchema = z.enum(USER_STATUSES);

export type Role = z.infer<typeof roleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

// Nomor HP Indonesia: 08xx / +628xx / 628xx, 9-13 digit setelah prefix.
const idPhone = /^(?:\+?62|0)8\d{8,11}$/;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Password minimal ${PASSWORD_MIN} karakter`)
  .max(PASSWORD_MAX, `Password maksimal ${PASSWORD_MAX} karakter`)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Password harus mengandung huruf dan angka");

// Bersihkan (trim + lowercase) SEBELUM validasi format: z.email() menolak spasi di ujung,
// padahal copy-paste email sering membawa spasi.
const emailSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.email("Email tidak valid"),
);

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter").max(100),
  email: emailSchema,
  password: passwordSchema,
  phone: z
    .string()
    .trim()
    .regex(idPhone, "Nomor HP tidak valid")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password wajib diisi"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/** Bentuk user yang aman dikirim ke client (tanpa field internal). */
export const sessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable().optional(),
  role: roleSchema,
  status: userStatusSchema,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const meResponseSchema = z.object({ user: sessionUserSchema });
export type MeResponse = z.infer<typeof meResponseSchema>;

export const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
