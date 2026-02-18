# Novus Mundus CLI — `novus`

## Overview

Single CLI tool to initialize and manage all game state for a Novus Mundus kingdom. Every command is **idempotent** — safe to re-run after partial failures or config changes.

### Create-or-Update Pattern

- **Updatable accounts** (shop items, research templates, subscription tiers) → check if exists, if yes run update instruction with latest config
- **Immutable accounts** (GameEngine, cities, hero templates, dungeon templates, castles, arena seasons) → check if exists, skip if yes, create if no
- **Always-update accounts** (subscription tier configs) → always write latest config regardless

---

## CLI Interface

```
novus <command> [subcommand] [options]

Global Options:
  --env <localnet|devnet|mainnet>   Target environment (default: localnet)
  --kingdom-id <number>             Kingdom ID (default: 0)
  --authority <keypair-path>        DAO authority keypair (default: keys/dao-authority.json)
  --dry-run                         Show what would be created/updated, don't send txs
  --verbose                         Show transaction signatures and account addresses
```

### Commands

```
novus init all                      Initialize everything (phases 1-10)
novus init all --from 5             Resume from phase 5
novus init engine                   Phase 1: GameEngine + NOVI mint
novus init cities                   Phase 2: All 24 cities
novus init heroes                   Phase 3: Hero collection + 79 templates
novus init research                 Phase 4: Research templates
novus init subscriptions            Phase 5: Subscription tier configs
novus init shop                     Phase 6: Shop config + items + bundles
novus init dungeons                 Phase 7: Dungeon templates + leaderboards
novus init castles                  Phase 8: Castles (one per city)
novus init arena                    Phase 9: Arena season
novus init events                   Phase 10: Starter events

novus status                        Show initialization status of all systems
novus status heroes                 Show hero template status (created/supply/minted)
novus status shop                   Show shop items and bundles

novus update research               Re-apply research template configs
novus update subscriptions          Re-apply subscription tier configs
novus update shop                   Re-apply shop item/bundle configs
novus update heroes --supply-caps   Update hero template supply caps from data file
```

### Running

```bash
# Via bun (recommended)
bun run scripts/cli.ts init all

# Via npx
npx tsx scripts/cli.ts init all --env devnet

# With alias (add to package.json scripts)
bun novus init all
```

---

## File Structure

```
scripts/
├── cli.ts                         # Entry point — arg parsing, command routing
├── lib/
│   ├── context.ts                 # Connection, keypairs, airdrop, environment
│   ├── helpers.ts                 # accountExists, createOrSkip, createOrUpdate,
│   │                              # sendWithRetry, batchSend, logging
│   ├── commands/
│   │   ├── init.ts                # `novus init <target>` dispatcher
│   │   ├── status.ts              # `novus status [target]` — read-only inspection
│   │   └── update.ts              # `novus update <target>` — update-only (no creates)
│   └── phases/
│       ├── engine.ts              # GameEngine + NOVI mint
│       ├── cities.ts              # 24 cities (batched)
│       ├── heroes.ts              # Hero collection + 79 templates
│       ├── research.ts            # 30 research templates
│       ├── subscriptions.ts       # 4 subscription tier configs
│       ├── shop.ts                # ShopConfig + items + bundles + tokens
│       ├── dungeons.ts            # Dungeon templates + leaderboards
│       ├── castles.ts             # Castles
│       ├── arena.ts               # Arena season
│       └── events.ts              # Starter events
└── data/
    ├── cities.ts                  # 24 cities
    ├── heroes.ts                  # 79 hero templates
    ├── research.ts                # 30 research templates
    ├── shop-items.ts              # Items + bundles + allowed tokens
    ├── dungeons.ts                # Dungeon templates
    ├── castles.ts                 # Castle definitions
    ├── events.ts                  # Starter events
    ├── subscriptions.ts           # 4 tier configs
    └── arena.ts                   # Arena season config
```

21 files total.

---

## CLI Entry Point

### `cli.ts`

Parses argv, builds context, routes to command handler.

