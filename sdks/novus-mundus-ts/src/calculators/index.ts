/**
 * Calculator Module
 *
 * Game calculations matching Rust on-chain logic.
 * All calculations use golden ratio family for consistent progression.
 */

// Constants (golden ratio family, basis points helpers)
export * from './constants.ts';

// Time calculations (day/night cycle, activity multipliers)
export * from './time.ts';

// Travel calculations (distance, travel time, teleport costs)
export * from './travel.ts';

// Combat calculations (damage, weapons, casualties)
export * from './combat.ts';

// Reward calculations (loot pools, XP, fragments, gems)
export * from './rewards.ts';

// Stamina calculations (regeneration, consumption)
export * from './stamina.ts';

// Progression calculations (XP requirements, leveling)
export * from './progression.ts';

// Resource calculations (networth, consumption, generation)
export * from './resources.ts';

// Cost calculations (hiring, upgrades, speedups)
export * from './costs.ts';

// NOVI purchase calculations (bonuses, caps, streaks)
export * from './novi.ts';
