use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
    sysvars::{Sysvar, clock::Clock},
};

use crate::{
    error::GameError,
    state::{PlayerAccount, HeroTemplate, tier_from_mint_cost, calculate_burn_reward},
    constants::{HERO_TEMPLATE_SEED, HERO_MINT_RECEIPT_SEED, HERO_COLLECTION_SEED},
    validation::{require_signer, require_writable},
    emit,
    events::HeroBurned,
};

/// Burn a hero NFT (310)
///
/// Destroys a hero NFT and returns locked NOVI based on tier and level.
/// Also decrements template.minted_count (recyclable supply) and closes
/// the mint receipt PDA (allowing re-mint of same template).
///
/// # Accounts
/// - [signer, writable] owner: Player wallet (hero must be in wallet, not locked)
/// - [writable] player_account: PlayerAccount PDA (receives locked NOVI)
/// - [writable] hero_asset: Hero NFT account (destroyed)
/// - [writable] hero_template: HeroTemplate PDA (minted_count decremented)
/// - [writable] hero_collection: Hero collection PDA
/// - [writable] mint_receipt: HeroMintReceipt PDA (closed, rent refunded)
/// - [] system_program: System program
/// - [] p_core_program: MPL Core program
///
/// # Instruction Data
/// - [0..2] template_id: u16 (little-endian)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [
        owner,
        player_account,
        hero_asset,
        hero_template,
        hero_collection,
        mint_receipt,
        system_program,
        p_core_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(owner)?;
    require_writable(owner)?;
    require_writable(player_account)?;
    require_writable(hero_asset)?;
    require_writable(hero_template)?;
    require_writable(hero_collection)?;
    require_writable(mint_receipt)?;

    // 3. Parse instruction data
    if instruction_data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let template_id = u16::from_le_bytes([instruction_data[0], instruction_data[1]]);

    // 4. Load player account and verify ownership
    let player_data = player_account.try_borrow()?;
    let player = unsafe { PlayerAccount::load(&player_data) };

    if !player.is_owner(owner.address()) {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Verify hero is NOT in any active slot (cannot burn locked heroes)
    for slot in player.active_heroes_arr().iter() {
        if slot == hero_asset.address() {
            return Err(GameError::HeroIsLocked.into());
        }
    }
    drop(player_data);

    // 6. Verify NFT ownership (hero must be in wallet, not locked)
    let asset_data = hero_asset.try_borrow()?;
    let asset = p_core::state::AssetV1::from_borsh(&asset_data);
    if asset.owner != *owner.address().as_array() {
        return Err(GameError::HeroNotOwnedByCaller.into());
    }
    drop(asset_data);

    // 7. Parse hero NFT attributes (level, template_id)
    let nft_data = hero_asset.try_borrow()?;
    let parsed_hero = match crate::helpers::parse_hero_nft(&nft_data) {
        Some(h) => h,
        None => return Err(GameError::InvalidParameter.into()),
    };
    drop(nft_data);

    // 8. Verify template_id matches instruction data and parsed NFT
    if parsed_hero.template_id != template_id {
        return Err(GameError::InvalidParameter.into());
    }

    // 9. Verify template PDA
    let template_id_bytes = template_id.to_le_bytes();
    let (expected_template_pda, _) = Address::find_program_address(
        &[HERO_TEMPLATE_SEED, &template_id_bytes],
        program_id,
    );
    if hero_template.address() != &expected_template_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 10. Load template and calculate reward
    let template_data = hero_template.try_borrow()?;
    let template = unsafe { HeroTemplate::load(&template_data) };

    if template.template_id != template_id {
        return Err(GameError::InvalidParameter.into());
    }

    let tier = tier_from_mint_cost(template.mint_cost_sol);
    let hero_level = parsed_hero.level;
    let novi_reward = calculate_burn_reward(hero_level, tier)?;
    drop(template_data);

    // 11. Verify hero collection PDA
    let (expected_collection_pda, _) = Address::find_program_address(
        &[HERO_COLLECTION_SEED],
        program_id,
    );
    if hero_collection.address() != &expected_collection_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 12. Burn NFT via p-core BurnV1 (owner signs directly - hero is in their wallet)
    p_core::instructions::BurnV1 {
        asset: hero_asset,
        collection: hero_collection,
        payer: owner,
        authority: owner,
        system_program,
        log_wrapper: p_core_program,
    }.invoke()?;

    // 13. Credit locked NOVI reward to player
    {
        let mut player_data = player_account.try_borrow_mut()?;
        let player = unsafe { PlayerAccount::load_mut(&mut player_data) };
        player.locked_novi = player.locked_novi.saturating_add(novi_reward);
    }

    // 14. Decrement template.minted_count (recyclable supply)
    let new_minted_count;
    {
        let mut template_data = hero_template.try_borrow_mut()?;
        let template_mut = unsafe { HeroTemplate::load_mut(&mut template_data) };
        template_mut.minted_count = template_mut.minted_count.saturating_sub(1);
        new_minted_count = template_mut.minted_count;
    }

    // 15. Close mint receipt PDA (refund rent to owner, allow re-mint)
    // Only close if the receipt exists (legacy heroes may not have one)
    if mint_receipt.lamports() > 0 && unsafe { mint_receipt.owner() } == program_id {
        // Verify receipt PDA derivation
        let (expected_receipt_pda, _) = Address::find_program_address(
            &[HERO_MINT_RECEIPT_SEED, player_account.address().as_ref(), &template_id_bytes],
            program_id,
        );
        if mint_receipt.address() == &expected_receipt_pda {
            // Transfer all lamports to owner (closes the account)
            let receipt_lamports = mint_receipt.lamports();
            owner.set_lamports(
                owner.lamports()
                    .checked_add(receipt_lamports)
                    .ok_or(ProgramError::ArithmeticOverflow)?,
            );
            mint_receipt.set_lamports(0);
        }
    }

    // 16. Emit HeroBurned event
    let clock = Clock::get()?;
    let player_data = player_account.try_borrow()?;
    let player = unsafe { PlayerAccount::load(&player_data) };

    emit!(HeroBurned {
        hero_mint: *hero_asset.address(),
        player: *player_account.address(),
        player_name: player.name,
        template_id,
        hero_level,
        tier,
        novi_reward,
        new_minted_count,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