```typescript
// Pseudocode
const args = parseArgs(process.argv.slice(2));
const ctx = await buildContext(args);           // connection, keypairs, PDAs

switch (args.command) {
  case 'init':   await handleInit(ctx, args);   break;
  case 'status': await handleStatus(ctx, args); break;
  case 'update': await handleUpdate(ctx, args); break;
  default:       printUsage();
}
```

No external CLI framework dependency — just raw `process.argv` parsing. Keeps deps minimal.

---

## Context Layer

### `lib/context.ts`

```typescript
export interface CLIContext {
  connection: Connection;
  env: 'localnet' | 'devnet' | 'mainnet';
  kingdomId: number;
  daoAuthority: Keypair;
  treasury: Keypair;
  gameEngine: PublicKey;       // derived from kingdomId
  noviMint: PublicKey;         // derived
  heroCollection: PublicKey;   // derived
  dryRun: boolean;
  verbose: boolean;
}
```

- `buildContext(args)` — resolves environment, loads keypairs, derives PDAs
- `ensureFunded(ctx)` — airdrops SOL on localnet if balance is low
- `loadKeypair(path)` — reads JSON keypair file
- RPC URLs: localnet=`http://localhost:8899`, devnet=`https://api.devnet.solana.com`, mainnet=configurable

### `lib/helpers.ts`

- `accountExists(connection, pubkey)` — returns true if account has lamports > 0
- `createOrSkip(ctx, name, pda, txBuilder)` — create if missing, skip if exists
- `createOrUpdate(ctx, name, pda, createTx, updateTx)` — create if missing, update if exists
- `sendWithRetry(ctx, tx, signers, retries=3)` — retry with exponential backoff, respects `--dry-run`
- `batchSend(ctx, items, txBuilder, concurrency=4)` — parallel tx submission with concurrency limit
- Logging functions:
  - `log.header(title)` — boxed section header
  - `log.phase(n, total, name)` — `Phase 3/10 — Heroes`
  - `log.create(name)` — `  + Created: Hero Template #5`
  - `log.update(name)` — `  ~ Updated: Shop Item #3`
  - `log.skip(name)` — `  - Skipped: GameEngine [exists]`
  - `log.summary(created, updated, skipped)` — `  = 72 created, 3 updated, 1 skipped`
  - `log.done(elapsed)` — `Done in 4.2s`
  - `log.error(msg)` — red error output
  - `log.dryRun(msg)` — `[dry-run] Would create: ...`

---

## Commands

### `novus init <target>`

Creates and/or updates accounts. Each phase is idempotent.

| Target | Phase | Creates | Updates |
|--------|-------|---------|---------|
| `engine` | 1 | GameEngine + NOVI mint | Skip if exists |
| `cities` | 2 | 24 cities (batched 8/tx) | Skip if exists |
| `heroes` | 3 | Collection + 79 templates | Supply caps if changed |
| `research` | 4 | 30 research templates | Cost/duration/buffs if exists |
| `subscriptions` | 5 | — | Always update all 4 tiers |
| `shop` | 6 | Config + items + bundles | Price/active/stock if exists |
| `dungeons` | 7 | Templates + leaderboards | Skip if exists |
| `castles` | 8 | 24 castles | Skip if exists |
| `arena` | 9 | Season 1 | Skip if exists |
| `events` | 10 | Starter events | Skip if exists, create new |
| `all` | 1-10 | Everything above | Everything above |

`novus init all --from 5` skips phases 1-4, starts at subscriptions.

### `novus status [target]`

Read-only inspection. No transactions sent.

```
novus status
```

```
Novus Mundus — Kingdom 0 (localnet)

System            Status    Details
─────────────────────────────────────────────
GameEngine        ✓         Authority: 7xK...3Qp
NOVI Mint         ✓         Supply: 1,234,567
Cities            ✓         24/24 created
Heroes            ✓         Collection + 79/79 templates
Research          ✓         30/30 templates
Subscriptions     ✓         4 tiers configured
Shop              ✓         Config + 5 items + 2 bundles
Dungeons          ✓         4 templates, 4 leaderboards
Castles           ✓         24/24 created
Arena             ✓         Season 1 active
Events            ✓         3 events
```

