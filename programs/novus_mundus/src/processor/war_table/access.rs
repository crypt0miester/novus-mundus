//! Per-scope membership predicates for war-table posts.
//!
//! Each scope answers one question: is `sender_player` (owned by `sender_wallet`)
//! allowed to post to `thread`? The thread account itself is the scope PDA
//! (TeamAccount/RallyAccount/CastleAccount/EncounterAccount), except for DM where
//! no on-chain account exists and the thread key is verified against the derived
//! sorted-player-pair PDA.

use pinocchio::{AccountView, Address, ProgramResult};

use crate::constants::DM_THREAD_SEED;
use crate::error::GameError;
use crate::state::{
    AccountKey, CastleAccount, CourtPositionAccount, EncounterAccount,
    GarrisonContributionAccount, PlayerAccount, RallyAccount, RallyParticipant, TeamAccount,
};
use crate::validation::require_owner;

// Scope tags (must match the SDK WtScope enum and the §2 instruction layout).
pub const SCOPE_TEAM: u8 = 0;
pub const SCOPE_RALLY: u8 = 1;
pub const SCOPE_CASTLE: u8 = 2;
pub const SCOPE_ENCOUNTER: u8 = 3;
pub const SCOPE_DM: u8 = 4;

/// Verify that `sender_player` may post to `thread` under `scope`.
///
/// `gate` is the slice of accounts after index 2 (i.e. `accounts[3..]`). The
/// number of gate accounts required is scope-specific (see §2):
/// - Team:      0
/// - Rally:     1 (RallyParticipant PDA, keyed on WALLET)
/// - Castle:    0 (king) or 1 (GarrisonContribution / CourtPosition, keyed on PLAYER PDA)
/// - Encounter: 0
/// - DM:        2 (both participants' PlayerAccount PDAs)
pub fn require_in_scope(
    scope: u8,
    thread: &AccountView,
    sender_wallet: &AccountView,
    sender_player: &PlayerAccount,
    sender_player_key: &Address,
    gate: &[AccountView],
    program_id: &Address,
) -> ProgramResult {
    match scope {
        SCOPE_TEAM => team_predicate(thread, sender_player, program_id),
        SCOPE_RALLY => rally_predicate(thread, sender_wallet, gate, program_id),
        SCOPE_CASTLE => {
            castle_predicate(thread, sender_player_key, gate, program_id)
        }
        SCOPE_ENCOUNTER => encounter_predicate(thread, sender_player, program_id),
        SCOPE_DM => dm_predicate(thread, sender_wallet, gate, program_id),
        _ => Err(GameError::WtBadScope.into()),
    }
}

fn team_predicate(
    thread: &AccountView,
    sender_player: &PlayerAccount,
    program_id: &Address,
) -> ProgramResult {
    require_owner(thread, program_id)?;
    // Discriminator must be Team; cast verifies byte 0.
    unsafe { AccountKey::cast::<TeamAccount>(thread, AccountKey::Team, "TeamAccount")? };
    // The membership predicate: sender's stored team_address equals this thread.
    if sender_player.team_address() != *thread.address() {
        return Err(GameError::WtNotInScope.into());
    }
    Ok(())
}

fn rally_predicate(
    thread: &AccountView,
    sender_wallet: &AccountView,
    gate: &[AccountView],
    program_id: &Address,
) -> ProgramResult {
    require_owner(thread, program_id)?;
    let rally =
        unsafe { AccountKey::cast::<RallyAccount>(thread, AccountKey::Rally, "RallyAccount")? };

    if gate.is_empty() {
        return Err(GameError::WtNotInScope.into());
    }
    let participant_account = &gate[0];
    // RallyParticipant PDA is keyed on the WALLET (not player PDA), seeds:
    // [RALLY_PARTICIPANT_SEED, game_engine, rally_creator, rally_id, sender_wallet].
    let participant = RallyParticipant::load_checked(
        participant_account,
        &rally.game_engine,
        &rally.creator,
        rally.id,
        sender_wallet.address(),
        program_id,
    )?;
    // A participant who has already returned home is no longer in scope.
    if participant.returned {
        return Err(GameError::WtNotInScope.into());
    }
    Ok(())
}

