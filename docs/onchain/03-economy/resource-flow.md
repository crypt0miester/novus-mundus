# Resource Flow

> How resources enter, circulate, and exit the Novus Mundus economy.

## Economic Model Overview

Novus Mundus uses a **sink-faucet economy** where resources are continuously created (faucets) and destroyed (sinks). Balance between these determines inflation/deflation.

```mermaid
graph TB
    subgraph "Faucets (Creation)"
        F1[Daily Rewards]
        F2[Expeditions]
        F3[Combat Loot]
        F4[Events]
        F5[Collection]
    end

    subgraph "Circulation"
        POOL[Player Economy]
        TRADE[Player Trading]
    end

    subgraph "Sinks (Destruction)"
        S1[Building Costs]
        S2[Research Costs]
        S3[Unit Hiring]
        S4[Speedups]
        S5[Combat Losses]
    end

    F1 & F2 & F3 & F4 & F5 --> POOL
    POOL <--> TRADE
    POOL --> S1 & S2 & S3 & S4 & S5
```

**Note:** Unit hiring uses locked NOVI, not cash.

## Faucets (Resource Creation)

### Daily Rewards
**Consistency:** Guaranteed daily
**Scale:** Small but reliable

```mermaid
graph LR
    LOGIN[Daily Login] --> STREAK{Streak Day}
    STREAK -->|1-3| LOW[100-200 gems]
    STREAK -->|4-7| MED[250-500 gems]
    STREAK -->|7+| HIGH[500+ gems]
```

| Day | Gems | Cash | Notes |
|-----|------|------|-------|
| 1 | 100 | 500 | Base rewards |
| 7 | 500 | 2,000 | Week streak |
| 30 | 1,000 | 5,000 | Month streak |

### Expeditions
**Consistency:** Player-controlled
**Scale:** Primary income source

```mermaid
graph TB
    subgraph "Mining Output"
        M1[Surface: 10 gems/op/hr]
        M2[Shallow: 18 gems/op/hr]
        M3[Deep: 30 gems/op/hr]
        M4[Volcanic: 50 gems/op/hr]
        M5[Abyssal: 80 gems/op/hr]
    end

    subgraph "Fishing Output"
        F1[Shore: 15 produce/op/hr]
        F2[River: 25 produce/op/hr]
        F3[Lake: 40 produce/op/hr]
        F4[DeepSea: 60 produce/op/hr]
        F5[Abyss: 100 produce/op/hr]
    end
```

**Expedition Modifiers:**
| Modifier | Effect | Source |
|----------|--------|--------|
| Operative Tier | +50-100% | T2/T3 operatives |
| Time of Day | ±20% | Peak/off-peak hours |
| Hero Affinity | +5-25% | MiningAffinity/FishingAffinity |
| Origin Bonus | +25% | Hero origin matches location |
| Research | +10-50% | Collection research |
| Observatory | +5-20% | Building bonus |
| Perfect Score | +15% | Strike minigame |
| Rare Find | +400% | Lucky roll |

[Source: processor/expedition/claim.rs](../../../programs/novus_mundus/src/processor/expedition/claim.rs)

### Combat Loot
**Consistency:** Variable (PvP/PvE)
**Scale:** Risk-reward based

**PvP Loot Formula:**
```
loot = defender_resources × loot_percentage × (1 + hero_loot_bonus)
loot_percentage = base_rate × (attacker_power / total_power)
```

**Encounter Loot:**
| Encounter Tier | Gems | Fragments | Cash |
|----------------|------|-----------|------|
| Common | 5-20 | 10-30 | 100-500 |
| Uncommon | 20-50 | 30-80 | 500-1,500 |
| Rare | 50-150 | 80-200 | 1,500-5,000 |
| Epic | 150-500 | 200-500 | 5,000-15,000 |

### Events
**Consistency:** Periodic
**Scale:** Large bursts

Events create temporary faucets:
- **Competition prizes** - Top performers get massive rewards
- **Participation rewards** - Everyone who joins gets something
- **Milestone rewards** - Reaching thresholds unlocks bonuses

### Resource Collection
**Consistency:** Cooldown-based
**Scale:** Location dependent

```mermaid
graph TB
    subgraph "Location Types"
        CITY[City Center] -->|4hr CD| CASH1[Cash: 200-1000]
        MINE[Mine] -->|2hr CD| GEMS1[Gems: 20-100]
        FARM[Farm] -->|2hr CD| PROD1[Produce: 50-200]
    end
```

[Source: processor/economy/collect_resources.rs](../../../programs/novus_mundus/src/processor/economy/collect_resources.rs)

---

## Sinks (Resource Destruction)

### Building Costs
**Type:** NOVI, Cash, Time
**Scale:** Increasing per level

```mermaid
graph LR
    subgraph "Building Cost Curve"
        L1[Level 1: 1,000]
        L5[Level 5: 8,000]
        L10[Level 10: 50,000]
        L15[Level 15: 200,000]
        L20[Level 20: 1,000,000]
    end
```

Buildings follow φ-based cost scaling:
```
cost(level) = base_cost × φ^(level-1)
```

### Research Costs
**Type:** NOVI, Time
**Scale:** Category dependent

| Category | Base Cost | Time |
|----------|-----------|------|
| Basic | 1,000 | 1 hour |
| Intermediate | 5,000 | 4 hours |
| Advanced | 20,000 | 12 hours |
| Expert | 50,000 | 24 hours |
| Master | 100,000 | 48 hours |