```
novus status heroes
```

```
Hero Templates — Kingdom 0

 ID  Name           Tier       Cost    Cap    Minted  Enabled
───────────────────────────────────────────────────────────────
  1  Warrior        Common     0.10    4000   127     ✓
  2  Archer         Common     0.10    4000   89      ✓
  3  Mage           Common     0.10    4000   156     ✓
  ...
 79  Chronos        Mythic     25.00   10     0       ✓
```

```
novus status shop
```

```
Shop Items — Kingdom 0

 ID  Name              Price    Active  Stock   Sold
──────────────────────────────────────────────────────
  1  Gem Pack (100)    0.01     ✓       ∞       342
  2  Fragment Pack     0.01     ✓       ∞       891
  ...

Bundles:
 ID  Name              Price    Active  Savings
──────────────────────────────────────────────────
  1  Starter Bundle    0.02     ✓       15%
  2  Combat Bundle     0.04     ✓       20%
```

### `novus update <target>`

Update-only mode. Never creates accounts — only updates existing ones. Useful for config changes without risk of accidentally creating missing infrastructure.

| Target | What It Updates |
|--------|-----------------|
| `research` | Cost, duration, buffs, max level (instruction 126) |
| `subscriptions` | All 4 tier configs (instruction 101) |
| `shop` | Item price/active/stock (151), bundle price/active/savings (154), oracle config (155) |
| `heroes --supply-caps` | Hero template supply caps (instruction 311) |

If an account doesn't exist, `update` logs an error instead of creating it — use `init` for that.

---

## Data Files

### `data/cities.ts`

24 cities with real-world coordinates. City IDs must match the `meditation_city_id` values used in HERO_GALLERY.md.

```typescript
export const CITIES = [
  { id: 1,  name: 'London',         lat: 51.5074,    lon: -0.1278,    radiusKm: 25, type: CityType.Capital },
  { id: 2,  name: 'Paris',          lat: 48.8566,    lon: 2.3522,     radiusKm: 20, type: CityType.Trade },
  { id: 3,  name: 'Rome',           lat: 41.9028,    lon: 12.4964,    radiusKm: 20, type: CityType.Trade },
  { id: 4,  name: 'Athens',         lat: 37.9838,    lon: 23.7275,    radiusKm: 15, type: CityType.Combat },
  { id: 5,  name: 'Berlin',         lat: 52.5200,    lon: 13.4050,    radiusKm: 20, type: CityType.Resource },
  { id: 6,  name: 'Moscow',         lat: 55.7558,    lon: 37.6173,    radiusKm: 30, type: CityType.Combat },
  { id: 7,  name: 'Istanbul',       lat: 41.0082,    lon: 28.9784,    radiusKm: 20, type: CityType.Trade },
  { id: 8,  name: 'Cairo',          lat: 30.0444,    lon: 31.2357,    radiusKm: 25, type: CityType.Resource },
  { id: 9,  name: 'Tokyo',          lat: 35.6762,    lon: 139.6503,   radiusKm: 25, type: CityType.Capital },
  { id: 10, name: 'Beijing',        lat: 39.9042,    lon: 116.4074,   radiusKm: 30, type: CityType.Capital },
  { id: 11, name: 'Shanghai',       lat: 31.2304,    lon: 121.4737,   radiusKm: 25, type: CityType.Trade },
  { id: 12, name: 'Seoul',          lat: 37.5665,    lon: 126.9780,   radiusKm: 20, type: CityType.Resource },
  { id: 13, name: 'Mumbai',         lat: 19.0760,    lon: 72.8777,    radiusKm: 25, type: CityType.Trade },
  { id: 14, name: 'Sydney',         lat: -33.8688,   lon: 151.2093,   radiusKm: 20, type: CityType.Resource },
  { id: 15, name: 'Dubai',          lat: 25.2048,    lon: 55.2708,    radiusKm: 15, type: CityType.Trade },
  { id: 16, name: 'Baghdad',        lat: 33.3152,    lon: 44.3661,    radiusKm: 20, type: CityType.Combat },
  { id: 17, name: 'New York',       lat: 40.7128,    lon: -74.0060,   radiusKm: 25, type: CityType.Capital },
  { id: 18, name: 'Mexico City',    lat: 19.4326,    lon: -99.1332,   radiusKm: 25, type: CityType.Trade },
  { id: 19, name: 'Sao Paulo',      lat: -23.5505,   lon: -46.6333,   radiusKm: 30, type: CityType.Capital },
  { id: 20, name: 'Buenos Aires',   lat: -34.6037,   lon: -58.3816,   radiusKm: 20, type: CityType.Trade },
  { id: 21, name: 'Lima',           lat: -12.0464,   lon: -77.0428,   radiusKm: 15, type: CityType.Resource },
  { id: 22, name: 'Lagos',          lat: 6.5244,     lon: 3.3792,     radiusKm: 20, type: CityType.Combat },
  { id: 23, name: 'Nairobi',        lat: -1.2921,    lon: 36.8219,    radiusKm: 15, type: CityType.Resource },
];
```

