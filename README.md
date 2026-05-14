# Novus Mundus: A Multiplayer Strategy Game on Solana

> **A persistent, event-driven world where empires rise, alliances form, and only the strategic survive.**

Novus Mundus is a continuous strategy game built on Solana where players command armies, capture castles, run dungeons, swing forge hammers, and compete in events to earn **NOVI** — the game's dual-purpose token that fuels both gameplay and real rewards.

**Multi-Kingdom System**: Join a kingdom where everyone starts together. New kingdoms launch periodically so late joiners compete on equal footing. Each kingdom has its own theme, leaderboards, events, castles, and dungeons.

**Theme-Flexible Design**: Medieval, cyberpunk, sci-fi, modern, or post-apocalyptic — five themes are defined in code. Unit names and visuals change per kingdom theme; strategy stays the same.

**Deterministic by Design**: Core math is deterministic — golden-ratio multipliers, basis-point arithmetic, no on-chain RNG. A handful of skill/randomness moments (dungeon crits, expedition strikes, forge precision) are intended to be co-signed by the off-chain `game_authority` so outcomes can be verified independently. 

---

## Game Overview

### Kingdoms: Fair Starts for Everyone

Novus Mundus uses a multi-kingdom system to ensure fair competition:

- **New kingdoms launch periodically** — everyone in a kingdom starts together
- **Join late? Pick a newer kingdom** and compete with players at your level
- **Each kingdom is independent** — separate leaderboards, events, rankings, castles, arena seasons
- **Same wallet, multiple kingdoms** — your `UserAccount` is per-wallet; your `PlayerAccount` is per-kingdom
- **Shared NOVI mint** — the NOVI token is a single shared SPL mint across all kingdoms; the mint authority is kingdom 0's GameEngine PDA
- **Heroes (MPL Core NFTs)** are also shared across kingdoms — locking a hero in one kingdom does not bind it to that kingdom

**Themes** (in `src/types.rs`):

| Theme value | Name |
|---|---|
| 0 | Medieval |
| 1 | Cyberpunk |
| 2 | SciFi |
| 3 | Modern |
| 4 | PostApocalyptic |

Each `GameEngine` PDA is created with `kingdom_id`, `kingdom_name`, `kingdom_theme`, and `kingdom_start_time` fields. Cities are batch-initialized per kingdom via `batch_init_cities` (instruction 5).

### The Persistent World

Each kingdom is a **persistent world**: progress within a kingdom never resets, events run continuously, and strategic decisions compound into long-term advantages.

### Your Empire

Command your forces across multiple cities within your kingdom:

- Deploy **defensive units** (3 tiers) to protect your holdings
- Manage **operative units** (3 tiers) to gather resources
- Launch **PvP attacks** on rival players within the same city
- Form alliances through the **team** system (treasury, MOTD, roles, treasury withdrawals)
- Travel between cities with **intercity travel**, or between grid cells with **intracity travel**
- Run **dungeons**, fight in the **arena**, defend **castles**, build your **estate**, and craft items at the **forge**

---

## The NOVI Economy

### Dual-Account System

Novus Mundus uses a two-account economy:

#### Player Account (Locked NOVI)
**Your Gameplay Fuel** — used for in-game actions; cannot be withdrawn directly.

**Sources**:

| Source | Notes |
|---|---|
| Time generation | Rate per 5 minutes, set per subscription tier in `GameEngine.subscription_tiers` |
| SOL → NOVI purchases | `shop::purchase_novi` (instruction 300) with optional Pyth/Switchboard oracle pricing |
| Tier deposits | One-way Reserved → Locked conversion |
| Starter NOVI | `STARTER_LOCKED_NOVI = 1_000_000` (1M NOVI) minted to every new player on `init_player` |
| Castle rewards (lower tiers) | Outpost/Keep/Stronghold castles credit locked NOVI |

**Uses** (most paths burn or consume the NOVI):

- **Hire units** — `economy::hire_units` (defensive + operative)
- **Launch attacks / encounter combat** — `combat::attack_player` / `combat::attack_encounter`
- **Collect resources** — `economy::collect_resources`
- **Purchase equipment** — `economy::purchase_equipment` (weapons, produce, vehicles, armor)
- **Purchase stamina** — `economy::purchase_stamina`
- **Travel speedups** — `travel::speedup`, `rally::speedup`, `reinforcement::speedup`, `expedition::speedup`, `sanctuary::speedup_meditation`
- **Estate builds / upgrades** — `estate::build` / `estate::upgrade`
- **Forge crafting** — `forge::start_craft`

