# Unused Code Review

This document catalogs unused code from `cargo build-sbf` warnings. Review before deletion - many are designed for future features or completeness.

**Generated:** 2026-01-23
**Initial Warnings:** 111
**After Cleanup:** 68

## Completed Integrations

### ✅ Eligibility System (Anti-Sybil) - INTEGRATED
Integrated into `processor/event/claim_prize.rs`:
- `check_transfer_ratio()` - Detects bot consolidation (high received:sent ratio)
- `check_account_age()` - Prevents new bot accounts (<7d, <30d, <60d by prize tier)
- `check_activity_requirement()` - Requires combat activity (5/20/50 attacks by tier)

### ✅ Travel Processors - WIRED
Added to lib.rs instruction dispatch:
- `34 => travel::speedup` - Speed up travel with gems
- `42 => travel::intracity_cancel` - Cancel intracity travel

### ✅ Time Cycle Helpers - ALLOWED
Added `#[allow(dead_code)]` with documentation for API completeness:
- `TimeOfDay::is_golden_hour()`, `is_night()`, `is_day()`, `is_peak_day()`, `is_deep_night()`

---

---

## Table of Contents
1. [Eligibility System (Anti-Sybil)](#1-eligibility-system-anti-sybil)
2. [Time Cycle System](#2-time-cycle-system)
3. [Combat System](#3-combat-system)
4. [Math & Calculations](#4-math--calculations)
5. [Location & Travel](#5-location--travel)
6. [Validation Helpers](#6-validation-helpers)
7. [Progression System](#7-progression-system)
8. [Rewards System](#8-rewards-system)
9. [Unused Variables (Quick Fixes)](#9-unused-variables-quick-fixes)
10. [Unused Imports](#10-unused-imports)
11. [Travel Speedup Processors](#11-travel-speedup-processors)

---

## 1. Eligibility System (Anti-Sybil)

**File:** `src/logic/eligibility.rs`

These functions implement anti-Sybil and eligibility checks for events with NOVI prizes. **HIGH VALUE** - should be used when implementing event prize claiming.

| Function | Purpose | Recommendation |
|----------|---------|----------------|
| `check_transfer_ratio()` | Detects bot consolidation accounts (high received:sent ratio) | USE in `event/claim_prize.rs` |
| `check_account_age()` | Requires minimum account age for high-value events | USE in prize claiming |
| `check_activity_requirement()` | Requires minimum attacks to prevent passive farming | USE in prize claiming |
| `check_networth_range()` | Brackets players by networth for fair events | USE in event joining |
| `check_subscription_tier()` | Requires subscription tier for premium events | USE for VIP events |
| `check_level_requirement()` | Requires minimum level for events | Already handled elsewhere, keep as utility |
| `calculate_account_age_days()` | Helper to get age in days | USE with `check_account_age` |
| `get_transfer_ratio_for_prize()` | Returns ratio limit based on prize value | USE with `check_transfer_ratio` |
| `get_min_age_for_prize()` | Returns age requirement based on prize value | USE with `check_account_age` |
| `get_min_attacks_for_prize()` | Returns activity requirement based on prize value | USE with `check_activity_requirement` |

**Action:** Integrate into `processor/event/claim_prize.rs` for anti-bot protection on NOVI prize distribution.

---

## 2. Time Cycle System

**File:** `src/logic/time_cycle.rs`

The time system has comprehensive helpers for time-based game mechanics. Some are for backend use (spawn rates), others for potential future features.

| Item | Purpose | Recommendation |
|------|---------|----------------|
| `TimeOfDay::is_golden_hour()` | Check if dawn/dusk (XP bonus time) | USE in XP granting |
| `TimeOfDay::is_night()` | Check if nighttime | USE for stealth mechanics |
| `TimeOfDay::is_day()` | Check if daytime | USE for day-only activities |
| `TimeOfDay::is_peak_day()` | Check if midday | USE for dungeon High Noon |
| `TimeOfDay::is_deep_night()` | Check if deep night (legendary encounters) | USE for dungeon Witching Hour |
| `ActivityType::EncounterSpawn` | Enum variant for spawn calculations | KEEP - used by backend |
| `is_daytime()` | Standalone function for day check | CONSOLIDATE with is_day() |
| `multiplier_to_bps()` | Convert f64 multiplier to bps | KEEP - utility for time mults |
| `apply_time_multiplier_u32()` | Apply time mult to u32 value | KEEP - may need for u32 values |
| `get_time_name()` | Get display name for TimeOfDay | BACKEND - for UI/logs |
| `seconds_until_time()` | Calculate seconds until target time | BACKEND - for timers/UI |

**Action:** Consider using `is_golden_hour()` in XP granting for time bonuses.

---

## 3. Combat System

**File:** `src/logic/combat.rs`

Complex combat calculations. Some are for advanced features not yet implemented.

| Item | Purpose | Recommendation |
|------|---------|----------------|
| `CombatResult::is_empty()` | Check if result has no actions | KEEP - useful for validation |
| `defender_weapons_remaining` field | Track defender weapons after combat | USE in attack_player.rs for drops |
| `fallback_mode` field | Track if defender used fallback | USE for fallback mechanics |
| `calculate_weapon_drops()` | Calculate weapons dropped on defeat | USE in attack_player.rs |
| `calculate_siege_consumed()` | Calculate siege weapons used vs buildings | USE in castle/attack_castle.rs |
| `units_in_vehicle()` | Calculate how many units fit in vehicles | USE for vehicle combat bonuses |
| `units_with_weapons()` | Calculate units equipped with weapons | USE for weapon damage bonuses |
| `calculate_defense_with_fallback()` | Defense when outnumbered (fallback mode) | USE for outnumbered scenarios |
| `inflict_damage_on_operatives()` | Apply damage to operative units | USE for operative-targeting attacks |
| `calculate_loot_with_fallback()` | Loot calculation with fallback penalty | USE with fallback mode |
| `calculate_total_defensive_power()` | Sum defensive unit power | MAYBE - could simplify existing |

**Action:** Integrate vehicle and weapon bonuses into combat processors.

---

## 4. Math & Calculations

**Files:** `src/logic/safe_math.rs`, `src/logic/golden_math.rs`, `src/logic/calculations.rs`

Mathematical utilities. Some are specialized for future features.

### safe_math.rs
| Function | Purpose | Recommendation |
|----------|---------|----------------|
| `apply_bp32()` | Apply basis points to u32 | KEEP - may need for u32 values |
| `chain_bp32()` | Chain multiple bp operations | KEEP - complex multiplier chains |
| `safe_sub()` | Checked subtraction | KEEP - safer than saturating_sub |
| `safe_div()` | Checked division | KEEP - safer than raw division |
| `safe_pow()` | Checked exponentiation | KEEP - for exponential scaling |
| `safe_sum()` | Sum slice with overflow check | KEEP - useful for totals |
| `PHI_INVERSE_POWER_TABLE` | Golden ratio inverse powers | KEEP - for φ-based calculations |
| `phi_inverse_power_bps()` | Get φ^-n in basis points | KEEP - for diminishing returns |
| `asymptotic_capacity()` | Capacity that approaches limit | FUTURE - for soft caps |
| `asymptotic_capacity_with_base()` | Same with custom base | FUTURE - for soft caps |

### golden_math.rs
| Function | Purpose | Recommendation |
|----------|---------|----------------|
| `phi_power()` | Calculate φ^n | KEEP - core golden ratio math |
| `calculate_level_up_increase()` | XP increase per level | USE in progression if not already |
| `rarity_multiplier()` | Get multiplier for item rarity | USE for loot/crafting |
| `city_type_multiplier()` | Bonus for city types | USE if city types implemented |
| `level_scaling_multiplier()` | Scale value by level | USE for level-based bonuses |
| `apply_multiplier_u32()` | Apply mult to u32 | KEEP - utility |

### calculations.rs
| Function | Purpose | Recommendation |
|----------|---------|----------------|
| `apply_percentage_modifier()` | Apply +/- percentage | KEEP - general utility |
| `calculate_xp_for_level()` | XP needed for level N | USE or verify exists elsewhere |
| `calculate_level_from_xp()` | Level from total XP | USE for level display |
| `calculate_collection_amount()` | Calculate collection yield | CHECK if used in collect_resources |
| `check_networth_requirement()` | Check min networth | CONSOLIDATE with eligibility.rs |

**Action:** Audit which are duplicates of existing functions.

---

## 5. Location & Travel

**File:** `src/logic/location.rs`

Location and travel calculations. Some may be handled differently now.

| Item | Purpose | Recommendation |
|------|---------|----------------|
| `TRAVEL_SPEED_KMH` | Base travel speed | CHECK if used in travel processors |
| `TELEPORT_COST_PER_100KM` | Teleport pricing | CHECK if used in intercity_teleport |
| `calculate_travel_time()` | Time based on distance | CHECK if duplicated |
| `calculate_teleport_cost()` | Gem cost for teleport | CHECK if used |
| `is_same_location()` | Check if at same location | USE for validation |
| `coordinate_to_i64()` | Convert coords to i64 | KEEP - serialization |
| `i64_to_coordinate()` | Convert i64 to coords | KEEP - serialization |
| `get_research_travel_bonus()` | Travel speed from research | USE in travel processors |

**Action:** Verify travel processors use these or have duplicated logic.

---

## 6. Validation Helpers

**File:** `src/validation/mod.rs`

Generic validation helpers.

| Function | Purpose | Recommendation |
|----------|---------|----------------|
| `require_data_len()` | Validate instruction data length | USE where helpful |
| `require_empty()` | Require account has no data | USE for new account creation |
| `require_same_owner()` | Check two accounts have same owner | USE for PDA validation |

**Action:** Consider using these instead of inline checks.

---

## 7. Progression System

**File:** `src/logic/progression.rs`

| Item | Purpose | Recommendation |
|------|---------|----------------|
| `total_xp_for_level()` | Total XP to reach level N | CHECK if duplicated in golden_math |
| `XPSource::DailyReward` | XP from daily rewards | USE when implementing daily XP |

**Action:** Use `DailyReward` variant when daily rewards grant XP.

---

## 8. Rewards System

**File:** `src/logic/rewards.rs`

| Item | Purpose | Recommendation |
|------|---------|----------------|
| `LootTable::calculate_share()` | Calculate player's loot share | USE for team loot distribution |
| `PlayerLootShare` struct | Hold player's share of loot | USE with calculate_share |

**Action:** Implement team loot sharing in rally/team systems.

---

## 9. Unused Variables (Quick Fixes)

These just need underscore prefix:

| Location | Variable | Fix |
|----------|----------|-----|
| `initialization/player.rs:85` | `associated_token_program` | `_associated_token_program` |
| `initialization/user.rs:69` | `associated_token_program` | `_associated_token_program` |
| `initialization/city.rs:47` | `system_program` | `_system_program` |
| `economy/hire_units.rs:90` | `token_program` | `_token_program` |
| `economy/hire_units.rs:365` | `base_bp` | `_base_bp` or use |
| `economy/collect_resources.rs:79` | `token_program` | `_token_program` |
| `economy/mint_for_prize.rs:64` | `token_program` | `_token_program` |
| `economy/purchase_stamina.rs:61` | `token_program` | `_token_program` |
| `economy/purchase_stamina.rs:49` | `program_id` | `_program_id` |
| `combat/attack_player.rs:769` | `attacker_melee_lost` | USE or prefix |
| `travel/intercity_cancel.rs:56` | `system_program` | `_system_program` |
| `travel/intercity_teleport.rs:61` | `system_program` | `_system_program` |
| `travel/intracity_cancel.rs:53` | `system_program` | `_system_program` |
| `travel/intracity_cancel.rs:125,152,156` | `was_bumped` | USE or remove |
| `encounter/spawn.rs:453` | `encounter_type` | USE or prefix |
| `team/create.rs:56` | `token_program` | `_token_program` |
| `team/treasury_approve_request.rs:155` | `requester_rank` | USE or prefix |
| `team/treasury_approve_request.rs:172` | `requester_slot_pda` | USE or prefix |
| `rally/speedup.rs:103` | `total_gem_cost_spent` | USE for event or prefix |
| `event/join.rs:46` | `clock_account` | `_clock_account` |
| `event/finalize.rs:37` | `clock_account` | `_clock_account` |
| `loot/claim.rs:207` | `item_idx` | USE or prefix |
| `hero/create_collection.rs:63` | `ge_bump` | `_ge_bump` |
| `hero/unlock.rs:59` | `program_id` | `_program_id` |
| `shop/purchase_item.rs:555` | `amount_u32` | USE or prefix |
| `shop/purchase_bundle.rs:502` | `amount_u32` | USE or prefix |
| `shop/purchase_flash_sale.rs:551` | `amount_u32` | USE or prefix |
| `estate/create.rs:42` | `system_program` | `_system_program` |
| `expedition/claim.rs:350` | `fragment_bonus` | USE or prefix |
| `castle/join_garrison.rs:148,149` | mutable vars | Remove `mut` |

---

## 10. Unused Imports

| Location | Import | Fix |
|----------|--------|-----|
| `logic/mod.rs:18` | `safe_math::*` | Remove or use specific items |
| `logic/mod.rs:25` | `eligibility::*` | Remove or use specific items |
| `rally/execute.rs:29` | `player::NULL_PUBKEY` | Remove |

---

## 11. Travel Speedup Processors

**Files:** `processor/travel/intracity_cancel.rs`, `processor/travel/speedup.rs`

| Item | Purpose | Status |
|------|---------|--------|
| `intracity_cancel::process()` | Cancel intracity travel | Not wired in lib.rs |
| `speedup::process()` | Speed up travel with gems | Not wired in lib.rs |
| `SPEEDUP_TIER_1`, `SPEEDUP_TIER_2` | Speedup cost tiers | Not used |

**Action:** Wire these processors into lib.rs or remove if not needed.

---

## 12. Other Issues

| Location | Issue | Fix |
|----------|-------|-----|
| `collect_resources.rs:371` | Unnecessary parentheses | Remove `()` |
| `attack_castle.rs:406` | Unnecessary parentheses | Remove `()` |
| `combat.rs:517-519` | `in_vehicle_*` assigned never read | USE in vehicle combat or remove |
| `forge/strike.rs:163` | `drop()` on reference | Use `let _ =` instead |
| `encounter/spawn.rs:426` | `generate_random_location_in_city()` unused | Wire up or remove |

---

## Priority Actions

### High Priority (Anti-Sybil)
1. Integrate `eligibility.rs` functions into `event/claim_prize.rs`

### Medium Priority (Features)
2. Wire `travel/intracity_cancel.rs` and `travel/speedup.rs` into lib.rs
3. Use combat vehicle/weapon bonuses in attack processors
4. Implement team loot sharing with `rewards.rs`

### Low Priority (Cleanup)
5. Prefix unused variables with underscore
6. Remove unused imports
7. Fix parentheses and drop() warnings

---

## Notes

- Many "unused" functions are designed for completeness or future features
- The eligibility module is critical for anti-bot protection on prize events
- Time cycle helpers are useful for time-based bonuses
- Review before deletion - some may be used by backend/off-chain code
