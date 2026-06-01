//! Expedition System Processors
//!
//! Mining and Fishing expeditions provide an active engagement loop for
//! resource collection. Players lock operatives for a duration, optionally
//! perform strikes/casts during the expedition, and claim rewards at the end.
//!
//! ## Instructions
//!
//! - `start`: Begin a mining or fishing expedition (creates ExpeditionAccount PDA)
//! - `strike`: Perform a strike/cast during expedition (Phase 2)
//! - `claim`: Claim expedition rewards (closes ExpeditionAccount, refunds rent)
//! - `abort`: Cancel expedition early (returns operatives, NOVI cost is burnt)
//! - `speedup`: Speed up expedition completion by spending gems
//!
//! ## Hero Integration
//!
//! Heroes can be sent with expeditions for bonus yield:
//! - MiningAffinity buff: Bonus yield on mining expeditions
//! - FishingAffinity buff: Bonus yield on fishing expeditions
//! - Origin City Bonus: +25% extra yield if hero's origin matches expedition location AND has affinity
//!
//! ## Operative Tier Multipliers
//!
//! Higher-tier operatives provide better expedition yields:
//! - Tier 1 operatives: 1.0x yield (100%)
//! - Tier 2 operatives: 1.5x yield (150%)
//! - Tier 3 operatives: 2.0x yield (200%)
//!
//! ## Mining Tiers (Mine-gated)
//!
//! Rates are stored ×100 (`economic_config.mining_gems_per_op_hour`), so the
//! claim divides by 100. The "Rate" column is the stored value; the effective
//! yield is `Rate / 100` gems per (weighted) operative per hour.
//!
//! | Tier | Name     | Duration | Rate (stored) | Gems/Op/Hr | Mine Lv |
//! |------|----------|----------|---------------|------------|---------|
//! | 0    | Surface  | 1h       | 1             | 0.01       | 1       |
//! | 1    | Shallow  | 2h       | 2             | 0.02       | 5       |
//! | 2    | Deep     | 4h       | 5             | 0.05       | 10      |
//! | 3    | Volcanic | 8h       | 8             | 0.08       | 15      |
//! | 4    | Abyssal  | 16h      | 10            | 0.10       | 20      |
//!
//! Operatives are weighted by tier (op1 1.0x / op2 1.5x / op3 2.0x) and capped
//! at `max_operatives_per_expedition` (default 10,000) with √ diminishing
//! returns beyond, so per-run base yield is bounded (~100 gems at tier 0,
//! ~16,000 at tier 4) before time / research / hero / strike / rare multipliers.
//!
//! ## Fishing Tiers (Dock-gated)
//!
//! Rates stored ×100 (`economic_config.fishing_produce_per_op_hour`); same /100.
//!
//! | Tier | Name     | Duration | Rate (stored) | Produce/Op/Hr | Dock Lv |
//! |------|----------|----------|---------------|---------------|---------|
//! | 0    | Shore    | 1h       | 2             | 0.02          | 1       |
//! | 1    | River    | 2h       | 3             | 0.03          | 5       |
//! | 2    | Lake     | 4h       | 8             | 0.08          | 10      |
//! | 3    | DeepSea  | 8h       | 12            | 0.12          | 15      |
//! | 4    | Abyss    | 16h      | 15            | 0.15          | 20      |

pub mod abort;
pub mod claim;
pub mod speedup;
pub mod start;
pub mod strike;
