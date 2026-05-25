use pinocchio::{
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::PLAYER_SEED,
    emit,
    error::GameError,
    events::estate::PlotPurchased,
    helpers::burn_tokens,
    state::{EstateAccount, PlayerAccount, SLOTS_PER_PLOT},
    validation::{require_owner, require_signer, require_writable},
};

/// Buy Plot
///
/// Purchases an additional land plot for the estate, unlocking 4 more building slots.
/// Cost scales with φ² per plot purchased.
///
/// # Plot Costs (NOVI)
/// - Plot 2: 100,000
/// - Plot 3: ~262,000
/// - Plot 4: ~685,000
/// - Plot 5: ~1,794,000
///
/// # Accounts
/// - [writable, signer] owner: Player's wallet
/// - [writable] player_account: PlayerAccount PDA
/// - [writable] estate_account: EstateAccount PDA
/// - [writable] player_token_account: Player's locked NOVI token account
/// - [writable] novi_mint: NOVI token mint
/// - [] token_program: SPL Token program
/// - [] system_program: System program (for rent transfer on estate resize)
///
/// # Instruction Data
/// None
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [
        owner,
        player_account,
        estate_account,
        player_token_account,
        novi_mint,
        _token_program,
        _system_program,
    ]);

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(estate_account)?;
    require_writable(player_token_account)?;
    require_writable(novi_mint)?;
    crate::require_keys_eq!(
        novi_mint.address().as_array(),
        &crate::constants::NOVI_MINT_ADDRESS,
        "buy_plot.novi_mint",
        GameError::InvalidMint,
    );
    // Program-ownership gate (precedes the unsafe ::load calls below).
    require_owner(player_account, program_id)?;
    require_owner(estate_account, program_id)?;

    // 3. Phase 1: Validate and capture values (scoped borrow, dropped before CPI)
    let (cost, plot_index, player_ge, player_bump, player_name) = {
        let player_data_ref = player_account.try_borrow()?;
        let player_data = unsafe { PlayerAccount::load(&player_data_ref) };

        let estate_data_ref = estate_account.try_borrow()?;
        let estate_data = unsafe { EstateAccount::load(&estate_data_ref) };

        // 4. Verify ownership
        if &player_data.owner != owner.address() {
            return Err(GameError::Unauthorized.into());
        }
        if &estate_data.owner != owner.address() {
            return Err(GameError::Unauthorized.into());
        }

        // 5. Get plot cost and current plot count
        let cost = estate_data
            .next_plot_cost()
            .ok_or(GameError::ExceedsMaxCap)?;
        let plot_index = estate_data.plots_owned;

        // 6. Check player has enough NOVI
        if player_data.locked_novi < cost {
            return Err(GameError::InsufficientLockedNovi.into());
        }

        (
            cost,
            plot_index,
            player_data.game_engine,
            player_data.bump,
            player_data.name,
        )
    }; // borrows dropped

    // 7. Burn NOVI tokens (CPI - no active borrows)
    let bump_seed = [player_bump];
    let player_seeds = crate::seeds!(PLAYER_SEED, player_ge.as_ref(), owner.address(), &bump_seed);
    let player_signer = pinocchio::cpi::Signer::from(&player_seeds);

    burn_tokens(
        player_token_account,
        novi_mint,
        player_account,
        cost,
        &[player_signer],
    )?;

    // 7b. Grow the estate account to fit the new plot's 4 building slots.
    //
    //     This MUST happen before incrementing plots_owned. Otherwise, code paths
    //     bounded by `max_slots() = plots_owned * 4` (e.g. find_empty_slot,
    //     recalculate_estate_level, daily activity scans) would attempt to index
    //     into building slots whose bytes are not yet allocated on the account
    //     — undefined behavior.
    let new_slot_count = (plot_index as usize).saturating_add(1) * SLOTS_PER_PLOT;
    let new_size = EstateAccount::size_for_slots(new_slot_count);

    let rent = Rent::get()?;
    let required_lamports = rent.try_minimum_balance(new_size)?;
    let current_lamports = estate_account.lamports();
    let lamports_needed = required_lamports.saturating_sub(current_lamports);
    if lamports_needed > 0 {
        pinocchio_system::instructions::Transfer {
            from: owner,
            to: estate_account,
            lamports: lamports_needed,
        }
        .invoke()?;
    }
    estate_account.resize(new_size)?;
    // Newly allocated bytes are zero-filled by the runtime, which equals
    // BuildingSlot::EMPTY — no explicit slot init needed.

    // 8. Phase 2: Update state after successful CPI (mutable borrow)
    let mut player_data_ref = player_account.try_borrow_mut()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };
    player_data.locked_novi = player_data.locked_novi.saturating_sub(cost);

    let mut estate_data_ref = estate_account.try_borrow_mut()?;
    let estate_data = unsafe { EstateAccount::load_mut(&mut estate_data_ref) };

    estate_data.buy_plot().ok_or(GameError::ExceedsMaxCap)?;

    // 9. Update activity timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    estate_data.last_activity = now;

    // 10. Emit PlotPurchased event
    emit!(PlotPurchased {
        player: *player_account.address(),
        player_name,
        plot: plot_index,
        cost,
        total_plots: estate_data.plots_owned,
        timestamp: now,
    });

    Ok(())
}
