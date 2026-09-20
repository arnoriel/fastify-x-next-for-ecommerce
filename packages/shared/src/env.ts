import { z } from "zod";

export const envPort = z.coerce.number().int().min(1).max(65535);
export const httpUrl = z.url({ protocol: /^https?$/ });

/** Validate env against a Zod schema; throws one readable message listing every problem. */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined>,
  label: string,
): z.output<T> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;

  const problems = result.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");

  throw new Error(
    `[${label}] Invalid environment variables:\n${problems}\n\n` +
      `Fix: run \`npm run setup\` (creates .env from .env.example), then edit ${label}/.env`,
  );
}
