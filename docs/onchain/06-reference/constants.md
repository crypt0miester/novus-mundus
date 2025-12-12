# Constants Reference

> Key constants that define game balance and mechanics in Novus Mundus.

## Mathematical Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `PHI_NUMER` | 1,618,034 | Golden ratio numerator |
| `PHI_DENOM` | 1,000,000 | Golden ratio denominator |
| `SQRT_PHI_NUMER` | 1,272,019 | √φ numerator |
| `SQRT_PHI_DENOM` | 1,000,000 | √φ denominator |
| `BPS_BASE` | 10,000 | Basis points base |

[Source: constants.rs](../../../programs/novus_mundus/src/constants.rs)

---

## Time Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `SECONDS_PER_MINUTE` | 60 | — |
| `SECONDS_PER_HOUR` | 3,600 | — |
| `SECONDS_PER_DAY` | 86,400 | — |
| `COLLECTION_COOLDOWN` | 7,200 | Resource collection (2h) |
| `TRAVEL_BASE_SECONDS_PER_KM` | 18 | ~200 km/h |
| `COMBAT_COOLDOWN` | 3,600 | Same target (1h) |

---

## Expedition Constants

### Mining

| Constant | Values | Description |
|----------|--------|-------------|
| `MINING_DURATION_HOURS` | [1, 2, 4, 8, 16] | By tier |
| `MINING_GEMS_PER_OP_HOUR` | [10, 18, 30, 50, 80] | By tier |
| `MINING_WORKSHOP_REQ` | [1, 5, 10, 15, 20] | Workshop level by tier |
| `MINING_NOVI_COST` | [5k, 10k, 15k, 20k, 30k] | NOVI cost by tier |
| `MINING_RARE_CHANCE_BPS` | [200, 300, 400, 500, 700] | Rare find chance |
| `MINING_FRAGMENT_BONUS` | [5, 10, 20, 35, 50] | Fragment per operation |

### Fishing

| Constant | Values | Description |
|----------|--------|-------------|
| `FISHING_DURATION_HOURS` | [1, 2, 4, 8, 16] | By tier |
| `FISHING_PRODUCE_PER_OP_HOUR` | [15, 25, 40, 60, 100] | By tier |
| `FISHING_DOCK_REQ` | [1, 5, 10, 15, 20] | Dock level by tier |
| `FISHING_NOVI_COST` | [5k, 10k, 15k, 20k, 30k] | NOVI cost by tier |

### Operative Multipliers

| Constant | Value | Description |
|----------|-------|-------------|
| `OPERATIVE_TIER_1_MULTIPLIER_BPS` | 10,000 | 1.0x |
| `OPERATIVE_TIER_2_MULTIPLIER_BPS` | 15,000 | 1.5x |
| `OPERATIVE_TIER_3_MULTIPLIER_BPS` | 20,000 | 2.0x |

### Other

| Constant | Value | Description |
|----------|-------|-------------|
| `EXPEDITION_MINING` | 1 | Mining type ID |
| `EXPEDITION_FISHING` | 2 | Fishing type ID |
| `EXPEDITION_MAX_TIER` | 4 | Maximum tier (0-4) |
| `RARE_FIND_MULTIPLIER` | 5 | 5x yield on rare |
| `PERFECT_SCORE_THRESHOLD` | 90 | Score for perfect bonus |
| `PERFECT_EXPEDITION_BONUS_BPS` | 1,500 | +15% for perfect |

---

## Combat Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `BASE_CRIT_CHANCE_BPS` | 500 | 5% base crit |
| `CRIT_DAMAGE_MULTIPLIER_BPS` | 15,000 | 1.5x crit damage |
| `MAX_LOOT_PERCENTAGE` | 5,000 | 50% max loot |
| `BASE_LOOT_PERCENTAGE` | 2,500 | 25% base loot |
| `ENCOUNTER_ATTACK_RANGE_METERS` | 100 | PvE range |

### Unit Stats

| Unit | Attack | Defense | HP |
|------|--------|---------|-----|
| T1 Operative | 10 | 5 | 100 |
| T2 Operative | 25 | 15 | 150 |
| T3 Operative | 50 | 30 | 200 |

---

## Building Constants

### Base Costs (NOVI)

| Building | Base Cost | Per-Level Multiplier |
|----------|-----------|---------------------|
| Mansion | 1,000 | φ |
| Barracks | 2,000 | φ |
| Workshop | 3,000 | φ |
| Sanctuary | 5,000 | φ |
| Academy | 5,000 | φ |
| Forge | 8,000 | φ |
| Citadel | 10,000 | φ |

