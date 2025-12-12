# Estate System Design Document

> **Personal empire building with interactive buildings, team headquarters, and deep progression systems powered by golden ratio mathematics**

---

## Table of Contents

1. [Key Integration Decisions](#key-integration-decisions)
2. [Philosophy & Vision](#philosophy--vision)
3. [Estate Overview](#estate-overview)
4. [Building System](#building-system)
5. [Building Interiors & Activities](#building-interiors--activities)
6. [Team Headquarters](#team-headquarters)
7. [Land & Expansion](#land--expansion)
8. [Storyline & Quests](#storyline--quests)
9. [Financial Sinks](#financial-sinks)
10. [Social Features](#social-features)
11. [State Structures](#state-structures)
12. [Instructions](#instructions)
13. [Integration Points](#integration-points)
14. [Expandability Architecture](#expandability-architecture)
15. [Migration from Monuments](#migration-from-monuments)
16. [Balance & Progression](#balance--progression)
17. [Implementation Phases](#implementation-phases)
18. [Challenges & Mitigations](#challenges--mitigations)

---

## Key Integration Decisions

These decisions define how the Estate System integrates with existing game mechanics:

### 1. Buff Stacking: Hybrid Approach

**Method**: Additive within category, Multiplicative between categories

```
Categories:
├── Research buffs (additive with each other)
├── Hero buffs (additive with each other)
├── Building buffs (additive with each other)
├── Equipment buffs (additive with each other)

Final calculation:
final = base × research_total × hero_total × building_total × equipment_total

Example:
├── Base attack: 1000
├── Research: +30% (1.30x)
├── Heroes: +25% (1.25x)
├── Buildings: +20% (1.20x)
├── Equipment quality: +15% (1.15x)
└── Final: 1000 × 1.30 × 1.25 × 1.20 × 1.15 = 2,243 attack
```

**Rationale**: Rewards diversified investment across ALL systems. Exceeding 100% total buff is possible and expected for invested players.

### 2. Equipment Crafting: 8-Tier Quality System

When players craft equipment in buildings (Forge), the output:
- **Adds to PlayerCore equipment counts** (melee_weapons, armor_pieces, etc.)
- **Tracks quality in separate CraftedEquipment PDA** (8 tiers per equipment type)
- **Caches quality buff in PlayerCore** for combat calculations

#### Quality Tier Mathematics (Golden Ratio φ = 1.618)

**8 Quality Tiers with φ-based scaling:**

| Tier | Name | Buff/Item | 50 Items | Formula |
|------|------|-----------|----------|---------|
| 1 | Common | 0 bps | 0% | Shop baseline |
| 2 | Refined | 4 bps | +2% | 100/φ⁶ |
| 3 | Superior | 9 bps | +4.5% | 100/φ⁵ |
| 4 | Elite | 15 bps | +7.5% | 100/φ⁴ |
| 5 | Masterwork | 24 bps | +12% | 100/φ³ |
| 6 | Legendary | 38 bps | +19% | 100/φ² |
| 7 | Mythic | 62 bps | +31% | 100/φ |
| 8 | Divine | 100 bps | +50% | 100 (cap) |

**Cost Scaling (φ² = 2.618 per tier):**

| Tier | NOVI Cost | Craft Time | Success Rate | Mastery Req | Est. Unlock |
|------|-----------|------------|--------------|-------------|-------------|
| 2 | 1,000 | 4h | 100% | Lv.1 | Week 1 |
| 3 | 2,618 | 8h | 95% | Lv.5 | Week 2 |
| 4 | 6,854 | 16h | 85% | Lv.15 | Month 1 |
| 5 | 17,944 | 24h | 70% | Lv.30 | Month 2-3 |
| 6 | 46,979 | 48h | 50% | Lv.50 | Month 4-6 |
| 7 | 122,991 | 72h | 30% | Lv.75 | Month 7-10 |
| 8 | 322,069 | 168h (7d) | 15% | Lv.100 | Month 12+ |

**Mastery XP Requirements (φ³ scaling):**

| Level | XP Required | Cumulative | How to Earn |
|-------|-------------|------------|-------------|
| 1 | 100 | 100 | 10 Tier 2 crafts |
| 5 | 1,000 | 2,500 | ~100 Tier 2 crafts |
| 15 | 10,000 | 30,000 | ~300 mixed crafts |
| 30 | 50,000 | 150,000 | Tier 4-5 focus |
| 50 | 200,000 | 600,000 | Tier 5-6 grind |
| 75 | 500,000 | 2,000,000 | Heavy Tier 6 crafting |
| 100 | 1,000,000 | 5,000,000 | Endgame dedication |

**Mastery XP Gains:**
```
Per craft:
├── Tier 2: 10 XP
├── Tier 3: 25 XP
├── Tier 4: 60 XP
├── Tier 5: 150 XP
├── Tier 6: 400 XP
├── Tier 7: 1,000 XP
├── Tier 8: 3,000 XP

Daily bonuses:
├── First craft of day: +100 XP
├── Craft streak (7 days): +500 XP
└── Perfect craft (no failures): +50% XP

Weekly:
├── Weekly challenge: 1,000-5,000 XP
└── Event participation: Variable
```

**Material Requirements (Fibonacci + Scarcity):**

| Tier | Input Item | Materials | Special | Daily Mat Source |
|------|------------|-----------|---------|------------------|
| 2 | Common (shop) | 100 common | - | ~500/day |
| 3 | Refined | 200 uncommon | - | ~200/day |
| 4 | Superior | 400 rare | - | ~50/day |
| 5 | Elite | 800 epic | - | ~15/day |
| 6 | Masterwork | 1,500 legendary | - | ~3/day |
| 7 | Legendary | 3,000 legendary | +200 fragments | Fragments: ~5/day |
| 8 | Mythic | 5,000 legendary | +1,000 fragments +100 gems | Gems: purchase only |

**Time-to-Divine Analysis:**
```
DEDICATED PLAYER (4h/day, no speedups):
├── Month 1-2: Reach Mastery 30 (Tier 5 unlocked)
├── Month 3-5: Grind Tier 5, accumulate legendary materials
├── Month 5-7: Reach Mastery 50 (Tier 6 unlocked)
├── Month 7-10: Grind Tier 6, accumulate fragments
├── Month 10-12: Reach Mastery 75 (Tier 7 unlocked)
├── Month 12-15: Grind Tier 7, stockpile for Divine
├── Month 15+: Attempt first Divine craft (15% success)
│
├── Expected Divine crafts to succeed: ~7 attempts
├── Materials per attempt: 5,000 legendary + 1,000 frags + 100 gems
├── Total investment for 1 Divine weapon: ~35,000 legendary + 7,000 frags + 700 gems
└── FIRST DIVINE WEAPON: ~18 months for dedicated F2P player

WHALE PLAYER (unlimited gems for speedups):
├── Speedup all crafts, buy materials
├── Still gated by Mastery XP (can't speed up)
├── Still gated by fragment/gem accumulation
└── FIRST DIVINE WEAPON: ~6-8 months (gem accelerated)
```

**On Failure:**
- **Lose ALL materials** (NOVI + materials + special items + gems)
- **Item downgrades by 1 tier** (Mythic → Legendary)
- Can retry with new materials
- **No mastery XP on failure**
- Building mastery level increases success rate (+0.3% per mastery level, cap +30%)

**Success Rate Modifiers:**
```
final_rate = base_rate
           + (forge_mastery × 0.3%)      // Max +30% at mastery 100
           + (research_bonus)             // Max +10% from research
           + (hero_bonus)                 // Max +5% from equipped hero

Hard caps:
├── Tier 6: Max 80%
├── Tier 7: Max 60%
└── Tier 8: Max 45% (even fully maxed player has 55% failure risk)
```

#### Gem Speedup System

Crafting can be accelerated using gems (but NOT mastery XP):

**Speedup Formula:**
```
gems_needed = ceil(remaining_hours) × tier_multiplier

Tier multipliers:
├── Tier 2-3: ×1 gem per hour
├── Tier 4-5: ×3 gems per hour
├── Tier 6:   ×10 gems per hour
├── Tier 7:   ×25 gems per hour
└── Tier 8:   ×50 gems per hour
```

**Examples:**
| Action | Time | Gems to Instant |
|--------|------|-----------------|
| Refined weapon | 4h | 4 gems |
| Elite weapon | 16h | 48 gems |
| Masterwork weapon | 24h | 72 gems |
| Legendary weapon | 48h | 480 gems |
| Mythic weapon | 72h | 1,800 gems |
| Divine weapon | 168h (7d) | 8,400 gems |

**Cannot Speed Up:**
- Mastery XP gain (time-gated)
- Daily/weekly bonus cooldowns
- Material acquisition rate

```rust
/// 8-tier quality system
pub const QUALITY_TIERS: usize = 8;

/// Buff per item at each quality tier (bps)
pub const QUALITY_BUFF_BPS: [u16; 8] = [
    0,    // Common (shop-bought)
    4,    // Refined
    9,    // Superior
    15,   // Elite
    24,   // Masterwork
    38,   // Legendary
    62,   // Mythic
    100,  // Divine
];

/// NOVI cost per tier (using φ² scaling from 1,000 base)
pub const QUALITY_NOVI_COST: [u64; 8] = [
    0,        // Common (shop)
    1_000,    // Refined
    2_618,    // Superior
    6_854,    // Elite
    17_944,   // Masterwork
    46_979,   // Legendary
    122_991,  // Mythic
    322_069,  // Divine
];

/// Base success rate per tier (bps, 10000 = 100%)
pub const QUALITY_SUCCESS_RATE: [u16; 8] = [
    10000,  // Common
    10000,  // Refined (100%)
    9500,   // Superior (95%)
    8500,   // Elite (85%)
    7000,   // Masterwork (70%)
    5000,   // Legendary (50%)
    3000,   // Mythic (30%)
    1500,   // Divine (15%)
];

/// Gem speedup tier multiplier
pub const SPEEDUP_MULTIPLIER: [u8; 8] = [0, 1, 1, 2, 2, 5, 5, 10];
```

**UI Display:**
```
MELEE WEAPONS: 127 total (+18.7% quality bonus)
═══════════════════════════════════════════════
│ Tier       │ Count │ Buff Each │ Total     │
├────────────┼───────┼───────────┼───────────┤
│ Common     │   50  │    -      │     -     │
│ Refined    │   35  │  +0.04%   │  +1.40%   │
│ Superior   │   20  │  +0.09%   │  +1.80%   │
│ Elite      │   12  │  +0.15%   │  +1.80%   │
│ Masterwork │    6  │  +0.24%   │  +1.44%   │
│ Legendary  │    3  │  +0.38%   │  +1.14%   │
│ Mythic     │    1  │  +0.62%   │  +0.62%   │
│ Divine     │    0  │  +1.00%   │     -     │
═══════════════════════════════════════════════
                        TOTAL:    +18.70%
```

### 3. Events: Free Entry, Criteria-Based

Competition events are **FREE** with entry requirements:
- Player level threshold
- Reputation threshold
- Subscription tier requirement
- Building ownership (e.g., "Must own Arena Lv.5")

**Prizes come from DAO-configurable game minting**, NOT pooled from players.

```rust
// EventAccount requirements (updated)
pub struct EventAccount {
    // ... existing fields ...
    pub entry_fee_novi: u64,        // REMOVED - always 0
    pub min_player_level: u8,       // Criteria
    pub min_reputation: u32,        // Criteria
    pub required_subscription: u8,  // Criteria (0 = none)
    pub required_building: u8,      // BuildingType (0 = none)
    pub required_building_level: u8,
}
```

### 4. Materials: Use Existing 5-Tier System

Buildings consume the existing material tiers from PlayerCore:
- `common_materials` (Tier 1)
- `uncommon_materials` (Tier 2)
- `rare_materials` (Tier 3)
- `epic_materials` (Tier 4)
- `legendary_materials` (Tier 5)

No new material types needed - buildings add demand for existing supply.

### 5. Research Integration: Buildings Unlock Research

The Academy building doesn't replace research - it **unlocks and accelerates** it:
- Academy ownership unlocks research system access
- Academy level provides `research_speed_bps` buff
- Uses existing `construction_speed_bps`, `upkeep_reduction_bps` from research tree

### 6. Subscription Tier Benefits

Building construction/maintenance affected by subscription:

| Tier | Construction Speed | Upkeep Reduction | Speedup Discount |
|------|-------------------|------------------|------------------|
| Rookie (Free) | - | - | - |
| Expert | +10% | -5% | -5% |
| Epic | +25% | -15% | -15% |
| Legendary | +50% | -30% | -30% |

### 7. Team HQ Access

Team HQ only available to teams meeting requirements:
- Minimum member count (e.g., 5+)
- Team level threshold
- Leader subscription tier requirement

### 8. No Maintenance/Upkeep

Buildings are **permanent investments** with NO recurring costs:
- Once built, buildings stay active forever
- No daily NOVI drain
- Financial sinks come from: construction, activities, speedups, craft failures
- Players never lose progress for being offline

### 9. Themes Are Purely Cosmetic (Off-Chain)

**On-chain state does NOT store or process themes.**

Themes are purely visual/cosmetic and handled entirely by the frontend:
- Building appearance
- UI styling
- Animation effects
- Sound effects

```
ON-CHAIN (Solana Program):
├── Building level
├── Mastery XP
├── Craft queue state
├── Material balances
└── NO theme field - program doesn't care

OFF-CHAIN (Frontend/Database):
├── Selected theme per building
├── Unlocked theme list
├── Theme purchase history
└── Visual preferences
```

**Why off-chain?**
1. Themes have ZERO gameplay effect
2. Saves on-chain storage/rent
3. No balance concerns
4. Players can customize freely
5. Easy to add new themes without program upgrade

**Theme Unlocks:**
| Theme | How to Unlock |
|-------|---------------|
| Classic | Default |
| Medieval | 5,000 NOVI |
| Eastern | 10,000 NOVI |
| Steampunk | Forge Mastery 25 |
| Volcanic | Forge Mastery 50 |
| Celestial | First Legendary craft |
| Abyssal | First Mythic craft |
| Divine | First Divine craft |
| Golden | Limited event |
| NFT Holder | Own specific NFT |

---

## Philosophy & Vision

### Core Principles

**1. Personal Ownership Over Collective Anonymity**
- Every player builds their **own empire**, not just contributing to city projects
- Buildings are **yours** - you see them, upgrade them, interact with them daily
- Your estate reflects your playstyle, investment, and achievements

**2. Active Engagement Over Passive Buffs**
- Buildings aren't just stat boosts - they're **places you visit**
- Each building has **activities** that require decisions and provide rewards
- Daily loops keep players returning: "What can I craft today? Who's challenging my Arena?"

**3. Depth Without Overwhelming Complexity**
- Start simple: 4 core buildings everyone understands
- Complexity unlocks gradually through progression
- Advanced features for dedicated players, core loop accessible to all

**4. Economic Sustainability**
- Every feature is a **sink** - construction, upgrades, maintenance, activities
- Sinks scale with player wealth (whales have whale-sized sinks)
- Value flows into the system, reducing inflation pressure

**5. Social Connection**
- Visit other players' estates
- Team buildings create shared investment
- Leaderboards and achievements drive competition

---

## Estate Overview

### What Is An Estate?

An Estate is a player's personal compound containing all their buildings. Think of it as your "home base" in the game world.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         🏰 YOUR ESTATE                                       │
│                         Location: New York (Capital)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   PLOT 1 (Starter)                    PLOT 2 (Purchased)                    │
│   ┌─────────┬─────────┐               ┌─────────┬─────────┐                 │
│   │ MANSION │ BARRACKS│               │  FORGE  │ ACADEMY │                 │
│   │  Lv.8   │  Lv.5   │               │  Lv.3   │  Lv.2   │                 │
│   ├─────────┼─────────┤               ├─────────┼─────────┤                 │
│   │WORKSHOP │  VAULT  │               │  ARENA  │  EMPTY  │                 │
│   │  Lv.4   │  Lv.6   │               │  Lv.1   │         │                 │
│   └─────────┴─────────┘               └─────────┴─────────┘                 │
│                                                                              │
│   ═══════════════════════════════════════════════════════════════════════   │
│   Estate Level: 29          Buildings: 7/8          Power: 45,670           │
│   Total Invested: 12.5M     Status: All Active      Visitors: 12 today      │
│   ═══════════════════════════════════════════════════════════════════════   │
│                                                                              │
│   [🏗️ Build] [⬆️ Upgrade] [🎨 Decorate] [📊 Stats] [🚪 Visit Friend]         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Estate Properties

| Property | Description |
|----------|-------------|
| **Estate Level** | Sum of all building levels (determines unlock thresholds) |
| **Estate Power** | Weighted calculation of building strength |
| **Location** | City where estate is built (affects bonuses) |
| **Plots** | Land parcels (1-5), each holds 4 buildings |
| **Building Slots** | Total available construction slots |
| **Visitors** | Other players who've visited (social metric) |

### Estate Level Unlocks

| Estate Level | Unlock |
|--------------|--------|
| 1 | Estate created, 4 Tier 1 buildings available |
| 5 | Building decorations unlocked |
| 10 | Tier 2 buildings available |
| 15 | Second plot purchasable |
| 20 | Building rentals unlocked |
| 25 | Tier 3 buildings available |
| 30 | Third plot purchasable |
| 40 | Legendary building variants |
| 50 | Fourth plot purchasable |
| 75 | Fifth plot purchasable |
| 100 | "Estate Master" title + exclusive features |

---

## Building System

### Building Tiers

Buildings are organized into 3 tiers, each unlocking at specific Estate Levels:

```
TIER 1 (Estate Level 1+)     TIER 2 (Estate Level 10+)    TIER 3 (Estate Level 25+)
├── Mansion                   ├── Forge                    ├── Sanctuary
├── Barracks                  ├── Market                   ├── Observatory
├── Workshop                  ├── Academy                  ├── Treasury
└── Vault                     └── Arena                    └── Citadel
```

### Tier 1: Foundation Buildings

These are the core buildings every player starts with access to.

---

#### 🏛️ Mansion

**Theme**: Your personal residence and command center

**Primary Buffs**:
| Level | XP Gain | Reputation Gain | Daily Bonus |
|-------|---------|-----------------|-------------|
| 1 | +5% | +3% | 100 cash |
| 5 | +12% | +8% | 500 cash |
| 10 | +22% | +15% | 2,000 cash |
| 15 | +35% | +24% | 8,000 cash |
| 20 | +50% | +35% | 25,000 cash |

**Interactive Features**:
- **Daily Login Bonus**: Collect scaling cash reward once per day
- **Guest Book**: See who visited your estate
- **Trophy Room**: Display achievements and rare items
- **Command Desk**: Quick access to all building activities

**Special Mechanics**:
- Mansion level determines estate "prestige" for visitor ratings
- Higher levels unlock more decoration options
- Acts as the "hub" for your estate

---

#### ⚔️ Barracks

**Theme**: Military training and unit management

**Primary Buffs**:
| Level | Unit Capacity | Defense Power | Training Speed |
|-------|---------------|---------------|----------------|
| 1 | +5% | +3% | +0% |
| 5 | +12% | +8% | +10% |
| 10 | +22% | +15% | +20% |
| 15 | +35% | +24% | +35% |
| 20 | +50% | +35% | +50% |

**Interactive Features**:
- **Training Grounds**: Queue unit training (faster than base)
- **Elite Training**: Unlock special unit variants
- **Drill Exercises**: Daily activity for small buff
- **Garrison View**: See your defensive setup

**Special Mechanics**:
- Can train "Elite" versions of units (stronger, cost more)
- Defensive hero stationed here gets bonus effectiveness
- Training queue slots increase with level

---

#### ⚒️ Workshop

**Theme**: Resource production and basic crafting

**Primary Buffs**:
| Level | Resource Gen | Crafting Speed | Material Yield |
|-------|--------------|----------------|----------------|
| 1 | +5% | +0% | +0% |
| 5 | +12% | +10% | +5% |
| 10 | +22% | +20% | +12% |
| 15 | +35% | +35% | +20% |
| 20 | +50% | +50% | +30% |

**Interactive Features**:
- **Production Lines**: Set automated resource generation
- **Crafting Bench**: Create basic equipment
- **Material Processing**: Convert raw materials to refined
- **Blueprint Library**: Unlock new recipes

**Special Mechanics**:
- Produces passive resources (small amounts) when active
- Crafting consumes materials + NOVI
- Recipes unlock through quests and level progression

---

#### 🏦 Vault

**Theme**: Secure storage and wealth protection

**Primary Buffs**:
| Level | Storage Capacity | Raid Protection | Interest Rate |
|-------|------------------|-----------------|---------------|
| 1 | +10% | 5% protected | 0% |
| 5 | +25% | 15% protected | 0.1%/day |
| 10 | +45% | 30% protected | 0.2%/day |
| 15 | +70% | 50% protected | 0.3%/day |
| 20 | +100% | 75% protected | 0.5%/day |

**Interactive Features**:
- **Deposit/Withdraw**: Move cash between hand and vault
- **Safe Deposit Boxes**: Store valuable items (protected from raids)
- **Investment Ledger**: Track your wealth over time
- **Security Upgrades**: Customize raid protection

**Special Mechanics**:
- Cash in vault is partially protected during PvP attacks
- Small daily interest on stored cash (NOVI cost to claim)
- Higher levels = more secure against high-level attackers

---

### Tier 2: Advanced Buildings

Unlocked at Estate Level 10. More complex mechanics and deeper sinks.

---

#### 🔥 Forge

**Theme**: Advanced equipment crafting and upgrades

**Primary Buffs**:
| Level | Weapon Effectiveness | Craft Quality | Upgrade Success |
|-------|---------------------|---------------|-----------------|
| 1 | +3% | +0% | Base |
| 5 | +8% | +5% | +10% |
| 10 | +15% | +12% | +25% |
| 15 | +24% | +20% | +40% |
| 20 | +35% | +30% | +60% |

**Interactive Features**:
- **Workbenches**: Multiple simultaneous craft/upgrade slots
- **Upgrade Station**: Improve equipment rarity tier
- **Reforging**: Reroll equipment stats
- **Enchanting**: Add special effects to items
- **Salvaging**: Break down items for materials

**Special Mechanics**:
- Workbench count: 1 base + 1 per 5 levels (max 5)
- Each craft/upgrade takes real time (speedup with gems)
- Legendary crafting unlocked at Forge level 15
- "Forge Mastery" XP system for recipe unlocks

**Crafting System**:
```
RECIPE: Reinforced Steel Sword
├── Input: Iron Sword (Common) + 50 Common Materials + 10 Uncommon Materials
├── Cost: 1,000 NOVI
├── Time: 2 hours
├── Output: Steel Sword (Uncommon)
└── Success Rate: 100% (reduced for higher tiers)

RECIPE: Legendary Dragon Blade
├── Input: Epic Sword + 100 Epic Materials + 20 Legendary Materials
├── Cost: 100,000 NOVI
├── Time: 48 hours
├── Output: Dragon Blade (Legendary)
└── Success Rate: 40% base + Forge bonus (fail = lose materials, keep sword)
```

---

#### 🏪 Market

**Theme**: Player-to-player trading and commerce

**Primary Buffs**:
| Level | Purchase Discount | Listing Fee Reduction | Trade Slots |
|-------|-------------------|----------------------|-------------|
| 1 | -2% | -0% | 3 |
| 5 | -5% | -10% | 5 |
| 10 | -10% | -25% | 8 |
| 15 | -15% | -40% | 12 |
| 20 | -20% | -50% | 20 |

**Interactive Features**:
- **Trading Floor**: List items for sale
- **Buy Orders**: Set desired purchases at target prices
- **Trade History**: Track your transactions
- **Price Charts**: View market trends
- **Instant Sell**: Quick sale at reduced price

**Special Mechanics**:
- Listing fee: 2% of price (reduced by level)
- Transaction fee: 3% on sale (NOVI burned)
- Trade slots limit active listings
- Can trade: Equipment, Materials, Consumables
- Cannot trade: NOVI, Heroes, Buildings

**Market Economics**:
```
SELLING FLOW:
1. Player lists "Epic Sword" for 50,000 cash
2. Listing fee: 1,000 cash (2% of price, reduced by Market level)
3. Buyer purchases for 50,000 cash
4. Transaction fee: 1,500 cash (3%, burned as NOVI equivalent)
5. Seller receives: 47,500 cash

INSTANT SELL:
- 80% of estimated market value
- No waiting for buyer
- Higher fee (5%)
- Good for quick liquidity
```

---

#### 📚 Academy

**Theme**: Research acceleration and special knowledge

**Primary Buffs**:
| Level | Research Speed | Research Cost | Special Paths |
|-------|---------------|---------------|---------------|
| 1 | +5% | -0% | 0 |
| 5 | +12% | -5% | 1 |
| 10 | +22% | -12% | 2 |
| 15 | +35% | -20% | 3 |
| 20 | +50% | -30% | 4 |

**Interactive Features**:
- **Research Boost**: Spend NOVI to accelerate current research
- **Special Courses**: Unlock exclusive research paths
- **Scholar NPCs**: Hire for passive research bonuses
- **Library**: Store and access lore/documentation
- **Thesis Defense**: Complete for one-time buffs

**Special Mechanics**:
- Academy unlocks "Special Research Paths" not in main tree
- Scholars cost NOVI/day but provide passive bonuses
- "Thesis" system: Complete challenges for permanent unlocks

**Special Research Paths** (Academy-Only):
```
PATH: Advanced Metallurgy
├── Prereq: Academy Level 5
├── Effect: +10% Forge success rate
├── Time: 7 days
└── Cost: 50,000 NOVI

PATH: Market Mastery
├── Prereq: Academy Level 10
├── Effect: -5% all trade fees
├── Time: 14 days
└── Cost: 150,000 NOVI

PATH: Temporal Studies
├── Prereq: Academy Level 15
├── Effect: -10% all building construction time
├── Time: 21 days
└── Cost: 500,000 NOVI
```

---

#### 🏟️ Arena

**Theme**: Combat challenges and competitive play

**Primary Buffs**:
| Level | Attack Power | Challenge Rewards | Champion Slots |
|-------|-------------|-------------------|----------------|
| 1 | +3% | +0% | 1 |
| 5 | +8% | +15% | 2 |
| 10 | +15% | +30% | 3 |
| 15 | +24% | +50% | 4 |
| 20 | +35% | +75% | 5 |

**Interactive Features**:
- **Daily Challenges**: Fight NPCs for rewards
- **Champion Setup**: Configure your fighting team
- **Defense Log**: See who attacked your arena
- **Leaderboard**: Compete for rankings
- **Special Events**: Timed tournaments

**Special Mechanics**:
- "Champions" are hero + unit combinations you configure
- Other players can challenge your arena (asynchronous PvP)
- Win streaks increase rewards
- Weekly reset with tier rewards

**Arena Challenge System**:
```
CHALLENGE TIERS:
├── Bronze (1-3 wins): 500 cash + 50 XP per win
├── Silver (4-7 wins): 2,000 cash + 150 XP per win
├── Gold (8-12 wins): 10,000 cash + 500 XP per win
├── Platinum (13-20 wins): 50,000 cash + 2,000 XP per win
└── Diamond (21+ wins): 200,000 cash + 10,000 XP per win

ENTRY: FREE (no fee)
REQUIREMENTS: Arena building ownership (level determines tier access)
├── Arena Lv.1: Bronze tier
├── Arena Lv.5: Silver tier
├── Arena Lv.10: Gold tier
├── Arena Lv.15: Platinum tier
└── Arena Lv.20: Diamond tier
LOSS: Streak resets, keep rewards earned so far
DAILY LIMIT: 5 + Arena level (e.g., Lv.10 = 15 challenges)
PRIZES: From game minting allocation (DAO configurable)
```

---

### Tier 3: Legendary Buildings

Unlocked at Estate Level 25. Endgame content with powerful effects.

---

#### 🏛️ Sanctuary

**Theme**: Hero rest, recovery, enhancement, and strategic synergy management

The Sanctuary is the endgame hero management building where players maximize their hero potential through meditation, synergies, awakenings, and fragment management.

**Primary Buffs**:
| Level | Hero XP Gain | Cooldown Reduction | Synergy Slots | Meditation Slots |
|-------|--------------|-------------------|---------------|------------------|
| 1 | +5% | -5% | 1 | 1 |
| 5 | +12% | -12% | 2 | 2 |
| 10 | +22% | -22% | 3 | 3 |
| 15 | +35% | -35% | 4 | 4 |
| 20 | +50% | -50% | 5 | 6 |

---

**🧘 MEDITATION SYSTEM**

Heroes placed in meditation gain passive XP without participating in combat.

```
MEDITATION MECHANICS:
├── Slots available: 1 + floor(Sanctuary level / 4)
├── Max slots at Lv.20: 6 heroes meditating simultaneously
├── XP per hour: 50 base × (1 + hero_level/100) × (1 + sanctuary_bonus)
├── Duration: Minimum 1 hour, maximum 72 hours
├── Cannot use meditating heroes in: Combat, Rallies, Defense
├── Can cancel early: Partial XP awarded (pro-rated)

XP CALCULATION EXAMPLE (Sanctuary Lv.15, Hero Lv.50):
├── Base: 50 XP/hour
├── Hero level bonus: 50 × 1.5 = 75 XP/hour
├── Sanctuary bonus (+35%): 75 × 1.35 = 101 XP/hour
├── 24 hour meditation: 2,424 XP
└── Compare to active play: ~500-1000 XP/hour (but requires attention)

MEDITATION TIERS (unlock with Sanctuary level):
├── Basic Rest (Lv.1): Standard XP gain
├── Deep Focus (Lv.8): +25% XP, 2x duration minimum
├── Transcendence (Lv.15): +50% XP, hero gains random buff on completion
└── Enlightenment (Lv.20): +75% XP, 5% chance to gain 1 fragment

SPEEDUP:
├── Cost: 3 gems per hour remaining
├── Example: 20 hours left = 60 gems to complete
└── Useful for: Needing hero for urgent rally
```

---

**⚡ SYNERGY CHAMBER**

Configure hero combinations to unlock team-wide buffs. This is where strategic hero collection pays off.

```
SYNERGY SLOTS:
├── Lv.1-4: 1 synergy active
├── Lv.5-9: 2 synergies active
├── Lv.10-14: 3 synergies active
├── Lv.15-19: 4 synergies active
└── Lv.20: 5 synergies active (maximum strategic flexibility)

SYNERGY TYPES:

CATEGORY SYNERGIES (3+ heroes of same type):
├── 3 Offensive heroes: +15% attack power (all heroes)
├── 3 Defensive heroes: +15% defense power (all heroes)
├── 3 Economic heroes: +20% cash collection (player)
├── 3 Hybrid heroes: +10% all stats (all heroes)
└── 5 of any category: Doubles the bonus

THEMATIC SYNERGIES (specific combinations):
├── "Warriors of Old": Alexander + Caesar + Genghis → +25% rally damage
├── "Crypto Legends": Satoshi + Vitalik + CZ → +30% NOVI generation
├── "Mythic Council": Zeus + Odin + Ra → +35% encounter damage
├── "Gaming Icons": Mario + Link + Master Chief → +20% XP gain
└── More synergies unlock through quests and discoveries

COMPLEMENTARY SYNERGIES (type combinations):
├── Attack + Defense pair: +10% team survivability
├── Economic + Offensive pair: +15% loot value
├── Full spectrum (1 of each type): +8% all stats
└── Legendary pair (2 legendary heroes): +20% power

DISCOVERY SYSTEM:
├── Some synergies are hidden until discovered
├── Discover by: Placing hero combinations in chamber
├── First discovery: Bonus fragments + achievement
├── Synergy journal tracks discovered/undiscovered
└── Hints available through Academy research
```

---

**🔮 FRAGMENT ALTAR**

Convert fragments between types and tiers. Essential for hero leveling optimization.

```
FRAGMENT TYPES:
├── Common Fragments: Drop from basic encounters
├── Uncommon Fragments: Drop from uncommon+ encounters
├── Rare Fragments: Drop from rare+ encounters, events
├── Epic Fragments: Events, high-tier content
└── Legendary Fragments: Major achievements, Divine crafting

UPWARD CONVERSION (combine into higher tier):
├── 100 Common → 20 Uncommon (10 gems)
├── 100 Uncommon → 20 Rare (25 gems)
├── 100 Rare → 20 Epic (75 gems)
├── 100 Epic → 10 Legendary (200 gems)
└── Conversion time: 1 hour per batch (speedup available)

DOWNWARD CONVERSION (split into lower tier):
├── 1 Legendary → 5 Epic (FREE)
├── 1 Epic → 5 Rare (FREE)
├── 1 Rare → 5 Uncommon (FREE)
├── 1 Uncommon → 5 Common (FREE)
└── Instant, no cooldown

BULK CONVERSION (Sanctuary Lv.10+):
├── 10x batches: 5% gem discount
├── 100x batches: 15% gem discount
└── Requires materials upfront

FRAGMENT TRANSMUTATION (Sanctuary Lv.15+):
├── Convert fragments to specific hero type affinity
├── Cost: 50 fragments + 100 gems → 40 typed fragments
├── Typed fragments give +25% XP when used on matching hero
└── Types: Offensive, Defensive, Economic, Hybrid
```

---

**✨ AWAKENING RITUAL**

The ultimate hero enhancement. Awakening permanently boosts a hero's potential.

```
AWAKENING REQUIREMENTS:
├── Hero must be max level (varies by hero rarity)
├── Sanctuary level 15+
├── Required fragments (see below)
├── NOVI cost
├── 48-hour ritual duration (no speedup)

AWAKENING COSTS BY HERO RARITY:
├── Common hero: 500 epic frags + 10,000 NOVI
├── Uncommon hero: 300 epic + 100 legendary frags + 25,000 NOVI
├── Rare hero: 500 legendary frags + 50,000 NOVI
├── Epic hero: 1,000 legendary frags + 100,000 NOVI
└── Legendary hero: 2,000 legendary frags + 250,000 NOVI

AWAKENING EFFECTS:
├── +25% to all hero buffs permanently
├── Unlocks "Awakened Ability" (unique per hero template)
├── Visual upgrade (golden aura, special effects)
├── Title: "Awakened [Hero Name]"
└── Cannot be reversed

AWAKENED ABILITIES (examples):
├── Alexander (Awakened): "Conqueror's Will" - Rallies gain +10% more participants
├── Satoshi (Awakened): "Genesis Block" - +5% NOVI on all transactions
├── Zeus (Awakened): "Lightning Strike" - 10% chance to deal 2x encounter damage
└── Each hero has unique ability designed around their theme

AWAKENING LIMITS:
├── Maximum 5 awakened heroes per player
├── Choose wisely - cannot undo
├── Awakened heroes count toward synergies
└── Planning required for optimal build
```

---

**🏺 ARTIFACT VAULT**

Store and display hero-related artifacts for passive bonuses.

```
ARTIFACT SLOTS: 2 + floor(Sanctuary level / 5) = max 6 at Lv.20

ARTIFACT SOURCES:
├── Event rewards
├── Achievement completions
├── Divine crafting byproducts
├── Special quests
└── Limited purchases

ARTIFACT EFFECTS (while displayed):
├── "Ancient Coin": +5% cash from all sources
├── "War Banner": +10% rally damage
├── "Tome of Knowledge": +15% hero XP gain
├── "Crystal Orb": +10% fragment drop rate
├── "Golden Chalice": +5% all hero buffs
├── "Dragon Scale": +20% defense vs encounters
└── More artifacts discovered through gameplay

ARTIFACT RARITY:
├── Common: +5% effect
├── Uncommon: +10% effect
├── Rare: +15% effect
├── Epic: +20% effect
├── Legendary: +25% effect + unique visual
└── Divine: +30% effect + aura + title

ARTIFACT UPGRADE (Sanctuary Lv.18+):
├── Combine 5 same-tier artifacts → 1 next-tier artifact
├── Random artifact from pool
├── Legendary+ cannot be combined
└── Preserves one artifact's type (player choice)
```

---

**📊 SANCTUARY MASTERY**

Like Forge, Sanctuary has its own mastery system.

```
MASTERY XP SOURCES:
├── Hero meditation completed: 50-500 XP (based on duration)
├── Synergy discovered: 1,000 XP (first time)
├── Fragment conversion: 10 XP per batch
├── Awakening completed: 10,000 XP
├── Artifact displayed: 100 XP (first time)
├── Daily sanctuary visit: 25 XP

MASTERY UNLOCKS:
├── Lv.5: Deep Focus meditation tier
├── Lv.10: Bulk conversion
├── Lv.15: Transcendence meditation + Fragment transmutation
├── Lv.20: Enlightenment meditation
├── Lv.30: Second awakening slot unlock
├── Lv.50: Third awakening slot unlock
├── Lv.75: Artifact upgrade ability
└── Lv.100: "Sanctuary Master" title + exclusive artifact
```

---

#### 🔭 Observatory

**Theme**: Information and encounter detection

**Primary Buffs**:
| Level | Encounter Detection | Rare Spawn Alert | Vision Range |
|-------|---------------------|------------------|--------------|
| 1 | +10% | Common only | City |
| 5 | +25% | +Uncommon | City + Adjacent |
| 10 | +40% | +Rare | 3 City Radius |
| 15 | +60% | +Epic | 5 City Radius |
| 20 | +80% | +Legendary | Global |

**Interactive Features**:
- **Star Chart**: View encounter spawns in range
- **Rare Alerts**: Get notified of valuable spawns
- **Celestial Events**: Special timed bonuses
- **Telescope Upgrade**: Extend vision range

**Special Mechanics**:
- See encounters before others = first-mover advantage
- "Lens crafting" consumes materials for temporary boosts
- Celestial events provide server-wide bonuses (Observatory owners get extra)

---

#### 💰 Treasury

**Theme**: Passive income and NOVI management

**Primary Buffs**:
| Level | Passive NOVI Gen | Staking Bonus | Max Stake |
|-------|------------------|---------------|-----------|
| 1 | 10/hour | +0% | 10,000 |
| 5 | 30/hour | +5% | 50,000 |
| 10 | 75/hour | +12% | 200,000 |
| 15 | 150/hour | +20% | 1,000,000 |
| 20 | 300/hour | +30% | 5,000,000 |

**Interactive Features**:
- **NOVI Staking**: Lock NOVI for bonus generation
- **Investment Portfolio**: Track your wealth growth
- **Tax Collection**: Claim from your operative units
- **Dividend System**: Earn from team activities

**Staking Mechanics**:
```
STAKE MECHANICS:
├── Minimum stake period: 7 days
├── Early withdrawal penalty: 20% of staked amount
├── Bonus calculated: staked × (base_rate + level_bonus) × time
├── Claimed as: Locked NOVI (added to PlayerAccount)
└── Cooldown between stakes: 24 hours

EXAMPLE (Level 10 Treasury):
├── Stake: 100,000 NOVI for 30 days
├── Base rate: 0.5% per day
├── Level bonus: +12%
├── Effective rate: 0.56% per day
├── Return after 30 days: 100,000 + 16,800 = 116,800 NOVI
└── Daily generation (passive): 75 NOVI/hour = 1,800 NOVI/day
```

---

#### 🏰 Citadel

**Theme**: Ultimate defense and raid boss mode

**Primary Buffs**:
| Level | Defense Power | Garrison Size | Raid Boss HP |
|-------|---------------|---------------|--------------|
| 1 | +15% | +10% | 50,000 |
| 5 | +30% | +25% | 250,000 |
| 10 | +50% | +45% | 1,000,000 |
| 15 | +75% | +70% | 5,000,000 |
| 20 | +100% | +100% | 25,000,000 |

**Interactive Features**:
- **Fortress Mode**: Become a "raid boss" for events
- **Wall Upgrades**: Customize defensive structures
- **Trap System**: Set traps for attackers
- **Garrison Command**: Position defensive units
- **Siege History**: Review attack attempts

**Raid Boss Mode**:
```
RAID BOSS ACTIVATION:
├── Cost: 50,000 NOVI (daily maintenance while active)
├── Duration: 24-72 hours (you choose)
├── Effect: You become a "World Boss" on the map
├── Attackers: Any player can attack you
├── Your HP: Citadel level determines HP pool
├── Rewards you get: % of all attacker entry fees
├── Risk: If HP reaches 0, you lose resources

ATTACKER PERSPECTIVE:
├── Entry fee: 1,000-10,000 NOVI (scales with Citadel level)
├── Damage dealt: Based on their attack power
├── Rewards: Proportional to damage contribution
├── If boss defeated: Share loot pool based on damage %
```

---

## Building Interiors & Activities

### Interior System Overview

Each building has an **interior view** with interactive elements. This creates the "mini-game within a game" experience.

### Interior Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     ⚒️ FORGE INTERIOR (Level 8)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        WORKBENCHES (3/3 Active)                      │   │
│   ├─────────────────────────────────────────────────────────────────────┤   │
│   │                                                                      │   │
│   │   [BENCH 1]              [BENCH 2]              [BENCH 3]           │   │
│   │   ┌───────────┐          ┌───────────┐          ┌───────────┐       │   │
│   │   │ Upgrading │          │   READY   │          │ Crafting  │       │   │
│   │   │ Iron Helm │          │           │          │ Steel Axe │       │   │
│   │   │ ████████░ │          │  [START]  │          │ ██░░░░░░░ │       │   │
│   │   │ 45min left│          │           │          │ 3h 20m    │       │   │
│   │   │ [SPEEDUP] │          │           │          │ [SPEEDUP] │       │   │
│   │   └───────────┘          └───────────┘          └───────────┘       │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────┐    ┌─────────────────────┐    ┌───────────────┐   │
│   │    MATERIALS        │    │    RECIPE BOOK      │    │   MASTERY     │   │
│   │    ─────────────    │    │    ─────────────    │    │   ─────────   │   │
│   │    Common:  1,234   │    │    Unlocked: 24     │    │   Level: 12   │   │
│   │    Uncommon:  456   │    │    Locked: 18       │    │   XP: 8,450   │   │
│   │    Rare:       78   │    │    [VIEW ALL]       │    │   Next: 10K   │   │
│   │    Epic:       12   │    │                     │    │               │   │
│   │    Legend:      2   │    │    NEW RECIPE       │    │   Perk: +5%   │   │
│   │    [SALVAGE]        │    │    AVAILABLE! ⭐    │    │   success     │   │
│   └─────────────────────┘    └─────────────────────┘    └───────────────┘   │
│                                                                              │
│   [🔙 Back to Estate]  [📊 Forge Stats]  [🏆 Achievements]  [❓ Help]        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Activity Types

#### 1. Production Activities
- **Workshop**: Set production queues for resources
- **Treasury**: Manage NOVI staking
- **Barracks**: Queue unit training

#### 2. Crafting Activities
- **Forge**: Create and upgrade equipment
- **Workshop**: Basic item crafting
- **Academy**: "Research projects" (special items)

#### 3. Challenge Activities
- **Arena**: Daily combat challenges
- **Citadel**: Raid boss mode
- **Sanctuary**: Hero awakening rituals

#### 4. Management Activities
- **Vault**: Deposit/withdraw resources
- **Market**: Manage listings and purchases
- **Mansion**: Collect daily bonuses, manage estate

#### 5. Information Activities
- **Observatory**: View spawn data
- **Academy**: Read lore, plan research
- **Market**: Analyze price trends

### Mastery System

Each building has its own **Mastery Level** (separate from building level):

```
FORGE MASTERY PROGRESSION:
├── Level 1 (0 XP): Basic recipes
├── Level 5 (1,000 XP): +5% crafting speed
├── Level 10 (5,000 XP): Uncommon recipes unlocked
├── Level 15 (15,000 XP): +10% success rate
├── Level 20 (35,000 XP): Rare recipes unlocked
├── Level 25 (70,000 XP): +15% material efficiency
├── Level 30 (120,000 XP): Epic recipes unlocked
├── Level 40 (250,000 XP): Legendary recipes unlocked
└── Level 50 (500,000 XP): Master Blacksmith title + unique cosmetic

EARNING MASTERY XP:
├── Complete a craft: 10-1,000 XP (based on rarity)
├── Upgrade an item: 25-500 XP
├── Salvage items: 5 XP each
├── Daily first craft: 100 bonus XP
└── Weekly challenges: 500-2,000 XP
```

---

## Team Headquarters

### Overview

Teams can build a shared **Team Headquarters** that provides buffs to all members and serves as a social hub.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    🏰 TEAM HQ: "Crypto Knights"                              │
│                    Members: 23/25  |  HQ Level: 12                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   TEAM FACILITIES                          TEAM BUFFS (All Members)         │
│   ┌─────────────────────────────┐         ┌─────────────────────────────┐   │
│   │                             │         │                             │   │
│   │   ⚔️ War Room (Lv.6)        │         │   • Attack Power:    +12%   │   │
│   │      Rally coordination     │         │   • Defense Power:   +10%   │   │
│   │      +15% rally damage      │         │   • Resource Gen:    +8%    │   │
│   │                             │         │   • Rally Capacity:  +18%   │   │
│   │   💰 Team Treasury (Lv.4)   │         │   • XP Gain:         +6%    │   │
│   │      Shared resources       │         │   • Trade Fees:      -5%    │   │
│   │      12.5M cash stored      │         │                             │   │
│   │                             │         │   Combined Power: 156,789   │   │
│   │   🏋️ Training Grounds (Lv.5)│         │                             │   │
│   │      Team training bonus    │         └─────────────────────────────┘   │
│   │      +10% unit stats        │                                           │
│   │                             │         WEEKLY CONTRIBUTION               │
│   │   📡 Rally Point (Lv.7)     │         ┌─────────────────────────────┐   │
│   │      Rally coordination     │         │ Goal: 500,000 NOVI          │   │
│   │      +20% rally speed       │         │ Progress: ████████░░ 78%    │   │
│   │                             │         │                             │   │
│   │   🔬 Research Lab (Lv.3)    │         │ Your share: 45,000 (Rank #3)│   │
│   │      Shared research        │         │ Top: @WhaleKing (125,000)   │   │
│   │      -8% research time      │         └─────────────────────────────┘   │
│   │                             │                                           │
│   │   🏆 Trophy Hall 🔒         │         [Contribute] [View History]       │
│   │      Requires HQ Lv.15      │                                           │
│   │                             │                                           │
│   └─────────────────────────────┘                                           │
│                                                                              │
│   [📊 Team Stats] [👥 Members] [🎯 Team Quests] [⚔️ Declare War] [⚙️ Settings]│
└─────────────────────────────────────────────────────────────────────────────┘
```

### Team Facilities

| Facility | Effect | Max Level |
|----------|--------|-----------|
| **War Room** | Rally damage, coordination | 10 |
| **Team Treasury** | Shared storage, team funds | 10 |
| **Training Grounds** | Unit stat bonuses | 10 |
| **Rally Point** | Rally speed, capacity | 10 |
| **Research Lab** | Shared research bonuses | 10 |
| **Trophy Hall** | Display achievements | 5 |
| **Recruitment Office** | Member capacity bonus | 5 |
| **Armory** | Shared equipment storage | 5 |

### Team HQ Mechanics

**Construction**:
- HQ created when team forms (Level 1)
- All facilities start locked
- Unlock facilities through team achievements or contribution

**Upgrading**:
- Requires team contribution (NOVI pooled from members)
- Each level costs more (φ scaling)
- Members contribute weekly toward upgrade goals

**Maintenance**:
- Weekly upkeep required (scales with facilities and levels)
- If not met: Facilities go dormant (buffs deactivated)
- Creates social pressure for active participation

**Contribution Tracking**:
```
WEEKLY CONTRIBUTION SYSTEM:
├── Goal calculated: Sum of (facility_level × base_cost × 0.1)
├── All members can contribute NOVI toward goal
├── Contributions tracked per-member
├── Rewards for top contributors:
│   ├── #1: "Team MVP" title for the week
│   ├── #1-3: Bonus team buff (+5%)
│   └── All contributors: Share of team achievements
├── Shortfall handling:
│   ├── < 50% met: Lowest level facility goes dormant
│   ├── 50-75% met: Random facility goes dormant
│   ├── 75-99% met: All active but no upgrades allowed
│   └── 100%+ met: Overflow goes to team treasury
```

### Team Wars

Teams can declare war on other teams:

```
WAR DECLARATION:
├── Cost: 100,000 NOVI from team treasury
├── Duration: 7 days
├── Win condition: More total war points
├── War points from:
│   ├── Attack enemy team member: 10 points per win
│   ├── Defend against enemy: 5 points per defense
│   ├── Rally against enemy HQ: 100 points per successful raid
│   └── Team quest completion during war: 25 points
├── Rewards:
│   ├── Winner: Loot 10% of enemy team treasury
│   ├── Winner: "Victorious" buff for 7 days (+10% all stats)
│   └── MVP: Special title and cosmetic
```

---

## Land & Expansion

### Plot System

Players start with 1 plot and can purchase more as they progress.

```
PLOT PROGRESSION:
├── Plot 1: FREE (starter plot, 4 building slots)
├── Plot 2: 100,000 NOVI (Estate Level 15 required)
├── Plot 3: 500,000 NOVI (Estate Level 30 required)
├── Plot 4: 2,000,000 NOVI (Estate Level 50 required)
└── Plot 5: 10,000,000 NOVI (Estate Level 75 required)

TOTAL BUILDING SLOTS:
├── 1 Plot: 4 buildings
├── 2 Plots: 8 buildings
├── 3 Plots: 12 buildings (all building types)
├── 4 Plots: 16 buildings (duplicates or variants)
└── 5 Plots: 20 buildings (maximum estate)
```

### City Location Bonuses

Your estate's city affects building effectiveness:

| City Type | Building Bonus | Examples |
|-----------|---------------|----------|
| **Capital** | +5% all buildings | New York, London, Tokyo, Paris |
| **Combat** | +15% Barracks, Arena, Citadel | Berlin, Seoul, Moscow |
| **Trade** | +15% Market, Treasury, Vault | Singapore, Dubai, Hong Kong |
| **Resource** | +15% Workshop, Forge, Observatory | Miami, Rome, Sydney |

### Estate Relocation

Players can move their estate to a different city:

```
RELOCATION COST:
├── Base cost: 50% of total plot purchase price
├── Cooldown: 30 days between moves
├── Process: Instant (no downtime)
├── Buildings: Keep all buildings and levels
├── Decorations: Keep all customizations
├── Quests: Progress maintained

EXAMPLE:
├── Player has 3 plots (cost: 0 + 100K + 500K = 600K)
├── Relocation cost: 300,000 NOVI
├── Moving from Capital to Trade city
└── Result: +15% bonus to Market, Treasury, Vault
```

---

## Storyline & Quests

### Building Quest Chains

Each building has a **main quest chain** that unlocks as the building levels up:

```
📜 BARRACKS QUEST CHAIN: "Rise of the Commander"

CHAPTER 1: "A Humble Beginning" (Barracks Level 1)
├── Objective: Train your first 100 units
├── Reward: 1,000 cash + "Recruit" title
└── Unlocks: Chapter 2

CHAPTER 2: "The First Drill" (Barracks Level 3)
├── Objective: Complete 5 daily drills
├── Reward: 5,000 cash + Drill Instructor NPC
└── Unlocks: Chapter 3

CHAPTER 3: "Bandit Troubles" (Barracks Level 5)
├── Objective: Defend your estate from bandit attack (instanced)
├── Reward: 25,000 cash + Elite Unit Recipe
└── Unlocks: Elite Training feature

CHAPTER 4: "The Veteran's Secret" (Barracks Level 7)
├── Objective: Find and recruit the Veteran NPC
├── Reward: +5% permanent unit training speed
└── Unlocks: Chapter 5

CHAPTER 5: "Tournament of Blades" (Barracks Level 10)
├── Objective: Win 10 arena battles using barracks-trained units
├── Reward: Unique "Commander's Blade" equipment
└── Unlocks: Citadel blueprint

CHAPTER 6: "The Great Defense" (Barracks Level 15)
├── Objective: Successfully defend against 50 player attacks
├── Reward: "Iron Wall" title + Citadel construction discount
└── Unlocks: Final chapter

CHAPTER 7: "Master of War" (Barracks Level 20)
├── Objective: Reach #100 on defense leaderboard
├── Reward: Legendary unit type + "Warlord" title + unique cosmetic
└── Unlocks: Epilogue content
```

### Lore Integration

Quest chains reveal game lore:

```
LORE SYSTEM:
├── Each building represents a "faction" or "philosophy"
│   ├── Mansion: The Nobility (governance, diplomacy)
│   ├── Barracks: The Wardens (military, defense)
│   ├── Workshop: The Crafters Guild (industry, creation)
│   ├── Vault: The Merchant Houses (wealth, trade)
│   ├── Forge: The Artificers (magic, enhancement)
│   ├── Market: The Exchange (commerce, information)
│   ├── Academy: The Scholars (knowledge, research)
│   ├── Arena: The Champions (glory, competition)
│   ├── Shrine: The Faithful (spirituality, blessing)
│   ├── Observatory: The Seekers (discovery, prophecy)
│   ├── Treasury: The Bankers (finance, investment)
│   └── Citadel: The Fortress Lords (power, dominance)
│
├── Completing all chapters in a building: Unlock that faction's "Sigil"
├── Collecting all Sigils: Reveal the "Grand Narrative"
└── Grand Narrative completion: Unique estate theme + title
```

### World Events & Building Tie-Ins

Seasonal events feature building-specific content:

```
EVENT: "The Great Forge Festival" (Monthly)

PARTICIPATION:
├── Requirement: Own a Forge (any level)
├── Duration: 7 days
├── Goal: Craft highest quality items

MECHANICS:
├── Special recipes available only during event
├── Crafting provides "Festival Points"
├── Leaderboard tracks top crafters globally

REWARDS:
├── Participation: Exclusive "Festival Hammer" decoration
├── Top 100: Unique Forge skin
├── Top 10: Reserved NOVI prize pool share
├── #1: "Master Smith" title (permanent)

COMMUNITY GOAL:
├── Server-wide crafting target (e.g., 1 million items)
├── If met: All participants get bonus rewards
└── Encourages community participation
```

---

## Financial Sinks

### Sink Categories

The Estate System creates multiple layers of NOVI sinks:

### 1. Construction Sinks (One-Time)

```
BUILDING CONSTRUCTION COSTS (φ Scaling):

Level 1:   10,000 NOVI  +  100,000 cash
Level 2:   16,180 NOVI  +  161,800 cash    (×φ)
Level 3:   26,180 NOVI  +  261,800 cash    (×φ)
Level 4:   42,360 NOVI  +  423,600 cash    (×φ)
Level 5:   68,540 NOVI  +  685,400 cash    (×φ)
Level 6:  110,900 NOVI  +  1,109,000 cash
Level 7:  179,440 NOVI  +  1,794,400 cash
Level 8:  290,340 NOVI  +  2,903,400 cash
Level 9:  469,780 NOVI  +  4,697,800 cash
Level 10: 760,120 NOVI  +  7,601,200 cash
...
Level 15: 4,020,000 NOVI  + 40,200,000 cash
Level 20: 21,260,000 NOVI + 212,600,000 cash

TOTAL FOR ONE BUILDING TO LEVEL 20:
~35,000,000 NOVI + ~350,000,000 cash

TOTAL FOR FULL ESTATE (12 buildings × Level 20):
~420,000,000 NOVI + ~4,200,000,000 cash
```

### 2. Activity Sinks (Per-Use)

```
FORGE ACTIVITIES:
├── Basic craft:      500-2,000 NOVI
├── Uncommon craft:   2,000-10,000 NOVI
├── Rare craft:       10,000-50,000 NOVI
├── Epic craft:       50,000-200,000 NOVI
├── Legendary craft:  200,000-1,000,000 NOVI
├── Upgrade item:     25% of craft cost
├── Reforge:          50% of craft cost
├── Salvage:          100 NOVI (returns materials)
└── Speedup:          500 NOVI per hour remaining

ARENA ACTIVITIES:
├── Challenge entry:  FREE (criteria-based access)
├── Boss challenge:   FREE (Arena level requirement)
├── Speedup cooldown: 500 NOVI per hour
└── Champion respec:  1,000 NOVI

SANCTUARY ACTIVITIES:
├── Hero meditation slot:     FREE (time-based)
├── Meditation speedup:       5 gems per hour
├── Fragment conversion:      5-150 gems per batch
├── Theme change:             1,000 gems
└── Awakening ritual:         50,000 NOVI + 500 fragments

MARKET ACTIVITIES:
├── Listing fee:      2% of price (NOVI equivalent)
├── Transaction fee:  3% of sale (burned)
└── Instant sell fee: 5% of value

ACADEMY ACTIVITIES:
├── Research boost:   1,000 NOVI per hour skipped
├── Special course:   50,000-500,000 NOVI
└── Scholar hire:     5,000-50,000 NOVI per day
```

### 3. Customization Sinks (Cosmetic)

```
BUILDING DECORATIONS:

EXTERIOR STYLES:
├── Classic:     FREE (default)
├── Medieval:    10,000 NOVI
├── Eastern:     15,000 NOVI
├── Modern:      20,000 NOVI
├── Futuristic:  30,000 NOVI
├── Golden:      100,000 NOVI
└── Legendary:   500,000 NOVI (limited)

INTERIOR THEMES:
├── Standard:    FREE (default)
├── Rustic:      5,000 NOVI
├── Elegant:     10,000 NOVI
├── Royal:       25,000 NOVI
├── Exotic:      50,000 NOVI
└── Divine:      200,000 NOVI

SPECIAL DECORATIONS:
├── Banners:     1,000-10,000 NOVI each
├── Statues:     10,000-100,000 NOVI each
├── Trophies:    Earned through achievements
├── NPC Staff:   5,000-50,000 NOVI each
└── Ambient:     2,500-25,000 NOVI each

FULL ESTATE CUSTOMIZATION (everything):
├── Minimum: ~500,000 NOVI
├── Mid-tier: ~2,000,000 NOVI
└── Maximum: ~10,000,000 NOVI
```

### 4. Land Sinks (Expansion)

```
PLOT PURCHASES:
├── Plot 1: FREE
├── Plot 2: 100,000 NOVI
├── Plot 3: 500,000 NOVI
├── Plot 4: 2,000,000 NOVI
└── Plot 5: 10,000,000 NOVI

TOTAL: 12,600,000 NOVI for all plots

RELOCATION:
├── Cost: 50% of total plot investment
├── Example (3 plots): 300,000 NOVI
└── Cooldown prevents abuse
```

### 5. Team HQ Sinks (Shared)

```
FACILITY CONSTRUCTION (Team Treasury):
├── Each facility follows same φ scaling
├── Split across members
├── Weekly contribution requirements

EXAMPLE TEAM HQ (25 members, 6 facilities at Lv.5 average):
├── Weekly upkeep: ~500,000 NOVI
├── Per member: ~20,000 NOVI/week
├── Upgrade to Lv.6: ~1,000,000 NOVI total
└── Active teams: Constant NOVI flow

WAR DECLARATIONS:
├── 100,000 NOVI per war
├── Estimated: 2-4 wars/month for active teams
└── Additional sink: 200,000-400,000 NOVI/month
```

### Total Sink Analysis

```
CASUAL PLAYER (1 plot, 4 buildings at Lv.10):
├── Construction (one-time): ~3,000,000 NOVI
├── Monthly crafting activities: ~100,000 NOVI
├── Monthly speedups (gems): ~50 gems
├── Craft failures (material loss): ~200,000 materials
└── MONTHLY BURN: ~100,000 NOVI + materials + gems

DEDICATED PLAYER (3 plots, 12 buildings at Lv.15):
├── Construction (one-time): ~50,000,000 NOVI
├── Monthly crafting activities: ~500,000 NOVI
├── Monthly speedups (gems): ~500 gems
├── Craft failures (material loss): ~2,000,000 materials
├── Customization: ~1,000,000 NOVI
└── MONTHLY BURN: ~1,500,000 NOVI + materials + gems

WHALE PLAYER (5 plots, 20 buildings at Lv.20):
├── Construction (one-time): ~700,000,000 NOVI
├── Monthly crafting activities: ~5,000,000 NOVI
├── Monthly speedups (gems): ~5,000 gems
├── Craft failures (Divine tier): ~50,000,000 materials + gems
├── Customization: ~10,000,000 NOVI
└── MONTHLY BURN: ~15,000,000 NOVI + massive materials + gems

KEY SINKS:
├── High-tier crafting with failure risk = major material sink
├── Speedups for impatient players = gem sink
├── Construction costs scale with φ² = exponential NOVI sink
└── NO maintenance = buildings are permanent investments
```

---

## Social Features

### Estate Visiting

Players can visit other players' estates:

```
VISITING MECHANICS:
├── Access: Any player can visit any other player
├── View: See building layout, decorations, stats
├── Interact: View trophy room, guest book, public stats
├── Privacy: Some areas can be "private" (owner choice)

VISITOR TRACKING:
├── Estate shows "Visitors today: X"
├── Guest book logs recent visitors
├── Popular estates ranked on "Tourism" leaderboard

VISITOR REWARDS:
├── First visit to a player: 100 XP
├── Visit 10 unique estates/day: Bonus reward
├── "Social Butterfly" achievement: Visit 100 unique estates
```

### Estate Ratings

Visitors can rate estates:

```
RATING SYSTEM:
├── 1-5 star rating
├── Anonymous ratings
├── Average displayed on estate profile
├── Ratings reset monthly (fresh competition)

BENEFITS OF HIGH RATING:
├── 4.5+ stars: "Popular Estate" badge
├── Top 100 rated: Extra daily visitors (passive XP)
├── #1 rated: "Estate of the Month" title
```

### Estate Leaderboards

```
LEADERBOARD CATEGORIES:
├── Estate Power (overall strength)
├── Building Mastery (total mastery XP)
├── Visitor Count (social popularity)
├── Rating Score (quality of estate)
├── Wealth (vault + treasury values)
├── Achievement Score (completionist)

REWARDS:
├── Top 10: Reserved NOVI (weekly)
├── Top 100: Exclusive cosmetics (monthly)
├── #1: Unique title (persistent until dethroned)
```

### Gifting System

Players can send gifts:

```
GIFT TYPES:
├── Materials (any type/amount)
├── Equipment (tradeable items)
├── Decorations (unlock for recipient)
├── NOVI (with restrictions)

RESTRICTIONS:
├── NOVI gifts: Max 10,000/day to same player
├── Both accounts must be 14+ days old
├── Tracked for anti-abuse (contributes to transfer ratio)

SPECIAL GIFTS:
├── "Thank You" package: 1,000 NOVI + random decoration
├── "Celebration" package: 5,000 NOVI + fireworks effect
├── "Patron" gift: 25,000 NOVI + exclusive patron cosmetic
```

---

## State Structures

### Core State Accounts

```rust
/// Player's overall estate
/// PDA: [ESTATE_SEED, owner_pubkey]
/// Size: ~256 bytes
#[repr(C)]
#[derive(Copy, Clone)]
pub struct EstateAccount {
    // Identity (40 bytes)
    pub owner: Pubkey,                      // Wallet owner
    pub created_at: i64,                    // Creation timestamp

    // Location (8 bytes)
    pub city_index: u8,                     // Which city (0-49)
    pub plots_owned: u8,                    // 1-5 plots
    pub building_slots: u8,                 // plots × 4
    pub active_buildings: u8,               // Currently built
    pub _location_padding: [u8; 4],

    // Progression (24 bytes)
    pub estate_level: u16,                  // Sum of building levels
    pub estate_power: u64,                  // Weighted power score
    pub total_invested_novi: u64,           // Lifetime construction cost
    pub _prog_padding: [u8; 6],

    // Social (24 bytes)
    pub total_visitors: u64,                // Lifetime visitors
    pub rating_sum: u32,                    // Sum of all ratings
    pub rating_count: u32,                  // Number of ratings
    pub current_month_visitors: u32,        // Reset monthly
    pub _social_padding: [u8; 4],

    // Customization - NOTE: Themes stored OFF-CHAIN (purely cosmetic)
    // On-chain only tracks achievement-based unlocks
    pub cosmetic_unlocks: u64,              // Bitflags for earned cosmetics (achievements)
    pub _custom_padding: [u8; 8],

    // Achievements (16 bytes)
    pub quest_completion_flags: u64,        // Which quests completed
    pub achievements_unlocked: u64,         // Achievement bitflags

    // Building slots (108 bytes) - expandable
    // Each slot is 9 bytes: building_type (1) + building_pda (8 bytes as u64 index)
    // Using index into separate BuildingAccount PDAs for flexibility
    pub building_slots_data: [BuildingSlot; 12],

    pub bump: u8,
    pub _final_padding: [u8; 7],
}

#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct BuildingSlot {
    pub building_type: u8,                  // 0 = empty, 1-12 = building type
    pub building_index: u64,                // Unique index for PDA derivation
}

impl EstateAccount {
    pub const LEN: usize = core::mem::size_of::<Self>(); // ~256 bytes
}
```

```rust
/// Individual building account
/// PDA: [BUILDING_SEED, estate_pubkey, building_index]
/// Size: ~192 bytes
#[repr(C)]
#[derive(Copy, Clone)]
pub struct BuildingAccount {
    // Identity (48 bytes)
    pub estate: Pubkey,                     // Parent estate
    pub building_index: u64,                // Unique index
    pub building_type: u8,                  // BuildingType enum
    pub tier: u8,                           // 1, 2, or 3
    pub _id_padding: [u8; 6],

    // Progression (24 bytes)
    pub level: u16,                         // 1-20
    pub mastery_xp: u64,                    // Mastery progression
    pub mastery_level: u16,                 // Calculated from XP
    pub _prog_padding: [u8; 4],
    pub total_invested: u64,                // NOVI spent on this building

    // Status (24 bytes)
    pub status: u8,                         // Active, Dormant, Upgrading
    pub _status_padding: [u8; 7],
    pub upgrade_started_at: i64,            // 0 if not upgrading
    pub upgrade_completes_at: i64,          // Completion timestamp

    // Quest Progress (8 bytes)
    pub quest_chapter: u8,                  // Current chapter (0-7)
    pub quest_objective_progress: u16,      // Progress toward current objective
    pub quest_flags: u8,                    // Misc quest state
    pub _quest_padding: [u8; 4],

    // Interior State (32 bytes) - activity-specific data
    pub workbench_states: [WorkbenchState; 5],  // For Forge, etc.
    pub interior_data: [u8; 7],             // Building-specific state

    // Decoration (8 bytes)
    pub exterior_style: u8,                 // Exterior decoration
    pub interior_theme: u8,                 // Interior decoration
    pub special_decorations: u32,           // Bitflags
    pub _decor_padding: [u8; 2],

    // Cached Buffs (32 bytes)
    pub buff_cache: BuildingBuffs,

    pub bump: u8,
    pub _final_padding: [u8; 7],
}

#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct WorkbenchState {
    pub status: u8,                         // 0=empty, 1=active, 2=complete
    pub recipe_id: u8,                      // What's being crafted
    pub started_at: i32,                    // Timestamp (as offset)
    pub completes_at: i32,                  // Completion (as offset)
}

#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct BuildingBuffs {
    pub attack_bps: u16,
    pub defense_bps: u16,
    pub xp_gain_bps: u16,
    pub resource_gen_bps: u16,
    pub storage_capacity_bps: u16,
    pub training_speed_bps: u16,
    pub research_speed_bps: u16,
    pub craft_success_bps: u16,
    pub trade_discount_bps: u16,
    pub passive_income_bps: u16,
    pub special_1_bps: u16,                 // Building-specific
    pub special_2_bps: u16,                 // Building-specific
    pub _buff_padding: [u8; 8],
}

impl BuildingAccount {
    pub const LEN: usize = core::mem::size_of::<Self>(); // ~192 bytes
}
```

```rust
/// Building type definitions
/// PDA: [BUILDING_CONFIG_SEED, building_type]
/// Created by DAO, defines building properties
/// Size: ~512 bytes
#[repr(C)]
#[derive(Copy, Clone)]
pub struct BuildingConfigAccount {
    pub building_type: u8,                  // 1-12
    pub tier: u8,                           // 1, 2, or 3
    pub name: [u8; 32],                     // "Mansion", "Barracks", etc.
    pub max_level: u16,                     // Usually 20
    pub _id_padding: [u8; 4],

    // Unlock requirements
    pub required_estate_level: u16,         // Estate level to build
    pub required_research: [u8; 4],         // Research prerequisites
    pub required_quest: u8,                 // Previous building quest required
    pub _req_padding: [u8; 5],

    // Construction costs (per level, will be multiplied by φ)
    pub base_novi_cost: u64,
    pub base_cash_cost: u64,
    pub base_material_cost: u32,
    pub base_time_seconds: u32,

    // Upkeep
    pub upkeep_multiplier_bps: u16,         // 10000 = 1.0x, 15000 = 1.5x
    pub _upkeep_padding: [u8; 6],

    // Buff scaling (buff = base × (√φ)^level)
    pub buff_config: [BuffScaling; 12],     // Up to 12 buff types

    // Mastery
    pub mastery_xp_per_level: [u32; 50],    // XP thresholds

    // Feature unlocks (at what level)
    pub feature_unlocks: [FeatureUnlock; 10],

    // Quest config
    pub quest_chapters: u8,                 // Number of quest chapters
    pub _quest_padding: [u8; 7],

    // Metadata
    pub enabled: bool,
    pub image_uri: [u8; 64],
    pub _reserved: [u8; 32],

    pub bump: u8,
    pub _final_padding: [u8; 7],
}

#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct BuffScaling {
    pub buff_type: u8,                      // BuffType enum
    pub base_bps: u16,                      // Base value at level 1
    pub scaling_type: u8,                   // 0=linear, 1=golden, 2=step
    pub _padding: [u8; 4],
}

#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FeatureUnlock {
    pub feature_id: u8,                     // Feature identifier
    pub required_level: u8,                 // Building level required
    pub _padding: [u8; 2],
}

impl BuildingConfigAccount {
    pub const LEN: usize = core::mem::size_of::<Self>(); // ~512 bytes
}
```

```rust
/// Team headquarters account
/// PDA: [TEAM_HQ_SEED, team_pubkey]
/// Size: ~384 bytes
#[repr(C)]
#[derive(Copy, Clone)]
pub struct TeamHQAccount {
    // Identity (40 bytes)
    pub team: Pubkey,                       // Parent team
    pub created_at: i64,

    // Overall stats (16 bytes)
    pub hq_level: u16,                      // Sum of facility levels
    pub total_power: u64,                   // Combined team power
    pub _stats_padding: [u8; 6],

    // Facilities (80 bytes) - 8 facilities × 10 bytes each
    pub facilities: [FacilityState; 8],

    // Treasury (24 bytes)
    pub treasury_novi: u64,                 // Pooled NOVI
    pub treasury_cash: u64,                 // Pooled cash
    pub last_contribution_week: u32,        // Week number
    pub _treasury_padding: [u8; 4],

    // Weekly contribution (64 bytes)
    pub weekly_goal: u64,                   // Target for this week
    pub weekly_collected: u64,              // Amount collected
    pub top_contributors: [TopContributor; 5], // Top 5 this week
    pub _week_padding: [u8; 4],

    // War state (32 bytes)
    pub at_war_with: Pubkey,                // Enemy team (or 0)
    pub war_started_at: i64,
    pub war_points_us: u32,
    pub war_points_them: u32,

    // Cached buffs (24 bytes)
    pub team_buffs: TeamHQBuffs,

    // Status (8 bytes)
    pub status: u8,                         // Active, Dormant, etc.
    pub dormant_facilities: u8,             // Bitflags
    pub _status_padding: [u8; 6],

    pub bump: u8,
    pub _final_padding: [u8; 7],
}

#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FacilityState {
    pub facility_type: u8,                  // FacilityType enum
    pub level: u8,                          // 0-10
    pub status: u8,                         // Active, Dormant, Upgrading
    pub upgrade_progress: u8,               // 0-100%
    pub total_invested: u32,                // NOVI invested
    pub _padding: [u8; 2],
}

#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct TopContributor {
    pub player_id: u32,                     // Compact player reference
    pub amount: u32,                        // Contribution amount (scaled)
}

#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct TeamHQBuffs {
    pub attack_bps: u16,
    pub defense_bps: u16,
    pub resource_gen_bps: u16,
    pub rally_damage_bps: u16,
    pub rally_speed_bps: u16,
    pub xp_gain_bps: u16,
    pub research_speed_bps: u16,
    pub trade_discount_bps: u16,
    pub _padding: [u8; 8],
}

impl TeamHQAccount {
    pub const LEN: usize = core::mem::size_of::<Self>(); // ~384 bytes
}
```

```rust
/// Recipe/crafting configuration
/// PDA: [RECIPE_SEED, building_type, recipe_id]
/// Size: ~128 bytes
#[repr(C)]
#[derive(Copy, Clone)]
pub struct RecipeAccount {
    pub building_type: u8,                  // Which building uses this
    pub recipe_id: u16,                     // Unique recipe ID
    pub recipe_category: u8,                // Crafting, Upgrade, etc.
    pub _id_padding: [u8; 4],

    pub name: [u8; 32],                     // "Steel Sword"

    // Requirements
    pub required_building_level: u8,
    pub required_mastery_level: u8,
    pub _req_padding: [u8; 6],

    // Inputs
    pub input_item_type: u8,                // Required item (0 = none)
    pub input_item_rarity: u8,              // Minimum rarity
    pub material_costs: [MaterialCost; 5],  // Up to 5 material types
    pub novi_cost: u64,

    // Timing
    pub base_time_seconds: u32,
    pub _time_padding: [u8; 4],

    // Output
    pub output_item_type: u8,
    pub output_item_rarity: u8,
    pub output_quantity: u8,
    pub success_rate_bps: u16,              // 10000 = 100%
    pub _output_padding: [u8; 3],

    // Mastery XP
    pub mastery_xp_reward: u32,

    pub enabled: bool,
    pub _final_padding: [u8; 7],

    pub bump: u8,
}

#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct MaterialCost {
    pub material_type: u8,                  // Common, Uncommon, etc.
    pub amount: u32,
    pub _padding: [u8; 3],
}

impl RecipeAccount {
    pub const LEN: usize = core::mem::size_of::<Self>(); // ~128 bytes
}
```

### Crafted Equipment Account

```rust
/// Tracks quality breakdown of player-crafted equipment (8-tier system)
/// PDA: [CRAFTED_EQUIPMENT_SEED, player_pubkey]
/// Size: ~160 bytes
#[repr(C)]
#[derive(Copy, Clone)]
pub struct CraftedEquipmentAccount {
    pub player: Pubkey,

    // Per equipment type, 8 quality tiers each
    // [Common, Refined, Superior, Elite, Masterwork, Legendary, Mythic, Divine]
    pub melee_by_quality: [u16; 8],      // 16 bytes
    pub ranged_by_quality: [u16; 8],     // 16 bytes
    pub siege_by_quality: [u16; 8],      // 16 bytes
    pub armor_by_quality: [u16; 8],      // 16 bytes
    pub vehicle_by_quality: [u16; 8],    // 16 bytes

    // Cached buff totals (updated on craft/salvage)
    pub weapon_quality_bps: u16,         // Attack buff from weapon quality
    pub armor_quality_bps: u16,          // Defense buff from armor quality

    // Lifetime stats
    pub total_items_crafted: u32,
    pub total_items_salvaged: u32,
    pub total_craft_failures: u32,       // Track failure count
    pub highest_tier_crafted: u8,        // Achievement tracking

    pub bump: u8,
    pub _padding: [u8; 6],
}

impl CraftedEquipmentAccount {
    pub const LEN: usize = core::mem::size_of::<Self>(); // ~160 bytes

    /// Quality tier buff contribution (bps per item) - Golden Ratio scaling
    /// Formula: 100/φ^(8-tier) for tiers 2-8, 0 for tier 1
    pub const QUALITY_BUFF_BPS: [u16; 8] = [
        0,    // Common (shop-bought baseline)
        4,    // Refined
        9,    // Superior
        15,   // Elite
        24,   // Masterwork
        38,   // Legendary
        62,   // Mythic
        100,  // Divine
    ];

    /// Calculate total weapon quality buff
    pub fn calculate_weapon_quality_bps(&self) -> u16 {
        let mut total: u32 = 0;

        // Sum all weapon types (melee, ranged, siege) across all 8 tiers
        for (tier, &buff) in Self::QUALITY_BUFF_BPS.iter().enumerate() {
            total += self.melee_by_quality[tier] as u32 * buff as u32;
            total += self.ranged_by_quality[tier] as u32 * buff as u32;
            total += self.siege_by_quality[tier] as u32 * buff as u32;
        }

        // Cap at u16::MAX (655.35%)
        total.min(u16::MAX as u32) as u16
    }

    /// Calculate total armor quality buff
    pub fn calculate_armor_quality_bps(&self) -> u16 {
        let mut total: u32 = 0;

        for (tier, &buff) in Self::QUALITY_BUFF_BPS.iter().enumerate() {
            total += self.armor_by_quality[tier] as u32 * buff as u32;
        }

        total.min(u16::MAX as u32) as u16
    }

    /// Add a crafted item to the appropriate quality tier
    pub fn add_crafted_item(&mut self, equipment_type: u8, quality_tier: u8) {
        let tier = (quality_tier as usize).min(7);
        match equipment_type {
            0 => self.melee_by_quality[tier] = self.melee_by_quality[tier].saturating_add(1),
            1 => self.ranged_by_quality[tier] = self.ranged_by_quality[tier].saturating_add(1),
            2 => self.siege_by_quality[tier] = self.siege_by_quality[tier].saturating_add(1),
            3 => self.armor_by_quality[tier] = self.armor_by_quality[tier].saturating_add(1),
            4 => self.vehicle_by_quality[tier] = self.vehicle_by_quality[tier].saturating_add(1),
            _ => {}
        }
        self.total_items_crafted = self.total_items_crafted.saturating_add(1);

        // Track highest tier achievement
        if tier as u8 > self.highest_tier_crafted {
            self.highest_tier_crafted = tier as u8;
        }

        // Update cached buffs
        self.weapon_quality_bps = self.calculate_weapon_quality_bps();
        self.armor_quality_bps = self.calculate_armor_quality_bps();
    }

    /// Handle craft failure - downgrade item by 1 tier
    pub fn handle_craft_failure(&mut self, equipment_type: u8, attempted_tier: u8) {
        self.total_craft_failures = self.total_craft_failures.saturating_add(1);

        // Item downgrades by 1 tier (minimum tier 1)
        let downgrade_tier = attempted_tier.saturating_sub(1).max(1) as usize;

        match equipment_type {
            0 => self.melee_by_quality[downgrade_tier] = self.melee_by_quality[downgrade_tier].saturating_add(1),
            1 => self.ranged_by_quality[downgrade_tier] = self.ranged_by_quality[downgrade_tier].saturating_add(1),
            2 => self.siege_by_quality[downgrade_tier] = self.siege_by_quality[downgrade_tier].saturating_add(1),
            3 => self.armor_by_quality[downgrade_tier] = self.armor_by_quality[downgrade_tier].saturating_add(1),
            4 => self.vehicle_by_quality[downgrade_tier] = self.vehicle_by_quality[downgrade_tier].saturating_add(1),
            _ => {}
        }

        // Recalculate cached buffs
        self.weapon_quality_bps = self.calculate_weapon_quality_bps();
        self.armor_quality_bps = self.calculate_armor_quality_bps();
    }

    /// Derive the PDA for a crafted equipment account
    pub fn derive_pda(player: &Pubkey) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[b"crafted_equipment", player.as_ref()],
            &crate::ID,
        )
    }
}
```

### Enums

```rust
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum BuildingType {
    None = 0,
    // Tier 1
    Mansion = 1,
    Barracks = 2,
    Workshop = 3,
    Vault = 4,
    // Tier 2
    Forge = 5,
    Market = 6,
    Academy = 7,
    Arena = 8,
    // Tier 3
    Sanctuary = 9,
    Observatory = 10,
    Treasury = 11,
    Citadel = 12,
    // Future expansion (13-255)
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum BuildingStatus {
    Active = 0,
    Upgrading = 1,
    Constructing = 2,
}

// NOTE: Themes (ForgeTheme, EstateTheme) are NOT stored on-chain
// They are purely cosmetic and handled by the frontend/database
// See "Key Integration Decisions" section 9

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum FacilityType {
    None = 0,
    WarRoom = 1,
    TeamTreasury = 2,
    TrainingGrounds = 3,
    RallyPoint = 4,
    ResearchLab = 5,
    TrophyHall = 6,
    RecruitmentOffice = 7,
    Armory = 8,
    // Future expansion (9-255)
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum BuffType {
    None = 0,
    AttackPower = 1,
    DefensePower = 2,
    XpGain = 3,
    ResourceGeneration = 4,
    StorageCapacity = 5,
    TrainingSpeed = 6,
    ResearchSpeed = 7,
    CraftSuccess = 8,
    TradeDiscount = 9,
    PassiveIncome = 10,
    UnitCapacity = 11,
    RaidProtection = 12,
    InterestRate = 13,
    VisionRange = 14,
    StakingBonus = 15,
    // Future expansion (16-255)
}
```

---

## Instructions

### Instruction Numbering

Estate System uses instruction range **200-299**:

```
// Estate Management (200-209)
200: initialize_estate
201: purchase_plot
202: relocate_estate
203: pay_upkeep
204: prepay_upkeep
205: update_estate_theme
206: claim_daily_bonus

// Building Management (210-229)
210: construct_building
211: upgrade_building
212: speedup_upgrade
213: complete_upgrade
214: toggle_building_active
215: reactivate_building
216: customize_building_exterior
217: customize_building_interior
218: unlock_decoration

// Building Activities - Forge (230-239)
230: forge_start_craft
231: forge_claim_craft
232: forge_speedup_craft
233: forge_upgrade_item
234: forge_reforge_item
235: forge_salvage_item
236: forge_enchant_item

// Building Activities - Market (240-249)
240: market_list_item
241: market_cancel_listing
242: market_buy_item
243: market_instant_sell
244: market_create_buy_order
245: market_cancel_buy_order

// Building Activities - Arena (250-259)
250: arena_setup_champion
251: arena_start_challenge
252: arena_claim_challenge_reward
253: arena_challenge_player
254: arena_view_defense_log

// Building Activities - Other (260-279)
260: barracks_queue_training
261: barracks_claim_training
262: barracks_start_drill
263: workshop_set_production
264: workshop_claim_production
265: vault_deposit
266: vault_withdraw
267: vault_claim_interest
268: academy_boost_research
269: academy_hire_scholar
270: academy_start_special_course
271: sanctuary_start_meditation
272: sanctuary_convert_fragments
273: sanctuary_awakening_ritual
274: observatory_craft_lens
275: observatory_scan_region
276: treasury_stake_novi
277: treasury_unstake_novi
278: treasury_claim_staking_reward
279: citadel_activate_raid_boss

// Building Quests (280-289)
280: start_quest_chapter
281: update_quest_progress
282: complete_quest_objective
283: claim_quest_reward
284: view_quest_lore

// Team HQ (290-299)
290: create_team_hq
291: upgrade_team_facility
292: contribute_to_hq
293: claim_weekly_contribution_reward
294: declare_war
295: end_war
296: deposit_team_treasury
297: withdraw_team_treasury
298: toggle_facility_active
```

### Key Instruction Implementations

```rust
/// Initialize estate for a player
/// Accounts: signer, player_account, estate_account (to create), system_program
/// Data: city_index (u8)
pub fn initialize_estate(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    // 1. Verify player account exists and owned by signer
    // 2. Verify no existing estate for this player
    // 3. Create EstateAccount PDA
    // 4. Initialize with:
    //    - city_index from data
    //    - plots_owned = 1
    //    - building_slots = 4
    //    - All buildings empty
    // 5. Charge creation fee (small NOVI amount)
}

/// Construct a new building
/// Accounts: signer, estate, building (to create), player, building_config, system
/// Data: building_type (u8), slot_index (u8)
pub fn construct_building(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    // 1. Verify building type is valid and player meets requirements
    // 2. Verify slot is empty
    // 3. Calculate construction cost (level 1)
    // 4. Deduct NOVI and cash from player
    // 5. Create BuildingAccount PDA
    // 6. Set status = Constructing, calculate completion time
    // 7. Update estate building_slots_data
    // 8. Emit BuildingConstructionStarted event
}

/// Upgrade existing building
/// Accounts: signer, estate, building, player, game_engine
/// Data: none (always upgrades to next level)
pub fn upgrade_building(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    // 1. Verify building is Active status
    // 2. Verify not at max level
    // 3. Calculate upgrade cost: base × φ^(current_level)
    // 4. Deduct NOVI and cash from player
    // 5. Set status = Upgrading
    // 6. Calculate completion time
    // 7. Emit BuildingUpgradeStarted event
}

/// Start a crafting job in Forge
/// Accounts: signer, estate, building, player, recipe
/// Data: workbench_index (u8)
pub fn forge_start_craft(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    // 1. Verify building is Forge and Active
    // 2. Verify workbench is available
    // 3. Load recipe, verify player meets requirements
    // 4. Verify player has required materials
    // 5. Deduct materials and NOVI cost
    // 6. Set workbench state to active
    // 7. Calculate completion time (with building bonuses)
    // 8. Award mastery XP
    // 9. Emit CraftingStarted event
}
```

---

## Hard Gating: Building Requirements

**Philosophy**: Buildings are not optional bonuses - they are **gates** that unlock core game features. Players MUST build to access functionality.

### Gating Rules

1. **No Building = No Access**: Feature completely blocked without building
2. **Building Level = Feature Tier**: Higher levels unlock advanced features
3. **Active Status Required**: Building must be Active (not Upgrading/Damaged)
4. **On-Chain Validation**: Processors check building ownership before execution

---

### Always Available (No Building Required)

These features are baseline and never gated:

| Feature | Processor | Rationale |
|---------|-----------|-----------|
| Player creation | `initialization/player.rs` | Onboarding |
| User account | `initialization/user.rs` | Onboarding |
| Travel (intercity/intracity) | `travel/*.rs` | Core exploration |
| Basic encounters (PvE) | `combat/attack_encounter.rs` | Core gameplay |
| Loot claiming | `loot/claim.rs` | Reward collection |
| Team operations | `team/*.rs` | Social features |
| Subscription purchase | `subscription/purchase.rs` | Monetization |
| Event joining | `event/join.rs` | Criteria-based |

---

### 🏛️ MANSION (Tier 1) - Estate Core

**Gates:**

| Feature | Processor | Required Level |
|---------|-----------|----------------|
| Login streak rewards | `progression/claim_daily_reward.rs` | Lv.1 |
| Daily activity system | NEW: `estate/daily_activity.rs` | Lv.1 |
| Estate visitor system | NEW: `estate/visit.rs` | Lv.5 |

**Level Bonuses:**
```
Lv.1:  Unlock daily rewards
Lv.5:  +10% daily reward base
Lv.10: +25% daily reward base, visitor system
Lv.15: +50% daily reward base
Lv.20: +100% daily reward base, "Estate Lord" title
```

**Processor Modification:**
```rust
// claim_daily_reward.rs - ADD at start
let estate_data = load_estate(player_data.estate)?;
let mansion = get_building(&estate_data, BuildingType::Mansion)?;
if mansion.is_none() || mansion.unwrap().status != BuildingStatus::Active {
    return Err(GameError::BuildingRequired.into());
}
```

---

### ⚔️ BARRACKS (Tier 1) - Military

**Gates:**

| Feature | Processor | Required Level |
|---------|-----------|----------------|
| Hire DefensiveUnit1 | `economy/hire_units.rs` | Lv.1 |
| Hire DefensiveUnit2 | `economy/hire_units.rs` | Lv.5 |
| Hire DefensiveUnit3 | `economy/hire_units.rs` | Lv.10 |
| Hire OperativeUnit1 | `economy/hire_units.rs` | Lv.3 |
| Hire OperativeUnit2 | `economy/hire_units.rs` | Lv.8 |
| Hire OperativeUnit3 | `economy/hire_units.rs` | Lv.15 |
| Assign defensive hero | `hero/assign_defensive.rs` | Lv.10 |

**Level Bonuses:**
```
Lv.1:  Basic units available
Lv.5:  +10% unit hire efficiency
Lv.10: +20% efficiency, Tier 2 units, defensive hero slot
Lv.15: +35% efficiency, Tier 3 units
Lv.20: +50% efficiency, "Warlord" title
```

**Processor Modification:**
```rust
// hire_units.rs - ADD validation
let barracks = get_building(&estate_data, BuildingType::Barracks)?;
if barracks.is_none() {
    return Err(GameError::BuildingRequired.into());
}
let barracks = barracks.unwrap();

// Check unit tier requirements
let required_level = match unit_type {
    UnitType::DefensiveUnit1 => 1,
    UnitType::DefensiveUnit2 => 5,
    UnitType::DefensiveUnit3 => 10,
    UnitType::OperativeUnit1 => 3,
    UnitType::OperativeUnit2 => 8,
    UnitType::OperativeUnit3 => 15,
};

if barracks.level < required_level {
    return Err(GameError::BuildingLevelInsufficient.into());
}
```

---

### 🔧 WORKSHOP (Tier 1) - Materials

**Gates:**

| Feature | Processor | Required Level |
|---------|-----------|----------------|
| Collect resources | `economy/collect_resources.rs` | Lv.1 |
| Uncommon materials | `economy/collect_resources.rs` | Lv.5 |
| Rare materials | `economy/collect_resources.rs` | Lv.10 |
| Epic materials | `economy/collect_resources.rs` | Lv.15 |
| Legendary materials | `economy/collect_resources.rs` | Lv.20 |

**Level Bonuses:**
```
Lv.1:  Common materials only
Lv.5:  +Uncommon, +15% generation
Lv.10: +Rare, +30% generation
Lv.15: +Epic, +50% generation
Lv.20: +Legendary, +75% generation, "Master Craftsman" title
```

---

### 🏦 VAULT (Tier 1) - Finance

**Gates:**

| Feature | Processor | Required Level |
|---------|-----------|----------------|
| NOVI generation (base cap) | `economy/update_locked_novi.rs` | Lv.1 |
| NOVI cap +50% | `economy/update_locked_novi.rs` | Lv.5 |
| NOVI cap +100% | `economy/update_locked_novi.rs` | Lv.10 |
| Cash transfers | `economy/transfer_cash.rs` | Lv.5 |
| Transfer limit +100% | `economy/transfer_cash.rs` | Lv.10 |
| Transfer limit +250% | `economy/transfer_cash.rs` | Lv.15 |

**Level Bonuses:**
```
Lv.1:  Base NOVI cap (from subscription)
Lv.5:  +50% NOVI cap, cash transfers unlocked
Lv.10: +100% NOVI cap, +100% transfer limit
Lv.15: +150% NOVI cap, +250% transfer limit
Lv.20: +200% NOVI cap, unlimited transfers, "Banker" title
```

**Processor Modification:**
```rust
// update_locked_novi.rs - MODIFY cap calculation
let vault = get_building(&estate_data, BuildingType::Vault);
let vault_bonus = match vault {
    Some(v) if v.status == BuildingStatus::Active => {
        match v.level {
            1..=4 => 0,
            5..=9 => 5000,   // +50%
            10..=14 => 10000, // +100%
            15..=19 => 15000, // +150%
            _ => 20000,       // +200%
        }
    }
    _ => 0, // No vault = no bonus (but still base cap)
};

let max_locked_novi = apply_bp_bonus(tier.max_locked_novi, vault_bonus)?;

// transfer_cash.rs - ADD gate
let vault = get_building(&estate_data, BuildingType::Vault)?;
if vault.is_none() || vault.unwrap().level < 5 {
    return Err(GameError::VaultRequired.into());
}
```

---

### ⚒️ FORGE (Tier 2) - Crafting

**Gates:**

| Feature | Processor | Required Level |
|---------|-----------|----------------|
| Craft Refined (Tier 2) | NEW: `estate/craft_equipment.rs` | Lv.1 |
| Craft Superior (Tier 3) | NEW: `estate/craft_equipment.rs` | Lv.5 |
| Craft Elite (Tier 4) | NEW: `estate/craft_equipment.rs` | Lv.8 |
| Craft Masterwork (Tier 5) | NEW: `estate/craft_equipment.rs` | Lv.12 |
| Craft Legendary (Tier 6) | NEW: `estate/craft_equipment.rs` | Lv.16 |
| Craft Mythic (Tier 7) | NEW: `estate/craft_equipment.rs` | Lv.18 |
| Craft Divine (Tier 8) | NEW: `estate/craft_equipment.rs` | Lv.20 |

**Note:** Forge is for CRAFTING quality upgrades. Buying basic equipment uses Market.

**Level Bonuses:**
```
Lv.1:  Tier 2 crafting
Lv.5:  Tier 3, +5% success rate
Lv.8:  Tier 4, +10% success rate
Lv.12: Tier 5, +15% success rate
Lv.16: Tier 6, +20% success rate
Lv.18: Tier 7, +25% success rate
Lv.20: Tier 8, +30% success rate, "Master Smith" title
```

---

### 🏪 MARKET (Tier 2) - Commerce

**Gates:**

| Feature | Processor | Required Level |
|---------|-----------|----------------|
| Purchase equipment (basic) | `economy/purchase_equipment.rs` | Lv.1 |
| Purchase stamina | `economy/purchase_stamina.rs` | Lv.1 |
| Shop items | `shop/purchase_item.rs` | Lv.1 |
| Shop bundles | `shop/purchase_bundle.rs` | Lv.5 |
| Flash sales | `shop/purchase_flash_sale.rs` | Lv.10 |

**Level Bonuses:**
```
Lv.1:  Basic shop access
Lv.5:  5% discount, bundles unlocked
Lv.10: 10% discount, flash sales
Lv.15: 15% discount
Lv.20: 20% discount, "Merchant Prince" title
```

**Processor Modification:**
```rust
// purchase_equipment.rs - ADD gate
let market = get_building(&estate_data, BuildingType::Market)?;
if market.is_none() {
    return Err(GameError::MarketRequired.into());
}

// Apply discount from market level
let discount_bps = market.unwrap().level as u16 * 100; // 1% per level, cap 20%
let discounted_cost = apply_bp(total_cost, 10000 - discount_bps.min(2000))?;
```

---

### 📚 ACADEMY (Tier 2) - Research

**Gates:**

| Feature | Processor | Required Level |
|---------|-----------|----------------|
| Start research | `research/start_research.rs` | Lv.1 |
| Speed up research | `research/speed_up_research.rs` | Lv.1 |
| Research Battle tree | `research/start_research.rs` | Lv.1 |
| Research Economy tree | `research/start_research.rs` | Lv.5 |
| Research Growth tree | `research/start_research.rs` | Lv.10 |

**Level Bonuses:**
```
Lv.1:  Battle research unlocked
Lv.5:  Economy research, +10% research speed
Lv.10: Growth research, +25% research speed
Lv.15: +40% research speed
Lv.20: +60% research speed, "Scholar" title
```

**Processor Modification:**
```rust
// start_research.rs - ADD gate
let academy = get_building(&estate_data, BuildingType::Academy)?;
if academy.is_none() {
    return Err(GameError::AcademyRequired.into());
}

// Check research category requirements
let template = load_research_template(research_type)?;
let required_level = match template.category {
    ResearchCategory::Battle => 1,
    ResearchCategory::Economy => 5,
    ResearchCategory::Growth => 10,
};

if academy.unwrap().level < required_level {
    return Err(GameError::BuildingLevelInsufficient.into());
}
```

---

### 🏟️ ARENA (Tier 2) - PvP

**Gates:**

| Feature | Processor | Required Level |
|---------|-----------|----------------|
| Attack players (PvP) | `combat/attack_player.rs` | Lv.1 |
| Challenge specific player | `combat/attack_player.rs` | Lv.5 |
| Ranked matches | NEW: `arena/ranked_match.rs` | Lv.10 |

**Note:** PvE encounters (`attack_encounter.rs`) remain FREE. Arena gates PvP only.

**Level Bonuses:**
```
Lv.1:  PvP unlocked (random matchmaking)
Lv.5:  Targeted attacks, +5% PvP damage
Lv.10: Ranked system, +10% PvP damage
Lv.15: +15% PvP damage
Lv.20: +25% PvP damage, "Champion" title
```

**Processor Modification:**
```rust
// attack_player.rs - ADD gate
let arena = get_building(&estate_data, BuildingType::Arena)?;
if arena.is_none() {
    return Err(GameError::ArenaRequired.into());
}

// Apply damage bonus from arena level
let arena_damage_bonus_bps = arena.unwrap().level as u16 * 50; // 0.5% per level
```

---

### 🏛️ SANCTUARY (Tier 3) - Heroes

**Gates:**

| Feature | Processor | Required Level |
|---------|-----------|----------------|
| Lock hero for buffs | `hero/lock.rs` | Lv.1 |
| Unlock hero | `hero/unlock.rs` | Lv.1 |
| Level up hero | `hero/level_up.rs` | Lv.5 |
| Hero synergy (2 heroes) | Logic check | Lv.10 |
| Hero synergy (3 heroes) | Logic check | Lv.15 |
| Hero synergy (4 heroes) | Logic check | Lv.20 |

**Level Bonuses:**
```
Lv.1:  Lock/unlock 1 hero
Lv.5:  Hero leveling, lock 2 heroes
Lv.10: Lock 3 heroes, synergy bonuses
Lv.15: Lock 4 heroes, enhanced synergies
Lv.20: Lock 5 heroes, "Hero Master" title
```

**Processor Modification:**
```rust
// hero/lock.rs - ADD gate
let sanctuary = get_building(&estate_data, BuildingType::Sanctuary)?;
if sanctuary.is_none() {
    return Err(GameError::SanctuaryRequired.into());
}

// Check hero slot limits
let max_locked_heroes = match sanctuary.unwrap().level {
    1..=4 => 1,
    5..=9 => 2,
    10..=14 => 3,
    15..=19 => 4,
    _ => 5,
};

if player_data.locked_hero_count >= max_locked_heroes {
    return Err(GameError::MaxHeroesLocked.into());
}
```

---

### 🔭 OBSERVATORY (Tier 3) - Vision

**Gates:**

| Feature | Processor | Required Level |
|---------|-----------|----------------|
| See encounters in city | `encounter/spawn.rs` | Lv.1 |
| See encounters in region | `encounter/spawn.rs` | Lv.5 |
| See encounter rarity | `encounter/spawn.rs` | Lv.10 |
| Global encounter alerts | `encounter/spawn.rs` | Lv.15 |

**Note:** Does NOT gate attacking encounters - gates VISION of what's available.

**Level Bonuses:**
```
Lv.1:  Current city encounters
Lv.5:  Adjacent cities, +10% loot bonus
Lv.10: Rarity preview, +25% loot bonus
Lv.15: 3-city radius, +40% loot bonus
Lv.20: Global alerts, +60% loot bonus, "All-Seeing" title
```

---

### 💰 TREASURY (Tier 3) - Wealth

**Gates:**

| Feature | Processor | Required Level |
|---------|-----------|----------------|
| Claim event prizes | `event/claim_prize.rs` | Lv.1 |
| Prize bonus +25% | `event/claim_prize.rs` | Lv.10 |
| Prize bonus +50% | `event/claim_prize.rs` | Lv.20 |

**Level Bonuses:**
```
Lv.1:  Claim prizes (no bonus)
Lv.5:  +10% prize bonus
Lv.10: +25% prize bonus
Lv.15: +40% prize bonus
Lv.20: +50% prize bonus, "Treasurer" title
```

**Processor Modification:**
```rust
// event/claim_prize.rs - ADD gate + bonus
let treasury = get_building(&estate_data, BuildingType::Treasury)?;
if treasury.is_none() {
    return Err(GameError::TreasuryRequired.into());
}

let prize_bonus_bps = match treasury.unwrap().level {
    1..=4 => 0,
    5..=9 => 1000,   // +10%
    10..=14 => 2500, // +25%
    15..=19 => 4000, // +40%
    _ => 5000,       // +50%
};

let final_prize = apply_bp_bonus(base_prize, prize_bonus_bps)?;
```

---

### 🏰 CITADEL (Tier 3) - Defense & Rallies

**Gates:**

| Feature | Processor | Required Level |
|---------|-----------|----------------|
| Create rally | `rally/create.rs` | Lv.1 |
| Join rally | `rally/join.rs` | Lv.1 |
| Rally capacity +50% | `rally/create.rs` | Lv.10 |
| Rally capacity +100% | `rally/create.rs` | Lv.20 |

**Level Bonuses:**
```
Lv.1:  Basic rally (5 members max)
Lv.5:  +25% rally capacity, +5% rally damage
Lv.10: +50% rally capacity, +10% rally damage
Lv.15: +75% rally capacity, +15% rally damage
Lv.20: +100% rally capacity, +25% rally damage, "Castellan" title
```

**Processor Modification:**
```rust
// rally/create.rs - ADD gate
let citadel = get_building(&estate_data, BuildingType::Citadel)?;
if citadel.is_none() {
    return Err(GameError::CitadelRequired.into());
}

// Calculate rally capacity
let base_capacity = 5;
let capacity_bonus_bps = citadel.unwrap().level as u16 * 500; // 5% per level
let max_rally_members = apply_bp_bonus(base_capacity, capacity_bonus_bps)?;
```

---

### Summary: Processor → Building Requirements

| Processor | Required Building | Min Level |
|-----------|-------------------|-----------|
| `claim_daily_reward.rs` | Mansion | 1 |
| `hire_units.rs` | Barracks | 1+ (by tier) |
| `collect_resources.rs` | Workshop | 1+ (by tier) |
| `update_locked_novi.rs` | Vault (bonus only) | - |
| `transfer_cash.rs` | Vault | 5 |
| `purchase_equipment.rs` | Market | 1 |
| `purchase_stamina.rs` | Market | 1 |
| `shop/purchase_*.rs` | Market | 1+ |
| `research/*.rs` | Academy | 1+ |
| `combat/attack_player.rs` | Arena | 1 |
| `hero/lock.rs` | Sanctuary | 1 |
| `hero/unlock.rs` | Sanctuary | 1 |
| `hero/level_up.rs` | Sanctuary | 5 |
| `rally/*.rs` | Citadel | 1 |
| `event/claim_prize.rs` | Treasury | 1 |

---

### New Error Codes

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GameError {
    // ... existing ...

    // Building requirement errors
    BuildingRequired,           // Generic: need a building
    BuildingLevelInsufficient,  // Have building, wrong level
    BuildingNotActive,          // Building is upgrading/damaged
    MansionRequired,
    BarracksRequired,
    WorkshopRequired,
    VaultRequired,
    ForgeRequired,
    MarketRequired,
    AcademyRequired,
    ArenaRequired,
    SanctuaryRequired,
    ObservatoryRequired,
    TreasuryRequired,
    CitadelRequired,
    MaxHeroesLocked,
}
```

---

### Helper Function

```rust
/// Load and validate building requirement
pub fn require_building(
    estate: &EstateAccount,
    building_type: BuildingType,
    min_level: u8,
) -> Result<&BuildingSlot, ProgramError> {
    // Find building in estate
    let building = estate.buildings.iter()
        .find(|b| b.building_type == building_type as u8);

    match building {
        None => Err(GameError::BuildingRequired.into()),
        Some(b) if b.status != BuildingStatus::Active as u8 => {
            Err(GameError::BuildingNotActive.into())
        }
        Some(b) if b.level < min_level => {
            Err(GameError::BuildingLevelInsufficient.into())
        }
        Some(b) => Ok(b),
    }
}

// Usage in any processor:
let barracks = require_building(&estate, BuildingType::Barracks, 10)?;
// Now safe to proceed with Tier 3 unit hiring
```

---

## Integration Points

### With Player Account

```rust
// PlayerAccount additions for estate integration
pub struct PlayerAccount {
    // ... existing fields ...

    // Estate reference
    pub estate: Pubkey,                     // 0 = no estate

    // Building buffs (cached from estate buildings)
    pub building_attack_bps: u16,
    pub building_defense_bps: u16,
    pub building_resource_gen_bps: u16,
    pub building_xp_gain_bps: u16,
    pub building_storage_bps: u16,
    pub building_training_speed_bps: u16,
    pub building_research_speed_bps: u16,
    pub building_craft_success_bps: u16,
    pub building_trade_discount_bps: u16,

    // Equipment quality buffs (cached from CraftedEquipment PDA)
    pub equipment_weapon_quality_bps: u16,
    pub equipment_armor_quality_bps: u16,
}

/// Hybrid Buff Stacking: Additive within category, Multiplicative between
///
/// Categories stack additively internally:
/// - research_attack_bps = sum of all research attack buffs
/// - hero_attack_bps = sum of all hero attack buffs
/// - building_attack_bps = sum of all building attack buffs
/// - equipment_weapon_quality_bps = sum of all equipment quality buffs
///
/// Then categories multiply together.
pub fn calculate_total_attack(player: &PlayerAccount) -> u64 {
    let base_attack = calculate_base_attack(player);

    // Each category is its additive sum, then multiply between categories
    let research_mult = 10000u64 + player.research_attack_bps as u64;
    let hero_mult = 10000u64 + player.hero_attack_bps as u64;
    let building_mult = 10000u64 + player.building_attack_bps as u64;
    let equipment_mult = 10000u64 + player.equipment_weapon_quality_bps as u64;

    // Multiplicative stacking between categories
    // Order: research × hero × building × equipment
    let final_attack = base_attack
        .saturating_mul(research_mult) / 10000
        .saturating_mul(hero_mult) / 10000
        .saturating_mul(building_mult) / 10000
        .saturating_mul(equipment_mult) / 10000;

    final_attack
}

/// Example with real numbers:
/// - Base attack: 1000
/// - Research: 3000 bps (+30%) → 1.30x
/// - Heroes: 2500 bps (+25%) → 1.25x
/// - Buildings: 2000 bps (+20%) → 1.20x
/// - Equipment: 1500 bps (+15%) → 1.15x
///
/// Final = 1000 × 1.30 × 1.25 × 1.20 × 1.15 = 2,243
/// Total effective buff = +124.3% (exceeds 100%!)
```

### With Research System

```rust
// Research unlocks building features
pub fn check_building_requirement(
    player: &PlayerAccount,
    research: &ResearchProgress,
    building_config: &BuildingConfigAccount,
) -> bool {
    // Check research prerequisites
    for req in building_config.required_research.iter() {
        if *req > 0 {
            let research_node = *req as usize;
            if research.completed_levels[research_node] < 1 {
                return false;
            }
        }
    }
    true
}

// Academy building provides research bonus
pub fn calculate_research_time(
    base_time: u64,
    research_progress: &ResearchProgress,
    estate: &EstateAccount,
    academy_building: Option<&BuildingAccount>,
) -> u64 {
    let mut multiplier_bps: u64 = 10000;

    // Research speed from research tree
    multiplier_bps = multiplier_bps.saturating_sub(research_progress.construction_speed_bps as u64);

    // Academy building bonus
    if let Some(academy) = academy_building {
        if academy.status == BuildingStatus::Active {
            multiplier_bps = multiplier_bps.saturating_sub(academy.buff_cache.research_speed_bps as u64);
        }
    }

    (base_time as u128 * multiplier_bps as u128 / 10000) as u64
}
```

### With Team System

```rust
// Team HQ buffs apply to all team members
pub fn apply_team_buffs(
    player: &mut PlayerAccount,
    team: &TeamAccount,
    team_hq: &TeamHQAccount,
) {
    if team_hq.status == HQStatus::Active {
        player.team_attack_bps = team_hq.team_buffs.attack_bps;
        player.team_defense_bps = team_hq.team_buffs.defense_bps;
        // etc.
    }
}

// War mechanics
pub fn process_war_attack(
    attacker: &PlayerAccount,
    defender: &PlayerAccount,
    attacker_team: &TeamAccount,
    defender_team: &TeamAccount,
    attacker_hq: &mut TeamHQAccount,
    defender_hq: &mut TeamHQAccount,
) -> WarResult {
    // Check if teams are at war
    if attacker_hq.at_war_with != defender_team.key() {
        return Err(NotAtWar);
    }

    // Normal attack resolution
    let result = resolve_attack(attacker, defender);

    // Award war points
    if result.attacker_won {
        attacker_hq.war_points_us = attacker_hq.war_points_us.saturating_add(10);
    } else {
        defender_hq.war_points_us = defender_hq.war_points_us.saturating_add(5);
    }

    result
}
```

### With Shop System

```rust
// Market building provides shop discounts
pub fn calculate_shop_price(
    base_price: u64,
    player: &PlayerAccount,
    estate: &EstateAccount,
    market_building: Option<&BuildingAccount>,
    shop_config: &ShopConfigAccount,
) -> u64 {
    let mut discount_bps: u64 = 0;

    // Loyalty discount
    discount_bps += get_loyalty_discount(player.shop_milestone_tier);

    // Market building discount
    if let Some(market) = market_building {
        if market.status == BuildingStatus::Active {
            discount_bps += market.buff_cache.trade_discount_bps as u64;
        }
    }

    // Cap total discount
    discount_bps = discount_bps.min(shop_config.max_total_discount_bps as u64);

    (base_price as u128 * (10000 - discount_bps) as u128 / 10000) as u64
}
```

---

## Expandability Architecture

### Adding New Buildings

The system is designed for easy expansion:

```rust
// To add a new building:

// 1. Add to BuildingType enum (just increment)
pub enum BuildingType {
    // ... existing ...
    NewBuilding = 13,  // Next available
}

// 2. Create BuildingConfigAccount via DAO instruction
// No code changes required - config defines all properties

// 3. Add building-specific instructions if needed
// E.g., new_building_special_action (new instruction number)

// 4. Add to client/frontend

// That's it! No redeployment of core logic needed.
```

### Adding New Buff Types

```rust
// Buffs are identified by enum, easily extended
pub enum BuffType {
    // ... existing ...
    NewBuff = 16,
}

// BuildingBuffs struct has reserved space
pub struct BuildingBuffs {
    // ... existing ...
    pub special_1_bps: u16,  // Can repurpose
    pub special_2_bps: u16,  // Can repurpose
    pub _padding: [u8; 8],   // Room for 4 more u16 buffs
}
```

### Adding New Facilities (Team HQ)

```rust
// Similar pattern to buildings
pub enum FacilityType {
    // ... existing ...
    NewFacility = 9,
}

// Facility slots have room for expansion
pub facilities: [FacilityState; 8],  // Can increase
```

### Version Migration

```rust
// EstateAccount and BuildingAccount have version tracking
pub struct EstateAccount {
    pub version: u8,  // Added for future migrations
    // ...
}

// Migration instruction can update old accounts
pub fn migrate_estate_v1_to_v2(/* ... */) {
    // Read old data, transform, write new format
}
```

---

## Migration from Monuments

### Phase 1: Parallel Systems

Both systems run simultaneously:
- Existing monuments continue to provide city buffs
- Players can build personal estates
- No breaking changes

### Phase 2: Contribution Conversion

Players who contributed to monuments get migration benefits:
```
CONVERSION FORMULA:
├── Monument contribution tracked in MonumentContributor PDA
├── Conversion ratio: 1 NOVI contributed = 0.5 NOVI estate credit
├── Credits applied to: Estate construction costs
├── Bonus: Top contributors get exclusive decorations

EXAMPLE:
├── Player contributed 100,000 NOVI to Colosseum
├── Conversion: 50,000 NOVI credit
├── Can apply to: Building construction (up to 50% of cost)
├── Bonus: "Colosseum Builder" statue for Mansion
```

### Phase 3: Monument Transformation

City monuments become **City Landmarks**:
- Still provide city-wide buffs
- No longer player-contributed (fixed)
- Cities gain landmarks based on city type
- Existing monuments "grandfathered" to their cities

### Phase 4: Monument Deprecation

```
DEPRECATED:
├── MonumentAccount - no new proposals
├── MonumentContributor - no new contributions
├── MonumentRegistry - frozen

PRESERVED:
├── Existing monument buffs continue working
├── Historical data for provenance
├── NFTs remain in city custody

NEW SYSTEM:
├── EstateAccount - personal buildings
├── BuildingAccount - individual buildings
├── TeamHQAccount - team buildings
├── City bonuses come from city type, not monuments
```

---

## Balance & Progression

### Progression Curves

All costs follow golden ratio scaling:

```
CONSTRUCTION COST CURVE:
Level N cost = Base × φ^(N-1)

LEVEL   MULTIPLIER   NOVI COST (Base 10K)
1       1.000        10,000
2       1.618        16,180
3       2.618        26,180
4       4.236        42,360
5       6.854        68,540
10      76.013       760,130
15      843.39       8,433,900
20      9,349.2      93,492,000
```

### Buff Scaling

Buffs scale with golden root:

```
BUFF VALUE CURVE:
Level N buff = Base × (√φ)^(N-1)

LEVEL   MULTIPLIER   BUFF (Base 500 bps = 5%)
1       1.000        5.00%
5       2.058        10.29%
10      4.236        21.18%
15      8.716        43.58%
20      17.94        89.72%
```

### Time Investment

```
CASUAL PLAYER PATH (1-2 hours/day):
├── Week 1: Estate created, 2 buildings at Lv.1
├── Month 1: 4 buildings at Lv.3-5
├── Month 3: 4 buildings at Lv.7-10, unlock Tier 2
├── Month 6: 8 buildings at Lv.10-12
├── Year 1: Full Tier 1-2 at Lv.15, starting Tier 3

DEDICATED PLAYER PATH (4+ hours/day):
├── Week 1: 4 buildings at Lv.3
├── Month 1: 8 buildings at Lv.8-10
├── Month 3: 12 buildings at Lv.12-15
├── Month 6: Full estate at Lv.18+
├── Year 1: Max everything, competing for leaderboards

WHALE PATH (unlimited spending):
├── Week 1: Speed through to Lv.10 all
├── Month 1: Max all Tier 1-2
├── Month 3: Max all Tier 3
├── Focus: Cosmetics, leaderboards, team dominance
```

### Economic Balance

```
SINK/SOURCE BALANCE:

NOVI SOURCES (per player/month):
├── Subscription generation: ~90,000 (Epic tier)
├── Event winnings: ~50,000 (active player)
├── Encounter loot: ~30,000
└── TOTAL: ~170,000 NOVI

NOVI SINKS (per player/month):
├── Building upkeep: ~45,000
├── Building activities: ~75,000
├── Construction/upgrades: ~100,000 (amortized)
├── Team HQ contribution: ~20,000
└── TOTAL: ~240,000 NOVI

NET: -70,000 NOVI (deflationary pressure)
Players must be active to maintain, whales subsidize
```

---

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1-2)

```
DELIVERABLES:
├── EstateAccount state structure
├── BuildingAccount state structure
├── BuildingConfigAccount state structure
├── initialize_estate instruction
├── construct_building instruction
├── upgrade_building instruction
├── complete_upgrade instruction
├── 4 Tier 1 building configs

TESTING:
├── Unit tests for state management
├── Integration tests for construction flow
├── Cost calculation tests
```

### Phase 2: Building Activities (Week 3-4)

```
DELIVERABLES:
├── Forge crafting system
├── Vault deposit/withdraw
├── Barracks training queue
├── Workshop production
├── Mansion daily bonus
├── Recipe system
├── Mastery XP system

TESTING:
├── Activity flow tests
├── Resource consumption tests
├── Timing verification tests
```

### Phase 3: Tier 2 Buildings (Week 5-6)

```
DELIVERABLES:
├── Market trading system
├── Academy research boost
├── Arena challenge system
├── Forge advanced features (upgrade, reforge)
├── 4 Tier 2 building configs

TESTING:
├── Market economy tests
├── Arena matchmaking tests
├── Cross-building interaction tests
```

### Phase 4: Team HQ (Week 7-8)

```
DELIVERABLES:
├── TeamHQAccount state structure
├── Facility system
├── Weekly contribution system
├── War declaration system
├── Team buff application

TESTING:
├── Multi-player contribution tests
├── War mechanics tests
├── Team buff propagation tests
```

### Phase 5: Tier 3 & Polish (Week 9-10)

```
DELIVERABLES:
├── Shrine, Observatory, Treasury, Citadel
├── Quest system framework
├── Decoration system
├── Social features (visiting, ratings)
├── Leaderboards

TESTING:
├── Full progression tests
├── Economy balance tests
├── Load testing
```

### Phase 6: Monument Migration (Week 11-12)

```
DELIVERABLES:
├── Migration scripts
├── Contribution conversion
├── Legacy monument handling
├── Documentation updates

TESTING:
├── Migration verification
├── Data integrity checks
├── Rollback procedures
```

---

## Appendix: UI/UX Mockups

### Estate Overview Screen

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🏰 MY ESTATE                                              [⚙️] [❓] [🔔]   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                      │   │
│  │   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐                   │   │
│  │   │ 🏛️      │ │ ⚔️      │ │ ⚒️      │ │ 🏦      │                   │   │
│  │   │ MANSION │ │BARRACKS │ │WORKSHOP │ │  VAULT  │                   │   │
│  │   │  Lv.8   │ │  Lv.5   │ │  Lv.4   │ │  Lv.6   │                   │   │
│  │   │ ACTIVE  │ │ ACTIVE  │ │UPGRADING│ │ ACTIVE  │                   │   │
│  │   └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘                   │   │
│  │        │           │           │           │                         │   │
│  │   [ENTER]    [ENTER]    [2h 15m]    [ENTER]                         │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ════════════════════════════════════════════════════════════════════════   │
│                                                                              │
│  ESTATE STATS                          QUICK ACTIONS                        │
│  ┌─────────────────────────┐          ┌─────────────────────────────────┐  │
│  │ Level: 23               │          │ [💰 Collect All]                │  │
│  │ Power: 45,670           │          │ [⬆️ Upgrade Available (2)]      │  │
│  │ Buildings: 4/8          │          │ [📦 Claim Crafts (1)]           │  │
│  │ Invested: 5.2M NOVI     │          │ [🏆 Daily Bonus Ready]          │  │
│  │ Rating: ⭐⭐⭐⭐☆ (4.2)  │          │ [🎯 Quest Progress]             │  │
│  └─────────────────────────┘          └─────────────────────────────────┘  │
│                                                                              │
│  [🏗️ Build New] [🗺️ Buy Plot] [🎨 Decorate] [📊 Full Stats] [👥 Visit]    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Building Interior Screen (Forge Example)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🔙 Back to Estate              ⚒️ THE FORGE (Level 6)              [❓]   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                         WORKBENCHES                                    │ │
│  ├───────────────────────────────────────────────────────────────────────┤ │
│  │  [1] ████████████░░░░ 78%  │  [2] ████░░░░░░░░░░░░ 25%  │  [3] READY  │ │
│  │      Steel Sword           │      Iron Armor            │   [START]   │ │
│  │      1h 12m remaining      │      4h 30m remaining      │             │ │
│  │      [⚡ Speed Up]         │      [⚡ Speed Up]         │             │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────────┐  │
│  │      MATERIALS          │  │               RECIPES                    │  │
│  │  ─────────────────────  │  │  ─────────────────────────────────────  │  │
│  │  Common:     1,234      │  │  ┌─────────────────────────────────────┐ │  │
│  │  Uncommon:     456      │  │  │ 📗 BASIC CRAFTING                  │ │  │
│  │  Rare:          78      │  │  │    Iron Sword, Iron Shield...      │ │  │
│  │  Epic:          12      │  │  ├─────────────────────────────────────┤ │  │
│  │  Legendary:      2      │  │  │ 📘 UNCOMMON CRAFTING               │ │  │
│  │                         │  │  │    Steel Sword, Steel Armor...     │ │  │
│  │  [🔄 Salvage Items]     │  │  ├─────────────────────────────────────┤ │  │
│  └─────────────────────────┘  │  │ 📕 RARE CRAFTING  🔒 Lv.8          │ │  │
│                               │  │    Unlock at Forge Level 8          │ │  │
│  ┌─────────────────────────┐  │  └─────────────────────────────────────┘ │  │
│  │      MASTERY            │  │                                          │  │
│  │  ─────────────────────  │  │  NEW RECIPE AVAILABLE! ⭐                │  │
│  │  Level: 15              │  │  You can now craft: Enchanted Blade     │  │
│  │  XP: 12,450 / 15,000    │  │  [View Recipe]                          │  │
│  │  ████████████░░░░ 83%   │  │                                          │  │
│  │                         │  └─────────────────────────────────────────┘  │
│  │  Next Perk: +5% speed   │                                              │
│  └─────────────────────────┘                                              │
│                                                                              │
│  [📊 Forge Stats] [🏆 Achievements] [📜 Quest: Chapter 4]                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

The Estate System transforms Novus Mundus from a game where players contribute anonymously to city projects into one where **every player builds their own empire**.

**Key Innovations**:
1. **Personal ownership** of buildings with tangible progression
2. **Interactive interiors** with daily activities and mini-games
3. **Multi-layered sinks** ensuring economic sustainability
4. **Team HQ system** for guild-level collaboration
5. **Quest-driven storylines** that unlock lore and rewards
6. **Expandable architecture** for future content

The system provides depth for hardcore players while remaining accessible to casuals, creates meaningful NOVI sinks that scale with player wealth, and establishes a foundation for years of content expansion.

---

## Challenges & Mitigations

### 1. Craft Failure Protection System

High-tier crafting (Legendary+) has punishing failure rates. Add protection mechanics:

```
PROTECTION OPTIONS (choose before crafting):

1. BLESSING (Gem cost)
   ├── Tier 6: 100 gems → On failure, item stays same tier (no downgrade)
   ├── Tier 7: 300 gems → On failure, item stays same tier
   ├── Tier 8: 1,000 gems → On failure, item stays same tier
   └── Materials still lost, but item preserved

2. INSURANCE (NOVI cost)
   ├── Tier 6: 25,000 NOVI → On failure, refund 50% materials
   ├── Tier 7: 75,000 NOVI → On failure, refund 50% materials
   ├── Tier 8: 200,000 NOVI → On failure, refund 50% materials
   └── Adds to sink without total devastation

3. PITY SYSTEM (Automatic)
   ├── Track consecutive failures per tier
   ├── After 3 failures: +10% success rate
   ├── After 5 failures: +25% success rate
   ├── After 7 failures: Guaranteed success (next attempt)
   └── Resets on success

SUBSCRIBER BENEFITS:
├── Expert: 1 free blessing per week
├── Epic: 2 free blessings per week + pity kicks in 1 failure earlier
└── Legendary: 3 free blessings per week + pity kicks in 2 failures earlier
```

### 2. Material Acquisition Sources

Clear daily/weekly faucets for materials:

```
DAILY SOURCES:
├── Encounters (travel): 50-200 common, 10-50 uncommon, 0-10 rare
├── Daily login bonus: Scales with streak (up to 50 rare at 30-day streak)
├── Building activities: Each building produces materials
│   ├── Workshop: 100 common + 20 uncommon/day
│   ├── Vault interest: Converts to materials option
│   └── Market transactions: Material kickbacks
├── Rally participation: 50-500 based on contribution
└── Team treasury distribution: Weekly team material pool

WEEKLY SOURCES:
├── Weekly quest completion: 500 rare + 100 epic
├── Arena weekly ranking: Top 100 = legendary materials
├── Event participation: Variable, typically epic+
└── Subscription rewards: Scaling material packs

LEGENDARY SOURCES (limited):
├── Daily cap: ~3 from gameplay
├── Boss encounters: 1-5 per kill
├── Event milestones: 10-50 per event
├── Achievements: One-time bonuses
├── Divine craft failures: 10% material recovery as legendary
└── Team raid completion: 5-20 shared among participants

FRAGMENT SOURCES:
├── Daily: 3-5 from encounters
├── Hero meditation (Enlightenment): 5% chance per completion
├── Sanctuary daily: 1 guaranteed
├── Achievements: Milestone rewards
├── Events: Primary fragment source (100-500 per event)
└── Purchase: Gem shop (expensive, limited)
```

### 3. New Player Catch-Up System

Players who start late can catch up faster:

```
ACCELERATED PROGRESSION (for new players):
├── First 30 days: 2x mastery XP from all sources
├── First 60 days: 1.5x mastery XP
├── First 90 days: 1.25x mastery XP
├── After 90 days: Normal rates
└── Applies to: Forge mastery, Sanctuary mastery, building XP

MENTOR SYSTEM:
├── Veteran (6+ months) can mentor newbie (< 30 days)
├── Mentor benefits: +10% XP when mentee is active
├── Mentee benefits:
│   ├── Can use mentor's Forge (up to their max tier - 2)
│   ├── +25% material drops
│   └── Access to mentor's synergy discoveries
├── Limit: 1 mentee at a time, 3 mentees lifetime
└── Creates social bonds, retention

SEASONAL CATCH-UP EVENTS:
├── Every 3 months: "Forge Fever" event
│   ├── +50% mastery XP
│   ├── -25% craft times
│   └── +10% success rates
├── Every 6 months: "Material Bonanza"
│   ├── 3x material drops for 1 week
│   └── Special material conversion rates
└── Helps cohort catch up to veterans
```

### 4. Daily Engagement Loop: Building Mini-Games

**Architecture:** Mini-games run OFF-CHAIN. Game server co-signs transactions.

```
VERIFICATION FLOW:
┌──────────┐    ┌──────────┐    ┌──────────┐
│  CLIENT  │ →  │  GAME    │ →  │ ON-CHAIN │
│ Plays    │    │ SERVER   │    │ Verifies │
│ mini-game│    │ Co-signs │    │ & Grants │
└──────────┘    └──────────┘    └──────────┘

1. Client plays mini-game locally
2. Client sends score to game server
3. Game server validates score is plausible
4. Game server co-signs transaction with player
5. On-chain: require_signer(player) + require_signer(game_server)
6. Rewards granted (server signature = trusted score)

- Game server pubkey stored in GameEngine (DAO-controlled)
- Actual game mechanics decided at UI implementation
```

#### Time Window System

Player's first activity of the day sets their personal "dawn":

```
FLEXIBLE WINDOWS (relative to first activity):
├── Dawn: Hours 0-3 after first activity
├── Midday: Hours 4-8 after first activity
├── Dusk: Hours 9-16 after first activity
└── Expired: After hour 16

EXAMPLE (player starts at 7 AM):
├── Dawn: 7 AM - 10 AM
├── Midday: 11 AM - 3 PM
├── Dusk: 4 PM - 11 PM

EXAMPLE (player starts at 2 PM):
├── Dawn: 2 PM - 5 PM
├── Midday: 6 PM - 10 PM
├── Dusk: 11 PM - 6 AM
```

#### Building Mini-Games

Each building has a unique daily activity. Game specifics TBD at UI implementation.

---

**🏠 MANSION - "Welcome Home" (Any Time)**
```
Type: Login Claim
Time: ~5 seconds
Window: Any (once per day)

Mechanic:
├── Visit your Mansion
├── Claim daily presence reward
├── Streak increments automatically
└── That's it - just show up!

Base Rewards:
├── 100 common materials
├── 50 NOVI
├── 10 XP

Streak Bonuses (multiplies base):
├── Days 1-6: 1.0x
├── Days 7-13: 1.25x
├── Days 14-29: 1.5x
├── Days 30-59: 2.0x
├── Days 60-89: 2.5x
├── Days 90+: 3.0x

Streak Milestones:
├── 7 days: 500 NOVI + 100 uncommon materials
├── 14 days: 1,000 NOVI + 50 rare materials
├── 30 days: 5,000 NOVI + 25 epic + "Dedicated" title
├── 60 days: 15,000 NOVI + 10 legendary + cosmetic
├── 90 days: 30,000 NOVI + exclusive artifact + "Unwavering" title
├── 180 days: 100,000 NOVI + legendary artifact + permanent +5% all rewards

Miss a day = streak resets to 0. No protection, no exceptions.

On-chain: Check last_claim_date, grant rewards, update streak
```

---

**⚔️ BARRACKS - "Morning Drill" (Dawn)**
```
Type: Reaction/Timing Game
Time: ~15 seconds
Window: Dawn

Suggested Mechanic:
├── Commands flash on screen (directional or action-based)
├── Player responds within time limit
├── Score based on accuracy and speed
└── Game server validates score is achievable

Score → Reward:
├── 0-40%: No bonus
├── 41-70%: +5% unit effectiveness (24h)
├── 71-90%: +10% unit effectiveness
├── 91-100%: +15% unit effectiveness

On-chain: Receive signed score, grant buff
```

---

**🔧 WORKSHOP - "Scrap Sorting" (Dawn/Midday)**
```
Type: Categorization/Sorting Game
Time: ~30 seconds
Window: Dawn or Midday

Suggested Mechanic:
├── Items appear, player sorts into categories
├── Score based on correct categorizations
├── Time pressure adds challenge
└── 10 items per session

Score → Reward:
├── Base: 10 common materials
├── +5 common per correct answer (max +50)
├── +1 uncommon per 3 correct
├── Perfect (10/10): +1 rare material

On-chain: Receive signed correct count, grant materials
```

---

**🏦 VAULT - "Security Inspection" (Dawn/Midday)**
```
Type: Observation/Spot-the-Difference Game
Time: ~30 seconds
Window: Dawn or Midday

Suggested Mechanic:
├── Vault schematic shown with potential vulnerabilities
├── Player identifies security flaws (cracks, weak points)
├── Score based on flaws found
└── Missed flaws = lower security rating

Score → Reward:
├── Base: 50 common materials
├── Per flaw found: +25 common, +10 uncommon
├── All flaws (8/8): Bonus 5 rare + "Eagle Eye" badge
├── Perfect streak (7 days): +1 epic material

On-chain: Receive signed flaw count, grant materials
Note: Vault provides material rewards, NOT interest
```

---

**⚒️ FORGE - "Fire the Furnace" (Dawn/Midday)**
```
Type: Precision Timing Game
Time: ~10 seconds
Window: Dawn or Midday

Suggested Mechanic:
├── Temperature gauge rises while holding
├── Release when in optimal zone
├── Multiple attempts, average score
└── Tests timing precision

Score → Reward:
├── 0-30%: No bonus
├── 31-60%: +25% mastery XP today
├── 61-85%: +50% mastery XP today
├── 86-100%: +100% mastery XP today

On-chain: Receive signed score, store mastery buff
```

---

**🏪 MARKET - "Deal Finder" (Midday)**
```
Type: Speed Selection Game
Time: ~20 seconds
Window: Midday

Mechanic:
├── 9 items flash on screen with varying discounts
├── Some are good deals (green), some are traps (red)
├── Player must quickly tap/select the best deals
├── Timer pressure, items shuffle/disappear
└── Score = (good deals selected) - (traps selected)

Score → Reward:
├── 0-2 points: No discount
├── 3-4 points: 5% shop discount today
├── 5-6 points: 10% shop discount today
├── 7-8 points: 15% shop discount today
├── 9 (perfect): 20% shop discount + "Bargain Hunter" badge

On-chain: Receive signed score, apply discount modifier
```

---

**📚 ACADEMY - "Daily Lecture" (Midday)**
```
Type: Lore + Comprehension Quiz
Time: ~30 seconds
Window: Midday

Mechanic:
├── Short lore snippet displayed
├── Player can READ or SKIP
├── If READ: Answer comprehension question
├── Lore content managed off-chain (CMS)

Rewards:
├── Skip: 50 research XP
├── Read + wrong answer: 100 research XP
├── Read + correct answer: 200 research XP + lore unlock

On-chain: Receive engagement level, grant XP
Lore tracking: Off-chain database
```

---

**🏟️ ARENA - "Warm-Up Bout" (Midday)**
```
Type: Simple Combat (Rock-Paper-Scissors variant)
Time: ~20 seconds
Window: Midday

Suggested Mechanic:
├── 3 rounds against AI
├── Choose: Attack | Defend | Feint
├── Attack > Feint > Defend > Attack
├── AI patterns readable but varied

Rewards:
├── 0 wins: No bonus
├── 1 win: +5% arena damage today
├── 2 wins: +10% arena damage today
├── 3 wins: +15% arena damage + "Hot Streak" badge

On-chain: Receive signed win count, grant buff
```

---

**🏛️ SANCTUARY - "Hero Blessing" (Dusk)**
```
Type: Strategic Selection
Time: ~10 seconds
Window: Dusk

Mechanic:
├── View your heroes
├── Select ONE to receive blessing
├── Blessed hero: +25% all buffs for 24h
├── Must own the hero (verified on-chain)

Strategy:
├── Bless attack hero for rally day
├── Bless economy hero for farming
├── Bless hero needed for upcoming event

On-chain: Verify hero ownership, store blessed hero pubkey
```

---

**🔭 OBSERVATORY - "Star Reading" (Dusk)**
```
Type: Pattern Recognition
Time: ~15 seconds
Window: Dusk

Suggested Mechanic:
├── Star field with constellation pattern
├── Identify from 4 options
├── Pattern generated from next day's seed
└── Correct identification = bonus

Rewards:
├── Wrong: Tomorrow's encounter hints only
├── Correct: Hints + 10% loot bonus tomorrow

Hints Example: "Bandits gathering in Northern Woods"
On-chain: Receive guess, compare to expected, grant buff
```

---

**🏛️ TREASURY - "Ledger Audit" (Dusk)**
```
Type: Memory/Matching Game
Time: ~45 seconds
Window: Dusk

Suggested Mechanic:
├── Grid of face-down number tiles
├── Find matching pairs
├── Memory game with time pressure
├── 8 pairs to find

Rewards:
├── Base: 100 NOVI
├── +75 NOVI per pair found (max +600)
├── Perfect (8/8): Bonus 200 NOVI
├── Max daily: 900 NOVI

On-chain: Receive signed pair count, grant NOVI
```

---

**🏰 CITADEL - "Watch Report" (Dusk)**
```
Type: Review + Tactical Choice
Time: ~30 seconds
Window: Dusk

Mechanic:
├── View overnight attack log (if any)
├── See attackers and outcomes
├── Set defensive stance for tomorrow

Stance Options:
├── Fortify: +20% defense, -10% counter-attack
├── Aggressive: +20% counter-attack, -10% defense
├── Trap: +30% defense vs specific player
├── Alert: Notification when attacked

On-chain: Display attack logs, store stance choice
```

---

#### Reward Summary Table

| Building | Window | Game Type | Time | Primary Reward |
|----------|--------|-----------|------|----------------|
| Mansion | Any | Claim | 5s | Login streak rewards + NOVI/materials |
| Barracks | Dawn | Timing | 15s | Unit effectiveness buff |
| Workshop | Dawn/Mid | Sorting | 30s | 10-65 materials |
| Vault | Dawn/Mid | Observation | 30s | 50-200+ materials |
| Forge | Dawn/Mid | Precision | 10s | +25-100% mastery XP |
| Market | Midday | Speed Select | 20s | 5-20% shop discount |
| Academy | Midday | Quiz | 30s | 50-200 research XP |
| Arena | Midday | Combat | 20s | +5-15% arena damage |
| Sanctuary | Dusk | Choice | 10s | Hero +25% buff |
| Observatory | Dusk | Pattern | 15s | Loot buff + hints |
| Treasury | Dusk | Memory | 45s | 100-900 NOVI |
| Citadel | Dusk | Review | 30s | Defense stance |

**Total daily time:** ~15-20 minutes across all windows (mini-games are optional)

---

#### Streak System

**Login Streak (Mansion)**

The primary streak is tied to the Mansion's "Welcome Home" claim. Just visit your Mansion daily to maintain streak.

```
LOGIN STREAK RULES:
├── Visit Mansion = streak increments
├── Miss a day = streak resets to 0
├── No protection, no exceptions

STREAK MULTIPLIER (applies to Mansion rewards):
├── Days 1-6: 1.0x
├── Days 7-13: 1.25x
├── Days 14-29: 1.5x
├── Days 30-59: 2.0x
├── Days 60-89: 2.5x
├── Days 90+: 3.0x

MILESTONE REWARDS (one-time):
├── 7 days: 500 NOVI + 100 uncommon
├── 14 days: 1,000 NOVI + 50 rare
├── 30 days: 5,000 NOVI + 25 epic + "Dedicated" title
├── 60 days: 15,000 NOVI + 10 legendary + cosmetic
├── 90 days: 30,000 NOVI + artifact + "Unwavering" title
├── 180 days: 100,000 NOVI + legendary artifact + permanent +5% all rewards
```

**Window Completion Bonuses**

Mini-game activities have optional window completion bonuses:

```
WINDOW COMPLETION:
├── Dawn complete (4 buildings): +10% to Dawn rewards
├── Midday complete (4 buildings): +10% to Midday rewards
├── Dusk complete (4 buildings): +10% to Dusk rewards
├── Full day (all 3 windows): +25% bonus to ALL rewards

Note: These are bonus multipliers, NOT required for login streak
```

---

#### State Structure

```rust
/// Daily activity tracking - add to PlayerCore or EstateAccount
pub struct DailyActivityState {
    // Login streak (Mansion)
    pub last_login_date: u16,         // Days since epoch
    pub login_streak: u16,            // Current consecutive days
    pub longest_login_streak: u16,    // Best ever
    pub permanent_bonus_bps: u16,     // From 180-day milestone (+5%)

    // Window tracking
    pub daily_date: u16,              // Days since epoch (for mini-games)
    pub dawn_timestamp: i64,          // When player started today
    pub windows_completed: u8,        // Bitflags: 0b00000DML (Dawn/Midday/Dusk)

    // Building completion per window (bitflags, 12 buildings)
    pub dawn_buildings: u16,
    pub midday_buildings: u16,
    pub dusk_buildings: u16,

    // Active buffs (from mini-games, expire at next dawn)
    pub unit_effectiveness_bps: u16,  // From Barracks
    pub mastery_bonus_bps: u16,       // From Forge
    pub arena_damage_bps: u16,        // From Arena
    pub loot_bonus_bps: u16,          // From Observatory
    pub market_discount_bps: u16,     // From Market (same day)
    pub blessed_hero: Pubkey,         // From Sanctuary
    pub citadel_stance: u8,           // From Citadel
}

/// Instruction data for completing a daily activity
pub struct DailyActivityData {
    pub building_type: u8,            // Which building's mini-game
    pub score: u8,                    // 0-100, trusted because game server co-signed
}
```

---

#### Signer Verification

```rust
/// Simple approach: Game server is a required signer
/// Server keypair stored securely, pubkey in GameEngine

// Accounts for complete_daily_activity instruction:
// [writable] player_account
// [signer] player_owner          // Player must sign
// [signer] game_server           // Game server must co-sign
// [] game_engine                 // Contains authorized game_server pubkey

pub fn process_complete_daily_activity(accounts: &[AccountInfo], data: DailyActivityData) -> ProgramResult {
    let [player_account, player_owner, game_server, game_engine] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Both player AND game server must sign
    require_signer(player_owner)?;
    require_signer(game_server)?;

    // Verify game server is authorized
    let engine = unsafe { GameEngine::load(game_engine.data()) };
    if game_server.key() != &engine.game_server_pubkey {
        return Err(GameError::UnauthorizedSigner.into());
    }

    // Score is trusted because game server signed
    grant_daily_reward(player_account, data.building_type, data.score)?;

    Ok(())
}
```

### 5. PvP Matchmaking Brackets

Quality tier affects matchmaking:

```
ARENA BRACKETS:
├── Bronze: Common-Superior gear (Tier 1-3)
├── Silver: Elite-Masterwork gear (Tier 4-5)
├── Gold: Legendary gear (Tier 6)
├── Platinum: Mythic gear (Tier 7)
├── Diamond: Divine gear (Tier 8)
└── Each bracket has own leaderboard and rewards

MATCHMAKING FACTORS:
├── Highest equipment quality tier
├── Total equipment quality score
├── Player level
├── Win/loss ratio
└── Creates fair competition at all progression stages

CROSS-BRACKET CHALLENGES:
├── Optional: Challenge higher bracket for bonus rewards
├── Risk: Losing to lower bracket = rating penalty
└── Keeps competition interesting
```

### 6. Account Optimization Strategy

Reduce on-chain complexity:

```
ACCOUNT CONSOLIDATION:
├── PlayerCore: Expand to include cached estate data
├── BuildingAccounts: Use single "EstateBuildings" array account
│   ├── All 12 buildings in one account
│   ├── Reduces account count by 11
│   └── Single rent payment
├── Synergy validation: Store hero pubkeys in Sanctuary, not full accounts
└── Target: 5-7 accounts per player max

LAZY LOADING:
├── Estate overview: Load EstateAccount only
├── Building detail: Load specific building on demand
├── Synergy check: Validate hero ownership via token accounts
└── Artifact effects: Cached in PlayerCore, recalc on change

CU OPTIMIZATION:
├── Awakening ritual: Split into start/complete transactions
├── Bulk operations: Process in batches across multiple tx
├── Synergy calculation: Cache results, recalc on hero change
└── Material operations: Batch conversions
```

### 7. Seasonal Content Framework

Keep long-term players engaged:

```
SEASONAL STRUCTURE (3-month seasons):
├── Theme: Each season has visual theme + limited cosmetics
├── Battle Pass: Free + Premium tracks
├── Leaderboards: Reset each season, rewards based on final rank
├── Events: 2-3 major events per season
└── Limited items: Season-exclusive artifacts, themes

PERSISTENT:
├── All progression (levels, mastery, buildings)
├── All equipment
├── Achievement progress
├── Unlocked content
└── Nothing "lost" between seasons

SEASONAL REWARDS:
├── Top 100 Arena: Exclusive title + artifact
├── Top 1000 Crafting: Unique theme unlock
├── Season completion: Border, profile flair
└── Creates ongoing goals for veterans
```

---

*Document Version: 1.7*
*Last Updated: December 2025*
*Author: Game Design Team*

**v1.7 Changes:**
- Added **Hard Gating: Building Requirements** section
  - Buildings now GATE access to features (not just bonuses)
  - Mapped all existing processors to required buildings
  - Defined level requirements for each feature tier
  - Added processor modification code snippets
  - New error codes for building requirements
  - Helper function `require_building()` for validation
- Key gates:
  - Mansion → Daily rewards (`claim_daily_reward.rs`)
  - Barracks → Unit hiring (`hire_units.rs`)
  - Workshop → Material collection (`collect_resources.rs`)
  - Vault → Cash transfers (`transfer_cash.rs`)
  - Market → All purchases (`purchase_*.rs`)
  - Academy → Research (`research/*.rs`)
  - Arena → PvP combat (`attack_player.rs`)
  - Sanctuary → Hero management (`hero/*.rs`)
  - Citadel → Rally system (`rally/*.rs`)
  - Treasury → Prize claiming (`claim_prize.rs`)

**v1.6 Changes:**
- Mansion → **Login Streak Claim** ("Welcome Home")
  - Just visit and claim - no mini-game required
  - Streak multipliers: 1.0x → 3.0x over 90 days
  - Milestone rewards: NOVI + materials + titles
  - Miss a day = reset to 0, no exceptions
- Market → **Deal Finder** (replaces Price Prophet predictions)
  - Speed selection game (identify good deals vs traps)
  - Same-day shop discount rewards (no predictions)
- Removed all prediction systems (not good)
- State structure simplified (no prediction fields)

**v1.5 Changes:**
- Replaced boring daily claim with **Building Mini-Games**
  - 12 unique mini-games, one per building
  - Time windows: Dawn/Midday/Dusk (flexible based on player's first activity)
  - Game server co-signs transactions (require_signer pattern)
  - Streak system with milestones and multipliers
- Removed Vault interest (replaced with Security Inspection game)
- Removed Trading System section (TBD)
- Simplified signer verification (no Ed25519, just require_signer)

**v1.4 Changes:**
- Added **Challenges & Mitigations** section addressing:
  - Craft failure protection (Blessing, Insurance, Pity system)
  - Material acquisition sources (daily/weekly/legendary faucets)
  - New player catch-up system (accelerated XP, mentor system)
  - PvP matchmaking brackets (gear-based)
  - Account optimization strategy (consolidation targets)
  - Seasonal content framework

**v1.3 Changes:**
- Extended Divine progression to **12-18 months** for F2P, 6-8 months for whales
- Added Forge Mastery XP gating system (Lv.100 required for Divine tier)
- Increased craft times significantly (Divine = 7 days)
- Updated material requirements (Divine = 5,000 legendary + 1,000 fragments + 100 gems)
- **Themes are now purely cosmetic** (off-chain only, no gameplay effects)
- Massively expanded Sanctuary section with:
  - Meditation system with tiers and XP calculations
  - Synergy Chamber with discovery system
  - Fragment Altar with conversion mechanics
  - Awakening Ritual system (max 5 awakened heroes)
  - Artifact Vault with rarity system
  - Sanctuary Mastery progression
- Removed ForgeTheme/EstateTheme enums (cosmetic = off-chain)

**v1.2 Changes:**
- Expanded quality system from 4 to 8 tiers (Common → Divine)
- Added Golden Ratio mathematics for cost/buff scaling (φ and φ²)
- Added crafting failure system with item downgrade
- Added gem speedup system with tier multipliers
- Replaced Shrine with Sanctuary (hero management)
- **Removed maintenance/upkeep** - buildings are permanent investments
- Updated Total Sink Analysis for activity-based economy

**v1.1 Changes:**
- Added Key Integration Decisions section
- Defined hybrid buff stacking (additive within category, multiplicative between)
- Added CraftedEquipment PDA for tracking equipment quality
- Updated events to free entry with criteria-based access
- Added subscription tier benefits for buildings
- Updated Arena to criteria-based access (no entry fees)
