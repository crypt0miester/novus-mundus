/**
 * Daily-Activity Window Calculator — Parity Tests
 *
 * Pins the TS window logic against the on-chain processor
 * `programs/novus_mundus/src/processor/estate/daily_activity.rs`. The expected
 * values below are read straight from that Rust file:
 *
 *   - window bounds (hours since dawn):
 *       Dawn   0-3   (and the 3-4h gap still counts as Dawn)
 *       Midday 4-8   (and the 8-9h gap still counts as Midday)
 *       Dusk   9-15
 *       Expired >= 16
 *   - `building_allowed_windows` — the per-building map
 *   - `building_bitflag` / `expansion_bitflag` — the completion flags
 *
 * If the Rust boundaries or building map change, this test must change with
 * `windows.ts`; an impl-only change fails here.
 */

import { describe, it, expect } from 'bun:test';
import { BuildingType } from '../../src/types/enums';
import {
  type EstateWindowState,
  type TimeWindow,
  currentTimeWindow,
  buildingAllowedWindows,
  dailyDateFor,
  isActivityDoneThisWindow,
  isDailyStateStale,
  nextWindowOpensAt,
} from '../../src/calculators/windows';

// Helpers

/** A day index well inside u16 range; dawn anchored at the start of that day. */
const DAY = 20578;
const DAWN = DAY * 86400;
const HOUR = 3600;

function estate(overrides: Partial<EstateWindowState> = {}): EstateWindowState {
  return {
    dailyDate: DAY,
    dawnTimestamp: DAWN,
    dawnBuildings: 0,
    middayBuildings: 0,
    duskBuildings: 0,
    expansionDaily: 0,
    ...overrides,
  };
}

/** Window for a current-day estate `h` hours after its dawn. */
function windowAtHour(h: number): TimeWindow {
  return currentTimeWindow(estate(), DAWN + h * HOUR);
}

// currentTimeWindow — window boundaries

describe('currentTimeWindow', () => {
  it('treats hours 0-2 as Dawn', () => {
    expect(windowAtHour(0)).toBe('dawn');
    expect(windowAtHour(1)).toBe('dawn');
    expect(windowAtHour(2)).toBe('dawn');
  });

  it('treats the 3-4h gap as Dawn', () => {
    expect(windowAtHour(3)).toBe('dawn');
    expect(windowAtHour(3.5)).toBe('dawn');
  });

  it('treats hours 4-7 as Midday', () => {
    expect(windowAtHour(4)).toBe('midday');
    expect(windowAtHour(5)).toBe('midday');
    expect(windowAtHour(7)).toBe('midday');
  });

  it('treats the 8-9h gap as Midday', () => {
    expect(windowAtHour(8)).toBe('midday');
    expect(windowAtHour(8.9)).toBe('midday');
  });

  it('treats hours 9-15 as Dusk', () => {
    expect(windowAtHour(9)).toBe('dusk');
    expect(windowAtHour(12)).toBe('dusk');
    expect(windowAtHour(15)).toBe('dusk');
  });

  it('treats hour 16 onward as Expired', () => {
    expect(windowAtHour(16)).toBe('expired');
    expect(windowAtHour(20)).toBe('expired');
  });

  it('truncates fractional hours toward zero (matching Rust integer division)', () => {
    expect(windowAtHour(3.99)).toBe('dawn'); // trunc -> 3
    expect(windowAtHour(15.99)).toBe('dusk'); // trunc -> 15
  });

  it('treats a negative hours-since-dawn as Dawn (defensive branch)', () => {
    // dawn anchored 5h into the day, queried 4h in — 1h before dawn, same day.
    const e = estate({ dawnTimestamp: DAWN + 5 * HOUR });
    expect(isDailyStateStale(e, DAWN + 4 * HOUR)).toBe(false);
    expect(currentTimeWindow(e, DAWN + 4 * HOUR)).toBe('dawn');
  });

  it('returns Dawn when the daily state is stale (a new day)', () => {
    // Yesterday's daily_date, plus stale dusk flags — still a fresh Dawn.
    const stale = estate({ dailyDate: DAY - 1, duskBuildings: 0xffff });
    expect(currentTimeWindow(stale, DAWN + 12 * HOUR)).toBe('dawn');
  });
});

// isDailyStateStale

describe('isDailyStateStale', () => {
  it('is false within the estate\'s recorded day', () => {
    expect(isDailyStateStale(estate(), DAWN)).toBe(false);
    expect(isDailyStateStale(estate(), DAWN + 15 * HOUR)).toBe(false);
  });

  it('is true once now crosses into a later day', () => {
    expect(isDailyStateStale(estate(), DAWN + 86400)).toBe(true);
  });

  it('is true when the stored daily_date is behind', () => {
    expect(isDailyStateStale(estate({ dailyDate: DAY - 1 }), DAWN)).toBe(true);
  });
});

// dailyDateFor

describe('dailyDateFor', () => {
  it('truncates a unix timestamp to its u16 day index', () => {
    expect(dailyDateFor(DAWN)).toBe(DAY);
    expect(dailyDateFor(DAWN + 15 * HOUR)).toBe(DAY);
    expect(dailyDateFor(DAWN + 86400)).toBe(DAY + 1);
  });
});

// buildingAllowedWindows — the full per-building map

