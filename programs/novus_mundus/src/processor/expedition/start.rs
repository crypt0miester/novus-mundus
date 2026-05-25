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
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{
        EXPEDITION_FISHING, EXPEDITION_MAX_TIER, EXPEDITION_MINING, EXPEDITION_SEED,
        FISHING_DOCK_REQ, FISHING_NOVI_COST, MINING_NOVI_COST, MINING_WORKSHOP_REQ, PLAYER_SEED,
    },
    emit,
    error::GameError,
    events::ExpeditionStarted,
    helpers::estate::{load_estate_for_player, require_dock, require_mine},
    state::{ExpeditionAccount, PlayerAccount, NULL_PUBKEY},
    utils::{read_u64, read_u8},
    validation::{require_empty, require_owner, require_signer, require_writable},
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
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts (minimum 5, up to 8 with hero)
    crate::extract_accounts!(
        accounts,
        [
            owner,
            player_account,
            expedition_account,
            estate_account,
            system_program,
        ],
        rest = hero_accounts
    );

    // Optional hero accounts (if len >= 8)
    let has_hero_accounts = accounts.len() >= 8;

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(expedition_account)?;
    require_owner(player_account, program_id)?;

    // 3. Parse Instruction Data (26 bytes: type + tier + 3x u64 operatives)
    let expedition_type = read_u8(instruction_data, 0, "expedition_type")?;
    let tier = read_u8(instruction_data, 1, "tier")?;
    let operative_unit_1 = read_u64(instruction_data, 2, "operative_unit_1")?;
    let operative_unit_2 = read_u64(instruction_data, 10, "operative_unit_2")?;
    let operative_unit_3 = read_u64(instruction_data, 18, "operative_unit_3")?;

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
    let mut player_data_ref = player_account.try_borrow_mut()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    // 8. Verify ownership
    if !player_data.is_owner(owner.address()) {
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
        if !player_data.has_mining() {
            return Err(GameError::MiningNotUnlocked.into());
        }

        // Check Mine level requirement for tier (split from Workshop)
        let required_level = MINING_WORKSHOP_REQ
            .get(tier as usize)
            .copied()
            .unwrap_or(20);
        require_mine(estate, required_level)?;

        MINING_NOVI_COST
            .get(tier as usize)
            .copied()
            .unwrap_or(30_000)
    } else {
        // Fishing requires has_fishing and Dock building level
        if !player_data.has_fishing() {
            return Err(GameError::FishingNotUnlocked.into());
        }

        // Check Dock level requirement for tier
        let required_level = FISHING_DOCK_REQ.get(tier as usize).copied().unwrap_or(20);
        require_dock(estate, required_level)?;

        FISHING_NOVI_COST
            .get(tier as usize)
            .copied()
            .unwrap_or(30_000)
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
    player_data.operative_unit_1 = player_data
        .operative_unit_1
        .checked_sub(operative_unit_1)
        .ok_or(GameError::MathOverflow)?;
    player_data.operative_unit_2 = player_data
        .operative_unit_2
        .checked_sub(operative_unit_2)
        .ok_or(GameError::MathOverflow)?;
    player_data.operative_unit_3 = player_data
        .operative_unit_3
        .checked_sub(operative_unit_3)
        .ok_or(GameError::MathOverflow)?;

    // 14. Validate ExpeditionAccount PDA
    let (expected_expedition_pda, expedition_bump) = pinocchio::Address::find_program_address(
        &[EXPEDITION_SEED, owner.address().as_ref()],
        program_id,
    );

    if expedition_account.address() != &expected_expedition_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 15. Check if expedition account already exists (player already on expedition)
    require_empty(expedition_account).map_err(|_| GameError::ExpeditionInProgress)?;

    // 16. Get current timestamp and calculate duration
    let now = Clock::get()?.unix_timestamp;

    let duration_hours = if expedition_type == EXPEDITION_MINING {
        crate::constants::MINING_DURATION_HOURS
            .get(tier as usize)
            .copied()
            .unwrap_or(1)
    } else {
        crate::constants::FISHING_DURATION_HOURS
            .get(tier as usize)
            .copied()
            .unwrap_or(1)
    };
    let duration_seconds = duration_hours as i64 * 3600;

    // 17. Deduct locked NOVI
    player_data.locked_novi = player_data
        .locked_novi
        .checked_sub(novi_cost)
        .ok_or(GameError::MathOverflow)?;

    // 18. Create ExpeditionAccount PDA
    let lamports = crate::utils::rent_exempt_const(ExpeditionAccount::LEN);

    let bump_seed = [expedition_bump];
    let expedition_seeds = crate::seeds!(EXPEDITION_SEED, owner.address(), &bump_seed);
    let expedition_signer = pinocchio::cpi::Signer::from(&expedition_seeds);

    CreateAccount {
        from: owner,
        to: expedition_account,
        lamports,
        space: ExpeditionAccount::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[expedition_signer])?;

    // 19. Handle optional hero NFT transfer (escrow to expedition PDA)
    let hero_mint_key = if has_hero_accounts {
        let hero_mint = &hero_accounts[0];
        let hero_collection = &hero_accounts[1];
        let p_core_program = &hero_accounts[2];

        require_writable(hero_mint)?;

        // Load asset to check current owner
        let asset_data = hero_mint.try_borrow()?;
        let asset = p_core::state::AssetV1::from_borsh(&asset_data);
        let current_owner_key = asset.owner;
        drop(asset_data);

        // Determine transfer authority based on current owner
        if current_owner_key == *owner.address().as_array() {
            // Hero is in owner's wallet - owner signs directly
            p_core::instructions::TransferV1 {
                asset: hero_mint,
                collection: hero_collection,
                new_owner: expedition_account,
                payer: owner,
                authority: owner,
                system_program,
                log_wrapper: p_core_program,
            }
            .invoke()?;
        } else if current_owner_key == *player_account.address().as_array() {
            // Hero is locked in PlayerAccount PDA - need PDA signer
            let player_bump = player_data.bump;
            let player_bump_seed = [player_bump];
            let player_seeds = crate::seeds!(
                PLAYER_SEED,
                player_data.game_engine.as_ref(),
                owner.address(),
                &player_bump_seed
            );
            let player_signer = pinocchio::cpi::Signer::from(&player_seeds);

            p_core::instructions::TransferV1 {
                asset: hero_mint,
                collection: hero_collection,
                new_owner: expedition_account,
                payer: owner,
                authority: player_account,
                system_program,
                log_wrapper: p_core_program,
            }
            .invoke_signed(&[player_signer])?;

            // Clear the active_heroes slot since hero is now on expedition
            for i in 0..3 {
                if player_data.active_hero_at(i as usize) == *hero_mint.address() {
                    player_data.set_active_hero_at(i as usize, NULL_PUBKEY);
                    break;
                }
            }
        } else {
            // Hero is owned by someone else - unauthorized
            return Err(GameError::Unauthorized.into());
        }

        *hero_mint.address()
    } else {
        NULL_PUBKEY
    };

    // 20. Initialize ExpeditionAccount with locked operatives and hero
    let mut expedition_data = expedition_account.try_borrow_mut()?;
    let expedition = unsafe { ExpeditionAccount::load_mut(&mut expedition_data) };

    *expedition = ExpeditionAccount::init(
        *owner.address(),
        hero_mint_key,
        expedition_type,
        tier,
        expedition_bump,
        player_data.current_city, // Store expedition location for origin city bonus
        now,
        operative_unit_1,
        operative_unit_2,
        operative_unit_3,
    );

    // 21. Emit event
    emit!(ExpeditionStarted {
        player: *player_account.address(),
        player_name: player_data.name,
        expedition_type,
        node_id: tier,
        duration: duration_seconds as u32,
        timestamp: now,
    });

    Ok(())
}
