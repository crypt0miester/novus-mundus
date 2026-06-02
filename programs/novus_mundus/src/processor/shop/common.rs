//! Shared helpers for shop purchase processors.
//!
//! Triplicated across `purchase_item.rs`, `purchase_bundle.rs`, and
//! `purchase_flash_sale.rs` before this module existed.

use pinocchio::ProgramResult;

use crate::error::GameError;
use crate::logic::safe_math::apply_bp_penalty;
use crate::state::{PlayerAccount, ShopConfigAccount};

/// Convert cumulative spend into a discount basis-points value.
pub fn calculate_milestone_discount(total_spent: u64, config: &ShopConfigAccount) -> u16 {
    if total_spent >= config.diamond_threshold {
        config.diamond_discount_bps
    } else if total_spent >= config.platinum_threshold {
        config.platinum_discount_bps
    } else if total_spent >= config.gold_threshold {
        config.gold_discount_bps
    } else if total_spent >= config.silver_threshold {
        config.silver_discount_bps
    } else if total_spent >= config.bronze_threshold {
        config.bronze_discount_bps
    } else {
        0
    }
}

/// Convert cumulative spend into a tier index (0=None, 5=Diamond).
pub fn calculate_milestone_tier(total_spent: u64, config: &ShopConfigAccount) -> u8 {
    if total_spent >= config.diamond_threshold {
        5
    } else if total_spent >= config.platinum_threshold {
        4
    } else if total_spent >= config.gold_threshold {
        3
    } else if total_spent >= config.silver_threshold {
        2
    } else if total_spent >= config.bronze_threshold {
        1
    } else {
        0
    }
}

pub fn calculate_streak_discount(streak: u8, config: &ShopConfigAccount) -> u16 {
    match streak {
        7.. => config.streak_day_7_bps,
        5..=6 => config.streak_day_5_bps,
        3..=4 => config.streak_day_3_bps,
        2 => config.streak_day_2_bps,
        _ => 0,
    }
}

/// Fibonacci-style bonus for repeated same-day purchases, capped per config.
pub fn calculate_fib_bonus(daily_purchase_count: u8, config: &ShopConfigAccount) -> u16 {
    let base_bonus = match daily_purchase_count {
        0 | 1 => 0,
        2 => 100,
        3 => 200,
        4 => 300,
        5 => 500,
        6.. => 800,
    };
    base_bonus.min(config.max_fib_discount_bps)
}

pub fn calculate_subscription_discount(tier: u8) -> u16 {
    match tier {
        0 => 0,
        1 => 500,
        2 => 1000,
        3 => 1500,
        4 => 2500,
        _ => 0,
    }
}

/// Multiplicative stacking across discount layers, floored at `max_total_discount_bps`.
#[allow(clippy::too_many_arguments)]
pub fn calculate_final_price(
    base_price: u64,
    base_discount_bps: u16,
    bundle_discount_bps: u16,
    fib_discount_bps: u16,
    sub_discount_bps: u16,
    milestone_discount_bps: u16,
    loyalty_discount_bps: u16,
    market_discount_bps: u16,
    max_total_discount_bps: u16,
) -> u64 {
    let mut price = base_price;
    price = apply_bp_penalty(price, base_discount_bps).unwrap_or(price);
    price = apply_bp_penalty(price, bundle_discount_bps).unwrap_or(price);
    price = apply_bp_penalty(price, fib_discount_bps).unwrap_or(price);
    price = apply_bp_penalty(price, sub_discount_bps).unwrap_or(price);
    price = apply_bp_penalty(price, milestone_discount_bps).unwrap_or(price);
    price = apply_bp_penalty(price, loyalty_discount_bps).unwrap_or(price);
    price = apply_bp_penalty(price, market_discount_bps).unwrap_or(price);
    let min_price = apply_bp_penalty(base_price, max_total_discount_bps).unwrap_or(0);
    // .max(1) prevents free items when max_total_discount_bps == 10000.
    price.max(min_price).max(1)
}

/* Cosmetic item_type encoding — matches
 * apps/web/src/lib/config/cosmetics-catalog.ts. The shop's u16
 * `item_type` is the only handle the chain exposes for a purchase;
 * cosmetic items publish under these ranges so `fulfill_item` can
 * decode them into (kind, id) and flip the right `owned_<kind>` bit.
 * Each kind reserves 64 IDs (u64 ownership bitmask cap).
 *
 * `is_inventory_item_type` reserves 1192–1383 for cosmetics regardless
 * of which kinds are currently wired, so adding the unwired effect /
 * pose kinds later doesn't need a parallel change there. */