**Locked NOVI cannot be withdrawn** — it exists solely for gameplay. Some operations burn it (deflationary); others move it to escrow inside the program.

#### User Account (Reserved NOVI)
**Your Real Earnings** — withdrawable after a 7-day vesting period.

**Sources**:

| Source | Notes |
|---|---|
| Event prizes | `event::claim_prize` |
| Encounter loot | `loot::claim` for rare+ encounters |
| Arena rewards | `arena::claim_daily_reward`, `arena::claim_master_reward` |
| Dungeon leaderboard | `dungeon::claim_leaderboard_prize` |
| Castle revenue (Fortress/Citadel tiers) | `castle::claim_castle_rewards` |
| Mint-for-prize | `economy::mint_for_prize` (DAO-controlled allocation) |
| Subscription purchase change | Some flows write to reserved |

**Uses**:

- **Withdraw to wallet** — `token::withdraw_reserved` after 7-day vesting (`RESERVED_NOVI_VESTING_PERIOD = 604_800`)
- **Trade on DEX** — Reserved NOVI in your token account is freely transferable once withdrawn
- **Deposit to Player Account** — `token::reserved_to_locked` (one-way)

---

## Core Gameplay

### Unit Types

| Slot | Role | Power (combat) |
|---|---|---|
| Defensive Unit 1 | Attack + Defend | `DEFENSIVE_UNIT_1_POWER = 10` |
| Defensive Unit 2 | Attack + Defend | `DEFENSIVE_UNIT_2_POWER = 25` |
| Defensive Unit 3 | Attack + Defend | `DEFENSIVE_UNIT_3_POWER = 60` |
| Operative Unit 1 | Economy (mining/data) | N/A — used for collection / expedition |
| Operative Unit 2 | Economy (trade) | N/A |
| Operative Unit 3 | Economy (farming/labor) | N/A |

Units are hired with locked NOVI. Theme-flexible: visual names change per kingdom theme, mechanics are identical.

### Equipment

| Type | Purpose |
|---|---|
| **Melee weapons** | Power `10` per weapon (`ARENA_MELEE_WEAPON_POWER`) |
| **Ranged weapons** | Power `16` per weapon (φ ratio) |
| **Siege weapons** | Power `26` per weapon (φ² ratio); also consumed for siege damage (`DAMAGE_PER_SIEGE_WEAPON = 500`) |
| **Armor** | Power `5` per piece |
| **Produce (food)** | Required to maintain unit happiness |
| **Vehicles** | Enable drive-by attacks (require 10k+ units) |
| **Cash** | In-game currency; lootable from raids; up to 75% can be hidden in a vault |

### Happiness System (Deterministic)

Happiness is calculated from weapon/produce availability and tier-based abandonment rates configured in `GameplayConfig`:

| Happiness band | Abandonment | Source |
|---|---|---|
| 75-100% (Happy) | `abandon_rate_happy` | Config |
| 50-75% (Content) | `abandon_rate_content` | Config |
| 25-50% (Unhappy) | `abandon_rate_unhappy` | Config |
| 0-25% (Miserable) | `abandon_rate_miserable` | Config |

Formula: `abandonment = (total_units × rate_bps) / 10000`. No dice rolls.

### Time-of-Day System

Local hour is derived from `Clock::unix_timestamp + longitude/15`. Seven periods (see `logic/time_cycle.rs`):

| Period | UTC hours (at longitude 0) | Notable bonuses |
|---|---|---|
| Deep Night | 00:00-03:00 | Attacks (φ), Mining |
| Dawn | 03:00-06:00 | Rare-encounter spawns |
| Morning | 06:00-09:00 | Balanced |
| Midday | 09:00-15:00 | Defense (φ), Hiring |
| Afternoon | 15:00-18:00 | Balanced |
| Dusk | 18:00-21:00 | Rare-encounter spawns |
| Evening | 21:00-00:00 | Research, Stamina regen |

