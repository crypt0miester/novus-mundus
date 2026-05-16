import {
  buildingAllowedWindows,
  currentTimeWindow,
  findBuilding,
  isActivityDoneThisWindow,
  isDailyStateStale,
  type EstateAccount,
  type TimeWindow,
} from "novus-mundus-sdk";

/**
 * Window-completion bonus (`DAILY_ACTIVITY_MINIGAMES.md` §8).
 *
 * `ESTATE_SYSTEM.md` promised a reward bonus for completing a daily window, but
 * no on-chain reward path ever paid it. This delivers it web-side: when the
 * activity a player submits *completes* their window — every 0-15 building they
 * own that is playable in that window is now done — the co-sign route adds a
 * flat bonus to that submission's score. No program change.
 *
 * Pure logic, no secrets — safe to unit test.
 */

/** The flat score bonus (0-100 scale). Tunable; re-tune from data in Phase 5. */
export const WINDOW_COMPLETION_BONUS = 12;

/** Buildings 16+ are tracked separately and do not join window completion. */
const WINDOW_BUILDING_MAX = 16;

const ACTIVE = 2;
const UPGRADING = 3;

/** Buildings 0-15 the player owns and has active that are playable in `window`. */
function ownedWindowBuildings(
  estate: EstateAccount,
  window: TimeWindow,
): number[] {
  const owned: number[] = [];
  for (let b = 1; b < WINDOW_BUILDING_MAX; b += 1) {
    if (!buildingAllowedWindows(b).includes(window)) continue;
    const slot = findBuilding(estate, b);
    if (slot && (slot.status === ACTIVE || slot.status === UPGRADING)) {
      owned.push(b);
    }
  }
  return owned;
}

/**
 * The flat score bonus for a `daily_activity` submission — awarded when
 * submitting `buildingType` completes its window, else 0.
 *
 * Mirrors the program's `check_window_completion` building set: only buildings
 * 0-15 the player owns participate; expansion buildings (16+) opt out.
 */
export function windowCompletionBonus(
  estate: EstateAccount,
  buildingType: number,
  nowSeconds: number,
): number {
  if (buildingType >= WINDOW_BUILDING_MAX) return 0;

  const window = currentTimeWindow(estate, nowSeconds);
  if (window === "expired") return 0;
  if (!buildingAllowedWindows(buildingType).includes(window)) return 0;

  const required = ownedWindowBuildings(estate, window);
  if (required.length === 0) return 0;

  // On a new day the program clears the daily flags, so only the building
  // being submitted now counts as done.
  const stale = isDailyStateStale(estate, nowSeconds);
  const allDone = required.every(
    (b) =>
      b === buildingType ||
      (!stale && isActivityDoneThisWindow(estate, b, window)),
  );
  return allDone ? WINDOW_COMPLETION_BONUS : 0;
}
