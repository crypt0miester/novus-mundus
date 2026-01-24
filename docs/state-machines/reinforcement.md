# Reinforcement System State Machine

## Overview

The Reinforcement system allows teammates to send defensive units, weapons, and heroes to protect each other. Units remain at the destination until recalled or relieved, contributing to the destination's defense during attacks.

---

## 1. Reinforcement Lifecycle

### States

| State | Value | Description |
|-------|-------|-------------|
| `Traveling` | 0 | Units en route to destination |
| `Active` | 1 | Units actively defending destination |
| `Returning` | 2 | Units returning to sender |
| `Completed` | 3 | Ready for account closure |

### State Diagram

```
┌────────────────┐  send_reinforcement  ┌────────────────┐
│                │ ───────────────────> │                │
│  NonExistent   │                      │   Traveling    │
│                │                      │   (status=0)   │
└────────────────┘                      └───────┬────────┘
       ▲                                        │
       │                                        │ process_arrival
       │                                        ▼
       │                                ┌────────────────┐
       │                                │                │
       │                                │     Active     │
       │                                │   (status=1)   │
       │                                └───────┬────────┘
       │                                        │
       │                         recall OR      │
       │                         relieve        │
       │                                        ▼
       │                                ┌────────────────┐
       │                                │                │
       │                                │   Returning    │
       │                                │   (status=2)   │
       │                                └───────┬────────┘
       │                                        │
       │                                        │ process_return
       │                                        ▼
       │                                ┌────────────────┐
       │                                │                │
       │ account closed                 │   Completed    │
       └────────────────────────────────│   (status=3)   │
                                        └────────────────┘
```

### Transitions

#### `NonExistent` → `Traveling`
```
Trigger: send_reinforcement
Guards:
  - Sender and destination are teammates
  - Sender has sufficient units (defensive)
  - Sender has sufficient weapons (optional)
  - No existing reinforcement to same destination
  - Sender not traveling
  - Destination exists and active
Actions:
  - Create ReinforcementAccount PDA: [REINFORCEMENT_SEED, sender, destination]
  - Deduct units from sender
  - Deduct weapons from sender (if any)
  - If hero provided:
    - Lock hero (snapshot buffs)
  - Calculate travel time based on cities
  - Set status = Traveling
  - Emit ReinforcementSent
```

#### `Traveling` → `Active`
```
Trigger: process_arrival (permissionless crank)
Guards:
  - now >= reinforcement.arrives_at
  - status == Traveling
  - Destination account still valid
Actions:
  - Add units to destination.reinforcement_def_1/2/3
  - Add weapons to destination.reinforcement_melee/ranged/siege
  - Store original totals in destination for survival ratio
  - Apply hero buffs (max of current and incoming):
    - destination.reinforcement_hero_defense_bps = max(current, incoming)
    - destination.reinforcement_hero_weapon_eff_bps = max(current, incoming)
    - destination.reinforcement_hero_armor_eff_bps = max(current, incoming)
  - Increment destination.reinforcement_source_count
  - Set status = Active
  - Emit ReinforcementArrived
```

#### `Active` → `Returning` (via Recall)
```
Trigger: recall_reinforcement
Guards:
  - Caller is sender
  - status == Active
Actions:
  - Calculate survival ratio from destination aggregates
  - Deduct units from destination aggregates (proportional)
  - Deduct weapons from destination aggregates (proportional)
  - Recalculate destination hero buffs if needed
  - Decrement destination.reinforcement_source_count
  - Calculate return travel time
  - Set return_started_at = now
  - Set relieved_by_destination = false
  - Set status = Returning
  - Emit ReinforcementRecalled
```

#### `Active` → `Returning` (via Relieve)
```
Trigger: relieve_reinforcement
Guards:
  - Caller is destination owner
  - status == Active
Actions:
  - Same as recall, but:
  - Set relieved_by_destination = true
  - Emit ReinforcementRelieved
```

#### `Returning` → `Completed`
```
Trigger: process_return (permissionless crank)
Guards:
  - now >= return_started_at + return_duration
  - status == Returning
Actions:
  - Calculate surviving units based on survival ratio
  - Return surviving units to sender
  - Return surviving weapons to sender (proportional to unit survival)
  - If hero was committed:
    - Return hero to sender
  - Set status = Completed
  - Close account (refund rent to sender)
  - Emit ReinforcementReturned
```

---

## 2. Survival Ratio Calculation

### Formula
```
survival_ratio = destination_current_units / destination_original_units

Where:
- destination_current_units = current aggregate (after combat losses)
- destination_original_units = original aggregate (before any losses)
```

