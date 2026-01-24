use pinocchio::{
    ProgramResult, account_info::AccountInfo, program_error::ProgramError, pubkey::{Pubkey, find_program_address}, sysvars::{Sysvar, clock::Clock}
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::EVENT_PARTICIPATION_SEED,
    error::GameError,
    state::{EventAccount, EventParticipation, PlayerAccount, require_extension, EXT_RESEARCH},
    validation::{require_signer, require_writable, require_key_match},
    emit,
    events::game_event::GameEventJoined,
};

/// Join an event
///
/// Player joins event if they meet requirements.
/// Creates EventParticipation PDA and sets player.current_event.
/// Player can only be in ONE event at a time.
///
/// # Accounts
/// - [signer, writable] payer: Pays for account creation (can be backend for free event joins!)
/// - [writable] player: PlayerAccount
/// - [writable] event: EventAccount
/// - [writable] event_participation: EventParticipation (PDA to be created)
/// - [writable] player_owner: Player's wallet
/// - [] system_program: System program
/// - [] clock: Clock sysvar
///
/// # Instruction Data
/// None
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        payer,
        player_account,
        event_account,
        event_participation_account,
        player_owner,
        system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(payer)?;
    require_writable(payer)?;
    require_writable(player_owner)?;
    require_writable(player_account)?;
    require_writable(event_account)?;
    require_writable(event_participation_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Load Clock

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 4. Load Accounts

    let mut player_account_data = player_account.try_borrow_mut_data()?;
    let mut event_account_data = event_account.try_borrow_mut_data()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_account_data) };
    let event_data = unsafe { EventAccount::load_mut(&mut event_account_data) };

    // Verify ownership
    if &player_data.owner != player_owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 4a. Require EXT_RESEARCH to join events (ensures player understands game)
    require_extension(player_data, EXT_RESEARCH)?;

    // 5. Validate Event State

    // Event must be pending or active
    if event_data.status > 1 {
        return Err(GameError::EventEnded.into());
    }

    // Must be before end_time
    if now >= event_data.end_time {
        return Err(GameError::EventEnded.into());
    }

    // Auto-activate if needed
    if event_data.status == 0 && now >= event_data.start_time && event_data.auto_activate {
        event_data.status = 1; // activate
    }

    // 6. Check Player Eligibility

    // Player cannot be in another event
    if player_data.current_event != 0 {
        return Err(GameError::AlreadyInRally.into()); // Reusing error
    }

    // Check level requirement
    if event_data.min_level > 0 && player_data.level < event_data.min_level {
        return Err(GameError::InsufficientLevel.into());
    }

    // Check reputation requirement
    if event_data.min_reputation > 0 && player_data.reputation < event_data.min_reputation {
        return Err(GameError::DoesNotMeetTeamRequirements.into()); // Reusing error
    }

    // Check subscription requirement (use effective tier to handle expiration)
    let effective_tier = player_data.get_effective_tier(now);
    if event_data.required_subscription_tier > 0
        && effective_tier < event_data.required_subscription_tier {
        return Err(GameError::InsufficientSubscriptionTier.into());
    }

    // 7. Derive and Verify EventParticipation PDA

    let event_id_bytes = event_data.id.to_le_bytes();
    let (expected_participation, bump) = find_program_address(
        &[EVENT_PARTICIPATION_SEED, &event_id_bytes, player_owner.key().as_ref()],
        program_id,
    );

    if event_participation_account.key() != &expected_participation {
        return Err(GameError::InvalidPDA.into());
    }

    // 8. Create EventParticipation Account

    let lamports = pinocchio::sysvars::rent::Rent::get()?
        .minimum_balance(EventParticipation::LEN);

    let bump_seed = [bump];
    let seeds = pinocchio::seeds!(EVENT_PARTICIPATION_SEED, &event_id_bytes, player_owner.key(), &bump_seed);
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: event_participation_account,
        lamports,
        space: EventParticipation::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 9. Initialize EventParticipation Data

    let mut participation_account_data = event_participation_account.try_borrow_mut_data()?;
    let participation_data = unsafe { EventParticipation::load_mut(&mut participation_account_data) };
    *participation_data = EventParticipation::new(event_data.id, *player_owner.key(), now, bump);

    // 10. Update Player and Event

    player_data.current_event = event_data.id;
    event_data.participant_count = event_data.participant_count.saturating_add(1);

    // Emit event
    emit!(GameEventJoined {
        event: *event_account.key(),
        player: *player_account.key(),
        player_name: player_data.name,
        entry_fee: 0,
        participant_count: event_data.participant_count,
        timestamp: now,
    });

    Ok(())
}
