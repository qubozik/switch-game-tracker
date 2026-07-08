import { db } from "@/db";
import { games, type NewGame } from "@/db/schema";
import { fetchRecentSwitchGames } from "@/lib/igdb";
import { detectFormat, type FormatDetection } from "@/lib/format-detect";
import { eq, inArray, sql } from "drizzle-orm";

export type SyncResult = {
  added: number;
  skipped: number;
  refreshed: number;
  formatsDetected: number;
  braveLookups: number;
  addedTitles: string[];
  ranAt: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Weekly sync:
 *  - Discover new Switch/Switch 2 releases from IGDB and insert them, with
 *    best-effort physical-format detection (Nintendo prior + Brave/LLM).
 *  - Refresh existing games' IGDB critic rating + release date/status (so
 *    score-less and upcoming titles fill in over time). Personal fields
 *    (status, physicalFormat, etc.) are never touched by the refresh.
 */
export async function runSync(): Promise<SyncResult> {
  const candidates = await fetchRecentSwitchGames();

  const igdbIds = candidates.map((c) => c.igdbId);
  const titles = candidates.map((c) => c.title);

  const existing = igdbIds.length
    ? await db
        .select({
          id: games.id,
          igdbId: games.igdbId,
          title: games.title,
          igdbRating: games.igdbRating,
          releaseDate: games.releaseDate,
          released: games.released,
          coverImageUrl: games.coverImageUrl,
          igdbUrl: games.igdbUrl,
        })
        .from(games)
        .where(
          sql`${inArray(games.igdbId, igdbIds)} OR ${inArray(games.title, titles)}`,
        )
    : [];

  type ExistingRow = (typeof existing)[number];
  const byIgdb = new Map<number, ExistingRow>();
  const byTitle = new Map<string, ExistingRow>();
  for (const e of existing) {
    if (e.igdbId != null) byIgdb.set(e.igdbId, e);
    byTitle.set(e.title.toLowerCase(), e);
  }

  // Partition candidates into refresh-existing vs. insert-new.
  const newGames: typeof candidates = [];
  const updates: { id: number; data: Record<string, unknown> }[] = [];
  for (const c of candidates) {
    const match = byIgdb.get(c.igdbId) ?? byTitle.get(c.title.toLowerCase());
    if (!match) {
      newGames.push(c);
      continue;
    }
    const data: Record<string, unknown> = {};
    if (c.igdbRating != null && c.igdbRating !== match.igdbRating) {
      data.igdbRating = c.igdbRating;
    }
    if (c.releaseDate && c.releaseDate !== match.releaseDate) {
      data.releaseDate = c.releaseDate;
    }
    if (c.released !== match.released) {
      data.released = c.released;
    }
    // Fill in a missing cover, but never overwrite one we already have.
    if (!match.coverImageUrl && c.coverImageUrl) {
      data.coverImageUrl = c.coverImageUrl;
    }
    if (!match.igdbUrl && c.igdbUrl) {
      data.igdbUrl = c.igdbUrl;
    }
    if (Object.keys(data).length) updates.push({ id: match.id, data });
  }

  // Apply refreshes.
  let refreshed = 0;
  for (const u of updates) {
    await db
      .update(games)
      .set({ ...u.data, lastUpdated: sql`now()` })
      .where(eq(games.id, u.id));
    refreshed++;
  }

  // Detect formats + insert new games.
  const hasBrave = !!process.env.BRAVE_API_KEY;
  const maxLookups = Number(process.env.SYNC_MAX_FORMAT_LOOKUPS ?? 15);
  let braveLookups = 0;
  let formatsDetected = 0;

  const toInsert: NewGame[] = [];
  for (const c of newGames) {
    const isNintendo = !!c.publisher && /nintendo/i.test(c.publisher);

    let det: FormatDetection = {
      format: "Unknown",
      confidence: "low",
      source: "none",
    };
    if (isNintendo) {
      det = await detectFormat({ title: c.title, publisher: c.publisher });
    } else if (hasBrave && braveLookups < maxLookups) {
      det = await detectFormat({ title: c.title, publisher: c.publisher });
      braveLookups++;
      await sleep(1100); // Brave free tier: ~1 req/sec
    }

    const applied = det.format !== "Unknown" && det.confidence !== "low";
    if (applied) formatsDetected++;

    toInsert.push({
      igdbId: c.igdbId,
      title: c.title,
      releaseDate: c.releaseDate,
      released: c.released,
      platform: c.platform,
      genre: c.genre,
      coverImageUrl: c.coverImageUrl,
      igdbUrl: c.igdbUrl,
      description: c.description,
      igdbRating: c.igdbRating,
      physicalFormat: applied ? det.format : "Unknown",
      formatSource: applied ? det.source : null,
      needsReview: !(applied && det.confidence === "high"),
      source: "igdb",
    });
  }

  let added = 0;
  const addedTitles: string[] = [];
  if (toInsert.length) {
    const inserted = await db
      .insert(games)
      .values(toInsert)
      .onConflictDoNothing()
      .returning({ title: games.title });
    added = inserted.length;
    addedTitles.push(...inserted.map((r) => r.title));
  }

  return {
    added,
    skipped: candidates.length - added,
    refreshed,
    formatsDetected,
    braveLookups,
    addedTitles,
    ranAt: new Date().toISOString(),
  };
}