fn castle_predicate(
    thread: &AccountView,
    sender_player_key: &Address,
    gate: &[AccountView],
    program_id: &Address,
) -> ProgramResult {
    require_owner(thread, program_id)?;
    let castle =
        unsafe { AccountKey::cast::<CastleAccount>(thread, AccountKey::Castle, "CastleAccount")? };

    // King branch: no gate account. The castle king field stores the king's
    // PlayerAccount PDA, so compare against sender_player_key.
    if gate.is_empty() {
        if castle.king == *sender_player_key {
            return Ok(());
        }
        return Err(GameError::WtNotInScope.into());
    }

    // Otherwise the gate[0] account discriminates garrison vs court membership.
    // v1 castle scope access = king OR garrison OR court position only. An
    // "active attacker" branch is undeliverable: attack_castle.rs resolves
    // combat instantaneously with no persistent attacker record (open risk O6).
    let gate0 = &gate[0];
    require_owner(gate0, program_id)?;
    // Guard the raw 1-byte discriminator read against a zero-length account.
    // Defense in depth: program-owned gate accounts are always full-size, but
    // never read past the buffer.
    if gate0.data_len() == 0 {
        return Err(GameError::WtNotInScope.into());
    }
    let disc = unsafe { *gate0.data_ptr() };

    if disc == AccountKey::CastleGarrison as u8 {
        // GarrisonContributionAccount PDA seeds: [GARRISON_SEED, castle_pda, sender_player_pda].
        let garrison = unsafe {
            AccountKey::cast::<GarrisonContributionAccount>(
                gate0,
                AccountKey::CastleGarrison,
                "GarrisonContributionAccount",
            )?
        };
        if garrison.castle != *thread.address() {
            return Err(GameError::WtNotInScope.into());
        }
        let (expected_pda, _bump) =
            GarrisonContributionAccount::derive_pda(thread.address(), sender_player_key);
        if gate0.address() != &expected_pda {
            return Err(GameError::WtNotInScope.into());
        }
        return Ok(());
    }

    if disc == AccountKey::CourtPosition as u8 {
        let court = unsafe {
            AccountKey::cast::<CourtPositionAccount>(
                gate0,
                AccountKey::CourtPosition,
                "CourtPositionAccount",
            )?
        };
        // Court position must belong to this castle and be held by the sender's
        // PlayerAccount. The court PDA is keyed on (castle, position_type), so we
        // verify both the castle linkage and the holder.
        if court.castle != *thread.address() {
            return Err(GameError::WtNotInScope.into());
        }
        let (expected_pda, _bump) =
            CourtPositionAccount::derive_pda(thread.address(), court.position_type);
        if gate0.address() != &expected_pda {
            return Err(GameError::WtNotInScope.into());
        }
        if court.holder != *sender_player_key {
            return Err(GameError::WtNotInScope.into());
        }
        return Ok(());
    }

    Err(GameError::WtNotInScope.into())
}

fn encounter_predicate(
    thread: &AccountView,
    sender_player: &PlayerAccount,
    program_id: &Address,
) -> ProgramResult {
    require_owner(thread, program_id)?;
    let encounter = unsafe {
        AccountKey::cast::<EncounterAccount>(thread, AccountKey::Encounter, "EncounterAccount")?
    };
    // Anyone in the same kingdom as the encounter may coordinate around it.
    if !sender_player.is_in_kingdom(&encounter.game_engine) {
        return Err(GameError::WtNotInScope.into());
    }
    Ok(())
}

fn dm_predicate(
    thread: &AccountView,
    sender_wallet: &AccountView,
    gate: &[AccountView],
    program_id: &Address,
) -> ProgramResult {
    if gate.len() < 2 {
        return Err(GameError::WtNotInScope.into());
    }
    // BC3: load BOTH gate accounts as program-owned PlayerAccounts BEFORE reading
    // their owner. A crafted, non-program-owned account whose owner-offset bytes
    // hold an arbitrary wallet could otherwise forge DM membership.
    let player_a = PlayerAccount::load_checked_by_key(&gate[0], program_id)?;
    let player_b = PlayerAccount::load_checked_by_key(&gate[1], program_id)?;

    // Re-derive the pair PDA from the two loaded PlayerAccount keys and require it
    // equals the thread key (the DM thread has no on-chain account; this binds the
    // thread to exactly this player pair).
    let a = gate[0].address().as_ref();
    let b = gate[1].address().as_ref();
    if a == b {
        return Err(GameError::WtNotInScope.into());
    }
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    let (expected_pda, _bump) =
        Address::find_program_address(&[DM_THREAD_SEED, lo, hi], program_id);
    if thread.address() != &expected_pda {
        return Err(GameError::WtThreadPdaMismatch.into());
    }

    // The signer must own one of the two participant PlayerAccounts.
    let wallet = sender_wallet.address();
    if !player_a.is_owner(wallet) && !player_b.is_owner(wallet) {
        return Err(GameError::WtNotInScope.into());
    }
    Ok(())
}
