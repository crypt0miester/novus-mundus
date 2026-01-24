//! King's Castle System Processors
//!
//! Instructions (270-299 range):
//! - 270: create_castle - DAO instruction to create a castle
//! - 271: claim_vacant_castle - Claim an unoccupied castle
//! - 272: appoint_court - King appoints a court member
//! - 273: dismiss_court - King dismisses a court member
//! - 274: resign_court - Court member resigns their position
//! - 275: initiate_upgrade - Start a castle upgrade
//! - 276: cancel_upgrade - Cancel an in-progress upgrade
//! - 277: join_garrison - Join the castle garrison with units/weapons/hero
//! - 278: leave_garrison - Leave the garrison voluntarily
//! - 279: relieve_garrison - King removes a garrison member
//! - 280: claim_castle_rewards - Claim daily rewards (king/court/team member)
//! - 281: claim_garrison_loot - Claim weapons captured from attackers
//! - 282: garrison_cleanup - Clean up garrison during transition (permissionless)
//! - 283: court_cleanup - Clean up court during transition (permissionless)
//! - 284: rewards_cleanup - Clean up reward accounts during transition (permissionless)
//! - 285: finalize_transition - Finalize ownership transition (permissionless)
//! - 286: update_castle_config - DAO instruction to update castle config
//! - 287: force_remove_king - DAO instruction to remove a king
//! - 288: attack_castle - Solo attack on castle garrison
//! - 289: update_castle_status - Permissionless time-based status transitions
//! - 290: complete_upgrade - Complete upgrade when timer expires (permissionless)

pub mod create_castle;
pub mod claim_vacant_castle;
pub mod appoint_court;
pub mod dismiss_court;
pub mod resign_court;
pub mod initiate_upgrade;
pub mod cancel_upgrade;
pub mod complete_upgrade;
pub mod join_garrison;
pub mod leave_garrison;
pub mod relieve_garrison;
pub mod claim_castle_rewards;
pub mod claim_garrison_loot;
pub mod garrison_cleanup;
pub mod court_cleanup;
pub mod rewards_cleanup;
pub mod finalize_transition;
pub mod update_castle_config;
pub mod force_remove_king;
pub mod attack_castle;
pub mod update_castle_status;
