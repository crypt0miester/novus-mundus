//! Update Arena Loadout (Instruction 202)
//!
//! Player updates their arena loadout configuration. Does NOT validate against
//! current assets - that happens in validate_loadout or at battle time.
//!
//! # Accounts
//! 0. `[WRITE]` loadout_account: ArenaLoadoutAccount PDA
//! 1. `[SIGNER]` player_authority: Player's wallet

use pinocchio::{AccountView, Address, ProgramResult};

use crate::{
    state::{ArenaLoadoutAccount, PlayerCore},
    utils::{read_bytes32, read_u64},
    validation::require_signer,
};

/// Instruction data for update_loadout
/// - arena_hero: Address (32 bytes) - Hero mint, or default pubkey for no hero
/// - defensive_units: [u64; 3] (24 bytes) - Tier 1, 2, 3 units
/// - melee_weapons: u64 (8 bytes)
/// - ranged_weapons: u64 (8 bytes)
/// - siege_weapons: u64 (8 bytes)
/// - armor_pieces: u64 (8 bytes)
/// Total: 88 bytes
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [
        loadout_account,
        player_authority,
    ]);

    // 2. Validate Accounts
    require_signer(player_authority)?;

    // 3. Parse Instruction Data (88 bytes minimum)
    let arena_hero = Address::from(read_bytes32(
        instruction_data,
        0,
        "update_loadout.arena_hero",
    )?);

    let defensive_units_0 = read_u64(instruction_data, 32, "update_loadout.defensive_units_0")?;
    let defensive_units_1 = read_u64(instruction_data, 40, "update_loadout.defensive_units_1")?;
    let defensive_units_2 = read_u64(instruction_data, 48, "update_loadout.defensive_units_2")?;

    let melee_weapons = read_u64(instruction_data, 56, "update_loadout.melee_weapons")?;
    let ranged_weapons = read_u64(instruction_data, 64, "update_loadout.ranged_weapons")?;
    let siege_weapons = read_u64(instruction_data, 72, "update_loadout.siege_weapons")?;
    let armor_pieces = read_u64(instruction_data, 80, "update_loadout.armor_pieces")?;

    // 4. Load and validate Loadout (using by_key for kingdom scoping)
    let loadout = ArenaLoadoutAccount::load_checked_mut_by_key(loadout_account, program_id)?;
    // Verify player authority matches (loadout.player stores the PlayerCore PDA,
    // so derive it from wallet key + game_engine to compare)
    let (expected_player_pda, _) =
        PlayerCore::derive_pda(&loadout.game_engine, player_authority.address());
    if loadout.player != expected_player_pda {
        return Err(crate::error::GameError::Unauthorized.into());
    }

    // 5. Update loadout (validation happens at battle time in challenge_player)
    loadout.arena_hero = arena_hero;
    loadout.defensive_units[0] = defensive_units_0;
    loadout.defensive_units[1] = defensive_units_1;
    loadout.defensive_units[2] = defensive_units_2;
    loadout.melee_weapons = melee_weapons;
    loadout.ranged_weapons = ranged_weapons;
    loadout.siege_weapons = siege_weapons;
    loadout.armor_pieces = armor_pieces;

    Ok(())
}