Multipliers come from the golden-ratio family: φ ≈ 1.618, √φ ≈ 1.272, 1/φ ≈ 0.618 (defined as `PHI`, `GOLDEN_ROOT`, `PHI_INVERSE` in `constants.rs`).

### Cities and Travel

Cities are configured per-kingdom via `batch_init_cities` (instruction 5); the canonical list lives in `cli/data/cities.ts` and is passed via instruction data. Each city has `latitude`, `longitude`, `radius_km`, `city_type`, plus on-account terrain anchors (water/peak lines, configurable via `set_terrain` / `append_terrain`).

| City type | Bonus |
|---|---|
| Capital | Balanced (1.0×) |
| Resource | Collection √φ (1.272×) |
| Combat | Attack/Defense √φ (1.272×) |
| Trade | Economy φ (1.618×) |

**Travel modes**:

- **Intracity** (`intracity_start` → `intracity_complete`, ~1–5 min): grid cell within the same city, walking speed 5 km/h
- **Intercity** (`intercity_start` → `intercity_complete`, ~10 min – 2 h): between cities, slower
- **Teleport** (`intercity_teleport`): instant inter-city travel paid in NOVI, cost ≈ `segments × base_cost` where `segments = ceil(distance_km / 100)`

### Safebox System

Up to 75% of cash can be hidden in a vault (`vault_transfer` instruction 19). Safebox cash is not lootable during attacks. Networth still counts safebox for leaderboard rankings.

### Encounter System (PvE)

| Rarity | Health | Despawn | Max Attackers | Stamina Cost |
|---|---|---|---|---|
| Common | 1,000 | 1 hour | 2 | 10 |
| Uncommon | 5,000 | 2 hours | 3 | 25 |
| Rare | 25,000 | 4 hours | 4 | 50 |
| Epic | 100,000 | 12 hours | 6 | 100 |
| Legendary | 500,000 | 24 hours | 10 | 250 |
| WorldEvent | 5,000,000 | 7 days | 20 | 500 |

Stamina constants are in `ENCOUNTER_STAMINA_COSTS` (`constants.rs:191-198`). Rewards are deterministic based on level + rarity. Loot is claimed via `loot::claim` after the encounter dies.

### Dungeon System

Dungeons are roguelike PvE runs (the "Catacombs") with floors, rooms, combat, relics, and a weekly leaderboard.

**Instructions**: `dungeon::enter` → `dungeon::attack` / `attack_multi` / `interact` / `choose_relic` → `flee` or `claim`; checkpointed runs can be `resume`'d for `DUNGEON_RESUME_GEM_COST = 500` gems.

**Room types**: Combat, Treasure (2× loot), Rest (heal 20%), Trap (1.5× XP, -10% HP), Camp (apply later-interact buff), Boss.

**Relics**: 20 relics, each with a synergy tag (Offense/Defense/Crit/Sustain/Darkness/Loot/Boss/Hero/Meta). 2-piece and 3-piece synergies grant additional bonuses; see `RELIC_EFFECTS`, `SYNERGY_2_BONUS_BPS`, `SYNERGY_3_BONUS_BPS` in `constants.rs:408-482`.

**Darkness mechanic**: per-floor damage / crit / defense penalties starting at floors 1 / 4 / 7. See `DARKNESS_*` constants in `constants.rs:489-501`.

**Reward scaling**: `DUNGEON_FLOOR_MULTIPLIERS = [1.0x, 1.2x, 1.44x, ..., 5.16x]` for floors 1-10. Weekly leaderboard (`claim_leaderboard_prize`) mints reserved NOVI for top finishers.

### Arena (Competitive PvP)

Seasonal PvP run on a per-kingdom basis. Constants in `constants.rs:290-358`:

- **Season duration**: 7 days (`ARENA_SEASON_DURATION`)
- **Claim deadline**: 30 days after season end (`ARENA_CLAIM_DEADLINE`)
- **Daily battle cap**: 10 (`ARENA_MAX_DAILY_BATTLES`)
- **Per-opponent cap**: 2 battles per day
- **Starting ELO**: 1000 (`ARENA_STARTING_ELO`)
- **ELO K-factor**: 32
- **Daily reward**: requires ≥ 5 battles (`ARENA_MIN_BATTLES_FOR_DAILY_REWARD`)
- **Master reward prize distribution**: 10-slot leaderboard split `[35%, 25%, 15%, 7.5%, 7.5%, 2%, 2%, 2%, 2%, 2%]` (`ARENA_PRIZE_DISTRIBUTION`)

