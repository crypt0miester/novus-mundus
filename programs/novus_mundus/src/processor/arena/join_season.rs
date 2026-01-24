//! Join Arena Season (Instruction 201)
//!
//! Player joins an active arena season. Creates participant account and loadout if needed.
//!
//! # Accounts
//! 0. `[WRITE]` arena_season: ArenaSeasonAccount PDA
//! 1. `[WRITE]` participant_account: ArenaParticipantAccount PDA (to be created)
//! 2. `[WRITE]` loadout_account: ArenaLoadoutAccount PDA (created if doesn't exist)
//! 3. `[]` player_account: PlayerAccount
//! 4. `[SIGNER, WRITE]` player_authority: Player's wallet (pays rent)
//! 5. `[]` system_program: System program

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{ARENA_PARTICIPANT_SEED, ARENA_LOADOUT_SEED, ARENA_STARTING_ELO},
    error::GameError,
    state::{
        ArenaSeasonAccount, ArenaParticipantAccount, ArenaLoadoutAccount, ArenaStatus,
        PlayerAccount, ARENA_PARTICIPANT_ACCOUNT_SIZE, ARENA_LOADOUT_ACCOUNT_SIZE,
    },
    validation::{require_signer, require_writable, require_key_match, require_owner, require_data_len},
};

/// Instruction data for join_season
/// - season_id: u32 (4 bytes)
/// Total: 4 bytes
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [
        arena_season,
        participant_account,
        loadout_account,
        player_account,
        player_authority,
        system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_signer(player_authority)?;
    require_writable(player_authority)?;
    require_writable(arena_season)?;
    require_writable(participant_account)?;
    require_writable(loadout_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data (4 bytes minimum)
    if instruction_data.len() < 4 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let season_id = u32::from_le_bytes([
        instruction_data[0], instruction_data[1],
        instruction_data[2], instruction_data[3],
    ]);

    // 4. Load Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 5. Load and validate Player
    let player = PlayerAccount::load_checked(player_account, player_authority.key(), program_id)?;
    let player_key = *player_account.key();
    let player_level = player.level;
    drop(player);

    // 6. Load and validate Arena Season
    require_owner(arena_season, program_id)?;
    require_data_len(arena_season, ArenaSeasonAccount::LEN)?;
    let season_data = arena_season.try_borrow_data()?;
    let season_ptr = season_data.as_ptr() as *const ArenaSeasonAccount;
    let season = unsafe { &*season_ptr };

    // Validate season_id matches
    if season.season_id != season_id {
        return Err(GameError::InvalidParameter.into());
    }

    // Season must be Active
    if season.status != ArenaStatus::Active as u8 {
        return Err(GameError::ArenaSeasonNotActive.into());
    }

    // Season must not have ended
    if now >= season.end_time {
        return Err(GameError::ArenaSeasonExpired.into());
    }

    // Player must meet minimum level requirement
    if player_level < season.min_level_required {
        return Err(GameError::InsufficientLevel.into());
    }

    let season_authority = season.authority;
    drop(season_data);

    // 7. Verify participant account doesn't already exist
    let (expected_participant_pda, participant_bump) =
        ArenaParticipantAccount::derive_pda(&season_authority, season_id, player_authority.key());
    if participant_account.key() != &expected_participant_pda {
        return Err(GameError::InvalidPDA.into());
    }

    if !participant_account.data_is_empty() {
        return Err(GameError::ArenaParticipantAlreadyExists.into());
    }

    // 8. Create Participant Account
    let rent = Rent::get()?;
    let participant_lamports = rent.minimum_balance(ARENA_PARTICIPANT_ACCOUNT_SIZE);

    let participant_bump_seed = [participant_bump];
    let season_id_bytes = season_id.to_le_bytes();
    let participant_seeds = pinocchio::seeds!(
        ARENA_PARTICIPANT_SEED,
        season_authority.as_ref(),
        &season_id_bytes,
        player_authority.key().as_ref(),
        &participant_bump_seed
    );
    let participant_signer = pinocchio::instruction::Signer::from(&participant_seeds);

    CreateAccount {
        from: player_authority,
        to: participant_account,
        lamports: participant_lamports,
        space: ARENA_PARTICIPANT_ACCOUNT_SIZE as u64,
        owner: program_id,
    }.invoke_signed(&[participant_signer])?;

    // 9. Initialize Participant Account
    let mut participant_data_ref = participant_account.try_borrow_mut_data()?;
    let participant = unsafe { ArenaParticipantAccount::load_mut(&mut participant_data_ref) };

    *participant = ArenaParticipantAccount {
        player: player_key,
        season_id,
        battle_timestamps: [0i64; 10],
        battle_opponents: [Pubkey::default(); 10],
        battle_index: 0,
        last_match_id: 0,
        daily_reward_claimed_day: 0,
        elo_rating: ARENA_STARTING_ELO,
        total_points: 0,
        wins: 0,
        losses: 0,
        master_reward_claimed: false,
        bump: participant_bump,
        _reserved: [0; 17],
    };

    drop(participant_data_ref);

    // 10. Create Loadout Account if it doesn't exist (reusable across seasons)
    let (expected_loadout_pda, loadout_bump) =
        ArenaLoadoutAccount::derive_pda(player_authority.key());
    if loadout_account.key() != &expected_loadout_pda {
        return Err(GameError::InvalidPDA.into());
    }

    if loadout_account.data_is_empty() {
        // Create new loadout account
        let loadout_lamports = rent.minimum_balance(ARENA_LOADOUT_ACCOUNT_SIZE);

        let loadout_bump_seed = [loadout_bump];
        let loadout_seeds = pinocchio::seeds!(
            ARENA_LOADOUT_SEED,
            player_authority.key().as_ref(),
            &loadout_bump_seed
        );
        let loadout_signer = pinocchio::instruction::Signer::from(&loadout_seeds);

        CreateAccount {
            from: player_authority,
            to: loadout_account,
            lamports: loadout_lamports,
            space: ARENA_LOADOUT_ACCOUNT_SIZE as u64,
            owner: program_id,
        }.invoke_signed(&[loadout_signer])?;

        // Initialize Loadout Account
        let mut loadout_data_ref = loadout_account.try_borrow_mut_data()?;
        let loadout = unsafe { ArenaLoadoutAccount::load_mut(&mut loadout_data_ref) };

        *loadout = ArenaLoadoutAccount {
            player: player_key,
            bump: loadout_bump,
            arena_hero: Pubkey::default(),
            defensive_units: [0; 3],
            melee_weapons: 0,
            ranged_weapons: 0,
            siege_weapons: 0,
            armor_pieces: 0,
            _reserved: [0; 7],
        };
    }

    Ok(())
}
