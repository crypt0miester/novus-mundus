use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{Pubkey, find_program_address},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::GameEngine,
    constants::{HERO_COLLECTION_SEED, GAME_ENGINE_SEED},
    validation::{
        require_signer,
        require_writable,
    },
};

/// Initialize the hero NFT collection (DAO only) (136)
///
/// Creates the hero collection NFT using p-core. This collection
/// will be the parent for all hero NFTs minted by the program.
/// The collection PDA is derived from `[b"hero_collection"]`.
///
/// # Safety Requirements (CRITICAL!)
/// 1. Verify DAO authority from GameEngine
/// 2. Verify hero_collection PDA derivation
/// 3. Create collection using p-core CreateV1
/// 4. Set game_engine PDA as update_authority
/// 5. Collection owned by this program (PDA)
///
/// # Accounts
/// - [signer] dao_authority: DAO authority wallet
/// - [writable] hero_collection: Collection PDA [b"hero_collection"] (to create)
/// - [] game_engine: GameEngine PDA (for authority verification and signing)
/// - [] system_program: System program
/// - [] p_core_program: MPL Core program
///
/// # Instruction Data
/// None
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [dao_authority, hero_collection, game_engine, system_program, _p_core_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(dao_authority)?;
    require_writable(hero_collection)?;

    // 3. Load and verify GameEngine
    let game_engine_data = game_engine.try_borrow_data()?;
    let ge = unsafe { GameEngine::load(&game_engine_data) };

    // SAFETY: Verify DAO authority
    if ge.authority != *dao_authority.key() {
        return Err(GameError::Unauthorized.into());
    }

    let ge_bump = ge.bump;
    drop(game_engine_data);

    // 4. SAFETY: Verify hero_collection PDA derivation
    let (expected_collection_pda, collection_bump) = find_program_address(
        &[HERO_COLLECTION_SEED],
        program_id,
    );

    if hero_collection.key() != &expected_collection_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 5. Check if collection already exists
    if hero_collection.data_len() > 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 6. Create collection using p-core CreateCollectionV1
    // Collection PDA must sign, and game_engine is update_authority
    let collection_bump_seed = [collection_bump];
    let collection_seeds = pinocchio::seeds!(HERO_COLLECTION_SEED, &collection_bump_seed);
    let collection_signer = pinocchio::instruction::Signer::from(&collection_seeds);

    p_core::instructions::CreateCollectionV1 {
        collection: hero_collection,  // Collection PDA signs
        update_authority: game_engine,  // Game engine can update metadata
        payer: dao_authority,
        system_program,
        name: b"Novus Mundus Heroes",
        uri: b"https://novusmundus.gg/heroes/collection",
        max_size: 0,  // Unlimited supply
    }.invoke_signed(&[collection_signer])?;

    Ok(())
}
