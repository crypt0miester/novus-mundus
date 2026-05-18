/**
 * Time Calculator Unit Tests
 *
 * Tests for location-aware day/night cycle calculations.
 */

import { describe, it, expect } from 'bun:test';
import {
  TimeOfDay,
  ActivityType,
  calculateLocalTime,
  getTimeOfDay,
  getCurrentTimeOfDay,
  isGoldenHour,
  isNight,
  isDay,
  isPeakDay,
  isDeepNight,
  getActivityMultiplier,
  getActivityMultiplierBps,
  applyTimeMultiplier,
  getTimeOfDayName,
  getTimeRange,
  getSecondsUntilNextPeriod,
} from '../../src/calculators/time';

// calculateLocalTime Tests

describe('calculateLocalTime', () => {
  it('should return a value in the 0-999 range', () => {
    const localTime = calculateLocalTime(1000000, 0);
    expect(localTime).toBeGreaterThanOrEqual(0);
    expect(localTime).toBeLessThan(1000);
  });

  it('should return the same base time at longitude 0 (UTC)', () => {
    // Two timestamps at longitude 0 should differ by cycled offset
    const t1 = calculateLocalTime(0, 0);
    expect(t1).toBe(0);
  });

  it('should offset by +500 at longitude 180 (half cycle ahead)', () => {
    // At timestamp 0, longitude 0 => localTime 0
    // At timestamp 0, longitude 180 => offset = 180 * 1000 / 360 = 500
    const localTime = calculateLocalTime(0, 180);
    expect(localTime).toBe(500);
  });

  it('should offset by -250 at longitude -90 (quarter cycle behind)', () => {
    // At timestamp 0, longitude -90 => offset = -90 * 1000 / 360 = -250
    // Wrapped: (0 + (-250)) % 1000 + 1000) % 1000 = 750
    const localTime = calculateLocalTime(0, -90);
    expect(localTime).toBe(750);
  });

  it('should wrap around correctly for negative offsets', () => {
    const localTime = calculateLocalTime(0, -180);
    // offset = -180 * 1000 / 360 = -500 => wrapped = 500
    expect(localTime).toBe(500);
  });

  it('should advance with timestamp', () => {
    // One full cycle = 86400 seconds. Half cycle = 43200 seconds.
    // At longitude 0: localTime = (43200 * 1000) / 86400 = 500
    const localTime = calculateLocalTime(43200, 0);
    expect(localTime).toBe(500);
  });

  it('should wrap after a full cycle', () => {
    // Full cycle: timestamp 86400 at longitude 0 => same as timestamp 0
    const t0 = calculateLocalTime(0, 0);
    const tFull = calculateLocalTime(86400, 0);
    expect(tFull).toBe(t0);
  });
});

// getTimeOfDay Tests

describe('getTimeOfDay', () => {
  it('should return DeepNight for 0-124', () => {
    expect(getTimeOfDay(0)).toBe(TimeOfDay.DeepNight);
    expect(getTimeOfDay(62)).toBe(TimeOfDay.DeepNight);
    expect(getTimeOfDay(124)).toBe(TimeOfDay.DeepNight);
  });

  it('should return Dawn for 125-249', () => {
    expect(getTimeOfDay(125)).toBe(TimeOfDay.Dawn);
    expect(getTimeOfDay(187)).toBe(TimeOfDay.Dawn);
    expect(getTimeOfDay(249)).toBe(TimeOfDay.Dawn);
  });

  it('should return Morning for 250-374', () => {
    expect(getTimeOfDay(250)).toBe(TimeOfDay.Morning);
    expect(getTimeOfDay(312)).toBe(TimeOfDay.Morning);
    expect(getTimeOfDay(374)).toBe(TimeOfDay.Morning);
  });

  it('should return Midday for 375-624', () => {
    expect(getTimeOfDay(375)).toBe(TimeOfDay.Midday);
    expect(getTimeOfDay(500)).toBe(TimeOfDay.Midday);
    expect(getTimeOfDay(624)).toBe(TimeOfDay.Midday);
  });

  it('should return Afternoon for 625-749', () => {
    expect(getTimeOfDay(625)).toBe(TimeOfDay.Afternoon);
    expect(getTimeOfDay(687)).toBe(TimeOfDay.Afternoon);
    expect(getTimeOfDay(749)).toBe(TimeOfDay.Afternoon);
  });

  it('should return Dusk for 750-874', () => {
    expect(getTimeOfDay(750)).toBe(TimeOfDay.Dusk);
    expect(getTimeOfDay(812)).toBe(TimeOfDay.Dusk);
    expect(getTimeOfDay(874)).toBe(TimeOfDay.Dusk);
  });

  it('should return Evening for 875-999', () => {
    expect(getTimeOfDay(875)).toBe(TimeOfDay.Evening);
    expect(getTimeOfDay(937)).toBe(TimeOfDay.Evening);
    expect(getTimeOfDay(999)).toBe(TimeOfDay.Evening);
  });

  it('should cover all 7 periods across the full range', () => {
    const periods = new Set<TimeOfDay>();
    for (let t = 0; t < 1000; t += 50) {
      periods.add(getTimeOfDay(t));
    }
    expect(periods.size).toBe(7);
  });
});

