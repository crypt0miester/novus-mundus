use pinocchio::{AccountView, Address, ProgramResult};

use crate::{
    error::GameError,
    state::{require_extension, PlayerAccount, EXT_COSMETICS},
    utils::{read_u16, read_u8},
    validation::{require_signer, require_writable},
};

/// Cosmetic kind discriminants — match the order of the `equipped_*`
/// fields on `CosmeticsSection` and the catalog kinds in
/// apps/web/src/lib/config/cosmetics-catalog.ts.
const KIND_AVATAR_FRAME: u8 = 0;
const KIND_NAME_COLOR: u8 = 1;
const KIND_TITLE: u8 = 2;
const KIND_BADGE: u8 = 3;
const KIND_ATTACK_EFFECT: u8 = 4;
const KIND_VICTORY_POSE: u8 = 5;

/// Per-kind ownership bitmask is u64 → max 64 IDs per kind.
const COSMETIC_ID_CAP: u16 = 64;

/// Equip a cosmetic (322).
///
/// Validates the player owns the requested cosmetic via the
/// `owned_<kind>` bitmask, then sets `equipped_<kind> = id`. ID 0 is
/// reserved as "nothing equipped" and is always permitted (lets the
/// player unequip without owning ID 0).
///
/// # Accounts
/// - [signer]   owner:          Player wallet
/// - [writable] player_account: PlayerAccount PDA
///
/// # Instruction Data
/// - [0] kind: u8 (0=frame, 1=color, 2=title, 3=badge, 4=effect, 5=pose)
/// - [1..3] id: u16 (little-endian; 0 = unequip)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    crate::extract_accounts!(accounts, exact [owner, player_account]);

    require_signer(owner)?;
    require_writable(player_account)?;

    let kind = read_u8(instruction_data, 0, "equip_cosmetic.kind")?;
    let id = read_u16(instruction_data, 1, "equip_cosmetic.id")?;

    // u64 bitmask cap; reject anything that wouldn't fit. id=0 is the
    // "unequip" sentinel and always passes.
    if id >= COSMETIC_ID_CAP {
        return Err(GameError::InvalidParameter.into());
    }

    // `load_checked_mut_by_key` is the defensive load: it validates that the
    // account is program-owned, has the Player discriminator, and matches the
    // canonical PDA derived from its own stored (game_engine, owner, bump).
    // The previous raw `load_mut + is_owner` skipped discriminator + PDA
    // checks, leaving a (small) tampered-account surface where a program-
    // owned writable buffer whose bytes 33–64 matched the signer would be
    // mistaken for a PlayerAccount and have cosmetic fields written into it.
    let player = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;

    if !player.is_owner(owner.address()) {
        return Err(GameError::Unauthorized.into());
    }
    require_extension(player, EXT_COSMETICS)?;

    let cosmetics = player
        .cosmetics_mut()
        .ok_or(GameError::CosmeticsNotUnlocked)?;

    // Ownership check — bit must be set unless we're unequipping (id=0).
    // Using a separate const lets the per-kind branch stay flat.
    let owned_bit_set = id == 0
        || match kind {
            KIND_AVATAR_FRAME => (cosmetics.owned_frames >> id) & 1 == 1,
            KIND_NAME_COLOR => (cosmetics.owned_colors >> id) & 1 == 1,
            KIND_TITLE => (cosmetics.owned_titles >> id) & 1 == 1,
            KIND_BADGE => (cosmetics.owned_badges >> id) & 1 == 1,
            KIND_ATTACK_EFFECT => (cosmetics.owned_effects >> id) & 1 == 1,
            KIND_VICTORY_POSE => (cosmetics.owned_poses >> id) & 1 == 1,
            _ => return Err(GameError::InvalidParameter.into()),
        };

    if !owned_bit_set {
        return Err(GameError::CosmeticNotOwned.into());
    }

    match kind {
        KIND_AVATAR_FRAME => cosmetics.equipped_avatar_frame = id,
        KIND_NAME_COLOR => cosmetics.equipped_name_color = id,
        KIND_TITLE => cosmetics.equipped_title = id,
        KIND_BADGE => cosmetics.equipped_badge = id,
        KIND_ATTACK_EFFECT => cosmetics.equipped_attack_effect = id,
        KIND_VICTORY_POSE => cosmetics.equipped_victory_pose = id,
        _ => return Err(GameError::InvalidParameter.into()),
    }

    Ok(())
}
