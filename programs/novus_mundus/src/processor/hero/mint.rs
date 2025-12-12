use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{Pubkey, find_program_address},
    ProgramResult,
    sysvars::{Sysvar, clock::Clock},
};

use crate::{
    error::GameError,
    state::{PlayerAccount, HeroTemplate, GameEngine},
    constants::HERO_TEMPLATE_SEED,
    helpers::{HeroNftContext, HeroNftBuffers, build_hero_nft_attributes},
    validation::{
        require_signer,
        require_writable,
    },
    emit,
    events::HeroMinted,
};

/// Mint a new hero NFT (131) - Deterministic System (NFT-Only)
///
/// Creates a new hero NFT. Hero progression is fully deterministic
/// using golden root (√φ) scaling - no random seed needed.
///
/// All hero state is stored directly in the NFT's Attributes plugin.
///
/// Creates a new hero NFT by:
/// 1. Validating template (enabled, supply cap, event requirements)
/// 2. Validating player (level requirement)
/// 3. Collecting SOL payment
/// 4. Minting NFT via p-core with all hero attributes
/// 5. Updating template minted_count
///
/// # Safety Requirements (ULTRA-CRITICAL!)
/// 1. Verify template enabled
/// 2. Verify supply cap not exceeded
/// 3. Verify player level requirement
/// 4. Collect SOL payment BEFORE any state changes
/// 5. Mint NFT via p-core (with proper authority)
/// 6. Update template.minted_count ONLY AFTER success
///
/// # Accounts
/// - [signer, writable] minter: Player wallet (pays SOL)
/// - [writable] player_account: PlayerAccount PDA
/// - [] hero_template: HeroTemplate PDA
/// - [writable] hero_template_writable: Same as hero_template (for update)
/// - [writable] hero_mint: Hero NFT mint (Keypair, signer)
/// - [] hero_collection: Hero collection PDA [b"hero_collection"]
/// - [writable] treasury: Game treasury (receives SOL payment)
/// - [] game_engine: GameEngine PDA (for authority)
/// - [] system_program: System program
/// - [] p_core_program: MPL Core program (for NFT creation)
///
/// # Instruction Data
/// - [0..2] template_id: u16 (little-endian)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [
        minter,
        player_account,
        hero_template,
        hero_template_writable,
        hero_mint,
        hero_collection,
        treasury,
        game_engine,
        system_program,
        _p_core_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(minter)?;
    require_writable(minter)?;
    require_writable(hero_template_writable)?;
    require_writable(hero_mint)?;
    require_signer(hero_mint)?;
    require_writable(treasury)?;

    // 3. Parse instruction data
    if instruction_data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let template_id = u16::from_le_bytes([instruction_data[0], instruction_data[1]]);

    // 4. Load template
    let template_data = hero_template.try_borrow_data()?;
    let template = unsafe { HeroTemplate::load(&template_data) };

    // 5. SAFETY: Verify template ID matches
    if template.template_id != template_id {
        return Err(GameError::InvalidParameter.into());
    }

    // 6. SAFETY: Verify template is enabled
    if !template.enabled {
        return Err(GameError::FeatureLocked.into());
    }

    // 7. SAFETY: Verify template PDA derivation
    let template_id_bytes = template_id.to_le_bytes();
    let (expected_template_pda, _template_bump) = find_program_address(
        &[HERO_TEMPLATE_SEED, &template_id_bytes],
        program_id,
    );

    if hero_template.key() != &expected_template_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 8. SAFETY: Verify supply cap not exceeded
    if template.supply_cap > 0 {
        if template.minted_count >= template.supply_cap {
            return Err(GameError::ExceedsMaxCap.into());
        }
    }

    // 9. SAFETY: Verify writable template matches read-only template
    if hero_template.key() != hero_template_writable.key() {
        return Err(GameError::InvalidAccount.into());
    }

    // 10. Load player account
    let player_data = player_account.try_borrow_data()?;
    let player = unsafe { PlayerAccount::load(&player_data) };

    // 11. SAFETY: Verify player ownership
    if !player.is_owner(minter.key()) {
        return Err(GameError::Unauthorized.into());
    }

    // 12. SAFETY: Verify player level requirement
    if (player.level as u8) < template.required_player_level {
        return Err(GameError::InsufficientLevel.into());
    }

    // 13. SAFETY: Verify event_exclusive logic
    if template.event_exclusive {
        if player.current_event == 0 {
            return Err(GameError::FeatureLocked.into());
        }
    }

    // Drop borrows before payments
    drop(template_data);
    drop(player_data);

    // 14. SOL PAYMENT (CRITICAL - BEFORE ANY STATE CHANGES!)
    let template_data = hero_template.try_borrow_data()?;
    let template = unsafe { HeroTemplate::load(&template_data) };
    let mint_cost = template.mint_cost_sol;
    drop(template_data);

    pinocchio_system::instructions::Transfer {
        from: minter,
        to: treasury,
        lamports: mint_cost,
    }.invoke()?;

    // 15. Get serial number from template (BEFORE incrementing!)
    let template_data = hero_template.try_borrow_data()?;
    let template = unsafe { HeroTemplate::load(&template_data) };
    let serial_number = template.minted_count;
    drop(template_data);

    // 16. Create NFT using p-core CreateV1 (NFT-Only System)
    let game_engine_data = game_engine.try_borrow_data()?;
    let ge = unsafe { GameEngine::load(&game_engine_data) };
    let ge_bump = ge.bump;
    drop(game_engine_data);

    let ge_bump_seed = [ge_bump];
    let game_engine_seeds = pinocchio::seeds!(crate::constants::GAME_ENGINE_SEED, &ge_bump_seed);
    let ge_signer = pinocchio::instruction::Signer::from(&game_engine_seeds);

    // Get template name
    let template_data = hero_template.try_borrow_data()?;
    let template = unsafe { HeroTemplate::load(&template_data) };
    let name_slice = &template.name;

    p_core::instructions::CreateV1 {
        asset: hero_mint,
        collection: hero_collection,
        authority: game_engine,
        payer: minter,
        owner: minter,
        update_authority: game_engine,
        system_program,
        data_state: p_core::instructions::DataState::AccountState,
        name: name_slice,
        uri: b"https://novusmundus.gg/heroes/",
    }.invoke_signed(&[ge_signer])?;

    // 21. Add Attributes plugin using p-core AddPluginV1
    let ge_signer2 = pinocchio::instruction::Signer::from(&game_engine_seeds);

    // Build NFT attributes using HeroNftContext::new_mint()
    // NFT-Only System: All hero state is stored in NFT attributes
    let ctx = HeroNftContext::new_mint(template, serial_number);
    drop(template_data);

    let mut buffers = HeroNftBuffers::new();
    let mut attributes: [(&[u8], &[u8]); 9] = [(b"", b""); 9];
    let attr_count = build_hero_nft_attributes(&mut buffers, &mut attributes, &ctx);

    p_core::instructions::AddPluginV1 {
        asset: hero_mint,
        collection: hero_collection,
        payer: minter,
        authority: game_engine,
        system_program,
        log_wrapper: system_program,
        plugin: p_core::instructions::PluginData::Attributes {
            authority: p_core::plugins::PluginAuthority::UpdateAuthority,
            attributes: &attributes[..attr_count],
        },
    }.invoke_signed(&[ge_signer2])?;

    // 22. CRITICAL: Update template.minted_count (ONLY AFTER SUCCESS!)
    let mut template_data = hero_template_writable.try_borrow_mut_data()?;
    let template_mut = unsafe { HeroTemplate::load_mut(&mut template_data) };

    template_mut.minted_count = template_mut.minted_count.saturating_add(1);

    drop(template_data);

    // 23. Emit HeroMinted event
    let clock = Clock::get()?;
    let template_data = hero_template.try_borrow_data()?;
    let template = unsafe { HeroTemplate::load(&template_data) };

    emit!(HeroMinted {
        hero_mint: *hero_mint.key(),
        player: *minter.key(),
        template_id,
        rarity: template.hero_type,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