### Per-Reinforcement Return
```
units_returned = original_sent × survival_ratio
weapons_returned = original_weapons × survival_ratio
```

### Example
```
Sender sends: 1000 units
Destination original total: 5000 units
After combat: 3000 units remain
Survival ratio: 3000/5000 = 60%
Sender receives back: 1000 × 0.6 = 600 units
```

---

## 3. Destination Types

| Type | Value | PDA Seed | Target |
|------|-------|----------|--------|
| Player | 0 | `REINFORCEMENT_SEED` | PlayerAccount |
| Castle | 1 | `GARRISON_SEED` | CastleAccount |

---

## 4. Speedup System

### Travel Speedup (To Destination)
```
Trigger: speedup_reinforcement
Guards:
  - status == Traveling
  - Remaining time > 0
  - Caller is sender
  - Sufficient gems
Actions:
  - Calculate time reduction
  - Deduct gems
  - Adjust arrives_at
  - Emit ReinforcementSpeedup
```

### Return Speedup
```
Trigger: speedup_return
Guards:
  - status == Returning
  - Remaining time > 0
  - Caller is sender
  - Sufficient gems
Actions:
  - Calculate time reduction
  - Deduct gems
  - Adjust return completion time
  - Emit ReturnSpeedup
```

---

## 5. Account Structure

### ReinforcementAccount (216 bytes)
```rust
pub struct ReinforcementAccount {
    // Identity (64 bytes)
    pub sender: Pubkey,              // Who sent the reinforcement
    pub destination: Pubkey,         // Target PlayerAccount or CastleAccount

    // Type & Location (8 bytes)
    pub destination_type: u8,        // 0=Player, 1=Castle
    pub bump: u8,
    pub sender_city: u16,
    pub destination_city: u16,

    // Units sent (24 bytes)
    pub units_def_1: u64,
    pub units_def_2: u64,
    pub units_def_3: u64,

    // Weapons sent (24 bytes)
    pub melee_weapons: u64,
    pub ranged_weapons: u64,
    pub siege_weapons: u64,

    // Hero (40 bytes)
    pub hero: Pubkey,                // NULL_PUBKEY if none
    pub hero_defense_bps: u16,
    pub hero_weapon_eff_bps: u16,
    pub hero_armor_eff_bps: u16,

    // Travel timing (24 bytes)
    pub sent_at: i64,
    pub travel_duration: i32,
    pub arrives_at: i64,

    // Return timing (16 bytes)
    pub return_started_at: i64,
    pub return_duration: i32,

    // Status (8 bytes)
    pub status: u8,
    pub relieved_by_destination: bool,

    // Stats (8 bytes)
    pub combats_participated: u64,
}
```

### Destination Aggregates (in PlayerAccount)
```rust
// Unit aggregates
pub reinforcement_def_1: u64,
pub reinforcement_def_2: u64,
pub reinforcement_def_3: u64,

// Weapon aggregates
pub reinforcement_melee: u64,
pub reinforcement_ranged: u64,
pub reinforcement_siege: u64,

// Original totals (for survival ratio)
pub reinforcement_original_units: u64,
pub reinforcement_original_weapons: u64,

// Hero buffs (best from all reinforcements)
pub reinforcement_hero_defense_bps: u16,
pub reinforcement_hero_weapon_eff_bps: u16,
pub reinforcement_hero_armor_eff_bps: u16,

// Source count
pub reinforcement_source_count: u8,
```

---

## 6. Combat Integration

### Defense Calculation
```
total_defense = own_defensive_units + reinforcement_def_1 + reinforcement_def_2 + reinforcement_def_3
total_weapons = own_weapons + reinforcement_melee + reinforcement_ranged + reinforcement_siege
hero_buff = max(own_hero_buff, reinforcement_hero_buff)
```

### Casualty Distribution
```
When destination takes damage:
1. Calculate total casualties from damage
2. Apply casualties proportionally to:
   - Own units (reduce defensive_unit_1/2/3)
   - Reinforcement units (reduce reinforcement_def_1/2/3)
3. Weapons die with their units
```

---

## 7. Invariants

```
1. Only one reinforcement per sender→destination pair
2. Sender and destination must be teammates (for Player type)
3. sender != destination (cannot reinforce self)
4. Hero buffs use MAX, not sum (prevents stacking exploits)
5. Reinforcement_source_count == number of active ReinforcementAccounts
6. Units/weapons in ReinforcementAccount are ORIGINAL values (never modified)
7. Survival ratio is calculated from destination aggregates at recall/relieve time
8. Hero is returned on process_return regardless of unit survival
```
