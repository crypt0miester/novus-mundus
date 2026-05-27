# Novus Mundus: Game Design Document

**Multi-kingdom strategy MMO with golden-ratio progression, dual-token economy, and deterministic core mechanics**

---

## Core Philosophy

### Deterministic Math, Co-signed Skill Moments

Novus Mundus' core systems are deterministic — every multiplier comes from the **golden ratio family** of constants:

| Constant | Value | Source | Usage |
|---|---|---|---|
| **φ (phi)** | 1.6180339887498948 | `constants.rs::PHI` | Strong bonuses, tier multipliers |
| **√φ (golden root)** | 1.2720196495140689 | `constants.rs::GOLDEN_ROOT` | Per-level progression |
| **φ²** | 2.6180339887498948 | `constants.rs::PHI_SQUARED` | Legendary milestones, major bonuses |
| **1/φ** | 0.6180339887498949 | `constants.rs::PHI_INVERSE` | Penalties, diminishing returns |
| **1/φ²** | 0.3819660112501051 | `constants.rs::PHI_SQUARED_INVERSE` | Strong penalties |
| **1/φ³** | 0.2360679774997897 | `constants.rs::PHI_CUBED_INVERSE` | Extreme penalties |
| **Golden Angle** | 137.5077640500° | Computed | Spawn positioning |

A handful of moments have a skill/randomness component:

- **Dungeon attacks** — crit and double-strike chance
- **Forge precision** — strike timing within a window
- **Expedition strikes** — score per strike
- **Estate daily activity** — mini-game score (`game_authority` co-signed)

Production design intent is that these moments are off-chain-verified and co-signed by the trusted `game_authority`, not on-chain RNG.

---

## Table of Contents

