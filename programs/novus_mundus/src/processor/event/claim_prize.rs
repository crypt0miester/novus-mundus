use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    constants::PRIZE_DISTRIBUTION,
    error::GameError,
    helpers::close_account,
    state::{EventAccount, EventParticipation, PlayerAccount},
    types::PrizeType,
    validation::{require_signer, require_writable},
    logic::safe_math::apply_bp,
};

/// Claim event prize
///
/// Winners (top 10 leaderboard) claim their weighted prize share.
/// Prize distribution is weighted by rank (40%, 20%, 13%, 9%, 6%, 4%, 3%, 2%, 2%, 1%).
///
/// Cleanup performed:
/// - Closes participation account (refunds rent to winner)
/// - Decrements event.prize_remaining
/// - Clears player.current_event (allows joining new events)
///
/// # Accounts
/// - [signer, writable] payer: Pays transaction fees (can be backend to enable gas-less claims!)
/// - [writable] winner_player: PlayerAccount (winner claiming prize)
/// - [writable] event: EventAccount
/// - [writable] event_participation: EventParticipation (will be closed, rent refunded to winner_owner)
/// - [writable] winner_owner: Winner's wallet
/// - [writable] winner_novi_ata: Winner's NOVI token account (required for LockedNovi prizes)
/// - [writable] novi_mint: NOVI mint (required for LockedNovi prizes)
/// - [] game_engine: GameEngine PDA (required for LockedNovi mint authority)
/// - [] token_program: Token program
/// - [writable] event_vault: (optional, only for SPLToken prizes)
/// - [writable] winner_spl_token_account: (optional, only for SPLToken prizes)
///
/// # Instruction Data
/// None
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let base_account_count = 9;

    if accounts.len() < base_account_count {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let payer = &accounts[0];
    let winner_account = &accounts[1];
    let event_account = &accounts[2];
    let participation_account = &accounts[3];
    let winner_owner = &accounts[4];
    let winner_novi_ata = &accounts[5];
    let novi_mint = &accounts[6];
    let game_engine = &accounts[7];
    let token_program = &accounts[8];

    // Optional accounts for SPL token prizes
    let (event_vault, winner_spl_token_account) = if accounts.len() >= base_account_count + 2 {
        (Some(&accounts[9]), Some(&accounts[10]))
    } else {
        (None, None)
    };

    // 2. Validate Accounts

    require_signer(payer)?;
    require_writable(payer)?;
    require_writable(winner_owner)?;
    require_writable(winner_account)?;
    require_writable(event_account)?;
    require_writable(participation_account)?;
    require_writable(winner_novi_ata)?;
    require_writable(novi_mint)?;

    use crate::validation::require_key_match;
    require_key_match(token_program, &pinocchio_token::ID)?;

    // 3. Load Accounts

    let mut winner_data_ref = winner_account.try_borrow_mut_data()?;
    let winner_data = unsafe { PlayerAccount::load_mut(&mut winner_data_ref) };

    let mut event_data_ref = event_account.try_borrow_mut_data()?;
    let event_data = unsafe { EventAccount::load_mut(&mut event_data_ref) };

    let mut participation_data_ref = participation_account.try_borrow_mut_data()?;
    let participation_data = unsafe { EventParticipation::load_mut(&mut participation_data_ref) };

    // Verify ownership
    if &winner_data.owner != winner_owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // Verify participation matches
    if &participation_data.player != winner_owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    if participation_data.event_id != event_data.id {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Validate Event State

    // Event must be finalized
    if event_data.status != 2 {
        return Err(GameError::EventNotCompleted.into());
    }

    // 5. Check Already Claimed (account should have lamports if not claimed)

    // If participation account has zero lamports, it's already been closed/claimed
    if participation_account.lamports() == 0 {
        return Err(GameError::EventPrizeAlreadyClaimed.into());
    }

    // 6. Find Winner's Rank
    let rank = event_data.find_rank(winner_owner.key())
        .ok_or(GameError::NotEventWinner)?;

    // Rank is 0-indexed, leaderboard is 0-9 for top 10
    if rank >= 10 {
        return Err(GameError::NotEventWinner.into());
    }

    // 7. Calculate Prize Share (using basis points)
    let prize_bps = PRIZE_DISTRIBUTION[rank] as u64;
    let prize_share = apply_bp(event_data.prize_amount, prize_bps)
        .ok_or(GameError::MathOverflow)?;

    if prize_share == 0 {
        return Err(GameError::NothingToClaim.into());
    }

    // Check sufficient prize remaining
    if event_data.prize_remaining < prize_share {
        return Err(GameError::InsufficientBalance.into());
    }

    // 8. Transfer Prize Based on Type
    let prize_type = PrizeType::from_u8(event_data.prize_type)
        .ok_or(GameError::InvalidParameter)?;

    match prize_type {
        PrizeType::LockedNovi => {
            // Load GameEngine for mint authority
            let game_engine_data_ref = game_engine.try_borrow_data()?;
            let game_engine_data = unsafe {
                crate::state::GameEngine::load(&game_engine_data_ref)
            };

            // Create PDA signer for GameEngine (mint authority)
            let bump_seed = [game_engine_data.bump];
            let seeds = pinocchio::seeds!(crate::constants::GAME_ENGINE_SEED, &bump_seed);
            let signer = pinocchio::instruction::Signer::from(&seeds);

            // Mint NOVI tokens to winner's token account
            crate::helpers::mint_tokens(
                novi_mint,
                winner_novi_ata,
                game_engine,
                prize_share,
                &[signer],
            )?;

            // Update locked_novi balance in PlayerAccount state
            winner_data.locked_novi = winner_data.locked_novi
                .checked_add(prize_share)
                .ok_or(GameError::MathOverflow)?;
        },
        PrizeType::Gems => {
            winner_data.gems = winner_data.gems.saturating_add(prize_share);
        },
        PrizeType::Cash => {
            winner_data.cash_on_hand = winner_data.cash_on_hand.saturating_add(prize_share);
        },
        PrizeType::SPLToken => {
            // Verify token accounts provided
            let vault = event_vault.ok_or(ProgramError::NotEnoughAccountKeys)?;
            let recipient = winner_spl_token_account.ok_or(ProgramError::NotEnoughAccountKeys)?;

            require_writable(vault)?;
            require_writable(recipient)?;

            // CPI transfer from event vault to winner
            crate::helpers::transfer_tokens(
                vault,
                recipient,
                vault, // vault is authority (event PDA)
                prize_share,
                &[], // No seeds needed if vault is signer
            )?;
        },
    }

    // 9. Cleanup - Update Event Prize Remaining

    event_data.prize_remaining = event_data.prize_remaining.saturating_sub(prize_share);

    // 10. Cleanup - Clear Player's Current Event

    // Allow player to join new events
    winner_data.current_event = 0;

    // 11. Close Participation Account (Rent Refund)

    // Drop borrows before closing account
    drop(participation_data_ref);
    drop(winner_data_ref);
    drop(event_data_ref);

    // Close participation account (refund rent to winner)
    close_account(participation_account, winner_owner)?;

    Ok(())
}
