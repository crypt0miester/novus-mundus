use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, DungeonRun, DungeonStatus},
    constants::DUNGEON_RUN_SEED,
    helpers::{
        close_account,
        dungeon::{get_flee_penalty_bps, apply_reward_penalty},
    },
    validation::{require_signer, require_writable},
    emit,
    events::DungeonFled,
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
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    if accounts.len() < 7 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let owner = &accounts[0];
    let player_account = &accounts[1];
    let dungeon_run_account = &accounts[2];
    let hero_mint = &accounts[3];
    let hero_collection = &accounts[4];
    let system_program = &accounts[5];
    let p_core_program = &accounts[6];

    // 2. Validate signer
    require_signer(owner)?;
    require_writable(owner)?;
    require_writable(player_account)?;
    require_writable(dungeon_run_account)?;
    require_writable(hero_mint)?;

    // 3. Load player using load_checked_mut_by_key (kingdom-scoped)
    let mut player = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;
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
    let status = DungeonStatus::from_u8(run.status)
        .ok_or(GameError::InvalidParameter)?;

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
    drop(run);
    drop(player);

    // 7. Transfer hero back from DungeonRun PDA to owner using MPL Core
    let run_bump_seed = [run_bump];
    let run_seeds = crate::seeds!(
        DUNGEON_RUN_SEED,
        player_account.address(),
        &run_bump_seed
    );
    let run_signer = pinocchio::cpi::Signer::from(&run_seeds);

    p_core::instructions::TransferV1 {
        asset: hero_mint,
        collection: hero_collection,
        new_owner: owner,
        payer: owner,
        authority: dungeon_run_account,
        system_program,
        log_wrapper: p_core_program,
    }.invoke_signed(&[run_signer])?;

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
