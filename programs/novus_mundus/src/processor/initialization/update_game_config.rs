use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    state::{
        GameEngine, GameCaps, EconomicConfig, GameplayConfig,
        SubscriptionTier, MintingConfig, ThemeModifierConfig,
        NoviPurchaseConfig, ArenaConfig, ExpeditionConfig,
        DungeonConfig, CastleConfig, CombatConfig,
    },
    validation::{require_signer, require_writable},
    error::GameError,
};

// Update flag bits — one per sub-config, applied in declaration order
const UPDATE_CAPS: u16 = 1 << 0;
const UPDATE_ECONOMIC: u16 = 1 << 1;
const UPDATE_GAMEPLAY: u16 = 1 << 2;
const UPDATE_SUBSCRIPTIONS: u16 = 1 << 3;
const UPDATE_MINTING: u16 = 1 << 4;
const UPDATE_THEME: u16 = 1 << 5;
const UPDATE_NOVI_PURCHASE: u16 = 1 << 6;
const UPDATE_ARENA: u16 = 1 << 7;
const UPDATE_EXPEDITION: u16 = 1 << 8;
const UPDATE_DUNGEON: u16 = 1 << 9;
const UPDATE_CASTLE: u16 = 1 << 10;
const UPDATE_COMBAT: u16 = 1 << 11;

/// Update GameEngine sub-configurations
///
/// Allows DAO authority to selectively update any GameEngine sub-config.
/// Uses a u16 bitfield to indicate which configs are being updated.
/// Only the configs with their corresponding bit set need to be included
/// in instruction data, in order of bit position.
///
/// Each config is sent as raw #[repr(C)] bytes matching the struct layout.
///
/// # Accounts
/// - [writable] game_engine: GameEngine PDA
/// - [signer] authority: DAO governance authority
///
/// # Instruction Data
/// - update_flags: u16 (bitfield)
/// - For each set bit (in order): raw struct bytes
///
/// # Bit Assignments
/// 0: GameCaps, 1: EconomicConfig, 2: GameplayConfig,
/// 3: SubscriptionTiers ([SubscriptionTier; 4]),
/// 4: MintingConfig, 5: ThemeModifierConfig, 6: NoviPurchaseConfig,
/// 7: ArenaConfig, 8: ExpeditionConfig, 9: DungeonConfig,
/// 10: CastleConfig, 11: CombatConfig
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Need at least 2 bytes for update_flags
    if data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let update_flags = u16::from_le_bytes([data[0], data[1]]);

    if update_flags == 0 {
        return Err(ProgramError::InvalidInstructionData);
    }

    // Parse accounts
    let [game_engine_account, authority] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(authority)?;
    require_writable(game_engine_account)?;

    // Verify ownership
    if game_engine_account.owner() != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    // Load GameEngine mutably
    let mut game_engine_data = game_engine_account.try_borrow_mut_data()?;
    let engine = unsafe { GameEngine::load_mut(&mut game_engine_data) };

    // Verify DAO authority
    if engine.authority != *authority.key() {
        return Err(GameError::Unauthorized.into());
    }

    // Track read offset past update_flags
    let mut offset = 2usize;

    // Helper: copy raw bytes into a struct field
    macro_rules! apply_update {
        ($flag:expr, $field:expr, $ty:ty) => {
            if update_flags & $flag != 0 {
                let size = core::mem::size_of::<$ty>();
                if offset.saturating_add(size) > data.len() {
                    return Err(ProgramError::InvalidInstructionData);
                }
                unsafe {
                    core::ptr::copy_nonoverlapping(
                        data[offset..].as_ptr(),
                        &mut $field as *mut $ty as *mut u8,
                        size,
                    );
                }
                offset += size;
            }
        };
    }

    // Apply updates in bit order (must match GameEngine field order)
    apply_update!(UPDATE_CAPS, engine.caps, GameCaps);
    apply_update!(UPDATE_ECONOMIC, engine.economic_config, EconomicConfig);
    apply_update!(UPDATE_GAMEPLAY, engine.gameplay_config, GameplayConfig);
    apply_update!(UPDATE_SUBSCRIPTIONS, engine.subscription_tiers, [SubscriptionTier; 4]);
    apply_update!(UPDATE_MINTING, engine.minting_config, MintingConfig);
    apply_update!(UPDATE_THEME, engine.theme_config, ThemeModifierConfig);
    apply_update!(UPDATE_NOVI_PURCHASE, engine.novi_purchase_config, NoviPurchaseConfig);
    apply_update!(UPDATE_ARENA, engine.arena_config, ArenaConfig);
    apply_update!(UPDATE_EXPEDITION, engine.expedition_config, ExpeditionConfig);
    apply_update!(UPDATE_DUNGEON, engine.dungeon_config, DungeonConfig);
    apply_update!(UPDATE_CASTLE, engine.castle_config, CastleConfig);
    apply_update!(UPDATE_COMBAT, engine.combat_config, CombatConfig);

    // Verify all flagged data was consumed (no trailing garbage)
    let _ = offset;

    // Increment config version
    engine.version = engine.version.saturating_add(1);

    Ok(())
}