Battles are challenge-based: `arena::challenge_player` requires the `game_authority` signer to validate the match.

### Castle System (Territory Control)

5 castle tiers: Outpost (0.25×), Keep (0.5×), Stronghold (1.0×), Fortress (1.5×), Citadel (2.0×) — see `CASTLE_TIER_MULTIPLIER_BPS`. Max castles per king: 5.

**Status machine**: Vacant → Contest → Protected → Vulnerable → Transitioning. Protection lasts 10 days (`CASTLE_PROTECTION_DURATION = 864_000`).

**Roles**:

| Role | Default daily NOVI | Default daily cash |
|---|---|---|
| King | 500,000 | 10,000,000 |
| Court | 50,000 | 1,000,000 |
| Member | 5,000 | 500,000 |

(Multiplied by `castle.tier_multiplier_bps`; defaults from `KING_NOVI_PER_DAY`, `KING_CASH_PER_DAY`, etc. in `constants.rs:592-597`.)

**Upgrades**: Fortification, Treasury (cap 20 levels = 200% bonus), Chambers (cap 5 = court slots), Watchtower (cap 15), Armory. See `MAX_*_LEVEL` constants.

**Garrison**: capacity by king's subscription tier: `[5, 10, 15, 25]` (`GARRISON_CAP_BY_TIER`). 15% of combat loot is the king's cut (`KING_LOOT_CUT_BPS = 1500`).

### Estate (Personal Property)

Each player has one `EstateAccount` (`estate::create`) with embedded buildings:

- **Combat / military**: Mansion, Barracks, Workshop, Vault, Camp, Infirmary, Stables
- **Production**: Mine, Farm, Forge, Dock
- **Strategic**: Market, Academy, Arena, Sanctuary, Observatory, Treasury, Citadel
- **Dungeon**: Catacombs (required for dungeon access)

`estate::build` starts construction; `estate::complete` finalizes after the timer; `estate::upgrade` levels existing buildings; `estate::daily_claim` and `estate::daily_activity` provide passive resource generation tied to a daily mini-game window. `recover_troops` heals abandoned units via Infirmary; `convert_materials` swaps resources.

### Forge System (Staged Tempering)

Crafting flow: `forge::start_craft` (lock materials) → repeated `forge::strike` (skill-based timing window) → `forge::equip` (apply to player) or `forge::abandon_craft` (refund partial). Quality tiers 0-4 (Common → Mythic).

### Expedition System (Mining / Fishing / Farming)

Long-duration resource expeditions: `expedition::start` (lock operatives, pay NOVI) → repeated `strike` (skill-based mini-game; requires `game_authority`) → `claim` (collect yield) or `abort` (early termination, partial refund).

Tiers 0-4 with increasing duration (1/2/4/8/16 hours), rare-find chance (1%/3%/5%/10%/20%), building requirements (Workshop/Dock/Farm level), and NOVI cost (100/500/2,000/8,000/30,000). See `MINING_*`, `FISHING_*`, `FARMING_*` constants in `constants.rs:241-269`.

### Reinforcement System

Teammates can send units to defend each other (`reinforcement::send`). Requires:
- Same team (`NotOnSameTeam` otherwise)
- "Military Logistics" research unlocked (`MilitaryLogisticsRequired`)
- Free reinforcement slot on receiver (`NoFreeReinforcementSlot`)

Max units across all reinforcements: 10,000 (`MAX_REINFORCEMENT_RECEIVE`). Optional hero co-deployment for +20% effectiveness.

Lifecycle: `send` → `process_arrival` (permissionless crank) → optional `relieve` / `recall` → `process_return` (permissionless crank). Recovery cost discount when re-hiring units killed during reinforcement: 50% (`RECOVERY_COST_DISCOUNT_BPS = 5000`).

### Rally System

Coordinated multi-player attacks: `rally::create` → invited members `rally::join` → `rally::execute` (combat resolves against target) → `rally::process_return` for each participant.

Caps per subscription tier (`RallyCaps` in `GameEngine`):