pub const COSMETIC_BADGE_BASE: u16 = 1000;
pub const COSMETIC_TITLE_BASE: u16 = 1064;
pub const COSMETIC_COLOR_BASE: u16 = 1128;
pub const COSMETIC_FRAME_BASE: u16 = 1192;
pub const COSMETIC_EFFECT_BASE: u16 = 1256; // RESERVED — wire when kind=4 ships
pub const COSMETIC_POSE_BASE: u16 = 1320;   // RESERVED — wire when kind=5 ships
pub const COSMETIC_RANGE: u16 = 64;

/// True for any item_type that targets the player's CosmeticsSection.
/// Callers (purchase_item / purchase_bundle / purchase_flash_sale) use this
/// to unlock `EXT_COSMETICS` on the player account BEFORE the mutable
/// player borrow that calls `fulfill_item`. `fulfill_item` now refuses to
/// process a cosmetic item_type when the section is unallocated, so a
/// misordered caller fails the whole transaction (refunding payment)
/// instead of charging-without-delivering. Only wired ranges are reported
/// true — unwired reserved ranges (effects / poses) stay out of the
/// extension-unlock path until their `fulfill_item` arms land.
pub fn is_cosmetic_item_type(item_type: u16) -> bool {
    (item_type >= COSMETIC_BADGE_BASE && item_type < COSMETIC_COLOR_BASE + COSMETIC_RANGE)
        || (item_type >= COSMETIC_FRAME_BASE && item_type < COSMETIC_FRAME_BASE + COSMETIC_RANGE)
}

