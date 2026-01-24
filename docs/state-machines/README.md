# Novus Mundus State Machines

Complete state machine documentation for all game systems.

## Systems Overview

| System | File | Description |
|--------|------|-------------|
| [Player](./player.md) | `player.md` | Core account, extensions, progression |
| [Dungeon](./dungeon.md) | `dungeon.md` | Roguelike PvE dungeon runs |
| [Expedition](./expedition.md) | `expedition.md` | Mining and fishing expeditions |
| [Rally](./rally.md) | `rally.md` | Group combat coordination |
| [Reinforcement](./reinforcement.md) | `reinforcement.md` | Teammate garrison support |
| [Estate](./estate.md) | `estate.md` | Building construction and upgrades |
| [Forge](./forge.md) | `forge.md` | Equipment crafting with staged tempering |
| [Hero](./hero.md) | `hero.md` | Hero NFTs, buffs, meditation |
| [Research](./research.md) | `research.md` | Tech tree progression |
| [Travel](./travel.md) | `travel.md` | Intra/inter-city movement |
| [Team](./team.md) | `team.md` | Team management and treasury |
| [Arena](./arena.md) | `arena.md` | Seasonal PvP competition |
| [Economy](./economy.md) | `economy.md` | Tokens, shop, resources |
| [Combat](./combat.md) | `combat.md` | PvE encounters and PvP attacks |
| [Kings Castle](./kings_castle.md) | `kings_castle.md` | Territorial control system |

## Architecture Principles

### 1. PDA-Based State Management
All accounts use Program Derived Addresses (PDAs) with deterministic seeds:
```
[SEED, identifier1, identifier2, ...]
```

### 2. Temporary vs Persistent Accounts

**Temporary (created on start, closed on completion):**
- ExpeditionAccount
- RallyParticipant
- ReinforcementAccount
- DungeonRun
- EventParticipation

**Persistent (never closed):**
- PlayerAccount
- EstateAccount
- TeamAccount
- KingRegistryAccount

### 3. Status Enums
Each system with lifecycle uses u8 status enums:
```rust
#[repr(u8)]
pub enum Status {
    State0 = 0,
    State1 = 1,
    // ...
}
```

### 4. Extension System (PlayerAccount)
Sequential unlocking with account resizing:
```
CORE (1016B) → +RESEARCH (96B) → +HEROES (130B) → +INVENTORY (424B)
             → +RALLY (80B) → +TEAM (40B) → +COSMETICS (80B)
```

### 5. Golden Ratio Scaling
Deterministic progression using φ (phi) family:
- `PHI = 1.618` - High-tier multipliers
- `GOLDEN_ROOT = 1.272` - Base progression per level
- `PHI_SQUARED = 2.618` - Legendary bonuses
- `PHI_INVERSE = 0.618` - Diminishing returns

### 6. Basis Points (BPS)
All percentages stored as u16 basis points:
- `10000 bps = 100%`
- `1500 bps = 15%`
- `250 bps = 2.5%`

## State Machine Notation

### States
```
┌────────────┐
│   State    │
└────────────┘
```

### Transitions
```
──────────────>  Normal transition
- - - - - - ->  Conditional/optional
═════════════>  Automatic (time-based)
```

### Guards (Conditions)
```
Trigger: instruction_name
Guards:
  - condition_1
  - condition_2
Actions:
  - effect_1
  - effect_2
```

## Cross-System Dependencies

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           PLAYER ACCOUNT                                │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │ RESEARCH│ │  HERO   │ │INVENTORY│ │  RALLY  │ │  TEAM   │           │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘           │
└───────┼──────────┼──────────┼──────────┼──────────┼────────────────────┘
        │          │          │          │          │
        ▼          ▼          ▼          ▼          ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
   │RESEARCH │ │SANCTUARY│ │  SHOP   │ │  RALLY  │ │  TEAM   │
   │ SYSTEM  │ │MEDITATION│ │ SYSTEM │ │ SYSTEM  │ │ SYSTEM  │
   └─────────┘ └─────────┘ └─────────┘ └────┬────┘ └────┬────┘
                    │                       │          │
                    ▼                       ▼          ▼
               ┌─────────┐            ┌─────────┐ ┌─────────┐
               │  HERO   │            │ COMBAT  │ │REINFORCE│
               │ SYSTEM  │            │ SYSTEM  │ │  MENT   │
               └─────────┘            └─────────┘ └─────────┘
                    │                       │
                    ▼                       ▼
               ┌─────────┐            ┌─────────┐
               │ DUNGEON │            │ KINGS   │
               │ SYSTEM  │            │ CASTLE  │
               └─────────┘            └─────────┘

   ┌─────────┐ ┌─────────┐ ┌─────────┐
   │ ESTATE  │ │EXPEDITION│ │ TRAVEL │
   │ SYSTEM  │ │ SYSTEM  │ │ SYSTEM │
   └────┬────┘ └─────────┘ └─────────┘
        │
        ▼
   ┌─────────┐
   │  FORGE  │
   │ SYSTEM  │
   └─────────┘
```

## Instruction Discriminant Ranges

| Range | System |
|-------|--------|
| 0-9 | Initialization |
| 10-19 | Economy |
| 20-29 | Combat |
| 30-49 | Travel |
| 50-59 | Team |
| 60-69 | Rally |
| 80-89 | Events |
| 120-129 | Research |
| 130-136 | Heroes |
| 160-179 | Estate |
| 180-189 | Forge |
| 190-199 | Reinforcement |
| 200-209 | Expedition |
| 230-236 | Arena |
| 250-269 | Dungeon |
| 270-299 | Kings Castle |