| Tier | Max joined | Max created/day | Max participants |
|---|---|---|---|
| Rookie | 1 | 1 | 3 |
| Expert | 3 | 3 | 5 |
| Epic | 5 | 5 | 10 |
| Legendary | 10 | 10 | 20 |

Min participants to execute: 2 (`MIN_RALLY_PARTICIPANTS`). Default recruiting duration: 1 hour (`DEFAULT_RALLY_RECRUITING_DURATION = 3600`).

### Sanctuary (Hero Meditation)

Heroes can be sent to meditate (`sanctuary::start_meditation`) for passive XP and bonuses. Speedup with gems (`sanctuary::speedup_meditation`). Claim XP after duration elapses (`sanctuary::claim_meditation`). Meditation duration is capped by Sanctuary building level.

### Combat Mechanics

**Attack power (deterministic, see `logic/combat.rs`)**:

```
base_power = Σ(defensive_unit_i × power_i)
weapon_coverage = min(weapons / total_units, 1.0)
total_bonus_bps = 10000 + research_attack_bps + hero_attack_bps + level_bonus
total_power = base_power × weapon_coverage × total_bonus_bps / 10000
```

**Critical hits** in PvP: research-driven. If `research_crit_chance_bps >= 5000`, the crit is guaranteed (50% threshold = 100% crit). Crit damage is also research-scaled. This is investment, not luck.

**Critical hits in dungeons** are intended to be flagged by the off-chain `game_authority` per attack. 

**Drive-by attacks**: require 10,000+ units and vehicles; base bonus `√φ`; night bonus stacks up to full `φ`.

---

## Events & Competition

All events and leaderboards are **kingdom-scoped** — you compete only with players in your kingdom.

### Event Cadence

| Event class | Duration | Min account age | Prize range (illustrative) |
|---|---|---|---|
| Daily | 24 hours | 7 days | 5K-50K NOVI |
| Weekly | 7 days | 30 days | 60K-500K NOVI |
| Seasonal | ~30 days | 60 days | 1M+ NOVI |
| World | variable | variable | 250K+ NOVI |

### Prize Distribution (Top 10)

From `PRIZE_DISTRIBUTION` in `constants.rs:160-171`:

| Rank | Share | Rank | Share |
|---|---:|---|---:|
| 1 | 35% | 6 | 2% |
| 2 | 25% | 7 | 2% |
| 3 | 15% | 8 | 2% |
| 4 | 7.5% | 9 | 2% |
| 5 | 7.5% | 10 | 2% |

(Sums to 100%. Same distribution applies to arena master rewards.)

### Anti-Sybil Event Eligibility

Tiered by event value (illustrative thresholds — actual values configured per event):

| Event value | Min account age | Min attacks | Max transfer ratio |
|---|---|---|---|
| < 25K NOVI | 7 days | 5 | 10:1 |
| 25K-100K | 30 days | 20 | 3:1 |
| 100K+ | 60 days | 50 | 2:1 |

`total_sent` and `total_received` are tracked on every PlayerAccount; the ratio is checked in `logic/eligibility.rs`.

---

## Subscription Tiers

Subscription values live in `GameEngine.subscription_tiers[4]` and are configurable by DAO. The defaults in `MAX_TEAM_MEMBERS_BY_TIER` and `MAX_STAMINA_BY_TIER` (`constants.rs:36, 205-210`) are:

| Tier | Team size | Max stamina | Notes |
|---|---:|---:|---|
| Rookie (Free) | 5 | 100 | Free tier |
| Expert | 10 | 500 | SOL subscription |
| Epic | 25 | 1,000 | SOL subscription |
| Legendary | 50 | 10,000 | SOL subscription |

Generation rate per 5 min, max locked NOVI, daily transfer caps, and tier-specific bonuses are all stored in each `SubscriptionTier` struct on the GameEngine and updated by DAO via `update_game_config`.

---

## Research System

30 research nodes across 3 categories (10 each). Costs scale as `NOVI_cost = base × 1.8^level`, time as `time = base × 1.5^level`.

