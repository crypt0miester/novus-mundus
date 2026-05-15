//! Appoint Court - King appoints a teammate to a court position
//!
//! Instruction 272
//!
//! King can appoint teammates to court positions, granting them buffs
//! and daily rewards. Creates CourtPositionAccount PDA.

use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
    sysvars::{clock::Clock, Sysvar},
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    emit,
    error::GameError,
    events::CourtAppointed,
    utils::read_u8,
    validation::{require_empty, require_owner, require_pda},
    state::{
        CastleAccount, CourtPositionAccount, PlayerAccount, CourtPosition,
        player::{EXT_COURT, COURT_OFFSET, CourtSection},
    },
    constants::{
        COURT_SEED, PLAYER_SEED, CASTLE_STATUS_CONTEST, CASTLE_STATUS_TRANSITIONING,
    },
};

/// Appoint Court instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)
/// - position_type: u8 (byte 6)

/// Accounts:
/// 0. [signer] King wallet
/// 1. [] King player account
/// 2. [writable] Castle account
/// 3. [writable] Appointee player account
/// 4. [writable] Court position account (PDA to create)
/// 5. [] System program

pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    crate::extract_accounts!(accounts, [
        king_wallet,
        king_account,
        castle_account,
        appointee_account,
        court_position_account,
        _system_program,
    ]);

    // Verify signer
    if !king_wallet.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Parse instruction data (city_id/castle_id from account)
    let position_type = read_u8(instruction_data, 0, "position_type")?;

    // Validate position type
    if CourtPosition::from_u8(position_type).is_none() {
        return Err(GameError::InvalidParameter.into());
    }

    // Load king player owner
    require_owner(king_account, program_id)?;

    // Load castle first to access its kingdom (game_engine) for PDA derivation
    let mut castle = CastleAccount::load_checked_mut_by_key(castle_account, program_id)?;

    // Verify caller is the king
    if castle.king != *king_account.address() {
        return Err(GameError::NotKing.into());
    }

    // Re-derive king PlayerAccount PDA against (castle.game_engine,
    // king_wallet) and require match. Without this, an attacker could pass a
    // forged king_account whose data is set up to spoof identity. Pairing with
    // the existing castle.king == king_account.address() check, this guarantees the
    // signer truly owns the PlayerAccount registered as king.
    require_pda(
        king_account,
        &[PLAYER_SEED, castle.game_engine.as_ref(), king_wallet.address().as_ref()],
        program_id,
    )?;

    {
        let king_data = king_account.try_borrow()?;
        let king = unsafe { PlayerAccount::load(&king_data) };

        if &king.owner != king_wallet.address() {
            return Err(GameError::Unauthorized.into());
        }
    }

    // Verify castle state allows court appointments
    if castle.status == CASTLE_STATUS_CONTEST || castle.status == CASTLE_STATUS_TRANSITIONING {
        return Err(GameError::CastleInContest.into());
    }

    // Verify castle tier supports court
    if castle.max_court == 0 {
        return Err(GameError::CastleTierNoCourt.into());
    }

    // Verify court not full
    if castle.court_count >= castle.max_court {
        // Check if Chambers upgrade needed
        if castle.chambers_level < 3 {
            return Err(GameError::CastleNeedsChambersUpgrade.into());
        }
        return Err(GameError::CourtPositionTaken.into());
    }

    // Verify court position PDA
    let (expected_court_pda, court_bump) = CourtPositionAccount::derive_pda(castle_account.address(), position_type);
    if court_position_account.address() != &expected_court_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify position not already taken
    require_empty(court_position_account).map_err(|_| GameError::CourtPositionTaken)?;

    // Load appointee
    require_owner(appointee_account, program_id)?;
    let mut appointee_data = appointee_account.try_borrow_mut()?;
    let appointee = unsafe { PlayerAccount::load_mut(&mut appointee_data) };

    // Verify appointee is on king's team
    if appointee.team_address() != castle.team {
        return Err(GameError::NotOnKingsTeam.into());
    }

    // Verify appointee is not the king
    if appointee_account.address() == king_account.address() {
        return Err(GameError::KingCannotHoldCourt.into());
    }

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Create court position account
    let lamports = crate::utils::rent_exempt_const(CourtPositionAccount::LEN);

    let position_byte = [position_type];
    let bump_seed = [court_bump];
    let seeds = crate::seeds!(
        COURT_SEED,
        castle_account.address(),
        &position_byte,
        &bump_seed
    );
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: king_wallet,
        to: court_position_account,
        lamports,
        space: CourtPositionAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // Initialize court position
    let mut court_data = court_position_account.try_borrow_mut()?;
    let court = unsafe { CourtPositionAccount::load_mut(&mut court_data) };

    court.account_key = crate::state::AccountKey::CourtPosition as u8;
    court.castle = *castle_account.address();
    court.position_type = position_type;
    court.bump = court_bump;
    court.holder = *appointee_account.address();
    court.appointed_at = now;

    // Copy appointee name and extensions before modifying data
    let mut appointee_name = [0u8; 48];
    appointee_name.copy_from_slice(&appointee.name);
    let appointee_extensions = appointee.extensions;
    let appointee_data_len = appointee_data.len();

    // Update appointee's court section (if extension exists)
    if appointee_extensions & EXT_COURT != 0 && appointee_data_len >= COURT_OFFSET + CourtSection::LEN {
        let court_ptr = appointee_data[COURT_OFFSET..].as_mut_ptr() as *mut CourtSection;
        let court_section = unsafe { &mut *court_ptr };
        court_section.set_position(*castle_account.address(), position_type);
    }

    // Update castle court count
    castle.court_count = castle.court_count.saturating_add(1);

    // Emit event
    emit!(CourtAppointed {
        castle: *castle_account.address(),
        castle_name: castle.name,
        appointee: *appointee_account.address(),
        appointee_name,
        position_type,
        appointed_by: *king_account.address(),
        timestamp: now,
    });

    Ok(())
}
