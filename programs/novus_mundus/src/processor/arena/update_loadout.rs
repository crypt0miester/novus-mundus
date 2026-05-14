//! Update Arena Loadout (Instruction 202)
//!
//! Player updates their arena loadout configuration. Does NOT validate against
//! current assets - that happens in validate_loadout or at battle time.
//!
//! # Accounts
//! 0. `[WRITE]` loadout_account: ArenaLoadoutAccount PDA
//! 1. `[SIGNER]` player_authority: Player's wallet

use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
};

use crate::{
    state::{ArenaLoadoutAccount, PlayerCore},
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
    let [
        loadout_account,
        player_authority,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_signer(player_authority)?;

    // 3. Parse Instruction Data (88 bytes minimum)
    if instruction_data.len() < 88 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut hero_bytes = [0u8; 32];
    hero_bytes.copy_from_slice(&instruction_data[0..32]);
    let arena_hero = Address::from(hero_bytes);

    let defensive_units_0 = u64::from_le_bytes([
        instruction_data[32], instruction_data[33], instruction_data[34], instruction_data[35],
        instruction_data[36], instruction_data[37], instruction_data[38], instruction_data[39],
    ]);
    let defensive_units_1 = u64::from_le_bytes([
        instruction_data[40], instruction_data[41], instruction_data[42], instruction_data[43],
        instruction_data[44], instruction_data[45], instruction_data[46], instruction_data[47],
    ]);
    let defensive_units_2 = u64::from_le_bytes([
        instruction_data[48], instruction_data[49], instruction_data[50], instruction_data[51],
        instruction_data[52], instruction_data[53], instruction_data[54], instruction_data[55],
    ]);

    let melee_weapons = u64::from_le_bytes([
        instruction_data[56], instruction_data[57], instruction_data[58], instruction_data[59],
        instruction_data[60], instruction_data[61], instruction_data[62], instruction_data[63],
    ]);
    let ranged_weapons = u64::from_le_bytes([
        instruction_data[64], instruction_data[65], instruction_data[66], instruction_data[67],
        instruction_data[68], instruction_data[69], instruction_data[70], instruction_data[71],
    ]);
    let siege_weapons = u64::from_le_bytes([
        instruction_data[72], instruction_data[73], instruction_data[74], instruction_data[75],
        instruction_data[76], instruction_data[77], instruction_data[78], instruction_data[79],
    ]);
    let armor_pieces = u64::from_le_bytes([
        instruction_data[80], instruction_data[81], instruction_data[82], instruction_data[83],
        instruction_data[84], instruction_data[85], instruction_data[86], instruction_data[87],
    ]);

    // 4. Load and validate Loadout (using by_key for kingdom scoping)
    let mut loadout = ArenaLoadoutAccount::load_checked_mut_by_key(
        loadout_account,
        program_id,
    )?;
    // Verify player authority matches (loadout.player stores the PlayerCore PDA,
    // so derive it from wallet key + game_engine to compare)
    let (expected_player_pda, _) = PlayerCore::derive_pda(&loadout.game_engine, player_authority.address());
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
