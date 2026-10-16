/**
 * Nama constraint unique yang dilanggar (Postgres 23505), atau null bila bukan itu.
 * drizzle-orm membungkus error driver di `cause`, jadi rantai penyebab ditelusuri.
 */
export function uniqueViolationConstraint(err: unknown): string | null {
  let cursor: unknown = err;
  for (let depth = 0; depth < 4 && cursor && typeof cursor === "object"; depth += 1) {
    const e = cursor as { code?: unknown; constraint_name?: unknown; constraint?: unknown; cause?: unknown };
    if (e.code === "23505") {
      const name = e.constraint_name ?? e.constraint;
      return typeof name === "string" ? name : "";
    }
    cursor = e.cause;
  }
  return null;
}
