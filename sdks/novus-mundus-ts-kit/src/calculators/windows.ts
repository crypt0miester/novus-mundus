/**
 * Daily-Activity Time Windows
 *
 * A faithful TypeScript mirror of the window logic in the on-chain processor
 * `programs/novus_mundus/src/processor/estate/daily_activity.rs`. The estate's
 * daily mini-games are gated to three windows — Dawn, Midday, Dusk — measured
 * relative to the first activity of the day (`dawn_timestamp`), not the wall
 * clock. The server co-sign route and the client UI both need this logic, so it
 * lives here as the single TS source of truth.
 *
 * The Rust file is the spec; this port matches it constant-for-constant.
 * `tests/unit/windows.test.ts` pins the two together — a change to the Rust
 * boundaries or building map must be reflected here and in that test.
 *
 * Distinct from `TimeOfDay` in `./time`: that is the world day/night cycle;
 * this is the estate daily-activity window.
 */

import { BuildingType } from '../types/enums';

// Window Constants (mirror daily_activity.rs)

/** Hours after `dawn_timestamp` that bound each window. */
const DAWN_END_HOURS = 3;
const MIDDAY_START_HOURS = 4;
const MIDDAY_END_HOURS = 8;
const DUSK_START_HOURS = 9;
const DUSK_END_HOURS = 16;

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

// Types

/** A daily-activity time window; `expired` once the day's 16h span has ended. */
export type TimeWindow = 'dawn' | 'midday' | 'dusk' | 'expired';

/**
 * The subset of `EstateAccount` fields the window calculators read. The full
 * `EstateAccount` is structurally assignable to this, and a test can pass a
 * plain literal.
 */
export interface EstateWindowState {
  /** `daily_date` — the unix-day index (u16) the daily state belongs to. */
  dailyDate: number;
  /** `dawn_timestamp` — unix seconds of the first activity of `dailyDate`. */
  dawnTimestamp: bigint | number;
  /** Per-window completion bitflags for buildings 0-15. */
  dawnBuildings: number;
  middayBuildings: number;
  duskBuildings: number;
  /** Completion bitflags for expansion buildings 16+ (window-agnostic). */
  expansionDaily: number;
}

// Internal Helpers

function toSeconds(t: bigint | number): number {
  return typeof t === 'number' ? t : Number(t);
}

/**
 * The `daily_date` the program computes for a unix timestamp: `now / 86400`
 * truncated to a u16 — mirrors `(now / 86400) as u16` in the processor. Useful
 * for keying per-day state when an estate's stored `dailyDate` may be stale.
 */
export function dailyDateFor(nowSeconds: number): number {
  return Math.trunc(nowSeconds / SECONDS_PER_DAY) & 0xffff;
}

/**
 * Map hours-since-dawn to a window. Mirrors `get_current_window` exactly,
 * including the two gap bands (3-4h still Dawn, 8-9h still Midday) and the
 * defensive `hours < 0` → Dawn case.
 */
function windowForHours(hours: number): TimeWindow {
  if (hours < 0) return 'dawn';
  if (hours < DAWN_END_HOURS) return 'dawn';
  if (hours >= MIDDAY_START_HOURS && hours < MIDDAY_END_HOURS) return 'midday';
  if (hours >= DUSK_START_HOURS && hours < DUSK_END_HOURS) return 'dusk';
  if (hours >= DAWN_END_HOURS && hours < MIDDAY_START_HOURS) return 'dawn';
  if (hours >= MIDDAY_END_HOURS && hours < DUSK_START_HOURS) return 'midday';
  return 'expired';
}

/** `1 << building_type` for buildings 0-15, else 0 (mirrors `building_bitflag`). */
function buildingBitflag(buildingType: BuildingType): number {
  return buildingType < 16 ? 1 << buildingType : 0;
}

/** `1 << (building_type - 16)` for buildings 16+, else 0 (`expansion_bitflag`). */
function expansionBitflag(buildingType: BuildingType): number {
  return buildingType >= 16 ? 1 << (buildingType - 16) : 0;
}

// Public API

/**
 * Whether the estate's stored daily state belongs to an earlier day than
 * `nowSeconds`. When true, the program resets all daily tracking on the next
 * `daily_activity` (a fresh Dawn anchored at that call). Mirrors the
 * `current_day != estate.daily_date` check in the processor.
 */