describe('buildingAllowedWindows', () => {
  it('maps every building exactly as the processor does', () => {
    expect(buildingAllowedWindows(BuildingType.Mansion)).toEqual([]);
    expect(buildingAllowedWindows(BuildingType.Barracks)).toEqual(['dawn']);
    expect(buildingAllowedWindows(BuildingType.Workshop)).toEqual(['dawn', 'midday']);
    expect(buildingAllowedWindows(BuildingType.Vault)).toEqual(['dawn', 'midday']);
    expect(buildingAllowedWindows(BuildingType.Dock)).toEqual(['dawn', 'midday']);
    expect(buildingAllowedWindows(BuildingType.Forge)).toEqual(['dawn', 'midday']);
    expect(buildingAllowedWindows(BuildingType.Market)).toEqual(['midday']);
    expect(buildingAllowedWindows(BuildingType.Academy)).toEqual(['midday']);
    expect(buildingAllowedWindows(BuildingType.Arena)).toEqual(['midday']);
    expect(buildingAllowedWindows(BuildingType.MeditationChamber)).toEqual(['dusk']);
    expect(buildingAllowedWindows(BuildingType.Observatory)).toEqual(['dusk']);
    expect(buildingAllowedWindows(BuildingType.Treasury)).toEqual(['dusk']);
    expect(buildingAllowedWindows(BuildingType.Citadel)).toEqual(['dusk']);
    expect(buildingAllowedWindows(BuildingType.Camp)).toEqual(['dawn']);
    expect(buildingAllowedWindows(BuildingType.Mine)).toEqual(['dawn', 'midday']);
    expect(buildingAllowedWindows(BuildingType.DungeonEntry)).toEqual(['dusk']);
    expect(buildingAllowedWindows(BuildingType.Farm)).toEqual(['dawn', 'midday']);
    expect(buildingAllowedWindows(BuildingType.TransportBay)).toEqual(['midday']);
    expect(buildingAllowedWindows(BuildingType.Infirmary)).toEqual(['dusk']);
  });
});

// isActivityDoneThisWindow

describe('isActivityDoneThisWindow', () => {
  it('reads buildings 0-15 from the per-window bitflags (1 << buildingType)', () => {
    const e = estate({
      dawnBuildings: 1 << BuildingType.Workshop,
      middayBuildings: 1 << BuildingType.Market,
      duskBuildings: 1 << BuildingType.Treasury,
    });
    expect(isActivityDoneThisWindow(e, BuildingType.Workshop, 'dawn')).toBe(true);
    expect(isActivityDoneThisWindow(e, BuildingType.Workshop, 'midday')).toBe(false);
    expect(isActivityDoneThisWindow(e, BuildingType.Market, 'midday')).toBe(true);
    expect(isActivityDoneThisWindow(e, BuildingType.Market, 'dawn')).toBe(false);
    expect(isActivityDoneThisWindow(e, BuildingType.Treasury, 'dusk')).toBe(true);
    expect(isActivityDoneThisWindow(e, BuildingType.Vault, 'dawn')).toBe(false);
  });

  it('handles several flags set in one window', () => {
    const e = estate({
      dawnBuildings: (1 << BuildingType.Workshop) | (1 << BuildingType.Vault),
    });
    expect(isActivityDoneThisWindow(e, BuildingType.Workshop, 'dawn')).toBe(true);
    expect(isActivityDoneThisWindow(e, BuildingType.Vault, 'dawn')).toBe(true);
    expect(isActivityDoneThisWindow(e, BuildingType.Forge, 'dawn')).toBe(false);
  });

  it('reads expansion buildings 16+ from expansion_daily, window-agnostic', () => {
    // Infirmary is type 18 -> expansion bit (1 << (18 - 16)) = 0b100.
    const e = estate({ expansionDaily: 1 << (BuildingType.Infirmary - 16) });
    expect(isActivityDoneThisWindow(e, BuildingType.Infirmary, 'dusk')).toBe(true);
    expect(isActivityDoneThisWindow(e, BuildingType.Farm, 'dawn')).toBe(false);
  });

  it('treats an expansion building as done in any window once flagged', () => {
    const e = estate({ expansionDaily: 1 << (BuildingType.Farm - 16) });
    expect(isActivityDoneThisWindow(e, BuildingType.Farm, 'dawn')).toBe(true);
    expect(isActivityDoneThisWindow(e, BuildingType.Farm, 'midday')).toBe(true);
    expect(isActivityDoneThisWindow(e, BuildingType.Farm, 'dusk')).toBe(true);
  });

  it('reports buildings 0-15 as done once the day has Expired', () => {
    expect(isActivityDoneThisWindow(estate(), BuildingType.Workshop, 'expired')).toBe(true);
  });

  it('still reads expansion buildings from expansion_daily even when Expired', () => {
    // Expansion buildings ignore the window entirely — Expired does not force
    // them done; only their own bit does.
    expect(isActivityDoneThisWindow(estate(), BuildingType.Farm, 'expired')).toBe(false);
    const done = estate({ expansionDaily: 1 << (BuildingType.Farm - 16) });
    expect(isActivityDoneThisWindow(done, BuildingType.Farm, 'expired')).toBe(true);
  });
});

// nextWindowOpensAt

describe('nextWindowOpensAt', () => {
  it('points to Midday while in Dawn', () => {
    expect(nextWindowOpensAt(estate(), DAWN + 1 * HOUR)).toBe(DAWN + 4 * HOUR);
  });

  it('points to Dusk while in Midday', () => {
    expect(nextWindowOpensAt(estate(), DAWN + 5 * HOUR)).toBe(DAWN + 9 * HOUR);
  });

  it('returns null in Dusk — nothing more opens today', () => {
    expect(nextWindowOpensAt(estate(), DAWN + 10 * HOUR)).toBeNull();
  });

  it('returns null once Expired', () => {
    expect(nextWindowOpensAt(estate(), DAWN + 17 * HOUR)).toBeNull();
  });

  it('returns null when the day is not yet anchored (stale state)', () => {
    expect(nextWindowOpensAt(estate({ dailyDate: DAY - 1 }), DAWN)).toBeNull();
  });
});
