//! Initiate Upgrade - King starts a castle upgrade
//!
//! Instruction 275
//!
//! King can initiate upgrades to castle facilities:
//! - Fortification: +5% defense per level
//! - Treasury: +10% rewards per level
//! - Chambers: +1 court slot per level (max 3)
//! - Watchtower: +10% early warning per level
//! - Armory: +3% defense quality per level

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
    sysvars::{clock::Clock, Sysvar},
};

use crate::{
    emit,
    error::GameError,
    events::CastleUpgradeStarted,
    state::{CastleAccount, PlayerAccount},
    constants::{
        CASTLE_UPGRADE_FORTIFICATION, CASTLE_UPGRADE_TREASURY,
        CASTLE_UPGRADE_CHAMBERS, CASTLE_UPGRADE_WATCHTOWER, CASTLE_UPGRADE_ARMORY,
        MAX_FORTIFICATION_LEVEL, MAX_TREASURY_LEVEL,
        MAX_CHAMBERS_LEVEL, MAX_WATCHTOWER_LEVEL, MAX_ARMORY_LEVEL,
        PLAYER_SEED,
    },
    helpers::burn_tokens,
    validation::require_owner,
};

/// Upgrade durations in seconds (base time per level)
/// Level 1 = 3 days, Level 10 = 30 days
const UPGRADE_DURATION_BASE: i64 = 259_200; // 3 days per level (72 hours)

/// NOVI cost per upgrade level
const UPGRADE_COST_BASE: u64 = 10_000;
const UPGRADE_COST_MULTIPLIER: u64 = 15; // 1.5x per level (divided by 10)

/// Initiate Upgrade instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)
/// - upgrade_type: u8 (byte 6)

/// Accounts:
/// 0. [signer] King wallet
/// 1. [writable] King player account
/// 2. [writable] Castle account
/// 3. [writable] Locked token account (owned by PlayerAccount PDA)
/// 4. [writable] NOVI mint
/// 5. [] Token program

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    if accounts.len() < 6 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let king_wallet = &accounts[0];
    let king_account = &accounts[1];
    let castle_account = &accounts[2];
    let locked_token_account = &accounts[3];
    let novi_mint = &accounts[4];
    let _token_program = &accounts[5];

    // Verify signer
    if !king_wallet.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Parse instruction data (city_id/castle_id from account)
    if instruction_data.len() < 3 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let upgrade_type = instruction_data[2];

    // Validate upgrade type
    if upgrade_type < 1 || upgrade_type > 5 {
        return Err(GameError::InvalidUpgradeType.into());
    }

    // Load king player
    require_owner(king_account, program_id)?;
    let mut king_data = king_account.try_borrow_mut_data()?;
    let king = unsafe { PlayerAccount::load_mut(&mut king_data) };

    if &king.owner != king_wallet.key() {
        return Err(GameError::Unauthorized.into());
    }

    // Load castle
    let mut castle = CastleAccount::load_checked_mut_by_key(castle_account, program_id)?;

    // Verify caller is the king
    if castle.king != *king_account.key() {
        return Err(GameError::NotKing.into());
    }

    // Verify no upgrade in progress
    if castle.upgrade_type != 0 {
        return Err(GameError::CastleUpgradeInProgress.into());
    }

    // Get current level and max level for upgrade type
    let (current_level, max_level) = match upgrade_type {
        CASTLE_UPGRADE_FORTIFICATION => (castle.fortification_level, MAX_FORTIFICATION_LEVEL),
        CASTLE_UPGRADE_TREASURY => (castle.treasury_level, MAX_TREASURY_LEVEL),
        CASTLE_UPGRADE_CHAMBERS => (castle.chambers_level, MAX_CHAMBERS_LEVEL),
        CASTLE_UPGRADE_WATCHTOWER => (castle.watchtower_level, MAX_WATCHTOWER_LEVEL),
        CASTLE_UPGRADE_ARMORY => (castle.armory_level, MAX_ARMORY_LEVEL),
        _ => return Err(GameError::InvalidUpgradeType.into()),
    };

    // Verify not at max level
    if current_level >= max_level {
        return Err(GameError::CastleUpgradeLevelMax.into());
    }

    let target_level = current_level + 1;

    // Calculate cost: base * (1.5 ^ level)
    let mut cost = UPGRADE_COST_BASE;
    for _ in 0..target_level {
        cost = cost.saturating_mul(UPGRADE_COST_MULTIPLIER) / 10;
    }

    // Verify king has enough locked NOVI
    if king.locked_novi < cost {
        return Err(GameError::InsufficientLockedNovi.into());
    }

    // Burn NOVI tokens from locked token account
    // PlayerAccount PDA is the authority over locked tokens
    let king_bump = king.bump;
    let bump_seed = [king_bump];
    let king_seeds = pinocchio::seeds!(PLAYER_SEED, king_wallet.key().as_ref(), &bump_seed);
    let king_signer = pinocchio::instruction::Signer::from(&king_seeds);

    burn_tokens(
        locked_token_account,
        novi_mint,
        king_account,
        cost,
        &[king_signer],
    )?;

    // Update cached balance
    king.locked_novi = king.locked_novi.saturating_sub(cost);

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Calculate duration: base * target_level
    let duration = UPGRADE_DURATION_BASE * (target_level as i64);
    let completes_at = now + duration;

    // Set upgrade in progress
    castle.upgrade_type = upgrade_type;
    castle.upgrade_target_level = target_level;
    castle.upgrade_end_at = completes_at;

    // Emit event
    emit!(CastleUpgradeStarted {
        castle: *castle_account.key(),
        castle_name: castle.name,
        king: *king_account.key(),
        upgrade_type,
        current_level,
        target_level,
        novi_cost: cost,
        completes_at,
        timestamp: now,
    });

    Ok(())
}
