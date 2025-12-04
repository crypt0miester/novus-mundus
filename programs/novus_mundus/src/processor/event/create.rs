use pinocchio::{
    ProgramResult, account_info::AccountInfo, program_error::ProgramError, pubkey::{Pubkey, find_program_address}
};
use pinocchio_system::instructions::CreateAccount;
use pinocchio::sysvars::Sysvar;
use crate::{
    constants::{EVENT_SEED, MIN_EVENT_NAME_LENGTH, MAX_EVENT_NAME_LENGTH},
    error::GameError,
    state::{EventAccount, GameEngine, LeaderboardEntry, player::NULL_PUBKEY},
    types::{EventType, PrizeType},
    validation::{require_signer, require_writable, require_key_match},
};

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
/// - prize_token_mint: Pubkey (optional, only if prize_type=SPLToken)
/// - auto_activate: bool
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        payer,
        game_engine_account,
        event_account,
        dao_authority,
        system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

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

    let event_id = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());
    let name_len = instruction_data[8] as usize;

    if name_len < MIN_EVENT_NAME_LENGTH || name_len > MAX_EVENT_NAME_LENGTH {
        return Err(GameError::EventNameTooLong.into());
    }

    if instruction_data.len() < 9 + name_len + 58 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let name_bytes = &instruction_data[9..9 + name_len];
    let offset = 9 + name_len;

    let start_time = i64::from_le_bytes(instruction_data[offset..offset + 8].try_into().unwrap());
    let end_time = i64::from_le_bytes(instruction_data[offset + 8..offset + 16].try_into().unwrap());
    let event_type = instruction_data[offset + 16];
    let min_level = instruction_data[offset + 17];
    let min_reputation = u64::from_le_bytes(instruction_data[offset + 18..offset + 26].try_into().unwrap());
    let required_subscription_tier = instruction_data[offset + 26];
    let prize_type = instruction_data[offset + 27];
    let prize_amount = u64::from_le_bytes(instruction_data[offset + 28..offset + 36].try_into().unwrap());
    let mut prize_token_mint_bytes = [0u8; 32];
    prize_token_mint_bytes.copy_from_slice(&instruction_data[offset + 36..offset + 68]);
    let prize_token_mint = Pubkey::from(prize_token_mint_bytes);
    let auto_activate = instruction_data.get(offset + 68).copied().unwrap_or(1) != 0; // default true

    // 4. Validate Data

    if end_time <= start_time {
        return Err(GameError::InvalidTimestamp.into());
    }

    // Validate event_type
    EventType::from_u8(event_type).ok_or(GameError::InvalidParameter)?;

    // Validate prize_type
    PrizeType::from_u8(prize_type).ok_or(GameError::InvalidParameter)?;

    // 5. Derive and Verify Event PDA

    let event_id_bytes = event_id.to_le_bytes();
    let (expected_event, bump) = find_program_address(
        &[EVENT_SEED, &event_id_bytes],
        program_id,
    );

    if event_account.key() != &expected_event {
        return Err(GameError::InvalidPDA.into());
    }

    // 6. Verify DAO Authority

    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine_data = unsafe { GameEngine::load(&game_engine_data_ref) };

    if dao_authority.key() != &game_engine_data.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 7. Create Event Account

    let lamports = pinocchio::sysvars::rent::Rent::get()?
        .minimum_balance(EventAccount::LEN);

    let bump_seed = [bump];
    let seeds = pinocchio::seeds!(EVENT_SEED, &event_id_bytes, &bump_seed);
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: event_account,
        lamports,
        space: EventAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 8. Initialize Event Data

    let mut event_data_ref = event_account.try_borrow_mut_data()?;
    let event_data = unsafe { EventAccount::load_mut(&mut event_data_ref) };

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

    // Clear leaderboard
    for i in 0..EventAccount::MAX_LEADERBOARD {
        event_data.leaderboard[i] = LeaderboardEntry {
            player: NULL_PUBKEY,
            score: 0,
        };
    }

    Ok(())
}
