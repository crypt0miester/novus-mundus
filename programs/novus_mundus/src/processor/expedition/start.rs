//! Start Expedition Processor
//!
//! Begins a mining or fishing expedition by creating an ExpeditionAccount PDA.
//! Operatives are "locked" (tracked in the expedition account) for the duration.
//!
//! # Mining Requirements
//! - has_mining = true (research unlock)
//! - Workshop building at required level for tier
//! - Sufficient locked NOVI for cost
//! - Sufficient available operatives
//!
//! # Fishing Requirements
//! - has_fishing = true (research unlock)
//! - Dock building at required level for tier
//! - Sufficient locked NOVI for cost
//! - Sufficient available operatives
//!
//! # Hero Integration (Optional)
//! - Hero NFT can be sent with expedition for bonus yield
//! - NFT is transferred to expedition's ATA (escrow)
//! - NFT is returned on claim or abort
//! - Hero provides MiningAffinity or FishingAffinity buff

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{
        EXPEDITION_SEED, EXPEDITION_MINING, EXPEDITION_FISHING, EXPEDITION_MAX_TIER,
        MINING_NOVI_COST, MINING_WORKSHOP_REQ,
        FISHING_NOVI_COST, FISHING_DOCK_REQ,
        PLAYER_SEED,
    },
    error::GameError,
    state::{PlayerAccount, ExpeditionAccount, NULL_PUBKEY},
    helpers::estate::{load_estate_for_player, require_mine, require_dock},
    validation::{require_signer, require_writable, require_owner, require_empty},
    emit,
    events::ExpeditionStarted,
};