City IDs 0-22 are referenced by hero `meditation_city_id` values in HERO_GALLERY.md. ID 0 = "Any" (heroes not bound to a specific city).

### `data/heroes.ts`

79 hero templates across 6 tiers. Template IDs are **non-sequential**, grouped by category. All data sourced from `docs/HERO_GALLERY.md`.

```typescript
export interface HeroTemplateData {
  templateId: number;
  name: string;               // Max 32 bytes, null-padded on-chain
  heroType: number;            // 0=Offensive, 1=Defensive, 2=Economic, 3=Hybrid
  category: number;            // 0=Historical, 1=Mythological, 2=CryptoIcons, 3=Gaming, 4=Original
  mintCostLamports: number;
  supplyCap: number;           // 0=unlimited
  enabled: boolean;
  eventExclusive: boolean;
  requiredPlayerLevel: number;
  meditationCityId: number;    // 0=Any, 1-22=specific city (see HERO_GALLERY.md city table)
  buffs: { stat: number; baseBps: number }[];  // Up to 4 buffs, 18 stat types
}
```

| Tier | Count | Mint Cost | Initial Supply Cap | Required Level |
|------|-------|-----------|-------------------|----------------|
| Common | 5 | 0.1 SOL | 4,000 | 1 |
| Rare | 23 | 0.25 SOL | 2,000 | 25 |
| Epic | ~37 | 1.0 SOL | 1,000 | 50 |
| Legendary | 8 | 5.0 SOL | 100 | 75 |
| Mythic | 5 | 10.0+ SOL | 10-50 | 100 |

**Template ID ranges by category:**

| Category | ID Range | Examples |
|----------|----------|---------|
| Common Starters | 1-4 | Warrior, Archer, Mage, Paladin |
| Historical | 10-21 | Alexander, Caesar, Napoleon, Genghis Khan |
| Mythological | 50-57 | Zeus, Odin, Thor, Ra, Amaterasu |
| Legends & Folk | 70-92 | Robin Hood, Merlin, Mulan, Sinbad, Gilgamesh |
| Crypto & Web3 | 150-155 | Satoshi, Diamond Hands, Degen, Bored Ape |
| Mythic Tier | 160-163 | Chronos, Void Walker, etc. |
| Original | 200-290 | Theophilos, Kassandra, Astrid, Akira, etc. |

**18 Buff stat types** (referenced by `stat` field in buffs):

| ID | Stat | ID | Stat |
|----|------|----|------|
| 1 | AttackPower | 10 | WeaponEfficiency |
| 2 | DefensePower | 11 | StaminaRegen |
| 3 | CashCollectionRate | 12 | ProduceGeneration |
| 4 | XpGain | 13 | UnitCapacity |
| 5 | TrainingCostReduction | 14 | EncounterDamage |
| 6 | RallyCapacity | 15 | LootBonus |
| 7 | CriticalHitChance | 16 | ArmorEfficiency |
| 8 | SynchronyBonus | 17 | MiningAffinity |
| 9 | ResourceCapacity | 18 | FishingAffinity |

