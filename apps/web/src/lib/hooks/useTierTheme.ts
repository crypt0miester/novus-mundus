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
      const end = player.subscriptionEnd.toNumber();
      if (end > now) tier = Math.min(player.subscriptionTier, 3);
    }

    document.body.setAttribute("data-tier", String(tier));
    try { localStorage.setItem("novus-tier", String(tier)); } catch {}

    // Resolve theme: auto picks based on tier (no player = tier 0 = paper)
    const resolvedTheme = resolveTheme(themePreference, tier);
    document.body.setAttribute("data-theme", resolvedTheme);

    return () => {
      document.body.removeAttribute("data-tier");
      document.body.removeAttribute("data-theme");
    };
  }, [player, themePreference]);
}

/** Resolve "auto" theme preference into "paper" or "dark" based on tier */
function resolveTheme(pref: ThemePreference, tier: number): string {
  if (pref === "paper") return "paper";
  if (pref === "dark") return "dark";
  // auto: Rookie/Expert = paper, Epic/Legendary = dark
  return tier <= 1 ? "paper" : "dark";
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
