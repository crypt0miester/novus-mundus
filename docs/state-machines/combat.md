# Combat System State Machine

## Overview

The Combat system handles all battle mechanics including PvE encounters and PvP attacks. Combat calculates damage, resolves casualties, and distributes loot using deterministic formulas.

---

## 1. Combat Types

### Overview

| Type | Attacker | Defender | Outcome |
|------|----------|----------|---------|
| PvE Encounter | Player | EncounterAccount | Loot pool |
| PvP Attack | Player | Player | Resource theft |
| Rally Attack | Multiple Players | Player/Encounter | Shared loot |
| Dungeon Combat | Player | Room enemies | Room-specific rewards |

---

## 2. PvE Encounter Combat

### States

| State | Description |
|-------|-------------|
| `Available` | Encounter can be attacked |
| `InCombat` | Combat being resolved |
| `Defeated` | Encounter health = 0 |
| `Respawning` | Cooldown before reset |

### State Diagram

```
┌────────────────┐  attack_encounter  ┌────────────────┐
│                │ ─────────────────> │                │
│   Available    │                    │   InCombat     │
│                │                    │                │
└────────────────┘                    └───────┬────────┘
       ▲                                      │
       │                           ┌──────────┴──────────┐
       │                           │                     │
       │ respawn                   │ health > 0          │ health = 0
       │                           ▼                     ▼
       │                   ┌──────────────┐     ┌──────────────┐
       │                   │              │     │              │
       │                   │  Available   │     │   Defeated   │
       │                   │              │     │              │
       │                   └──────────────┘     └──────┬───────┘
       │                                               │
       └───────────────────────────────────────────────┘
```

### Transitions

#### Attack Encounter
```
Trigger: attack_encounter
Guards:
  - Player has encounter stamina
  - Encounter in same city
  - Encounter not defeated
  - Player not traveling
  - Player not in dungeon/rally
Actions:
  - Deduct stamina
  - Calculate attacker damage
  - Apply damage to encounter health
  - Calculate attacker casualties
  - If defeated:
    - Generate loot pool
    - Create LootAccount
    - Grant XP
  - Emit EncounterAttacked
```

### Damage Calculation
```
base_damage = units × damage_per_unit × (1 + weapons / units)
research_bonus = research_attack_bps / 10000
hero_bonus = hero_attack_bps / 10000
weapon_eff = hero_weapon_efficiency_bps / 10000
equipped_bonus = equipped_weapon_bonus_bps / 10000

total_damage = base_damage × (1 + research_bonus + hero_bonus + weapon_eff + equipped_bonus)

If drive-by (rally):
  total_damage × 0.75 (reduced for coordinated attack)
```

---

## 3. PvP Attack Combat

### States

| State | Description |
|-------|-------------|
| `Idle` | No combat |
| `Combat` | Attack being resolved |
| `Cooldown` | Cannot attack same target |

### Transitions

#### Attack Player
```
Trigger: attack_player
Guards:
  - Target not in new player protection
  - Target in same city
  - Attacker has units
  - Attack cooldown elapsed
  - Target not same as attacker
Actions:
  - Calculate attacker damage
  - Calculate defender damage (counter-attack)
  - Apply casualties to both sides
  - Resolve weapon combat
  - Determine winner
  - If attacker wins:
    - Calculate loot (% of defender resources)
    - Transfer loot
  - If defender wins:
    - Attacker weapons lost to defender
  - Update combat stats
  - Emit PlayerAttacked
```

### Fallback Mode
```
If defender has 0 defensive units:
  - Operatives defend at 50% effectiveness
  - If no operatives either:
    - Attacker gets φ (1.618×) loot bonus
    - No defender casualties (nothing to lose)
```

---

## 4. Weapon Combat Resolution

### Weapon Types

| Type | Best Against | Weak Against |
|------|--------------|--------------|
| Melee | Ranged | Siege |
| Ranged | Siege | Melee |
| Siege | Melee | Ranged |

### Combat Resolution
```
For each weapon type:
  effective_weapons = weapons × survival_ratio
  damage_multiplier based on matchup

attacker_won = (attacker_total_damage > defender_total_damage) OR
               (defender_troops == 0)

If attacker_won:
  attacker_weapons_looted = defender_equipped × loot_ratio

If defender_won:
  defender_weapons_looted = attacker_dead × weapon_ratio
```

---

## 5. Casualty Calculation