Each hero has up to 4 buffs with tier-scaled base values (Common ~300-500 bps, Mythic ~2500-3500 bps). Full buff configs per hero are defined in `docs/HERO_GALLERY.md`.

### `data/research.ts`

30 research templates across 3 categories. **Updatable** — changed values are pushed on re-run. All data sourced from `docs/RESEARCH.md`.

```typescript
export interface ResearchTemplateData {
  researchType: number;          // 0-29
  name: string;
  category: number;              // 0=Battle, 1=Economy, 2=Growth
  maxLevel: number;              // 5-25
  baseTimeSeconds: number;       // Base time for level 1
  baseNoviCost: number;          // NOVI cost for level 1
  buffType: number;              // What stat this buffs
  buffPerLevelBps: number;       // Basis points per level
  prerequisiteResearch: number;  // 255 = no prereq, else research_type
  prerequisiteLevel: number;     // Required level of prerequisite
  gemCostPerMinute: number;      // Gems per minute for speed-up
  isActive: boolean;
}
```

**Battle Research (10 nodes):**

| Type | Name | Max Lvl | Buff | Prereq |
|------|------|---------|------|--------|
| 0 | Attack Power | 25 | +2% attack/lv | None |
| 1 | Defense Power | 25 | +2% defense/lv | None |
| 2 | Unit Capacity | 25 | +2% capacity/lv | None |
| 3 | Critical Hit Chance | 20 | +1% crit/lv | Attack Power lv 10 |
| 4 | Critical Hit Damage | 20 | +5% crit dmg/lv | Crit Chance lv 10 |
| 5 | Rally Capacity | 15 | +1 participant/lv | Attack lv 5 + Defense lv 5 |
| 6 | Encounter Success | 20 | +2%/lv | None |
| 7 | Loot Bonus | 20 | +2%/lv | None |
| 8 | Unit Training Speed | 20 | +5%/lv | None |
| 9 | Ambush Damage | 15 | +3%/lv | Attack Power lv 15 |

**Economy Research (10 nodes):**

| Type | Name | Max Lvl | Buff | Prereq |
|------|------|---------|------|--------|
| 10 | Production Efficiency | 25 | +2%/lv | None |
| 11 | Resource Capacity | 25 | +2%/lv | None |
| 12 | Market Tax Reduction | 20 | -1% tax/lv | Production Efficiency lv 10 |
| 13 | Trade Speed | 20 | +5%/lv | None |
| 14 | Mining Output | 20 | +3%/lv | None |
| 15 | Cash Generation | 20 | +3%/lv | None |
| 16 | Construction Speed | 20 | +5%/lv | None |
| 17 | Upkeep Reduction | 20 | -2%/lv | Resource Capacity lv 15 |
| 18 | Black Market Access | 10 | Unlock rare items/lv | Market Tax Reduction lv 15 |
| 19 | Tax Collection | 15 | +2%/lv | None |

**Growth Research (10 nodes):**

| Type | Name | Max Lvl | Buff | Prereq |
|------|------|---------|------|--------|
| 20 | Daily Rewards System | 5 | +50% daily/lv | None |
| 21 | Mining Operations | 10 | +10% mining/lv | Collection Mastery lv 5 |
| 22 | Fishing Industry | 10 | +10% fishing/lv | Collection Mastery lv 10 |
| 23 | Loot Magnetism | 15 | +5% extra loot/lv | Lucky Streak lv 10 |
| 24 | Reputation Mastery | 20 | +3% rep/lv | None |
| 25 | Stamina Vitality | 25 | +4% max stamina/lv | None |
| 26 | Lucky Streak | 20 | +50 bps luck/lv | Reputation Mastery lv 5 |
| 27 | Fragment Discovery | 15 | +5% frag drop/lv | Loot Magnetism lv 5 |
| 28 | Gem Prospecting | 10 | +0.5% gem drop/lv | Fragment Discovery lv 5 |
| 29 | Collection Mastery | 20 | +2% all collection/lv | None |

