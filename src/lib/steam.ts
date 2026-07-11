/**
 * Steam Web API + storefront helpers.
 * Requires STEAM_API_KEY and STEAM_ID (SteamID64) env vars.
 */

const API = "https://api.steampowered.com";
const STORE = "https://store.steampowered.com";

function creds() {
  const key = process.env.STEAM_API_KEY;
  const steamId = process.env.STEAM_ID;
  if (!key || !steamId) {
    throw new Error("STEAM_API_KEY / STEAM_ID are not set.");
  }
  return { key, steamId };
}

/** Portrait library capsule — matches the app's 3:4 cover cards. */
export function steamCapsule(appId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
}

export function steamStoreUrl(appId: number): string {
  return `https://store.steampowered.com/app/${appId}`;
}

export type SteamOwned = {
  appId: number;
  name: string;
  playtimeMinutes: number;
};

export async function getOwnedGames(): Promise<SteamOwned[]> {
  const { key, steamId } = creds();
  const url = `${API}/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Steam GetOwnedGames ${res.status}`);
  const data = (await res.json()) as {
    response?: { games?: { appid: number; name: string; playtime_forever?: number }[] };
  };
  return (data.response?.games ?? []).map((g) => ({
    appId: g.appid,
    name: g.name,
    playtimeMinutes: g.playtime_forever ?? 0,
  }));
}

export async function getWishlistAppIds(): Promise<number[]> {
  const { key, steamId } = creds();
  const url = `${API}/IWishlistService/GetWishlist/v1/?key=${key}&steamid=${steamId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Steam GetWishlist ${res.status}`);
  const data = (await res.json()) as {
    response?: { items?: { appid: number }[] };
  };
  return (data.response?.items ?? []).map((i) => i.appid);
}

export type SteamAppDetails = {
  appId: number;
  name: string;
  releaseDate: string | null;
  released: boolean;
  description: string | null;
  genre: string[];
};

/** Storefront appdetails (name, release, genres) for a single app. */
export async function getAppDetails(appId: number): Promise<SteamAppDetails | null> {
  const res = await fetch(
    `${STORE}/api/appdetails?appids=${appId}&cc=us&l=en`,
    { headers: { "Accept-Language": "en" } },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as Record<
    string,
    { success: boolean; data?: Record<string, unknown> }
  >;
  const entry = json[String(appId)];
  if (!entry?.success || !entry.data) return null;
  const d = entry.data as {
    name?: string;
    release_date?: { coming_soon?: boolean; date?: string };
    short_description?: string;
    genres?: { description: string }[];
  };
  let releaseDate: string | null = null;
  if (d.release_date?.date) {
    const t = Date.parse(d.release_date.date);
    if (!Number.isNaN(t)) releaseDate = new Date(t).toISOString().slice(0, 10);
  }
  return {
    appId,
    name: d.name ?? `App ${appId}`,
    releaseDate,
    released: !d.release_date?.coming_soon,
    description: d.short_description ?? null,
    genre: (d.genres ?? []).map((g) => g.description),
  };
}

export type SteamSearchResult = {
  steamAppId: number;
  name: string;
  coverUrl: string | null;
};

export async function searchSteam(query: string): Promise<SteamSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const res = await fetch(
    `${STORE}/api/storesearch/?term=${encodeURIComponent(q)}&cc=us&l=en`,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    items?: { id: number; name: string }[];
  };
  return (data.items ?? []).map((i) => ({
    steamAppId: i.id,
    name: i.name,
    coverUrl: steamCapsule(i.id),
  }));
}
