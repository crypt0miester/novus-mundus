# Unified Reinforcement System Design

> **Status:** Design phase - not yet implemented
> **Last Updated:** December 7, 2025
> **Priority:** Phase 2+ (implement alongside King's Castle)

---

## Overview

The reinforcement system allows players to send defensive units, weapons, and heroes to defend **either a teammate's base OR a castle**. A single unified system handles both destinations, with the `destination_type` field determining behavior.

```
                    ReinforcementAccount
                           │
           ┌───────────────┴───────────────┐
           │                               │
    destination_type: Player        destination_type: Castle
           │                               │
           ▼                               ▼
    PlayerAccount.reinforcement_*    CastleAccount.garrison_*
    (aggregate totals)               (aggregate totals)
```

---

## Core Design: One System, Multiple Destinations

### ReinforcementTarget Enum

```rust
#[repr(u8)]
pub enum ReinforcementTarget {
    Player = 0,  // Reinforcing a teammate's PlayerAccount
    Castle = 1,  // Garrisoning a team's CastleAccount
}
```

### What Gets Sent (Full Package)

| Component | Sender Loses | Destination Gains | On Return |
|-----------|--------------|-------------------|-----------|
| **Units** (def_1/2/3) | Deducted immediately | Added to defense aggregates | Surviving units |
| **Weapons** (melee/ranged/siege) | Deducted immediately | Used by reinforcement units | Surviving weapons |
| **Hero** (optional) | Locked (unusable) | Hero buffs apply to defense | Always returns (heroes don't die) |

### Key Rules

1. **Team Requirement**:
   - Player target: Only teammates can reinforce each other
   - Castle target: Only team members of ruling team can garrison
2. **Weapon Ratio**: 1:1 - send N units with up to N weapons
3. **Hero Lock**: Committed hero cannot be used elsewhere
4. **Capacity Limit**: Destination has max capacity (hero buffs can increase)

---

## State Design

### ReinforcementAccount (Unified)

Single account structure for both player and castle destinations:

```rust
#[repr(C)]
pub struct ReinforcementAccount {
    // Identity (80 bytes)
    pub sender: Pubkey,                     // Who sent the reinforcement
    pub destination: Pubkey,                // PlayerAccount OR CastleAccount pubkey
    pub destination_type: u8,               // ReinforcementTarget enum
    pub id: u64,                            // Unique ID per sender
    pub bump: u8,
    pub _padding_id: [u8; 6],

    // Location (4 bytes)
    pub sender_city: u16,                   // Sender's home city (for return travel)
    pub destination_city: u16,              // Where reinforcement is deployed

    // Units - Defensive only (24 bytes)
    pub units_def_1: u64,
    pub units_def_2: u64,
    pub units_def_3: u64,

    // Weapons (24 bytes)
    pub melee_weapons: u64,
    pub ranged_weapons: u64,
    pub siege_weapons: u64,

    // Hero (48 bytes)
    pub hero: Pubkey,                       // Committed hero (NULL_PUBKEY if none)
    pub hero_defense_bps: u16,              // Hero's defense buff snapshot
    pub hero_weapon_eff_bps: u16,           // Hero's weapon efficiency snapshot
    pub hero_armor_eff_bps: u16,            // Hero's armor efficiency snapshot
    pub _padding_hero: [u8; 10],

    // Travel timing (24 bytes)
    pub sent_at: i64,                       // When reinforcement was sent
    pub travel_duration: i32,               // Travel time to destination
    pub arrives_at: i64,                    // When units arrive
    pub _padding_travel: [u8; 4],

    // Return timing (16 bytes)
    pub return_started_at: i64,             // When return journey started (0 if not returning)
    pub return_duration: i32,               // Return travel time
    pub _padding_return: [u8; 4],

    // Status (8 bytes)
    pub status: u8,                         // ReinforcementStatus enum
    pub _padding_status: [u8; 7],

    // Original amounts for proportional return (24 bytes)
    pub original_total_units: u64,          // Total units when sent
    pub original_total_weapons: u64,        // Total weapons when sent
    pub combats_participated: u64,          // Number of defenses participated
}
// Total: ~252 bytes
```

**PDA Seeds:**
```rust
// For player reinforcement:
[REINFORCEMENT_SEED, sender, destination_player, id]

// For castle garrison:
[GARRISON_SEED, sender, destination_castle, id]
```

### Aggregate Storage in Destinations

Both PlayerAccount and CastleAccount store aggregate totals for combat efficiency:

**PlayerAccount additions (~56 bytes):**
```rust
// Reinforcement aggregates (from teammates)
pub reinforcement_def_1: u64,
pub reinforcement_def_2: u64,
pub reinforcement_def_3: u64,
pub reinforcement_melee: u64,
pub reinforcement_ranged: u64,
pub reinforcement_siege: u64,
pub reinforcement_hero_defense_bps: u16,     // Best hero's defense buff
pub reinforcement_hero_weapon_eff_bps: u16,  // Best hero's weapon efficiency
pub reinforcement_hero_armor_eff_bps: u16,   // Best hero's armor efficiency
pub reinforcement_source_count: u8,          // How many teammates reinforcing
pub _padding_reinforcement: [u8; 1],
```

**CastleAccount additions (~56 bytes):**
```rust
// Garrison aggregates (from team members)
pub garrison_def_1: u64,
pub garrison_def_2: u64,
pub garrison_def_3: u64,
pub garrison_melee: u64,
pub garrison_ranged: u64,
pub garrison_siege: u64,
pub garrison_hero_defense_bps: u16,          // Best hero's defense buff
pub garrison_hero_weapon_eff_bps: u16,       // Best hero's weapon efficiency
pub garrison_hero_armor_eff_bps: u16,        // Best hero's armor efficiency
pub garrison_contributor_count: u8,          // How many team members garrisoning
pub _padding_garrison: [u8; 1],
```

**Benefits:**
- Combat reads only destination account (no extra accounts needed)
- Individual ReinforcementAccounts only needed for recall/return calculations
- Scales to any number of contributors without account limit issues

---

## Combat Integration

### Defense Calculation (Works for Both)

```rust
// In attack_player.rs OR castle_rally_execute.rs:

// Get aggregate totals from destination
let (garrison_units, garrison_weapons, hero_buffs) = match destination_type {
    Player => (
        defender.reinforcement_def_1 + defender.reinforcement_def_2 + defender.reinforcement_def_3,
        defender.reinforcement_melee + defender.reinforcement_ranged + defender.reinforcement_siege,
        (defender.reinforcement_hero_defense_bps,
         defender.reinforcement_hero_weapon_eff_bps,
         defender.reinforcement_hero_armor_eff_bps),
    ),
    Castle => (
        castle.garrison_def_1 + castle.garrison_def_2 + castle.garrison_def_3,
        castle.garrison_melee + castle.garrison_ranged + castle.garrison_siege,
        (castle.garrison_hero_defense_bps,
         castle.garrison_hero_weapon_eff_bps,
         castle.garrison_hero_armor_eff_bps),
    ),
};

// Total defense = own units + reinforcement/garrison
let total_defense_units = own_units + garrison_units;
let total_weapons = own_weapons + garrison_weapons;

// Hero buffs: use BETTER of own or reinforcement hero
let effective_defense_bps = own_hero_defense.max(hero_buffs.0);
let effective_weapon_eff = own_hero_weapon_eff.max(hero_buffs.1);
let effective_armor_eff = own_hero_armor_eff.max(hero_buffs.2);
```

### Casualty Distribution

```
                    Total Incoming Damage
                            │
                            ▼
                  ┌─────────────────────┐
                  │   OWN UNITS FIRST   │  ← Defender's own units
                  │  (defensive_unit_*)  │
                  └──────────┬──────────┘
                             │ overflow
                             ▼
                  ┌─────────────────────┐
                  │  REINFORCEMENT /    │  ← From teammates/garrison
                  │     GARRISON        │
                  └──────────┬──────────┘
                             │
                             ▼
              Proportional across all sources
              (calculated when individual returns)
```

**Weapon Casualties:** Weapons die proportionally with units.

---

## Processor Lifecycle

### Unified Processors

All processors work for both destination types:

| Processor | Description | Destination-Specific Logic |
|-----------|-------------|---------------------------|
| `send` | Send units/weapons/hero | Player: validate teammate. Castle: validate team owns castle |
| `process_arrival` | Crank: mark active, update aggregates | Update PlayerAccount OR CastleAccount |
| `recall` | Sender initiates return | Same for both |
| `relieve` | Destination owner sends back | Player: receiver. Castle: king |
| `process_return` | Return surviving units, close account | Same for both |
| `speedup` | Spend gems to speed up travel | Same for both |

### Lifecycle Flow

```
1. SEND
   Sender ─── units, weapons, hero ───► ReinforcementAccount created
                                        (status: Traveling)
                                        (travel_duration based on distance)

2. PROCESS_ARRIVAL (Crank - after travel_duration)
   ReinforcementAccount ───► Destination aggregates updated
   (status: Active)          (reinforcement_* or garrison_*)

3. ACTIVE DEFENSE
   - Contributes to defense calculations
   - Casualties tracked in destination aggregates
   - Individual casualty ratio calculated on return

4. RECALL (sender) or RELIEVE (destination owner)
   ReinforcementAccount ───► status: Returning
                             return_duration set

5. PROCESS_RETURN (Crank - after return_duration)
   - Calculate survival ratio from destination aggregates
   - Return proportional units/weapons to sender
   - Unlock hero
   - Close account, refund rent to sender
```

### Speedup Integration

Two-tier speedup system (gem cost based on remaining time):

```rust
pub const SPEEDUP_TIER_1: u8 = 1;  // 50% time remains, 1x gem cost
pub const SPEEDUP_TIER_2: u8 = 2;  // 25% time remains, 2x gem cost
```

Applies to:
- Travel to destination (Traveling status)
- Return journey (Returning status)

---

## Return Calculation

When sender recalls, they get proportional share of surviving units:

```rust
// Destination's current aggregates vs original totals
let current_total = destination.reinforcement_def_1
                  + destination.reinforcement_def_2
                  + destination.reinforcement_def_3;
let original_total = sum of all contributors' original_total_units;

let survival_ratio = current_total as f64 / original_total as f64;

// This sender's return
let sender_units_back = (reinforcement.original_total_units as f64 * survival_ratio) as u64;
let sender_weapons_back = (reinforcement.original_total_weapons as f64 * survival_ratio) as u64;
let sender_hero_back = always; // Heroes don't die
```

**Example:**
- Sender originally sent: 1000 units, 500 weapons
- Total reinforcements were: 3000 units, 1500 weapons
- After combat: 2100 units remain, 1050 weapons remain (30% casualties)
- Sender gets back: 700 units (1000 × 0.7), 350 weapons (500 × 0.7)

**Weapon Casualty Rule:** Weapons die proportionally with units. Same survival_ratio applies to both.

---

## Destination-Specific Validation

### Player Reinforcement

```rust
// In send processor:
if destination_type == ReinforcementTarget::Player {
    // Validate sender and receiver are on same team
    require!(sender.team == receiver.team, NotOnSameTeam);

    // Check receiver's reinforcement capacity
    let capacity = receiver.max_reinforcement_capacity();
    let current = receiver.reinforcement_source_count;
    require!(current < capacity, ReceiverCapacityFull);
}
```

### Castle Garrison

```rust
// In send processor:
if destination_type == ReinforcementTarget::Castle {
    // Validate sender's team owns the castle
    require!(sender.team == castle.ruling_team, NotOnSameTeam);

    // Check garrison slots (based on King's subscription tier)
    let max_slots = castle.max_garrison_slots(); // 5/10/15/25
    let current = castle.garrison_contributor_count;
    require!(current < max_slots, NoFreeGarrisonSlot);

    // Castle-specific: check if past contest period for non-king
    if sender.owner != castle.king {
        require!(castle.is_past_contest_period(), CastleInContestPeriod);
    }
}
```

---

## Hero Buff Application

Only defense-relevant buffs apply:

| Buff | Applies? | Effect |
|------|----------|--------|
| `hero_defense_bps` | ✅ | Unit defense multiplier |
| `hero_weapon_efficiency_bps` | ✅ | Weapon damage multiplier |
| `hero_armor_efficiency_bps` | ✅ | Damage reduction |
| `hero_attack_bps` | ❌ | Offense only |
| `hero_economy_bps` | ❌ | Not relevant |
| `hero_loot_bonus_bps` | ❌ | Attacker only |

**Multiple Contributors:** Use BEST value for each buff (not sum). Rewards quality over quantity.

---

## Capacity System

### Player Reinforcement Capacity

```rust
let base_capacity = MAX_REINFORCEMENT_SOURCES; // e.g., 9 teammates
let boosted_capacity = base_capacity
    × (10000 + receiver.hero_unit_capacity_bps) / 10000;
```

### Castle Garrison Capacity

Based on King's subscription tier:

| King's Tier | Max Garrison Contributors |
|-------------|---------------------------|
| Rookie | 5 |
| Expert | 10 |
| Epic | 15 |
| Legendary | 25 |

### Sender Limit

```rust
let max_sendable = sender.total_defensive_units()
    × BASE_REINFORCEMENT_SEND_BPS / 10000; // e.g., 20% of units
```

---

## Instruction IDs (Proposed)

| ID | Instruction | Description |
|----|-------------|-------------|
| 190 | `reinforcement::send` | Send units/weapons/hero to player OR castle |
| 191 | `reinforcement::process_arrival` | Crank: mark active, update aggregates |
| 192 | `reinforcement::recall` | Sender initiates return |
| 193 | `reinforcement::relieve` | Destination owner sends back |
| 194 | `reinforcement::process_return` | Return units, close account |
| 195 | `reinforcement::speedup` | Speed up travel with gems |

---

## Error Codes

```rust
// Existing (error.rs)
NotOnSameTeam = 7150,
MilitaryLogisticsRequired = 7151,
NoFreeReinforcementSlot = 7152,
ExceedsMaxSendAmount = 7153,
ReinforcementNotActive = 7154,
HeroAlreadyInRally = 7155,
ReinforcementAlreadyExists = 7156,
ReceiverCapacityFull = 7157,

// New for castle garrison
NoFreeGarrisonSlot = 7160,
CastleInContestPeriod = 7161,
NotCastleKing = 7162,
CastleNotOwned = 7163,
```

---

## Implementation Checklist

### Phase 1: Unified State
- [ ] Update ReinforcementAccount with destination_type, weapons, hero buffs
- [ ] Add reinforcement aggregates to PlayerAccount
- [ ] Create CastleAccount with garrison aggregates
- [ ] Add helper methods for both

### Phase 2: Unified Processors
- [ ] `reinforcement::send` - handles both destination types
- [ ] `reinforcement::process_arrival` - updates correct aggregates
- [ ] `reinforcement::recall` - sender initiates return
- [ ] `reinforcement::relieve` - destination owner sends back
- [ ] `reinforcement::process_return` - proportional return, close account
- [ ] `reinforcement::speedup` - gem-based travel speedup

### Phase 3: Combat Integration
- [ ] Modify `attack_player.rs` to use reinforcement aggregates
- [ ] Create `castle_rally_execute.rs` to use garrison aggregates
- [ ] Implement casualty distribution (own first, then reinforcement)
- [ ] Apply hero buffs (best of own vs reinforcement)

### Phase 4: Testing
- [ ] Unit tests for both destination types
- [ ] Integration tests for full lifecycle
- [ ] Edge cases: all units die, hero only, castle contest period

---

## Related Files

- `state/reinforcement.rs` - ReinforcementAccount (update for unified design)
- `state/player.rs` - PlayerAccount (add reinforcement aggregates)
- `state/castle.rs` - CastleAccount (new, with garrison aggregates)
- `processor/reinforcement/` - Unified processors
- `processor/combat/attack_player.rs` - Combat integration
- `processor/castle/` - Castle-specific processors
- `constants.rs` - Seeds and limits
- `error.rs` - Error codes
