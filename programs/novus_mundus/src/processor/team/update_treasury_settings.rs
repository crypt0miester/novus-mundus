use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, TeamMemberSlot, require_extension, EXT_TEAM, NULL_PUBKEY},
    validation::{require_signer, require_writable, require_owner},
    emit,
    events::TreasurySettingsUpdated,
};

/// Update team treasury security settings (leader only)
///
/// Leader can configure:
/// - Instant withdrawal limits per rank (4 values for ranks 1-4)
/// - Daily withdrawal caps per rank (4 values for ranks 1-4)
/// - Cooldown hours for large withdrawals (1-72 hours)
///
/// # Accounts
/// - [] leader_player: PlayerAccount (leader)
/// - [] leader_slot: TeamMemberSlot (to verify leader rank)
/// - [writable] team: TeamAccount
/// - [signer] leader_owner: Leader's wallet
///
/// # Instruction Data
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
/// - slot_index: u16 (2 bytes) - Leader's slot index
/// - instant_limits: [u64; 4] (32 bytes) - New instant limits for ranks 1-4
/// - daily_caps: [u64; 4] (32 bytes) - New daily caps for ranks 1-4
/// - cooldown_hours: u8 (1 byte) - New cooldown (1-72 hours)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    if instruction_data.len() < 75 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let team_id = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());
    let slot_index = u16::from_le_bytes(instruction_data[8..10].try_into().unwrap());

    // Parse instant limits array
    let mut instant_limits = [0u64; 4];
    for i in 0..4 {
        let start = 10 + i * 8;
        instant_limits[i] = u64::from_le_bytes(instruction_data[start..start + 8].try_into().unwrap());
    }

    // Parse daily caps array
    let mut daily_caps = [0u64; 4];
    for i in 0..4 {
        let start = 42 + i * 8;
        daily_caps[i] = u64::from_le_bytes(instruction_data[start..start + 8].try_into().unwrap());
    }

    let cooldown_hours = instruction_data[74];

    // Validate cooldown hours
    if cooldown_hours < TeamAccount::MIN_COOLDOWN_HOURS || cooldown_hours > TeamAccount::MAX_COOLDOWN_HOURS {
        return Err(GameError::InvalidCooldownHours.into());
    }

    // 2. Parse Accounts

    let [
        leader_account,
        leader_slot_account,
        team_account,
        leader_owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 3. Validate Accounts

    require_signer(leader_owner)?;
    require_writable(team_account)?;

    // 4. Load Accounts

    let leader = PlayerAccount::load_checked(leader_account, leader_owner.key(), program_id)?;
    let mut team = TeamAccount::load_checked_mut(team_account, team_id, program_id)?;

    // 4a. Require EXT_TEAM
    require_extension(&*leader, EXT_TEAM)?;

    // 5. Validate Leader is in Team

    if leader.team == NULL_PUBKEY || &leader.team != team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    // Team not disbanded
    if team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    // 6. Verify Leader Slot and Rank

    let (expected_slot, _) = TeamMemberSlot::derive_pda(team_account.key(), slot_index);
    if leader_slot_account.key() != &expected_slot {
        return Err(GameError::InvalidPDA.into());
    }

    require_owner(leader_slot_account, program_id)?;

    {
        let slot_data = leader_slot_account.try_borrow_data()?;
        let slot = unsafe { TeamMemberSlot::load(&slot_data) };

        if slot.player != *leader_account.key() {
            return Err(GameError::NotSlotOwner.into());
        }

        // Only leader (RANK_0) can update treasury settings
        if slot.rank != TeamMemberSlot::RANK_0 {
            return Err(GameError::InsufficientTeamPermissions.into());
        }
    }

    // 7. Update Treasury Settings

    team.treasury_instant_limit = instant_limits;
    team.treasury_daily_cap = daily_caps;
    team.treasury_cooldown_hours = cooldown_hours;

    // 8. Update Team Activity

    let clock = Clock::get()?;
    team.last_activity = clock.unix_timestamp;

    // 9. Emit Event

    emit!(TreasurySettingsUpdated {
        team: *team_account.key(),
        updated_by: *leader_account.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
