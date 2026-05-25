use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::{DUNGEON_RUN_SEED, GAME_ENGINE_SEED},
    emit,
    error::GameError,
    events::DungeonFled,
    helpers::{
        close_account,
        dungeon::{apply_reward_penalty, get_flee_penalty_bps},
        mint_tokens, validate_token_account_owner,
    },
    state::{DungeonRun, DungeonStatus, GameEngine, PlayerAccount},
    validation::{require_key_match, require_signer, require_writable},
};

/// Flee from a dungeon run early
///
/// Player exits with partial rewards based on current floor.
/// Hero is returned from escrow via MPL Core transfer.
///
/// # Flee Penalty (scaling)
/// - Floor 1-3: 70% of accumulated rewards
/// - Floor 4-6: 60% of accumulated rewards
/// - Floor 7-9: 50% of accumulated rewards
/// - Floor 10+: 40% of accumulated rewards
///
/// # Accounts
/// - [signer, writable] owner: Player's wallet (receives rent refund)
/// - [writable] player: PlayerAccount PDA
/// - [writable] dungeon_run: DungeonRun PDA (will be closed)
/// - [writable] hero_mint: Hero NFT mint (MPL Core asset)
/// - [] hero_collection: Hero collection PDA
/// - [] system_program: System program
/// - [] p_core_program: MPL Core program
/// - [writable] player_novi_ata: Player's NOVI token account (owned by player PDA)
/// - [writable] novi_mint: NOVI mint
/// - [] game_engine: GameEngine PDA (mint authority)
/// - [] token_program: SPL Token program
pub fn process(program_id: &Address, accounts: &[AccountView], _data: &[u8]) -> ProgramResult {
    // 1. Parse accounts
    crate::extract_accounts!(
        accounts,
        [
            owner,
            player_account,
            dungeon_run_account,
            hero_mint,
            hero_collection,
            system_program,
            p_core_program,
            player_novi_ata,
            novi_mint,
            game_engine,
            token_program,
        ]
    );

    // 2. Validate signer
    require_signer(owner)?;
    require_writable(owner)?;
    require_writable(player_account)?;
    require_writable(dungeon_run_account)?;
    require_writable(hero_mint)?;
    require_writable(player_novi_ata)?;
    require_writable(novi_mint)?;
    require_key_match(token_program, &pinocchio_token::ID)?;
    crate::require_keys_eq!(
        novi_mint.address().as_array(),
        &crate::constants::NOVI_MINT_ADDRESS,
        "dungeon_flee.novi_mint",
        GameError::InvalidMint,
    );
    validate_token_account_owner(player_novi_ata, player_account.address())?;

    // 3. Load player using load_checked_mut_by_key (kingdom-scoped)
    let player = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;
    if &player.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 4. Load dungeon run using load_checked (PDA derived from player_account)
    let (_, run_bump) = DungeonRun::derive_pda(player_account.address());
    let run = DungeonRun::load_checked(dungeon_run_account, player_account.address(), program_id)?;

    // Verify the run belongs to this player (player_account PDA stored in run.player)
    if &run.player != player_account.address() {
        return Err(GameError::Unauthorized.into());
    }

    // Validate run is active (can flee from any active state)
    let status = DungeonStatus::from_u8(run.status).ok_or(GameError::InvalidParameter)?;

    if status.is_ended() {
        return Err(GameError::DungeonAlreadyEnded.into());
    }

    // Get timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 5. Calculate partial rewards with flee penalty
    let penalty_bps = get_flee_penalty_bps(run.current_floor);
    let (xp, novi, gems) = apply_reward_penalty(&run, penalty_bps);

    // 6. Grant rewards to player
    player.current_xp = player.current_xp.saturating_add(xp);
    player.locked_novi = player.locked_novi.saturating_add(novi);
    player.gems = player.gems.saturating_add(gems);

    // Store values before dropping borrows
    let player_name = player.name;
    let dungeon_id = run.dungeon_id;
    let current_floor = run.current_floor;
    let enemies_killed = run.enemies_killed;
    let stored_hero_mint = run.hero_mint;

    // Verify hero_mint matches the stored one
    if hero_mint.address() != &stored_hero_mint {
        return Err(GameError::InvalidParameter.into());
    }

    // Drop borrows before CPI

    // 7a. Mint NOVI to the player's ATA so the wallet balance tracks the
    //     locked_novi accounting bumped above. Without this CPI the two
    //     drift and later burns (hire/build) fail with SPL InsufficientFunds.
    if novi > 0 {
        let game_engine_data = GameEngine::load_checked_by_key(game_engine, program_id)?;
        let bump_seed = [game_engine_data.bump];
        let kingdom_id_bytes = game_engine_data.kingdom_id.to_le_bytes();
        let ge_seeds = crate::seeds!(GAME_ENGINE_SEED, &kingdom_id_bytes, &bump_seed);
        let ge_signer = pinocchio::cpi::Signer::from(&ge_seeds);

        mint_tokens(novi_mint, player_novi_ata, game_engine, novi, &[ge_signer])?;
    }

    // 7. Transfer hero back from DungeonRun PDA to owner using MPL Core
    let run_bump_seed = [run_bump];
    let run_seeds = crate::seeds!(DUNGEON_RUN_SEED, player_account.address(), &run_bump_seed);
    let run_signer = pinocchio::cpi::Signer::from(&run_seeds);

    p_core::instructions::TransferV1 {
        asset: hero_mint,
        collection: hero_collection,
        new_owner: owner,
        payer: owner,
        authority: dungeon_run_account,
        system_program,
        log_wrapper: p_core_program,
    }
    .invoke_signed(&[run_signer])?;

    // 8. Close dungeon run account (refund rent to owner)
    close_account(dungeon_run_account, owner)?;

    // 9. Emit event
    emit!(DungeonFled {
        player: *player_account.address(),
        player_name,
        dungeon_id,
        floor: current_floor,
        enemies_killed,
        xp_gained: xp,
        novi_gained: novi,
        gems_gained: gems,
        timestamp: now,
    });

    Ok(())
}
