use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{Pubkey, find_program_address},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{
        PlayerAccount, HeroAccount, HeroTemplate, NULL_PUBKEY,
        unlock_extension_if_eligible, require_extension, EXT_RESEARCH, EXT_HEROES,
    },
    constants::{PLAYER_SEED, HERO_SEED},
    helpers::{
        add_hero_buffs_to_player,
        HeroNftContext,
        HeroNftBuffers,
        build_hero_nft_attributes,
    },
    validation::{
        require_signer,
        require_writable,
    },
};

/// Lock a hero NFT (transfer from wallet to PlayerAccount PDA) (132)
///
/// Transfers a hero NFT from the player's wallet to their PlayerAccount PDA,
/// activating the hero's buffs for combat and other gameplay. The NFT owner
/// must be the signer, and the slot must be empty.
///
/// # Safety Requirements (CRITICAL!)
/// 1. Verify slot_index < 3 (bounds check)
/// 2. Verify player owns the account (wallet matches)
/// 3. Verify slot is EMPTY (NULL_PUBKEY) BEFORE transfer
/// 4. Verify NFT owner is signer (via p-core AssetV1)
/// 5. Verify HeroAccount PDA derivation matches
/// 6. Transfer NFT using p-core (wallet → PDA)
/// 7. Update state ONLY AFTER successful transfer
/// 8. Recalculate hero buffs with all 3 hero slots
/// 9. Update NFT metadata (Locked = "true")
///
/// # Accounts
/// - [signer] owner: Player wallet
/// - [writable] player_account: PlayerAccount PDA
/// - [writable] hero_mint: Hero NFT mint account (being locked)
/// - [writable] hero_account: HeroAccount PDA [b"hero", mint] (being locked)
/// - [] hero_template: HeroTemplate for the hero being locked
/// - [] hero_collection: Hero collection PDA [b"hero_collection"]
/// - [] system_program: System program
/// - [] p_core_program: MPL Core program
///
/// Note: Buff recalculation is simplified - buffs are reset and will be
/// recalculated on-demand during combat/economy operations by loading heroes
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

    // 6a. PREREQUISITE: Require EXT_RESEARCH to be unlocked
    // Player must start research before locking heroes (user journey)
    require_extension(player, EXT_RESEARCH)?;

    // 6b. Unlock EXT_HEROES extension if not already unlocked
    // This is the second step in the user journey
    unlock_extension_if_eligible(player_account, owner, player, EXT_HEROES)?;

    // 7. SAFETY: Verify slot is EMPTY (CRITICAL!)
    if player.active_heroes[slot_index as usize] != NULL_PUBKEY {
        return Err(GameError::InvalidParameter.into());
    }

    // 8. SAFETY: Verify hero_account PDA derivation
    let (expected_hero_pda, _hero_bump) = find_program_address(
        &[HERO_SEED, hero_mint.key()],
        program_id,
    );

    if hero_account.key() != &expected_hero_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 9. SAFETY: Verify hero_account owner is this program
    if hero_account.owner() != program_id {
        return Err(GameError::InvalidAccount.into());
    }

    // 10. Load hero account to verify it exists
    let hero_data = hero_account.try_borrow_data()?;
    let hero = unsafe { HeroAccount::load(&hero_data) };

    // 11. SAFETY: Verify hero.mint matches the NFT mint
    if hero.mint != *hero_mint.key() {
        return Err(GameError::InvalidParameter.into());
    }

    // 12. SAFETY: Verify NFT ownership via p-core
    let asset_data = hero_mint.try_borrow_data()?;
    let asset = unsafe { p_core::state::AssetV1::load(&asset_data) };

    // CRITICAL: Verify current owner is the signer's wallet
    if asset.owner != *owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 13. Derive PlayerAccount PDA seeds for NFT transfer
    let player_bump = player.bump;
    let bump_seed = [player_bump];
    let player_seeds = pinocchio::seeds!(PLAYER_SEED, owner.key(), &bump_seed);

    // 14. Transfer NFT using p-core TransferV1
    p_core::instructions::TransferV1 {
        asset: hero_mint,
        collection: hero_collection,
        current_owner: owner,
        new_owner: player_account,
        payer: owner,
        authority: owner,
        system_program,
    }.invoke()?;

    // Drop borrows before state mutation
    drop(asset_data);
    drop(hero_data);

    // 15. CRITICAL: Update state ONLY AFTER successful transfer
    player.active_heroes[slot_index as usize] = *hero_mint.key();

    // 16. Add this hero's buffs to player's cached buffs + capture context
    let hero_data = hero_account.try_borrow_data()?;
    let hero = unsafe { HeroAccount::load(&hero_data) };

    let template_data = hero_template.try_borrow_data()?;
    let template = unsafe { HeroTemplate::load(&template_data) };

    // Verify template matches hero
    if hero.template_id != template.template_id {
        return Err(GameError::InvalidParameter.into());
    }

    // Add buffs using helper
    add_hero_buffs_to_player(player, hero, template);

    // Capture context for NFT attributes (single load)
    let ctx = HeroNftContext::new(hero, template, true);

    drop(hero_data);
    drop(template_data);

    // 17. Build NFT attributes with Locked = "true"
    let mut buffers = HeroNftBuffers::new();
    let mut attributes: [(&[u8], &[u8]); 7] = [(b"", b""); 7];
    let attr_count = build_hero_nft_attributes(&mut buffers, &mut attributes, &ctx);

    let player_signer = pinocchio::instruction::Signer::from(&player_seeds);

    p_core::instructions::UpdatePluginV1 {
        asset: hero_mint,
        collection: hero_collection,
        payer: owner,
        authority: player_account,
        system_program,
        log_wrapper: system_program,
        update: p_core::instructions::PluginUpdateData::AttributesSet {
            attributes: &attributes[..attr_count],
        },
    }.invoke_signed(&[player_signer])?;

    Ok(())
}
