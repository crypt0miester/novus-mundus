# Estate System State Machine

## Overview

The Estate system manages the player's personal base containing buildings. Buildings provide passive buffs, unlock features, and gate access to game systems. The estate uses a plot-based expansion model where each plot unlocks 4 building slots.

---

## 1. Estate Lifecycle

### States

| State | Description |
|-------|-------------|
| `NonExistent` | No EstateAccount for this player |
| `Active` | Estate exists and operational |

### Transition

#### `NonExistent` → `Active`
```
Trigger: create_estate (via game initialization)
Guards:
  - Player exists
  - Estate PDA doesn't exist
  - Sufficient lamports for rent
Actions:
  - Create EstateAccount PDA: [ESTATE_SEED, owner]
  - Initialize with 1 plot (4 slots)
  - Set estate_level = 0
  - Set city_id from player's current city
  - Emit EstateCreated
```

---

## 2. Building Lifecycle

### States

| State | Value | Description |
|-------|-------|-------------|
| `Empty` | 0 | Slot has no building |
| `Building` | 1 | Under initial construction |
| `Active` | 2 | Fully operational |
| `Upgrading` | 3 | Being upgraded (still provides buffs) |

### State Diagram

```
┌────────────────┐  build_building   ┌────────────────┐
│                │ ────────────────> │                │
│     Empty      │                   │    Building    │
│   (status=0)   │                   │   (status=1)   │
└────────────────┘                   └───────┬────────┘
                                             │
                                             │ complete_building
                                             ▼
                                     ┌────────────────┐
                                     │                │
                       ┌─────────────│     Active     │
                       │             │   (status=2)   │
                       │             └───────┬────────┘
                       │                     │
          upgrade      │                     │ upgrade_building
                       │                     ▼
                       │             ┌────────────────┐
                       │             │                │
                       └─────────────│   Upgrading    │
                                     │   (status=3)   │
                                     └───────┬────────┘
                                             │
                                             │ complete_upgrade
                                             ▼
                                     ┌────────────────┐
                                     │     Active     │
                                     │ (level + 1)    │
                                     └────────────────┘
```

### Transitions

#### `Empty` → `Building`
```
Trigger: build_building
Guards:
  - Slot is empty
  - Player has estate level >= building.required_estate_level()
  - Building type not already present in estate
  - Sufficient locked NOVI for cost
Actions:
  - Deduct NOVI cost
  - Set slot.building_type
  - Set slot.status = Building
  - Set slot.level = 0
  - Set slot.construction_started = now
  - Set slot.construction_ends = now + construction_time
  - Increment total_buildings
  - Emit BuildingStarted
```

#### `Building` → `Active`
```
Trigger: complete_building
Guards:
  - slot.status == Building
  - now >= slot.construction_ends
Actions:
  - Set slot.status = Active
  - Set slot.level = 1
  - Set slot.mastery_level = 1
  - Recalculate estate_level
  - Recalculate building buffs
  - Emit BuildingCompleted
```

#### `Active` → `Upgrading`
```
Trigger: upgrade_building
Guards:
  - slot.status == Active
  - slot.level < MAX_BUILDING_LEVEL (20)
  - Sufficient locked NOVI for upgrade cost
Actions:
  - Deduct NOVI cost (φ² scaling per level)
  - Set slot.status = Upgrading
  - Set slot.construction_started = now
  - Set slot.construction_ends = now + construction_time
  - Emit UpgradeStarted
```

#### `Upgrading` → `Active`
```
Trigger: complete_upgrade
Guards:
  - slot.status == Upgrading
  - now >= slot.construction_ends
Actions:
  - Set slot.status = Active
  - Increment slot.level
  - Update slot.total_novi_invested
  - Recalculate estate_level
  - Recalculate building buffs
  - Emit UpgradeCompleted
```

---

## 3. Plot Expansion

### States

| Plots Owned | Slots Available | Description |
|-------------|-----------------|-------------|
| 1 | 4 | Starting estate |
| 2 | 8 | First expansion |
| 3 | 12 | Second expansion |
| 4 | 16 | Third expansion |
| 5 | 20 | Maximum |

### Transition

#### Buy Plot
```
Trigger: buy_plot
Guards:
  - plots_owned < 5
  - Sufficient locked NOVI for cost (φ² scaling)
Actions:
  - Deduct NOVI cost
  - Increment plots_owned
  - Update current_slots
  - Initialize new slots as Empty
  - Emit PlotPurchased
```

### Plot Costs (φ² Scaling)
```
Plot 2: 100,000 NOVI
Plot 3: ~262,000 NOVI
Plot 4: ~685,000 NOVI
Plot 5: ~1,790,000 NOVI
```

---

## 4. Building Types & Tiers

### Tier 1 - Foundation (Estate Level 1-6)

| Building | Unlock | Effect |
|----------|--------|--------|
| Mansion | 1 | XP gain bonus |
| Barracks | 2 | Attack bonus, training speed |
| Workshop | 4 | Mining expeditions |
| Dock | 5 | Fishing expeditions |
| Vault | 6 | Storage, NOVI cap bonus |

### Tier 2 - Expansion (Estate Level 8-14)

| Building | Unlock | Effect |
|----------|--------|--------|
| Sanctuary | 8 | Hero recruitment |
| Market | 10 | Trade discount |
| Citadel | 12 | Rally creation, defense |
| Academy | 14 | Research speed |