### Unit Hiring
**Type:** Locked NOVI
**Scale:** Tier dependent

| Unit | NOVI Cost | Sink Rate |
|------|-----------|-----------|
| T1 Operative | 100 | High volume |
| T2 Operative | 500 | Medium volume |
| T3 Operative | 2,000 | Low volume |
| Weapons | 200-2,000 | Combat losses |

### Speedups
**Type:** Gems (primary)
**Scale:** Time-based

Speedups are the **primary gem sink**:
```
gem_cost = remaining_minutes × rate × tier_multiplier
```

| Speedup Type | Base Rate | Tier 2 Multiplier |
|--------------|-----------|-------------------|
| Expedition | 100/min | 2x |
| Research | 50/min | 2x |
| Rally | 75/min | 2x |
| Building | 100/min | N/A |

### Combat Losses
**Type:** Units, Equipment
**Scale:** Battle outcome

Combat creates a natural unit sink:
```
casualties = units × casualty_rate × (1 - defense_reduction)
casualty_rate = damage_taken / unit_hp
```

---

## Circulation Mechanics

### Player-to-Player Trading

```mermaid
sequenceDiagram
    participant A as Player A
    participant P as Program
    participant B as Player B

    A->>P: transfer_cash(B, 1000)
    P->>P: Deduct from A.cash
    P->>P: Add to B.cash
    P-->>A: Success
    P-->>B: Received 1,000 cash
```

**Tradeable:**
- Cash (instruction 18)
- NOVI (via SPL transfer)

**Non-tradeable:**
- Gems
- Fragments (bound)
- Experience
- Research progress

### Team Treasury

Teams act as economic pools:
```mermaid
graph TB
    subgraph "Team Treasury"
        M1[Member 1] -->|deposit| TREASURY[Team Treasury]
        M2[Member 2] -->|deposit| TREASURY
        M3[Member 3] -->|deposit| TREASURY
        TREASURY -->|leader withdraw| LEADER[Leader]
    end
```

[Source: processor/team/deposit_treasury.rs](../../../programs/novus_mundus/src/processor/team/deposit_treasury.rs)

---

## Economic Balance

### Inflation Control

**Problem:** Too many faucets → currency devaluation
**Solution:** Scale sinks with progression

```mermaid
graph TB
    subgraph "Early Game"
        EF[Small Faucets] --> ES[Small Sinks]
    end

    subgraph "Mid Game"
        MF[Medium Faucets] --> MS[Medium Sinks]
    end

    subgraph "Late Game"
        LF[Large Faucets] --> LS[Large Sinks]
    end

    ES -->|progression| MS
    MS -->|progression| LS
```

### Deflation Prevention

**Problem:** Too many sinks → player frustration
**Solution:** Guaranteed minimum income

- Daily rewards always available
- Expedition base yield unaffected by competition
- Collection cooldowns, not competition

### Economic Velocity

Different currencies have different velocities:

| Currency | Velocity | Design Intent |
|----------|----------|---------------|
| Cash | High | Frequent transactions |
| Gems | Medium | Strategic spending |
| NOVI | Low | Value store |
| Fragments | Medium | Crafting cycles |

---

## Flow Visualization

### Complete Economy Flow

```mermaid
flowchart TB
    subgraph EXTERNAL["External"]
        MONEY[Real Money]
        MARKET[DEX/Market]
    end

    subgraph FAUCETS["Faucets"]
        DAILY[Daily Rewards]
        EXPED[Expeditions]
        COMBAT[Combat]
        EVENTS[Events]
        COLLECT[Collection]
    end

    subgraph PLAYER["Player Balances"]
        NOVI_L[Locked NOVI]
        GEMS[Gems]
        CASH[Cash]
        FRAG[Fragments]
        PROD[Produce]
    end

    subgraph SINKS["Sinks"]
        BUILD[Buildings]
        RESEARCH[Research]
        UNITS[Unit Hiring]
        SPEED[Speedups]
        LOSSES[Combat Losses]
    end

    MONEY -->|purchase| GEMS
    MONEY -->|purchase| NOVI_L
    MARKET <-->|trade| NOVI_L

    DAILY --> GEMS & CASH
    EXPED --> GEMS & FRAG & PROD
    COMBAT --> CASH & FRAG
    EVENTS --> GEMS & CASH & NOVI_L
    COLLECT --> CASH & PROD

    NOVI_L --> BUILD & RESEARCH & UNITS
    GEMS --> SPEED
    CASH --> EQUIP
    FRAG --> BUILD
    PROD --> RALLY

    UNITS --> LOSSES
```

---

## Balance Levers

Game designers can tune economy via constants:

| Lever | Location | Effect |
|-------|----------|--------|
| `MINING_GEMS_PER_OP_HOUR` | constants.rs | Gem faucet rate |
| `BUILDING_COST_BASE` | constants.rs | NOVI sink rate |
| `SPEEDUP_GEMS_PER_MINUTE` | speedup.rs | Gem sink rate |
| `DAILY_REWARD_BASE` | constants.rs | Guaranteed income |
| `COMBAT_CASUALTY_RATE` | combat.rs | Unit sink rate |

[Source: constants.rs](../../../programs/novus_mundus/src/constants.rs)

---

Next: [Time Value](./time-value.md) - How time creates economic value
