import { readinessSchema, type ReadinessResponse } from "@ecommerce/shared";
import { env } from "@/env";

/** Ambil /ready dari API. `null` = API tidak terjangkau. 503 tetap dibaca (body berisi detail check). */
export async function getApiReadiness(): Promise<ReadinessResponse | null> {
  try {
    const res = await fetch(new URL("/ready", env.NEXT_PUBLIC_API_URL), {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return readinessSchema.parse(await res.json());
  } catch {
    return null;
  }
}
