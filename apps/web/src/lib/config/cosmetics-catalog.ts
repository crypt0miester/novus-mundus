/**
 * Cosmetic catalog — DISPLAY METADATA ONLY.
 *
 * The on-chain `CosmeticsSection` (programs/novus_mundus/src/state/player.rs)
 * stores `equipped_<kind>: u16` IDs and `owned_<kind>: u64` ownership
 * bitmasks. This file is the off-chain bridge that maps those IDs to
 * what the player actually SEES — image URLs for badges, hex strings
 * for name colours, display strings for titles.
 *
 * Acquisition lives elsewhere: the shop's `ShopItem` row (with
 * `category = ShopCategory::Cosmetic`) is the source of truth for
 * price / window / supply / tier-gate. The catalog has no `unlock`
 * field on purpose — pricing is on the shop side, scarcity is on the
 * shop side, this file just describes what each cosmetic LOOKS LIKE.
 *
 * ID ranges (must match programs/novus_mundus/src/processor/shop/common.rs
 * cosmetic item_type decoding):
 *   1000–1063 → ShopItem item_type for badge id (item_type - 1000)
 *   1064–1127 → ShopItem item_type for title id (item_type - 1064)
 *   1128–1191 → ShopItem item_type for color id (item_type - 1128)
 * The id space per kind is u16; u64 ownership bitmask caps at 64 entries
 * per kind (one bit per id), which dovetails with the ranges above.
 */

export type CosmeticRarity = "common" | "rare" | "epic" | "legendary" | "mythic";

/**
 * `id` matches the on-chain `u16` slot. `id === 0` is reserved as
 * "nothing equipped" and never appears in these registries.
 */
export interface CosmeticBadgeEntry {
  id: number;
  name: string;
  flavorText?: string;
  rarity: CosmeticRarity;
  /** Path served from /public — eventually CDN-hosted PNG/SVG. */
  imgSrc: string;
}

export interface CosmeticTitleEntry {
  id: number;
  displayName: string;
  rarity: CosmeticRarity;
}

/**
 * Animation keys for cosmetic name colors. The string is used as both the
 * CSS class suffix (`.cosmetic-color-anim-pulse`) and the canvas/three.js
 * branch selector in the world-map renderers. Static colors leave this
 * undefined.
 *
 * All animations stay inside the warm theme palette (amber / bronze / gold /
 * crimson) so they read as one family with the tier ladder.
 *
 * - `pulse` — alpha breathes between full and ~45% over ~1.8s
 * - `embered` — occasional spark flash on top of the base hex
 * - `glimmer` — soft warm shimmer; lifts brightness toward gold and back
 * - `vesper` — slow 3-stop cycle through amber → gold → crimson
 * - `cinder` — drifting warm-orange overlay, low-frequency
 */
export type CosmeticColorAnimation = "pulse" | "embered" | "glimmer" | "vesper" | "cinder";

export interface CosmeticColorEntry {
  id: number;
  name: string;
  rarity: CosmeticRarity;
  /** Hex color string (`#rrggbb` or `#rrggbbaa`). */
  hex: string;
  /** Optional animation. When set, renderers should drive the color over time. */
  animation?: CosmeticColorAnimation;
}

export interface CosmeticFrameEntry {
  id: number;
  name: string;
  flavorText?: string;
  rarity: CosmeticRarity;
  /** Visual treatment for the frame ring. The renderer paints a border
   * around the wearer's badge/avatar using these values. */
  ring: {
    borderColor: string;
    borderWidth: number; // px
    borderStyle?: "solid" | "double" | "dashed";
    /** Optional `box-shadow` color for a soft glow halo. */
    glow?: string;
  };
}

