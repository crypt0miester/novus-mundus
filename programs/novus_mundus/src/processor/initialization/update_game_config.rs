use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
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
    utils::read_u16,
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
const UPDATE_USD_PRICE: u16 = 1 << 12;

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
/// 10: CastleConfig, 11: CombatConfig,
/// 12: usd_price_cents (raw u64 — static SOL/USD reference; cents per SOL)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    // Need at least 2 bytes for update_flags
    let update_flags = read_u16(data, 0, "update_game_config.update_flags")?;

    if update_flags == 0 {
        return Err(ProgramError::InvalidInstructionData);
    }

    // Parse accounts
    crate::extract_accounts!(accounts, exact [game_engine_account, authority]);

    require_signer(authority)?;
    require_writable(game_engine_account)?;

    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let mut engine = GameEngine::load_checked_mut_by_key(game_engine_account, program_id)?;

    // Verify DAO authority
    if engine.authority != *authority.address() {
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
    // Static SOL/USD reference (cents per SOL). Read only by subscription
    // purchase to convert tier `cost_in_usd_cents` into a lamports charge —
    // see `subscription/purchase.rs`. Bit order convention: this is a bare
    // u64, not a sub-config, but consumed in the same byte stream so the
    // client must place its 8 bytes after every preceding set bit's payload.
    apply_update!(UPDATE_USD_PRICE, engine.usd_price_cents, u64);

    // Reject trailing garbage bytes.
    if offset != data.len() {
        return Err(ProgramError::InvalidInstructionData);
    }

    // Per-field sanity bounds on critical fields.
    // These prevent a coerced/leaked DAO key from setting absurd values that
    // would zero out denominators, uncap discounts, or break tier indices.
    // Each branch only fires when its corresponding flag was set.
    if update_flags & UPDATE_GAMEPLAY != 0 {
        // safebox_protection_percent is stored as basis points; cap at 10000 (100%).
        if engine.gameplay_config.safebox_protection_percent > 10_000 {
            return Err(GameError::InvalidParameter.into());
        }
        // Damage redistribution percentages should not exceed 10000 bps each.
        // (Individual fields; bounds chosen conservatively.)
        if engine.gameplay_config.damage_unit_1_percent > 10_000
            || engine.gameplay_config.damage_unit_2_percent > 10_000
            || engine.gameplay_config.damage_unit_3_percent > 10_000
        {
            return Err(GameError::InvalidParameter.into());
        }
    }
    if update_flags & UPDATE_ECONOMIC != 0 {
        // cost_multiplier == 0 would cause free-cost exploits or div-by-zero.
        if engine.economic_config.cost_multiplier == 0 {
            return Err(GameError::InvalidParameter.into());
        }
    }
    if update_flags & UPDATE_SUBSCRIPTIONS != 0 {
        // Each tier should reference its own index (defense-in-depth against
        // accidental misalignment by the DAO front-end).
        for i in 0..4 {
            if engine.subscription_tiers[i].tier_index != i as u8 {
                return Err(GameError::InvalidParameter.into());
            }
        }
    }
    if update_flags & UPDATE_MINTING != 0 {
        // Per-proposal cap must not exceed total supply cap.
        if engine.minting_config.max_mint_per_proposal > engine.minting_config.max_supply_cap {
            return Err(GameError::InvalidParameter.into());
        }
    }
    if update_flags & UPDATE_USD_PRICE != 0 {
        // Mirror the bounds enforced at subscription purchase: $1 .. $1M per
        // SOL. Wider than any realistic market move, tight enough to catch a
        // typo or accidental 0 that would make div-by-zero / wild overcharge.
        if engine.usd_price_cents < 100 || engine.usd_price_cents > 100_000_000 {
            return Err(GameError::InvalidParameter.into());
        }
    }

    // Increment config version
    engine.version = engine.version.saturating_add(1);

    Ok(())
}
