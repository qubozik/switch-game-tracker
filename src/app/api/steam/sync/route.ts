import { NextResponse } from "next/server";
import { runSteamSync } from "@/lib/steam-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle() {
  try {
    const result = await runSteamSync();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export const POST = handle;
export const GET = handle;