// getCurrentTimeOfDay Tests

describe('getCurrentTimeOfDay', () => {
  it('should combine calculateLocalTime and getTimeOfDay', () => {
    // timestamp 0, longitude 0 => localTime 0 => DeepNight
    expect(getCurrentTimeOfDay(0, 0)).toBe(TimeOfDay.DeepNight);
  });

  it('should return Midday at longitude 180 when timestamp 0', () => {
    // localTime = 500 => Midday (375-624)
    expect(getCurrentTimeOfDay(0, 180)).toBe(TimeOfDay.Midday);
  });

  it('should return correct period for shifted longitude', () => {
    // timestamp 0, longitude 90 => offset = 250 => Morning
    expect(getCurrentTimeOfDay(0, 90)).toBe(TimeOfDay.Morning);
  });
});

// Time Period Helper Tests

describe('isGoldenHour', () => {
  it('should return true for Dawn', () => {
    expect(isGoldenHour(TimeOfDay.Dawn)).toBe(true);
  });

  it('should return true for Dusk', () => {
    expect(isGoldenHour(TimeOfDay.Dusk)).toBe(true);
  });

  it('should return false for all other periods', () => {
    expect(isGoldenHour(TimeOfDay.DeepNight)).toBe(false);
    expect(isGoldenHour(TimeOfDay.Morning)).toBe(false);
    expect(isGoldenHour(TimeOfDay.Midday)).toBe(false);
    expect(isGoldenHour(TimeOfDay.Afternoon)).toBe(false);
    expect(isGoldenHour(TimeOfDay.Evening)).toBe(false);
  });
});

describe('isNight', () => {
  it('should return true for DeepNight, Dawn, and Evening', () => {
    expect(isNight(TimeOfDay.DeepNight)).toBe(true);
    expect(isNight(TimeOfDay.Dawn)).toBe(true);
    expect(isNight(TimeOfDay.Evening)).toBe(true);
  });

  it('should return false for day periods', () => {
    expect(isNight(TimeOfDay.Morning)).toBe(false);
    expect(isNight(TimeOfDay.Midday)).toBe(false);
    expect(isNight(TimeOfDay.Afternoon)).toBe(false);
    expect(isNight(TimeOfDay.Dusk)).toBe(false);
  });
});

describe('isDay', () => {
  it('should return true for Morning, Midday, and Afternoon', () => {
    expect(isDay(TimeOfDay.Morning)).toBe(true);
    expect(isDay(TimeOfDay.Midday)).toBe(true);
    expect(isDay(TimeOfDay.Afternoon)).toBe(true);
  });

  it('should return false for night periods', () => {
    expect(isDay(TimeOfDay.DeepNight)).toBe(false);
    expect(isDay(TimeOfDay.Dawn)).toBe(false);
    expect(isDay(TimeOfDay.Dusk)).toBe(false);
    expect(isDay(TimeOfDay.Evening)).toBe(false);
  });
});

describe('isPeakDay', () => {
  it('should return true only for Midday', () => {
    expect(isPeakDay(TimeOfDay.Midday)).toBe(true);
  });

  it('should return false for all other periods', () => {
    expect(isPeakDay(TimeOfDay.DeepNight)).toBe(false);
    expect(isPeakDay(TimeOfDay.Dawn)).toBe(false);
    expect(isPeakDay(TimeOfDay.Morning)).toBe(false);
    expect(isPeakDay(TimeOfDay.Afternoon)).toBe(false);
    expect(isPeakDay(TimeOfDay.Dusk)).toBe(false);
    expect(isPeakDay(TimeOfDay.Evening)).toBe(false);
  });
});