**Battle (10)**: Attack Power, Defense Power, Unit Capacity, Crit Chance, Crit Damage, Rally Capacity, Encounter Success, Loot Bonus, Training Speed, Ambush Damage.
**Economy (10)**: Production Efficiency, Resource Capacity, Market Tax Reduction, Trade Speed, Mining Output, Cash Generation, Construction Speed, Upkeep Reduction, Black Market, Tax Collection.
**Growth (10)**: Daily Rewards System (`has_daily_rewards`), Mining Operations (`has_mining`), Fishing Industry (`has_fishing`), Loot Magnetism, Reputation Mastery, Stamina Vitality, Lucky Streak, Fragment Discovery, Gem Prospecting, Collection Mastery.

Research can be `start`'d, `speed_up`'d (gems), `cancel`'d (partial refund), or `complete`'d. `research::ascend` consumes mastery to unlock higher-tier benefits.

---

## Hero System (MPL Core NFTs)

Heroes are MPL Core (`p-core`) NFTs. Buffs scale with `√φ` per level:

```
buff_value = base_bps × (√φ)^level
```

| Level | Multiplier | Example (base 100) |
|---|---|---|
| 1 | 1.272× | 127 |
| 2 | 1.618× | 162 |
| 4 | 2.618× | 262 |
| 10 | 10.86× | 1,086 |

**Lifecycle**:

- `hero::create_template` (DAO) — define a hero archetype with base stats, mint cost, supply cap
- `hero::create_collection` (DAO) — bootstrap the shared MPL Core collection
- `hero::mint` — player mints from a template (gated by `HeroMintReceipt` per-(player, template))
- `hero::lock` — bind a hero to a PlayerAccount slot (up to 3 active); buffs apply
- `hero::unlock` — release a locked hero; buffs removed
- `hero::level_up` — spend fragments per `fragment_cost = 10 × 1.5^current_level`
- `hero::assign_defensive` — pick which slot defends
- `hero::burn` — destroy a hero NFT; refund locked NOVI scaled by tier × level
- `hero::update_supply_cap` (DAO) — raise the template supply ceiling (cannot decrease)

Heroes can be sent with reinforcements for +20% effectiveness and meditate in Sanctuary for passive XP.

---

## Fibonacci Efficiency System

Spending NOVI amounts that are **Fibonacci numbers** grants a deterministic `√φ` (1.272×) efficiency multiplier:

**Fibonacci numbers**: 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, …

Detection (`logic/fibonacci.rs`): a number `n` is Fibonacci iff `5n² + 4` or `5n² - 4` is a perfect square.

Applied in `logic/consume.rs` to actions that take a player-chosen NOVI amount (collection, etc.). Plan your spends to land on Fibonacci numbers for free efficiency.

---

## Shop System

### Multi-Layer Discount System

**Layer 1 — Base discounts** (up to 60%):
- Flash Sales (minutes–hours)
- Daily Deals (24h)
- Weekly Sales (7 days)
- Seasonal Sales (event-tied)
- DAO Promotions (community-voted)

**Layer 2 — Bundle savings** (up to 35%, exact discount stored per bundle).

**Layer 3 — Fibonacci bonus** (up to 20%, applied when total cost is a Fibonacci number).

**Combined cap**: configured in `ShopConfig.max_total_discount_bps`. 

### Milestone Loyalty

Permanent discounts unlocked at spend thresholds (configured in `ShopConfig`):

| Milestone | Permanent Discount |
|---|---|
| Bronze | 2% |
| Silver | 4% |
| Gold | 6% |
| Platinum | 8% |
| Diamond | 10% |

### Payment Methods

- **SOL** (lamports) — via system transfer to treasury
- **NOVI** — direct from `PlayerAccount.locked_novi`
- **Approved SPL tokens** — via `AllowedTokenAccount` + Pyth/Switchboard oracle pricing
- **Gems** — premium currency (earned/purchased)

### NOVI Purchase (`shop::purchase_novi`, instruction 300)

Buy NOVI with SOL:
- **Oracle-priced**: SOL/USD and NOVI/USD via Pyth or Switchboard, with configurable `novi_market_undercut_bps` discount (e.g. 15% below market)
- **Fallback**: DAO-set `novi_base_price_lamports` if oracle missing/stale
- **Bonuses**: package tier bulk discount, subscription tier bonus, consecutive-day purchase streak (up to 7 days)
- **Slippage protection**: caller specifies `max_lamports`

