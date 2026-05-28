// Hero portrait palette — pinned to globals.css's tier ladder.
//
// Identical lineage to the subscription tier ladder, so portraits read as
// part of the same family as the rest of the app. The pubkey never drives
// color; only composition. See docs/design/HERO_PORTRAITS.md §3.

export type HeroTier = 0 | 1 | 2 | 3 | 4;

export interface TierAccent {
  /** Primary stroke / halo color */
  primary: string;
  /** Bright variant — frame inlay, rim highlights */
  bright: string;
  /** Optional inlay color (Legendary/Mythic only) */
  inlay?: string;
}

export const TIER_ACCENT: Readonly<Record<HeroTier, TierAccent>> = {
  // Common: antique gold — the icon-system baseline.
  0: { primary: "#C9A961", bright: "#dbc185" },
  // Rare: bronze — matches subscription tier 1.
  1: { primary: "#CD7F32", bright: "#D4944A" },
  // Epic: sovereign gold — matches subscription tier 2.
  2: { primary: "#daa520", bright: "#f1af09" },
  // Legendary: bright gold + crimson hairline inlay.
  3: { primary: "#f1af09", bright: "#fde047", inlay: "#9a2222" },
  // Mythic: crimson + bright gold heraldry. Top of the ladder.
  4: { primary: "#8B1A1A", bright: "#9a2222", inlay: "#f1af09" },
};

export const STATE_GLOW = {
  // Hero is locked (in expedition, castle defense, etc.). Cairn 'working'.
  locked: "#b07d2b",
  // Hero in threatened combat state. Cairn 'threatened'.
  threatened: "#a23a2c",
} as const;

/** Composition background — matches every existing icon's solid black. */
export const BG_SOLID = "#000000";

/** Constellation dot tint — antique gold, drawn at 4-12% alpha. */
export const STAR_TINT = "#C9A961";

export function isHeroTier(n: number): n is HeroTier {
  return n === 0 || n === 1 || n === 2 || n === 3 || n === 4;
}