describe('isDeepNight', () => {
  it('should return true only for DeepNight', () => {
    expect(isDeepNight(TimeOfDay.DeepNight)).toBe(true);
  });

  it('should return false for all other periods', () => {
    expect(isDeepNight(TimeOfDay.Dawn)).toBe(false);
    expect(isDeepNight(TimeOfDay.Morning)).toBe(false);
    expect(isDeepNight(TimeOfDay.Midday)).toBe(false);
    expect(isDeepNight(TimeOfDay.Afternoon)).toBe(false);
    expect(isDeepNight(TimeOfDay.Dusk)).toBe(false);
    expect(isDeepNight(TimeOfDay.Evening)).toBe(false);
  });
});

// Activity Multiplier Tests

describe('getActivityMultiplier', () => {
  it('should return all multipliers > 0', () => {
    const activities = [
      ActivityType.Hiring,
      ActivityType.Purchasing,
      ActivityType.Collecting,
      ActivityType.Mining,
      ActivityType.Fishing,
      ActivityType.Attacking,
      ActivityType.Defending,
      ActivityType.Traveling,
      ActivityType.Consuming,
      ActivityType.Researching,
      ActivityType.XPGain,
      ActivityType.StaminaRegen,
      ActivityType.LootDrop,
    ];

    const times = [
      TimeOfDay.DeepNight,
      TimeOfDay.Dawn,
      TimeOfDay.Morning,
      TimeOfDay.Midday,
      TimeOfDay.Afternoon,
      TimeOfDay.Dusk,
      TimeOfDay.Evening,
    ];

    for (const activity of activities) {
      for (const time of times) {
        const multiplier = getActivityMultiplier(activity, time);
        expect(multiplier).toBeGreaterThan(0);
      }
    }
  });

  it('should give Hiring the best bonus at Midday (PHI)', () => {
    const midday = getActivityMultiplier(ActivityType.Hiring, TimeOfDay.Midday);
    expect(midday).toBeCloseTo(1.618, 2);
  });

  it('should give Hiring a penalty at DeepNight', () => {
    const deepNight = getActivityMultiplier(ActivityType.Hiring, TimeOfDay.DeepNight);
    expect(deepNight).toBeLessThan(1.0);
    expect(deepNight).toBeCloseTo(0.618, 2);
  });

  it('should give Hiring neutral at Dawn and Dusk', () => {
    expect(getActivityMultiplier(ActivityType.Hiring, TimeOfDay.Dawn)).toBe(1.0);
    expect(getActivityMultiplier(ActivityType.Hiring, TimeOfDay.Dusk)).toBe(1.0);
  });

  it('should give Collecting a penalty at DeepNight and Evening', () => {
    const deepNight = getActivityMultiplier(ActivityType.Collecting, TimeOfDay.DeepNight);
    const evening = getActivityMultiplier(ActivityType.Collecting, TimeOfDay.Evening);
    expect(deepNight).toBeCloseTo(0.618, 2);
    expect(evening).toBeCloseTo(0.618, 2);
  });

  it('should give Mining the best bonus at DeepNight', () => {
    const deepNight = getActivityMultiplier(ActivityType.Mining, TimeOfDay.DeepNight);
    expect(deepNight).toBeCloseTo(1.618, 2);
  });

  it('should give Attacking the best bonus at DeepNight (PHI)', () => {
    const deepNight = getActivityMultiplier(ActivityType.Attacking, TimeOfDay.DeepNight);
    expect(deepNight).toBeCloseTo(1.618, 2);
  });

  it('should give Defending the best bonus at Midday (PHI)', () => {
    const midday = getActivityMultiplier(ActivityType.Defending, TimeOfDay.Midday);
    expect(midday).toBeCloseTo(1.618, 2);
  });

  it('should give XPGain a night-wisdom bonus at DeepNight and Evening', () => {
    const deepNight = getActivityMultiplier(ActivityType.XPGain, TimeOfDay.DeepNight);
    const evening = getActivityMultiplier(ActivityType.XPGain, TimeOfDay.Evening);
    expect(deepNight).toBeCloseTo(1.272, 2);
    expect(evening).toBeCloseTo(1.272, 2);
  });

  it('should give StaminaRegen the best bonus at DeepNight (PHI)', () => {
    const deepNight = getActivityMultiplier(ActivityType.StaminaRegen, TimeOfDay.DeepNight);
    expect(deepNight).toBeCloseTo(1.618, 2);
  });

  it('should return 1.0 for unknown activity type', () => {
    const multiplier = getActivityMultiplier(999 as ActivityType, TimeOfDay.Midday);
    expect(multiplier).toBe(1.0);
  });
});

