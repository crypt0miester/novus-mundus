/**
 * The last-seen snapshot — PLAYER_JOURNEY_GAMEPLAN.md §8.
 *
 * On-chain state says what the holding *is*. To tell the player what *changed*
 * while they were away, the Cairn's Report diffs the current state against a
 * per-wallet snapshot kept in localStorage and refreshed each time the player
 * leaves the estate.
 */

import { BuildingStatus } from "novus-mundus-sdk";
import { getTotalUnits, hasTeam } from "./playerHelpers";

const KEY_PREFIX = "nm-cairn-snapshot:";

// Structural shapes — the real PlayerCore / EstateAccount satisfy these.

interface Numeric {
  toNumber(): number;
}
interface SlotLike {
  buildingType: number;
  status: number;
  level: number;
}
interface EstateLike {
  buildings: SlotLike[];
  loginStreak?: number;
}
interface PlayerLike {
  lockedNovi: Numeric;
  cashOnHand: Numeric;
  cashInVault: Numeric;
  gems: Numeric;
  networth: Numeric;
  defensiveUnit1: Numeric;
  defensiveUnit2: Numeric;
  defensiveUnit3: Numeric;
  operativeUnit1: Numeric;
  operativeUnit2: Numeric;
  operativeUnit3: Numeric;
  totalDefenses: Numeric;
  totalEncounterAttacks: Numeric;
  newPlayerProtectionUntil: Numeric;
  team?: { toBase58(): string } | null;
}

// The snapshot.

/** A point-in-time capture of the values the Report diffs. */
export interface EstateSnapshot {
  /** Unix seconds when taken. */
  at: number;
  lockedNovi: number;
  /** cashOnHand + cashInVault. */
  cash: number;
  gems: number;
  networth: number;
  /** Defensive + operative units, summed. */
  units: number;
  buildings: { type: number; status: number; level: number }[];
  loginStreak: number;
  totalDefenses: number;
  totalEncounterAttacks: number;
  protectionUntil: number;
  inHouse: boolean;
}

/** Capture the current state into a snapshot. */
export function computeSnapshot(player: PlayerLike, estate: EstateLike | null): EstateSnapshot {
  const n = (v: Numeric) => v.toNumber();
  return {
    at: Math.floor(Date.now() / 1000),
    lockedNovi: n(player.lockedNovi),
    cash: n(player.cashOnHand) + n(player.cashInVault),
    gems: n(player.gems),
    networth: n(player.networth),
    units: getTotalUnits(player),
    buildings: (estate?.buildings ?? [])
      .filter((b) => b.status !== BuildingStatus.Empty)
      .map((b) => ({ type: b.buildingType, status: b.status, level: b.level })),
    loginStreak: estate?.loginStreak ?? 0,
    totalDefenses: n(player.totalDefenses),
    totalEncounterAttacks: n(player.totalEncounterAttacks),
    protectionUntil: n(player.newPlayerProtectionUntil),
    inHouse: hasTeam(player),
  };
}

// localStorage — per-wallet, SSR-guarded.

/** Read the stored snapshot for a wallet, or null if there is none. */
export function readSnapshot(wallet: string): EstateSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + wallet);
    return raw ? (JSON.parse(raw) as EstateSnapshot) : null;
  } catch {
    return null;
  }
}

/** Store the snapshot for a wallet. Failures are silent — the Report just falls back. */
export function writeSnapshot(wallet: string, snap: EstateSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY_PREFIX + wallet, JSON.stringify(snap));
  } catch {
    // localStorage unavailable or full — the next return falls back gracefully.
  }
}

// The diff.

/** What moved between two snapshots — the raw material of the Cairn's Report. */
export interface ReportDiff {
  /** Seconds between the snapshots. */
  away: number;
  noviGained: number;
  cashGained: number;
  gemsGained: number;
  networthGained: number;
  unitsGained: number;
  /** Building types that became active since. */
  buildingsRisen: number[];
  /** Building types whose level rose since. */
  buildingsImproved: number[];
  streakGained: number;
  joinedHouse: boolean;
  /** Times the holding was defended since — a discrete on-chain event. */
  attacked: number;
  /** New-player protection lapsed while away. */
  protectionEnded: boolean;
  /** True when there is anything worth telling. */
  hasNews: boolean;
}

/** Diff a prior snapshot against the current one. */
export function diffSnapshot(prev: EstateSnapshot, now: EstateSnapshot): ReportDiff {
  const prevByType = new Map(prev.buildings.map((b) => [b.type, b]));
  const buildingsRisen: number[] = [];
  const buildingsImproved: number[] = [];
  for (const b of now.buildings) {
    const was = prevByType.get(b.type);
    if (b.status === BuildingStatus.Active && (!was || was.status !== BuildingStatus.Active)) {
      buildingsRisen.push(b.type);
    } else if (was && b.level > was.level) {
      buildingsImproved.push(b.type);
    }
  }

  const gain = (a: number, b: number) => Math.max(0, a - b);
  const noviGained = gain(now.lockedNovi, prev.lockedNovi);
  const cashGained = gain(now.cash, prev.cash);
  const gemsGained = gain(now.gems, prev.gems);
  const networthGained = gain(now.networth, prev.networth);
  const unitsGained = gain(now.units, prev.units);
  const streakGained = gain(now.loginStreak, prev.loginStreak);
  const attacked = gain(now.totalDefenses, prev.totalDefenses);
  const joinedHouse = !prev.inHouse && now.inHouse;
  const protectionEnded = prev.protectionUntil > prev.at && now.protectionUntil <= now.at;

  // Treasury drift (NOVI regen, networth) is ambient, not news — left out of
  // hasNews so the Report only speaks when something real moved.
  const hasNews =
    buildingsRisen.length > 0 ||
    buildingsImproved.length > 0 ||
    attacked > 0 ||
    protectionEnded ||
    joinedHouse ||
    unitsGained > 0 ||
    streakGained > 0;

  return {
    away: gain(now.at, prev.at),
    noviGained,
    cashGained,
    gemsGained,
    networthGained,
    unitsGained,
    buildingsRisen,
    buildingsImproved,
    streakGained,
    joinedHouse,
    attacked,
    protectionEnded,
    hasNews,
  };
}
