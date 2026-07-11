import { db } from "@/db";
import { games, type NewGame } from "@/db/schema";
import {
  getOwnedGames,
  getWishlistAppIds,
  getAppDetails,
  steamCapsule,
  steamStoreUrl,
} from "@/lib/steam";
import { isNotNull, sql } from "drizzle-orm";

export type SteamSyncResult = {
  ownedSynced: number;
  wishlistFound: number;
  wishlistAdded: number;
  wishlistPending: number;
  ranAt: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One-way Steam -> app sync. Owned games become status=owned; wishlist items
 * become status=wanted. Never deletes; preserves manual non-status edits.
 */
export async function runSteamSync(opts?: {
  wishlistCap?: number;
}): Promise<SteamSyncResult> {
  const wishlistCap = opts?.wishlistCap ?? 40;

  // --- Owned ---
  const owned = await getOwnedGames();
  const ownedRows: NewGame[] = owned.map((o) => ({
    steamAppId: o.appId,
    title: o.name,
    platform: "Steam",
    library: "steam",
    source: "steam",
    status: "owned",
    released: true,
    physicalFormat: "Digital Only",
    formatSource: "steam",
    coverImageUrl: steamCapsule(o.appId),
    storeUrl: steamStoreUrl(o.appId),
    playtimeMinutes: o.playtimeMinutes,
    needsReview: false,
  }));

  if (ownedRows.length) {
    await db
      .insert(games)
      .values(ownedRows)
      .onConflictDoUpdate({
        target: games.steamAppId,
        set: {
          title: sql`excluded.title`,
          playtimeMinutes: sql`excluded.playtime_minutes`,
          storeUrl: sql`excluded.store_url`,
          coverImageUrl: sql`coalesce(${games.coverImageUrl}, excluded.cover_image_url)`,
          status: sql`'owned'`,
          released: sql`true`,
          lastUpdated: sql`now()`,
        },
      });
  }

  // --- Wishlist ---
  const wishlist = await getWishlistAppIds();
  const existingRows = await db
    .select({ steamAppId: games.steamAppId })
    .from(games)
    .where(isNotNull(games.steamAppId));
  const existing = new Set(
    existingRows.map((r) => r.steamAppId).filter((x): x is number => x != null),
  );

  const newWishlist = wishlist.filter((appId) => !existing.has(appId));
  const toProcess = newWishlist.slice(0, wishlistCap);

  const wishRows: NewGame[] = [];
  for (const appId of toProcess) {
    const d = await getAppDetails(appId);
    await sleep(350); // storefront rate limit
    if (!d) continue;
    wishRows.push({
      steamAppId: appId,
      title: d.name,
      platform: "Steam",
      library: "steam",
      source: "steam",
      status: "wanted",
      released: d.released,
      releaseDate: d.releaseDate,
      description: d.description,
      genre: d.genre,
      physicalFormat: "Digital Only",
      formatSource: "steam",
      coverImageUrl: steamCapsule(appId),
      storeUrl: steamStoreUrl(appId),
      needsReview: false,
    });
  }

  let wishlistAdded = 0;
  if (wishRows.length) {
    const inserted = await db
      .insert(games)
      .values(wishRows)
      .onConflictDoNothing({ target: games.steamAppId })
      .returning({ id: games.id });
    wishlistAdded = inserted.length;
  }

  return {
    ownedSynced: ownedRows.length,
    wishlistFound: wishlist.length,
    wishlistAdded,
    wishlistPending: Math.max(0, newWishlist.length - toProcess.length),
    ranAt: new Date().toISOString(),
  };
}
