/**
 * Accuracy test for detectFormat (Brave + optional LLM).
 *   npx tsx scripts/detect-test.ts
 * Uses BRAVE_API_KEY and, if set, LLM_API_KEY/LLM_BASE_URL/LLM_MODEL from .env.local.
 * Publisher is left null so every game exercises the Brave+LLM path.
 */
import "dotenv/config";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { detectFormat } from "../src/lib/format-detect";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const GAMES: [string, string][] = [
  ["Mario Kart World", "Full Cart"],
  ["Donkey Kong Bananza", "Full Cart"],
  ["Cyberpunk 2077 Ultimate Edition", "Full Cart"],
  ["Bravely Default Flying Fairy HD Remaster", "Full Cart"],
  ["Kirby Air Riders", "Full Cart"],
  ["Super Mario Party Jamboree", "Full Cart"],
  ["Street Fighter 6", "Key Card"],
  ["Hogwarts Legacy", "Key Card"],
  ["Star Wars Outlaws", "Key Card"],
  ["Sonic X Shadow Generations", "Key Card"],
  ["Yakuza 0 Director's Cut", "Key Card"],
  ["Final Fantasy VII Remake Intergrade", "Key Card"],
];

async function main() {
  console.log("LLM:", process.env.LLM_API_KEY ? `${process.env.LLM_MODEL || "gpt-4o-mini"} @ ${process.env.LLM_BASE_URL || "openai"}` : "(disabled - regex fallback)");
  let correct = 0;
  for (const [title, truth] of GAMES) {
    const det = await detectFormat({ title, publisher: null });
    const ok = det.format === truth;
    correct += ok ? 1 : 0;
    console.log(
      `[${ok ? "OK " : "MISS"}] ${title.padEnd(42)} guess=${det.format.padEnd(12)} truth=${truth.padEnd(10)} (${det.source}/${det.confidence})`,
    );
    await sleep(1200);
  }
  console.log(`\nAccuracy: ${correct}/${GAMES.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
