"use client";

import {
  TimeOfDay,
  calculateLocalTime,
  getSecondsUntilNextPeriod,
} from "novus-mundus-sdk";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useChainNow } from "@/lib/hooks/useChainTime";

export type PhaseBody = "moon" | "sun" | "sunrise" | "sunset";

export interface PhaseMeta {
  phase: TimeOfDay;
  name: string;
  /** Start of the phase in local-time units (0–999). */
  start: number;
  /** The phase's signature colour — a mid-tone hue that reads on both the
   *  dark chrome and the light "paper" theme. Glyph, gradient and ribbon. */
  color: string;
  body: PhaseBody;
}

/**
 * The seven phases of the day, in cycle order. A game-day is a real 24h
 * (CYCLE_LENGTH 86_400s), so a local-time unit advances every ~86s and a
 * phase runs 3–6 real hours — Midday is the long one (250 units).
 *
 * Colours are a muted sky — cool indigo/violet at night, warm terracotta
 * through gold by day. Every value is a mid-tone: dark enough to read on the
 * light "paper" theme (the default), light enough on the dark one — so a
 * single palette serves both, no per-theme variant.
 */
export const PHASES: readonly PhaseMeta[] = [
  { phase: TimeOfDay.DeepNight, name: "Deep Night", start: 0,   color: "#565d92", body: "moon" },
  { phase: TimeOfDay.Dawn,      name: "Dawn",       start: 125, color: "#c0764a", body: "sunrise" },
  { phase: TimeOfDay.Morning,   name: "Morning",    start: 250, color: "#b1923f", body: "sun" },
  { phase: TimeOfDay.Midday,    name: "Midday",     start: 375, color: "#c0911e", body: "sun" },
  { phase: TimeOfDay.Afternoon, name: "Afternoon",  start: 625, color: "#b67c3a", body: "sun" },
  { phase: TimeOfDay.Dusk,      name: "Dusk",       start: 750, color: "#b06044", body: "sunset" },
  { phase: TimeOfDay.Evening,   name: "Evening",    start: 875, color: "#6a5f97", body: "moon" },
];

/** Width of a phase in local-time units. */
export function phaseWidth(index: number): number {
  const next = PHASES[index + 1]?.start ?? 1000;
  return next - PHASES[index]!.start;
}

export interface WorldClock {
  /** Local-time units, 0–999. */
  localTime: number;
  /** Day fraction, 0–1 — drives the celestial body's position on the arc. */
  dayFraction: number;
  current: PhaseMeta;
  currentIndex: number;
  next: PhaseMeta;
  /** Real seconds until the next phase begins. */
  secondsToNext: number;
  /** In-world wall-clock, "HH:MM" — local time at the player's longitude. */
  clock: string;
}

/**
 * The player's place in the day. Time-of-day is the on-chain cluster clock
 * (`Clock::unix_timestamp`) offset by the player's city longitude (a literal
 * timezone), and it drives every NOVI-consumption multiplier — so this is
 * shared chrome, not a tab widget.
 *
 * The timestamp is anchored to the chain clock via {@link useChainTimeOffset},
 * not the raw device clock: the program computes multipliers from the validator
 * clock, so a `Date.now()`-based preview can mispredict the period at a band
 * boundary if the device clock is skewed.
 */
export function useWorldClock(): WorldClock {
  const { data: playerData } = usePlayer();
  // `PlayerCore.currentLong` is an f64 in degrees (`state/player.rs:104`),
  // NOT the ×10000 grid form. Longitude IS the player's timezone offset —
  // pass it straight through. The ×10000 scaling belongs to
  // `LocationAccount.grid_long`, a separate i32 field.
  const longitude = playerData?.account?.currentLong ?? 0;

  // Chain-anchored seconds; phases last hours, so the default 30s tick keeps
  // the arc and countdown fresh enough.
  const ts = useChainNow();
  const localTime = calculateLocalTime(ts, longitude);

  let currentIndex = 0;
  for (let i = 0; i < PHASES.length; i++) {
    if (localTime >= PHASES[i]!.start) currentIndex = i;
  }

  const totalMin = Math.floor((localTime / 1000) * 1440);
  const clock =
    `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:` +
    `${String(totalMin % 60).padStart(2, "0")}`;

  return {
    localTime,
    dayFraction: localTime / 1000,
    current: PHASES[currentIndex]!,
    currentIndex,
    next: PHASES[(currentIndex + 1) % PHASES.length]!,
    secondsToNext: getSecondsUntilNextPeriod(ts, longitude),
    clock,
  };
}