// getActivityMultiplierBps Tests

describe('getActivityMultiplierBps', () => {
  it('should return 10000 for neutral multiplier (1.0x)', () => {
    // Hiring at Dawn = 1.0
    const bps = getActivityMultiplierBps(ActivityType.Hiring, TimeOfDay.Dawn);
    expect(bps).toBe(10000);
  });

  it('should return ~16180 for PHI multiplier', () => {
    // Hiring at Midday = PHI = 1.618
    const bps = getActivityMultiplierBps(ActivityType.Hiring, TimeOfDay.Midday);
    expect(bps).toBe(Math.floor(1.618033988749895 * 10000));
  });

  it('should always return a positive integer', () => {
    const bps = getActivityMultiplierBps(ActivityType.Mining, TimeOfDay.Midday);
    expect(bps).toBeGreaterThan(0);
    expect(Number.isInteger(bps)).toBe(true);
  });
});

// applyTimeMultiplier Tests

describe('applyTimeMultiplier', () => {
  it('should return the base value for 1.0 multiplier', () => {
    // Hiring at Dawn = 1.0
    const result = applyTimeMultiplier(1000, ActivityType.Hiring, TimeOfDay.Dawn);
    expect(result).toBe(1000);
  });

  it('should apply PHI multiplier correctly', () => {
    // Hiring at Midday = PHI (~1.618)
    const result = applyTimeMultiplier(1000, ActivityType.Hiring, TimeOfDay.Midday);
    expect(result).toBe(Math.floor(1000 * 1.618033988749895));
  });

  it('should apply penalty multiplier correctly', () => {
    // Hiring at DeepNight = PHI_SQUARED_INVERSE (~0.382)
    const result = applyTimeMultiplier(1000, ActivityType.Hiring, TimeOfDay.DeepNight);
    expect(result).toBeLessThan(1000);
    expect(result).toBeGreaterThan(0);
  });

  it('should floor the result', () => {
    const result = applyTimeMultiplier(100, ActivityType.Collecting, TimeOfDay.Dawn);
    expect(Number.isInteger(result)).toBe(true);
  });
});

// getTimeOfDayName Tests

describe('getTimeOfDayName', () => {
  it('should return non-empty strings for all periods', () => {
    const allPeriods = [
      TimeOfDay.DeepNight,
      TimeOfDay.Dawn,
      TimeOfDay.Morning,
      TimeOfDay.Midday,
      TimeOfDay.Afternoon,
      TimeOfDay.Dusk,
      TimeOfDay.Evening,
    ];

    for (const period of allPeriods) {
      const name = getTimeOfDayName(period);
      expect(name.length).toBeGreaterThan(0);
      expect(name).not.toBe('Unknown');
    }
  });

  it('should return correct names', () => {
    expect(getTimeOfDayName(TimeOfDay.DeepNight)).toBe('Deep Night');
    expect(getTimeOfDayName(TimeOfDay.Dawn)).toBe('Dawn');
    expect(getTimeOfDayName(TimeOfDay.Morning)).toBe('Morning');
    expect(getTimeOfDayName(TimeOfDay.Midday)).toBe('Midday');
    expect(getTimeOfDayName(TimeOfDay.Afternoon)).toBe('Afternoon');
    expect(getTimeOfDayName(TimeOfDay.Dusk)).toBe('Dusk');
    expect(getTimeOfDayName(TimeOfDay.Evening)).toBe('Evening');
  });

  it('should return Unknown for invalid period', () => {
    expect(getTimeOfDayName(99 as TimeOfDay)).toBe('Unknown');
  });
});

// getTimeRange Tests

