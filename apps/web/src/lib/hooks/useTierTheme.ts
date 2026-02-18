"use client";

import { useEffect } from "react";
import { usePlayer } from "./usePlayer";
import { useSettings, type ThemePreference } from "@/lib/store/settings";

/**
 * Sets `data-tier` and `data-theme` on <body> based on the player's subscription
 * tier and the user's theme preference.
 *
 * Tier 0 = Free (no sub / expired)  → paper default
 * Tier 1 = Bronze                   → paper default
 * Tier 2 = Silver                   → choice (paper or dark)
 * Tier 3 = Gold                     → dark default (paper alt)
 * Tier 4 = Legendary                → dark default (paper alt)
 */
export function useTierTheme() {
  const { data } = usePlayer();
  const player = data?.account;
  const themePreference = useSettings((s) => s.themePreference);

  useEffect(() => {
    if (!player) return;

    const now = Math.floor(Date.now() / 1000);
    const end = player.subscriptionEnd.toNumber();
    const tier =
      player.subscriptionTier > 0 && end > now
        ? Math.min(player.subscriptionTier, 4)
        : 0;

    document.body.setAttribute("data-tier", String(tier));
    try { localStorage.setItem("novus-tier", String(tier)); } catch {}

    // Resolve theme: auto picks based on tier
    const resolvedTheme = resolveTheme(themePreference, tier);
    document.body.setAttribute("data-theme", resolvedTheme);

    return () => {
      document.body.removeAttribute("data-tier");
      document.body.removeAttribute("data-theme");
    };
  }, [player, themePreference]);
}

/** Resolve "auto" theme preference into "paper" or "dark" based on tier */
export function resolveTheme(pref: ThemePreference, tier: number): string {
  if (pref === "paper") return "paper";
  if (pref === "dark") return "dark";
  // auto: tiers 0-1 = paper, tiers 2-4 = dark
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

/** Tier display names */
export const TIER_NAMES = ["Free", "Bronze", "Silver", "Gold", "Legendary"] as const;

/** Tier badge text (Roman numerals, empty for free) */
export const TIER_BADGES = ["", "I", "II", "III", "IV"] as const;

/** Get tier info for a given tier number */
export function getTierInfo(tier: number) {
  return {
    name: TIER_NAMES[tier] ?? "Free",
    badge: TIER_BADGES[tier] ?? "",
    hasBadge: tier > 0,
  };
}
