# Novus Mundus: Game Design Document

> **Deterministic strategy MMO with golden ratio progression, dual-token economy, and zero gambling mechanics**

---

## Core Philosophy

### No Randomness. No Gambling. Pure Strategy.

Novus Mundus eliminates all random number generation from gameplay. Every mechanic uses the **golden ratio family** for predictable, skill-based outcomes:

| Constant | Value | Usage |
|----------|-------|-------|
| **φ (phi)** | 1.618 | Strong bonuses, tier multipliers |
| **√φ (golden root)** | 1.272 | Base progression per level |
| **φ²** | 2.618 | Legendary tier, major milestones |
| **1/φ** | 0.618 | Penalties, diminishing returns |
| **1/φ²** | 0.382 | Strong penalties |
| **1/φ³** | 0.236 | Extreme penalties |
| **Golden Angle** | 137.5° | Spawn positioning |

**Players know exactly what they'll get. Investment → predictable returns.**

---

## Table of Contents

1. [Account System](#account-system)
2. [Unit System](#unit-system)
3. [Combat System](#combat-system)
4. [Time-of-Day Cycle](#time-of-day-cycle)
5. [Encounter System (PvE)](#encounter-system-pve)
6. [Research System](#research-system)
7. [Hero System](#hero-system)
8. [City System](#city-system)
9. [Team System](#team-system)
10. [Rally System](#rally-system)
11. [Event System](#event-system)
12. [Shop System](#shop-system)
13. [Progression System](#progression-system)
14. [Theme System](#theme-system)

---

## Account System

### Dual-Account Architecture

Players have **two separate on-chain accounts**:

| Account | Token Type | Withdrawable? | Purpose |
|---------|------------|---------------|---------|
| **PlayerAccount** | Locked NOVI | No | Gameplay fuel, units, resources |
| **UserAccount** | Reserved NOVI | Yes (after vesting) | Earnings from events |

**Locked NOVI**:
- Generated via subscription tiers
- Used for all gameplay actions
- **BURNED** on consumption (permanently destroyed)
- Cannot be withdrawn - this is "gameplay fuel"

**Reserved NOVI**:
- Earned from events and competitions
- 7-day vesting period before withdrawal
- Withdrawable to wallet as real tokens

### Subscription Tiers

| Tier | Generation Rate | Max Locked NOVI | Max Stamina | Team Size |
|------|-----------------|-----------------|-------------|-----------|
| **Rookie** (Free) | 1 NOVI/5min | 3,000 | 100 | 5 |
| **Expert** | 2 NOVI/5min | 6,000 | 500 | 10 |
| **Epic** | 10 NOVI/5min | 30,000 | 1,000 | 25 |
| **Legendary** | 50 NOVI/5min | 150,000 | 10,000 | 50 |

---

## Unit System

### Unit Role Separation

Units are **strictly separated** by function for strategic depth:

```
┌─────────────────────────────────────────────────────────────────┐
│                    UNIT ROLE MATRIX                              │
├─────────────────────────────────────────────────────────────────┤
│  UNIT TYPE          │ ATTACK │ DEFEND │ ECONOMY │ TIER WEIGHT  │
│  ───────────────────┼────────┼────────┼─────────┼─────────────  │
│  Defensive Unit 1   │   ✅   │   ✅   │    ❌   │      1       │
│  Defensive Unit 2   │   ✅   │   ✅   │    ❌   │      2       │
│  Defensive Unit 3   │   ✅   │   ✅   │    ❌   │      3       │
│  ───────────────────┼────────┼────────┼─────────┼─────────────  │
│  Operative Unit 1   │   ❌   │   ❌   │    ✅   │     N/A      │
│  Operative Unit 2   │   ❌   │   ❌   │    ✅   │     N/A      │
│  Operative Unit 3   │   ❌   │   ❌   │    ✅   │     N/A      │
└─────────────────────────────────────────────────────────────────┘
```

**Strategic Implications**:
- All defensive units = strong military, weak economy
- All operative units = strong economy, vulnerable to attacks
- Optimal play requires **strategic unit composition**

### Happiness System (Deterministic)

Unit morale affects abandonment rates using **config-based rates** (no randomness):

| Happiness Level | Abandonment Rate | Requirements |
|-----------------|------------------|--------------|
| 75-100% (Happy) | Config: `abandon_rate_happy` | Good weapon + produce coverage |
| 50-75% (Content) | Config: `abandon_rate_content` | Moderate coverage |
| 25-50% (Unhappy) | Config: `abandon_rate_unhappy` | Poor coverage |
| 0-25% (Miserable) | Config: `abandon_rate_miserable` | Very poor coverage |

**Formula**:
```
abandonment = (total_units × rate_bps) / 10000
```

No dice rolls - exact calculation every time.

---

## Combat System

### Attack Power Formula (Deterministic)

```
base_power = Σ(defensive_unit_i × tier_weight_i)
weapon_coverage = min(weapons / total_defensive_units, 1.0)

total_bonus = 10000 (base)
            + research_attack_bps
            + hero_attack_bps
            + (level / 10) × 100  // +1% per 10 levels

total_power = base_power × weapon_coverage × total_bonus / 10000
```

### Critical Hits (Skill-Based, Not Random)

Critical hits are **threshold-based**:
- If `research_crit_chance_bps >= 5000` (50%): **Guaranteed crit**
- This is research investment, not luck!

### Drive-By Attacks

- Requires 10,000+ units and vehicles
- Base bonus: **√φ (1.272x)** from config
- Night bonus stacks: up to **φ (1.618x)** total

### Deployment System

Players choose how many units to send:

| Factor | Deployment Bonus |
|--------|-----------------|
| Base | 30% |
| Research | +0-20% |
| Level | +1% per 5 levels (up to +20%) |
| Subscription | +0-10% by tier |
| **Max Normal** | **80%** |
| **Elite Mode (Lv50+)** | **90%** |

**Risk**: Deployed units leave your base undefended.

### Reinforcement System

Team members can send units to defend each other:
- Sender must have "Military Logistics" research
- +20% effectiveness if hero is sent with units
- Sender's garrison is reduced while reinforcing

---

## Time-of-Day Cycle

### Location-Aware Day/Night

The game uses real longitude to calculate local time:

```
┌──────────────────────────────────────────────────────────────┐
│                    24-HOUR CYCLE                              │
├──────────────────────────────────────────────────────────────┤
│ [DEEP NIGHT] [DAWN ★] [MORNING] [MIDDAY] [AFTERNOON] [DUSK ★] [EVENING] │
│   00-03       03-06    06-09    09-15     15-18      18-21    21-24     │
│                                                               │
│ ★ = Golden Hours (φ² bonuses for collection & rare spawns)  │
└──────────────────────────────────────────────────────────────┘
```

### Activity Multipliers (Golden Ratio Based)

| Activity | Deep Night | Dawn | Midday | Dusk | Evening |
|----------|------------|------|--------|------|---------|
| **Attacking** | **φ (1.618x)** | √φ | 1.0x | 1.0x | 1.0x |
| **Defending** | 1/φ (0.618x) | 1.0x | **φ (1.618x)** | 1.0x | 1.0x |
| **Hiring** | 1/φ | 1.0x | **φ** | 1.0x | 1/φ |
| **Collecting** | 1/φ | 1.0x | 1.0x | 1.0x | 1/φ |
| **Mining** | **φ** | 1.0x | 1.0x | 1.0x | 1.0x |
| **Fishing** | 1.0x | **φ** | 1.0x | 1.0x | 1.0x |
| **Travel Speed** | **φ** | √φ | 1/φ | 1.0x | 1.0x |
| **Research** | **φ** | √φ | 1/φ | 1.0x | 1.0x |
| **Stamina Regen** | **φ** | √φ | 1/φ | 1.0x | 1.0x |
| **Loot Quality** | √φ | 1.0x | 1.0x | 1.0x | √φ |

---

## Encounter System (PvE)

### Encounter Tiers

| Rarity | Base Health | Despawn | Max Attackers | Stamina Cost |
|--------|-------------|---------|---------------|--------------|
| **Common** | 1,000 | 1 hour | 2 | 10 |
| **Uncommon** | 5,000 | 2 hours | 3 | 25 |
| **Rare** | 25,000 | 4 hours | 4 | 50 |
| **Epic** | 100,000 | 12 hours | 6 | 100 |
| **Legendary** | 500,000 | 24 hours | 10 | 250 |
| **WorldEvent** | 5,000,000 | 7 days | 20 | 500 |

### Spawn Timing (Deterministic by Rarity)

| Rarity | Best Spawn Time | Multiplier |
|--------|-----------------|------------|
| Common | Midday | √φ |
| Uncommon | Morning/Afternoon | φ |
| **Rare** | **Dawn/Dusk (Golden Hours)** | **φ²** |
| Epic | Deep Night | φ |
| **Legendary** | **Deep Night Only** | **φ²** |

Legendary encounters **cannot spawn during day** (φ³ inverse penalty).

### Spawn Positioning

Uses **golden spiral** for even distribution:
```
angle = spawn_index × GOLDEN_ANGLE (137.5°)
radius = √(spawn_index) × max_radius
position = (center + offset)
```

### Reward Calculation (Deterministic)

Rewards use **level thresholds** (no random drops):

| Player Level | Reward Types |
|--------------|--------------|
| 1-5 | Cash only |
| 6-15 | Cash + Produce |
| 16-30 | Cash + Produce + Weapons |
| 31-50 | + Vehicles |
| 51+ | All types |

**Fragment/Gem Drops** (Research-based):
- Fragments: Level 16+ with Uncommon+ OR research unlock
- Gems: Level 21+ with Uncommon+ AND research unlock

**Amount Scaling**:
```
base × (√φ)^(level/10) × luck_bonus × time_multiplier
```

---

## Research System

### Research Tree (30 Nodes)

**Battle Research (0-9)**:
| Node | Effect | Max Level |
|------|--------|-----------|
| Attack Power | +attack_bps | 25 |
| Defense Power | +defense_bps | 25 |
| Unit Capacity | +capacity | 20 |
| Critical Hit Chance | +crit_chance_bps | 15 |
| Critical Hit Damage | +crit_damage_bps | 15 |
| Rally Capacity | +rally_size | 10 |
| Encounter Success | +success_bps | 20 |
| Loot Bonus | +loot_bps | 20 |
| Training Speed | -training_time | 15 |
| Ambush Damage | +ambush_bps | 10 |

**Economy Research (10-19)**:
| Node | Effect | Max Level |
|------|--------|-----------|
| Production Efficiency | +efficiency_bps | 20 |
| Resource Capacity | +storage | 20 |
| Market Tax Reduction | -tax_bps | 15 |
| Trade Speed | +speed_bps | 15 |
| Mining Output | +mining_bps | 20 |
| Cash Generation | +cash_bps | 25 |
| Construction Speed | +build_speed | 15 |
| Upkeep Reduction | -upkeep_bps | 15 |
| Black Market Access | unlock | 5 |
| Tax Collection | +collection_bps | 20 |

**Growth Research (20-29)**:
| Node | Effect | Unlock |
|------|--------|--------|
| Daily Rewards System | unlock | **has_daily_rewards** |
| Mining Operations | unlock | **has_mining** |
| Fishing Industry | unlock | **has_fishing** |
| Loot Magnetism | +loot_chance_bps | - |
| Reputation Mastery | +rep_bonus_bps | - |
| Stamina Vitality | +stamina_bps | - |
| Lucky Streak | +luck_bonus_bps | - |
| Fragment Discovery | unlock | **has_fragment_drops** |
| Gem Prospecting | unlock | **has_gem_drops** |
| Collection Mastery | +collection_bps | - |

### Research Cost Scaling

```
NOVI_cost = base_cost × 1.8^level
Time = base_time × 1.5^level
```

Speed-up: Gems per minute (scales with level tier).

---

## Hero System

### Hero NFTs with Deterministic Scaling

Heroes are NFTs that provide buffs scaling with **golden root**:

```
buff_value = base_bps × (√φ)^level
```

| Level | Multiplier | Example (100 base) |
|-------|------------|-------------------|
| 1 | 1.272x | 127 |
| 2 | 1.618x | 162 |
| 4 | 2.618x | 262 |
| 10 | 10.86x | 1,086 |
| 20 | 118x | 11,800 |

### Hero Types

| Type | Primary Buffs |
|------|---------------|
| **Offensive** | Attack, Crit Chance, Encounter Damage |
| **Defensive** | Defense, Unit Capacity, Rally Capacity |
| **Economic** | Cash Collection, Produce Generation, Loot Bonus |
| **Hybrid** | Balanced mix |

### Hero Categories

- Historical (Alexander, Caesar, etc.)
- Mythological (Thor, Athena, etc.)
- Crypto Icons (Satoshi, Vitalik, etc.)
- Gaming (Original characters)
- Original (Game-specific)

### Leveling Cost

```
fragment_cost = 10 × 1.5^current_level
```

### Active Heroes

- Lock up to **3 heroes** to PlayerAccount
- Designate one for **defense** (buffs defense power)
- Send heroes with **reinforcements** (+20% effectiveness)

### Power Weighting

Different buffs weighted by strategic value:

| Tier | Weight | Buff Types |
|------|--------|------------|
| 1 (Combat) | 100% | Attack, Defense, Encounter Damage |
| 2 (Strategic) | 75% | Crit Chance, Rally Capacity |
| 3 (Economic) | 60% | Cash, Produce, Loot |
| 4 (Progression) | 45% | XP, Training Cost |
| 5 (Utility) | 30% | Capacity, Stamina, Luck |

---

## City System

### 50 World Cities

Cities are organized by type with different bonuses:

| City Type | Bonus | Example Cities |
|-----------|-------|----------------|
| **Capital** | Balanced (1.0x all) | New York, London, Tokyo, Paris |
| **Resource** | Collection √φ (1.272x) | Miami, Rome, Auckland |
| **Combat** | Attack/Defense √φ (1.272x) | Chicago, Berlin, Seoul |
| **Trade** | Economy φ (1.618x) | Singapore, Hong Kong, Dubai |

### City Distribution

- **North America**: 10 cities
- **South America**: 5 cities
- **Europe**: 10 cities
- **Africa**: 5 cities
- **Middle East**: 3 cities
- **Asia (East)**: 7 cities
- **Asia (South/SE)**: 6 cities
- **Oceania**: 3 cities
- **Neo Cities**: 1 city (fictional)

### Encounter Scaling

```
encounters_per_city = BASE_ENCOUNTERS + (players_present / 10)
```

Capped at 50 encounters per city.

### Travel

**Intracity** (within city): Fast (~1-5 min)
**Intercity** (between cities): Slow (~10 min - 2 hours)

**Teleport Cost**:
```
cost = segments × base_cost
segments = ceil(distance_km / 100)
```

---

## Team System

### Team Structure

| Tier | Max Members |
|------|-------------|
| Rookie | 5 |
| Expert | 10 |
| Epic | 25 |
| Legendary | 50 |

### Team Benefits

- **Reinforcement sending/receiving**
- **Rally participation**
- **Team leaderboards**
- **Treasury for shared resources**
- **Transfer between teammates**

### Team Stats (Aggregate)

- `total_attacks_won`
- `total_defenses_won`
- `total_rallies_won`
- `total_encounters_cleared`
- `total_novi_earned`
- `total_level` (for average)

### Invite System

1. Leader/Officer sends invite
2. Invite valid for 7 days
3. Player accepts invite
4. Player joins team

---

## Rally System

### Overview

Rallies are coordinated multi-player attacks against powerful targets.

### Rally Caps by Tier

| Tier | Max Joined | Max Created/Day | Max Participants |
|------|-----------|-----------------|------------------|
| Rookie | 1 | 1 | 3 |
| Expert | 3 | 3 | 5 |
| Epic | 5 | 5 | 10 |
| Legendary | 10 | 10 | 20 |

### Rally Lifecycle

```
CREATE → RECRUITING → EXECUTING → COMPLETED/FAILED
```

### Loot Distribution

```
participant_share = damage_contribution / total_damage
participant_loot = total_loot × participant_share
```

---

## Event System

### Event Types

| Type | Duration | Account Age | Prize Range |
|------|----------|-------------|-------------|
| Daily | 24 hours | 7+ days | 5K-50K NOVI |
| Weekly | 7 days | 30+ days | 60K-500K NOVI |
| Seasonal | 30 days | 60+ days | 1M+ NOVI |
| World | Variable | Variable | 250K+ NOVI |

### Scoring Types

| Event Type | Method |
|------------|--------|
| TotalDamageDealt | Accumulative |
| MostAttacksWonPvP | Accumulative |
| MostAttacksWonPvE | Accumulative |
| HighestCash | Snapshot (max) |
| MostXPGained | Accumulative |
| MostEncountersDefeated | Accumulative |
| MostResourcesCollected | Accumulative |
| MostNoviConsumed | Accumulative |

### Prize Distribution (Top 10)

| Rank | Share |
|------|-------|
| 1 | 40% |
| 2 | 20% |
| 3 | 13% |
| 4 | 9% |
| 5 | 6% |
| 6 | 4% |
| 7 | 3% |
| 8 | 2% |
| 9 | 2% |
| 10 | 1% |

---

## Shop System

### Multi-Layered Discount System

**Layer 1: Base Discounts** (up to 60%)
- Flash Sales, Daily Deals, Weekly/Seasonal Sales

**Layer 2: Bundle Savings** (up to 35%)
- Starter: 10%, Combat: 15%, Crafter: 20%, Explorer: 25%, Supreme: 35%

**Layer 3: Fibonacci Bonus** (up to 20%)
- Spending Fibonacci amounts grants efficiency bonus

**Combined Cap**: 75% maximum discount

### Milestone Loyalty

| Milestone | Spend Threshold | Permanent Discount |
|-----------|-----------------|-------------------|
| Bronze | Config | 2% |
| Silver | Config | 4% |
| Gold | Config | 6% |
| Platinum | Config | 8% |
| Diamond | Config | 10% |

### Sale Types

| Type | Duration | Discount Range |
|------|----------|----------------|
| **Flash Sale** | Minutes-Hours | Up to 50% |
| **Daily Deal** | 24 hours | 15-40% |
| **Weekly Sale** | 7 days | Theme-based |
| **Seasonal Sale** | Event-tied | Featured items |
| **DAO Promotion** | Community-voted | Budget-capped |

### Payment Methods

- **SOL** (lamports)
- **NOVI** (burned)
- **Gems** (premium currency)

---

## Progression System

### Level System

**XP Sources**:
- Attack players: 10-50 XP
- Attack encounters: 20-100 XP
- Collect resources: 5 XP
- Rally participation: 50 XP
- Event wins: 100-500 XP

**XP Formula**:
```
xp_for_level = 1000 × level²
```

### Level Benefits

| Level | Unlock |
|-------|--------|
| 5 | Epic encounters |
| 10 | Legendary encounters |
| 15 | +5% attack bonus |
| 20 | WorldEvent encounters |
| 25 | +10% collection efficiency |
| 50 | Elite deployment (90%) |

### Reputation

| Rank | Threshold |
|------|-----------|
| Novice | 0-999 |
| Skilled | 1,000-4,999 |
| Veteran | 5,000-19,999 |
| Elite | 20,000-99,999 |
| Legendary | 100,000+ |

---

## Theme System

### Supported Themes

All mechanics are **theme-agnostic**. Visual themes include:

1. **Medieval** (Launch theme)
2. **Cyberpunk 2099**
3. **Sci-Fi**
4. **Modern Era**
5. **Post-Apocalyptic**

### Theme Mappings

| Mechanic | Medieval | Cyberpunk | Modern |
|----------|----------|-----------|--------|
| Defensive Unit 1 | Knights | Security Drones | SWAT Team |
| Defensive Unit 2 | Archers | Netrunners | National Guard |
| Defensive Unit 3 | Footmen | Street Samurai | Private Security |
| Operative Unit 1 | Miners | Data Miners | Miners |
| Operative Unit 2 | Merchants | Corporate Traders | Corporate Traders |
| Operative Unit 3 | Farmers | Factory Workers | Construction Workers |
| Weapons | Swords & Bows | Neural Implants | Firearms |
| Produce | Food & Grain | Energy Cells | Food & Supplies |
| Vehicles | Horses & Carts | Hovercars | Armored Trucks |
| Cash | Gold Coins | CredChips | US Dollars |

### Encounter Themes

| Rarity | Medieval | Cyberpunk | Modern |
|--------|----------|-----------|--------|
| Common | Goblin Raider | Rogue Bot | Street Gang |
| Uncommon | Troll Warlord | Rogue AI Node | Mercenary Squad |
| Rare | Wyvern | Cyberdemon | Terrorist Cell |
| Epic | Dragon | AI Overseer | Crime Syndicate |
| Legendary | Ancient Wyrm | AI Overlord | International Cartel |
| WorldEvent | Elder Dragon | Singularity | Global Threat |

---

## Anti-Bot Economics

### Transfer Restrictions

- Same team only
- Both accounts 7+ days old
- Max 500M per day
- Tracked: `total_sent` and `total_received`

### Event Eligibility

| Event Value | Min Age | Transfer Ratio Limit |
|-------------|---------|---------------------|
| <25K NOVI | 7 days | 10:1 (received:sent) |
| 25K-100K | 30 days | 3:1 |
| 100K+ | 60 days | 2:1 |

### Why Botting Fails

1. **Passive farming** → Generates locked NOVI only (can't withdraw)
2. **Consolidation** → High `total_received` → Fails event eligibility
3. **Legitimate play** → Balanced transfers → Wins Reserved NOVI

---

## Summary

Novus Mundus delivers:

- **Deterministic Progression**: Golden ratio math, no gambling
- **Strategic Depth**: Unit composition, timing, deployment decisions
- **Skill Expression**: Research investment determines outcomes, not luck
- **Fair Competition**: Anti-bot measures, skill-based events
- **Flexible Themes**: Same mechanics, multiple visual styles
- **Sustainable Economy**: Dual token system with clear value flows

**All without a single random number.**