Time scaling: `base_time * (1.5 ^ level)` — ranges from 30 min (lv 1) to 30 days (lv 25).
Cost scaling: `base_cost * (1.8 ^ level)` — exponential NOVI sink.
Speed-up: gems/min scales by level bracket (1→2→5→10→20 gems/min).

### `data/subscriptions.ts`

4 subscription tier configs (232 bytes each). **Always updated** on every run.

| Field | Rookie | Expert | Epic | Legendary |
|-------|--------|--------|------|-----------|
| Cost (USD cents) | 0 | 999 | 4999 | 24999 |
| Duration (days) | 0 | 30 | 30 | 30 |
| Generation multiplier | 100 | 150 | 250 | 500 |
| Max locked NOVI | 100,000 | 1,000,000 | 10,000,000 | 100,000,000 |
| Daily reward multiplier | 100 | 150 | 200 | 300 |
| Rally caps | 1/1 | 3/3 | 5/5 | 10/10 |
| Max team members | 5 | 15 | 30 | 50 |
| Travel speed bonus (bps) | 0 | 1000 | 2500 | 5000 |

Plus per-tier resource bonuses (DU1-3, OP1-3, weapons, armor, produce, vehicles, reputation, XP).

### `data/shop-items.ts`

**Items** (updatable — price, active, stock):

| Item ID | Name | Type | Category | Price (SOL) | Max/Player | Max/Day |
|---------|------|------|----------|-------------|------------|---------|
| 1 | Gem Pack (100) | 50 | Currency | 0.01 | 0 | 0 |
| 2 | Fragment Pack (100) | 52 | Currency | 0.01 | 0 | 0 |
| 3 | Material Pack (50) | 200 | Material | 0.01 | 0 | 0 |
| 4 | Stamina Refill | 53 | Consumable | 0.005 | 0 | 10 |
| 5 | Small NOVI Pack | 51 | Currency | 0.05 | 0 | 0 |

**Bundles** (updatable — price, active, savings):

| Bundle ID | Name | Items | Price (SOL) | Savings (bps) |
|-----------|------|-------|-------------|---------------|
| 1 | Starter Bundle | Gems x200, Fragments x100, Materials x50 | 0.02 | 1500 |
| 2 | Combat Bundle | Fragments x500, Stamina x3 | 0.04 | 2000 |

### `data/dungeons.ts`

Dungeon templates. **Immutable** — skip if exists.

| Template ID | Name | Theme | Floors | Rooms/Floor | Min Level | Stamina | Boss Power |
|-------------|------|-------|--------|-------------|-----------|---------|------------|
| 1 | Goblin Caves | 0 | 5 | 4 | 5 | 10 | 150 |
| 2 | Shadow Crypt | 1 | 8 | 5 | 15 | 20 | 200 |
| 3 | Dragon's Lair | 2 | 12 | 6 | 30 | 35 | 300 |
| 4 | Abyssal Depths | 3 | 15 | 7 | 50 | 50 | 400 |

Each includes checkpoint intervals, room type weights, darkness config, time limits, reward config.

### `data/castles.ts`

One castle per city (24 total). **Immutable** — skip if exists.

| Castle ID | City | Tier | Min Level | Min Networth (M) | Min Troops (K) |
|-----------|------|------|-----------|-------------------|----------------|
| 0 | New York | Citadel | 30 | 50 | 10 |
| 1 | Los Angeles | Fortress | 25 | 30 | 8 |
| 2 | Chicago | Stronghold | 20 | 20 | 5 |
| ... | ... | ... | ... | ... | ... |

### `data/events.ts`

Starter events. **Immutable** per event — new entries in data file are created on next run.

| Event ID | Name | Type | Duration | Min Level | Prize Type | Prize Amount |
|----------|------|------|----------|-----------|------------|-------------|
| 1 | Launch Tournament | 0 | 7 days | 1 | LockedNovi | 1,000,000 |
| 2 | Weekly PvP | 1 | 7 days | 10 | Gems | 10,000 |
| 3 | Newcomer Challenge | 2 | 14 days | 1 | Cash | 50,000 |

