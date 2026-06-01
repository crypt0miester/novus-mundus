"use client";

import { useEffect } from "react";
import { usePlayer } from "./usePlayer";
import { useSettings, type ThemePreference } from "@/lib/store/settings";

/**
 * Sets `data-tier` and `data-theme` on <body> based on the player's subscription
 * tier and the user's theme preference.
 *
 * The on-chain ladder is 4 tiers (Rookie 0 / Expert 1 / Epic 2 / Legendary 3).
 * `data-tier` is the chain tier index when the charter is active, else 0; the
 * CSS palette in `globals.css` is keyed on those four indices.
 */
export function useTierTheme() {
  const { data } = usePlayer();
  const player = data?.account;
  const themePreference = useSettings((s) => s.themePreference);

  useEffect(() => {
    let tier = 0;

    if (player) {
      const now = Math.floor(Date.now() / 1000);
      const end = Number(player.subscriptionEnd);
      if (end > now) tier = Math.min(player.subscriptionTier, 3);
    }

    document.body.setAttribute("data-tier", String(tier));
    try {
      localStorage.setItem("novus-tier", String(tier));
    } catch {}

    // Resolve theme: auto picks based on tier (no player = tier 0 = paper)
    const resolvedTheme = resolveTheme(themePreference, tier);
    document.body.setAttribute("data-theme", resolvedTheme);

    return () => {
      document.body.removeAttribute("data-tier");
      document.body.removeAttribute("data-theme");
    };
  }, [player, themePreference]);
}

/** Resolve a theme preference into "paper" or "dark".
 *  The paper-vs-dark choice unlocks at Epic (tier 2). Rookie/Expert are locked
 *  to paper ("primitive and white"), so their preference is ignored. */
function resolveTheme(pref: ThemePreference, tier: number): string {
  // Below Epic the theme is locked to paper regardless of preference.
  if (tier < 2) return "paper";
  if (pref === "paper") return "paper";
  if (pref === "dark") return "dark";
  // auto at Epic/Legendary defaults to dark.
  return "dark";
}

/** Read cached tier from localStorage (defaults to 0 if unknown) */
export function getCachedTier(): number {
  if (typeof window === "undefined") return 0;
  try {
    const v = localStorage.getItem("novus-tier");
    return v ? parseInt(v, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

/** Chain tier index → display name. Mirrors the on-chain `SubscriptionTier`
 *  ladder defined in `programs/.../initialization/game_engine.rs`. */
export const TIER_NAMES = ["Rookie", "Expert", "Epic", "Legendary"] as const;

/** Roman-numeral badge per chain tier index. */
const TIER_BADGES = ["I", "II", "III", "IV"] as const;

/**
 * Single source of truth for the per-tier visual palette. The CSS
 * `body[data-tier="N"]` block in `globals.css` MUST keep `--tier-accent` and
 * `--tier-accent-bright` in lockstep with `accent`/`bright` here — they're
 * effectively duplicates because CSS variables can't be read at module-eval
 * time, but anything that needs a non-active tier's colour (the subscribe
 * tab tile for tier 2 while the body is on tier 0, the profile page rendering
 * someone else's tier) imports this table instead of re-defining its own.
 *
 * Palette: amber (Rookie) → bronze (Expert) → gold (Epic) → crimson (Legendary).
 * Mirrors the on-chain ladder; bright is the highlighted cousin of accent.
 */
export interface TierPalette {
  /** Solid accent — borders, rings, level number. */
  accent: string;
  /** Brighter variant — chip text, highlighted titles. */
  bright: string;
  /** Glow tint — corner gradient, boxShadow. */
  glow: string;
  /** Translucent fill — chip background. */
  chipBg: string;
  /** Translucent line — chip border. */
  chipBorder: string;
}

export const TIER_PALETTE: readonly TierPalette[] = [
  // 0 — Rookie (amber). :root defaults; paper theme.
  {
    accent: "#92400e",
    bright: "#b45309",
    glow: "rgba(146, 64, 14, 0.55)",
    chipBg: "rgba(146, 64, 14, 0.10)",
    chipBorder: "rgba(146, 64, 14, 0.40)",
  },
  // 1 — Expert (bronze). Paper theme.
  {
    accent: "#CD7F32",
    bright: "#D4944A",
    glow: "rgba(205, 127, 50, 0.55)",
    chipBg: "rgba(205, 127, 50, 0.10)",
    chipBorder: "rgba(205, 127, 50, 0.45)",
  },
  // 2 — Epic (gold). Dark theme.
  {
    accent: "#daa520",
    bright: "#f1af09",
    glow: "rgba(218, 165, 32, 0.55)",
    chipBg: "rgba(218, 165, 32, 0.10)",
    chipBorder: "rgba(218, 165, 32, 0.45)",
  },
  // 3 — Legendary (crimson). Dark theme.
  {
    accent: "#8B1A1A",
    bright: "#9a2222",
    glow: "rgba(139, 26, 26, 0.65)",
    chipBg: "rgba(139, 26, 26, 0.15)",
    chipBorder: "rgba(139, 26, 26, 0.50)",
  },
] as const;

/** Resolve a tier index to its palette, clamping out-of-range to Rookie. */
export function tierPalette(tier: number): TierPalette {
  const safe = Math.min(Math.max(tier, 0), TIER_PALETTE.length - 1);
  return TIER_PALETTE[safe]!;
}

/**
 * Tier info for the layout chrome.
 *
 * `active` is the subscription's expiry state — `subscription_end > now`. A
 * lapsed / never-subscribed player gets the "No Charter" framing; an active
 * player (including a paying Rookie at tier 0) gets their tier's name and
 * badge.
 */
export function getTierInfo(tier: number, active = true) {
  if (!active) return { name: "No Charter", badge: "", hasBadge: false };
  const safe = Math.min(Math.max(tier, 0), TIER_NAMES.length - 1);
  return {
    name: TIER_NAMES[safe],
    badge: TIER_BADGES[safe],
    hasBadge: true,
  };
}
