import { NextResponse } from "next/server";
import { db } from "@/db";
import { games } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(games).orderBy(desc(games.releaseDate));
  return NextResponse.json({ games: rows });
}
