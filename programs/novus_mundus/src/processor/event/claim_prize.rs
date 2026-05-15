use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
    sysvars::{Sysvar, clock::Clock},
};

use crate::{
    constants::PRIZE_DISTRIBUTION,
    error::GameError,
    helpers::{close_account, estate::{treasury_prize_bonus_bps, load_estate_for_player}, validate_token_account_owner},
    token_helpers::create_associated_token_account,
    state::{EventAccount, EventParticipation, PlayerAccount},
    types::PrizeType,
    validation::{require_signer, require_writable},
    logic::{
        safe_math::apply_bp,
        eligibility::{
            check_transfer_ratio, check_account_age, check_activity_requirement,
            get_transfer_ratio_for_prize, get_min_age_for_prize, get_min_attacks_for_prize,
        },
    },
    emit,
    events::progression::EventPrizeClaimed,
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
/// - [] winner_estate: EstateAccount PDA (for Treasury prize bonus)
/// - [writable] event_vault: (optional, only for SPLToken prizes)
/// - [writable] winner_spl_token_account: (optional, only for SPLToken prizes)
/// - [] prize_token_mint: (optional, only for SPLToken prizes) — SPL prize token mint
/// - [] system_program: (optional, only for SPLToken prizes) — needed to create the recipient ATA
/// - [] associated_token_program: (optional, only for SPLToken prizes)
///
/// # Building Bonuses
/// Treasury building provides prize bonus:
/// - Lv 5-9: +10% prize bonus
/// - Lv 10-14: +25% prize bonus
/// - Lv 15-19: +40% prize bonus
/// - Lv 20+: +50% prize bonus
///
/// # Instruction Data
/// None
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    // winner_estate is required (index 9), SPL token accounts are optional

    let base_account_count = 10;

    crate::extract_accounts!(accounts, [
        payer,
        winner_account,
        event_account,
        participation_account,
        winner_owner,
        winner_novi_ata,
        novi_mint,
        game_engine,
        token_program,
        winner_estate,
    ]);

    // Optional accounts for SPL token prizes:
    // [10] event_vault, [11] winner_spl_token_account, [12] prize_token_mint,
    // [13] system_program, [14] associated_token_program
    let (event_vault, winner_spl_token_account, prize_mint, spl_system_program) =
        if accounts.len() >= base_account_count + 5 {
            (Some(&accounts[10]), Some(&accounts[11]), Some(&accounts[12]), Some(&accounts[13]))
        } else {
            (None, None, None, None)
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

    // Verify token account belongs to the winner's PlayerAccount PDA
    validate_token_account_owner(winner_novi_ata, winner_account.address())?;

    // 3. Load Accounts

    let mut winner_data_ref = winner_account.try_borrow_mut()?;
    let winner_data = unsafe { PlayerAccount::load_mut(&mut winner_data_ref) };

    let mut event_data_ref = event_account.try_borrow_mut()?;
    let event_data = unsafe { EventAccount::load_mut(&mut event_data_ref) };

    let mut participation_data_ref = participation_account.try_borrow_mut()?;
    let participation_data = unsafe { EventParticipation::load_mut(&mut participation_data_ref) };

    // Verify ownership
    if &winner_data.owner != winner_owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // Verify participation matches
    if &participation_data.player != winner_owner.address() {
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

    // 4a. Anti-Sybil Eligibility Checks (tiered by prize value)
    // These checks prevent bots from farming event prizes
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Get tier-based requirements from prize amount
    let max_transfer_ratio = get_transfer_ratio_for_prize(event_data.prize_amount);
    let min_account_age = get_min_age_for_prize(event_data.prize_amount);
    let min_attacks = get_min_attacks_for_prize(event_data.prize_amount);

    // Check 1: Transfer ratio (detects consolidation bots)
    // Legitimate players have balanced sent/received; bots consolidate to main accounts
    // Requirement scales: <25K=10:1, 25K-100K=3:1, 100K+=2:1
    check_transfer_ratio(
        winner_data.total_received,
        winner_data.total_sent,
        max_transfer_ratio,
    )?;

    // Check 2: Account age (prevents newly created bot accounts)
    // Requirement scales with prize: <25K=7d, 25K-100K=30d, 100K+=60d
    check_account_age(winner_data.created_at, now, min_account_age)?;

    // Check 3: Activity requirement (prevents passive farming)
    // Requirement scales with prize: <25K=5 attacks, 25K-100K=20, 100K+=50
    check_activity_requirement(winner_data.total_attacks, min_attacks)?;

    // 5. Check Already Claimed (account should have lamports if not claimed)

    // If participation account has zero lamports, it's already been closed/claimed
    if participation_account.lamports() == 0 {
        return Err(GameError::EventPrizeAlreadyClaimed.into());
    }

    // 6. Find Winner's Rank
    let rank = event_data.find_rank(winner_owner.address())
        .ok_or(GameError::NotEventWinner)?;

    // Rank is 0-indexed, leaderboard is 0-9 for top 10
    if rank >= 10 {
        return Err(GameError::NotEventWinner.into());
    }

    // 7. Calculate Prize Share (using basis points)
    let prize_bps = PRIZE_DISTRIBUTION[rank] as u64;
    let base_prize_share = apply_bp(event_data.prize_amount, prize_bps)
        .ok_or(GameError::MathOverflow)?;

    if base_prize_share == 0 {
        return Err(GameError::NothingToClaim.into());
    }

    // 7a. Apply Treasury building prize bonus (BUILDING BONUS)
    let estate = load_estate_for_player(winner_estate, winner_data, program_id)?;
    let treasury_bonus_bps = treasury_prize_bonus_bps(estate);

    // Apply bonus: prize × (10000 + bonus_bps) / 10000
    let prize_share = if treasury_bonus_bps > 0 {
        let bonus_multiplier = 10000u64.saturating_add(treasury_bonus_bps as u64);
        base_prize_share.saturating_mul(bonus_multiplier) / 10000
    } else {
        base_prize_share
    };

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
            let game_engine_data_ref = game_engine.try_borrow()?;
            let game_engine_data = unsafe {
                crate::state::GameEngine::load(&game_engine_data_ref)
            };

            // Create PDA signer for GameEngine (mint authority)
            let kingdom_id_bytes = game_engine_data.kingdom_id.to_le_bytes();
            let bump_seed = [game_engine_data.bump];
            let seeds = crate::seeds!(crate::constants::GAME_ENGINE_SEED, &kingdom_id_bytes, &bump_seed);
            let signer = pinocchio::cpi::Signer::from(&seeds);

            crate::require_keys_eq!(
                novi_mint.address().as_array(),
                &crate::constants::NOVI_MINT_ADDRESS,
                "claim_prize.novi_mint",
                GameError::InvalidMint,
            );

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
            let prize_mint = prize_mint.ok_or(ProgramError::NotEnoughAccountKeys)?;
            let system_program = spl_system_program.ok_or(ProgramError::NotEnoughAccountKeys)?;

            require_writable(vault)?;
            require_writable(recipient)?;
            require_key_match(system_program, &pinocchio_system::ID)?;

            // The recipient ATA is derived for `prize_mint`; pin it to the
            // event's designated prize token.
            crate::require_keys_eq!(
                prize_mint.address().as_array(),
                event_data.prize_token_mint.as_array(),
                "claim_prize.prize_mint",
                GameError::InvalidMint,
            );

            // pin the prize vault.
            validate_token_account_owner(vault, event_account.address())?;
            {
                let vault_data = vault.try_borrow()?;
                if &vault_data[0..32] != event_data.prize_token_mint.as_ref() {
                    return Err(GameError::InvalidMint.into());
                }
            }

            // Create the winner's prize-token ATA if it does not exist.
            if recipient.data_len() == 0 {
                create_associated_token_account(
                    payer,          // Payer (funds rent)
                    recipient,      // ATA to create
                    winner_owner,   // Wallet that owns the ATA
                    prize_mint,     // Prize token mint
                    system_program,
                    token_program,
                )?;
            }

            // pin the prize destination to the winner's wallet.
            validate_token_account_owner(recipient, winner_owner.address())?;

            // The event vault SPL token account is owned by the
            // EventAccount PDA (the program). The transfer authority must be the
            // EventAccount PDA, not the vault token account itself. Sign with
            // EVENT_SEED + game_engine + event_id + bump.
            let event_id_bytes = event_data.id.to_le_bytes();
            let event_bump_seed = [event_data.bump];
            let event_seeds = crate::seeds!(
                crate::constants::EVENT_SEED,
                event_data.game_engine.as_ref(),
                &event_id_bytes,
                &event_bump_seed
            );
            let event_signer = pinocchio::cpi::Signer::from(&event_seeds);

            crate::helpers::transfer_tokens(
                vault,
                recipient,
                event_account,  // EventAccount PDA is the vault's authority
                prize_share,
                &[event_signer],
            )?;
        },
    }

    // 9. Cleanup - Update Event Prize Remaining

    event_data.prize_remaining = event_data.prize_remaining.saturating_sub(prize_share);

    // 10. Cleanup - Clear Player's Current Event

    // Allow player to join new events
    winner_data.current_event = 0;

    // 11. Close Participation Account (Rent Refund)

    // Save values for event before dropping borrows
    let event_player = *winner_account.address();
    let event_player_name = winner_data.name;
    let event_event = *event_account.address();
    let event_rank = rank as u16;
    let event_prize = prize_share;

    // Drop borrows before closing account
    drop(participation_data_ref);
    drop(winner_data_ref);
    drop(event_data_ref);

    // Close participation account (refund rent to winner)
    close_account(participation_account, winner_owner)?;

    // Emit event (reuse `now` from eligibility checks above)
    emit!(EventPrizeClaimed {
        player: event_player,
        player_name: event_player_name,
        event: event_event,
        rank: event_rank,
        prize_amount: event_prize,
        timestamp: now,
    });

    Ok(())
}
