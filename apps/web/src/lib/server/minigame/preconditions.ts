import {
  buildingAllowedWindows,
  currentTimeWindow,
  isActivityDoneThisWindow,
  isDailyStateStale,
  type EstateAccount,
} from "novus-mundus-sdk";

/** A failed precondition — `code` is machine-readable, `error` is for the player. */
export interface PreconditionFailure {
  error: string;
  code: string;
}

/**
 * Validate that `buildingType`'s daily activity can be played right now,
 * mirroring the program's window gate (`daily_activity.rs`). Returns the
 * failure, or null when the activity is currently playable.
 *
 * Shared by the `/minigame/.../start` and `/cosign/.../daily-activity` routes so
 * they agree on availability and surface the same reason. On a new day the
 * program resets daily tracking, so a stale estate is treated as a fresh Dawn.
 */
export function activityPreconditionError(
  estate: EstateAccount,
  buildingType: number,
  nowSeconds: number,
): PreconditionFailure | null {
  const window = currentTimeWindow(estate, nowSeconds);
  if (window === "expired") {
    return {
      error: "today's activity windows have closed — come back tomorrow",
      code: "WINDOW_EXPIRED",
    };
  }

  const allowed = buildingAllowedWindows(buildingType);
  if (allowed.length === 0) {
    return { error: "that building has no daily mini-game", code: "NO_ACTIVITY" };
  }
  if (!allowed.includes(window)) {
    return {
      error: `that activity is played during ${allowed.join(" or ")}, not ${window}`,
      code: "WRONG_WINDOW",
    };
  }

  if (
    !isDailyStateStale(estate, nowSeconds) &&
    isActivityDoneThisWindow(estate, buildingType, window)
  ) {
    return {
      error: "you have already completed this activity for this window",
      code: "ALREADY_DONE",
    };
  }

  return null;
}
