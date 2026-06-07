use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    emit,
    error::GameError,
    events::game_event::GameEventLeft,
    helpers::close_account,
    state::{EventAccount, EventParticipation, PlayerAccount},
    validation::{require_signer, require_writable},
};

/// Leave an event
///
/// Frees the player's one-event slot once the event is over, so non-winners
/// (who never call claim_prize) aren't locked out of every future event.
///
/// Allowed only after the event is finalized (2) or cancelled (3) so a player
/// can't bail mid-competition to dodge a loss. Top-10 winners of a finalized
/// event must claim their prize first (claim_prize already clears the slot and
/// closes this account) to avoid silently forfeiting it.
///
/// Cleanup performed:
/// - Clears player.current_event (allows joining new events)
/// - Closes participation account (refunds rent to player_owner)
///
/// # Accounts
/// - [signer, writable] payer: Pays transaction fees (can be backend for gas-less leaves)
/// - [writable] player: PlayerAccount
/// - [] event: EventAccount (read-only; not mutated)
/// - [writable] event_participation: EventParticipation (will be closed, rent refunded to player_owner)
/// - [writable] player_owner: Player's wallet (rent refund recipient)
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
        payer,
        player_account,
        event_account,
        event_participation_account,
        player_owner,
    ]);

    // 2. Validate Accounts

    require_signer(payer)?;
    require_writable(payer)?;
    require_writable(player_account)?;
    require_writable(event_participation_account)?;
    require_writable(player_owner)?;

    // 3. Load Clock

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 4. Load Accounts
    //
    // The event self-derives from its stored seeds (read-only here); the player
    // binds to the event's kingdom and the player_owner wallet. The
    // participation account binds to (kingdom, event id, player_owner).
    let event_data = EventAccount::load_checked_by_key(event_account, program_id)?;
    let player_data = PlayerAccount::load_checked_mut(
        player_account,
        &event_data.game_engine,
        player_owner.address(),
        program_id,
    )?;
    EventParticipation::load_checked(
        event_participation_account,
        &event_data.game_engine,
        event_data.id,
        player_owner.address(),
        program_id,
    )?;

    // 5. Validate the player is actually in THIS event

    if player_data.current_event != event_data.id {
        return Err(GameError::NotInEvent.into());
    }

    // 6. Validate Event State
    //
    // Only finalized (2) or cancelled (3) events can be left. A pending/active
    // event is still in play, so leaving is not allowed.
    if event_data.status != 2 && event_data.status != 3 {
        return Err(GameError::EventNotCompleted.into());
    }

    // 6a. Winners must claim before leaving (avoid silent forfeiture).
    // Only applies to finalized events; cancelled events pay nothing.
    if event_data.status == 2 {
        if let Some(rank) = event_data.find_rank(player_owner.address()) {
            if rank < 10 {
                return Err(GameError::EventPrizeUnclaimed.into());
            }
        }
    }

    // 7. Clear Player's Current Event (allow joining new events)

    player_data.current_event = 0;

    // 8. Close Participation Account (Rent Refund)

    let event_player = *player_account.address();
    let event_player_name = player_data.name;
    let event_event = *event_account.address();

    close_account(event_participation_account, player_owner)?;

    // Emit event
    emit!(GameEventLeft {
        event: event_event,
        player: event_player,
        player_name: event_player_name,
        timestamp: now,
    });

    Ok(())
}
