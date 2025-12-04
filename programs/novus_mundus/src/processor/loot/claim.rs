use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
};

use crate::{
    error::GameError,
    state::{LootAccount, PlayerAccount, UserAccount, GameEngine},
    constants::{PLAYER_SEED, USER_SEED},
    logic::calculate_networth,
    helpers::close_account,
    validation::{
        require_signer,
        require_writable,
        require_owner,
        require_pda,
    },
};

/// Claim loot and transfer rewards to player
///
/// # Security Features
/// - `claimed` flag prevents double-claim (checked FIRST!)
/// - Ownership validation (triple check: data, PDA, signer)
/// - Expiration check
/// - Full account closure (rent reclamation)
/// - All arithmetic uses checked operations
///
/// # Accounts
/// 0. [writable] loot - LootAccount PDA
/// 1. [writable] player - PlayerAccount PDA
/// 2. [writable] user - UserAccount PDA
/// 3. [signer, writable] owner - Player's wallet (claims loot)
/// 4. [] game_engine - GameEngine PDA (for networth calculation)
/// 5. [writable] creator - Wallet that paid rent (gets refund)
///
/// # Instruction Data
/// None (loot_id derived from PDA validation)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> Result<(), ProgramError> {
    // 1. Parse Accounts

    let [loot, player, user, owner, game_engine, creator] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(owner)?;
    require_writable(loot)?;
    require_writable(player)?;
    require_writable(user)?;
    require_writable(creator)?;
    require_owner(player, program_id)?;
    require_owner(user, program_id)?;
    require_owner(loot, program_id)?;

    // Validate PDAs
    let player_bump = require_pda(player, &[PLAYER_SEED, owner.key()], program_id)?;
    let user_bump = require_pda(user, &[USER_SEED, owner.key()], program_id)?;

    // 3. Load Loot Account

    let mut loot_data_ref = loot.try_borrow_mut_data()?;
    let loot_data = unsafe { LootAccount::load_mut(&mut loot_data_ref) };

    // 4. SECURITY CHECKS (order matters!)

    // CHECK 1: Already claimed? (FIRST CHECK - prevents double-claim)
    if loot_data.claimed {
        return Err(GameError::AlreadyClaimed.into());
    }

    // CHECK 2: Ownership validation
    if &loot_data.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // CHECK 2b: Creator validation (must match who paid rent)
    if &loot_data.creator != creator.key() {
        return Err(GameError::InvalidParameter.into());
    }

    // CHECK 3: Expiration check
    let now = Clock::get()?.unix_timestamp;
    if now > loot_data.expires_at {
        return Err(GameError::LootExpired.into());
    }

    // CHECK 4: PDA validation (ensure loot_id matches)
    let (expected_loot, _) = LootAccount::derive_pda(owner.key(), loot_data.loot_id);
    if loot.key() != &expected_loot {
        return Err(ProgramError::InvalidSeeds);
    }

    // 5. MARK AS CLAIMED (before any transfers!)

    loot_data.claimed = true;

    // 6. Load Player and User Accounts

    let mut player_data_ref = player.try_borrow_mut_data()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    let mut user_data_ref = user.try_borrow_mut_data()?;
    let user_data = unsafe { UserAccount::load_mut(&mut user_data_ref) };

    // Verify ownership matches
    if &player_data.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }
    if player_data.bump != player_bump {
        return Err(ProgramError::InvalidSeeds);
    }

    if &user_data.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }
    if user_data.bump != user_bump {
        return Err(ProgramError::InvalidSeeds);
    }

    // 7. TRANSFER REWARDS (all checked operations)

    // Cash
    player_data.cash_on_hand = player_data.cash_on_hand
        .checked_add(loot_data.cash)
        .ok_or(GameError::MathOverflow)?;

    // Reserved Novi
    user_data.reserved_novi = user_data.reserved_novi
        .checked_add(loot_data.reserved_novi)
        .ok_or(GameError::MathOverflow)?;

    // Weapons (all types)
    player_data.melee_weapons = player_data.melee_weapons
        .checked_add(loot_data.melee_weapons)
        .ok_or(GameError::MathOverflow)?;
    player_data.ranged_weapons = player_data.ranged_weapons
        .checked_add(loot_data.ranged_weapons)
        .ok_or(GameError::MathOverflow)?;
    player_data.siege_weapons = player_data.siege_weapons
        .checked_add(loot_data.siege_weapons)
        .ok_or(GameError::MathOverflow)?;

    // Produce
    player_data.produce = player_data.produce
        .checked_add(loot_data.produce)
        .ok_or(GameError::MathOverflow)?;

    // Vehicles
    player_data.vehicles = player_data.vehicles
        .checked_add(loot_data.vehicles)
        .ok_or(GameError::MathOverflow)?;

    // Fragments (for hero leveling)
    player_data.fragments = player_data.fragments
        .checked_add(loot_data.fragments)
        .ok_or(GameError::MathOverflow)?;

    // Gems (for speed-ups)
    player_data.gems = player_data.gems
        .checked_add(loot_data.gems)
        .ok_or(GameError::MathOverflow)?;

    // Update timestamps
    if loot_data.reserved_novi > 0 {
        user_data.reserved_novi_earned_at = now;
    }

    // 8. Recalculate Networth

    let game_engine_data_ref = game_engine.try_borrow_data()?;
    let game_engine_data = unsafe { GameEngine::load(&game_engine_data_ref) };
    player_data.networth = calculate_networth(player_data, &game_engine_data.economic_config)?;

    // 9. CLOSE ACCOUNT (rent reclamation)

    // Drop borrows before closing account
    drop(loot_data_ref);
    drop(player_data_ref);
    drop(user_data_ref);
    drop(game_engine_data_ref);

    // Close loot account (refund rent to creator)
    close_account(loot, creator)?;

    Ok(())
}