/* ── Placeholder art ─────────────────────────────────────────────
 *
 * Stand-in inline-SVG data URIs so the catalog renders end-to-end
 * before real art ships. Each is a 64×64 circular crest with the
 * rarity-band ink at full saturation, a sealed-letter glyph hint,
 * and a parchment backing — enough that "badge equipped" reads
 * visually distinct from "no badge", without needing assets. Swap
 * to `/cosmetics/badges/<slug>.png` URIs once art lands. */

function placeholderBadgeSvg(letter: string, ringHex: string, glyphHex: string): string {
  // 64×64 viewBox. Ring + center sigil + small crown notch.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="28" fill="#efe2c4" stroke="${ringHex}" stroke-width="3"/>
    <circle cx="32" cy="32" r="20" fill="none" stroke="${ringHex}" stroke-width="1" stroke-dasharray="2 2" opacity="0.6"/>
    <text x="32" y="40" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="24" fill="${glyphHex}">${letter}</text>
    <path d="M 24 12 L 28 18 L 32 12 L 36 18 L 40 12" stroke="${ringHex}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  </svg>`;
  // RFC 2397: ";utf8" is non-standard and rejected by WebKit; ";charset=utf-8"
  // is the spec-compliant text encoding parameter and renders in Safari + iOS.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* ── Badges ──────────────────────────────────────────────────────
 *
 * IDs 1–5 reserved for the first cohort. Real shop rows publish at
 * item_type = 1000 + id. */

/* Per-rarity badge ring colors. Pulled from the tier ladder so badges
 * read with the same warm progression as subscription tiers. */
const BADGE_RING: Record<CosmeticRarity, { ring: string; glyph: string }> = {
  common: { ring: "#6e4e24", glyph: "#3a2a14" }, // amber-brown
  rare: { ring: "#CD7F32", glyph: "#6b3410" }, // bronze
  epic: { ring: "#daa520", glyph: "#92400e" }, // gold
  legendary: { ring: "#8B1A1A", glyph: "#4a0e0e" }, // crimson
  mythic: { ring: "#b41e1e", glyph: "#7a1010" }, // vivid red
};

export const COSMETIC_BADGES: Record<number, CosmeticBadgeEntry> = {
  1: {
    id: 1,
    name: "Kingdom Pioneer",
    flavorText: "Marched into the realm during its founding week.",
    rarity: "epic",
    imgSrc: placeholderBadgeSvg("P", BADGE_RING.epic.ring, BADGE_RING.epic.glyph),
  },
  2: {
    id: 2,
    name: "Genesis Patron",
    flavorText: "Among the first to fund the chronicler's quill.",
    rarity: "mythic",
    imgSrc: placeholderBadgeSvg("✦", BADGE_RING.mythic.ring, BADGE_RING.mythic.glyph),
  },
  3: {
    id: 3,
    name: "Vanguard's Mark",
    flavorText: "Worn by champions of the Vanguard tier.",
    rarity: "legendary",
    imgSrc: placeholderBadgeSvg("V", BADGE_RING.legendary.ring, BADGE_RING.legendary.glyph),
  },
  4: {
    id: 4,
    name: "Forgemaster",
    flavorText: "Hammered out a hundred legendary blades.",
    rarity: "rare",
    imgSrc: placeholderBadgeSvg("⚒", BADGE_RING.rare.ring, BADGE_RING.rare.glyph),
  },
  5: {
    id: 5,
    name: "Wanderer",
    flavorText: "Walked every road the realm had to give.",
    rarity: "common",
    imgSrc: placeholderBadgeSvg("⌖", BADGE_RING.common.ring, BADGE_RING.common.glyph),
  },
  6: {
    id: 6,
    name: "Crowned Patron",
    flavorText: "A seal cast in vermilion for those who hold the keystone.",
    rarity: "mythic",
    imgSrc: placeholderBadgeSvg("♛", BADGE_RING.mythic.ring, BADGE_RING.mythic.glyph),
  },
  7: {
    id: 7,
    name: "Sigilbearer",
    flavorText: "Carries the realm's mark into the deep places.",
    rarity: "legendary",
    imgSrc: placeholderBadgeSvg("✦", BADGE_RING.legendary.ring, BADGE_RING.legendary.glyph),
  },
  8: {
    id: 8,
    name: "Sun-Sealed",
    flavorText: "Bound to the daystar's older promises.",
    rarity: "epic",
    imgSrc: placeholderBadgeSvg("☉", BADGE_RING.epic.ring, BADGE_RING.epic.glyph),
  },
  9: {
    id: 9,
    name: "Goldleafed",
    flavorText: "A coronal flourish for those who paid their dues.",
    rarity: "rare",
    imgSrc: placeholderBadgeSvg("❀", BADGE_RING.rare.ring, BADGE_RING.rare.glyph),
  },
};

/* ── Titles ──────────────────────────────────────────────────────
 *
 * Short single-word displays that prefix or sit beside the player
 * name. Tier chip lives separately; title is the cosmetic flavour. */

export const COSMETIC_TITLES: Record<number, CosmeticTitleEntry> = {
  1: { id: 1, displayName: "Wayfarer", rarity: "common" },
  2: { id: 2, displayName: "Hearthkeeper", rarity: "rare" },
  3: { id: 3, displayName: "Stormcaller", rarity: "epic" },
  4: { id: 4, displayName: "Dungeon Conqueror", rarity: "legendary" },
  5: { id: 5, displayName: "Treasury Whale", rarity: "legendary" },
  6: { id: 6, displayName: "Realm Pillar", rarity: "mythic" },
  7: { id: 7, displayName: "Patron", rarity: "rare" },
  8: { id: 8, displayName: "Maecenas", rarity: "epic" },
  9: { id: 9, displayName: "Endowed", rarity: "legendary" },
  10: { id: 10, displayName: "Skirmisher", rarity: "rare" },
  11: { id: 11, displayName: "Lancer", rarity: "rare" },
  12: { id: 12, displayName: "Crossbowman", rarity: "rare" },
};

/* ── Name colours ────────────────────────────────────────────────
 *
 * The player's name (in dot tooltip, EntityPanel header, chat) is
 * tinted by `equipped_name_color`. Common is essentially ink (free
 * default); high rarities are saturated and signal spend. */

export const COSMETIC_COLORS: Record<number, CosmeticColorEntry> = {
  1: { id: 1, name: "Parchment Ink", rarity: "common", hex: "#2e1f10" },
  2: { id: 2, name: "Mossbark", rarity: "rare", hex: "#3f6b34" },
  3: { id: 3, name: "Ember", rarity: "rare", hex: "#b4571e" },
  4: { id: 4, name: "Royal Purple", rarity: "epic", hex: "#7B2CBF" },
  5: { id: 5, name: "Goldleaf", rarity: "legendary", hex: "#d4a330" },
  6: { id: 6, name: "Iridescent", rarity: "mythic", hex: "#a8e7d2" },
  // Material ladder — static colors, climbing the metal-rarity register.
  7: { id: 7, name: "Copper", rarity: "rare", hex: "#b87333" },
  8: { id: 8, name: "Electrum", rarity: "epic", hex: "#fad48a" },
  9: { id: 9, name: "Mithril", rarity: "legendary", hex: "#c0c8d3" },
  10: { id: 10, name: "Adamantine", rarity: "legendary", hex: "#4a5568" },
  11: { id: 11, name: "Obsidian", rarity: "mythic", hex: "#0d0a0e" },
  // Animated mythics — the base hex is the rendered fallback when an
  // animation host can't drive it (e.g. tooltips snapshotting a static frame).
  12: { id: 12, name: "Pulse", rarity: "mythic", hex: "#f1af09", animation: "pulse" },
  13: { id: 13, name: "Embered", rarity: "mythic", hex: "#b4571e", animation: "embered" },
  14: { id: 14, name: "Glimmer", rarity: "mythic", hex: "#daa520", animation: "glimmer" },
  15: { id: 15, name: "Vesper", rarity: "mythic", hex: "#CD7F32", animation: "vesper" },
  16: { id: 16, name: "Cinder", rarity: "mythic", hex: "#d97706", animation: "cinder" },
};

/* ── Avatar Frames ────────────────────────────────────────────── *
 * Wraps the badge / avatar in a rarity-themed ring. Renders via
 * <CosmeticFrame> in HTML contexts. Chain side: kind=0, item_type
 * range 1192–1255 (id = item_type - 1192). */

export const COSMETIC_FRAMES: Record<number, CosmeticFrameEntry> = {
  1: {
    id: 1,
    name: "Parchment Scroll",
    flavorText: "Edged in old vellum.",
    rarity: "common",
    ring: { borderColor: BADGE_RING.common.ring, borderWidth: 2, borderStyle: "solid" },
  },
  2: {
    id: 2,
    name: "Royal Crest",
    flavorText: "Two rings, like a herald's seal.",
    rarity: "epic",
    ring: {
      borderColor: BADGE_RING.epic.ring,
      borderWidth: 3,
      borderStyle: "double",
      glow: "rgba(218, 165, 32, 0.45)",
    },
  },
  3: {
    id: 3,
    name: "Dragon Coil",
    flavorText: "Beaten crimson curling around the sigil.",
    rarity: "legendary",
    ring: {
      borderColor: BADGE_RING.legendary.ring,
      borderWidth: 3,
      borderStyle: "solid",
      glow: "rgba(139, 26, 26, 0.50)",
    },
  },
  4: {
    id: 4,
    name: "Starlight Aureole",
    flavorText: "A halo for those who pay in stars.",
    rarity: "mythic",
    ring: {
      borderColor: BADGE_RING.mythic.ring,
      borderWidth: 3,
      borderStyle: "double",
      glow: "rgba(180, 30, 30, 0.55)",
    },
  },
};

/**
 * Rarity → border colour used by `<CosmeticBadge>` and
 * `<CosmeticTitleChip>`. Mirrors the tier ladder
 * (amber → bronze → gold → crimson → vivid-red) so cosmetic prestige
 * reads with the same warm progression as subscription tiers.
 */
export const RARITY_BORDER: Record<CosmeticRarity, string> = {
  common: "rgba(110, 78, 36, 0.55)", // amber-brown
  rare: "rgba(205, 127, 50, 0.85)", // bronze
  epic: "rgba(218, 165, 32, 0.90)", // gold
  legendary: "rgba(139, 26, 26, 0.90)", // crimson
  mythic: "rgba(180, 30, 30, 0.95)", // vivid red
};

/* ── Lookup helpers ─────────────────────────────────────────────
 *
 * All three accept `id === 0` and return null — callers can pass the
 * raw on-chain slot value without an extra guard. Same for unknown
 * IDs (catalog gaps, post-wipe stale data).
 */

export function getCosmeticBadge(id: number | undefined | null): CosmeticBadgeEntry | null {
  if (!id) return null;
  return COSMETIC_BADGES[id] ?? null;
}

export function getCosmeticTitle(id: number | undefined | null): CosmeticTitleEntry | null {
  if (!id) return null;
  return COSMETIC_TITLES[id] ?? null;
}

export function getCosmeticColor(id: number | undefined | null): CosmeticColorEntry | null {
  if (!id) return null;
  return COSMETIC_COLORS[id] ?? null;
}

export function getCosmeticFrame(id: number | undefined | null): CosmeticFrameEntry | null {
  if (!id) return null;
  return COSMETIC_FRAMES[id] ?? null;
}

/**
 * CSS class for the catalog entry's animation, or null when the color is
 * static. Pair with an inline `style={{ color: entry.hex }}` — the class
 * layers opacity / text-shadow / filter modulation on top, except `aurora`
 * which cycles through colors and overrides the inline hex.
 */
export function cosmeticColorAnimationClass(
  entry: CosmeticColorEntry | null | undefined,
): string | null {
  if (!entry?.animation) return null;
  return `cosmetic-color-anim-${entry.animation}`;
}

/* ── Canvas / WebGL animation driver ─────────────────────────────
 *
 * For the world map disc (Canvas 2D fallback + three.js city3d) the CSS
 * keyframes don't apply — we have to compute the current color at frame
 * time. `animatedColorAt(hex, animation, tMs)` returns normalized
 * `{ r, g, b, a }` (each 0..1) the renderer can format as `rgba(...)` for
 * canvas or feed into `THREE.Color.setRGB`. Periods + curves mirror the
 * CSS keyframes so HTML + map representations stay in visual sync. */

const TAU = Math.PI * 2;

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r / 255, g / 255, b / 255];
}

