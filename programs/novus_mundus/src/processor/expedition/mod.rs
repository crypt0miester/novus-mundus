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
//! ## Mining Tiers (Workshop-gated)
//!
//! | Tier | Name     | Duration | Gems/Op/Hr | Workshop Lv |
//! |------|----------|----------|------------|-------------|
//! | 0    | Surface  | 1h       | 10         | 1           |
//! | 1    | Shallow  | 2h       | 18         | 5           |
//! | 2    | Deep     | 4h       | 30         | 10          |
//! | 3    | Volcanic | 8h       | 50         | 15          |
//! | 4    | Abyssal  | 16h      | 80         | 20          |
//!
//! ## Fishing Tiers (Dock-gated)
//!
//! | Tier | Name     | Duration | Produce/Op/Hr | Dock Lv |
//! |------|----------|----------|---------------|---------|
//! | 0    | Shore    | 1h       | 15            | 1       |
//! | 1    | River    | 2h       | 25            | 5       |
//! | 2    | Lake     | 4h       | 40            | 10      |
//! | 3    | DeepSea  | 8h       | 60            | 15      |
//! | 4    | Abyss    | 16h      | 100           | 20      |

pub mod abort;
pub mod claim;
pub mod speedup;
pub mod start;
pub mod strike;