1. [Account System](#account-system)
2. [Unit System](#unit-system)
3. [Combat System](#combat-system)
4. [Time-of-Day Cycle](#time-of-day-cycle)
5. [Encounter System (PvE)](#encounter-system-pve)
6. [Dungeon System](#dungeon-system)
7. [Arena System (PvP)](#arena-system-pvp)
8. [Castle System (Territory)](#castle-system-territory)
9. [Estate System (Personal)](#estate-system-personal)
10. [Forge System (Crafting)](#forge-system-crafting)
11. [Expedition System (Mining/Fishing/Farming)](#expedition-system-mining-fishing-farming)
12. [Research System](#research-system)
13. [Hero System (MPL Core NFTs)](#hero-system-mpl-core-nfts)
14. [City System](#city-system)
15. [Team System](#team-system)
16. [Rally System](#rally-system)
17. [Reinforcement System](#reinforcement-system)
18. [Sanctuary (Hero Meditation)](#sanctuary-hero-meditation)
19. [Event System](#event-system)
20. [Shop System](#shop-system)
21. [Progression System](#progression-system)
22. [Multi-Kingdom & Theme System](#multi-kingdom--theme-system)
23. [Anti-Bot Economics](#anti-bot-economics)

---

## Account System

### Multi-Kingdom Layout

| Account | Per | Kingdom-scoped? |
|---|---|---|
| `GameEngine` | kingdom_id (0..N) | yes (the kingdom itself) |
| `UserAccount` | wallet | no — shared across kingdoms |
| `PlayerAccount` | (kingdom, wallet) | yes |
| `HeroTemplate` / `HeroMintReceipt` / `HeroCollection` | template / (player,template) / global | no — heroes are MPL Core NFTs, shared across kingdoms |
| `TeamAccount`, `CastleAccount`, `RallyAccount`, `EventAccount`, etc. | kingdom | yes |

### PlayerAccount (Locked NOVI + extension sections)

`PlayerAccount` is `PlayerCore` (1056 bytes, always present) plus up to 7 extension sections appended on demand. Total `MAX_SIZE = 1946` bytes.

Extension bitmask (`extensions: u32` in `PlayerCore`):

| Flag | Section | Size | Unlock |
|---|---|---|---|
| `EXT_RESEARCH = 0x0001` | ResearchSection | 96 | Buffs/unlocks from research |
| `EXT_HEROES   = 0x0002` | HeroesSection | 130 | Locking heroes |
| `EXT_INVENTORY= 0x0004` | InventorySection | 424 | Shop / consumables |
| `EXT_RALLY    = 0x0008` | RallySection | 80 | Joining/creating rallies |
| `EXT_TEAM     = 0x0010` | TeamSection | 40 | Team membership |
| `EXT_COSMETICS= 0x0020` | CosmeticsSection | 80 | Equipped cosmetics |
| `EXT_COURT    = 0x0040` | CourtSection | 48 | Castle court membership |

### UserAccount (Reserved NOVI)

Per-wallet. Stores:
- `reserved_novi` (withdrawable balance, vesting 7 days)
- `reserved_novi_earned_at`
- `total_reserved_earned`
- NOVI-purchase streak / daily tracking (`novi_purchase_streak`, `novi_last_purchase_day`, `novi_purchased_today`)

### Token buckets

| Bucket | Stored | Withdrawable? | Notes |
|---|---|---|---|
| Locked NOVI | `PlayerAccount.locked_novi` + token account owned by Player PDA | No | Gameplay fuel; some flows burn, some escrow |
| Reserved NOVI | `UserAccount.reserved_novi` + token account owned by User PDA | Yes after 7-day vesting | Earned from events, prizes, purchases |

### Subscription Tiers

Stored in `GameEngine.subscription_tiers[4]`. Each tier has: generation rate per 5 min, max locked NOVI cap, max stamina, team size cap, daily transfer caps, deployment bonus, plus optional Locked-NOVI generation multiplier.

Constants (defaults, configurable via DAO):

| Tier | Max stamina | Team size |
|---|---:|---:|
| Rookie (Free) | 100 | 5 |
| Expert | 500 | 10 |
| Epic | 1,000 | 25 |
| Legendary | 10,000 | 50 |

(See `MAX_STAMINA_BY_TIER` and `MAX_TEAM_MEMBERS_BY_TIER` in `constants.rs:36, 205-210`.)

---

## Unit System

Six unit slots, three defensive + three operative. Defensive units defend AND attack; operative units run economy.

```
┌───────────────────────────────────────────────────────────────────┐
│                      UNIT ROLE MATRIX                             │
├───────────────────────────────────────────────────────────────────┤
│  UNIT SLOT           │ ATTACK │ DEFEND │ ECONOMY │ POWER         │
│  ────────────────────┼────────┼────────┼─────────┼─────────────  │
│  defensive_unit_1    │   ✅   │   ✅   │    ❌   │  10           │
│  defensive_unit_2    │   ✅   │   ✅   │    ❌   │  25           │
│  defensive_unit_3    │   ✅   │   ✅   │    ❌   │  60           │
│  ────────────────────┼────────┼────────┼─────────┼─────────────  │
│  operative_unit_1    │   ❌   │   ❌   │    ✅   │  N/A          │
│  operative_unit_2    │   ❌   │   ❌   │    ✅   │  N/A          │
│  operative_unit_3    │   ❌   │   ❌   │    ✅   │  N/A          │
└───────────────────────────────────────────────────────────────────┘
```

Power constants: `DEFENSIVE_UNIT_*_POWER = [10, 25, 60]`.

### Happiness System

Happiness is calculated from weapon coverage + produce supply. Abandonment rates come from `GameplayConfig`:

| Happiness band | Rate (bps) source |
|---|---|
| 75-100% (Happy) | `abandon_rate_happy` |
| 50-75% (Content) | `abandon_rate_content` |
| 25-50% (Unhappy) | `abandon_rate_unhappy` |
| 0-25% (Miserable) | `abandon_rate_miserable` |

`abandonment = (units × rate_bps) / 10000`. Deterministic.

---

## Combat System

### Attack Power Formula (Deterministic)

```
base_power = Σ(defensive_unit_i × power_i)        // power_i = [10, 25, 60]
weapon_coverage = min(total_weapons / total_units, 1.0)
total_bonus_bps = 10000
                + research_attack_bps             // From completed research
                + hero_attack_bps                 // From locked heroes
                + level_bonus                     // +1% per 10 levels
total_power = base_power × weapon_coverage × total_bonus_bps / 10000
```

### Weapon Power (Arena and Castle Combat)

| Weapon | Power |
|---|---:|
| Melee | 10 |
| Ranged | 16 (φ ratio) |
| Siege | 26 (φ² ratio) |
| Armor | 5 |

Siege weapons are consumed during siege attacks (`DAMAGE_PER_SIEGE_WEAPON = 500` damage per siege weapon).

### Loot Rates (Combat)

| Constant | Value | Use |
|---|---|---|
| `WEAPON_LOOT_RATE_BPS` | 6000 (60%) | Weapons dropped from dead enemy troops |
| `ARMORY_RAID_WITH_OPERATIVES_BPS` | 2500 (25%) | Weapons raid when defender has only operatives |
| `ARMORY_RAID_UNDEFENDED_BPS` | 5000 (50%) | Undefended weapons raid |
| `SIEGE_CAPTURE_RATE_BPS` | 8000 (80%) | Intact siege from storage when defender fully defeated |

### Critical Hits

**PvP**: research-driven. `research_crit_chance_bps >= 5000` → guaranteed crit (50% threshold = 100% crit). No randomness; this is research investment.

**Dungeon**: intended to be flagged by the off-chain `game_authority` per attack.

### Drive-By Attacks

Require 10,000+ units AND vehicles. Base bonus: √φ (1.272×). Night bonus stacks up to φ (1.618×) total. Penalty: 25% damage taken.

### Deployment

Players choose how many units to send to an attack. Deployment percentage caps:

| Source | Bonus |
|---|---|
| Base | 30% |
| Research | +0-20% |
| Level | +1% per 5 levels (cap +20%) |
| Subscription | +0-10% by tier |
| **Max normal** | **80%** |
| **Elite mode (Lv 50+)** | **90%** |

Risk: deployed units leave your base undefended.

---

## Time-of-Day Cycle

Local hour is derived from `Clock::unix_timestamp + longitude/15`. Seven periods (see `logic/time_cycle.rs`):

```
┌──────────────────────────────────────────────────────────────────┐
│                       24-HOUR CYCLE                              │
├──────────────────────────────────────────────────────────────────┤
│ [DEEP NIGHT][DAWN★][MORNING][MIDDAY][AFTERNOON][DUSK★][EVENING]  │
│   00-03      03-06   06-09    09-15    15-18    18-21    21-24   │
│  ★ = Golden Hours (φ² bonuses for rare spawns & collection)      │
└──────────────────────────────────────────────────────────────────┘
```

### Activity Multipliers

| Activity | Deep Night | Dawn | Midday | Dusk | Evening |
|---|---|---|---|---|---|
| Attacking | **φ** | √φ | 1.0 | 1.0 | 1.0 |
| Defending | 1/φ | 1.0 | **φ** | 1.0 | 1.0 |
| Hiring | 1/φ | 1.0 | **φ** | 1.0 | 1/φ |
| Collecting | 1/φ | 1.0 | 1.0 | 1.0 | 1/φ |
| Mining | **φ** | 1.0 | 1.0 | 1.0 | 1.0 |
| Fishing | 1.0 | **φ** | 1.0 | 1.0 | 1.0 |
| Travel | **φ** | √φ | 1/φ | 1.0 | 1.0 |
| Research | **φ** | √φ | 1/φ | 1.0 | 1.0 |
| Stamina regen | **φ** | √φ | 1/φ | 1.0 | 1.0 |
| Loot quality | √φ | 1.0 | 1.0 | 1.0 | √φ |

---

## Encounter System (PvE)

| Rarity | Health | Despawn | Max Attackers | Stamina Cost |
|---|---:|---|---:|---:|
| Common | 1,000 | 1 hour | 2 | 10 |
| Uncommon | 5,000 | 2 hours | 3 | 25 |
| Rare | 25,000 | 4 hours | 4 | 50 |
| Epic | 100,000 | 12 hours | 6 | 100 |
| Legendary | 500,000 | 24 hours | 10 | 250 |
| WorldEvent | 5,000,000 | 7 days | 20 | 500 |

Stamina costs in `ENCOUNTER_STAMINA_COSTS` (`constants.rs:191-198`). Encounters spawn at golden-spiral positions within a city (angle = `spawn_index × GOLDEN_ANGLE`). Spawn timing is deterministic by rarity (rare spawns favor Dawn/Dusk; Legendary/Epic restricted to Deep Night).

Attack range: 10 meters (`ENCOUNTER_ATTACK_RANGE_METERS`). PvP attack range: 15 meters (`PVP_ATTACK_RANGE_METERS`).

Stamina regen: 1 stamina per 5 minutes (`STAMINA_REGEN_INTERVAL = 300`).

### Reward Calculation (Deterministic)

Rewards use **level thresholds**:

| Player Level | Reward Types |
|---|---|
| 1-5 | Cash only |
| 6-15 | Cash + Produce |
| 16-30 | Cash + Produce + Weapons |
| 31-50 | + Vehicles |
| 51+ | All types |

Fragments / gems are research-gated (`has_fragment_drops`, `has_gem_drops`). Amount scaling: `base × (√φ)^(level/10) × luck_bonus × time_multiplier`.

---

## Dungeon System

Roguelike PvE — the "Catacombs". Requires Catacombs estate building.

### Run Lifecycle

```
enter → (loop: attack/attack_multi → choose_relic OR interact → next room) → claim (Completed)
                                                                          → flee (partial)
                                                                          → fail (units wiped)
                                                                          → resume (paid 500 gems)
```

### Room Types

| Room | Effect |
|---|---|
| Combat | Enemy fight |
| Treasure | 2× loot multiplier (`DUNGEON_TREASURE_LOOT_MULTIPLIER_BPS = 20000`) |
| Rest | Heal 20% (`DUNGEON_REST_HEAL_PERCENT = 20`) |
| Trap | 1.5× XP, 10% HP damage (`DUNGEON_TRAP_XP_BONUS_BPS = 15000`, `DUNGEON_TRAP_DAMAGE_PERCENT = 10`) |
| Camp | Apply later-interact buff |
| Boss | Floor boss; victory should set `Completed` (currently bugged) |

### Relics (20 IDs)

Each relic has a synergy tag (Offense/Defense/Crit/Sustain/Darkness/Loot/Boss/Hero/Meta). Equipping 2 same-tag relics grants a 2-piece synergy bonus; 3 grants a stronger 3-piece bonus (`SYNERGY_2_BONUS_BPS`, `SYNERGY_3_BONUS_BPS`).

Examples:
- **Warrior's Fury** (Offense): +15% attack
- **Iron Skin** (Defense): +10% defense
- **Swift Blade** (Crit): +20% crit chance
- **Vampiric Touch** (Sustain): 5% lifesteal
- **Shadow Cloak** (Darkness): -30% darkness penalties
- **Fortune's Favor** (Loot): +25% loot
- **Berserker** (Offense): +30% attack, +15% damage taken
- **Phoenix Feather** (Sustain): one-time resurrection at original_units/4
- **Stalwart** (Defense): cannot be one-shot (flag)
- **Golden Touch** (Loot): 2× NOVI

(Full table in `constants.rs:408-454`.)

### Darkness Mechanic

Penalties scale per floor:

| Floor threshold | Penalty starts |
|---|---|
| Floor 1+ | Damage: -0.5%/floor (`DARKNESS_DAMAGE_PENALTY_PER_FLOOR_BPS`) |
| Floor 4+ | Crit chance: -0.3%/floor |
| Floor 7+ | Defense: -0.2%/floor |
| Floor 10+ | Enemy buff: +0.5%/floor |

Shadow Cloak relic + 3-piece Darkness synergy = full immunity.

### Reward Scaling

Floor multipliers (×10000 in `DUNGEON_FLOOR_MULTIPLIERS`): floors 1-10 = 1.0× to 5.16× (1.2^floor).

Flee penalty by floor range: 70% / 60% / 50% / 40% (`DUNGEON_FLEE_PENALTY_BPS`).

### Leaderboard

Weekly per-kingdom leaderboard (`DungeonLeaderboard`, seed `["dungeon_leaderboard", game_engine, week]`). `claim_leaderboard_prize` mints Reserved NOVI to top finishers.

---

## Arena System (PvP)

Seasonal PvP run per kingdom.

| Constant | Value |
|---|---|
| Season duration | 7 days |
| Claim deadline | 30 days after season end |
| Starting ELO | 1000 |
| ELO K-factor | 32 |
| Daily battle cap | 10 |
| Per-opponent cap | 2/day |
| Min battles for daily reward | 5 |
| Match assignment expiry | 5 minutes |
| Base win points | 100 |
| Base loss points | 20 |
| Draw points | 50 |
| Underdog bonus | +5% per 10% power disadvantage |

Constants in `constants.rs:290-358`.

### Battle Resolution

`arena::challenge_player` requires `game_authority` signer (validates the match assignment). Battle is deterministic given loadouts: `calculate_arena_power(loadout)` uses defensive units × weapon power × multipliers. Higher power wins (with ties resolved deterministically).

### Leaderboard Prize Distribution

`ARENA_PRIZE_DISTRIBUTION = [35%, 25%, 15%, 7.5%, 7.5%, 2%, 2%, 2%, 2%, 2%]` (sums to 100%).

Min points to qualify: `ARENA_MIN_POINTS_FOR_LEADERBOARD = 500`.

---

## Castle System (Territory)

5 castle tiers with increasing reward multipliers:

| Tier | Multiplier |
|---|---|
| Outpost | 0.25× |
| Keep | 0.5× |
| Stronghold | 1.0× |
| Fortress | 1.5× |
| Citadel | 2.0× |

(`CASTLE_TIER_MULTIPLIER_BPS = [2500, 5000, 10000, 15000, 20000]`.) Max castles per king: 5 (`MAX_CASTLES_PER_KING`).

### Status Machine

`Vacant → Contest → Protected → Vulnerable → Transitioning`

- **Contest duration**: 2 hours intended
- **Protection duration**: 10 days (`CASTLE_PROTECTION_DURATION = 864_000`)

### Roles & Rewards

| Role | Default daily NOVI | Default daily cash |
|---|---:|---:|
| King | 500,000 | 10,000,000 |
| Court | 50,000 | 1,000,000 |
| Member | 5,000 | 500,000 |

(Defaults in `KING_NOVI_PER_DAY`, etc., `constants.rs:592-597`. Modified by `castle.tier_multiplier_bps` and `castle.treasury_level`.)

**King loot cut**: 15% of combat loot (`KING_LOOT_CUT_BPS = 1500`).

### Upgrade Types

| Upgrade | Cap | Effect |
|---|---:|---|
| Fortification | 255 (uncapped) | +5% defense / level |
| Treasury | 20 | Up to 200% bonus rewards |
| Chambers | 5 | Court slot count |
| Watchtower | 15 | Early warning |
| Armory | 255 (uncapped) | +3% defense quality / level |

### Garrison

Tier-based garrison capacity: `[5, 10, 15, 25]` by king's subscription tier (`GARRISON_CAP_BY_TIER`). Garrison members defend and share combat loot.

### Court

Up to 5 positions (gated by Chambers upgrade level). Appointed by the king; can resign or be dismissed.

---

## Estate System (Personal)

Each player has one `EstateAccount` with embedded buildings. Buildings unlock systems and provide bonuses.

### Buildings

| Building | Unlocks |
|---|---|
| Mansion | Increases locked NOVI capacity |
| Barracks | Faster unit training |
| Workshop | Mining expeditions (level gates tier) |
| Vault | Cash transfers (Lv5+), transfer bonuses (Lv10/15/20) |
| Dock | Fishing expeditions |
| Forge | Forge/crafting |
| Market | Shop discounts |
| Academy | Research time reduction |
| Arena | Arena participation gating |
| Sanctuary | Hero meditation (caps meditation duration) |
| Observatory | Time-of-day visibility |
| Treasury | Event prize bonuses |
| Citadel | Endgame unlocks |
| Camp | Operative hiring |
| Mine | Mining expeditions (tier 0-4) |
| Farm | Farming expeditions |
| Stables | Travel speed |
| Infirmary | Unit recovery (`recover_troops`) |
| Catacombs | Dungeon access |

### Daily Activity

`estate::daily_activity` runs a backend-signed mini-game tied to a time-window (morning/afternoon/evening). Score affects yield. Requires `game_authority` signature.

---

## Forge System (Crafting)

Staged tempering crafting:

1. `forge::start_craft` — lock materials, set quality target
2. `forge::strike` — repeat N times within timed windows (skill-based precision)
3. `forge::equip` — apply crafted item to player
4. (alternative) `forge::abandon_craft` — refund partial materials

Quality tiers 0-4 (Common → Mythic; Common rejected, see `InvalidQualityTier`). Item bonuses scale with quality.
---

## Expedition System (Mining/Fishing/Farming)

Long-duration resource expeditions using operative units.

### Tiers

| Tier | Duration | Rare chance | Building req | NOVI cost |
|---:|---|---|---|---:|
| 0 (Surface/Shore/Garden) | 1 hour | 1% | Lv 1 | 100 |
| 1 (Shallow/River/Fields) | 2 hours | 3% | Lv 5 | 500 |
| 2 (Deep/Lake/Orchard) | 4 hours | 5% | Lv 10 | 2,000 |
| 3 (Volcanic/DeepSea/Plantation) | 8 hours | 10% | Lv 15 | 8,000 |
| 4 (Abyssal/Abyss/Breadbasket) | 16 hours | 20% | Lv 20 | 30,000 |

Building requirements:
- **Mining** → Workshop level (`MINING_WORKSHOP_REQ`)
- **Fishing** → Dock level (`FISHING_DOCK_REQ`)
- **Farming** → Farm level (`FARMING_FARM_REQ`)

Fragment bonuses per tier: Mining `[1, 3, 8, 20, 50]`, Fishing `[1, 2, 5, 12, 30]`.

Operative tier multipliers: 1.0× / 1.5× / 2.0× (`OPERATIVE_TIER_*_MULTIPLIER_BPS`).

### Strike Mechanic

`expedition::strike` is called once per hour during the expedition. Score (0-100) is supplied by the player and **must be co-signed by `game_authority`**. Perfect-expedition bonus (avg score ≥ 80): +25% yield (`PERFECT_EXPEDITION_BONUS_BPS = 2500`).

### Rare Find

Rare find = 5× normal yield (`RARE_FIND_MULTIPLIER = 5`).

---

## Research System

30 nodes across 3 categories. Cost: `NOVI_cost = base × 1.8^level`. Time: `base × 1.5^level`. Speed-up: gems per minute.

### Battle Research (10 nodes)

| Node | Effect | Max Level |
|---|---|---:|
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

### Economy Research (10 nodes)

| Node | Effect | Max Level |
|---|---|---:|
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

### Growth Research (10 nodes)

| Node | Effect | Unlock flag |
|---|---|---|
| Daily Rewards System | unlock | `has_daily_rewards` |
| Mining Operations | unlock | `has_mining` |
| Fishing Industry | unlock | `has_fishing` |
| Loot Magnetism | +loot_chance_bps | — |
| Reputation Mastery | +rep_bonus_bps | — |
| Stamina Vitality | +stamina_bps | — |
| Lucky Streak | +luck_bonus_bps | — |
| Fragment Discovery | unlock | `has_fragment_drops` |
| Gem Prospecting | unlock | `has_gem_drops` |
| Collection Mastery | +collection_bps | — |

### Ascend

`research::ascend` consumes mastery to unlock prestige tiers above the max level.

---

## Hero System (MPL Core NFTs)

Heroes are **MPL Core NFTs** (`p-core` SDK) — not on-chain accounts owned by this program. The program controls:

- **HeroTemplate** PDA per template: base stats, mint cost, supply cap
- **HeroCollection** (shared MPL Core collection)
- **HeroMintReceipt** per (player_account, template_id): enforces per-player mint cap

### Buff Scaling

```
buff_value = base_bps × (√φ)^level
```

| Level | Multiplier | Example (100 base) |
|---|---|---:|
| 1 | 1.272× | 127 |
| 2 | 1.618× | 162 |
| 4 | 2.618× | 262 |
| 10 | 10.86× | 1,086 |
| 20 | 118× | 11,800 |

### Lifecycle

| Instruction | Effect |
|---|---|
| `hero::create_template` | DAO defines a template (stats, cost, supply cap) |
| `hero::create_collection` | DAO bootstraps the shared MPL Core collection (once) |
| `hero::mint` | Player mints NFT from template (gated by mint receipt) |
| `hero::lock` | Bind to PlayerAccount slot (up to 3 active heroes) |
| `hero::unlock` | Release hero from slot |
| `hero::level_up` | Spend fragments: `fragment_cost = 10 × 1.5^current_level` |
| `hero::assign_defensive` | Pick which slot defends |
| `hero::burn` | Destroy NFT, refund locked NOVI based on tier × level |
| `hero::update_supply_cap` | DAO raises template supply ceiling (cannot decrease) |

### Hero Specializations

Each hero has a specialization that grants different bonuses:

| Spec | Effect |
|---|---|
| Warrior | +20% attack |
| Guardian | +15% survival (-15% attack penalty) |
| Tactician | +30% to relic effects (dungeon) |
| (others) | Various |

### Heroes in Reinforcements & Sanctuary

- Sending a hero with a reinforcement: +20% effectiveness
- Hero meditation in Sanctuary: passive XP gain (see Sanctuary section)

---

## City System

### Configurable per Kingdom

Cities are passed via instruction data to `batch_init_cities` (instruction 5). Canonical list in `cli/data/cities.ts`. Each city has:

- `name` (up to 32 bytes)
- `latitude`, `longitude` (f64 degrees) — geographic centre
- `biome_seed` (u32) — drives the deterministic biome function (water mask + Whittaker temperature/moisture lookup)
- `width_grid`, `height_grid` (u16 each) — square plot in grid units (centred AABB; ~11 m per cell)
- `city_type` (Capital/Resource/Combat/Trade)

Biome is sampled on demand via `logic::biome::biome_at(seed, ox, oy)` — no anchor data on the account, no `set_terrain` / `append_terrain` step. Water is the only impassable biome; shore is walkable by design. Mining / fishing / combat affinities are biome-keyed; see `logic::biome::biome_affinity` for the table.

### City Type Bonuses

| Type | Bonus |
|---|---|
| Capital | Balanced (1.0×) |
| Resource | Collection √φ (1.272×) |
| Combat | Attack/Defense √φ (1.272×) |
| Trade | Economy φ (1.618×) |

### Encounter Scaling

Encounter scaling values are now configured via `CombatConfig` in GameEngine (on-chain). Capped at 50 encounters per city.

### Travel Modes

- **Intracity** (`intracity_start` → `intracity_complete`): grid cell movement, walking speed 5 km/h (`INTRACITY_WALKING_SPEED_KMH`)
- **Intercity** (`intercity_start` → `intercity_complete`): between cities, slower travel
- **Teleport** (`intercity_teleport`): instant, costs NOVI
- **Speedup** (`travel::speedup`): pay NOVI/gems to reduce remaining travel time

Travel cost (teleport): `cost = ceil(distance_km / 100) × base_cost`.

---

## Team System

### Structure

| Tier | Max Members |
|---|---:|
| Rookie | 5 |
| Expert | 10 |
| Epic | 25 |
| Legendary | 50 |

### Roles

- **Leader (rank 0)** — full control
- **Co-leader (rank 1)** — most powers including treasury
- **Officer (rank 2)** — invite/kick
- **Member (rank 3)** — base

### Benefits

- Reinforcement sending/receiving
- Rally participation
- Team leaderboards
- Treasury for shared NOVI
- Cash transfers between teammates (`economy::transfer_cash` with vault Lv5+ requirement)

### Treasury Withdrawal Flow

Small withdrawals via `withdraw_treasury` (instant, within rank limits). Large withdrawals use request flow:

`treasury_request_withdraw` → approvers (`treasury_approve_request`) → `treasury_execute_request` after cooldown.

### Invite System

`invite::create` (7-day expiry per `TEAM_INVITE_EXPIRY = 604_800`) → invitee `accept_invite` / `decline_invite` / inviter `cancel_invite`.

### Aggregate Stats

- `total_attacks_won`
- `total_defenses_won`
- `total_rallies_won`
- `total_encounters_cleared`
- `total_novi_earned`
- `total_level` (for average)

### Disband

`disband` requires all members to leave first (`TeamHasMembers` error otherwise) and team to have no claimed domain (`TeamHasDomain` error).

---

## Rally System

### Caps by Tier

| Tier | Max joined | Max created/day | Max participants |
|---|---:|---:|---:|
| Rookie | 1 | 1 | 3 |
| Expert | 3 | 3 | 5 |
| Epic | 5 | 5 | 10 |
| Legendary | 10 | 10 | 20 |

Min participants: 2 (`MIN_RALLY_PARTICIPANTS`). Default recruiting duration: 1 hour (`DEFAULT_RALLY_RECRUITING_DURATION`).

### Lifecycle

```
create → join → execute → process_return (per participant) → close_rally
```

### Loot Distribution

```
participant_share = participant_damage_contribution / total_rally_damage
participant_loot  = total_loot × participant_share
```

---

## Reinforcement System

### Sending Units

`reinforcement::send` requires:
- Same team (`NotOnSameTeam` otherwise)
- "Military Logistics" research (`MilitaryLogisticsRequired`)
- Free reinforcement slot on receiver
- Receiver capacity available (`MAX_REINFORCEMENT_RECEIVE = 10_000` total)

Optional hero co-deployment for +20% effectiveness.

### Lifecycle

```
send → process_arrival (permissionless crank) → optional relieve/recall
                                                → process_return (permissionless crank)
```

### Recovery

Units killed during reinforcement can be re-hired at 50% discount (`RECOVERY_COST_DISCOUNT_BPS = 5000`) via `estate::recover_troops` (requires Infirmary).

---

## Sanctuary (Hero Meditation)

Heroes can meditate for passive XP and bonuses.

| Instruction | Effect |
|---|---|
| `start_meditation` | Lock a hero to sanctuary |
| `speedup_meditation` | Pay gems to advance progress |
| `claim_meditation` | Collect XP when duration elapses |

Duration is capped by Sanctuary building level. Hero must not be locked elsewhere.

---

## Event System

### Event Types

| Type | Duration | Min account age | Prize range |
|---|---|---|---|
| Daily | 24 hours | 7+ days | 5K-50K NOVI |
| Weekly | 7 days | 30+ days | 60K-500K NOVI |
| Seasonal | ~30 days | 60+ days | 1M+ NOVI |
| World | Variable | Variable | 250K+ NOVI |

### Scoring Types

| Event Type | Method |
|---|---|
| `TotalDamageDealt` | Accumulative |
| `MostAttacksWonPvP` | Accumulative |
| `MostAttacksWonPvE` | Accumulative |
| `HighestCash` | Snapshot (max) |
| `MostXPGained` | Accumulative |
| `MostEncountersDefeated` | Accumulative |
| `MostResourcesCollected` | Accumulative |
| `MostNoviConsumed` | Accumulative |

### Prize Distribution (Top 10)

`PRIZE_DISTRIBUTION = [35%, 25%, 15%, 7.5%, 7.5%, 2%, 2%, 2%, 2%, 2%]` (sums to 100%).

### Lifecycle

`event::create` → `event::join` → players act → `event::finalize` (locks leaderboard) → `event::claim_prize` per winner.

---

## Shop System

### Multi-Layer Discounts

| Layer | Cap | Source |
|---|---|---|
| Base discounts | 60% | Flash/Daily/Weekly/Seasonal/DAO sales |
| Bundle savings | 35% | Per-bundle configured |
| Fibonacci bonus | 20% | When cost is a Fibonacci number |
| Combined cap | 75% | `ShopConfig.max_total_discount_bps` |

### Sale Types

| Type | Duration | Discount range |
|---|---|---|
| Flash Sale | Minutes-Hours | Up to 50% |
| Daily Deal | 24 hours | 15-40% |
| Weekly Sale | 7 days | Theme-based |
| Seasonal Sale | Event-tied | Featured items |
| DAO Promotion | Community-voted | Budget-capped |

### Milestone Loyalty

| Milestone | Permanent Discount |
|---|---|
| Bronze | 2% |
| Silver | 4% |
| Gold | 6% |
| Platinum | 8% |
| Diamond | 10% |

### Payment Methods

- **SOL** — system transfer to treasury
- **NOVI** — locked NOVI directly
- **Approved SPL tokens** — via `AllowedTokenAccount` + Pyth/Switchboard oracle pricing
- **Gems** — premium currency

### NOVI Purchase (`shop::purchase_novi`, instruction 300)

Oracle-priced SOL → NOVI with bulk-package discount, subscription tier bonus, consecutive-day streak bonus (up to 7 days), and DAO-set fallback price. Slippage protection via `max_lamports`.

---

## Progression System

### Level System

**XP Sources**:
- Attack players: 10-50 XP
- Attack encounters: 20-100 XP
- Collect resources: 5 XP
- Rally participation: 50 XP
- Event wins: 100-500 XP
- Dungeon clears: scales with floor

**Formula**: `xp_for_level = 1000 × level²`

### Level Unlocks

| Level | Unlock |
|---|---|
| 5 | Epic encounters |
| 10 | Legendary encounters |
| 15 | +5% attack bonus |
| 20 | WorldEvent encounters |
| 25 | +10% collection efficiency |
| 50 | Elite deployment (90%) |

### Reputation

| Rank | Threshold |
|---|---|
| Novice | 0-999 |
| Skilled | 1,000-4,999 |
| Veteran | 5,000-19,999 |
| Elite | 20,000-99,999 |
| Legendary | 100,000+ |

### Daily Rewards

`progression::claim_daily_reward` requires research unlock (`has_daily_rewards`). Streaks tracked across consecutive days.

---

## Multi-Kingdom & Theme System

### Supported Themes (`types.rs::Theme`)

| Value | Name |
|---:|---|
| 0 | Medieval (default) |
| 1 | Cyberpunk |
| 2 | SciFi |
| 3 | Modern |
| 4 | PostApocalyptic |

Kingdom theme is stored on the `GameEngine` and is purely visual; mechanics are identical.

### Theme Mappings (illustrative)

| Mechanic | Medieval | Cyberpunk | Modern |
|---|---|---|---|
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

### Encounter Theme Mappings

| Rarity | Medieval | Cyberpunk | Modern |
|---|---|---|---|
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
- Both accounts ≥ 7 days old (`min_account_age_for_events`)
- Tier-based daily caps (amount + count)
- Vault Lv5+ required for transfers; bonuses at Lv10/15/20
- Lifetime `total_sent` / `total_received` tracked

### Event Eligibility

| Event value | Min age | Transfer ratio limit |
|---|---|---|
| < 25K NOVI | 7 days | 10:1 (received:sent) |
| 25K-100K | 30 days | 3:1 |
| 100K+ | 60 days | 2:1 |

### Why Botting Loses

1. **Passive farming** → generates locked NOVI only → cannot withdraw → worthless
2. **Consolidation** → high `total_received / total_sent` ratio → fails event eligibility
3. **Legitimate play** → balanced ratios → wins Reserved NOVI

### Anti-replay (Arena)

`battle_timestamps` ring buffer on `ArenaParticipant` prevents same-day re-fights against the same opponent (2/day limit). Match IDs are tracked to prevent server-signature replay.

---

## Summary

Novus Mundus delivers:

- **Deterministic core**: Golden-ratio math, basis-point arithmetic, no on-chain RNG
- **Strategic depth**: Unit composition, timing, deployment, rally coordination, castle politics
- **Skill expression**: Research investment, hero leveling, forge precision, expedition mini-game
- **Fair competition**: Multi-kingdom fair starts, anti-Sybil event gating, kingdom-scoped leaderboards
- **Flexible themes**: 5 visual styles, identical mechanics
- **Dual-token economy**: Burn locked NOVI to play; earn reserved NOVI to keep
