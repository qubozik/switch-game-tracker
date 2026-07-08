/**
 * Backfill IGDB page URLs for games that have an igdb_id but no igdb_url.
 *   npx tsx scripts/backfill-igdb-urls.ts
 */
import "dotenv/config";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import postgres from "postgres";

async function token() {
  const r = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${process.env.IGDB_CLIENT_ID}&client_secret=${process.env.IGDB_CLIENT_SECRET}&grant_type=client_credentials`,
    { method: "POST" },
  );
  return (await r.json()).access_token as string;
}

async function main() {
  const s = postgres(process.env.POSTGRES_URL || process.env.DATABASE_URL || "", { prepare: false, max: 1 });
  const tk = await token();

  const rows = (await s`select id, igdb_id from games where igdb_id is not null`) as {
    id: number;
    igdb_id: number;
  }[];
  const ids = rows.map((r) => r.igdb_id);
  console.log(`Fetching URLs for ${ids.length} games...`);

  const urlById = new Map<number, string>();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const res = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": process.env.IGDB_CLIENT_ID!,
        Authorization: `Bearer ${tk}`,
        "Content-Type": "text/plain",
      },
      body: `fields id,url; where id = (${chunk.join(",")}); limit 500;`,
    });
    const data = (await res.json()) as { id: number; url?: string }[];
    for (const g of data) if (g.url) urlById.set(g.id, g.url);
  }

  let updated = 0;
  for (const r of rows) {
    const url = urlById.get(r.igdb_id);
    if (url) {
      await s`update games set igdb_url = ${url} where id = ${r.id}`;
      updated++;
    }
  }
  console.log(`Set igdb_url for ${updated}/${rows.length} games.`);
  await s.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
