use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{Pubkey, find_program_address},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, HeroAccount, HeroTemplate, NULL_PUBKEY, require_extension, EXT_HEROES},
    constants::{PLAYER_SEED, HERO_SEED},
    helpers::{
        subtract_hero_buffs_from_player,
        HeroNftContext,
        HeroNftBuffers,
        build_hero_nft_attributes,
    },
    validation::{
        require_signer,
        require_writable,
    },
};

/// Unlock a hero NFT (transfer from PlayerAccount PDA back to wallet) (133)
///
/// Transfers a hero NFT from the PlayerAccount PDA back to the player's wallet,
/// deactivating the hero's buffs. The NFT must currently be locked in the
/// player's active_heroes slot.
///
/// # Safety Requirements (CRITICAL!)
/// 1. Verify slot_index < 3 (bounds check)
/// 2. Verify player owns the account (wallet matches)
/// 3. Verify slot is OCCUPIED (not NULL_PUBKEY) BEFORE transfer
/// 4. Verify NFT owner is PlayerAccount PDA (via p-core AssetV1)
/// 5. Verify mint matches slot
/// 6. Transfer NFT using p-core with PDA signer (PDA → wallet)
/// 7. Update state ONLY AFTER successful transfer
/// 8. Reset defensive_hero_slot if unlocking defensive hero
/// 9. Recalculate hero buffs with remaining heroes
/// 10. Update NFT metadata (Locked = "false")
///
/// # Accounts
/// - [signer] owner: Player wallet
/// - [writable] player_account: PlayerAccount PDA
/// - [writable] hero_mint: Hero NFT mint account
/// - [writable] hero_account: HeroAccount PDA [b"hero", mint]
/// - [] hero_template: HeroTemplate for the hero being unlocked
/// - [] hero_collection: Hero collection PDA [b"hero_collection"]
/// - [] system_program: System program
/// - [] p_core_program: MPL Core program
///
/// # Instruction Data
/// - [0] slot_index: u8 (0-2)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [owner, player_account, hero_mint, hero_account, hero_template, hero_collection, system_program, _p_core_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(hero_mint)?;
    require_writable(hero_account)?;

    // 3. Parse instruction data
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let slot_index = instruction_data[0];

    // 4. SAFETY: Bounds check slot index
    if slot_index >= 3 {
        return Err(GameError::InvalidParameter.into());
    }

    // 5. Load player account
    let mut player_data = player_account.try_borrow_mut_data()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    // 6. SAFETY: Verify ownership
    if !player.is_owner(owner.key()) {
        return Err(GameError::Unauthorized.into());
    }

    // 6a. Require EXT_HEROES to be unlocked
    require_extension(player, EXT_HEROES)?;

    // 7. SAFETY: Verify slot is OCCUPIED (CRITICAL!)
    let locked_mint = player.active_heroes[slot_index as usize];
    if locked_mint == NULL_PUBKEY {
        return Err(GameError::InvalidParameter.into());
    }

    // 8. SAFETY: Verify mint matches the slot
    if hero_mint.key() != &locked_mint {
        return Err(GameError::InvalidParameter.into());
    }

    // 9. SAFETY: Verify hero_account PDA derivation
    let (expected_hero_pda, _hero_bump) = find_program_address(
        &[HERO_SEED, hero_mint.key()],
        program_id,
    );

    if hero_account.key() != &expected_hero_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 10. SAFETY: Verify hero_account owner is this program
    if hero_account.owner() != program_id {
        return Err(GameError::InvalidAccount.into());
    }

    // 11. Load hero account to verify it exists
    let hero_data = hero_account.try_borrow_data()?;
    let hero = unsafe { HeroAccount::load(&hero_data) };

    // 12. SAFETY: Verify hero.mint matches the NFT mint
    if hero.mint != *hero_mint.key() {
        return Err(GameError::InvalidParameter.into());
    }

    // 13. SAFETY: Verify NFT ownership via p-core
    let asset_data = hero_mint.try_borrow_data()?;
    let asset = unsafe { p_core::state::AssetV1::load(&asset_data) };

    // CRITICAL: Verify current owner is the PlayerAccount PDA
    if asset.owner != *player_account.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 14. Derive PlayerAccount PDA seeds for NFT transfer (with signer)
    let player_bump = player.bump;
    let bump_seed = [player_bump];
    let player_seeds = pinocchio::seeds!(PLAYER_SEED, owner.key(), &bump_seed);

    // 15. Transfer NFT using p-core TransferV1 with PDA signer
    let player_signer = pinocchio::instruction::Signer::from(&player_seeds);

    p_core::instructions::TransferV1 {
        asset: hero_mint,
        collection: hero_collection,
        current_owner: player_account,
        new_owner: owner,
        payer: owner,
        authority: player_account,
        system_program,
    }.invoke_signed(&[player_signer])?;

    // Drop borrows before state mutation
    drop(asset_data);
    drop(hero_data);

    // 16. CRITICAL: Update state ONLY AFTER successful transfer
    player.active_heroes[slot_index as usize] = NULL_PUBKEY;

    // 17. IF unlocking defensive hero: Reset defensive_hero_slot
    if player.defensive_hero_slot == slot_index {
        player.defensive_hero_slot = 0;
        for i in 0..3 {
            if player.active_heroes[i] != NULL_PUBKEY {
                player.defensive_hero_slot = i as u8;
                break;
            }
        }
    }

    // 18. Subtract this hero's buffs + capture context (single load)
    let hero_data = hero_account.try_borrow_data()?;
    let hero = unsafe { HeroAccount::load(&hero_data) };

    let template_data = hero_template.try_borrow_data()?;
    let template = unsafe { HeroTemplate::load(&template_data) };

    // Verify template matches hero
    if hero.template_id != template.template_id {
        return Err(GameError::InvalidParameter.into());
    }

    // Subtract buffs using helper
    subtract_hero_buffs_from_player(player, hero, template);

    // Capture context for NFT attributes
    let ctx = HeroNftContext::new(hero, template, false);

    drop(hero_data);
    drop(template_data);

    // 19. Build NFT attributes with Locked = "false"
    let mut buffers = HeroNftBuffers::new();
    let mut attributes: [(&[u8], &[u8]); 7] = [(b"", b""); 7];
    let attr_count = build_hero_nft_attributes(&mut buffers, &mut attributes, &ctx);

    p_core::instructions::UpdatePluginV1 {
        asset: hero_mint,
        collection: hero_collection,
        payer: owner,
        authority: owner, // Wallet signs (NFT is now in wallet)
        system_program,
        log_wrapper: system_program,
        update: p_core::instructions::PluginUpdateData::AttributesSet {
            attributes: &attributes[..attr_count],
        },
    }.invoke()?;

    Ok(())
}
