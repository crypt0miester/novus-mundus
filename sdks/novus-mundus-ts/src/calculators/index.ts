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

// Daily-activity time windows (estate Dawn/Midday/Dusk mini-game gating)
export * from './windows';

// Travel calculations (distance, travel time, teleport costs)
export * from './travel';

// Combat calculations (damage, weapons, casualties)
export * from './combat';

// Battle forecasting (client-side outcome prediction + force recommendation)
export * from './battle';

// Reward calculations (loot pools, XP, fragments, gems)
export * from './rewards';

// Stamina calculations (regeneration, consumption)
export * from './stamina';

// Progression calculations (XP requirements, leveling)
export * from './progression';

// Resource calculations (networth, consumption, generation)
export * from './resources';

// Estate activity forecasting (faithful NOVI-consumption economy ports)
export * from './forecast';

// Cost calculations (hiring, upgrades, speedups)
export * from './costs';

// NOVI purchase calculations (bonuses, caps, streaks)
export * from './novi';

// Grid coordinate helpers + integer noise (consumed by biome).
export * from './terrain';

// Biome system (replaces the retired elevation/passability/affinity helpers).
export * from './biome';
