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

use pinocchio::{AccountView, Address, ProgramResult};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{GARRISON_CAP_BY_TIER, KING_REGISTRY_SEED, MAX_CASTLES_PER_KING},
    state::KingRegistryAccount,
};

/// Garrison capacity for a king's subscription tier (uniform across castle tiers).
/// Clamps to the Legendary cap so an out-of-range tier can't index past the table.
pub fn garrison_cap_for_subscription_tier(subscription_tier: u8) -> u8 {
    GARRISON_CAP_BY_TIER[(subscription_tier as usize).min(GARRISON_CAP_BY_TIER.len() - 1)]
}

/// Create + initialize a king's `KingRegistryAccount` if it doesn't exist yet.
///
/// Shared by `claim_vacant_castle` (first claim) and `finalize_transition` (a
/// castle won by conquest whose new king has never ruled before). No-op when the
/// account already exists. The registry PDA is `[KING_REGISTRY_SEED, owner_player]`,
/// so the seeds derive from `owner_player_account` and the caller passes the bump.
pub fn ensure_king_registry(
    payer: &AccountView,
    registry_account: &AccountView,
    owner_player_account: &AccountView,
    registry_bump: u8,
    program_id: &Address,
) -> ProgramResult {
    if registry_account.data_len() > 0 {
        return Ok(());
    }

    let lamports = crate::utils::rent_exempt_const(KingRegistryAccount::LEN);
    let bump_seed = [registry_bump];
    let seeds = crate::seeds!(KING_REGISTRY_SEED, owner_player_account.address(), &bump_seed);
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: registry_account,
        lamports,
        space: KingRegistryAccount::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    let mut registry_data = registry_account.try_borrow_mut()?;
    let registry = unsafe { KingRegistryAccount::load_mut(&mut registry_data) };
    registry.account_key = crate::state::AccountKey::KingRegistry as u8;
    registry.king = *owner_player_account.address();
    registry.bump = registry_bump;
    registry.castle_count = 0;
    registry.max_castles = MAX_CASTLES_PER_KING;
    registry.castles = Default::default();
    Ok(())
}

pub mod appoint_court;
pub mod attack_castle;
pub mod cancel_upgrade;
pub mod claim_castle_rewards;
pub mod claim_garrison_loot;
pub mod claim_vacant_castle;
pub mod complete_upgrade;
pub mod court_cleanup;
pub mod create_castle;
pub mod dismiss_court;
pub mod finalize_transition;
pub mod force_remove_king;
pub mod garrison_cleanup;
pub mod initiate_upgrade;
pub mod join_garrison;
pub mod leave_garrison;
pub mod relieve_garrison;
pub mod resign_court;
pub mod rewards_cleanup;
pub mod update_castle_config;
pub mod update_castle_status;