describe('getTimeRange', () => {
  it('should return non-empty strings for all periods', () => {
    const allPeriods = [
      TimeOfDay.DeepNight,
      TimeOfDay.Dawn,
      TimeOfDay.Morning,
      TimeOfDay.Midday,
      TimeOfDay.Afternoon,
      TimeOfDay.Dusk,
      TimeOfDay.Evening,
    ];

    for (const period of allPeriods) {
      const range = getTimeRange(period);
      expect(range.length).toBeGreaterThan(0);
      expect(range).not.toBe('Unknown');
    }
  });

  it('should return correct time ranges', () => {
    expect(getTimeRange(TimeOfDay.DeepNight)).toBe('00:00-03:00');
    expect(getTimeRange(TimeOfDay.Dawn)).toBe('03:00-06:00');
    expect(getTimeRange(TimeOfDay.Morning)).toBe('06:00-09:00');
    expect(getTimeRange(TimeOfDay.Midday)).toBe('09:00-15:00');
    expect(getTimeRange(TimeOfDay.Afternoon)).toBe('15:00-18:00');
    expect(getTimeRange(TimeOfDay.Dusk)).toBe('18:00-21:00');
    expect(getTimeRange(TimeOfDay.Evening)).toBe('21:00-00:00');
  });

  it('should have non-overlapping ranges that cover 24 hours', () => {
    // Extract start hours from ranges and verify they form a contiguous sequence
    const ranges = [
      getTimeRange(TimeOfDay.DeepNight),
      getTimeRange(TimeOfDay.Dawn),
      getTimeRange(TimeOfDay.Morning),
      getTimeRange(TimeOfDay.Midday),
      getTimeRange(TimeOfDay.Afternoon),
      getTimeRange(TimeOfDay.Dusk),
      getTimeRange(TimeOfDay.Evening),
    ];

    for (let i = 0; i < ranges.length - 1; i++) {
      const endOfCurrent = ranges[i]!.split('-')[1];
      const startOfNext = ranges[i + 1]!.split('-')[0];
      expect(endOfCurrent).toBe(startOfNext);
    }

    // First starts at 00:00
    expect(ranges[0]!.split('-')[0]).toBe('00:00');
    // Last ends at 00:00 (midnight wrap)
    expect(ranges[ranges.length - 1]!.split('-')[1]).toBe('00:00');
  });

  it('should return Unknown for invalid period', () => {
    expect(getTimeRange(99 as TimeOfDay)).toBe('Unknown');
  });
});

// getSecondsUntilNextPeriod Tests

describe('getSecondsUntilNextPeriod', () => {
  it('should return a positive number of seconds', () => {
    const seconds = getSecondsUntilNextPeriod(0, 0);
    expect(seconds).toBeGreaterThan(0);
  });

  it('should return less than a full cycle', () => {
    const seconds = getSecondsUntilNextPeriod(1000, 0);
    expect(seconds).toBeLessThanOrEqual(86400);
  });

  it('should decrease as time approaches next threshold', () => {
    // At timestamp 0, longitude 0 => localTime 0, DeepNight
    // DeepNight goes up to 125, next threshold is 125
    const secondsEarly = getSecondsUntilNextPeriod(0, 0);
    const secondsLater = getSecondsUntilNextPeriod(1000, 0);

    // secondsLater should be less (closer to next threshold)
    expect(secondsLater).toBeLessThan(secondsEarly);
  });

  it('should work at different longitudes', () => {
    // At timestamp 0, longitude 0 => localTime 0, DeepNight (threshold 125)
    // remaining = 125, seconds = ceil(125 * 86400 / 1000) = 10800
    const secondsLon0 = getSecondsUntilNextPeriod(0, 0);
    expect(secondsLon0).toBe(10800);

    // At timestamp 0, longitude 90 => localTime 250, Morning (threshold 375)
    // remaining = 125, seconds = ceil(125 * 86400 / 1000) = 10800
    const secondsLon90 = getSecondsUntilNextPeriod(0, 90);
    expect(secondsLon90).toBe(10800);

    // At timestamp 0, longitude 135 => localTime 375, Midday (threshold 625)
    // remaining = 250, seconds = ceil(250 * 86400 / 1000) = 21600
    const secondsLon135 = getSecondsUntilNextPeriod(0, 135);
    expect(secondsLon135).toBe(21600);
    expect(secondsLon135).not.toBe(secondsLon0);
  });
});
