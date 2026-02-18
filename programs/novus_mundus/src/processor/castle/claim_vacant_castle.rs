//! Claim Vacant Castle - Claim an unoccupied castle as king
//!
//! Instruction 271
//!
//! Allows a player to claim a vacant castle, becoming its king.
//! Creates KingRegistryAccount if first time ruling.

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    emit,
    error::GameError,
    events::CastleClaimed,
    state::{
        CastleAccount, KingRegistryAccount, PlayerAccount,
        player::NULL_PUBKEY,
    },
    constants::{
        KING_REGISTRY_SEED, CASTLE_STATUS_CONTEST,
        CASTLE_CONTEST_DURATION, MAX_CASTLES_PER_KING,
        GARRISON_CAP_BY_TIER,
    },
    validation::require_owner,
};

/// Claim Vacant Castle instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)

/// Accounts:
/// 0. [signer] Player wallet
/// 1. [writable] Player account
/// 2. [writable] Castle account
/// 3. [writable] King registry account (created if doesn't exist)
/// 4. [] System program

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    if accounts.len() < 5 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let player_wallet = &accounts[0];
    let player_account = &accounts[1];
    let castle_account = &accounts[2];
    let king_registry_account = &accounts[3];

    // Verify signer
    if !player_wallet.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Parse instruction data (discriminator already stripped by entry point)
    if instruction_data.len() < 4 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let city_id = u16::from_le_bytes([instruction_data[0], instruction_data[1]]);
    let castle_id = u16::from_le_bytes([instruction_data[2], instruction_data[3]]);

    // Verify player account ownership
    require_owner(player_account, program_id)?;

    // Load player
    let mut player_data = player_account.try_borrow_mut_data()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    // Verify player wallet matches
    if &player.owner != player_wallet.key() {
        return Err(GameError::Unauthorized.into());
    }

    // Verify player is on a team (required to rule a castle)
    if player.team == NULL_PUBKEY {
        return Err(GameError::NotOnTeam.into());
    }

    // Get kingdom from player (for PDA derivation)
    let player_game_engine = player.game_engine;

    // Load castle
    require_owner(castle_account, program_id)?;

    let (expected_castle_pda, _castle_bump) = CastleAccount::derive_pda(&player_game_engine, city_id, castle_id);
    if castle_account.key() != &expected_castle_pda {
        return Err(GameError::InvalidPDA.into());
    }

    let mut castle_data = castle_account.try_borrow_mut_data()?;
    let castle = unsafe { CastleAccount::load_mut(&mut castle_data) };

    // Verify castle is vacant
    if castle.king != NULL_PUBKEY {
        return Err(GameError::CastleNotVacant.into());
    }

    // Verify player meets eligibility requirements
    if player.level < castle.min_level {
        return Err(GameError::CastleIneligible.into());
    }

    // Check networth (stored in millions)
    let networth_millions = (player.networth / 1_000_000) as u8;
    if networth_millions < castle.min_networth_millions {
        return Err(GameError::CastleIneligible.into());
    }

    // Check troops (stored in thousands)
    let total_troops = player.defensive_unit_1
        .saturating_add(player.defensive_unit_2)
        .saturating_add(player.defensive_unit_3);
    let troops_thousands = (total_troops / 1_000) as u8;
    if troops_thousands < castle.min_troops_thousands {
        return Err(GameError::CastleIneligible.into());
    }

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Handle king registry account (create if doesn't exist)
    let (expected_registry_pda, registry_bump) = KingRegistryAccount::derive_pda(player_account.key());
    if king_registry_account.key() != &expected_registry_pda {
        return Err(GameError::InvalidPDA.into());
    }

    let registry_exists = king_registry_account.data_len() > 0;

    if !registry_exists {
        // Create king registry account
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(KingRegistryAccount::LEN);

        let bump_seed = [registry_bump];
        let seeds = pinocchio::seeds!(
            KING_REGISTRY_SEED,
            player_account.key().as_ref(),
            &bump_seed
        );
        let signer = pinocchio::instruction::Signer::from(&seeds);

        CreateAccount {
            from: player_wallet,
            to: king_registry_account,
            lamports,
            space: KingRegistryAccount::LEN as u64,
            owner: program_id,
        }.invoke_signed(&[signer])?;

        // Initialize registry
        let mut registry_data = king_registry_account.try_borrow_mut_data()?;
        let registry = unsafe { KingRegistryAccount::load_mut(&mut registry_data) };

        registry.account_key = crate::state::AccountKey::KingRegistry as u8;
        registry.king = *player_account.key();
        registry.bump = registry_bump;
        registry.castle_count = 0;
        registry.max_castles = MAX_CASTLES_PER_KING;
        registry.castles = Default::default();
    }

    // Load registry (after potential creation)
    let mut registry_data = king_registry_account.try_borrow_mut_data()?;
    let registry = unsafe { KingRegistryAccount::load_mut(&mut registry_data) };

    // Check max castles limit
    if registry.castle_count >= registry.max_castles {
        return Err(GameError::MaxCastlesReached.into());
    }

    // Add castle to registry
    if !registry.add_castle(city_id, castle_id, castle.tier, now) {
        return Err(GameError::MaxCastlesReached.into());
    }

    // Update castle ownership
    castle.king = *player_account.key();
    castle.team = player.team;
    castle.claimed_at = now;
    castle.contest_end_at = now + CASTLE_CONTEST_DURATION;
    castle.status = CASTLE_STATUS_CONTEST;

    // Set garrison cap based on king's subscription tier
    let tier_index = (player.subscription_tier as usize).min(3);
    castle.max_garrison = if castle.tier == 0 {
        0 // Outposts have no garrison
    } else {
        GARRISON_CAP_BY_TIER[tier_index]
    };

    // Increment claim counter
    castle.times_claimed = castle.times_claimed.saturating_add(1);

    // Copy player name for event
    let mut player_name = [0u8; 48];
    player_name.copy_from_slice(&player.name);

    // Emit event
    emit!(CastleClaimed {
        castle: *castle_account.key(),
        castle_name: castle.name,
        king: *player_account.key(),
        king_name: player_name,
        team: player.team,
        tier: castle.tier,
        timestamp: now,
    });

    Ok(())
}
