/**
 * Calculator Module
 *
 * Game calculations matching Rust on-chain logic.
 * All calculations use golden ratio family for consistent progression.
 */

// Constants (golden ratio family, basis points helpers)
export * from './constants';

// Time calculations (day/night cycle, activity multipliers)
export * from './time';

// Travel calculations (distance, travel time, teleport costs)
export * from './travel';

// Combat calculations (damage, weapons, casualties)
export * from './combat';

// Reward calculations (loot pools, XP, fragments, gems)
export * from './rewards';

// Stamina calculations (regeneration, consumption)
export * from './stamina';

// Progression calculations (XP requirements, leveling)
export * from './progression';

// Resource calculations (networth, consumption, generation)
export * from './resources';

// Cost calculations (hiring, upgrades, speedups)
export * from './costs';

// NOVI purchase calculations (bonuses, caps, streaks)
export * from './novi';

// Terrain calculations (elevation, passability, rendering)
export * from './terrain';