### Tier 3 - Mastery (Estate Level 16-24)

| Building | Unlock | Effect |
|----------|--------|--------|
| Forge | 16 | Equipment crafting |
| Arena | 18 | PvP damage bonus |
| Observatory | 20 | Loot bonus |
| Treasury | 24 | Prize bonus |

---

## 5. Building Buffs

### Per-Level Bonuses (0.5% base per level)

| Building | Primary Buff | Secondary Buff |
|----------|--------------|----------------|
| Mansion | +0.5% XP/level | - |
| Barracks | +0.5% Attack/level | +0.25% Training Speed/level |
| Vault | +0.5% Storage/level | +2.5% NOVI Cap/level |
| Forge | +1.5% Craft Success/level | - |
| Market | +1% Trade Discount/level | - |
| Academy | +1.5% Research Speed/level | - |
| Arena | +0.5% PvP Damage/level | - |
| Observatory | +1% Loot Bonus/level | - |
| Treasury | +2.5% Prize Bonus/level | - |
| Citadel | +0.5% Defense/level | +5% Rally Capacity/level |

---

## 6. Daily Activity System

### Time Windows

| Window | UTC Time | Duration |
|--------|----------|----------|
| Dawn | 00:00-08:00 | 8 hours |
| Midday | 08:00-16:00 | 8 hours |
| Dusk | 16:00-24:00 | 8 hours |

### Per-Building Mini-Games

Each building has a daily activity that grants temporary buffs:

| Building | Activity | Buff Duration |
|----------|----------|---------------|
| Barracks | Unit inspection | 24h unit effectiveness |
| Forge | Forge tune-up | 24h mastery bonus |
| Arena | Training drill | 24h arena damage |
| Observatory | Star reading | 24h loot bonus |
| Market | Price survey | 24h market discount |
| Sanctuary | Blessing | 24h blessed hero |
| Citadel | Stance selection | 24h defensive stance |

### Login Streak

```
Days 1-6:   1.0× multiplier
Days 7-13:  1.25× multiplier
Days 14-29: 1.5× multiplier
Days 30-59: 2.0× multiplier
Days 60-89: 2.5× multiplier
Days 90+:   3.0× multiplier

180-day milestone: +5% permanent bonus
```

---

## 7. Mastery System

### Per-Building Mastery (1-100)

Each building has its own mastery level that increases through use:

```
XP per activity = base × (1 + building_level / 10)
XP required = 100 × level²
```

### Mastery Bonuses
- Every 10 mastery levels: +1% to building's primary effect
- Mastery level 100: +10% total bonus

---

## 8. Account Structure

### EstateAccount (901 bytes)
```rust
pub struct EstateAccount {
    // Identity (35 bytes)
    pub owner: Pubkey,
    pub city_id: u16,
    pub bump: u8,

    // Progression (4 bytes)
    pub estate_level: u8,
    pub plots_owned: u8,
    pub total_buildings: u8,
    pub current_slots: u8,

    // Cached buffs (28 bytes)
    pub attack_bps: u16,
    pub defense_bps: u16,
    pub resource_gen_bps: u16,
    pub xp_gain_bps: u16,
    pub storage_bps: u16,
    pub training_speed_bps: u16,
    pub research_speed_bps: u16,
    pub craft_success_bps: u16,
    pub trade_discount_bps: u16,
    pub novi_cap_bonus_bps: u16,
    pub loot_bonus_bps: u16,
    pub prize_bonus_bps: u16,
    pub rally_capacity_bonus_bps: u16,
    pub pvp_damage_bps: u16,

    // Daily activity tracking (23 bytes)
    pub last_login_date: u16,
    pub login_streak: u16,
    pub longest_login_streak: u16,
    pub permanent_bonus_bps: u16,
    pub daily_date: u16,
    pub dawn_timestamp: i64,
    pub windows_completed: u8,
    pub dawn_buildings: u16,
    pub midday_buildings: u16,
    pub dusk_buildings: u16,

    // Daily buffs (43 bytes)
    pub unit_effectiveness_bps: u16,
    pub mastery_bonus_bps: u16,
    pub arena_damage_bps: u16,
    pub daily_loot_bonus_bps: u16,
    pub market_discount_bps: u16,
    pub blessed_hero: Pubkey,
    pub citadel_stance: u8,

    // Timestamps (16 bytes)
    pub created_at: i64,
    pub last_activity: i64,

    // Building slots (720 bytes = 20 × 36)
    pub buildings: [BuildingSlot; 20],
}
```

### BuildingSlot (36 bytes)
```rust
pub struct BuildingSlot {
    pub building_type: u8,
    pub status: u8,
    pub level: u8,
    pub mastery_level: u8,
    pub mastery_xp: u32,
    pub construction_started: i64,
    pub construction_ends: i64,
    pub total_novi_invested: u64,
}
```

---

## 9. Invariants

```
1. estate.owner matches PDA derivation
2. plots_owned ∈ [1, 5]
3. current_slots == plots_owned × 4
4. total_buildings <= current_slots
5. Each building type appears at most once
6. Building level ∈ [0, 20]
7. estate_level == sum of all building levels
8. Only one building per slot can be Building or Upgrading at a time
9. Building must be Active to use its features
```
