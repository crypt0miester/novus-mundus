use crate::{
    constants::{EVENT_SEED, MAX_EVENT_NAME_LENGTH, MIN_EVENT_NAME_LENGTH},
    emit,
    error::GameError,
    events::KingdomEventCreated,
    state::{player::NULL_PUBKEY, EventAccount, GameEngine, LeaderboardEntry},
    types::{EventType, PrizeType},
    utils::{read_bytes32, read_i64, read_u64, read_u8},
    validation::{require_key_match, require_signer, require_writable},
};
use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_system::instructions::CreateAccount;

/// Create a new event (DAO only)
///
/// Events are skill-based competitions with in-game scoring.
/// Winners determined by leaderboard (top 10), prizes weighted by rank.
///
/// # Accounts
/// - [signer, writable] payer: Pays for account creation (can be backend)
/// - [] game_engine: GameEngine (for DAO authority check)
/// - [writable] event: EventAccount (PDA to be created)
/// - [signer] dao_authority: DAO's authority (authorizes event creation)
/// - [] system_program: System program
///
/// # Instruction Data
/// - event_id: u64
/// - name_len: u8
/// - name: [u8; name_len]
/// - start_time: i64
/// - end_time: i64
/// - event_type: u8
/// - min_level: u8
/// - min_reputation: u64
/// - required_subscription_tier: u8
/// - prize_type: u8
/// - prize_amount: u64
/// - prize_token_mint: Address (optional, only if prize_type=SPLToken)
/// - auto_activate: bool
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        payer,
        game_engine_account,
        event_account,
        dao_authority,
        system_program,
    ]);

    // 2. Validate Accounts

    require_signer(payer)?;
    require_writable(payer)?;
    require_signer(dao_authority)?;
    require_writable(event_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data

    if instruction_data.len() < 67 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let event_id = read_u64(instruction_data, 0, "event_create.event_id")?;
    let name_len = read_u8(instruction_data, 8, "event_create.name_len")? as usize;

    if name_len < MIN_EVENT_NAME_LENGTH || name_len > MAX_EVENT_NAME_LENGTH {
        return Err(GameError::EventNameTooLong.into());
    }

    // Fixed tail after the name: start_time(8) + end_time(8) + event_type(1) +
    // min_level(1) + min_reputation(8) + required_subscription_tier(1) +
    // prize_type(1) + prize_amount(8) + prize_token_mint(32) = 68 bytes mandatory
    // (auto_activate at offset+68 is optional). Must cover the 32-byte mint read.
    if instruction_data.len() < 9 + name_len + 68 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let name_bytes = &instruction_data[9..9 + name_len];
    let offset = 9 + name_len;

    let start_time = read_i64(instruction_data, offset, "event_create.start_time")?;
    let end_time = read_i64(instruction_data, offset + 8, "event_create.end_time")?;
    let event_type = read_u8(instruction_data, offset + 16, "event_create.event_type")?;
    let min_level = read_u8(instruction_data, offset + 17, "event_create.min_level")?;
    let min_reputation = read_u64(instruction_data, offset + 18, "event_create.min_reputation")?;
    let required_subscription_tier = read_u8(
        instruction_data,
        offset + 26,
        "event_create.required_subscription_tier",
    )?;
    let prize_type = read_u8(instruction_data, offset + 27, "event_create.prize_type")?;
    let prize_amount = read_u64(instruction_data, offset + 28, "event_create.prize_amount")?;
    let prize_token_mint_bytes =
        read_bytes32(instruction_data, offset + 36, "event_create.prize_token_mint")?;
    let prize_token_mint = Address::from(prize_token_mint_bytes);
    let auto_activate = instruction_data.get(offset + 68).copied().unwrap_or(1) != 0; // default true

    // 4. Validate Data

    if end_time <= start_time {
        return Err(GameError::InvalidTimestamp.into());
    }

    // Validate event_type
    EventType::from_u8(event_type).ok_or(GameError::InvalidParameter)?;

    // Validate prize_type
    PrizeType::from_u8(prize_type).ok_or(GameError::InvalidParameter)?;

    // 5. Derive and Verify Event PDA (includes game_engine for kingdom isolation)

    let event_id_bytes = event_id.to_le_bytes();
    let (expected_event, bump) = Address::find_program_address(
        &[
            EVENT_SEED,
            game_engine_account.address().as_ref(),
            &event_id_bytes,
        ],
        program_id,
    );

    if event_account.address() != &expected_event {
        return Err(GameError::InvalidPDA.into());
    }

    // 6. Verify DAO Authority

    let game_engine_data = GameEngine::load_checked_by_key(game_engine_account, program_id)?;
    if dao_authority.address() != &game_engine_data.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 7. Create Event Account

    let lamports = crate::utils::rent_exempt_const(EventAccount::LEN);

    let bump_seed = [bump];
    let seeds = crate::seeds!(
        EVENT_SEED,
        game_engine_account.address(),
        &event_id_bytes,
        &bump_seed
    );
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: event_account,
        lamports,
        space: EventAccount::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    // 8. Initialize Event Data

    let mut event_data_ref = event_account.try_borrow_mut()?;
    let event_data = unsafe { EventAccount::load_mut(&mut event_data_ref) };

    event_data.account_key = crate::state::AccountKey::Event as u8;
    event_data.game_engine = *game_engine_account.address();
    event_data.id = event_id;
    event_data.name_len = name_len as u8;
    event_data.name[0..name_len].copy_from_slice(name_bytes);
    event_data.start_time = start_time;
    event_data.end_time = end_time;
    event_data.status = 0; // pending
    event_data.auto_activate = auto_activate;
    event_data.event_type = event_type;
    event_data.min_level = min_level;
    event_data.min_reputation = min_reputation;
    event_data.required_subscription_tier = required_subscription_tier;
    event_data.leaderboard_count = 0;
    event_data.prize_type = prize_type;
    event_data.prize_amount = prize_amount;
    event_data.prize_remaining = prize_amount; // Initialize to full amount
    event_data.prize_token_mint = prize_token_mint;
    event_data.participant_count = 0;
    event_data.bump = bump;

    // Clear leaderboard
    for i in 0..EventAccount::MAX_LEADERBOARD {
        event_data.leaderboard[i] = LeaderboardEntry {
            player: NULL_PUBKEY,
            score: 0,
        };
    }

    // Emit KingdomEventCreated event
    emit!(KingdomEventCreated {
        kingdom_id: game_engine_data.kingdom_id,
        game_engine: *game_engine_account.address(),
        event_id,
        event_type,
        start_time,
        end_time,
        prize_pool: prize_amount,
    });

    Ok(())
}
