/**
 * Hero ability metadata and display helpers.
 *
 * Mirrors the on-chain AbilityKind enum and provides format helpers for
 * UI rendering (descriptions, cooldown countdowns, labels).
 */

import type { HeroTemplateAccount } from "../state/hero";
import { getBuffStatMeta } from "../types/enums";

export const AbilityKind = {
  None: 0,
  BuffNext: 1,
  CritNext: 2,
  ShieldNext: 3,
  EncounterSkip: 4,
  InstantResource: 5,
  FragmentRefund: 6,
} as const;
export type AbilityKindValue = (typeof AbilityKind)[keyof typeof AbilityKind];

export interface AbilityKindMeta {
  kind: AbilityKindValue;
  /** Short label for chips / badges */
  label: string;
  /** Single-emoji or text icon */
  icon: string;
  /** Tailwind color for accent / pill (use as `text-red-400` etc.) */
  accentClass: string;
  /** Long-form description (template-agnostic; combine with template params for full text) */
  baseDescription: string;
}

export const ABILITY_KIND_META: Record<number, AbilityKindMeta> = {
  [AbilityKind.None]: {
    kind: AbilityKind.None,
    label: "None",
    icon: "·",
    accentClass: "text-zinc-500",
    baseDescription: "No active ability.",
  },
  [AbilityKind.BuffNext]: {
    kind: AbilityKind.BuffNext,
    label: "BuffNext",
    icon: "✦",
    accentClass: "text-amber-400",
    baseDescription: "Boosts your next combat action.",
  },
  [AbilityKind.CritNext]: {
    kind: AbilityKind.CritNext,
    label: "CritNext",
    icon: "⚔",
    accentClass: "text-red-400",
    baseDescription: "Your next attack is a guaranteed critical hit.",
  },
  [AbilityKind.ShieldNext]: {
    kind: AbilityKind.ShieldNext,
    // Monochrome BMP shield (U+26E8), not the U+1F6E1 color emoji: the emoji
    // ignores `accentClass` and renders multicolor, clashing with the other
    // tinted text glyphs. This one inherits the blue accent like its siblings.
    label: "ShieldNext",
    icon: "⛨",
    accentClass: "text-blue-400",
    baseDescription: "Doubles your defense against the next incoming attack.",
  },
  [AbilityKind.EncounterSkip]: {
    kind: AbilityKind.EncounterSkip,
    label: "EncounterSkip",
    icon: "✸",
    accentClass: "text-fuchsia-400",
    baseDescription: "Your next encounter is automatically defeated.",
  },
  [AbilityKind.InstantResource]: {
    kind: AbilityKind.InstantResource,
    label: "InstantResource",
    icon: "₵",
    accentClass: "text-emerald-400",
    baseDescription: "Grants cash on demand.",
  },
  [AbilityKind.FragmentRefund]: {
    kind: AbilityKind.FragmentRefund,
    label: "FragmentRefund",
    icon: "❖",
    accentClass: "text-violet-400",
    baseDescription: "Grants hero fragments on demand.",
  },
};

/** Look up metadata for a numeric ability kind. Falls back to `None`. */
export function getAbilityKindMeta(kind: number): AbilityKindMeta {
  return ABILITY_KIND_META[kind] ?? ABILITY_KIND_META[AbilityKind.None]!;
}

/**
 * Format a template's ability into a player-readable description.
 *
 * Examples:
 *  - BuffNext / AttackPower / 3000bps → "Next combat action: +30% Attack"
 *  - CritNext                          → "Next attack: guaranteed crit"
 *  - InstantResource / 50000           → "Grants 50,000 cash"
 */
export function getAbilityDescription(template: HeroTemplateAccount): string {
  const kind = template.abilityKind;
  switch (kind) {
    case AbilityKind.None:
      return "";
    case AbilityKind.BuffNext: {
      const stat = getBuffStatMeta(template.abilityStat);
      const pct = (template.abilityParam1 / 100).toFixed(1);
      return `combat action: +${pct}% ${stat?.name ?? "stat"}`;
    }
    case AbilityKind.CritNext:
      return "attack: guaranteed critical hit";
    case AbilityKind.ShieldNext:
      return "defense: ×2 defense";
    case AbilityKind.EncounterSkip:
      return "encounter: auto-success";
    case AbilityKind.InstantResource:
      return `grants ${template.abilityParam1.toLocaleString()} cash`;
    case AbilityKind.FragmentRefund:
      return `grants ${template.abilityParam1.toLocaleString()} fragments`;
    default:
      return "unknown ability";
  }
}

/** Returns true if the template has any active ability configured. */
export function hasAbility(template: HeroTemplateAccount): boolean {
  return template.abilityKind !== AbilityKind.None;
}

/**
 * Format a duration in seconds as a compact "Xd Yh Zm Ws" string.
 * - <60s     → "Ns"
 * - <1h      → "Mm Ss"
 * - <1d      → "Hh Mm"
 * - >=1d     → "Dd Hh"
 */
export function formatDurationCompact(secs: number): string {
  if (secs <= 0) return "0s";
  const s = Math.floor(secs);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/**
 * Given a cooldown timestamp and a "now" timestamp (both unix seconds) plus
 * the cooldown length, return ready/remaining.
 */
export function abilityCooldownStatus(
  lastUsedAt: number,
  cooldownSecs: number,
  nowSecs: number,
): { ready: boolean; remainingSecs: number; readyAt: number } {
  if (lastUsedAt <= 0) return { ready: true, remainingSecs: 0, readyAt: 0 };
  const readyAt = lastUsedAt + cooldownSecs;
  const remaining = Math.max(0, readyAt - nowSecs);
  return { ready: remaining === 0, remainingSecs: remaining, readyAt };
}