export function isDailyStateStale(
  estate: EstateWindowState,
  nowSeconds: number,
): boolean {
  return dailyDateFor(nowSeconds) !== estate.dailyDate;
}

/**
 * The current daily-activity window for an estate at `nowSeconds`.
 *
 * If the stored daily state is stale (a new day), the next activity re-anchors
 * Dawn at that moment, so the effective current window is `dawn`.
 */
export function currentTimeWindow(
  estate: EstateWindowState,
  nowSeconds: number,
): TimeWindow {
  if (isDailyStateStale(estate, nowSeconds)) return 'dawn';
  const hours = Math.trunc(
    (nowSeconds - toSeconds(estate.dawnTimestamp)) / SECONDS_PER_HOUR,
  );
  return windowForHours(hours);
}

/**
 * The window(s) a building's mini-game can be played in. Mirrors
 * `building_allowed_windows`. Mansion has none (handled by `daily_claim`).
 */
export function buildingAllowedWindows(buildingType: BuildingType): TimeWindow[] {
  switch (buildingType) {
    case BuildingType.Barracks:
      return ['dawn'];
    case BuildingType.Workshop:
      return ['dawn', 'midday'];
    case BuildingType.Dock:
      return ['dawn', 'midday'];
    case BuildingType.Vault:
      return ['dawn', 'midday'];
    case BuildingType.Forge:
      return ['dawn', 'midday'];
    case BuildingType.Market:
      return ['midday'];
    case BuildingType.Academy:
      return ['midday'];
    case BuildingType.Arena:
      return ['midday'];
    case BuildingType.MeditationChamber:
      return ['dusk'];
    case BuildingType.Observatory:
      return ['dusk'];
    case BuildingType.Treasury:
      return ['dusk'];
    case BuildingType.Citadel:
      return ['dusk'];
    case BuildingType.Camp:
      return ['dawn'];
    case BuildingType.Mine:
      return ['dawn', 'midday'];
    case BuildingType.Farm:
      return ['dawn', 'midday'];
    case BuildingType.DungeonEntry:
      return ['dusk'];
    case BuildingType.TransportBay:
      return ['midday'];
    case BuildingType.Infirmary:
      return ['dusk'];
    case BuildingType.Mansion:
      return [];
    default:
      return [];
  }
}

/**
 * Whether a building's activity has already been completed in `window`.
 *
 * Mirrors the `already_completed` check: buildings 16+ are tracked once-per-day
 * in `expansion_daily` (window-agnostic); buildings 0-15 are tracked per window.
 *
 * Reads the stored bitflags as-is. A caller acting on a *new* day (see
 * `isDailyStateStale`) must treat every activity as not-yet-done, because the
 * program clears these flags before it grades.
 */
export function isActivityDoneThisWindow(
  estate: EstateWindowState,
  buildingType: BuildingType,
  window: TimeWindow,
): boolean {
  const expBit = expansionBitflag(buildingType);
  if (expBit !== 0) return (estate.expansionDaily & expBit) !== 0;

  const bit = buildingBitflag(buildingType);
  if (window === 'dawn') return (estate.dawnBuildings & bit) !== 0;
  if (window === 'midday') return (estate.middayBuildings & bit) !== 0;
  if (window === 'dusk') return (estate.duskBuildings & bit) !== 0;
  return true; // expired — nothing more can be played
}

/**
 * Unix seconds at which the *next* window opens, or `null` when none opens
 * later today (currently Dusk or Expired) or the day is not yet anchored
 * (stale state — Dawn opens on the next activity and the later windows are not
 * yet scheduled).
 */
export function nextWindowOpensAt(
  estate: EstateWindowState,
  nowSeconds: number,
): number | null {
  if (isDailyStateStale(estate, nowSeconds)) return null;
  const dawn = toSeconds(estate.dawnTimestamp);
  const window = currentTimeWindow(estate, nowSeconds);
  if (window === 'dawn') return dawn + MIDDAY_START_HOURS * SECONDS_PER_HOUR;
  if (window === 'midday') return dawn + DUSK_START_HOURS * SECONDS_PER_HOUR;
  return null; // dusk or expired — nothing more opens today
}
