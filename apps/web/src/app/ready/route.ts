import { NextResponse } from "next/server";
import { getApiReadiness } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Readiness: web siap melayani bila API (dan lewat /ready API: Postgres + Redis) siap. 503 bila tidak. */
export async function GET() {
  const api = await getApiReadiness();
  const ok = api?.status === "ok";
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", checks: { api: ok ? "up" : "down" }, timestamp: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
