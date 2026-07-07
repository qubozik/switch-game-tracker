/**
 * Backfill IGDB critic ratings for existing games.
 *   npx tsx scripts/backfill-scores.ts
 * Requires POSTGRES_URL/DATABASE_URL and IGDB_CLIENT_ID/SECRET.
 */
import "dotenv/config";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql as dsql } from "drizzle-orm";
import { games } from "../src/db/schema";
import { fetchRecentSwitchGames } from "../src/lib/igdb";

async function main() {
  const cs = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
  if (!cs) throw new Error("POSTGRES_URL not set");
  const client = postgres(cs, { prepare: false, max: 1 });
  const db = drizzle(client, { schema: { games } });

  console.log("Fetching IGDB catalog (wide window) for ratings...");
  const catalog = await fetchRecentSwitchGames({ sinceDays: 1500, untilDays: 500 });
  const byTitle = new Map<string, number | null>();
  const byIgdb = new Map<number, number | null>();
  for (const c of catalog) {
    byTitle.set(c.title.toLowerCase(), c.igdbRating);
    byIgdb.set(c.igdbId, c.igdbRating);
  }

  const rows = await db
    .select({ id: games.id, title: games.title, igdbId: games.igdbId, igdbRating: games.igdbRating })
    .from(games);

  let updated = 0;
  for (const g of rows) {
    const rating =
      (g.igdbId != null ? byIgdb.get(g.igdbId) : undefined) ??
      byTitle.get(g.title.toLowerCase()) ??
      null;
    if (rating != null && rating !== g.igdbRating) {
      await db
        .update(games)
        .set({ igdbRating: rating, lastUpdated: dsql`now()` })
        .where(eq(games.id, g.id));
      updated++;
      console.log(`  ✓ ${g.title} -> IGDB ${rating}`);
    }
  }
  console.log(`\nUpdated ${updated}/${rows.length} games with an IGDB rating.`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