/// Start a Mining or Fishing Expedition
///
/// Creates an ExpeditionAccount PDA that tracks the expedition state.
/// The account is closed and rent refunded when expedition is claimed.
///
/// **IMPORTANT:** Operatives are LOCKED (deducted from player) for the
/// duration of the expedition. They are returned when the expedition is claimed.
///
/// **HERO INTEGRATION:** Optionally send a Hero NFT with the expedition for
/// bonus yield. The NFT is transferred to the expedition's ATA (escrow) and
/// returned on claim/abort. Hero provides MiningAffinity or FishingAffinity buff.
///
/// # Accounts
/// 0. `[signer]` owner - Player's wallet (pays for expedition account rent)
/// 1. `[writable]` player_account - PlayerAccount PDA
/// 2. `[writable]` expedition_account - ExpeditionAccount PDA (to be created)
/// 3. `[]` estate_account - EstateAccount PDA (for building level check)
/// 4. `[]` system_program - System program (for account creation)
///
/// ## Optional Hero Accounts (if sending hero with expedition):
/// 5. `[writable]` hero_mint - Hero NFT (MPL Core asset)
/// 6. `[]` hero_collection - Hero collection (MPL Core)
/// 7. `[]` p_core_program - MPL Core program
///
/// # Instruction Data
/// - expedition_type: u8 (1 byte) - 1=Mining, 2=Fishing
/// - tier: u8 (1 byte) - 0-4
/// - operative_unit_1: u64 (8 bytes) - Number of tier 1 operatives to send
/// - operative_unit_2: u64 (8 bytes) - Number of tier 2 operatives to send
/// - operative_unit_3: u64 (8 bytes) - Number of tier 3 operatives to send
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts (minimum 5, up to 8 with hero)
    if accounts.len() < 5 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let owner = &accounts[0];
    let player_account = &accounts[1];
    let expedition_account = &accounts[2];
    let estate_account = &accounts[3];
    let system_program = &accounts[4];

    // Optional hero accounts (if len >= 8)
    let has_hero_accounts = accounts.len() >= 8;

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(expedition_account)?;
    require_owner(player_account, program_id)?;

    // 3. Parse Instruction Data (26 bytes: type + tier + 3x u64 operatives)
    if instruction_data.len() < 26 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let expedition_type = instruction_data[0];
    let tier = instruction_data[1];
    let operative_unit_1 = u64::from_le_bytes([
        instruction_data[2], instruction_data[3], instruction_data[4], instruction_data[5],
        instruction_data[6], instruction_data[7], instruction_data[8], instruction_data[9],
    ]);
    let operative_unit_2 = u64::from_le_bytes([
        instruction_data[10], instruction_data[11], instruction_data[12], instruction_data[13],
        instruction_data[14], instruction_data[15], instruction_data[16], instruction_data[17],
    ]);
    let operative_unit_3 = u64::from_le_bytes([
        instruction_data[18], instruction_data[19], instruction_data[20], instruction_data[21],
        instruction_data[22], instruction_data[23], instruction_data[24], instruction_data[25],
    ]);

    let total_operatives = operative_unit_1
        .saturating_add(operative_unit_2)
        .saturating_add(operative_unit_3);

    // 4. Validate expedition type
    if expedition_type != EXPEDITION_MINING && expedition_type != EXPEDITION_FISHING {
        return Err(GameError::InvalidExpeditionType.into());
    }

    // 5. Validate tier
    if tier > EXPEDITION_MAX_TIER {
        return Err(GameError::InvalidExpeditionTier.into());
    }

    // 6. Validate operatives > 0
    if total_operatives == 0 {
        return Err(GameError::InsufficientOperatives.into());
    }

    // 7. Load Player Data
    let mut player_data_ref = player_account.try_borrow_mut_data()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    // 8. Verify ownership
    if !player_data.is_owner(owner.key()) {
        return Err(GameError::Unauthorized.into());
    }

    // 9. Validate player is not traveling
    if player_data.is_traveling_any() {
        return Err(GameError::PlayerTraveling.into());
    }

    // 10. Check feature unlock and tier requirements
    let estate = load_estate_for_player(estate_account, player_data, program_id)?;

    let novi_cost = if expedition_type == EXPEDITION_MINING {
        // Mining requires has_mining and Workshop level
        if !player_data.has_mining {
            return Err(GameError::MiningNotUnlocked.into());
        }

        // Check Mine level requirement for tier (split from Workshop)
        let required_level = MINING_WORKSHOP_REQ.get(tier as usize).copied().unwrap_or(20);
        require_mine(estate, required_level)?;

        MINING_NOVI_COST.get(tier as usize).copied().unwrap_or(30_000)
    } else {
        // Fishing requires has_fishing and Dock building level
        if !player_data.has_fishing {
            return Err(GameError::FishingNotUnlocked.into());
        }

        // Check Dock level requirement for tier
        let required_level = FISHING_DOCK_REQ.get(tier as usize).copied().unwrap_or(20);
        require_dock(estate, required_level)?;

        FISHING_NOVI_COST.get(tier as usize).copied().unwrap_or(30_000)
    };

    // 11. Validate sufficient locked NOVI
    if player_data.locked_novi < novi_cost {
        return Err(GameError::InsufficientLockedNovi.into());
    }

    // 12. Validate sufficient available operatives (check each type)
    if operative_unit_1 > player_data.operative_unit_1 {
        return Err(GameError::InsufficientOperatives.into());
    }
    if operative_unit_2 > player_data.operative_unit_2 {
        return Err(GameError::InsufficientOperatives.into());
    }
    if operative_unit_3 > player_data.operative_unit_3 {
        return Err(GameError::InsufficientOperatives.into());
    }

    // 13. LOCK OPERATIVES - Deduct from player (returned on claim)
    player_data.operative_unit_1 = player_data.operative_unit_1
        .checked_sub(operative_unit_1)
        .ok_or(GameError::MathOverflow)?;
    player_data.operative_unit_2 = player_data.operative_unit_2
        .checked_sub(operative_unit_2)
        .ok_or(GameError::MathOverflow)?;
    player_data.operative_unit_3 = player_data.operative_unit_3
        .checked_sub(operative_unit_3)
        .ok_or(GameError::MathOverflow)?;

    // 14. Validate ExpeditionAccount PDA
    let (expected_expedition_pda, expedition_bump) = pinocchio::pubkey::find_program_address(
        &[EXPEDITION_SEED, owner.key().as_ref()],
        program_id,
    );

    if expedition_account.key() != &expected_expedition_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 15. Check if expedition account already exists (player already on expedition)
    require_empty(expedition_account).map_err(|_| GameError::ExpeditionInProgress)?;

    // 16. Get current timestamp and calculate duration
    let now = Clock::get()?.unix_timestamp;

    let duration_hours = if expedition_type == EXPEDITION_MINING {
        crate::constants::MINING_DURATION_HOURS.get(tier as usize).copied().unwrap_or(1)
    } else {
        crate::constants::FISHING_DURATION_HOURS.get(tier as usize).copied().unwrap_or(1)
    };
    let duration_seconds = duration_hours as i64 * 3600;

    // 17. Deduct locked NOVI
    player_data.locked_novi = player_data.locked_novi
        .checked_sub(novi_cost)
        .ok_or(GameError::MathOverflow)?;

    // 18. Create ExpeditionAccount PDA
    let rent = pinocchio::sysvars::rent::Rent::get()?;
    let lamports = rent.minimum_balance(ExpeditionAccount::LEN);

    let bump_seed = [expedition_bump];
    let expedition_seeds = pinocchio::seeds!(
        EXPEDITION_SEED,
        owner.key().as_ref(),
        &bump_seed
    );
    let expedition_signer = pinocchio::instruction::Signer::from(&expedition_seeds);

    CreateAccount {
        from: owner,
        to: expedition_account,
        lamports,
        space: ExpeditionAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[expedition_signer])?;

    // 19. Handle optional hero NFT transfer (escrow to expedition PDA)
    let hero_mint_key = if has_hero_accounts {
        let hero_mint = &accounts[5];
        let hero_collection = &accounts[6];
        let p_core_program = &accounts[7];

        require_writable(hero_mint)?;

        // Load asset to check current owner
        let asset_data = hero_mint.try_borrow_data()?;
        let asset = unsafe { p_core::state::AssetV1::load(&asset_data) };
        let current_owner_key = asset.owner;
        drop(asset_data);

        // Determine transfer authority based on current owner
        if current_owner_key == *owner.key() {
            // Hero is in owner's wallet - owner signs directly
            p_core::instructions::TransferV1 {
                asset: hero_mint,
                collection: hero_collection,
                new_owner: expedition_account,
                payer: owner,
                authority: owner,
                system_program,
                log_wrapper: p_core_program,
            }.invoke()?;
        } else if current_owner_key == *player_account.key() {
            // Hero is locked in PlayerAccount PDA - need PDA signer
            let player_bump = player_data.bump;
            let player_bump_seed = [player_bump];
            let player_seeds = pinocchio::seeds!(PLAYER_SEED, &player_data.game_engine, owner.key(), &player_bump_seed);
            let player_signer = pinocchio::instruction::Signer::from(&player_seeds);

            p_core::instructions::TransferV1 {
                asset: hero_mint,
                collection: hero_collection,
                new_owner: expedition_account,
                payer: owner,
                authority: player_account,
                system_program,
                log_wrapper: p_core_program,
            }.invoke_signed(&[player_signer])?;

            // Clear the active_heroes slot since hero is now on expedition
            for i in 0..3 {
                if player_data.active_heroes[i] == *hero_mint.key() {
                    player_data.active_heroes[i] = NULL_PUBKEY;
                    break;
                }
            }
        } else {
            // Hero is owned by someone else - unauthorized
            return Err(GameError::Unauthorized.into());
        }

        *hero_mint.key()
    } else {
        NULL_PUBKEY
    };

    // 20. Initialize ExpeditionAccount with locked operatives and hero
    let mut expedition_data = expedition_account.try_borrow_mut_data()?;
    let expedition = unsafe { ExpeditionAccount::load_mut(&mut expedition_data) };

    *expedition = ExpeditionAccount::init(
        *owner.key(),
        hero_mint_key,
        expedition_type,
        tier,
        expedition_bump,
        player_data.current_city,  // Store expedition location for origin city bonus
        now,
        operative_unit_1,
        operative_unit_2,
        operative_unit_3,
    );

    // 21. Emit event
    emit!(ExpeditionStarted {
        player: *player_account.key(),
        player_name: player_data.name,
        expedition_type,
        node_id: tier,
        duration: duration_seconds as u32,
        timestamp: now,
    });

    Ok(())
}