// Vesper cycles between these three stops — must match the CSS keyframe
// `cosmetic-anim-vesper` in globals.css. Theme palette: amber → gold → crimson.
const VESPER_STOPS: ReadonlyArray<[number, number, number]> = [
  [205 / 255, 127 / 255, 50 / 255], // #CD7F32 bronze-amber
  [218 / 255, 165 / 255, 32 / 255], // #daa520 gold
  [139 / 255, 26 / 255, 26 / 255], // #8B1A1A crimson
] as const;

export interface AnimatedColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function animatedColorAt(
  hex: string,
  animation: CosmeticColorAnimation,
  tMs: number,
): AnimatedColor {
  const [r0, g0, b0] = parseHex(hex);
  switch (animation) {
    case "pulse": {
      // 1.8s period, alpha breathes 0.45..1.0
      const a = 0.725 + 0.275 * Math.sin((tMs / 1800) * TAU);
      return { r: r0, g: g0, b: b0, a };
    }
    case "embered": {
      // 3.2s period; sharp brightness peak ~20% of the cycle
      const p = (Math.sin((tMs / 3200) * TAU) + 1) / 2;
      const k = 1 + 0.45 * p ** 4;
      return {
        r: Math.min(1, r0 * k),
        g: Math.min(1, g0 * k),
        b: Math.min(1, b0 * k),
        a: 1,
      };
    }
    case "glimmer": {
      // 4s period; soft warm shimmer — brightness lifts toward gold and back.
      const p = (Math.sin((tMs / 4000) * TAU) + 1) / 2;
      // Bias toward gold (#daa520 = ~218/165/32) at the peak. Blend the
      // base color toward gold by `p`.
      const tg = 218 / 255,
        tgg = 165 / 255,
        tgb = 32 / 255;
      return {
        r: r0 + (tg - r0) * 0.35 * p,
        g: g0 + (tgg - g0) * 0.35 * p,
        b: b0 + (tgb - b0) * 0.35 * p,
        a: 1,
      };
    }
    case "vesper": {
      // 6s period; three-stop warm cycle (amber → gold → crimson)
      const phase = (((tMs / 6000) % 1) + 1) % 1;
      const seg = phase * VESPER_STOPS.length;
      const idx = Math.floor(seg) % VESPER_STOPS.length;
      const next = (idx + 1) % VESPER_STOPS.length;
      const frac = seg - Math.floor(seg);
      const c0 = VESPER_STOPS[idx]!;
      const c1 = VESPER_STOPS[next]!;
      return {
        r: c0[0] + (c1[0] - c0[0]) * frac,
        g: c0[1] + (c1[1] - c0[1]) * frac,
        b: c0[2] + (c1[2] - c0[2]) * frac,
        a: 1,
      };
    }
    case "cinder": {
      // 2.8s period; warm-biased brightness drift
      const p = (Math.sin((tMs / 2800) * TAU) + 1) / 2;
      const k = 1 + 0.3 * p;
      return {
        r: Math.min(1, r0 * k * 1.12),
        g: Math.min(1, g0 * k),
        b: Math.max(0, b0 * k * 0.82),
        a: 1,
      };
    }
  }
}

