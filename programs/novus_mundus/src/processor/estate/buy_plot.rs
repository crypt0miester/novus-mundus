use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{EstateAccount, PlayerAccount},
    constants::PLAYER_SEED,
    helpers::burn_tokens,
    validation::{require_signer, require_writable},
    emit,
    events::estate::PlotPurchased,
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
///
/// # Instruction Data
/// None
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [
        owner,
        player_account,
        estate_account,
        player_token_account,
        novi_mint,
        _token_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(estate_account)?;
    require_writable(player_token_account)?;
    require_writable(novi_mint)?;

    // 3. Phase 1: Validate and capture values (scoped borrow, dropped before CPI)
    let (cost, plot_index, player_ge, player_bump, player_name) = {
        let player_data_ref = player_account.try_borrow_data()?;
        let player_data = unsafe { PlayerAccount::load(&player_data_ref) };

        let estate_data_ref = estate_account.try_borrow_data()?;
        let estate_data = unsafe { EstateAccount::load(&estate_data_ref) };

        // 4. Verify ownership
        if &player_data.owner != owner.key() {
            return Err(GameError::Unauthorized.into());
        }
        if &estate_data.owner != owner.key() {
            return Err(GameError::Unauthorized.into());
        }

        // 5. Get plot cost and current plot count
        let cost = estate_data.next_plot_cost()
            .ok_or(GameError::ExceedsMaxCap)?;
        let plot_index = estate_data.plots_owned;

        // 6. Check player has enough NOVI
        if player_data.locked_novi < cost {
            return Err(GameError::InsufficientLockedNovi.into());
        }

        (cost, plot_index, player_data.game_engine, player_data.bump, player_data.name)
    }; // borrows dropped

    // 7. Burn NOVI tokens (CPI - no active borrows)
    let bump_seed = [player_bump];
    let player_seeds = pinocchio::seeds!(PLAYER_SEED, &player_ge, owner.key().as_ref(), &bump_seed);
    let player_signer = pinocchio::instruction::Signer::from(&player_seeds);

    burn_tokens(
        player_token_account,
        novi_mint,
        player_account,
        cost,
        &[player_signer],
    )?;

    // 8. Phase 2: Update state after successful CPI (mutable borrow)
    let mut player_data_ref = player_account.try_borrow_mut_data()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };
    player_data.locked_novi = player_data.locked_novi.saturating_sub(cost);

    let mut estate_data_ref = estate_account.try_borrow_mut_data()?;
    let estate_data = unsafe { EstateAccount::load_mut(&mut estate_data_ref) };

    estate_data.buy_plot()
        .ok_or(GameError::ExceedsMaxCap)?;

    // 9. Update activity timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    estate_data.last_activity = now;

    // 10. Emit PlotPurchased event
    emit!(PlotPurchased {
        player: *player_account.key(),
        player_name,
        plot: plot_index,
        cost,
        total_plots: estate_data.plots_owned,
        timestamp: now,
    });

    Ok(())
}