/// Apply non-inventory item rewards directly to the player core/section fields.
///
/// Item type ranges:
///   0-99       : Equipment (3=armor handled via inventory by caller)
///   100-199    : Consumables
///   200-299    : Materials
///   50-52      : Currency / resources (gems / cash / fragments)
///   60-61      : Legacy consumables (encounter stamina / produce)
///   1000-1063  : Cosmetic badges (id = item_type - 1000)
///   1064-1127  : Cosmetic titles (id = item_type - 1064)
///   1128-1191  : Cosmetic name-colours (id = item_type - 1128)
///   1192-1255  : Cosmetic avatar frames (id = item_type - 1192)
///   1256-1383  : RESERVED for cosmetic effects/poses — rejected with
///                `InvalidParameter` until the matching arms land.
///   Other      : No-op (caller routes to inventory)
///
/// For cosmetics, the caller MUST have unlocked `EXT_COSMETICS` on the
/// player account (via `unlock_extension_if_eligible`) before invoking
/// this function. If the section isn't allocated, the cosmetic branches
/// return `CosmeticsNotUnlocked` so the whole purchase tx reverts —
/// preferable to charging the buyer and silently dropping the item.
/// `is_cosmetic_item_type` is provided so the caller can do the unlock
/// at the right moment in its borrow lifecycle.
pub fn fulfill_item(player: &mut PlayerAccount, item_type: u16, amount: u64) -> ProgramResult {
    let amount_u16 = amount.min(u16::MAX as u64) as u16;

    match item_type {
        0 => player.melee_weapons = player.melee_weapons.saturating_add(amount),
        1 => player.ranged_weapons = player.ranged_weapons.saturating_add(amount),
        2 => player.siege_weapons = player.siege_weapons.saturating_add(amount),
        3 => player.armor_pieces = player.armor_pieces.saturating_add(amount),
        4 => player.vehicles = player.vehicles.saturating_add(amount),

        100 => player.set_stamina_potions(player.stamina_potions().saturating_add(amount_u16)),
        101 => player.set_xp_boosters(player.xp_boosters().saturating_add(amount_u16)),
        102 => player.set_loot_magnets(player.loot_magnets().saturating_add(amount_u16)),
        103 => player.set_shield_tokens(player.shield_tokens().saturating_add(amount_u16)),
        104 => player.set_speed_elixirs(player.speed_elixirs().saturating_add(amount_u16)),
        105 => player.set_attack_boosters(player.attack_boosters().saturating_add(amount_u16)),
        106 => player.set_defense_boosters(player.defense_boosters().saturating_add(amount_u16)),
        107 => {
            player.set_collection_boosters(player.collection_boosters().saturating_add(amount_u16))
        }
        108 => player.set_rally_horns(player.rally_horns().saturating_add(amount_u16)),
        109 => player.set_teleport_scrolls(player.teleport_scrolls().saturating_add(amount_u16)),
        110 => player.set_mystery_keys(player.mystery_keys().saturating_add(amount_u16)),

        200 => player.set_common_materials(player.common_materials().saturating_add(amount)),
        201 => player.set_uncommon_materials(player.uncommon_materials().saturating_add(amount)),
        202 => player.set_rare_materials(player.rare_materials().saturating_add(amount)),
        203 => player.set_epic_materials(player.epic_materials().saturating_add(amount)),
        204 => player.set_legendary_materials(player.legendary_materials().saturating_add(amount)),

        50 => player.gems = player.gems.saturating_add(amount),
        51 => player.cash_on_hand = player.cash_on_hand.saturating_add(amount),
        52 => player.fragments = player.fragments.saturating_add(amount),

        60 => player.encounter_stamina = player.encounter_stamina.saturating_add(amount),
        61 => player.produce = player.produce.saturating_add(amount),

        // Cosmetics — flip the bit for the requested (kind, id). If
        // `cosmetics_mut()` returns None the caller forgot to unlock
        // EXT_COSMETICS; fail the tx so the buyer's payment reverts
        // rather than completing the purchase with no cosmetic delivered.
        x if (COSMETIC_BADGE_BASE..COSMETIC_BADGE_BASE + COSMETIC_RANGE).contains(&x) => {
            let cos = player
                .cosmetics_mut()
                .ok_or(GameError::CosmeticsNotUnlocked)?;
            let id = x - COSMETIC_BADGE_BASE;
            cos.owned_badges |= 1u64 << id;
        }
        x if (COSMETIC_TITLE_BASE..COSMETIC_TITLE_BASE + COSMETIC_RANGE).contains(&x) => {
            let cos = player
                .cosmetics_mut()
                .ok_or(GameError::CosmeticsNotUnlocked)?;
            let id = x - COSMETIC_TITLE_BASE;
            cos.owned_titles |= 1u64 << id;
        }
        x if (COSMETIC_COLOR_BASE..COSMETIC_COLOR_BASE + COSMETIC_RANGE).contains(&x) => {
            let cos = player
                .cosmetics_mut()
                .ok_or(GameError::CosmeticsNotUnlocked)?;
            let id = x - COSMETIC_COLOR_BASE;
            cos.owned_colors |= 1u64 << id;
        }
        x if (COSMETIC_FRAME_BASE..COSMETIC_FRAME_BASE + COSMETIC_RANGE).contains(&x) => {
            let cos = player
                .cosmetics_mut()
                .ok_or(GameError::CosmeticsNotUnlocked)?;
            let id = x - COSMETIC_FRAME_BASE;
            cos.owned_frames |= 1u64 << id;
        }

        // Reserved cosmetic ranges (effects / poses) — not wired yet.
        // Reject loudly so a misconfigured shop item can't silently
        // consume payment with no delivery. Remove these arms when the
        // matching kinds ship and add the actual bit-flip branches.
        x if (COSMETIC_EFFECT_BASE..COSMETIC_EFFECT_BASE + COSMETIC_RANGE).contains(&x) => {
            return Err(GameError::InvalidParameter.into());
        }
        x if (COSMETIC_POSE_BASE..COSMETIC_POSE_BASE + COSMETIC_RANGE).contains(&x) => {
            return Err(GameError::InvalidParameter.into());
        }

        _ => {}
    }

    Ok(())
}

/// Update loyalty streak, daily counters, and last-purchase markers.
///
/// Shared streak block from purchase_item, purchase_bundle, purchase_flash_sale.
/// Callers handle the `total_shop_spent`/`milestone_tier` and any
/// `flash_claims_today` increments around this call — those diverge per processor.
pub fn update_streak_and_daily(player: &mut PlayerAccount, now: i64) {
    let current_day = (now / 86400) as u32;
    let Some(inv) = player.inventory_mut() else {
        return;
    };

    if inv.last_purchase_day == 0 {
        inv.loyalty_streak = 1;
    } else if current_day == inv.last_purchase_day.saturating_add(1) {
        inv.loyalty_streak = inv.loyalty_streak.saturating_add(1).min(7);
    } else if current_day > inv.last_purchase_day.saturating_add(1) {
        inv.loyalty_streak = 1;
    }

    if current_day != inv.last_purchase_day {
        inv.daily_purchase_count = 0;
        inv.flash_claims_today = 0;
    }

    inv.daily_purchase_count = inv.daily_purchase_count.saturating_add(1);
    inv.last_purchase_day = current_day;
    inv.last_daily_reset = now;
}
