import type { CheckStatus } from "@ecommerce/shared";

/** Jalankan dependency check dengan timeout; tidak pernah throw. */
export async function probe(check: () => Promise<unknown>, timeoutMs = 2000): Promise<CheckStatus> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return "up";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}
