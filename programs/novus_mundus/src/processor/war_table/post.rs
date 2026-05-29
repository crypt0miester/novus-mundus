//! Post a war-table message (instruction 323).
//!
//! Log-only: validates membership + envelope, then emits the raw envelope via
//! `sol_log_data`. No account state is written and no lamports move.

use pinocchio::{AccountView, Address, ProgramResult};

use super::access::{
    self, SCOPE_CASTLE, SCOPE_DM, SCOPE_ENCOUNTER, SCOPE_RALLY, SCOPE_TEAM,
};
use crate::error::GameError;
use crate::state::{AccountKey, CastleAccount, PlayerAccount, RallyAccount, TeamAccount};
use crate::validation::require_signer;

// Envelope wire-format constants (§1 canonical offset table).
const WT_MAGIC: [u8; 3] = [0x77, 0x74, 0x31]; // b"wt1"
const WT_HEADER_OVERHEAD: usize = 98;
const WT_FLAGS_OFFSET: usize = 3;
const WT_THREAD_PDA_RANGE: core::ops::Range<usize> = 4..36;
const WT_SENDER_WALLET_RANGE: core::ops::Range<usize> = 36..68;
const WT_KEY_VERSION_RANGE: core::ops::Range<usize> = 68..72;
const WT_BODY_NONCE_RANGE: core::ops::Range<usize> = 72..96;
const WT_BODY_LEN_RANGE: core::ops::Range<usize> = 96..98;

const FLAG_ENCRYPTED: u8 = 1;

/// Account layout (§2 canonical list):
/// 0 thread          (no signer, no write) target thread PDA
/// 1 sender_wallet   (SIGNER, no write)    signing wallet
/// 2 sender_player   (no signer, no write) sender's PlayerAccount PDA
/// 3 gate_0          (scope-specific; absent for Team/Encounter)
/// 4 gate_1          (DM only)
///
/// Instruction data (discriminator already stripped by the dispatcher):
/// byte 0  = scope: u8
/// byte 1.. = the full wt1 envelope
pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    if accounts.len() < 3 {
        return Err(GameError::WtNotInScope.into());
    }
    let thread = &accounts[0];
    let sender_wallet = &accounts[1];
    let sender_player_account = &accounts[2];

    // 1. sender_wallet must sign.
    require_signer(sender_wallet)?;

    // 2. scope tag.
    if data.is_empty() {
        return Err(GameError::WtBadScope.into());
    }
    let scope = data[0];
    if scope > SCOPE_DM {
        return Err(GameError::WtBadScope.into());
    }

    // 3. envelope blob.
    let envelope = &data[1..];

    // 4. validate envelope shape (§1 steps 1-6).
    if envelope.len() < WT_HEADER_OVERHEAD {
        return Err(GameError::WtBodyLenMismatch.into());
    }
    if envelope[0..3] != WT_MAGIC {
        return Err(GameError::WtBadMagic.into());
    }
    if envelope[WT_THREAD_PDA_RANGE] != *thread.address().as_ref() {
        return Err(GameError::WtThreadPdaMismatch.into());
    }
    if envelope[WT_SENDER_WALLET_RANGE] != *sender_wallet.address().as_ref() {
        return Err(GameError::WtSenderMismatch.into());
    }
    let key_version = u32::from_le_bytes([
        envelope[WT_KEY_VERSION_RANGE.start],
        envelope[WT_KEY_VERSION_RANGE.start + 1],
        envelope[WT_KEY_VERSION_RANGE.start + 2],
        envelope[WT_KEY_VERSION_RANGE.start + 3],
    ]);
    let body_len =
        u16::from_le_bytes([envelope[WT_BODY_LEN_RANGE.start], envelope[WT_BODY_LEN_RANGE.start + 1]])
            as usize;
    let expected_len = WT_HEADER_OVERHEAD
        .checked_add(body_len)
        .ok_or(GameError::WtBodyLenMismatch)?;
    if envelope.len() != expected_len {
        return Err(GameError::WtBodyLenMismatch.into());
    }

    let flags = envelope[WT_FLAGS_OFFSET];

    // 5. Load sender PlayerAccount (program-owned + canonical PDA from stored owner).
    let sender_player = PlayerAccount::load_checked_by_key(sender_player_account, program_id)?;

    // 6. sender_player.owner must be the signing wallet.
    if !sender_player.is_owner(sender_wallet.address()) {
        return Err(GameError::Unauthorized.into());
    }

    // 7. Scope membership predicate (§2 canonical account list). This also
    // verifies the thread account discriminator for scopes 0-3 (the cast inside
    // each predicate); DM verifies the thread key against the derived pair PDA.
    let gate = &accounts[3..];
    access::require_in_scope(
        scope,
        thread,
        sender_wallet,
        sender_player,
        sender_player_account.address(),
        gate,
        program_id,
    )?;

    // 8. key_version rule (§5) + encrypted-flag invariant (BC2).
    enforce_key_version(scope, thread, key_version, flags, envelope, program_id)?;

    // 9. Emit the raw envelope as a single base64 log datum (TASK C14).
    // No discriminator prefix; off-chain readers key on the `wt1` magic.
    #[cfg(target_os = "solana")]
    {
        let slices: [&[u8]; 1] = [envelope];
        unsafe {
            pinocchio::syscalls::sol_log_data(slices.as_ptr() as *const u8, slices.len() as u64);
        }
    }
    #[cfg(not(target_os = "solana"))]
    {
        let _ = envelope;
    }

    Ok(())
}

