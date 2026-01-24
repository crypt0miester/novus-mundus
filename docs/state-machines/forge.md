# Forge System State Machine

## Overview

The Forge system enables crafting of quality equipment using the **Staged Tempering** mechanic. Players must time their "strikes" within precise windows across multiple stages to successfully craft higher-tier items. This creates a skill-based, deterministic crafting experience.

---

## 1. Craft Lifecycle

### States

| State | Description |
|-------|-------------|
| `Idle` | No active craft |
| `WaitingForWindow` | Stage scheduled, window not yet open |
| `WindowOpen` | Player can strike |
| `StageComplete` | Stage successful, next stage scheduled |
| `Completed` | All stages done, item created |
| `Failed` | Window missed, craft failed |

### State Diagram

```
┌────────────────┐  start_craft    ┌────────────────┐
│                │ ──────────────> │                │
│      Idle      │                 │WaitingForWindow│
│                │                 │                │
└────────────────┘                 └───────┬────────┘
       ▲                                   │
       │                                   │ window_opens_at elapsed
       │                                   ▼
       │                           ┌────────────────┐
       │                           │                │
       │ abandon_craft             │  WindowOpen    │◄─────────────┐
       │                           │                │              │
       │                           └───────┬────────┘              │
       │                                   │                       │
       │              ┌────────────────────┼────────────────┐      │
       │              │ strike             │ window_closes  │      │
       │              ▼                    ▼                │      │
       │      ┌─────────────┐      ┌─────────────┐         │      │
       │      │             │      │             │         │      │
       │      │StageComplete│      │   Failed    │─────────┤      │
       │      │             │      │             │         │      │
       │      └──────┬──────┘      └─────────────┘         │      │
       │             │                                      │      │
       │             │ more stages?                         │      │
       │             ├─── yes ──────────────────────────────┘      │
       │             │                                             │
       │             │ no (all stages done)                        │
       │             ▼                                             │
       │      ┌─────────────┐                                      │
       │      │             │                                      │
       └──────│  Completed  │                                      │
              │             │                                      │
              └─────────────┘                                      │
```

### Transitions

#### `Idle` → `WaitingForWindow`
```
Trigger: start_craft
Guards:
  - Player has Forge building active
  - Forge level >= tier.required_forge_level()
  - Forge mastery >= tier.required_mastery_level()
  - Sufficient materials for tier
  - Sufficient locked NOVI for tier
  - No active craft in progress
Actions:
  - Deduct materials (varies by tier)
  - Deduct NOVI cost
  - Set active_craft_equipment = equipment_type
  - Set target_tier = quality_tier
  - Set stages_required = tier.stages_required()
  - Set current_stage = 1
  - Set stages_completed = 0
  - Calculate window_opens_at = now + stage_interval
  - Calculate window_closes_at = window_opens_at + window_duration
  - Set craft_started_at = now
  - Emit CraftStarted
```

#### `WaitingForWindow` → `WindowOpen`
```
Trigger: Time passage
Guards:
  - now >= window_opens_at
  - now <= window_closes_at
Actions:
  - Window is open for striking
  - No state field change (computed)
```

#### `WindowOpen` → `StageComplete`
```
Trigger: strike
Guards:
  - Active craft in progress
  - Window is open (window_opens_at <= now <= window_closes_at)
  - Game authority co-signs (validates timing)
Actions:
  - Calculate precision score (how centered in window)
  - Accumulate precision_score
  - Increment stages_completed
  - Increment current_stage
  - Award mastery XP
  - If current_stage <= stages_required:
    - Schedule next window
  - Emit StageStruck
```

#### `StageComplete` → `WaitingForWindow`
```
Trigger: Automatic (if more stages remain)
Guards:
  - current_stage <= stages_required
Actions:
  - Calculate next window_opens_at
  - Calculate next window_closes_at
```

#### `StageComplete` → `Completed`
```
Trigger: Automatic (all stages done)
Guards:
  - stages_completed >= stages_required
Actions:
  - Add crafted item to quality_counts
  - Increment total_crafts
  - Increment successful_crafts
  - Increase Forge mastery
  - Clear craft state
  - Emit CraftCompleted
```

#### `WindowOpen` → `Failed`
```
Trigger: Time passage (window missed)
Guards:
  - now > window_closes_at
  - Window not struck
Actions:
  - Materials are LOST
  - Increment total_crafts
  - Increment failed_crafts
  - Award partial mastery XP (for completed stages)
  - Clear craft state
  - Emit CraftFailed
```

#### Any → `Idle`
```
Trigger: abandon_craft
Guards:
  - Active craft in progress
Actions:
  - Materials are LOST (no refund)
  - Clear craft state
  - Emit CraftAbandoned
```

---

## 2. Quality Tiers

### Tier Requirements