### `data/arena.ts`

Arena season config. **Immutable** per season — skip if exists.

```typescript
export const ARENA_SEASON = {
  seasonId: 1,
  masterPrizePool: 500_000,
  dailyPrizePool: 10_000,
  dailyDistributionCap: 50_000,
  minLevelRequired: 10,
};
```

---

## Phase Details

### Phase 1 — Engine (`novus init engine`)

Creates the kingdom root account.

- Derives GameEngine PDA from kingdom ID
- If exists: **skip** (immutable)
- If not: create with full config (economic, gameplay, minting, theme)
- Also creates NOVI mint (kingdom 0 only)
- Sets authority = DAO keypair, treasury = treasury keypair
- On localnet: airdrops 50 SOL to authority, 1 SOL to treasury

### Phase 2 — Cities (`novus init cities`)

Creates all 24 cities using batch instruction.

- 3 transactions: cities 0-7, 8-15, 16-23
- Uses `createBatchCitiesInstruction` (instruction 5, up to 8 per tx)
- Each city checked individually — batch skips already-created cities
- Coordinates quantized to grid: `Math.round(coord * 10000)`
- City IDs must match HERO_GALLERY.md meditation city references (0=Any, 1=London, 2=Paris, etc.)

### Phase 3 — Heroes (`novus init heroes`)

Creates hero collection + 79 templates.

- Step 1: Create hero collection (skip if exists)
- Step 2: For each of 79 templates:
  - If not exists -> `createCreateTemplateInstruction` (instruction 130)
  - If exists and supply cap changed -> `createUpdateSupplyCapInstruction` (instruction 311)
  - If exists and supply cap unchanged -> skip
- Templates created in parallel batches of 8

### Phase 4 — Research (`novus init research`)

Creates or updates all 30 research templates (Battle=10, Economy=10, Growth=10).

- For each of 30 templates (research_type 0-29):
  - If not exists -> `createInitializeTemplateInstruction` (instruction 120)
  - If exists -> `createUpdateTemplateInstruction` (instruction 126) with latest config
- Update uses the 0=no-change pattern (pass 0 for unchanged fields)
- Must include prerequisite chain data for tech tree dependencies
- All 30 templates defined in `docs/RESEARCH.md`

### Phase 5 — Subscriptions (`novus init subscriptions`)

Updates all 4 subscription tier configs.

- **Always runs** — subscription configs are frequently tuned
- Calls `createUpdateTierConfigInstruction` (instruction 101) for each tier (0-3)
- Full 232-byte struct per tier written on every run
- 4 transactions total

### Phase 6 — Shop (`novus init shop`)

Creates or updates shop infrastructure.

- Step 1: Create ShopConfig (skip if exists)
- Step 2: Items — create if missing (150), update if exists (151)
- Step 3: Bundles — create if missing (153), update if exists (154)
- Step 4: Allowed tokens — create if missing (157), update if exists (158)
- Step 5: Update shop config oracle feeds (155)

### Phase 7 — Dungeons (`novus init dungeons`)

Creates dungeon templates and initial leaderboards.

- For each template: create if missing (258), skip if exists
- Creates week 1 leaderboard for each dungeon (260)

### Phase 8 — Castles (`novus init castles`)

Creates one castle per city.

- For each castle: create if missing (270), skip if exists
- 20 transactions (one per castle)

### Phase 9 — Arena (`novus init arena`)

Creates the first arena season.

- If not exists -> `createCreateSeasonInstruction` (230)
- If exists -> skip

### Phase 10 — Events (`novus init events`)

Creates starter events.

- For each event in data file:
  - Derive event PDA from game engine + event ID
  - If not exists -> `createCreateEventInstruction` (80)
  - If exists -> skip
- New events added to data file will be created on next run

---

## Update Capability Matrix

