import { cn } from "@/lib/utils";
import { GAME_ICONS, type GameIconId } from "@/lib/icons.generated";

export type { GameIconId };

const BASE = "/img/icons/game";

/**
 * BuffStat enum id (1–18) to relief icon id. Order matches the on-chain
 * `BuffStat` enum in the SDK; index 0 is unused (stat ids are 1-based).
 */
const BUFF_STAT_ICONS: readonly GameIconId[] = [
  "buff-attack-power",
  "buff-defense-power",
  "buff-cash-collection-rate",
  "buff-xp-gain",
  "buff-training-cost-reduction",
  "buff-rally-capacity",
  "buff-critical-hit-chance",
  "buff-synchrony-bonus",
  "buff-resource-capacity",
  "buff-weapon-efficiency",
  "buff-stamina-regen",
  "buff-produce-generation",
  "buff-unit-capacity",
  "buff-encounter-damage",
  "buff-loot-bonus",
  "buff-armor-efficiency",
  "buff-mining-affinity",
  "buff-fishing-affinity",
];

/** Map a `BuffStat` id (1–18) to its icon id; undefined if out of range. */
export function buffStatIcon(stat: number): GameIconId | undefined {
  return BUFF_STAT_ICONS[stat - 1];
}

interface GameIconProps {
  /** Manifest id, e.g. "buff-attack-power" or "weapon-melee". */
  id: GameIconId;
  /** Rendered box size in px (square). Default 24. */
  size?: number;
  className?: string;
  /** Accessible label; falls back to the id. */
  title?: string;
}

/**
 * Domain icon. Two render paths, decided by the generated icon index:
 *
 *  - relief (buff-*, resource-*) — a full-colour bronze medallion. Raster
 *    WebP with an @2x source; colour is fixed, so it is NOT theme-tinted.
 *  - flat (weapon-*, map-*) — an engraved glyph. Rendered as a CSS mask over
 *    `currentColor`, so it inherits the surrounding text colour and tracks
 *    the active theme tier accent. No SVG inlining or build step needed.
 */
export function GameIcon({ id, size = 24, className, title }: GameIconProps) {
  const label = title ?? id;

  // Everything that isn't a raster relief medallion (flat, nav) is a glyph
  // SVG — rendered as a CSS mask so it tints with currentColor.
  if (GAME_ICONS[id] !== "relief") {
    const url = `url(${BASE}/${id}.svg)`;
    return (
      <span
        role="img"
        aria-label={label}
        className={cn("inline-block shrink-0 align-[-0.125em]", className)}
        style={{
          width: size,
          height: size,
          backgroundColor: "currentColor",
          maskImage: url,
          WebkitMaskImage: url,
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskPosition: "center",
          WebkitMaskPosition: "center",
          maskSize: "contain",
          WebkitMaskSize: "contain",
        }}
      />
    );
  }

  return (
    <img
      src={`${BASE}/${id}.webp`}
      srcSet={`${BASE}/${id}.webp 1x, ${BASE}/${id}@2x.webp 2x`}
      width={size}
      height={size}
      alt={label}
      draggable={false}
      className={cn("inline-block shrink-0 select-none align-[-0.125em]", className)}
    />
  );
}