/// Enforce the per-scope `key_version` rule and the encrypted-flag invariant.
fn enforce_key_version(
    scope: u8,
    thread: &AccountView,
    key_version: u32,
    flags: u8,
    envelope: &[u8],
    program_id: &Address,
) -> ProgramResult {
    match scope {
        SCOPE_TEAM => {
            let team = read_team_epoch(thread, program_id)?;
            if key_version != team {
                return Err(GameError::WtKeyVersionMismatch.into());
            }
            require_encrypted(flags)
        }
        SCOPE_RALLY => {
            let epoch = read_rally_epoch(thread, program_id)?;
            if key_version != epoch {
                return Err(GameError::WtKeyVersionMismatch.into());
            }
            require_encrypted(flags)
        }
        SCOPE_CASTLE => {
            let epoch = read_castle_epoch(thread, program_id)?;
            if key_version != epoch {
                return Err(GameError::WtKeyVersionMismatch.into());
            }
            require_encrypted(flags)
        }
        SCOPE_ENCOUNTER => {
            // Encounter is plaintext only: key_version == 0, flags bit0 == 0,
            // and the body nonce must be all-zero (§1 step 8).
            if key_version != 0 {
                return Err(GameError::WtKeyVersionMismatch.into());
            }
            if flags & FLAG_ENCRYPTED != 0 {
                return Err(GameError::WtKeyVersionMismatch.into());
            }
            if envelope[WT_BODY_NONCE_RANGE] != [0u8; 24] {
                return Err(GameError::WtKeyVersionMismatch.into());
            }
            Ok(())
        }
        SCOPE_DM => {
            // DM key_version is the constant 1 (no epoch).
            if key_version != 1 {
                return Err(GameError::WtKeyVersionMismatch.into());
            }
            require_encrypted(flags)
        }
        _ => Err(GameError::WtBadScope.into()),
    }
}

/// BC2: encrypted scopes (Team/Rally/Castle/DM) MUST set flags bit0 == 1, so the
/// plaintext-vs-encrypted distinction is unambiguous and chain-enforced.
#[inline]
fn require_encrypted(flags: u8) -> ProgramResult {
    if flags & FLAG_ENCRYPTED == 0 {
        return Err(GameError::WtEncryptedFlagRequired.into());
    }
    Ok(())
}

fn read_team_epoch(thread: &AccountView, program_id: &Address) -> Result<u32, pinocchio::error::ProgramError> {
    crate::validation::require_owner(thread, program_id)?;
    let team = unsafe { AccountKey::cast::<TeamAccount>(thread, AccountKey::Team, "TeamAccount")? };
    Ok(team.membership_epoch)
}

fn read_rally_epoch(thread: &AccountView, program_id: &Address) -> Result<u32, pinocchio::error::ProgramError> {
    crate::validation::require_owner(thread, program_id)?;
    let rally =
        unsafe { AccountKey::cast::<RallyAccount>(thread, AccountKey::Rally, "RallyAccount")? };
    Ok(rally.membership_epoch)
}

fn read_castle_epoch(thread: &AccountView, program_id: &Address) -> Result<u32, pinocchio::error::ProgramError> {
    crate::validation::require_owner(thread, program_id)?;
    let castle =
        unsafe { AccountKey::cast::<CastleAccount>(thread, AccountKey::Castle, "CastleAccount")? };
    Ok(castle.membership_epoch)
}