| Account Type | Create | Update | `init` behavior | `update` behavior |
|---|---|---|---|---|
| GameEngine | 0 | — | Skip if exists | Error (immutable) |
| Cities | 3 / 5 | — | Skip if exists | Error (immutable) |
| Hero Templates | 130 | 311 (cap only) | Update cap if changed | Update caps only |
| Research Templates | 120 | 126 | Create or update | Update only |
| Subscription Tiers | — | 101 | Always update | Always update |
| Shop Config | 140 | 155 | Create or update oracle | Update oracle only |
| Shop Items | 150 | 151 | Create or update | Update only |
| Shop Bundles | 153 | 154 | Create or update | Update only |
| Allowed Tokens | 157 | 158 | Create or update | Update only |
| Dungeon Templates | 258 | — | Skip if exists | Error (immutable) |
| Dungeon Leaderboards | 260 | — | Skip if exists | Error (immutable) |
| Castles | 270 | — | Skip if exists | Error (immutable) |
| Arena Seasons | 230 | — | Skip if exists | Error (immutable) |
| Events | 80 | — | Skip/create new | Error (immutable) |

---

## Example Output

### `novus init all`

```
novus — Novus Mundus CLI

  Environment:  localnet
  Kingdom:      0
  Authority:    7xK...3Qp

Phase 1/10 — Engine
  - GameEngine [exists]
  - NOVI Mint [exists]

Phase 2/10 — Cities
  + Batch 1: cities 0-7 [8 created]
  + Batch 2: cities 8-15 [8 created]
  + Batch 3: cities 16-19 [4 created]

Phase 3/10 — Heroes
  - Hero Collection [exists]
  + 75 templates created
  - 4 templates [exist]
  ~ 3 supply caps updated

Phase 4/10 — Research
  ~ 20 templates updated
  - 10 templates [unchanged]

Phase 5/10 — Subscriptions
  ~ Rookie [updated]
  ~ Expert [updated]
  ~ Epic [updated]
  ~ Legendary [updated]

Phase 6/10 — Shop
  - ShopConfig [exists]
  + 2 items created
  ~ 3 items updated
  ~ 2 bundles updated
  ~ Oracle config updated

Phase 7/10 — Dungeons
  + 4 templates created
  + 4 leaderboards created

Phase 8/10 — Castles
  + 24 castles created

Phase 9/10 — Arena
  + Season 1 created

Phase 10/10 — Events
  + 3 events created

Done — 10 phases, 124 created, 18 updated, 9 skipped
```

### `novus status`

```
novus — Kingdom 0 Status (localnet)

System              Status    Details
──────────────────────────────────────────────────
GameEngine          ok        Authority: 7xK...3Qp
NOVI Mint           ok        Total minted: 1,234,567
Cities              ok        24/24
Heroes              ok        Collection + 79/79 templates
Research            ok        30/30 templates
Subscriptions       ok        4 tiers
Shop                ok        Config + 5 items + 2 bundles
Dungeons            ok        4 templates, 4 leaderboards
Castles             ok        24/24
Arena               ok        Season 1
Events              ok        3 events
```

### `novus init all --dry-run`

```
novus — Novus Mundus CLI (DRY RUN)

Phase 1/10 — Engine
  [dry-run] Would skip GameEngine [exists]

Phase 2/10 — Cities
  [dry-run] Would create 24 cities in 3 batches

Phase 3/10 — Heroes
  [dry-run] Would skip Hero Collection [exists]
  [dry-run] Would create 75 hero templates
  [dry-run] Would update 3 supply caps
...
```

### `novus status heroes`

```
novus — Hero Templates (Kingdom 0)

 ID  Name           Tier       Cost    Cap    Minted  Enabled
──────────────────────────────────────────────────────────────
  1  Warrior        Common     0.10    4000   127     yes
  2  Archer         Common     0.10    4000   89      yes
  3  Mage           Common     0.10    4000   156     yes
  4  Paladin        Common     0.10    4000   201     yes
  5  Shadow Blade   Rare       0.25    1000   34      yes
  6  Storm Caller   Rare       0.25    1000   22      yes
  ...
 163 Chronos        Mythic     25.00   10     0       yes

Summary: 79 templates, 4,231 total minted
```