/** Format an `AnimatedColor` for Canvas2D `fillStyle`. */
export function animatedColorToRgba(c: AnimatedColor): string {
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`;
}

/* ── Chain item_type encoding ───────────────────────────────────
 *
 * `ShopItem.item_type: u16` is the only handle the shop publishes
 * for an item. The chain side's `fulfill_item` decodes this number
 * into (kind, id) for cosmetics. Keep these helpers in sync with
 * programs/novus_mundus/src/processor/shop/common.rs.
 */

export const COSMETIC_ITEM_TYPE_BADGE_BASE = 1000;
export const COSMETIC_ITEM_TYPE_TITLE_BASE = 1064;
export const COSMETIC_ITEM_TYPE_COLOR_BASE = 1128;
export const COSMETIC_ITEM_TYPE_FRAME_BASE = 1192;
// Reserved for future kinds — currently no chain decoder, but the block
// 1192-1383 is excluded from is_inventory_item_type on chain so wiring them
// later doesn't need to renumber.
export const COSMETIC_ITEM_TYPE_EFFECT_BASE = 1256;
export const COSMETIC_ITEM_TYPE_POSE_BASE = 1320;
export const COSMETIC_KIND_RANGE = 64;

export type CosmeticKind = "frame" | "color" | "title" | "badge" | "effect" | "pose";

/** Decode a `ShopItem.item_type` into (kind, id) for cosmetics, or null. */
export function decodeCosmeticItemType(
  itemType: number,
): { kind: CosmeticKind; id: number } | null {
  if (itemType >= COSMETIC_ITEM_TYPE_BADGE_BASE && itemType < COSMETIC_ITEM_TYPE_TITLE_BASE) {
    return { kind: "badge", id: itemType - COSMETIC_ITEM_TYPE_BADGE_BASE };
  }
  if (itemType >= COSMETIC_ITEM_TYPE_TITLE_BASE && itemType < COSMETIC_ITEM_TYPE_COLOR_BASE) {
    return { kind: "title", id: itemType - COSMETIC_ITEM_TYPE_TITLE_BASE };
  }
  if (itemType >= COSMETIC_ITEM_TYPE_COLOR_BASE && itemType < COSMETIC_ITEM_TYPE_FRAME_BASE) {
    return { kind: "color", id: itemType - COSMETIC_ITEM_TYPE_COLOR_BASE };
  }
  if (
    itemType >= COSMETIC_ITEM_TYPE_FRAME_BASE &&
    itemType < COSMETIC_ITEM_TYPE_FRAME_BASE + COSMETIC_KIND_RANGE
  ) {
    return { kind: "frame", id: itemType - COSMETIC_ITEM_TYPE_FRAME_BASE };
  }
  return null;
}

/** Encode a (kind, id) into a shop item_type. Inverse of decode — the
 *  chain accepts the full 0..63 range, so both ends must match. */
export function encodeCosmeticItemType(kind: CosmeticKind, id: number): number {
  if (!Number.isInteger(id) || id < 0 || id >= COSMETIC_KIND_RANGE) {
    throw new Error(`Cosmetic id ${id} out of range (0..${COSMETIC_KIND_RANGE - 1})`);
  }
  switch (kind) {
    case "badge":
      return COSMETIC_ITEM_TYPE_BADGE_BASE + id;
    case "title":
      return COSMETIC_ITEM_TYPE_TITLE_BASE + id;
    case "color":
      return COSMETIC_ITEM_TYPE_COLOR_BASE + id;
    case "frame":
      return COSMETIC_ITEM_TYPE_FRAME_BASE + id;
    default:
      throw new Error(`Cosmetic kind ${kind} not yet wired on chain`);
  }
}
