// Per-dungeon cosmetic metadata for the splash art. Keyed off the chain
// `dungeonId` (== templateId 1..=4 from cli/data/dungeons.ts; the PDA
// derives from templateId and stores it as dungeonId). The slug + id
// reproduce the export filenames in images/dungeons/dungeons.json, and
// the accent mirrors the rim-light color baked into each subject prompt
// (surfaced here as the runtime CSS frame ring per docs/design/DUNGEON_ART.md).

interface DungeonArt {
  slug: string;
  accent: string;
}

const DUNGEON_ART: Record<number, DungeonArt> = {
  1: { slug: "goblin-caves", accent: "#D97A3A" },
  2: { slug: "shadow-crypt", accent: "#8E6FCB" },
  3: { slug: "dragons-lair", accent: "#C7423A" },
  4: { slug: "abyssal-depths", accent: "#3C8A9E" },
};

// Splash path for a dungeon, or null when the id has no art (the four
// seeded dungeons are the only ones; an unknown id means render nothing).
export function dungeonSplashPath(dungeonId: number, boss = false): string | null {
  const art = DUNGEON_ART[dungeonId];
  if (!art) return null;
  return `/img/dungeons/dungeon-${dungeonId}-${art.slug}${boss ? "-boss" : ""}.webp`;
}

export function dungeonAccent(dungeonId: number): string | null {
  return DUNGEON_ART[dungeonId]?.accent ?? null;
}