| Tier | Forge Lvl | Mastery | Stages | Window | NOVI Cost |
|------|-----------|---------|--------|--------|-----------|
| Refined | 1 | 1 | 1 | 1 hour | 1,000 |
| Superior | 5 | 5 | 2 | 30 min | 2,618 |
| Elite | 8 | 15 | 3 | 15 min | 6,854 |
| Masterwork | 12 | 30 | 5 | 5 min | 17,944 |
| Legendary | 16 | 50 | 8 | 2 min | 46,979 |
| Mythic | 18 | 75 | 11 | 1.5 min | 122,991 |
| Divine | 20 | 100 | 13 | 1 min | 322,069 |

### Stage Intervals

| Tier | Interval | Description |
|------|----------|-------------|
| Refined | 60s | Relaxed pace |
| Superior | 50s | Comfortable |
| Elite | 40s | Focused |
| Masterwork | 30s | Demanding |
| Legendary | 25s | Intense |
| Mythic | 20s | Expert |
| Divine | 15s | Mastery required |

---

## 3. Material Requirements

### Per-Tier Material Cost

| Tier | Common | Uncommon | Rare | Epic | Legendary |
|------|--------|----------|------|------|-----------|
| Refined | 50 | - | - | - | - |
| Superior | 100 | 25 | - | - | - |
| Elite | - | 100 | 25 | - | - |
| Masterwork | - | - | 100 | 25 | - |
| Legendary | - | - | - | 100 | 25 |
| Mythic | - | - | - | - | 200 |
| Divine | - | - | - | - | 400 |

---

## 4. Precision System

### Precision Score Calculation
```
window_center = (window_opens_at + window_closes_at) / 2
distance_from_center = |now - window_center|
max_distance = window_duration / 2

precision = 10000 × (1 - distance_from_center / max_distance)
```

### Precision Effects
- **Perfect (9000+)**: Bonus mastery XP
- **Good (7000-8999)**: Standard completion
- **Fair (5000-6999)**: Reduced mastery XP
- **Poor (0-4999)**: Minimal mastery XP

### Average Precision Score
```
average_precision = total_precision / stages_completed
```

---

## 5. Equipment System

### Craftable Equipment Types

| Type | Effect | Applies To |
|------|--------|------------|
| Melee Weapons | Attack damage bonus | Close combat |
| Ranged Weapons | Attack damage bonus | Ranged combat |
| Siege Weapons | Attack damage bonus | Siege combat |
| Armor | Damage reduction | Defense |

### Tier Bonuses (when equipped)

| Tier | Bonus |
|------|-------|
| Refined | +2.5% |
| Superior | +5% |
| Elite | +10% |
| Masterwork | +15% |
| Legendary | +25% |
| Mythic | +40% |
| Divine | +60% |

### Equipping
```
Trigger: equip_item
Guards:
  - Has crafted item of type and tier
  - Item count > 0
Actions:
  - Set active_{type}_tier = tier
  - Update player.equipped_weapon_bonus_bps (sum of weapons)
  - Update player.equipped_armor_bonus_bps
  - Emit ItemEquipped
```

---

## 6. Account Structure

### CraftedEquipmentAccount (196 bytes)
```rust
pub struct CraftedEquipmentAccount {
    pub owner: Pubkey,

    // Quality counts per type (4 × 32 bytes)
    pub melee_weapons: QualityCounts,    // [u32; 8]
    pub ranged_weapons: QualityCounts,
    pub siege_weapons: QualityCounts,
    pub armor: QualityCounts,

    // Active craft state (40 bytes)
    pub active_craft_equipment: u8,      // 255 = none
    pub target_tier: u8,
    pub stages_required: u8,
    pub current_stage: u8,
    pub stages_completed: u8,
    pub window_opens_at: i64,
    pub window_closes_at: i64,
    pub craft_started_at: i64,
    pub precision_score: u16,

    // Stats (20 bytes)
    pub total_crafts: u32,
    pub successful_crafts: u32,
    pub failed_crafts: u32,
    pub total_novi_spent: u64,

    // Equipped tiers (4 bytes)
    pub active_melee_tier: u8,
    pub active_ranged_tier: u8,
    pub active_siege_tier: u8,
    pub active_armor_tier: u8,

    pub bump: u8,
}
```

### QualityCounts (32 bytes)
```rust
pub struct QualityCounts {
    pub counts: [u32; 8],  // Count at each quality tier
}
```

---

## 7. Building Integration

### Forge Building Requirements
- **Unlock**: Estate Level 16
- **Initial Craft Tier**: Refined (Forge Level 1)
- **Per-Level Buff**: +1.5% craft success rate

### Forge Mastery
- Separate from building level
- Increases from successful crafts
- Gates access to higher tiers

---

## 8. Invariants

```
1. Only one active craft per player
2. Window cannot be struck twice
3. Materials consumed at start (not recoverable)
4. stages_completed <= stages_required
5. current_stage = stages_completed + 1 (during craft)
6. Equipped tier must have count > 0 in quality_counts
7. Window duration decreases with tier
8. Stage interval decreases with tier
9. active_craft_equipment == 255 when idle
```
