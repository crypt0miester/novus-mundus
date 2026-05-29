/**
 * Window-completion bonus unit tests (§8). Pure logic — no Redis, no secrets.
 */

import { describe, it, expect } from "bun:test";
import type { EstateAccount } from "novus-mundus-sdk";
import { windowCompletionBonus, WINDOW_COMPLETION_BONUS } from "./window-completion";

const DAY = 20578;
const DAWN = DAY * 86400;
const DUSK_NOW = DAWN + 10 * 3600; // hour 10 — inside the Dusk window
const DAWN_NOW = DAWN + 1 * 3600; // hour 1 — inside the Dawn window

// BuildingType ids — Observatory 10, Treasury 11, Infirmary 18.

function estate(overrides: Record<string, unknown> = {}): EstateAccount {
  return {
    dailyDate: DAY,
    dawnTimestamp: DAWN,
    dawnBuildings: 0,
    middayBuildings: 0,
    duskBuildings: 0,
    expansionDaily: 0,
    buildings: [],
    ...overrides,
  } as unknown as EstateAccount;
}

/** A minimal active building slot. */
function slot(buildingType: number) {
  return { buildingType, status: 2 };
}

describe("windowCompletionBonus", () => {
  it("pays nothing while other window buildings are unfinished", () => {
    const e = estate({ buildings: [slot(10), slot(11)] });
    expect(windowCompletionBonus(e, 10, DUSK_NOW)).toBe(0);
  });

  it("pays the bonus when this submission completes the window", () => {
    // Treasury (11) already done; submitting Observatory (10) finishes Dusk.
    const e = estate({ buildings: [slot(10), slot(11)], duskBuildings: 1 << 11 });
    expect(windowCompletionBonus(e, 10, DUSK_NOW)).toBe(WINDOW_COMPLETION_BONUS);
  });

  it("pays the bonus when the player owns just one window building", () => {
    const e = estate({ buildings: [slot(10)] });
    expect(windowCompletionBonus(e, 10, DUSK_NOW)).toBe(WINDOW_COMPLETION_BONUS);
  });

  it("never pays for expansion buildings (16+)", () => {
    const e = estate({ buildings: [slot(18)] });
    expect(windowCompletionBonus(e, 18, DUSK_NOW)).toBe(0);
  });

  it("pays nothing when the building is not playable in the current window", () => {
    // Observatory is a Dusk building, queried during Dawn.
    const e = estate({ buildings: [slot(10)] });
    expect(windowCompletionBonus(e, 10, DAWN_NOW)).toBe(0);
  });
});
