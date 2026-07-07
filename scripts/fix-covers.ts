/**
 * Bulk-repair covers: match games with local /covers/ art to IGDB by title and
 * replace with IGDB official cover art where a confident match exists.
 *   npx tsx scripts/fix-covers.ts          (dry run)
 *   npx tsx scripts/fix-covers.ts --apply  (write changes)
 */
import "dotenv/config";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql as dsql } from "drizzle-orm";
import { games } from "../src/db/schema";

const APPLY = process.argv.includes("--apply");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

async function igdbToken(): Promise<string> {
  const id = process.env.IGDB_CLIENT_ID!;
  const secret = process.env.IGDB_CLIENT_SECRET!;
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`,
    { method: "POST" },
  );
  return (await res.json()).access_token;
}

type Hit = { id: number; name: string; cover?: { image_id: string } };

async function search(title: string, token: string): Promise<Hit[]> {
  const res = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      "Client-ID": process.env.IGDB_CLIENT_ID!,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body: `search "${title.replace(/"/g, "")}"; fields name,cover.image_id; limit 10;`,
  });
  if (!res.ok) return [];
  return (await res.json()) as Hit[];
}

function bestMatch(title: string, hits: Hit[]): Hit | null {
  const nt = norm(title);
  // 1. exact normalized match with a cover
  for (const h of hits) {
    if (h.cover && norm(h.name) === nt) return h;
  }
  // 2. IGDB name is a strong substring of our title (edition suffixes), or vice versa
  for (const h of hits) {
    if (!h.cover) continue;
    const nn = norm(h.name);
    if (nn.length >= 8 && (nt.includes(nn) || nn.includes(nt))) return h;
  }
  return null;
}

async function main() {
  const cs = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
  const client = postgres(cs, { prepare: false, max: 1 });
  const db = drizzle(client, { schema: { games } });
  const token = await igdbToken();

  const all = await db
    .select({ id: games.id, title: games.title, igdbId: games.igdbId, cover: games.coverImageUrl })
    .from(games);
  const usedIgdbIds = new Set(all.map((g) => g.igdbId).filter((x): x is number => x != null));

  const targets = all.filter((g) => (g.cover ?? "").startsWith("/covers/"));
  console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — ${targets.length} games with local covers to check\n`);

  let fixed = 0;
  const unmatched: string[] = [];
  for (const g of targets) {
    const hits = await search(g.title, token);
    await sleep(300);
    const m = bestMatch(g.title, hits);
    if (!m || !m.cover) {
      unmatched.push(g.title);
      continue;
    }
    const url = `https://images.igdb.com/igdb/image/upload/t_cover_big/${m.cover.image_id}.jpg`;
    const linkId = g.igdbId == null && !usedIgdbIds.has(m.id) ? m.id : g.igdbId;
    console.log(`  ✓ ${g.title}\n      -> ${url}${linkId !== g.igdbId ? `  (link igdb ${linkId})` : ""}`);
    if (APPLY) {
      await db
        .update(games)
        .set({ coverImageUrl: url, igdbId: linkId, lastUpdated: dsql`now()` })
        .where(eq(games.id, g.id));
      if (linkId != null) usedIgdbIds.add(linkId);
    }
    fixed++;
  }

  console.log(`\n${APPLY ? "Updated" : "Would update"} ${fixed}/${targets.length}.`);
  if (unmatched.length) {
    console.log(`\nNo confident match (left as-is): ${unmatched.length}`);
    unmatched.forEach((t) => console.log("  -", t));
  }
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
