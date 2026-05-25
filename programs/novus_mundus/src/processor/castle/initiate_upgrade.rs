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
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::{
        CASTLE_UPGRADE_ARMORY, CASTLE_UPGRADE_CHAMBERS, CASTLE_UPGRADE_FORTIFICATION,
        CASTLE_UPGRADE_TREASURY, CASTLE_UPGRADE_WATCHTOWER, MAX_ARMORY_LEVEL, MAX_CHAMBERS_LEVEL,
        MAX_FORTIFICATION_LEVEL, MAX_TREASURY_LEVEL, MAX_WATCHTOWER_LEVEL, PLAYER_SEED,
    },
    emit,
    error::GameError,
    events::CastleUpgradeStarted,
    helpers::burn_tokens,
    state::{CastleAccount, PlayerAccount},
    utils::read_u8,
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
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    crate::extract_accounts!(
        accounts,
        [
            king_wallet,
            king_account,
            castle_account,
            locked_token_account,
            novi_mint,
            _token_program,
        ]
    );

    // Verify signer
    if !king_wallet.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Parse instruction data (city_id/castle_id from account)
    let upgrade_type = read_u8(instruction_data, 0, "upgrade_type")?;

    // Validate upgrade type
    if upgrade_type < 1 || upgrade_type > 5 {
        return Err(GameError::InvalidUpgradeType.into());
    }

    // Load king player - read needed fields, then drop borrow for CPI
    require_owner(king_account, program_id)?;
    let (king_locked_novi, king_bump, king_game_engine) = {
        let king_data = king_account.try_borrow()?;
        let king = unsafe { PlayerAccount::load(&king_data) };

        if &king.owner != king_wallet.address() {
            return Err(GameError::Unauthorized.into());
        }

        (king.locked_novi, king.bump, king.game_engine)
    };

    // Load castle
    let castle = CastleAccount::load_checked_mut_by_key(castle_account, program_id)?;

    crate::require_keys_eq!(
        novi_mint.address().as_array(),
        &crate::constants::NOVI_MINT_ADDRESS,
        "castle.initate_upgrade.novi_mint",
        GameError::InvalidMint,
    );
    // Verify caller is the king
    if castle.king != *king_account.address() {
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
    if king_locked_novi < cost {
        return Err(GameError::InsufficientLockedNovi.into());
    }

    // Burn NOVI tokens from locked token account
    // PlayerAccount PDA is the authority over locked tokens
    let bump_seed = [king_bump];
    let king_seeds = crate::seeds!(
        PLAYER_SEED,
        king_game_engine.as_ref(),
        king_wallet.address(),
        &bump_seed
    );
    let king_signer = pinocchio::cpi::Signer::from(&king_seeds);

    burn_tokens(
        locked_token_account,
        novi_mint,
        king_account,
        cost,
        &[king_signer],
    )?;

    // Re-borrow king to update cached balance
    let mut king_data = king_account.try_borrow_mut()?;
    let king = unsafe { PlayerAccount::load_mut(&mut king_data) };
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
        castle: *castle_account.address(),
        castle_name: castle.name,
        king: *king_account.address(),
        upgrade_type,
        current_level,
        target_level,
        novi_cost: cost,
        completes_at,
        timestamp: now,
    });

    Ok(())
}