### Construction Time (base seconds)

| Building | Base Time | Max Time (Lv20) |
|----------|-----------|-----------------|
| Mansion | 300 | ~28 hours |
| Workshop | 600 | ~56 hours |
| Academy | 900 | ~84 hours |
| Citadel | 1,800 | ~168 hours |

### Bonus Base Values (BPS)

| Building | Bonus Type | Base |
|----------|------------|------|
| Academy | Research Speed | 100 |
| Arena | PvP Damage | 100 |
| Observatory | Loot Bonus | 100 |
| Treasury | Prize Bonus | 100 |
| Citadel | Rally Damage | 100 |
| Market | Discount | 50 |
| Vault | NOVI Cap | 500 |

---

## Hero Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_HERO_LEVEL` | 100 | Maximum hero level |
| `MAX_LOCKED_HEROES` | 5 | Maximum active heroes |
| `MAX_DEFENSIVE_HEROES` | 2 | Maximum defensive slots |
| `HERO_BUFF_SLOTS` | 4 | Buffs per hero |
| `BASE_MEDITATION_XP` | 100 | XP for level 1 |

### Hero Tier Thresholds (SOL mint cost)

| Tier | Min Cost | Max Cost |
|------|----------|----------|
| Common | 0 | 0.1 |
| Uncommon | 0.1 | 0.5 |
| Rare | 0.5 | 2.0 |
| Epic | 2.0 | 10.0 |
| Legendary | 10.0+ | — |

### Location Bonus

| Tier | Origin Bonus |
|------|--------------|
| Common | 100 bps (1%) |
| Uncommon | 300 bps (3%) |
| Rare | 500 bps (5%) |
| Epic | 700 bps (7%) |
| Legendary | 1,000 bps (10%) |

---

## Research Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_ASCENSION_LEVEL` | 10 | Max prestige tier |
| `RESEARCH_CATEGORIES` | 5 | Number of categories |
| `MAX_RESEARCH_PER_CATEGORY` | 50 | Researches per category |

### Category Time (base hours)

| Category | Base Time |
|----------|-----------|
| Basic | 1 |
| Intermediate | 4 |
| Advanced | 12 |
| Expert | 24 |
| Master | 48 |

### Category Cost (base NOVI)

| Category | Base Cost |
|----------|-----------|
| Basic | 1,000 |
| Intermediate | 5,000 |
| Advanced | 20,000 |
| Expert | 50,000 |
| Master | 100,000 |

---

## Rally Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_RALLY_PARTICIPANTS` | 10 | Players per rally |
| `MIN_RALLY_EXECUTE_DELAY` | 3,600 | 1 hour minimum |
| `MAX_RALLY_EXECUTE_DELAY` | 86,400 | 24 hour maximum |
| `RALLY_RETURN_TIME_MULTIPLIER` | 10,000 | Same as march |

---

## Team Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_TEAM_MEMBERS` | 50 | Members per team |
| `TEAM_NAME_MAX_LENGTH` | 32 | Name character limit |
| `TEAM_CREATION_COST` | 10,000 | NOVI to create |

---

## Shop Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_PURCHASE_PER_ITEM` | 100 | Daily purchase limit |
| `FLASH_SALE_DURATION` | 3,600 | 1 hour sales |
| `DAILY_DEAL_ROTATION` | 86,400 | 24 hour rotation |

---

## Subscription Tiers

| Tier | Duration | Benefits |
|------|----------|----------|
| 0 (Free) | — | Base game |
| 1 (Basic) | 30 days | +10% yields |
| 2 (Premium) | 30 days | +25% yields, +5 plots |
| 3 (VIP) | 30 days | +50% yields, +10 plots |

---

## Speedup Constants

| System | Cost per Minute | Notes |
|--------|-----------------|-------|
| Expedition | 100 gems | Tier multiplier applies |
| Research | 50 gems | — |
| Rally | 75 gems | — |
| Reinforcement | 75 gems | — |

---

## Limit Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_BUILDING_LEVEL` | 20 | Building level cap |
| `MAX_PLOTS` | 20 | Maximum land plots |
| `MAX_DAILY_STREAK` | 365 | Streak tracking |
| `MAX_OPERATIVES` | 1,000,000 | Unit storage cap |
| `MAX_EQUIPMENT` | 100,000 | Equipment cap |

---

*Constants are the DNA of game balance. Change them carefully, as ripples spread far.*

---

Next: [Seeds](./seeds.md)
