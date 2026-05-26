//! Cosmetic processors.
//!
//! Cosmetics on chain are pure ID slots — the off-chain catalog
//! (apps/web/src/lib/config/cosmetics-catalog.ts) maps `equipped_<kind>`
//! IDs to actual images / hex / display strings. The chain's only
//! responsibility is enforcing ownership: a player may equip an ID
//! only if the matching bit in `owned_<kind>` is set, which is
//! flipped on shop purchase via `fulfill_item`.
//!
//! Operations:
//! - equip: Set `equipped_<kind> = id` after validating ownership.

pub mod equip;
