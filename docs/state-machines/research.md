# Research System State Machine

## Overview

The Research system provides a tech tree progression where players unlock permanent buffs and game features. Research requires time and NOVI, with multiple branches focusing on different aspects of gameplay.

---

## 1. Research Slot Lifecycle

### States

| State | Value | Description |
|-------|-------|-------------|
| `Idle` | 0 | No research in progress |
| `Researching` | 1 | Research actively in progress |

### State Diagram

```
┌────────────────┐  start_research  ┌────────────────┐
│                │ ───────────────> │                │
│      Idle      │                  │  Researching   │
│   (slot = 0)   │ <─────────────── │   (slot = 1)   │
└────────────────┘  complete_research└────────────────┘
        ▲                                   │
        │                                   │ cancel_research
        └───────────────────────────────────┘
```

### Transitions

#### `Idle` → `Researching`
```
Trigger: start_research
Guards:
  - Player has RESEARCH extension
  - Academy building active
  - No research currently in progress
  - Prerequisites met for research_id
  - Research not already completed
  - Sufficient locked NOVI for cost
Actions:
  - Deduct NOVI cost
  - Set player.current_research_id = research_id
  - Set player.research_started_at = now
  - Calculate research_ends_at with Academy speed bonus
  - Emit ResearchStarted
```

#### `Researching` → `Idle` (Complete)
```
Trigger: complete_research
Guards:
  - player.current_research_id != 0
  - now >= research_ends_at
Actions:
  - Mark research as completed in player.research_completed bitfield
  - Apply permanent buffs to player
  - Unlock features if applicable
  - Set player.current_research_id = 0
  - Set player.research_started_at = 0
  - Emit ResearchCompleted
```

#### `Researching` → `Idle` (Cancel)
```
Trigger: cancel_research
Guards:
  - player.current_research_id != 0
Actions:
  - Refund partial NOVI (50% of remaining time value)
  - Set player.current_research_id = 0
  - Set player.research_started_at = 0
  - Emit ResearchCancelled
```

---

## 2. Research Tree Structure

### Branches

| Branch | Focus | Key Unlocks |
|--------|-------|-------------|
| Combat | Attack power | Crit chance, crit damage |
| Defense | Protection | Armor efficiency |
| Economy | Resources | Mining, fishing, trading |
| Production | Generation | Cash, produce rates |
| Exploration | Travel | Speed, stamina |

### Tier Progression

| Tier | Academy Req | Base Time | Base Cost |
|------|-------------|-----------|-----------|
| 1 | 1 | 1 hour | 1,000 NOVI |
| 2 | 5 | 4 hours | 5,000 NOVI |
| 3 | 10 | 12 hours | 25,000 NOVI |
| 4 | 15 | 24 hours | 100,000 NOVI |
| 5 | 20 | 48 hours | 500,000 NOVI |

---

## 3. Research Items

### Combat Branch

| ID | Name | Prereq | Effect |
|----|------|--------|--------|
| 101 | Basic Tactics | - | +5% attack |
| 102 | Advanced Tactics | 101 | +10% attack |
| 103 | Critical Focus | 102 | +3% crit chance |
| 104 | Critical Power | 103 | +15% crit damage |
| 105 | Master Tactician | 104 | +20% attack |

### Defense Branch

| ID | Name | Prereq | Effect |
|----|------|--------|--------|
| 201 | Fortification I | - | +5% defense |
| 202 | Fortification II | 201 | +10% defense |
| 203 | Armor Mastery | 202 | +15% armor efficiency |
| 204 | Shield Wall | 203 | +20% defense |
| 205 | Impenetrable | 204 | +25% defense |

### Economy Branch

| ID | Name | Prereq | Effect |
|----|------|--------|--------|
| 301 | Resource Gathering | - | Unlock mining |
| 302 | Advanced Mining | 301 | +10% mining yield |
| 303 | Fishing License | 301 | Unlock fishing |
| 304 | Deep Sea Fishing | 303 | +10% fishing yield |
| 305 | Collection Mastery | 302, 304 | +25% all collection |

### Production Branch

| ID | Name | Prereq | Effect |
|----|------|--------|--------|
| 401 | Cash Flow | - | +10% cash generation |
| 402 | Produce Farming | - | +10% produce generation |
| 403 | Efficient Markets | 401 | +15% cash generation |
| 404 | Industrial Farming | 402 | +15% produce generation |
| 405 | Economic Mastery | 403, 404 | +25% all generation |

### Exploration Branch

| ID | Name | Prereq | Effect |
|----|------|--------|--------|
| 501 | Swift Travel | - | +10% travel speed |
| 502 | Endurance | - | +20% max stamina |
| 503 | Pathfinding | 501 | +20% travel speed |
| 504 | Marathon Runner | 502 | +40% max stamina |
| 505 | World Explorer | 503, 504 | +30% travel speed |

---

## 4. Speedup System

### Research Speedup
```
Trigger: speed_up_research
Guards:
  - Research in progress
  - Remaining time > 0
  - Sufficient gems
Actions:
  - Calculate time reduction
  - Deduct gems
  - Adjust research_ends_at
  - Emit ResearchSpeedup
```

### Gem Cost Formula
```
gems_required = minutes_remaining × GEMS_PER_MINUTE
```

---

## 5. Ascension System

### Overview
After completing all tier 5 research in a branch, players can "ascend" the branch for enhanced bonuses.

### Ascension Levels
```
Level 1: +10% to all branch effects
Level 2: +20% to all branch effects
Level 3: +30% to all branch effects (max)
```

### Transition

#### Ascend Branch
```
Trigger: ascend_research
Guards:
  - All tier 5 research in branch completed
  - ascension_level[branch] < 3
  - Sufficient NOVI and materials
Actions:
  - Increment ascension_level[branch]
  - Apply bonus multiplier to branch effects
  - Emit BranchAscended
```

---

## 6. PlayerAccount Research Fields

### Research Extension (+96 bytes)
```rust
// Current research
pub current_research_id: u16,
pub research_started_at: i64,

// Completed research (bitfield)
pub research_completed: [u64; 8],  // 512 possible researches

// Permanent buffs (from completed research)
pub research_attack_bps: u16,
pub research_defense_bps: u16,
pub research_crit_chance_bps: u16,
pub research_crit_damage_bps: u16,
pub research_armor_efficiency_bps: u16,
pub research_cash_generation_bps: u16,
pub research_produce_generation_bps: u16,
pub research_collection_bps: u16,
pub research_travel_speed_bps: u16,
pub research_stamina_bps: u16,

// Feature flags
pub has_daily_rewards: bool,
pub has_mining: bool,
pub has_fishing: bool,
pub has_trading: bool,

// Ascension levels
pub ascension_combat: u8,
pub ascension_defense: u8,
pub ascension_economy: u8,
pub ascension_production: u8,
pub ascension_exploration: u8,
```

---

## 7. Building Integration

### Academy Requirements
- **Unlock**: Estate Level 14
- **Effect**: Enables research system
- **Per-Level Bonus**: +1.5% research speed per level

### Research Speed Calculation
```
base_time = research.base_duration
academy_bonus = academy_level × 150  // 1.5% per level
hero_bonus = player.hero_research_speed_bps

effective_time = base_time × 10000 / (10000 + academy_bonus + hero_bonus)
```

---

## 8. Invariants

```
1. Only one research active at a time
2. Prerequisites must be completed before starting
3. Cannot research already-completed items
4. Research buffs are permanent once completed
5. Cancellation refunds partial NOVI only
6. Ascension requires all tier 5 in branch
7. Maximum ascension level is 3
8. Research ID 0 = no active research
```
