# Strategic Combat System - Implementation Plan

> **Status**: NOT IMPLEMENTED
> **Priority**: HIGH
> **Dependencies**: Player/team/research/hero/city/monument systems
> **Estimated Scope**: ~20 new files, ~4000 lines of code

---

## ⚠️ IMPORTANT: New Program Development

**This is a NEW Solana program being developed from scratch.**

- **NO backward compatibility constraints** - We can design systems optimally
- **NO legacy code to maintain** - Clean slate implementation
- **Existing processor files** (`attack_player.rs`, `rally/execute.rs`) will be **REWRITTEN** to use this system
- All combat flows through the Strategic Combat System

---

## Table of Contents

1. [Overview](#overview)
2. [Dual Combat Modes](#dual-combat-modes)
3. [Design Philosophy](#design-philosophy)
4. [Operative Fallback System](#operative-fallback-system)
5. [Golden Ratio Asymptotic Scaling](#golden-ratio-asymptotic-scaling)
6. [Buff Aggregation System](#buff-aggregation-system)
7. [Power Formulas](#power-formulas)
8. [Rally System](#rally-system)
9. [Rally Phases](#rally-phases)
10. [Rally Speedup System](#rally-speedup-system)
11. [Reinforcement System](#reinforcement-system)
12. [Border Reserve Queue](#border-reserve-queue)
13. [New Research Nodes](#new-research-nodes)
14. [Time-Based Combat Modifiers](#time-based-combat-modifiers)
15. [State Structures](#state-structures)
16. [Account Management](#account-management)
17. [Instructions](#instructions)
18. [Processor Structure](#processor-structure)
19. [Implementation Order](#implementation-order)

---

## Overview

The Strategic Combat System introduces **deployment-based attacks**, **team reinforcements**, and **march capacity management**, creating deep strategic gameplay where players must balance offense vs defense and coordinate with teammates.

### Key Features

| Feature | Description |
|---------|-------------|
| **Unit Role Separation** | Defensive units fight, operative units produce |
| **Deployment Risk** | Send troops = stronger attack but weaker home defense |
| **March Capacity** | Limited simultaneous marches, expandable via research/subscription |
| **Team Cooperation** | Reinforce teammates with border reserve queue |
| **Buff Stacking** | Heroes + Research + Monuments + City all contribute |
| **Time Strategy** | Attack at night (φ bonus), defend at midday (φ bonus) |
| **Gem Speedup** | Speed up both outbound and return travel with gems |

### Strategic Decision Matrix

```
┌─────────────────────────────────────────────────────────────────┐
│              STRATEGIC DECISION MATRIX                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  "How many marches do I have?"                                  │
│  ├── Base: 1 attack + 1 reinforcement                          │
│  ├── Research: Command Structure, Military Logistics            │
│  ├── Subscription: Legendary = +2 each                          │
│  └── Can I afford to use a march slot on this?                 │
│                                                                 │
│  "Should I attack?"                                             │
│  ├── How many units can I deploy? (asymptotic φ scaling)       │
│  ├── What time is it? (night = attack bonus)                    │
│  ├── Do I have a march slot available?                         │
│  ├── Am I already attacking this target? (1 per target)        │
│  └── Can I gem-speedup if needed?                              │
│                                                                 │
│  "Should I send reinforcements?"                                │
│  ├── Is my teammate under threat?                              │
│  ├── Will my units fit? (or go to border reserve)              │
│  ├── Should I send a hero for immediate +20% bonus?            │
│  └── Do I have a reinforcement slot available?                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Dual Combat Modes

The game features **two combat systems** that share core combat logic:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    TWO COMBAT SYSTEMS                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  SYSTEM 1: LOCAL PvP (attack_player.rs)                                   │
│  ──────────────────────────────────────────                              │
│  ├── Location: SAME city, within proximity (10 meters)                   │
│  ├── Timing: INSTANT (no travel, no waiting)                             │
│  ├── Participants: 1v1 only                                              │
│  ├── Use case: Street fights, quick opportunistic attacks                │
│  └── Flow: Attack → Combat → Loot (single transaction)                   │
│                                                                           │
│  SYSTEM 2: RALLY (rally/*.rs)                                             │
│  ──────────────────────────────────────────                              │
│  ├── Location: Cross-city warfare (with travel)                          │
│  ├── Timing: Multi-phase (gather → march → combat → return)              │
│  ├── Participants: 1+ (solo cross-city OR team coordinated)              │
│  ├── Use case: Strategic campaigns, team warfare                         │
│  └── Flow: Create → Gather → March → Execute → Return                    │
│                                                                           │
│  SHARED COMBAT LOGIC:                                                     │
│  ├── Attacker uses: DEFENSIVE units                                      │
│  ├── Defender uses: Garrison + Reinforcements                            │
│  ├── Operative fallback if no garrison (50% effectiveness)               │
│  ├── Border reserves auto-fill after casualties                          │
│  └── All buffs apply (Hero, Research, Monument, City, Time, Level)       │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### When to Use Which System

| Situation | System | Why |
|-----------|--------|-----|
| Enemy standing next to you | `attack_player.rs` | Instant, no coordination needed |
| Solo attack on distant city | `rally/*` (solo) | Travel time required |
| Team coordinated strike | `rally/*` (team) | Multiple participants gather and march |
| Quick revenge attack locally | `attack_player.rs` | No waiting, immediate |
| Siege on enemy stronghold | `rally/*` (team) | Need combined power |

### System Comparison

| Aspect | Local PvP | Rally System |
|--------|-----------|--------------|
| **Processor** | `attack_player.rs` | `rally/*.rs` |
| **Location** | Same city, ~10m | Any city (cross-city) |
| **Travel** | None (instant) | Gather + March + Return |
| **Participants** | 1v1 only | 1 to 20 |
| **Phases** | Single phase | 4 phases (gather, march, combat, return) |
| **Speedup** | N/A | Gather, March, Return (all separate) |
| **Hero** | Personal buffs | Travels with troops, aggregate buffs |
| **Solo cross-city** | ❌ Not supported | ✅ min_participants=1 |
| **Team attack** | ❌ Not supported | ✅ min_participants=2+ |

---

## Design Philosophy

### Unit Role Separation

```
┌─────────────────────────────────────────────────────────────────┐
│              UNIT ROLE SPECIALIZATION                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  DEFENSIVE UNITS (Combat-Focused)                               │
│  ├── Purpose: Fighting, attacking, defending                   │
│  ├── Contributes to: Attack Power, Defense Power               │
│  ├── Can be deployed: YES (for attacks)                        │
│  ├── Can reinforce: YES (to teammates)                         │
│  └── Tiers: Def 1 (×1), Def 2 (×2), Def 3 (×3)                │
│                                                                 │
│  OPERATIVE UNITS (Economy-Focused)                              │
│  ├── Purpose: Production, collection, economy                  │
│  ├── Contributes to: Cash collection, resource generation      │
│  ├── Can be deployed: NO                                       │
│  ├── Can reinforce: NO                                         │
│  ├── FALLBACK: Become defenders if NO defensive units exist    │
│  │   └── 50% effectiveness penalty when defending              │
│  └── Tiers: Op 1 (×1), Op 2 (×2), Op 3 (×3)                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Core Principles

1. **No u128**: All calculations use safe_math functions (`apply_bp`, `chain_bp`, `mul_div`, `apply_bp_bonus`)
2. **Deterministic**: No randomness - same inputs = same outputs
3. **Golden Ratio Scaling**: Asymptotic progression using φ for diminishing returns
4. **Skill-Based Crits**: Critical hits trigger at threshold (50% combined chance), not probabilistically
5. **One-Time Costs**: Activation costs scale with levels, no ongoing maintenance
6. **Operative Fallback**: If no defensive units, operatives defend at 50% effectiveness

---

## Operative Fallback System

When a player has **NO defensive units** (garrison = 0 and no reinforcements), their **operative units become the last line of defense**. This prevents players from being completely defenseless while maintaining the unit role distinction.

### Fallback Rules

```
┌─────────────────────────────────────────────────────────────────────────┐
│              OPERATIVE FALLBACK MECHANICS                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  TRIGGER CONDITION:                                                       │
│  ├── Defender's garrison = 0 (all defensive units deployed or dead)     │
│  ├── AND no active reinforcements                                        │
│  └── Operatives automatically become emergency defenders                 │
│                                                                           │
│  EFFECTIVENESS PENALTY:                                                   │
│  ├── Operatives fight at 50% effectiveness (5000 bps multiplier)        │
│  ├── They're workers, not soldiers - untrained in combat                │
│  └── Still better than 0 defense!                                        │
│                                                                           │
│  POWER CALCULATION:                                                       │
│  ├── Base power = (op_1 × 1 + op_2 × 2 + op_3 × 3)                      │
│  ├── Fallback power = Base power × 50% (5000 bps)                       │
│  └── Still receives: armor bonus, monument buff, city buff, time buff    │
│                                                                           │
│  DAMAGE DISTRIBUTION:                                                     │
│  ├── When operatives take damage in fallback mode                        │
│  ├── Same tier distribution as defensive units                           │
│  └── Op 3 > Op 2 > Op 1 (higher tiers prioritized for casualties)       │
│                                                                           │
│  LOOT BONUS (Fallback Mode):                                             │
│  ├── Operatives ARE the economy - they generate cash                     │
│  ├── Hitting operatives = hitting the money directly                     │
│  ├── BONUS LOOT: φ (1.618x) multiplier on cash stolen                   │
│  ├── Represents: raiding unprotected treasury/operations                 │
│  └── Maximum cash loot cap still applies (from GameplayConfig)           │
│                                                                           │
│  STRATEGIC IMPLICATIONS:                                                  │
│  ├── Never completely safe to send ALL defensive units away              │
│  ├── Losing operatives = losing economy                                  │
│  ├── Attackers can cripple enemy economy if garrison is empty            │
│  ├── BONUS LOOT incentivizes targeting undefended players                │
│  └── Encourages balanced force allocation                                │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### Fallback Implementation

```rust
/// Fallback loot bonus multiplier: φ (golden ratio)
/// When attacking a player with no garrison, attacker gets 1.618x cash loot
/// Stored as basis points: 16180 = 161.8% = 1.618x
pub const FALLBACK_LOOT_BONUS_BPS: u16 = 16180;

/// Calculate defense power with operative fallback
/// If no defensive garrison and no reinforcements, operatives defend at 50%
pub fn calculate_defense_with_fallback(
    player: &PlayerAccount,
    garrison_power: u64,
    reinforcement_power: u64,
) -> (u64, bool) {
    // Check if we have any real defenders
    let total_defense = garrison_power.saturating_add(reinforcement_power);

    if total_defense > 0 {
        // Normal defense - no fallback needed
        return (total_defense, false);
    }

    // FALLBACK: Use operatives at 50% effectiveness
    let operative_base_power: u64 = (player.operative_unit_1 * 1)
        .saturating_add(player.operative_unit_2 * 2)
        .saturating_add(player.operative_unit_3 * 3);

    if operative_base_power == 0 {
        // Truly defenseless - no units at all
        return (0, false);
    }

    // Apply 50% penalty (5000 bps)
    let fallback_power = apply_bp(operative_base_power, 5000).unwrap_or(0);

    (fallback_power, true) // true = fallback mode active
}

/// Inflict damage on operatives during fallback defense
/// Uses same tier distribution as defensive units
pub fn inflict_damage_on_operatives(
    player: &mut PlayerAccount,
    total_damage: u64,
    gameplay_config: &GameplayConfig,
) -> u64 {
    let total_operatives = player.total_operative_units();
    if total_operatives == 0 || total_damage == 0 {
        return 0;
    }

    // Use same distribution as defensive units
    let (new_op_1, new_op_2, new_op_3) = inflict_damage(
        player.operative_unit_1,
        player.operative_unit_2,
        player.operative_unit_3,
        player.armor_pieces, // Armor still helps
        total_damage as f64,
        gameplay_config,
        player.hero_armor_efficiency_bps,
        player.equipped_armor_bonus_bps,
    );

    let casualties = total_operatives
        .saturating_sub(new_op_1 + new_op_2 + new_op_3);

    player.operative_unit_1 = new_op_1;
    player.operative_unit_2 = new_op_2;
    player.operative_unit_3 = new_op_3;

    casualties
}

/// Calculate loot with fallback bonus
/// In fallback mode, attacker gets φ (1.618x) bonus on cash loot
/// Represents raiding unprotected operations/treasury
pub fn calculate_loot_with_fallback(
    base_cash_loot: u64,
    is_fallback_mode: bool,
) -> u64 {
    if !is_fallback_mode {
        return base_cash_loot;
    }

    // Apply φ multiplier: cash × 16180 / 10000
    // Using mul_div to prevent overflow
    mul_div(base_cash_loot, FALLBACK_LOOT_BONUS_BPS as u64, 10000)
        .unwrap_or(base_cash_loot)
}
```

### Combat Flow with Fallback

```
┌───────────────────────────────────────────────────────────────────────┐
│                 DEFENSE CALCULATION FLOW                                │
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Calculate garrison (defensive units - deployed)                     │
│                                                                         │
│  2. Load active reinforcements                                          │
│                                                                         │
│  3. Total defense = garrison + reinforcements                           │
│     ├── If total > 0 → Normal defense mode                             │
│     │   └── Apply all buffs, resolve combat                            │
│     └── If total = 0 → Check for fallback                              │
│                                                                         │
│  4. FALLBACK CHECK:                                                     │
│     ├── If operatives > 0 → Activate fallback mode                     │
│     │   ├── Defense = operative_power × 50%                            │
│     │   ├── Apply buffs (armor, monument, city, time)                  │
│     │   ├── Casualties hit operatives (damages economy!)               │
│     │   └── LOOT BONUS: Cash loot × φ (1.618x)                         │
│     └── If operatives = 0 → Defenseless                                │
│         └── Attacker wins automatically, full loot (no bonus)          │
│                                                                         │
│  5. Combat resolution proceeds normally                                 │
│                                                                         │
│  6. LOOT CALCULATION:                                                   │
│     ├── Calculate base cash loot from damage ratio                     │
│     ├── If fallback_mode → apply φ multiplier (1.618x)                 │
│     ├── Cap at max_cash_loot_bps from GameplayConfig                   │
│     └── Distribute to rally participants by contribution               │
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Golden Ratio Asymptotic Scaling

All capacity/limit scaling uses **golden ratio asymptotic formula** for elegant diminishing returns:

```
capacity = max_capacity × (1 - φ^(-level))

Where φ = 1.618034...
```

### Progression Table

| Level | φ^(-level) | % of Max | Feel |
|-------|------------|----------|------|
| 0 | 1.000 | 0.0% | Base only |
| 1 | 0.618 | 38.2% | Unlocked |
| 2 | 0.382 | 61.8% | Meaningful |
| 3 | 0.236 | 76.4% | Strong |
| 5 | 0.090 | 91.0% | Near-max |
| 10 | 0.008 | 99.2% | Effectively maxed |
| 15 | 0.001 | 99.9% | Whale territory |

### Integer Implementation (No Floats)

```rust
use crate::logic::safe_math::mul_div;

/// PHI_INVERSE in basis points: 1/φ ≈ 0.618 = 6180 bps
const PHI_INVERSE_BPS: u64 = 6180;

/// Calculate φ^(-level) in basis points
/// Returns value that decays toward 0 as level increases
pub fn phi_inverse_power_bps(level: u32) -> u64 {
    if level == 0 {
        return 10000; // φ^0 = 1.0
    }

    let mut result: u64 = 10000;
    for _ in 0..level {
        result = mul_div(result, PHI_INVERSE_BPS, 10000).unwrap_or(0);
    }
    result
}

/// Calculate asymptotic capacity: approaches max but never reaches it
/// Formula: max × (1 - φ^(-level))
pub fn asymptotic_capacity(max_capacity: u64, level: u32) -> u64 {
    if level == 0 {
        return 0;
    }

    let decay_bps = phi_inverse_power_bps(level);
    let progress_bps = 10000u64.saturating_sub(decay_bps);

    mul_div(max_capacity, progress_bps, 10000).unwrap_or(0)
}

/// Same as above but returns ceiling for better UX on small numbers
pub fn asymptotic_capacity_ceil(max_capacity: u64, level: u32) -> u64 {
    if level == 0 {
        return 0;
    }

    let decay_bps = phi_inverse_power_bps(level);
    let progress_bps = 10000u64.saturating_sub(decay_bps);

    // Ceiling division: (a * b + c - 1) / c
    let numerator = max_capacity.saturating_mul(progress_bps);
    (numerator + 9999) / 10000
}
```

---

## Buff Aggregation System

Combat power is affected by **multiple buff sources** that stack multiplicatively:

```
┌─────────────────────────────────────────────────────────────────┐
│              BUFF SOURCES (All Stack Multiplicatively)           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. HERO BUFFS (Personal)                                       │
│     ├── Direct stat buffs (AttackPower, DefensePower)          │
│     ├── Equipment efficiency (WeaponEfficiency, ArmorEfficiency)│
│     │   ├── Can INCREASE equipment max cap                     │
│     │   ├── Can ADD flat bonus on top                          │
│     │   └── Can MULTIPLY equipment bonus                       │
│     └── Activated on hero lock, scales with hero level         │
│                                                                 │
│  2. RESEARCH BUFFS (Personal)                                   │
│     ├── Attack Power research                                  │
│     ├── Defense Power research                                 │
│     ├── Critical Hit Chance/Damage                             │
│     └── One-time NOVI cost per level (scaling)                 │
│                                                                 │
│  3. MONUMENT BUFFS (City-Wide)                                  │
│     ├── Applied to all players in city                         │
│     ├── Cached in CityAccount.monument_buffs                   │
│     └── Examples: Colosseum (+15% ATK, +10% DEF)               │
│                                                                 │
│  4. CITY TYPE BUFFS (Location-Based)                            │
│     ├── Capital: Balanced (+5% all)                            │
│     ├── Combat: +15% ATK, +10% DEF                             │
│     ├── Resource: +20% collection                              │
│     └── Trade: +15% economy                                    │
│                                                                 │
│  5. EQUIPMENT COVERAGE (Gear-Based)                             │
│     ├── Weapon coverage: 0-100% based on weapons/units         │
│     ├── Ranged bonus: up to +10% (modified by hero)            │
│     ├── Vehicle bonus: up to +25% (drive-by potential)         │
│     └── Armor bonus: up to +15% defense                        │
│                                                                 │
│  6. TIME-OF-DAY (Temporal)                                      │
│     ├── Attack: φ at DeepNight, 1.0 at Midday                  │
│     └── Defense: 1/φ at DeepNight, φ at Midday                 │
│                                                                 │
│  7. LEVEL BONUS (Progression)                                   │
│     └── +1% per 10 levels (up to +10% at level 100)            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Hero Equipment Efficiency Buffs

Heroes with `WeaponEfficiency` or `ArmorEfficiency` buffs can modify equipment bonuses in three ways:

```rust
/// Hero buff application modes for equipment
#[repr(u8)]
pub enum EquipmentBuffMode {
    /// Increases the max cap (e.g., ranged max 10% → 15%)
    IncreaseCap = 0,
    /// Adds flat bonus on top (10% equipment + 5% hero = 15%)
    AddFlat = 1,
    /// Multiplies the equipment bonus (10% × 1.2 = 12%)
    Multiply = 2,
}

/// Apply hero equipment efficiency to base equipment bonus
pub fn apply_hero_equipment_buff(
    base_equipment_bonus_bps: u64,
    hero_efficiency_bps: u64,
    mode: EquipmentBuffMode,
    max_cap_bps: u64,
) -> u64 {
    match mode {
        EquipmentBuffMode::IncreaseCap => {
            // Hero increases the cap, equipment bonus unchanged
            // Cap is raised elsewhere in calculation
            base_equipment_bonus_bps
        }
        EquipmentBuffMode::AddFlat => {
            // Hero adds flat bonus on top
            base_equipment_bonus_bps.saturating_add(hero_efficiency_bps)
        }
        EquipmentBuffMode::Multiply => {
            // Hero multiplies the equipment bonus
            apply_bp_bonus(base_equipment_bonus_bps, hero_efficiency_bps as u16)
                .unwrap_or(base_equipment_bonus_bps)
        }
    }
}
```

### Buff Stacking Order

```rust
/// Final power calculation with all buff sources
/// Order: Base → Equipment → Hero → Research → Monument → City → Level → Time
pub fn calculate_final_attack_power(
    base_power: u64,
    equipment_mult_bps: u64,      // Weapon coverage + ranged + vehicle
    hero_attack_bps: u64,
    research_attack_bps: u64,
    monument_attack_bps: u64,
    city_attack_bps: u64,
    level_bonus_bps: u64,
    time_mult_bps: u64,
) -> u64 {
    // All multipliers are additive within their category, then multiplicative across
    // Each multiplier is 10000 = 1.0x, 11000 = 1.1x, etc.

    let multipliers = [
        equipment_mult_bps,
        10000 + hero_attack_bps,
        10000 + research_attack_bps,
        10000 + monument_attack_bps,
        10000 + city_attack_bps,
        10000 + level_bonus_bps,
        time_mult_bps,
    ];

    chain_bp(base_power, &multipliers).unwrap_or(0)
}
```

---

## Power Formulas

### Attack Power Formula

```rust
/// Calculate total attack power with ALL buff sources
/// ONLY defensive units contribute to attack power
pub fn calculate_total_attack_power(
    player: &PlayerAccount,
    locked_heroes: &[(&HeroAccount, &HeroTemplate)],
    research: &ResearchProgress,
    city: &CityAccount,
    time_of_day: TimeOfDay,
) -> u64 {
    // 1. BASE POWER: Defensive Units × Tier Weight
    let base_power: u64 = (player.defensive_unit_1 * 1)
        .saturating_add(player.defensive_unit_2 * 2)
        .saturating_add(player.defensive_unit_3 * 3);

    if base_power == 0 {
        return 0;
    }

    let total_defensive = player.total_defensive_units();
    let total_weapons = player.total_weapons();

    // 2. WEAPON COVERAGE (0-100%)
    let weapon_coverage_bps: u64 = if total_weapons >= total_defensive {
        10000
    } else if total_defensive > 0 {
        mul_div(total_weapons, 10000, total_defensive).unwrap_or(0)
    } else {
        10000
    };

    // 3. EQUIPMENT BONUSES (with hero modifications)
    let hero_weapon_eff = get_hero_buff(locked_heroes, BuffStat::WeaponEfficiency);

    // Ranged: base 10% max, hero can increase cap
    let ranged_max_bps = 1000 + (hero_weapon_eff / 2); // Hero adds to cap
    let ranged_bonus_bps = calculate_equipment_coverage_bonus(
        player.ranged_weapons,
        total_defensive,
        ranged_max_bps,
    );

    // Vehicles: base 25% max
    let vehicle_bonus_bps = calculate_equipment_coverage_bonus(
        player.vehicles,
        total_defensive,
        2500,
    );

    // 4. HERO ATTACK BUFF
    let hero_attack_bps = get_hero_buff(locked_heroes, BuffStat::AttackPower);

    // 5. RESEARCH BUFF
    let research_attack_bps = research.get_attack_power_bps() as u64;

    // 6. MONUMENT BUFF (city-wide)
    let monument_attack_bps = city.monument_buffs.attack_bps as u64;

    // 7. CITY TYPE BUFF
    let city_attack_bps = get_city_type_attack_bonus(city.city_type);

    // 8. LEVEL BONUS (+1% per 10 levels)
    let level_bonus_bps = ((player.level as u64) / 10) * 100;

    // 9. TIME-OF-DAY MULTIPLIER
    let time_mult_bps = get_time_multiplier_bps(time_of_day, ActivityType::Attacking);

    // 10. FINAL CALCULATION
    // Equipment multiplier combines coverage + bonuses
    let equipment_mult_bps = chain_bp(weapon_coverage_bps, &[
        10000 + ranged_bonus_bps,
        10000 + vehicle_bonus_bps,
    ]).unwrap_or(10000);

    calculate_final_attack_power(
        base_power,
        equipment_mult_bps,
        hero_attack_bps,
        research_attack_bps,
        monument_attack_bps,
        city_attack_bps,
        level_bonus_bps,
        time_mult_bps,
    )
}
```

### Defense Power Formula

```rust
/// Calculate total defense power with ALL buff sources
/// Includes: garrison + active reinforcements (not border reserves)
/// FALLBACK: If no garrison and no reinforcements, operatives defend at 50%
pub fn calculate_total_defense_power(
    player: &PlayerAccount,
    active_deployments: &[&DeploymentState],
    active_reinforcements: &[&ReinforcementAccount],
    locked_heroes: &[(&HeroAccount, &HeroTemplate)],
    research: &ResearchProgress,
    city: &CityAccount,
    time_of_day: TimeOfDay,
) -> (u64, bool) {  // Returns (power, is_fallback_mode)

    // 1. GARRISON: Defensive Units - ALL Deployed Units
    let mut total_deployed = [0u64; 3];
    for deploy in active_deployments.iter() {
        if deploy.attacker == player.owner && deploy.is_active {
            total_deployed[0] += deploy.deployed_def_1;
            total_deployed[1] += deploy.deployed_def_2;
            total_deployed[2] += deploy.deployed_def_3;
        }
    }

    let garrison = [
        player.defensive_unit_1.saturating_sub(total_deployed[0]),
        player.defensive_unit_2.saturating_sub(total_deployed[1]),
        player.defensive_unit_3.saturating_sub(total_deployed[2]),
    ];

    let garrison_power: u64 = (garrison[0] * 1)
        .saturating_add(garrison[1] * 2)
        .saturating_add(garrison[2] * 3);

    // 2. ACTIVE REINFORCEMENTS (not border reserves!)
    let mut reinforcement_power: u64 = 0;
    for reinf in active_reinforcements.iter() {
        if reinf.is_active() {
            reinforcement_power = reinforcement_power
                .saturating_add(reinf.effective_defense_power());
        }
    }

    // 3. CHECK FOR FALLBACK MODE
    let (base_defense, is_fallback) = if garrison_power == 0 && reinforcement_power == 0 {
        // No real defenders - check operatives
        let operative_power: u64 = (player.operative_unit_1 * 1)
            .saturating_add(player.operative_unit_2 * 2)
            .saturating_add(player.operative_unit_3 * 3);

        if operative_power == 0 {
            return (0, false); // Truly defenseless
        }

        // Operatives defend at 50% effectiveness
        let fallback_power = apply_bp(operative_power, 5000).unwrap_or(0);
        (fallback_power, true)
    } else {
        (garrison_power.saturating_add(reinforcement_power), false)
    };

    if base_defense == 0 {
        return (0, false);
    }

    // 4. ARMOR BONUS (with hero modifications)
    let total_garrison = garrison[0].saturating_add(garrison[1]).saturating_add(garrison[2]);
    let hero_armor_eff = get_hero_buff(locked_heroes, BuffStat::ArmorEfficiency);

    // Armor: base 15% max, hero can increase
    let armor_max_bps = 1500 + (hero_armor_eff / 2);
    let armor_bonus_bps = calculate_equipment_coverage_bonus(
        player.armor_pieces,
        total_garrison,
        armor_max_bps,
    );

    // 5. HERO DEFENSE BUFF
    let hero_defense_bps = get_hero_buff(locked_heroes, BuffStat::DefensePower);

    // 6. RESEARCH BUFF
    let research_defense_bps = research.get_defense_power_bps() as u64;

    // 7. MONUMENT BUFF
    let monument_defense_bps = city.monument_buffs.defense_bps as u64;

    // 8. CITY TYPE BUFF
    let city_defense_bps = get_city_type_defense_bonus(city.city_type);

    // 9. LEVEL BONUS
    let level_bonus_bps = ((player.level as u64) / 10) * 100;

    // 10. TIME-OF-DAY MULTIPLIER
    let time_mult_bps = get_time_multiplier_bps(time_of_day, ActivityType::Defending);

    // 11. FINAL CALCULATION
    let equipment_mult_bps = 10000 + armor_bonus_bps;

    let final_power = calculate_final_defense_power(
        base_defense,
        equipment_mult_bps,
        hero_defense_bps,
        research_defense_bps,
        monument_defense_bps,
        city_defense_bps,
        level_bonus_bps,
        time_mult_bps,
    );

    (final_power, is_fallback)
}
```

### City Type Bonuses

```rust
/// Get attack bonus for city type (basis points)
pub fn get_city_type_attack_bonus(city_type: u8) -> u64 {
    match city_type {
        0 => 500,   // Capital: +5%
        1 => 0,     // Resource: +0%
        2 => 1500,  // Combat: +15%
        3 => 0,     // Trade: +0%
        _ => 0,
    }
}

/// Get defense bonus for city type (basis points)
pub fn get_city_type_defense_bonus(city_type: u8) -> u64 {
    match city_type {
        0 => 500,   // Capital: +5%
        1 => 0,     // Resource: +0%
        2 => 1000,  // Combat: +10%
        3 => 0,     // Trade: +0%
        _ => 0,
    }
}
```

---

## Rally System

The Rally System handles **all cross-city attacks** - both solo and team coordinated. A "rally" is simply an attack with travel time, whether from one person or many.

### Rally Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    RALLY SYSTEM OVERVIEW                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  WHAT IS A RALLY?                                                         │
│  ├── An organized attack on a cross-city target                          │
│  ├── Can be SOLO (min_participants=1) or TEAM (min_participants=2+)      │
│  ├── Has 4 phases: Gather → March → Combat → Return                      │
│  └── All participants use DEFENSIVE units                                │
│                                                                           │
│  SOLO RALLY (Cross-City Attack)                                           │
│  ├── Leader creates rally with min_participants=1                        │
│  ├── No gathering phase (leader is the only participant)                 │
│  ├── March starts immediately                                            │
│  └── Simpler flow, same combat mechanics                                 │
│                                                                           │
│  TEAM RALLY (Coordinated Attack)                                          │
│  ├── Leader creates rally, sets gather_at time                           │
│  ├── Participants JOIN and travel to leader's location (rally point)     │
│  ├── All troops gather, then march together to target                    │
│  └── Combined power, distributed loot                                    │
│                                                                           │
│  KEY CONSTRAINT: Troops DON'T move until gather_at time                   │
│  ├── Joiners travel to rally point during gathering phase                │
│  ├── March to target only begins at gather_at (or when leader triggers)  │
│  └── This allows coordination and speedup opportunities                  │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### Rally Capacity

```
┌─────────────────────────────────────────────────────────────────┐
│              RALLY CAPACITY                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ACTIVE RALLY LIMIT (How many rallies can you lead/join?)       │
│  ─────────────────────────────────────────────────────────      │
│  Base:                    1 rally                               │
│  + Research (Command):    +1 to +4 (asymptotic φ)               │
│  + Subscription:          Free +0, Veteran +1, Legendary +2     │
│  ────────────────────────────────────                           │
│  Theoretical Max:         7 simultaneous rallies                │
│                                                                 │
│  UNIT COMMITMENT LIMIT (% of units that can be in rallies)      │
│  ─────────────────────────────────────────────────────────      │
│  Base:                    30% of defensive units                │
│  + Research (Deployment): approaches +60%                       │
│  + Subscription:          +0/+2/+5/+8/+10% by tier              │
│  ────────────────────────────────────────                       │
│  Theoretical Max:         ~90% of defensive units               │
│                                                                 │
│  REINFORCEMENT CAPACITY (Support sends)                         │
│  ─────────────────────────────────────────                      │
│  Base:                    1 send                                │
│  + Research (Logistics):  +1 to +3 (asymptotic φ)               │
│  + Subscription:          Free +0, Veteran +1, Legendary +2     │
│  + Team Size Bonus:       +1 per 10 teammates (max +3)          │
│  ────────────────────────────────────                           │
│  Theoretical Max:         9 simultaneous reinforcements out     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Capacity Calculation

```rust
/// Calculate max rally capacity (how many rallies can participate in)
pub fn calculate_max_rally_capacity(
    player: &PlayerAccount,
    research: &ResearchProgress,
) -> u8 {
    const BASE: u8 = 1;
    const RESEARCH_MAX: u64 = 4;

    let research_level = research.command_structure_level as u32;
    let research_bonus = asymptotic_capacity_ceil(RESEARCH_MAX, research_level) as u8;

    let sub_bonus = match player.get_effective_tier() {
        0 | 1 => 0,
        2 => 1,
        3 => 1,
        _ => 2,
    };

    BASE.saturating_add(research_bonus)
        .saturating_add(sub_bonus)
        .min(7)
}

/// Calculate max unit commitment percentage (basis points)
pub fn calculate_max_commitment_bps(
    player: &PlayerAccount,
    research: &ResearchProgress,
) -> u64 {
    const BASE_BPS: u64 = 3000;        // 30% base
    const RESEARCH_MAX_BPS: u64 = 6000; // +60% from research

    let research_level = research.deployment_efficiency_level as u32;
    let research_bonus = asymptotic_capacity(RESEARCH_MAX_BPS, research_level);

    let sub_bonus = match player.get_effective_tier() {
        0 => 0,
        1 => 200,
        2 => 500,
        3 => 800,
        _ => 1000,
    };

    BASE_BPS
        .saturating_add(research_bonus)
        .saturating_add(sub_bonus)
        .min(9000)
}
```

---

## Rally Phases

The rally system has **4 distinct phases**, each with its own mechanics and speedup opportunities.

### Phase Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    RALLY PHASE TIMELINE                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  TIME ──────────────────────────────────────────────────────────────────► │
│                                                                           │
│  CREATE        GATHER_AT         ARRIVE_AT          RETURN_COMPLETE       │
│    │              │                  │                     │              │
│    │◄─ GATHER ──►│◄─── MARCH ─────►│◄───── RETURN ──────►│              │
│    │              │                  │                     │              │
│    │  Joiners     │  All troops      │  Combat resolves    │  Units &     │
│    │  travel to   │  march to        │  at target          │  loot back   │
│    │  rally point │  target          │                     │  home        │
│    │              │                  │                     │              │
│                                                                           │
│  SPEEDUP POINTS:                                                          │
│  ├── GATHER: Joiner OR Leader can speed up joiner's travel to rally     │
│  ├── MARCH: Leader can speed up entire army's march to target           │
│  └── RETURN: Each participant can speed up their own return home        │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### Phase 1: GATHERING

```
┌───────────────────────────────────────────────────────────────────────┐
│                    PHASE 1: GATHERING                                    │
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  PURPOSE: Participants travel to the rally point (leader's city)        │
│                                                                         │
│  RALLIES ARE TEAM-FOCUSED:                                              │
│  ├── Intended for coordinated team attacks                             │
│  ├── If nobody joins, leader marches alone (becomes "solo")            │
│  └── min_participants=1 means: "can execute even if alone"             │
│                                                                         │
│  FLOW:                                                                  │
│  1. Leader creates rally at their location (rally point)               │
│  2. Leader sets gather_at time (when march will begin)                 │
│  3. Leader auto-joins (no travel needed, already there)                │
│  4. Teammates see rally and decide to JOIN                             │
│     ├── Their troops start traveling to rally point                    │
│     ├── Travel time = distance from their city to rally point          │
│     └── Creates RallyParticipant PDA for tracking                      │
│                                                                         │
│  SPEEDUP OPTIONS:                                                       │
│  ├── Joiner can speed up their OWN travel (pays gems)                  │
│  └── Leader can speed up ANY joiner's travel (leader pays gems)        │
│                                                                         │
│  ⚠️ LATE ARRIVAL = USER'S FAULT:                                        │
│  ├── If joiner doesn't arrive by gather_at → LEFT BEHIND               │
│  ├── Troops do NOT auto-return!                                        │
│  ├── Joiner must MANUALLY RECALL their troops                          │
│  ├── Troops stay "in transit" until recalled                           │
│  └── Strategic lesson: Calculate travel time before joining!           │
│                                                                         │
│  WHY NO AUTO-RETURN?                                                    │
│  ├── Punishes poor planning                                            │
│  ├── Creates strategic depth (timing matters!)                         │
│  ├── Troops aren't lost, just stuck until recalled                     │
│  └── User can still speedup the recall                                 │
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

### Phase 2: MARCHING

```
┌───────────────────────────────────────────────────────────────────────┐
│                    PHASE 2: MARCHING                                     │
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  PURPOSE: Combined army travels from rally point to target              │
│                                                                         │
│  TRIGGER:                                                               │
│  ├── Automatically at gather_at time (if min_participants met)         │
│  └── OR leader manually triggers early (if all joiners arrived)        │
│                                                                         │
│  FLOW:                                                                  │
│  1. Validate: minimum participants present                             │
│  2. Calculate: march_duration based on rally_point → target distance   │
│  3. Set: arrive_at = now + march_duration                              │
│  4. Status: MARCHING                                                   │
│                                                                         │
│  SPEEDUP OPTIONS:                                                       │
│  └── Leader can speed up march (affects entire army, leader pays)      │
│                                                                         │
│  ARMY COMPOSITION:                                                      │
│  ├── Combined power from all arrived participants                      │
│  ├── Late arrivals (missed gather_at) NOT included                     │
│  └── Heroes from all participants contribute buffs                     │
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

### Phase 3: COMBAT

```
┌───────────────────────────────────────────────────────────────────────┐
│                    PHASE 3: COMBAT                                       │
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  PURPOSE: Execute attack at target location                             │
│                                                                         │
│  TRIGGER: Crank after arrive_at time reached                           │
│                                                                         │
│  ATTACKER POWER:                                                        │
│  ├── Sum of all participant contributions                              │
│  ├── Aggregate buffs (team average research, combined hero buffs)      │
│  ├── Monument buff from rally point city                               │
│  └── Time-of-day multiplier at combat time                             │
│                                                                         │
│  DEFENDER POWER:                                                        │
│  ├── Garrison (defensive - deployed elsewhere)                         │
│  ├── + Active reinforcements                                           │
│  ├── + Operative fallback (50%) if no garrison/reinforcements          │
│  ├── All defender buffs (Hero, Research, Monument, City, Time)         │
│  └── Border reserves auto-fill after casualties                        │
│                                                                         │
│  CASUALTY DISTRIBUTION:                                                 │
│  ├── Attacker casualties distributed proportionally by contribution    │
│  └── Defender casualties hit garrison first, then reinforcements       │
│                                                                         │
│  LOOT DISTRIBUTION:                                                     │
│  ├── Total loot calculated from damage ratio                           │
│  └── Distributed proportionally by contribution                        │
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

### Phase 4: RETURNING

```
┌───────────────────────────────────────────────────────────────────────┐
│                    PHASE 4: RETURNING                                    │
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  PURPOSE: Participants return to their HOME cities (not rally point!)   │
│                                                                         │
│  KEY INSIGHT: Each participant returns to their OWN home city          │
│  ├── Return travel = target → participant's home city                  │
│  ├── Each participant has DIFFERENT return duration                    │
│  └── Leader returns to rally point (which is their home)               │
│                                                                         │
│  FLOW:                                                                  │
│  1. After combat, set return times for each participant                │
│  2. Each participant's return_duration = target → home distance        │
│  3. Status: RETURNING                                                  │
│                                                                         │
│  SPEEDUP OPTIONS:                                                       │
│  └── Each participant can speed up their OWN return (pays own gems)    │
│                                                                         │
│  ON ARRIVAL HOME:                                                       │
│  1. Surviving units restored to participant                            │
│  2. Loot share transferred to participant                              │
│  3. Hero unlocked                                                      │
│  4. RallyParticipant PDA closed (rent refunded)                        │
│                                                                         │
│  RALLY COMPLETION:                                                      │
│  └── When ALL participants have returned, RallyAccount is closed       │
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

### Rally Flow (Team-Focused)

Rallies are **designed for team coordination**. Solo execution only happens when no teammates join.

```
┌───────────────────────────────────────────────────────────────────────┐
│                    RALLY LIFECYCLE (Full Flow)                           │
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  CREATE_RALLY (Leader)                                                  │
│     │                                                                   │
│     ├── Set: target, gather_at, min_participants (usually 1)           │
│     ├── Leader auto-joins (already at rally point)                     │
│     └── Status → GATHERING                                             │
│     │                                                                   │
│     ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  GATHERING PHASE                                                 │   │
│  │                                                                  │   │
│  │  JOIN_RALLY (Teammates decide to join)                          │   │
│  │     ├── Troops start traveling: home city → rally point         │   │
│  │     ├── Can SPEEDUP_GATHER (joiner or leader pays)              │   │
│  │     │                                                           │   │
│  │     ▼                                                           │   │
│  │  PROCESS_JOINER_ARRIVAL (crank when travel complete)            │   │
│  │     └── Mark joiner as "arrived"                                │   │
│  │                                                                  │   │
│  │  ⚠️ IF JOINER LATE (didn't arrive by gather_at):                │   │
│  │     ├── NOT included in rally                                   │   │
│  │     ├── Troops STUCK in transit                                 │   │
│  │     ├── Must call RECALL_LATE_JOINER manually                   │   │
│  │     └── User's fault for bad timing!                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│     │                                                                   │
│     ▼                                                                   │
│  START_MARCH (at gather_at time)                                       │
│     │                                                                   │
│     ├── Only ARRIVED participants join the march                       │
│     ├── Could be leader alone (if no one else arrived)                │
│     └── Status → MARCHING                                             │
│     │                                                                   │
│     ▼                                                                   │
│  [MARCH to target] ←── Leader can SPEEDUP_MARCH                        │
│     │                                                                   │
│     ▼                                                                   │
│  EXECUTE_RALLY (crank after arrive_at)                                 │
│     │                                                                   │
│     ├── Combined power vs target (garrison + reinforcements)          │
│     ├── Operative fallback if no garrison                             │
│     ├── Casualties distributed proportionally                         │
│     ├── Loot distributed proportionally                               │
│     ├── Border reserves auto-fill for defender                        │
│     └── Status → RETURNING                                             │
│     │                                                                   │
│     ▼                                                                   │
│  [Each participant returns to THEIR OWN home city]                     │
│     │                                                                   │
│     ├── Different return times based on distance to home              │
│     ├── Each can SPEEDUP_RETURN independently                          │
│     │                                                                   │
│     ▼                                                                   │
│  PROCESS_RETURN (crank for each participant)                           │
│     │                                                                   │
│     ├── Surviving units restored                                       │
│     ├── Loot share transferred                                        │
│     ├── Hero unlocked                                                 │
│     └── RallyParticipant closed                                       │
│     │                                                                   │
│     ▼                                                                   │
│  CLOSE_RALLY (when ALL participants returned)                          │
│     └── RallyAccount closed, rent refunded to leader                   │
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

### Late Joiner Recall Flow

```
┌───────────────────────────────────────────────────────────────────────┐
│                    LATE JOINER RECALL                                    │
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  SCENARIO: Player joined rally but didn't arrive by gather_at           │
│                                                                         │
│  STATE:                                                                 │
│  ├── Rally has moved on to MARCHING/COMBAT/RETURNING                   │
│  ├── Late joiner's troops are STUCK (status = "traveling to rally")    │
│  └── Joiner must manually recall                                       │
│                                                                         │
│  RECALL_LATE_JOINER (only late joiners can call)                       │
│     │                                                                   │
│     ├── Validate: caller is late joiner (not arrived, rally marching+) │
│     ├── Calculate: return_duration = current_position → home city      │
│     ├── Note: Troops may have traveled partially, return from there    │
│     └── Status → RETURNING_HOME (separate from rally return)           │
│     │                                                                   │
│     ▼                                                                   │
│  [RETURN home] ←── Can SPEEDUP_RETURN                                  │
│     │                                                                   │
│     ▼                                                                   │
│  PROCESS_LATE_RETURN (crank)                                           │
│     │                                                                   │
│     ├── Units restored to player (no casualties!)                      │
│     ├── No loot (didn't participate)                                   │
│     └── RallyParticipant closed                                        │
│                                                                         │
│  LESSON LEARNED: Check travel time before joining!                      │
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Rally Speedup System

Three distinct speedup opportunities during a rally:

### Speedup Matrix

| Phase | Who Can Speedup | Who Pays | What Changes | Cost Calculation |
|-------|-----------------|----------|--------------|------------------|
| **Gather** | Joiner (self) | Joiner | That joiner's `arrives_at_rally` | remaining_min × gems/min |
| **Gather** | Leader (any joiner) | Leader | That joiner's `arrives_at_rally` | remaining_min × gems/min |
| **March** | Leader only | Leader | Entire rally's `arrive_at` | remaining_min × gems/min |
| **Return** | Each participant | Self | Their own return time | remaining_min × gems/min |

### Speedup Tiers

| Tier | Time Reduction | Gem Cost Multiplier |
|------|----------------|---------------------|
| 1 | 50% (2× speed) | 1× |
| 2 | 75% (4× speed) | 2× |
| 3 | 87.5% (8× speed) | 4× |

### Speedup Implementation

```rust
/// Speed up joiner's travel to rally point
/// Can be called by joiner OR leader
pub fn speedup_gather(
    rally: &RallyAccount,
    participant: &mut RallyParticipant,
    payer: &mut PlayerAccount,
    speedup_tier: u8,
    now: i64,
) -> Result<(), GameError> {
    // Must be in gathering phase
    if rally.status != RallyStatus::Gathering as u8 {
        return Err(GameError::InvalidRallyStatus);
    }

    // Participant must not have arrived yet
    if participant.arrived_at_rally {
        return Err(GameError::AlreadyArrived);
    }

    let remaining = participant.arrives_at_rally - now;
    if remaining <= 0 {
        return Err(GameError::AlreadyArrived);
    }

    let (time_mult, cost_mult) = match speedup_tier {
        1 => (5000, 1),   // 50% remaining
        2 => (2500, 2),   // 25% remaining
        3 => (1250, 4),   // 12.5% remaining
        _ => return Err(GameError::InvalidParameter),
    };

    let new_remaining = apply_bp(remaining as u64, time_mult).unwrap_or(0) as i64;
    let remaining_minutes = ((remaining as f64) / 60.0).ceil() as u64;
    let gem_cost = remaining_minutes * GEMS_PER_MINUTE * cost_mult;

    if payer.gems < gem_cost {
        return Err(GameError::InsufficientGems);
    }

    payer.gems -= gem_cost;
    participant.arrives_at_rally = now + new_remaining;

    Ok(())
}

/// Speed up march to target (leader only)
pub fn speedup_march(
    rally: &mut RallyAccount,
    leader: &mut PlayerAccount,
    speedup_tier: u8,
    now: i64,
) -> Result<(), GameError> {
    // Must be marching
    if rally.status != RallyStatus::Marching as u8 {
        return Err(GameError::InvalidRallyStatus);
    }

    // Must be leader
    if leader.owner != rally.creator {
        return Err(GameError::NotRallyLeader);
    }

    let remaining = rally.arrive_at - now;
    if remaining <= 0 {
        return Err(GameError::AlreadyArrived);
    }

    let (time_mult, cost_mult) = match speedup_tier {
        1 => (5000, 1),
        2 => (2500, 2),
        3 => (1250, 4),
        _ => return Err(GameError::InvalidParameter),
    };

    let new_remaining = apply_bp(remaining as u64, time_mult).unwrap_or(0) as i64;
    let remaining_minutes = ((remaining as f64) / 60.0).ceil() as u64;
    let gem_cost = remaining_minutes * GEMS_PER_MINUTE * cost_mult;

    if leader.gems < gem_cost {
        return Err(GameError::InsufficientGems);
    }

    leader.gems -= gem_cost;
    rally.arrive_at = now + new_remaining;

    Ok(())
}

/// Speed up participant's return home
pub fn speedup_return(
    rally: &RallyAccount,
    participant: &mut RallyParticipant,
    payer: &mut PlayerAccount,
    speedup_tier: u8,
    now: i64,
) -> Result<(), GameError> {
    // Must be returning
    if rally.status != RallyStatus::Returning as u8 {
        return Err(GameError::InvalidRallyStatus);
    }

    // Must be the participant
    if payer.owner != participant.participant {
        return Err(GameError::NotYourParticipation);
    }

    let return_at = participant.return_started_at + participant.return_duration as i64;
    let remaining = return_at - now;
    if remaining <= 0 {
        return Err(GameError::AlreadyArrived);
    }

    let (time_mult, cost_mult) = match speedup_tier {
        1 => (5000, 1),
        2 => (2500, 2),
        3 => (1250, 4),
        _ => return Err(GameError::InvalidParameter),
    };

    let new_remaining = apply_bp(remaining as u64, time_mult).unwrap_or(0) as i64;
    let remaining_minutes = ((remaining as f64) / 60.0).ceil() as u64;
    let gem_cost = remaining_minutes * GEMS_PER_MINUTE * cost_mult;

    if payer.gems < gem_cost {
        return Err(GameError::InsufficientGems);
    }

    payer.gems -= gem_cost;
    participant.return_duration = (participant.return_duration as i64 - remaining + new_remaining) as i32;

    Ok(())
}
```

---

## Reinforcement System

### Reinforcement Constraints

```
┌───────────────────────────────────────────────────────────────────────┐
│              REINFORCEMENT CONSTRAINTS                                  │
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  REQUIREMENTS                                                           │
│  ├── Sender & Receiver MUST be on same team                            │
│  ├── Sender must have Military Logistics research unlocked             │
│  ├── Sender must have free reinforcement slot                          │
│  └── Sender pays NOVI travel cost (burned)                             │
│                                                                         │
│  SENDER LIMITS (Asymptotic φ Scaling)                                   │
│  ├── Base sendable: 20% of defensive units                             │
│  ├── + Research (Support Logistics): approaches +70%                   │
│  └── Theoretical max: ~90% at max research                             │
│  Note: This is TOTAL across all reinforcements, not per-send           │
│                                                                         │
│  RECEIVER LIMITS (Asymptotic φ Scaling)                                 │
│  ├── Base capacity: 500 units                                          │
│  ├── + Research (Reinforcement Capacity): approaches +9,500            │
│  └── Theoretical max: ~10,000 units                                    │
│  Note: No limit on HOW MANY teammates, just total units                │
│                                                                         │
│  HERO BONUS                                                             │
│  ├── Optional: Send hero with reinforcements                           │
│  ├── Hero activates IMMEDIATELY (+20% to all units sent)               │
│  └── Hero travels with units but buff is instant                       │
│                                                                         │
│  OVERFLOW → BORDER RESERVE                                              │
│  ├── If receiver at capacity, excess goes to border queue              │
│  ├── Border units don't count in defense until activated               │
│  └── Auto-fill when active reinforcements take casualties              │
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

### Capacity Calculations

```rust
/// Calculate sender's max units that can be out as reinforcements
/// Uses asymptotic φ scaling
pub fn calculate_max_reinforcement_send_bps(research: &ResearchProgress) -> u64 {
    const BASE_BPS: u64 = 2000;         // 20% base
    const RESEARCH_MAX_BPS: u64 = 7000; // +70% from research (approaches)

    let research_level = research.support_logistics_level as u32;
    let research_bonus = asymptotic_capacity(RESEARCH_MAX_BPS, research_level);

    BASE_BPS.saturating_add(research_bonus).min(9000)
}

/// Calculate receiver's max reinforcement capacity (units)
pub fn calculate_max_reinforcement_receive(research: &ResearchProgress) -> u64 {
    const BASE_CAPACITY: u64 = 500;
    const RESEARCH_MAX: u64 = 9500; // Approaches +9,500

    let research_level = research.reinforcement_capacity_level as u32;
    let research_bonus = asymptotic_capacity(RESEARCH_MAX, research_level);

    BASE_CAPACITY.saturating_add(research_bonus)
}

/// Calculate how many units sender currently has out reinforcing
pub fn calculate_units_currently_reinforcing(
    reinforcements: &[&ReinforcementAccount],
    sender: &Pubkey,
) -> u64 {
    reinforcements.iter()
        .filter(|r| &r.sender == sender && !r.has_returned())
        .map(|r| r.total_units() + r.total_overflow_units())
        .sum()
}
```

### Reinforcement Flow

```
┌───────────────────────────────────────────────────────────────────────┐
│                     REINFORCEMENT LIFECYCLE                             │
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. SEND_REINFORCEMENT                                                  │
│     ├── Validate: same team, sender has Military Logistics             │
│     ├── Validate: sender has reinforcement slot                         │
│     ├── Validate: sender within send limit                              │
│     ├── Calculate: how many fit in receiver capacity                   │
│     │   ├── If all fit → all go to active                              │
│     │   └── If overflow → excess goes to border reserve                │
│     ├── Burn: NOVI travel cost                                         │
│     ├── Create: ReinforcementAccount PDA                               │
│     ├── Update: sender.active_reinforcement_mask                       │
│     └── Lock: hero immediately (buff activates now!)                   │
│                                                                         │
│  2. PROCESS_REINFORCEMENT_ARRIVAL (crank, after travel time)           │
│     ├── Validate: reinforcement is traveling                           │
│     ├── Update: arrived_at = now                                       │
│     └── Note: Units already assigned (active vs border) on send        │
│                                                                         │
│  3. RECALL_REINFORCEMENT (sender wants units back)                     │
│     ├── Validate: reinforcement exists, sender owns it                 │
│     ├── Update: recall_initiated = now                                 │
│     └── Start return travel (active + border both return)              │
│                                                                         │
│  4. RELIEVE_REINFORCEMENT (receiver dismisses)                         │
│     ├── Validate: reinforcement exists, receiver's garrison            │
│     ├── Update: recall_initiated = now                                 │
│     └── Same as recall but initiated by receiver                       │
│                                                                         │
│  5. PROCESS_REINFORCEMENT_RETURN (crank, after recall + travel time)   │
│     ├── Validate: recall initiated, travel time elapsed                │
│     ├── Restore: all units (active + border) to sender                 │
│     ├── Unlock: hero                                                   │
│     ├── Update: sender.active_reinforcement_mask (clear slot)          │
│     └── Close: ReinforcementAccount (rent refund)                      │
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Border Reserve Queue

When reinforcements overflow receiver capacity, excess units wait at the "border" and auto-fill when active units die.

### Border Reserve Rules

```
┌───────────────────────────────────────────────────────────────────────┐
│              BORDER RESERVE SYSTEM                                      │
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ACTIVE GARRISON (Counts in Defense Power)                              │
│  ├── Receiver's own defensive units                                    │
│  └── Active reinforcements (up to capacity)                            │
│                                                                         │
│  BORDER RESERVE (Does NOT Count in Defense Power)                       │
│  ├── Overflow reinforcement units waiting at border                    │
│  ├── FIFO queue: first to arrive, first to fill                        │
│  ├── Visible on-chain (no hiding)                                      │
│  └── No resource consumption while waiting                             │
│                                                                         │
│  AUTO-FILL TRIGGER (After Attack)                                       │
│  ├── Combat resolves against active garrison only                      │
│  ├── Some active reinforcement units die                               │
│  ├── Capacity freed up = dead units count                              │
│  ├── Border reserves fill gaps in FIFO order                           │
│  └── Attacker doesn't know depth of reserves!                          │
│                                                                         │
│  CONTROLS                                                               │
│  ├── Sender: can recall from border anytime                            │
│  ├── Receiver: can relieve (dismiss) from border anytime               │
│  └── Receiver: can accept_overflow if capacity increases               │
│                                                                         │
│  HERO AT BORDER                                                         │
│  └── Hero buff activates IMMEDIATELY even if units at border           │
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

### Auto-Fill Implementation

```rust
/// Process border reserve auto-fill after combat
/// Called after attack resolves and active reinforcements took casualties
pub fn process_border_autofill(
    receiver: &Pubkey,
    capacity_freed: u64,
    reinforcements: &mut [&mut ReinforcementAccount],
) -> u64 {
    if capacity_freed == 0 {
        return 0;
    }

    let mut remaining_capacity = capacity_freed;
    let mut total_activated = 0u64;

    // Sort by arrival time (FIFO)
    reinforcements.sort_by_key(|r| r.sent_at);

    for reinf in reinforcements.iter_mut() {
        if &reinf.receiver != receiver {
            continue;
        }
        if remaining_capacity == 0 {
            break;
        }

        // Check if has overflow units
        let overflow_total = reinf.total_overflow_units();
        if overflow_total == 0 {
            continue;
        }

        // Calculate how many can be activated
        let to_activate = overflow_total.min(remaining_capacity);

        // Move units from overflow to active (proportionally by tier)
        let activation_ratio_bps = mul_div(to_activate, 10000, overflow_total).unwrap_or(10000);

        let activate_def_1 = apply_bp(reinf.overflow_def_1, activation_ratio_bps).unwrap_or(0);
        let activate_def_2 = apply_bp(reinf.overflow_def_2, activation_ratio_bps).unwrap_or(0);
        let activate_def_3 = apply_bp(reinf.overflow_def_3, activation_ratio_bps).unwrap_or(0);

        reinf.units_def_1 = reinf.units_def_1.saturating_add(activate_def_1);
        reinf.units_def_2 = reinf.units_def_2.saturating_add(activate_def_2);
        reinf.units_def_3 = reinf.units_def_3.saturating_add(activate_def_3);

        reinf.overflow_def_1 = reinf.overflow_def_1.saturating_sub(activate_def_1);
        reinf.overflow_def_2 = reinf.overflow_def_2.saturating_sub(activate_def_2);
        reinf.overflow_def_3 = reinf.overflow_def_3.saturating_sub(activate_def_3);

        let activated = activate_def_1 + activate_def_2 + activate_def_3;
        remaining_capacity = remaining_capacity.saturating_sub(activated);
        total_activated += activated;
    }

    total_activated
}
```

---

## Gem Speedup System

Reuses existing travel speedup logic for deployment marches.

### Speedup Tiers

| Tier | Time Reduction | Gem Cost Multiplier |
|------|----------------|---------------------|
| 1 | 50% (2× speed) | 1× |
| 2 | 75% (4× speed) | 2× |
| 3 | 87.5% (8× speed) | 4× |

### Speedup Implementation

```rust
/// Speed up deployment (outbound OR return)
/// Reuses travel speedup logic from travel/speedup.rs
pub fn speedup_deployment(
    deployment: &mut DeploymentState,
    player: &mut PlayerAccount,
    gameplay_config: &GameplayConfig,
    speedup_tier: u8,
    now: i64,
    speedup_phase: DeploymentPhase,
) -> Result<(), GameError> {
    // Determine which timestamp to modify
    let target_time = match speedup_phase {
        DeploymentPhase::Outbound => {
            if deployment.attack_completed {
                return Err(GameError::AlreadyArrived);
            }
            &mut deployment.arrival_time
        }
        DeploymentPhase::Return => {
            if !deployment.attack_completed {
                return Err(GameError::NotReturning);
            }
            &mut deployment.return_time
        }
    };

    if now >= *target_time {
        return Err(GameError::AlreadyArrived);
    }

    let remaining_seconds = *target_time - now;
    let remaining_minutes = ((remaining_seconds as f64) / 60.0).ceil() as u64;

    if remaining_minutes == 0 {
        return Err(GameError::InvalidParameter);
    }

    // Calculate time reduction
    let (time_mult, cost_mult): (f64, u64) = match speedup_tier {
        1 => (0.5, 1),
        2 => (0.25, 2),
        3 => (0.125, 4),
        _ => return Err(GameError::InvalidParameter),
    };

    let new_remaining = (remaining_seconds as f64 * time_mult) as i64;

    // Calculate gem cost
    let gems_per_minute = gameplay_config.gem_cost_per_minute_speedup as u64;
    let gem_cost = remaining_minutes
        .saturating_mul(gems_per_minute)
        .saturating_mul(cost_mult);

    if player.gems < gem_cost {
        return Err(GameError::InsufficientGems);
    }

    // Apply
    player.gems = player.gems.saturating_sub(gem_cost);
    *target_time = now + new_remaining;

    Ok(())
}

#[repr(u8)]
pub enum DeploymentPhase {
    Outbound = 0,
    Return = 1,
}
```

---

## New Research Nodes

### Research Type IDs

```rust
// Existing Battle Research (0-9)
pub const RESEARCH_ATTACK_POWER: u8 = 0;
pub const RESEARCH_DEFENSE_POWER: u8 = 1;
pub const RESEARCH_CRIT_CHANCE: u8 = 2;
pub const RESEARCH_CRIT_DAMAGE: u8 = 3;
pub const RESEARCH_RALLY_CAPACITY: u8 = 5;
pub const RESEARCH_AMBUSH_DAMAGE: u8 = 9;

// NEW Battle Research (30-36)
pub const RESEARCH_MILITARY_LOGISTICS: u8 = 30;      // Unlock reinforcements
pub const RESEARCH_DEPLOYMENT_EFFICIENCY: u8 = 31;   // % units deployable
pub const RESEARCH_REINFORCEMENT_CAPACITY: u8 = 32;  // Units receivable
pub const RESEARCH_COMMAND_STRUCTURE: u8 = 33;       // Attack march slots
pub const RESEARCH_LOGISTICS_MASTERY: u8 = 34;       // Reinforcement march slots
pub const RESEARCH_SUPPORT_LOGISTICS: u8 = 35;       // % units sendable as reinf
```

### Research Templates

```rust
// Military Logistics (research_type = 30)
// UNLOCK ONLY - Enables reinforcement system
ResearchTemplate {
    research_type: 30,
    category: 0, // Battle
    max_level: 1,
    base_time_seconds: 86400, // 24 hours
    base_novi_cost: 50_000,
    buff_type: 30,
    buff_per_level_bps: 0, // Just an unlock
    prerequisite_research: 1, // Defense Power
    prerequisite_level: 10,
}

// Deployment Efficiency (research_type = 31)
// Increases % of units deployable (asymptotic toward +60%)
ResearchTemplate {
    research_type: 31,
    category: 0, // Battle
    max_level: 15, // Diminishing returns means high levels less valuable
    base_time_seconds: 7200, // 2 hours
    base_novi_cost: 10_000,
    buff_type: 31,
    // Uses asymptotic φ scaling, not linear bps
    prerequisite_research: 0, // Attack Power
    prerequisite_level: 5,
}

// Reinforcement Capacity (research_type = 32)
// Increases units receivable (asymptotic toward +9,500)
ResearchTemplate {
    research_type: 32,
    category: 0, // Battle
    max_level: 15,
    base_time_seconds: 14400, // 4 hours
    base_novi_cost: 20_000,
    buff_type: 32,
    prerequisite_research: 30, // Military Logistics
    prerequisite_level: 1,
}

// Command Structure (research_type = 33)
// Increases attack march slots (asymptotic toward +4)
ResearchTemplate {
    research_type: 33,
    category: 0, // Battle
    max_level: 10,
    base_time_seconds: 21600, // 6 hours
    base_novi_cost: 30_000,
    buff_type: 33,
    prerequisite_research: 31, // Deployment Efficiency
    prerequisite_level: 5,
}

// Logistics Mastery (research_type = 34)
// Increases reinforcement send slots (asymptotic toward +3)
ResearchTemplate {
    research_type: 34,
    category: 0, // Battle
    max_level: 8,
    base_time_seconds: 18000, // 5 hours
    base_novi_cost: 25_000,
    buff_type: 34,
    prerequisite_research: 30, // Military Logistics
    prerequisite_level: 1,
}

// Support Logistics (research_type = 35)
// Increases % of units sendable as reinforcements (asymptotic toward +70%)
ResearchTemplate {
    research_type: 35,
    category: 0, // Battle
    max_level: 15,
    base_time_seconds: 10800, // 3 hours
    base_novi_cost: 15_000,
    buff_type: 35,
    prerequisite_research: 30, // Military Logistics
    prerequisite_level: 1,
}
```

### Updated Tech Tree

```
Battle Research Tree:
├─ Attack Power (no prereq)
│   ├─► Deployment Efficiency (prereq: Attack 5)
│   │   └─► Command Structure (prereq: Deploy Eff 5)
│   └─► Ambush Damage (prereq: Attack 15)
│
├─ Defense Power (no prereq)
│   └─► Military Logistics (prereq: Defense 10)  ← UNLOCK NODE
│       ├─► Reinforcement Capacity (prereq: Logistics 1)
│       ├─► Logistics Mastery (prereq: Logistics 1)
│       └─► Support Logistics (prereq: Logistics 1)
│
├─ Critical Hit Chance (prereq: Attack 10)
│   └─► Critical Hit Damage (prereq: Crit Chance 10)
│
└─ Rally Capacity (prereq: Attack 5 + Defense 5)
```

---

## Time-Based Combat Modifiers

Integration with `logic/time_cycle.rs`:

### Combat Time Multipliers

| Time | Attack Mult | Defense Mult | Strategic Implication |
|------|-------------|--------------|----------------------|
| DeepNight | φ (1.618×) | 1/φ (0.618×) | **PRIME ATTACK WINDOW** |
| Dawn | √φ (1.272×) | 1.0× | Surprise attacks work |
| Morning | 1.0× | √φ (1.272×) | Defenders waking up |
| Midday | 1.0× | φ (1.618×) | **PRIME DEFENSE WINDOW** |
| Afternoon | 1.0× | √φ (1.272×) | Defenders still alert |
| Dusk | 1.0× | 1.0× | Neutral window |
| Evening | 1.0× | 1.0× | Preparing for night |

### Time Multiplier in BPS

```rust
pub fn get_time_multiplier_bps(time: TimeOfDay, activity: ActivityType) -> u64 {
    const PHI_BPS: u64 = 16180;         // 1.618
    const GOLDEN_ROOT_BPS: u64 = 12720; // 1.272
    const PHI_INVERSE_BPS: u64 = 6180;  // 0.618
    const NEUTRAL_BPS: u64 = 10000;     // 1.0

    match activity {
        ActivityType::Attacking => match time {
            TimeOfDay::DeepNight => PHI_BPS,
            TimeOfDay::Dawn => GOLDEN_ROOT_BPS,
            _ => NEUTRAL_BPS,
        },
        ActivityType::Defending => match time {
            TimeOfDay::DeepNight => PHI_INVERSE_BPS,
            TimeOfDay::Morning | TimeOfDay::Afternoon => GOLDEN_ROOT_BPS,
            TimeOfDay::Midday => PHI_BPS,
            _ => NEUTRAL_BPS,
        },
        _ => NEUTRAL_BPS,
    }
}
```

---

## State Structures

### RallyAccount (~280 bytes)

```rust
/// PDA: ["rally", rally_id_u64_le_bytes]
#[repr(C)]
#[derive(Copy, Clone)]
pub struct RallyAccount {
    // Identity (16 bytes)
    pub id: u64,                        // Unique rally ID
    pub creator: Pubkey,                // 32 bytes - Rally leader

    // Rally Point (2 bytes)
    pub rally_city: u16,                // Where troops gather (creator's city)

    // Target (34 bytes)
    pub target: Pubkey,                 // 32 bytes - Target player
    pub target_city: u16,               // 2 bytes

    // Timing (40 bytes)
    pub created_at: i64,
    pub gather_at: i64,                 // When gathering ends, march begins
    pub march_started_at: i64,          // Actual march start time
    pub arrive_at: i64,                 // When combat happens
    pub march_duration: i32,            // Rally point → target (seconds)
    pub _padding1: [u8; 4],

    // Participation (24 bytes)
    pub min_participants: u8,           // Usually 1 (can execute alone)
    pub max_participants: u8,           // Cap (e.g., 20)
    pub participant_count: u8,          // Current count
    pub arrived_count: u8,              // How many have arrived at rally point
    pub _padding2: [u8; 4],
    pub total_power: u64,               // Combined power of arrived participants

    // Status (8 bytes)
    pub status: u8,                     // RallyStatus enum
    pub _padding3: [u8; 7],

    // Combat results (24 bytes) - filled after execute
    pub total_loot_cash: u64,
    pub total_loot_locked_novi: u64,
    pub total_casualties: u64,

    // Bump (8 bytes)
    pub bump: u8,
    pub _padding4: [u8; 7],
}

/// Rally status enum
#[repr(u8)]
pub enum RallyStatus {
    Gathering = 0,      // Joiners traveling to rally point
    Marching = 1,       // Army moving to target
    Arrived = 2,        // At target, ready to execute
    Executed = 3,       // Combat resolved
    Returning = 4,      // Participants returning home
    Completed = 5,      // All returned, ready to close
    Cancelled = 6,      // Rally was cancelled
}

impl RallyAccount {
    pub const LEN: usize = 280;
    pub const SEED: &'static [u8] = b"rally";

    pub fn derive_pda(rally_id: u64) -> (Pubkey, u8) {
        let id_bytes = rally_id.to_le_bytes();
        pinocchio::pubkey::find_program_address(
            &[Self::SEED, &id_bytes],
            &crate::ID,
        )
    }

    pub fn is_gathering(&self) -> bool {
        self.status == RallyStatus::Gathering as u8
    }

    pub fn is_marching(&self) -> bool {
        self.status == RallyStatus::Marching as u8
    }

    pub fn can_join(&self) -> bool {
        self.is_gathering() && self.participant_count < self.max_participants
    }
}
```

### RallyParticipant (~200 bytes)

```rust
/// PDA: ["rally_participant", rally_id_u64_le_bytes, participant_pubkey]
#[repr(C)]
#[derive(Copy, Clone)]
pub struct RallyParticipant {
    // Identity (40 bytes)
    pub rally_id: u64,
    pub participant: Pubkey,            // 32 bytes

    // Home city (2 bytes)
    pub home_city: u16,

    // Units committed (24 bytes)
    pub units_def_1: u64,
    pub units_def_2: u64,
    pub units_def_3: u64,

    // Hero (40 bytes)
    pub hero: Pubkey,                   // 32 bytes (NULL_PUBKEY if none)
    pub hero_slot: u8,
    pub _padding1: [u8; 7],

    // Phase 1: Travel to rally point (24 bytes)
    pub travel_to_rally_started: i64,
    pub travel_to_rally_duration: i32,
    pub arrives_at_rally: i64,          // When they reach rally point

    // Status flags (8 bytes)
    pub arrived_at_rally: bool,         // Made it to rally point?
    pub included_in_march: bool,        // Was included in the march? (false if late)
    pub returned: bool,                 // Has returned home?
    pub _padding2: [u8; 5],

    // Combat results (24 bytes) - filled after execute
    pub casualties_def_1: u64,
    pub casualties_def_2: u64,
    pub casualties_def_3: u64,

    // Loot share (8 bytes)
    pub loot_share_cash: u64,
    pub loot_share_locked_novi: u64,

    // Phase 4: Return home (16 bytes)
    pub return_started_at: i64,
    pub return_duration: i32,           // Target → home city (seconds)
    pub _padding3: [u8; 4],

    // Contribution tracking (16 bytes)
    pub contribution_power: u64,        // Their power contribution
    pub contribution_bps: u16,          // Their % of total (basis points)
    pub _padding4: [u8; 6],

    // Bump (8 bytes)
    pub bump: u8,
    pub _padding5: [u8; 7],
}

impl RallyParticipant {
    pub const LEN: usize = 200;
    pub const SEED: &'static [u8] = b"rally_participant";

    pub fn derive_pda(rally_id: u64, participant: &Pubkey) -> (Pubkey, u8) {
        let id_bytes = rally_id.to_le_bytes();
        pinocchio::pubkey::find_program_address(
            &[Self::SEED, &id_bytes, participant.as_ref()],
            &crate::ID,
        )
    }

    pub fn total_units(&self) -> u64 {
        self.units_def_1 + self.units_def_2 + self.units_def_3
    }

    pub fn surviving_units(&self) -> (u64, u64, u64) {
        (
            self.units_def_1.saturating_sub(self.casualties_def_1),
            self.units_def_2.saturating_sub(self.casualties_def_2),
            self.units_def_3.saturating_sub(self.casualties_def_3),
        )
    }

    pub fn is_late(&self, gather_at: i64) -> bool {
        !self.arrived_at_rally && self.arrives_at_rally > gather_at
    }

    pub fn can_recall(&self, rally_status: u8) -> bool {
        // Can recall if: not arrived AND rally has moved past gathering
        !self.arrived_at_rally && rally_status > RallyStatus::Gathering as u8
    }
}
```

### ReinforcementAccount (216 bytes)

```rust
/// PDA: ["reinforcement", sender_pubkey, receiver_pubkey, slot_index_u8]
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ReinforcementAccount {
    // Identity (65 bytes)
    pub sender: Pubkey,                 // 32 bytes
    pub receiver: Pubkey,               // 32 bytes
    pub slot_index: u8,                 // 1 byte - Sender's reinforcement slot (0-8)

    // Hero (40 bytes)
    pub sender_hero: Pubkey,            // 32 bytes (NULL_PUBKEY if none)
    pub hero_slot: u8,                  // 1 byte (255 = none)
    pub _padding1: [u8; 7],

    // Active units (24 bytes) - counted in defense
    pub units_def_1: u64,
    pub units_def_2: u64,
    pub units_def_3: u64,

    // Overflow/border units (24 bytes) - NOT counted in defense
    pub overflow_def_1: u64,
    pub overflow_def_2: u64,
    pub overflow_def_3: u64,

    // Timing (24 bytes)
    pub sent_at: i64,
    pub arrived_at: i64,                // 0 if still traveling
    pub recall_initiated: i64,          // 0 if not recalled

    // Travel info (16 bytes)
    pub origin_city: u16,
    pub destination_city: u16,
    pub travel_duration_secs: u32,
    pub bump: u8,
    pub _padding2: [u8; 7],
}
// Total: 209 bytes → aligned to 216 bytes

impl ReinforcementAccount {
    pub const LEN: usize = 216;
    pub const SEED: &'static [u8] = b"reinforcement";

    pub fn derive_pda(sender: &Pubkey, receiver: &Pubkey, slot: u8) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[Self::SEED, sender.as_ref(), receiver.as_ref(), &[slot]],
            &crate::ID,
        )
    }

    pub fn total_units(&self) -> u64 {
        self.units_def_1 + self.units_def_2 + self.units_def_3
    }

    pub fn total_overflow_units(&self) -> u64 {
        self.overflow_def_1 + self.overflow_def_2 + self.overflow_def_3
    }

    pub fn is_active(&self) -> bool {
        self.arrived_at > 0 && self.recall_initiated == 0
    }

    pub fn has_returned(&self, now: i64) -> bool {
        self.recall_initiated > 0 &&
        now >= self.recall_initiated + self.travel_duration_secs as i64
    }

    /// Defense power with hero bonus (+20% if hero present)
    pub fn effective_defense_power(&self) -> u64 {
        let base = (self.units_def_1 * 1)
            .saturating_add(self.units_def_2 * 2)
            .saturating_add(self.units_def_3 * 3);

        if self.sender_hero != crate::state::player::NULL_PUBKEY {
            apply_bp_bonus(base, 2000).unwrap_or(base)
        } else {
            base
        }
    }
}
```

### PlayerAccount Additions

```rust
// Add to PlayerAccount for combat tracking

// Combat power cache (16 bytes)
pub total_attack_power: u64,
pub total_defense_power: u64,

// March tracking (4 bytes)
pub active_deployment_mask: u8,        // Bitmask of active deployment slots
pub active_reinforcement_mask: u16,    // Bitmask of active reinforcement slots
pub _padding_march: u8,

// Research unlock flags (1 byte)
pub has_military_logistics: bool,
```

### ResearchProgress Additions

```rust
// Add to ResearchProgress for new battle research

// Research levels (6 bytes)
pub military_logistics_level: u8,       // 0-1 (unlock)
pub deployment_efficiency_level: u8,    // 0-15
pub reinforcement_capacity_level: u8,   // 0-15
pub command_structure_level: u8,        // 0-10
pub logistics_mastery_level: u8,        // 0-8
pub support_logistics_level: u8,        // 0-15
```

---

## Account Management

Proper account creation and closure is critical for Solana programs. This section details when accounts are created, who pays, and when they're closed.

### Rent Costs

| Account | Size | Rent (approx) | Who Pays |
|---------|------|---------------|----------|
| **RallyAccount** | ~280 bytes | ~0.002 SOL | Leader |
| **RallyParticipant** | ~200 bytes | ~0.0015 SOL | Each joiner |
| **ReinforcementAccount** | ~216 bytes | ~0.0016 SOL | Sender |

### Account Lifecycle Diagrams

#### RallyAccount Lifecycle

```
┌───────────────────────────────────────────────────────────────────────┐
│                    RALLY ACCOUNT LIFECYCLE                              │
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  CREATE (in CreateRally)                                                │
│  ────────────────────────                                              │
│  ├── System program creates PDA                                        │
│  ├── Leader pays rent (~0.002 SOL)                                     │
│  ├── Initialize with: target, gather_at, status=Gathering              │
│  └── Also creates leader's RallyParticipant                            │
│                                                                         │
│  ACTIVE (Gathering → Marching → Combat → Returning)                    │
│  ─────────────────────────────────────────────────                     │
│  ├── Account updated as rally progresses                               │
│  ├── Tracks: total_power, participant_count, status                   │
│  └── Combat results stored after ExecuteRally                          │
│                                                                         │
│  CLOSE (in CloseRally - after ALL participants returned)               │
│  ────────────────────────────────────────────────────                  │
│  ├── Validate: all RallyParticipant accounts closed                    │
│  ├── Validate: status == Completed                                     │
│  ├── Zero out account data (security)                                  │
│  ├── Transfer lamports to leader (rent refund)                         │
│  └── Account no longer exists                                          │
│                                                                         │
│  ⚠️ EDGE CASE: Late joiner never recalls                               │
│  ├── Their RallyParticipant stays open (their problem)                │
│  ├── BUT RallyAccount CAN close if included_in_march=false            │
│  └── Rally completion only tracks marched participants                 │
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

#### RallyParticipant Lifecycle

```
┌───────────────────────────────────────────────────────────────────────┐
│                    RALLY PARTICIPANT LIFECYCLE                          │
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  CREATE (in JoinRally, or CreateRally for leader)                      │
│  ──────────────────────────────────────────────────                    │
│  ├── System program creates PDA                                        │
│  ├── JOINER pays their own rent (~0.0015 SOL)                         │
│  ├── Initialize with: units, hero, home_city, travel times            │
│  └── Units deducted from joiner's PlayerAccount                        │
│                                                                         │
│  ACTIVE (Traveling → Gathered → Marching → Combat → Returning)         │
│  ──────────────────────────────────────────────────────────────        │
│  ├── Tracks arrival at rally point                                     │
│  ├── Tracks inclusion in march                                        │
│  ├── Stores casualties after combat                                   │
│  └── Stores loot share after combat                                   │
│                                                                         │
│  CLOSE (in ProcessReturn - after participant returned home)            │
│  ──────────────────────────────────────────────────────                │
│  ├── Validate: participant has returned (return time elapsed)          │
│  ├── Transfer: surviving units back to PlayerAccount                  │
│  ├── Transfer: loot share to PlayerAccount                            │
│  ├── Unlock: hero (if was committed)                                  │
│  ├── Zero out account data                                            │
│  ├── Transfer lamports to joiner (rent refund)                        │
│  └── Update: RallyAccount.participant_count--? or track returned_count│
│                                                                         │
│  ⚠️ LATE JOINER CLOSURE (in ProcessReturn after RecallLateJoiner)     │
│  ├── No casualties (didn't participate)                               │
│  ├── No loot (didn't participate)                                     │
│  ├── Just return units + refund rent                                  │
│  └── Their account is independent of rally completion                 │
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

#### ReinforcementAccount Lifecycle

```
┌───────────────────────────────────────────────────────────────────────┐
│                    REINFORCEMENT ACCOUNT LIFECYCLE                      │
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  CREATE (in SendReinforcement)                                          │
│  ─────────────────────────────                                         │
│  ├── System program creates PDA                                        │
│  ├── SENDER pays rent (~0.0016 SOL)                                   │
│  ├── Initialize with: units, hero, travel times                       │
│  └── Units deducted from sender's PlayerAccount                        │
│                                                                         │
│  ACTIVE (Traveling → Active Defense → possibly Overflow)               │
│  ────────────────────────────────────────────────────                  │
│  ├── Tracks arrival at receiver's city                                │
│  ├── Units contribute to receiver's defense                           │
│  ├── May have overflow units (border reserve)                         │
│  └── Casualties applied during combat                                 │
│                                                                         │
│  CLOSE - Option A: RecallReinforcement → ProcessReinforcementReturn    │
│  ───────────────────────────────────────────────────────────────       │
│  ├── Sender initiates recall                                          │
│  ├── Units travel back home                                           │
│  ├── After arrival: transfer units to sender, close account           │
│  └── Rent refunded to sender                                          │
│                                                                         │
│  CLOSE - Option B: RelieveReinforcement → ProcessReinforcementReturn   │
│  ────────────────────────────────────────────────────────────────      │
│  ├── Receiver dismisses reinforcement                                  │
│  ├── Units travel back home                                           │
│  ├── After arrival: transfer units to sender, close account           │
│  └── Rent refunded to sender                                          │
│                                                                         │
│  ⚠️ EDGE CASE: All units die in combat                                │
│  ├── units_def_* all become 0 (after casualties)                      │
│  ├── Account should auto-close? Or require explicit close?            │
│  ├── Recommendation: Auto-close when all units dead                   │
│  └── Rent still refunded to sender                                    │
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

### Account Closure Implementation

```rust
/// Close a PDA account safely
/// 1. Zero out data to prevent revival attacks
/// 2. Transfer all lamports to recipient
pub fn close_account(
    account_info: &AccountInfo,
    recipient: &AccountInfo,
) -> ProgramResult {
    // Zero out data
    let mut data = account_info.try_borrow_mut_data()?;
    for byte in data.iter_mut() {
        *byte = 0;
    }

    // Transfer lamports
    let lamports = account_info.lamports();
    **account_info.try_borrow_mut_lamports()? = 0;
    **recipient.try_borrow_mut_lamports()? = recipient
        .lamports()
        .checked_add(lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    Ok(())
}
```

### Rally Closure Logic

```rust
/// Check if rally can be closed
pub fn can_close_rally(rally: &RallyAccount, participants: &[&RallyParticipant]) -> bool {
    // Must be in Returning or Completed status
    if rally.status < RallyStatus::Returning as u8 {
        return false;
    }

    // All MARCHED participants must have returned
    for p in participants {
        if p.included_in_march && !p.returned {
            return false;
        }
    }

    // Late joiners don't block rally closure
    // (they manage their own RallyParticipant independently)

    true
}

/// Close rally after validation
pub fn close_rally(
    rally_account: &AccountInfo,
    leader_account: &AccountInfo,
) -> ProgramResult {
    // Validate rally can be closed
    let rally = unsafe { RallyAccount::load(&rally_account.try_borrow_data()?) };

    // ... validation ...

    // Close account, refund to leader
    close_account(rally_account, leader_account)
}
```

### Who Pays Summary

| Action | Who Pays | Refund To |
|--------|----------|-----------|
| CreateRally | Leader | Leader (on close) |
| JoinRally | Joiner | Joiner (on return) |
| SendReinforcement | Sender | Sender (on return) |
| SpeedupGather (self) | Joiner | N/A (gems consumed) |
| SpeedupGather (other) | Leader | N/A (gems consumed) |
| SpeedupMarch | Leader | N/A (gems consumed) |
| SpeedupReturn | Participant | N/A (gems consumed) |

### Edge Cases & Solutions

```
┌───────────────────────────────────────────────────────────────────────┐
│                    EDGE CASES                                           │
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. LATE JOINER NEVER RECALLS                                           │
│     ├── Problem: RallyParticipant stays open, rent locked              │
│     ├── Solution: Not our problem - their fault, their rent            │
│     ├── RallyAccount CAN still close (late joiner not in march)       │
│     └── Joiner can recall anytime to get rent back                     │
│                                                                         │
│  2. RALLY CANCELLED MID-GATHER                                          │
│     ├── Problem: Participants are traveling to rally point             │
│     ├── Solution: Cancel initiates return for all participants        │
│     ├── Each ProcessReturn closes their RallyParticipant              │
│     └── CloseRally closes RallyAccount after all returned             │
│                                                                         │
│  3. ALL REINFORCEMENT UNITS DIE                                         │
│     ├── Problem: Account has 0 units, still exists                     │
│     ├── Solution: Auto-close in combat resolution                      │
│     ├── Rent refunded to sender immediately                           │
│     └── No need for separate close instruction                        │
│                                                                         │
│  4. PARTICIPANT LEAVES TEAM MID-RALLY                                   │
│     ├── Problem: Teammate constraint broken                            │
│     ├── Solution: Force recall their contribution                     │
│     ├── Units return home, RallyParticipant closed                    │
│     └── team/leave.rs triggers this                                   │
│                                                                         │
│  5. LEADER LEAVES TEAM MID-RALLY                                        │
│     ├── Problem: Rally has no leader                                   │
│     ├── Option A: Rally continues (participants committed)            │
│     ├── Option B: Rally cancelled, all return                         │
│     └── Recommendation: Option A - don't punish participants          │
│                                                                         │
│  6. RECEIVER OF REINFORCEMENT LEAVES TEAM                               │
│     ├── Problem: Reinforcing non-teammate                              │
│     ├── Solution: Auto-recall all reinforcements TO that player       │
│     └── RelieveReinforcement doesn't require team membership          │
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

### Rent Recovery Guarantee

Players should always be able to recover their rent:

| Account | Recovery Path |
|---------|---------------|
| RallyAccount | CloseRally (after all returned) |
| RallyParticipant (normal) | ProcessReturn (after returned home) |
| RallyParticipant (late) | RecallLateJoiner → ProcessReturn |
| RallyParticipant (cancelled) | CancelRally triggers returns → ProcessReturn |
| ReinforcementAccount | RecallReinforcement or RelieveReinforcement → ProcessReturn |

**Key Principle**: No account should ever be "stuck" without a path to closure.

---

## Instructions

### Rally Instructions

| ID | Name | Description |
|----|------|-------------|
| 140 | `CreateRally` | Create rally, leader auto-joins |
| 141 | `JoinRally` | Join rally (starts travel to rally point) |
| 142 | `LeaveRally` | Leave rally before march (units return home) |
| 143 | `CancelRally` | Leader cancels entire rally |
| 144 | `SpeedupGather` | Speed up joiner's travel to rally point |
| 145 | `ProcessJoinerArrival` | Mark joiner as arrived (crank) |
| 146 | `StartMarch` | Begin march to target (crank or leader) |
| 147 | `SpeedupMarch` | Leader speeds up march to target |
| 148 | `ExecuteRally` | Process combat at target (crank) |
| 149 | `SpeedupReturn` | Speed up participant's return home |
| 150 | `ProcessReturn` | Return units/loot to participant (crank) |
| 151 | `RecallLateJoiner` | Recall troops that missed gather_at |
| 152 | `CloseRally` | Close rally after all returned (crank) |

### Reinforcement Instructions

| ID | Name | Description |
|----|------|-------------|
| 160 | `SendReinforcement` | Send defensive units to teammate |
| 161 | `RecallReinforcement` | Sender recalls their units |
| 162 | `RelieveReinforcement` | Receiver dismisses reinforcements |
| 163 | `ProcessReinforcementArrival` | Mark as arrived (crank) |
| 164 | `ProcessReinforcementReturn` | Return units to sender (crank) |
| 165 | `AcceptOverflow` | Receiver accepts border units if capacity freed |

---

## Processor Structure

The program uses two combat systems with shared logic:

```
programs/novus_mundus/src/processor/
├── combat/
│   ├── mod.rs
│   ├── attack_player.rs       ← LOCAL PvP (instant, same location)
│   └── attack_encounter.rs    ← PvE encounters
├── rally/
│   ├── mod.rs
│   ├── create.rs              ← CreateRally
│   ├── join.rs                ← JoinRally
│   ├── leave.rs               ← LeaveRally
│   ├── cancel.rs              ← CancelRally
│   ├── speedup_gather.rs      ← SpeedupGather
│   ├── process_arrival.rs     ← ProcessJoinerArrival
│   ├── start_march.rs         ← StartMarch
│   ├── speedup_march.rs       ← SpeedupMarch
│   ├── execute.rs             ← ExecuteRally (combat resolution)
│   ├── speedup_return.rs      ← SpeedupReturn
│   ├── process_return.rs      ← ProcessReturn
│   ├── recall_late.rs         ← RecallLateJoiner
│   └── close.rs               ← CloseRally
├── reinforcement/
│   ├── mod.rs
│   ├── send.rs
│   ├── recall.rs
│   ├── relieve.rs
│   ├── process_arrival.rs
│   ├── process_return.rs
│   └── accept_overflow.rs
└── logic/
    ├── combat_power.rs        ← Shared: attack/defense power calculation
    ├── combat_resolution.rs   ← Shared: damage, casualties, loot
    └── operative_fallback.rs  ← Shared: fallback when no garrison
```

### Shared Combat Logic

Both `attack_player.rs` and `rally/execute.rs` use the same combat resolution:

```rust
// logic/combat_resolution.rs

/// Resolve combat between attacker and defender
/// Used by BOTH attack_player.rs (local) and rally/execute.rs (strategic)
pub fn resolve_combat(
    attacker_power: u64,
    defender_power: u64,
    defender_player: &mut PlayerAccount,
    defender_reinforcements: &mut [&mut ReinforcementAccount],
    is_fallback_mode: bool,
    gameplay_config: &GameplayConfig,
) -> CombatResult {
    // 1. Calculate damage ratio
    let total_power = attacker_power.saturating_add(defender_power);
    let attacker_damage_ratio = mul_div(attacker_power, 10000, total_power).unwrap_or(5000);

    // 2. Calculate casualties
    let defender_casualties = calculate_casualties(attacker_power, defender_power, gameplay_config);
    let attacker_casualties = calculate_casualties(defender_power, attacker_power, gameplay_config);

    // 3. Apply defender casualties
    if is_fallback_mode {
        // Hit operatives (economy damage!)
        inflict_damage_on_operatives(defender_player, defender_casualties, gameplay_config);
    } else {
        // Hit garrison first, then reinforcements
        let (garrison_cas, reinf_cas) = inflict_damage_distributed(
            defender_player,
            defender_reinforcements,
            defender_casualties,
            gameplay_config,
        );

        // 4. Border reserve auto-fill
        if reinf_cas > 0 {
            process_border_autofill(defender_reinforcements, reinf_cas);
        }
    }

    // 5. Calculate loot based on damage ratio
    let (base_cash, locked_novi) = calculate_loot(defender_player, attacker_damage_ratio, gameplay_config);

    // 6. Apply fallback loot bonus (φ multiplier on cash)
    // Raiding unprotected operations = bonus cash
    let final_cash = calculate_loot_with_fallback(base_cash, is_fallback_mode);

    CombatResult {
        attacker_won: attacker_power > defender_power,
        attacker_damage_ratio_bps: attacker_damage_ratio as u16,
        attacker_casualties,
        defender_casualties,
        loot_cash: final_cash,
        loot_locked_novi: locked_novi,
        fallback_triggered: is_fallback_mode,
    }
}
```

Since this is a **new program** with no backward compatibility requirements, the following processors will be **completely rewritten** to use the Strategic Combat System.

### `attack_player.rs` Rewrite

**Purpose**: Local PvP combat (same city, same location, instant)

```rust
/// attack_player.rs - REWRITTEN for Strategic Combat System
///
/// Changes from original:
/// - Uses DEFENSIVE units for attacking (not operative)
/// - Includes reinforcements in defender's power
/// - Includes operative fallback if no defensive garrison
/// - Adds monument, city type, and level bonuses
/// - Triggers border reserve auto-fill after combat

/// # Accounts (Updated)
/// - [writable] attacker_player: PlayerAccount PDA
/// - [writable] defender_player: PlayerAccount PDA
/// - [signer] attacker_owner: Wallet
/// - [] attacker_city: CityAccount PDA
/// - [] defender_city: CityAccount PDA
/// - [] game_engine: GameEngine PDA
/// - [writable] defender_reinforcements[0..N]: ReinforcementAccount PDAs
/// - [writable] attacker_event_participation: (Optional)
/// - [writable] attacker_event: (Optional)
///
/// # Instruction Data
/// - drive_by: bool (1 byte)
/// - reinforcement_count: u8 (1 byte)

pub fn process(/* ... */) -> Result<(), ProgramError> {
    // 1. Parse accounts (including variable reinforcements)
    let reinforcement_count = data[1] as usize;
    let reinforcement_accounts = &accounts[6..6 + reinforcement_count];

    // 2. Standard validations (same city, within range, not traveling, etc.)

    // 3. ATTACKER POWER: Uses DEFENSIVE units
    let attacker_defensive_total = attacker_data.total_defensive_units();
    if attacker_defensive_total == 0 {
        return Err(GameError::InsufficientUnits.into());
    }

    let attacker_damage = calculate_total_attack_power(
        attacker_data,
        &attacker_locked_heroes,
        attacker_research,
        attacker_city_data,
        time_of_day,
    );

    // 4. DEFENDER POWER: Garrison + Reinforcements + Fallback
    let mut active_reinforcements: Vec<&ReinforcementAccount> = vec![];
    for reinf_account in reinforcement_accounts {
        let reinf_data = reinf_account.try_borrow_data()?;
        let reinf = unsafe { ReinforcementAccount::load(&reinf_data) };
        if reinf.receiver == defender_player.key() && reinf.is_active() {
            active_reinforcements.push(reinf);
        }
    }

    let (defender_power, is_fallback_mode) = calculate_total_defense_power(
        defender_data,
        &[], // No deployments affect local PvP defender
        &active_reinforcements,
        &defender_locked_heroes,
        defender_research,
        defender_city_data,
        time_of_day,
    );

    // 5. COMBAT RESOLUTION
    // ... standard damage calculation ...

    // 6. APPLY CASUALTIES
    if is_fallback_mode {
        // Damage hits OPERATIVES (defender loses economy!)
        inflict_damage_on_operatives(defender_data, attacker_damage, gameplay_config);
    } else {
        // Normal: damage hits garrison first, then reinforcements
        let (garrison_casualties, reinf_casualties) = inflict_damage_distributed(
            defender_data,
            &mut active_reinforcements,
            attacker_damage,
            gameplay_config,
        );

        // 7. BORDER RESERVE AUTO-FILL
        if reinf_casualties > 0 {
            process_border_autofill(
                defender_player.key(),
                reinf_casualties,
                reinforcement_accounts,
            );
        }
    }

    // 8. Loot transfer, XP, event scoring, etc.
    // ... (similar to original but with updated mechanics)

    Ok(())
}
```

### `rally/execute.rs` Rewrite

**Purpose**: Coordinated team attack on target (with travel)

```rust
/// rally/execute.rs - REWRITTEN for Strategic Combat System
///
/// Changes from original:
/// - Uses DEFENSIVE units for attacking (not operative)
/// - Excludes deployed units from participant contribution
/// - Includes reinforcements in target's defense
/// - Includes operative fallback if target has no garrison
/// - Adds aggregate team buffs (research, hero averages)
/// - Triggers border reserve auto-fill after combat

/// # Accounts
/// - [writable] rally: RallyAccount
/// - [writable] target: PlayerAccount or EncounterAccount
/// - [] game_engine: GameEngine PDA
/// - [] system_program: System program
/// - [0..N] participant_players: PlayerAccount for each participant
/// - [N..2N] participant_loot: LootAccount PDAs to be created
/// - [2N..2N+M] target_reinforcements: ReinforcementAccount PDAs (if PvP)

pub fn process(/* ... */) -> ProgramResult {
    // 1. Parse accounts (including target reinforcements)
    let target_reinforcement_count = /* from instruction data */;
    let target_reinforcements = &accounts[start_reinf..start_reinf + target_reinforcement_count];

    // 2. COLLECT PARTICIPANT POWER (DEFENSIVE units only!)
    let mut total_power = 0u64;
    let mut contributions = [0u64; 20];
    let mut total_research_attack_bps = 0u64;
    let mut participant_count_with_research = 0u32;

    for (i, participant_key) in participants.iter().enumerate() {
        let participant_data = /* load */;

        // Use DEFENSIVE units (not operative!)
        // Exclude units that are currently deployed elsewhere
        let available_defensive = participant_data.total_defensive_units()
            .saturating_sub(participant_data.total_deployed_units());

        let participant_weapons = participant_data.total_weapons();

        // Track contribution
        contributions[i] = available_defensive + participant_weapons;
        total_power += contributions[i];

        // Aggregate research buffs (for team average)
        total_research_attack_bps += participant_data.research_attack_bps as u64;
        participant_count_with_research += 1;
    }

    // Calculate team average research buff
    let avg_research_bps = if participant_count_with_research > 0 {
        total_research_attack_bps / participant_count_with_research as u64
    } else { 0 };

    // 3. CALCULATE ATTACK DAMAGE (with aggregate buffs)
    let total_damage = calculate_rally_damage(
        total_power,
        total_weapons,
        avg_research_bps,
        rally_city_monument_bps,
        gameplay_config,
    );

    // 4. LOAD TARGET DEFENSE (if PvP)
    if target_type == 0 {
        // Load target's reinforcements
        let mut target_active_reinforcements: Vec<&ReinforcementAccount> = vec![];
        for reinf_account in target_reinforcements {
            let reinf = /* load */;
            if reinf.receiver == target_player.key() && reinf.is_active() {
                target_active_reinforcements.push(reinf);
            }
        }

        // Calculate target defense with reinforcements + fallback
        let (target_defense, is_fallback) = calculate_total_defense_power(
            target_player,
            &[], // Target's own deployments
            &target_active_reinforcements,
            &target_heroes,
            target_research,
            target_city,
            time_of_day,
        );

        // 5. COMBAT RESOLUTION
        // Rally always deals damage (overwhelming force concept)
        // But target can mitigate based on their defense ratio

        // 6. APPLY CASUALTIES TO TARGET
        if is_fallback {
            inflict_damage_on_operatives(target_player, total_damage, gameplay_config);
        } else {
            let (garrison_cas, reinf_cas) = inflict_damage_distributed(
                target_player,
                &mut target_active_reinforcements,
                total_damage,
                gameplay_config,
            );

            // 7. BORDER RESERVE AUTO-FILL
            if reinf_cas > 0 {
                process_border_autofill(
                    target_player.key(),
                    reinf_cas,
                    target_reinforcements,
                );
            }
        }
    }

    // 8. Calculate and distribute loot
    // ... (same as original)

    Ok(())
}
```

### Key Changes Summary

| Aspect | Old Implementation | New Implementation |
|--------|-------------------|-------------------|
| **Attacker Units** | Operative | Defensive |
| **Defender Calculation** | Just garrison | Garrison + Reinforcements |
| **If No Garrison** | 0 defense | Operative fallback (50%) |
| **Rally Buffs** | None (all zeros) | Team average research |
| **After Combat** | Nothing | Border reserve auto-fill |
| **Deployed Check** | None | Exclude deployed units |
| **Monument Buffs** | Not applied | Applied to both sides |
| **City Type Buffs** | Not applied | Applied to both sides |

### Error Codes

```rust
// Deployment errors (6100-6109)
pub const ALREADY_DEPLOYING_TO_TARGET: u32 = 6100;
pub const NO_FREE_DEPLOYMENT_SLOT: u32 = 6101;
pub const EXCEEDS_MAX_DEPLOYMENT: u32 = 6102;
pub const DEPLOYMENT_NOT_ARRIVED: u32 = 6103;
pub const DEPLOYMENT_ALREADY_COMPLETED: u32 = 6104;
pub const NOT_RETURNING_YET: u32 = 6105;

// Reinforcement errors (6110-6119)
pub const NOT_ON_SAME_TEAM: u32 = 6110;
pub const MILITARY_LOGISTICS_REQUIRED: u32 = 6111;
pub const NO_FREE_REINFORCEMENT_SLOT: u32 = 6112;
pub const EXCEEDS_MAX_SEND_AMOUNT: u32 = 6113;
pub const REINFORCEMENT_NOT_ACTIVE: u32 = 6114;
pub const HERO_ALREADY_IN_USE: u32 = 6115;

// Combat errors (6120-6129)
pub const NO_DEFENSIVE_UNITS: u32 = 6120;
pub const FALLBACK_MODE_ACTIVATED: u32 = 6121;  // Not an error, just info
```

### Other Systems to Update

1. **attack_encounter.rs** - Consider reduced garrison when deployed
2. **complete_research.rs** - Handle new research types 30-35
3. **hero lock/unlock** - Check if hero is deployed/reinforcing
4. **team/leave.rs** - Recall all reinforcements when leaving team
5. **team/disband.rs** - Recall all reinforcements for all members

---

## Implementation Order

### Phase 1: Foundation (Priority: CRITICAL)
1. Add `phi_inverse_power_bps()` and `asymptotic_capacity()` to safe_math.rs
2. Add fields to PlayerAccount (active_rally_mask, etc.)
3. Create RallyAccount, RallyParticipant, ReinforcementAccount structs
4. Add new error codes
5. Add shared combat logic functions

### Phase 2: Research (Priority: HIGH)
1. Add ResearchBuffType variants for combat upgrades
2. Update complete_research.rs for new types
3. Create initialization instructions for new templates

### Phase 3: Rally System (Priority: HIGH)
1. `processor/rally/create.rs` - CreateRally
2. `processor/rally/join.rs` - JoinRally
3. `processor/rally/leave.rs` - LeaveRally
4. `processor/rally/cancel.rs` - CancelRally
5. `processor/rally/speedup_gather.rs` - SpeedupGather
6. `processor/rally/process_arrival.rs` - ProcessJoinerArrival
7. `processor/rally/start_march.rs` - StartMarch
8. `processor/rally/speedup_march.rs` - SpeedupMarch
9. `processor/rally/execute.rs` - ExecuteRally (combat)
10. `processor/rally/speedup_return.rs` - SpeedupReturn
11. `processor/rally/process_return.rs` - ProcessReturn
12. `processor/rally/recall_late.rs` - RecallLateJoiner
13. `processor/rally/close.rs` - CloseRally

### Phase 4: Reinforcement (Priority: HIGH)
1. `processor/reinforcement/send.rs`
2. `processor/reinforcement/recall.rs`
3. `processor/reinforcement/relieve.rs`
4. `processor/reinforcement/process_arrival.rs`
5. `processor/reinforcement/process_return.rs`
6. `processor/reinforcement/accept_overflow.rs`

### Phase 5: Border Reserve (Priority: MEDIUM)
1. Implement FIFO queue logic in ReinforcementAccount
2. Auto-fill after combat casualties
3. Test edge cases

### Phase 6: Integration (Priority: MEDIUM)
1. Rewrite attack_player.rs (use defensive units, include reinforcements, fallback)
2. Update team/leave.rs - Recall all reinforcements, cancel rally participations
3. Update team/disband.rs - Recall all for all members
4. Update hero lock/unlock - Check if hero in rally

---

## File Structure

```
programs/novus_mundus/src/
├── logic/
│   ├── safe_math.rs              ← Add φ^(-n) functions
│   ├── combat_power.rs           ← NEW: Attack/defense power with all buffs
│   ├── combat_resolution.rs      ← NEW: Shared combat resolution
│   ├── operative_fallback.rs     ← NEW: Fallback when no garrison
│   └── ...
├── state/
│   ├── rally.rs                  ← NEW: RallyAccount, RallyParticipant
│   ├── reinforcement.rs          ← NEW: ReinforcementAccount
│   └── ...
├── processor/
│   ├── combat/
│   │   ├── attack_player.rs      ← REWRITE: Local PvP
│   │   └── attack_encounter.rs   ← Update for garrison calculation
│   ├── rally/                    ← NEW FOLDER
│   │   ├── mod.rs
│   │   ├── create.rs
│   │   ├── join.rs
│   │   ├── leave.rs
│   │   ├── cancel.rs
│   │   ├── speedup_gather.rs
│   │   ├── process_arrival.rs
│   │   ├── start_march.rs
│   │   ├── speedup_march.rs
│   │   ├── execute.rs
│   │   ├── speedup_return.rs
│   │   ├── process_return.rs
│   │   ├── recall_late.rs
│   │   └── close.rs
│   ├── reinforcement/            ← NEW FOLDER
│   │   ├── mod.rs
│   │   ├── send.rs
│   │   ├── recall.rs
│   │   ├── relieve.rs
│   │   ├── process_arrival.rs
│   │   ├── process_return.rs
│   │   └── accept_overflow.rs
│   └── ...
└── ...
```

---

## Summary Tables

### Capacity Scaling (Asymptotic φ)

| System | Base | Max Research Bonus | Sub Bonus | Other | Hard Cap |
|--------|------|-------------------|-----------|-------|----------|
| Deploy % | 30% | +60% (approaches) | +10% | - | 90% |
| Deploy Slots | 1 | +4 | +2 | +1 hero | 8 |
| Reinf Send % | 20% | +70% (approaches) | - | - | 90% |
| Reinf Slots | 1 | +3 | +2 | +3 team | 9 |
| Reinf Receive | 500 | +9,500 (approaches) | - | - | 10,000 |

### Buff Sources

| Source | Attack | Defense | Applied When |
|--------|--------|---------|--------------|
| Hero | ✓ | ✓ | Hero locked |
| Research | ✓ | ✓ | Research completed |
| Monument | ✓ | ✓ | City has monument |
| City Type | ✓ | ✓ | Player in city |
| Equipment | ✓ | ✓ | Always |
| Level | ✓ | ✓ | Always |
| Time | ✓ | ✓ | Combat resolution |

---

*"In Novus Mundus, the prepared player prospers."*