### Formula
```
damage_received = enemy_damage × (1 - armor_mitigation)
armor_mitigation = min(armor_pieces / units, 1.0) × armor_efficiency

casualties = damage_received / hp_per_unit

Distribution by tier:
  tier_1_casualties = proportional to tier_1_count
  tier_2_casualties = proportional to tier_2_count
  tier_3_casualties = proportional to tier_3_count
```

### Inflict Damage Function
```rust
fn inflict_damage(
    def_1, def_2, def_3,
    armor,
    damage,
    config,
    hero_armor_eff_bps,
    equipped_armor_bps,
) -> (new_def_1, new_def_2, new_def_3)
```

---

## 6. Critical Hits

### Crit Chance
```
base_crit_chance = 5%  // 500 bps
research_crit = research_crit_chance_bps / 10000
hero_crit = hero_crit_chance_bps / 10000

total_crit_chance = base_crit_chance + research_crit + hero_crit
```

### Crit Damage
```
base_crit_damage = 1.5×  // 15000 bps
research_crit_dmg = research_crit_damage_bps / 10000
hero_crit_dmg = hero_crit_damage_bps / 10000

total_crit_multiplier = base_crit_damage + research_crit_dmg + hero_crit_dmg
```

### Crit Resolution (Deterministic)
```
crit_seed = (timestamp / 60) % 10000
is_crit = crit_seed < (total_crit_chance × 10000)

if is_crit:
  final_damage = total_damage × total_crit_multiplier
```

---

## 7. Loot System

### PvP Loot (Attacker Wins)
```
cash_looted = defender.cash_on_hand × 25%
produce_looted = defender.produce × 25%
vehicles_looted = defender.vehicles × 25%
fragments_looted = defender.fragments × 25%
gems_looted = defender.gems × 25%

If fallback mode:
  cash_looted × φ (1.618)
```

### PvE Loot Pool
```
base_loot = encounter_level × tier_multiplier × drop_rate
research_bonus = research_loot_bps
hero_bonus = hero_loot_bonus_bps
observatory_bonus = estate_loot_bps

final_loot = base_loot × (1 + all_bonuses)
```

---

## 8. Loot Account System

### States

| State | Description |
|-------|-------------|
| `Pending` | Loot awaiting claim |
| `Claimed` | Loot transferred to player |

### Transitions

#### Create Loot
```
Trigger: Combat completion (PvE defeat)
Actions:
  - Create LootAccount PDA
  - Set loot_cash, loot_novi, etc.
  - Set claimable_at = now
  - Emit LootCreated
```

#### Claim Loot
```
Trigger: claim_loot
Guards:
  - LootAccount exists
  - Player is owner
  - claimable_at <= now
Actions:
  - Transfer all loot to player
  - Close LootAccount (refund rent)
  - Emit LootClaimed
```

---

## 9. Protection Systems

### New Player Protection
```
Duration: 72 hours from account creation

During protection:
  - Cannot be attacked by other players
  - Can attack encounters
  - Can participate in rallies
```

### Attack Cooldown
```
Cannot attack same player within:
  - 15 minutes (same city)
  - No cooldown for different cities
```

---

## 10. Combat Stats Tracking

### PlayerAccount Combat Fields
```rust
// Attack stats
pub total_attacks: u32,
pub successful_attacks: u32,
pub total_attack_damage_dealt: u64,
pub total_attack_casualties_inflicted: u64,

// Defense stats
pub total_defenses: u32,
pub successful_defenses: u32,
pub total_defense_damage_dealt: u64,
pub total_defense_casualties_inflicted: u64,

// Resource stats
pub total_cash_looted: u64,
pub total_cash_lost: u64,

// Protection
pub new_player_protection_until: i64,
```

---

## 11. Building Bonuses

### Combat-Related Buildings

| Building | Effect |
|----------|--------|
| Barracks | +0.5% attack per level |
| Citadel | +0.5% defense per level |
| Arena | +0.5% PvP damage per level |

---

## 12. Invariants

```
1. Combat is synchronous (single transaction)
2. Casualties cannot exceed current units
3. Loot cannot exceed defender's resources
4. Critical hit determination is deterministic
5. New player protection is absolute (no attacks)
6. Weapon combat uses rock-paper-scissors counters
7. Fallback mode only when garrison is 0
8. Rally combat uses aggregated power
9. All combat affects networth
10. Stats tracked for both attacker and defender
```