---

## Anti-Bot Security

### Transfer Restrictions (`economy::transfer_cash`)

- Same team only (no cross-team transfers)
- Both accounts ≥ `min_account_age_for_events` old (default 7 days)
- Tier-based daily amount + count caps
- Vault building level ≥ 5 required (with bonuses at 10/15/20)
- `total_sent` / `total_received` tracked per player

### Event Eligibility

See "Anti-Sybil Event Eligibility" above. Tier-gated by account age, min attacks, and transfer ratio.

### Why Botting Loses

- Passive farming → locked NOVI → cannot withdraw → worthless
- Consolidation farming → high `total_received / total_sent` → fails event eligibility → cannot win big prizes
- Legitimate play → balanced ratios → wins Reserved NOVI

### Governance

- `GameEngine.authority` — DAO governance authority (gates all `update_*` instructions, batch city init, etc.)
- `GameEngine.game_authority` — off-chain backend signer for skill/RNG-influenced instructions (dungeon relic choice, dungeon interact, expedition strike, estate daily activity, arena match)
- `GameEngine.payment_authority` — backend that co-signs off-chain (fiat) subscription payments

---

## Technical Architecture

### Solana Smart Contract

- **Framework**: Pinocchio 0.9.2 (no Anchor — all account validation is manual)
- **External crates**: `p-core` (MPL Core for hero NFTs), `p-pyth` (Pyth price feeds), `switchboard-on-demand`, `alt-name-service` + `tld-house` (ANS / .alldomains player and team names), `libm` (deterministic float math)
- **Instruction discriminator**: u16 little-endian (2 bytes)
- **Account size**: PlayerAccount is `PlayerCore` (1056 bytes) + up to 7 extension sections (research, heroes, inventory, rally, team, cosmetics, court) up to a total `MAX_SIZE = 1946 bytes`
- **PDA seeds**: kingdom-scoped except for the NOVI mint (shared)

See `TECHNICAL_ARCHITECTURE.md` for full module structure, account layouts, instruction dispatch table, and PDA seed reference.

### Determinism & Float Math

The codebase favors integer basis-point math, but some logic paths still use `f64` via `libm` (combat damage splits, Haversine distance, progression scaling).

---

## Getting Started

### Step 1: Connect Wallet
Phantom, Backpack, or any Solana wallet. Fund with SOL for transactions.

### Step 2: Choose Your Kingdom
Browse available kingdoms by theme and age. New player? Pick a recently launched kingdom for a fair start. Veteran? Run multiple kingdoms with the same wallet.

### Step 3: Register Your Character
- `init_user` (one-time per wallet, instruction 2)
- `init_player` (per-kingdom, instruction 1) — receive 1M starter locked NOVI; 24-hour new-player protection begins

### Step 4: Build Your Strategy
Hire units, maintain happiness, attack diverse opponents, collect resources, claim a name via `set_player_name` (alt-name-service / .alldomains).

### Step 5: Join Events
Start with daily challenges (7-day eligibility). Progress to weekly tournaments (30-day), seasonal events (60-day+).

### Step 6: Grow Your Empire
Subscribe for faster generation. Form/join a team. Invest in research, mint heroes, build estate buildings, run dungeons, claim a castle, fight in arena seasons.

---

## Fair Play Commitment

- **Multi-kingdom** — new kingdoms launch periodically; everyone can start fresh
- **Kingdom-scoped competition** — compete only with players who started when you did
- Free players earn through daily challenges
- Subscriptions accelerate progression but don't guarantee victories
- Deterministic core mechanics — no in-protocol RNG
- Transparent on-chain actions and DAO governance

---

## Important Notes

### Price Disclaimer
SOL and NOVI prices in this document are examples. Real prices depend on market conditions, DAO governance, economic balancing, and supply/demand.

### Not Financial Advice
Novus Mundus is a game. NOVI is a gaming token. Entertainment, not investment. Play responsibly.

### Continuous Evolution
Mechanics, events, and features evolve based on community feedback, governance proposals, security considerations, and competitive balance.

---

**Version**: 3.1 (Multi-Kingdom, 2026-05-14 docs refresh)
**Framework**: Pinocchio 0.9.2 (Solana)
**Program**: `programs/novus_mundus/`
