use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
    sysvars::{Sysvar, clock::Clock},
};

use crate::{
    error::GameError,
    state::{PlayerAccount, HeroTemplate, EstateAccount, NULL_PUBKEY, require_extension, EXT_HEROES},
    constants::{PLAYER_SEED},
    helpers::{
        subtract_hero_buffs_from_player_with_location,
        parse_hero_nft,
    },
    validation::{
        require_signer,
        require_writable,
    },
    emit,
    events::HeroUnlocked,
};

/// Unlock a hero NFT (transfer from PlayerAccount PDA back to wallet) (133)
///
/// Transfers a hero NFT from the PlayerAccount PDA back to the player's wallet,
/// deactivating the hero's buffs.
///
/// # Accounts
/// - [signer] owner: Player wallet
/// - [writable] player_account: PlayerAccount PDA
/// - [writable] hero_mint: Hero NFT mint account
/// - [] hero_template: HeroTemplate for the hero being unlocked
/// - [] hero_collection: Hero collection PDA [b"hero_collection"]
/// - [] system_program: System program
/// - [] p_core_program: MPL Core program
/// - [writable] estate_account: EstateAccount PDA (to clear blessed_hero if needed)
///
/// # Instruction Data
/// - [0] slot_index: u8 (0-2)
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [owner, player_account, hero_mint, hero_template, hero_collection, system_program, p_core_program, estate_account] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(hero_mint)?;

    // 3. Parse instruction data
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let slot_index = instruction_data[0];

    // 4. Bounds check slot index
    if slot_index >= 3 {
        return Err(GameError::InvalidParameter.into());
    }

    // 5. Phase 1: Validate with read-only borrow, capture values needed for CPI
    let (player_ge, player_bump) = {
        let player_data = player_account.try_borrow_data()?;
        let player = unsafe { PlayerAccount::load(&player_data) };

        // Verify ownership
        if !player.is_owner(owner.key()) {
            return Err(GameError::Unauthorized.into());
        }

        // Require EXT_HEROES
        require_extension(player, EXT_HEROES)?;

        // Verify slot is OCCUPIED
        let locked_mint = player.active_heroes[slot_index as usize];
        if locked_mint == NULL_PUBKEY {
            return Err(GameError::InvalidParameter.into());
        }

        // Verify mint matches the slot
        if hero_mint.key() != &locked_mint {
            return Err(GameError::InvalidParameter.into());
        }

        // Capture PDA seed values for the transfer CPI
        (player.game_engine, player.bump)
    }; // player_data dropped

    // 6. Verify NFT ownership (scoped borrow, dropped before CPI)
    {
        let asset_data = hero_mint.try_borrow_data()?;
        let asset = unsafe { p_core::state::AssetV1::load(&asset_data) };

        // Verify current owner is the PlayerAccount PDA
        if asset.owner != *player_account.key() {
            return Err(GameError::Unauthorized.into());
        }
    } // asset_data dropped

    // 7. Transfer NFT using p-core TransferV1 with PDA signer (no active borrows)
    let bump_seed = [player_bump];
    let player_seeds = pinocchio::seeds!(PLAYER_SEED, &player_ge, owner.key(), &bump_seed);
    let player_signer = pinocchio::instruction::Signer::from(&player_seeds);

    p_core::instructions::TransferV1 {
        asset: hero_mint,
        collection: hero_collection,
        payer: owner,
        authority: player_account,
        new_owner: owner,
        system_program,
        log_wrapper: p_core_program,
    }.invoke_signed(&[player_signer])?;

    // 8. Phase 2: Update state AFTER successful transfer (mutable borrow)
    let mut player_data = player_account.try_borrow_mut_data()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    player.active_heroes[slot_index as usize] = NULL_PUBKEY;

    // 9. IF unlocking defensive hero: Reset defensive_hero_slot
    if player.defensive_hero_slot == slot_index {
        player.defensive_hero_slot = 0;
        for i in 0..3 {
            if player.active_heroes[i] != NULL_PUBKEY {
                player.defensive_hero_slot = i as u8;
                break;
            }
        }
    }

    // 10. IF unlocking blessed hero: Clear the blessing bonus
    require_writable(estate_account)?;
    let mut estate_data_ref = estate_account.try_borrow_mut_data()?;
    let estate = unsafe { EstateAccount::load_mut(&mut estate_data_ref) };

    // Verify estate ownership
    if &estate.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    if &estate.blessed_hero == hero_mint.key() {
        estate.blessed_hero = Pubkey::default();
        player.blessed_hero_bonus_bps = 0;
    }

    drop(estate_data_ref);

    // 11. Parse hero data from NFT and subtract buffs
    let nft_data = hero_mint.try_borrow_data()?;
    let parsed_hero = parse_hero_nft(&nft_data)
        .ok_or(GameError::InvalidParameter)?;
    drop(nft_data);

    let template_data = hero_template.try_borrow_data()?;
    let template = unsafe { HeroTemplate::load(&template_data) };

    // Verify template matches hero
    if parsed_hero.template_id != template.template_id {
        return Err(GameError::InvalidParameter.into());
    }

    // 12. Location Synergy: Get stored location bonus and subtract with same bonus
    let location_bonus_bps = player.slot_location_bonus[slot_index as usize];

    subtract_hero_buffs_from_player_with_location(player, parsed_hero.level, template, location_bonus_bps);

    // Clear location bonus for this slot
    player.slot_location_bonus[slot_index as usize] = 0;

    let hero_name = template.name;
    let player_name = player.name;

    drop(template_data);
    drop(player_data);

    // 13. Emit HeroUnlocked event
    let clock = Clock::get()?;
    emit!(HeroUnlocked {
        hero_mint: *hero_mint.key(),
        hero_name,
        player: *player_account.key(),
        player_name,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
