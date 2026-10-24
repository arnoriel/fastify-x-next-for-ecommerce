import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness: proses Next hidup. Dipakai Docker healthcheck / uptime monitor. Tidak menyentuh dependency. */
export function GET() {
  return NextResponse.json(
    { status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
