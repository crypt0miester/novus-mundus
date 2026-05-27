# Novus Mundus CLI — `novus`

Status: live · Last touched: 2026-05-27

Single CLI for initializing and operating a Novus Mundus kingdom. Lives at `sdks/novus-mundus-ts/cli/cli.ts`. Every account-creating command is **idempotent** — safe to re-run after partial failure or a config tweak.

### Create-or-Update pattern

- **Updatable accounts** (research, shop items, bundles, subscription tiers, castle config) → check if exists, run the update instruction with the latest config when it does.
- **Immutable accounts** (GameEngine, cities, hero templates, dungeon templates, building templates, castles, arena seasons, events) → check if exists, skip if yes, create if no.
- **Always-update accounts** (subscription tier configs) → always write the latest config every run.

---

## CLI Interface

```
novus <command> [target] [options]

Global Options:
  --env <localnet|devnet|mainnet>      Target environment (default: localnet)
  --kingdom-id <number>                Kingdom ID (default: 0)
  --kingdom-name <string>              UTF-8, max 32 bytes (default: "Genesis")
  --theme <0-4 | name>                 medieval / cyberpunk / scifi / modern / postapocalyptic
  --kingdom-start-time <unix|iso>      When gameplay opens (default: 0 = immediately)
  --registration-closes-at <unix|iso>  Hard cap on new joins (default: 0 = never)
  --authority <keypair-path>           DAO authority keypair (default: keys/dao-authority.json)
  --treasury <keypair-path>            Treasury keypair (default: keys/treasury.json)
  --dry-run                            Simulates via simulateTransaction; never sends
  --verbose                            Show transaction signatures + CU usage
  --from <phase>                       Resume `init all` from phase N
```

### Commands

```
novus init all                       Initialize everything (phases 1-11)
novus init all --from 5              Resume from phase 5
novus init engine                    Phase 1: GameEngine + NOVI mint
novus init cities                    Phase 2: 24 cities
novus init heroes                    Phase 3: Hero collection + templates
novus init research                  Phase 4: 30 research templates
novus init buildings                 Phase 5: Building templates
novus init subscriptions             Phase 6: 4 subscription tier configs
novus init shop                      Phase 7: ShopConfig + items + bundles + flash sales
novus init dungeons                  Phase 8: Dungeon templates + leaderboards
novus init castles                   Phase 9: Castles (one per non-Ashenmere city)
novus init arena                     Phase 10: Arena season 1
novus init events                    Phase 11: Starter events

novus status                         Overview of all systems
novus status <target>                Detailed view of one system

novus update research                Re-apply research template configs
novus update subscriptions           Re-apply subscription tier configs
novus update shop                    Re-apply shop item/bundle configs
novus update heroes --supply-caps    Update hero template supply caps
novus update castle-config           Update castle names

novus crank all                      Run every permissionless crank
novus crank <target>                 subscriptions | events | arena | dungeons | castles | rallies | oracle

novus flash-sale create|close|activate|list      DAO flash-sale management
novus oracle config|init-quote|init-alt|allow-token|buy|status   Token-payment plumbing
novus show player|team|rally|expedition|reinforcement|loot|dungeon  Read-only inspection
novus create-player --tier <t> --count <n>       Generate test players
novus encounters spawn|status|cleanup            DAO auto-spawn + sweep

novus validator start|stop|status                Local test validator lifecycle
novus reset                                      validator stop → start --reset → init all
novus logs [--all]                               Tail program logs
novus airdrop <pubkey|dao|treasury>              Localnet SOL airdrop
novus deploy [--skip-build]                      Build + deploy program
novus snapshot save|load|list|delete <name>      Validator ledger snapshots
novus nuke                                       Full reset + init + populate
novus player fund|travel|deposit|sweep           Operate on existing players
novus team join                                  Test players accept open invite
```

### Running

```bash
cd sdks/novus-mundus-ts

# Most common — gets you from zero to a populated dev kingdom:
bun run novus nuke --tier advanced --count 10

# Pieces of the same thing:
bun run novus validator start --reset    # boot a fresh local validator
bun run novus deploy                      # build + deploy program
bun run novus init all                    # all 11 phases
bun run novus create-player --tier epic --count 5
bun run novus encounters spawn --all --count 3 --rarity rare

# Push a tuning change without redeploying:
$EDITOR cli/data/shop-items.ts
bun run novus update shop

# Verify state without writing anything:
bun run novus status
bun run novus status heroes
```

Localnet auto-airdrops 50 SOL to authority and 1 SOL to treasury on every context build. Devnet / mainnet expect the keypairs to already be funded.

---

## File Structure

```
sdks/novus-mundus-ts/cli/
├── cli.ts                          # Entry — argv parse + dispatch
├── README.md                       # User-facing command reference
├── lib/
│   ├── context.ts                  # Connection, keypairs, derived PDAs, argv
│   ├── helpers.ts                  # accountExists, sendWithRetry, createOrSkip,
│   │                               # createOrUpdate, updateOnly, batchSend, log
│   ├── format.ts                   # table, badges, colors
│   ├── commands/                   # one file per top-level command
│   │   ├── init.ts                 status.ts            update.ts
│   │   ├── crank.ts                flash-sale.ts        oracle.ts
│   │   ├── show.ts                 create-player.ts     encounters.ts
│   │   ├── validator.ts            reset.ts             logs.ts
│   │   ├── airdrop.ts              deploy.ts            player.ts
│   │   ├── snapshot.ts             nuke.ts              team.ts
│   ├── phases/                     # one per init phase
│   │   ├── engine.ts               cities.ts            heroes.ts
│   │   ├── research.ts             buildings.ts         subscriptions.ts
│   │   ├── shop.ts                 dungeons.ts          castles.ts
│   │   ├── arena.ts                events.ts
│   ├── cranks/                     # one per permissionless crank
│   │   ├── subscriptions.ts        events.ts            arena.ts
│   │   ├── dungeons.ts             castles.ts           rallies.ts
│   │   ├── oracle.ts
│   └── show/                       # inspection helpers for `show`
│       ├── player.ts               team.ts              rally.ts
│       ├── expedition.ts           reinforcement.ts     loot.ts
│       ├── dungeon.ts              mint.ts              user.ts
└── data/                           # source-of-truth config tables
    ├── cities.ts                   castles.ts           heroes.ts
    ├── research.ts                 buildings.ts         subscriptions.ts
    ├── shop-items.ts               flash-sales.ts       dungeons.ts
    ├── events.ts                   arena.ts             player-tiers.ts
```

35 files in `cli/`, 12 source-of-truth data tables.

---

## CLI Entry Point

`cli.ts` parses argv, builds context, routes to a handler. No external CLI framework — raw `process.argv` parsing keeps deps minimal.

```typescript
const args = parseArgs(process.argv.slice(2));

// validator command runs without RPC (manages a local process)
if (args.command === 'validator') {
  await handleValidator(null, args);
  return;
}

const ctx = await buildContext(args);
log.header(`Kingdom ${ctx.kingdomId} (${ctx.env})`);

switch (args.command) {
  case 'init':           await handleInit(ctx, args); break;
  case 'status':         await handleStatus(ctx, args); break;
  case 'update':         await handleUpdate(ctx, args); break;
  case 'crank':          await handleCrank(ctx, args); break;
  case 'flash-sale':     await handleFlashSale(ctx, args); break;
  case 'oracle':         await handleOracle(ctx, args); break;
  case 'show':           await handleShow(ctx, args); break;
  case 'create-player':  await handleCreatePlayer(ctx, args); break;
  case 'encounters':     await handleEncounters(ctx, args); break;
  case 'reset':          await handleReset(ctx, args); break;
  case 'logs':           await handleLogs(ctx, args); break;
  case 'airdrop':        await handleAirdrop(ctx, args); break;
  case 'deploy':         await handleDeploy(ctx, args); break;
  case 'player':         await handlePlayer(ctx, args); break;
  case 'snapshot':       await handleSnapshot(ctx, args); break;
  case 'nuke':           await handleNuke(ctx, args); break;
  case 'team':           await handleTeam(ctx, args); break;
  default:               printUsage();
}
```

---

## Context Layer

### `lib/context.ts`

```typescript
export interface CLIContext {
  connection: Connection;
  env: 'localnet' | 'devnet' | 'mainnet';
  kingdomId: number;
  kingdomName: string;             // max 32 UTF-8 bytes
  theme: number;                   // 0=Medieval, 1=Cyberpunk, 2=SciFi, 3=Modern, 4=PostApocalyptic
  kingdomStartTime: number;        // unix seconds, 0 = immediate
  registrationClosesAt: number;    // unix seconds, 0 = never
  daoAuthority: Keypair;
  treasury: Keypair;
  gameEngine: PublicKey;           // derived from kingdomId
  noviMint: PublicKey;             // derived
  heroCollection: PublicKey;       // derived
  dryRun: boolean;
  verbose: boolean;
}
```

- `buildContext(args)` — resolves env, loads keypairs, derives PDAs, auto-airdrops on localnet.
- `parseArgs(argv)` — hand-rolled argv parser; positional 0=command, 1=target, 2=extra.
- `loadKeypair(path)` — reads JSON byte array; auto-generates if missing.
- `parseTheme(v)` — accepts integer 0-4 or name string.
- RPC URLs: localnet=`http://localhost:8899`, devnet=`https://api.devnet.solana.com`, mainnet=`$RPC_MAINNET` or default. `RPC_URL` env var overrides any.

### `lib/helpers.ts`

| Helper | Behaviour |
|--------|-----------|
| `accountExists(connection, pda)` | `getAccountInfo` !== null |
| `createOrSkip(ctx, name, pda, buildIx, stats)` | If exists → skip + `stats.skipped++`. Else → send + `stats.created++` |
| `createOrUpdate(ctx, name, pda, buildCreate, buildUpdate, stats)` | If missing → create; else → update. Returns `'created' \| 'updated' \| 'skipped'` |
| `updateOnly(ctx, name, pda, buildUpdate, stats)` | Errors if missing; else update |
| `sendWithRetry(ctx, ix, signers, opts?)` | Exponential backoff (3 retries), prepends CU budget ixs when `opts.computeUnits` set, simulates in `--dry-run` |
| `novusSimulateTransaction(ctx, ix, signers)` | Build signed v0 tx and `simulateTransaction` against live RPC — used by `--dry-run` and `opts.simulate` |
| `batchSend(ctx, items, builder, concurrency=4)` | Parallel send with concurrency cap |
| `log.header/phase/create/update/skip/summary/done/error/dryRun/info/totalSummary` | Boxed section header, per-phase header, per-item lines, totals |

`--dry-run` short-circuits `sendWithRetry`: it builds a signed v0 transaction, calls `simulateTransaction`, and fails loud if simulation errors. No write hits the wire — so CU overruns and missing-account errors surface before mainnet.

---

## Commands

### `novus init <target>`

Creates and/or updates accounts. Each phase is idempotent.

| Phase | Target | Creates | Update behaviour |
|------:|--------|---------|------------------|
| 1 | `engine` | `GameEngine` + (kingdom 0 only) NOVI mint | Skip if exists |
| 2 | `cities` | 24 `CityAccount`s via `createBatchCitiesInstruction` (8/tx) | Skip if exists |
| 3 | `heroes` | `HeroCollection` + 83 hero-template PDAs (parallel 8/batch) | Skip if exists (supply cap update via `update heroes --supply-caps`) |
| 4 | `research` | 30 research-template PDAs (`createInitializeTemplateInstruction`) | `createUpdateTemplateInstruction` (0 = leave-unchanged) |
| 5 | `buildings` | Building-template PDAs | Skip if exists |
| 6 | `subscriptions` | — | **Always update** all 4 tiers via `createUpdateTierConfigInstruction` |
| 7 | `shop` | `ShopConfig`, items, bundles, flash sales | Items + bundles `createOrUpdate`; flash sales `createOrSkip` + optional `activate` |
| 8 | `dungeons` | 4 dungeon templates + initial leaderboards | Skip if exists |
| 9 | `castles` | 23 castles (one per non-Ashenmere city) + N² `LocationAccount`s | Skip if exists; rename via `update castle-config` |
| 10 | `arena` | Arena season 1 | Skip if exists |
| 11 | `events` | Starter events from `data/events.ts` | Skip if exists; new entries created on next run |
| — | `all` | Everything above | Everything above |

`novus init all --from 5` skips phases 1-4 and starts at buildings.

The retired **terrain phase** is intentionally absent — biome is a pure function of `(biome_seed, ox, oy)` sampled at the point of use, not an upload. See `programs/novus_mundus/src/logic/biome.rs`.

### `novus status [target]`

Read-only inspection. No transactions sent.

```
novus status
```

```
Kingdom 0 Status (localnet)

System              Status    Details
─────────────────────────────────────────────
GameEngine          OK        Authority: 7xK...3Qp
Cities              OK        24
Heroes              OK        Collection + 83 templates
Research            OK        30 templates
Subscriptions       OK        4 tiers
Shop                OK        Config + N items + M bundles
Dungeons            OK        4 templates, 4 leaderboards
Castles             OK        23
Arena               OK        Season 1
Events              OK        3 events
```

```
novus status castles
```

Prints a column-aligned table per castle: id, name, tier, city, king, status, garrison/court counts, min level. Each phase exports a `detailX(ctx)` function rendering its own table.

### `novus update <target>`

Update-only mode. Errors if the target account doesn't exist (use `init` for that).

| Target | What it updates |
|--------|-----------------|
| `research` | Cost, duration, buffs, max level (`createUpdateTemplateInstruction`) |
| `subscriptions` | All 4 tier configs (`createUpdateTierConfigInstruction`) |
| `shop` | Item price/active/featured + bundle price/active/savings (`createUpdateItemInstruction`, `createUpdateBundleInstruction`) |
| `heroes --supply-caps` | Hero template supply caps (`createUpdateSupplyCapInstruction`) |
| `castle-config` | Castle names (`createUpdateCastleConfigInstruction`, config type 3) |

The `--supply-caps` flag is required for `update heroes` to avoid foot-guns (the create path lives in `init heroes`).

### `novus crank [target|all]`

Permissionless time-based progressions. Files in `lib/cranks/`.

| Target | Drives |
|--------|--------|
| `subscriptions` | Process expirations / tier downgrades |
| `events` | Stage transitions (registration → active → finalize) |
| `arena` | Season rollover |
| `dungeons` | Leaderboard rolls (weekly) |
| `castles` | Status transitions (Contest → Protected → Vulnerable) |
| `rallies` | Rally completion / payout |
| `oracle` | Oracle price refresh / staleness checks |

Each crank handles its own "is there work?" check — safe to schedule on a loop. `crank all` runs every crank in order.

---

## Data Files

### `data/cities.ts`

24 cities. `radiusKm` is the source-of-truth sizing parameter; the phase translates it via `dimsFromRadius(radiusKm)` into the chain's `widthGrid` / `heightGrid` (square plot, centred AABB). Biome seed comes from `seedForCity(id) = 0xCAFE0000 | id`. Per-cell biome is NOT stored — it's sampled on demand from the seed + knobs.

```typescript
export interface CityData {
  id: number; name: string;
  lat: number; lon: number;       // real-world coord = "Old Name"
  radiusKm: number;               // source-of-truth size
  type: CityType;                 // 0=Capital, 1=Resource, 2=Combat, 3=Trade
  biome: CityBiomePreset;         // required; use BIOME_PROCEDURAL for procedural defaults
}

export interface CityBiomePreset {
  waterLevelDelta: number;        // +127 ~ no water, -96 ~ all water, 0 baseline
  tempBias: number;               // ±64 ≈ one Whittaker bucket shift
  moistureBias: number;           // same magnitude
  coast: number;                  // 0=none, 1..=8 = N/NE/E/SE/S/SW/W/NW (sea direction)
  landmassSeed: number;           // 0=no mask, >0 carves organic islands
}
```

| ID | Name | Old name | Type | Radius | Biome flavour |
|---:|------|----------|------|-------:|---------------|
| 0  | Valdenmoor    | London         | Capital  | 52 km | procedural |
| 1  | Coranthas     | Paris          | Capital  | 45 km | procedural |
| 2  | Solterrae     | Rome           | Capital  | 40 km | temp +30, dry −10 (Mediterranean) |
| 3  | Kael Mora     | Athens         | Combat   | 35 km | temp +30, dry −20, coast SE |
| 4  | Thornmark     | Berlin         | Trade    | 40 km | temp −20, moist +10 (cool temperate) |
| 5  | Vraenholdt    | Moscow         | Combat   | 50 km | high-water +127, temp −100 (snow + rock) |
| 6  | Kaelindra     | Istanbul       | Trade    | 45 km | temp +20, coast N (Bosphorus) |
| 7  | Auren Khet    | Cairo          | Resource | 50 km | high-water +127, temp +80, arid −100 (desert) |
| 8  | Solvaran      | Dubai          | Trade    | 45 km | water +80, temp +100, arid −100, coast N (Gulf) |
| 9  | Korthain      | Baghdad        | Combat   | 40 km | water +110, temp +70, arid −90 |
| 10 | Duskara       | Lagos          | Resource | 45 km | water −20, temp +80, moist +60, coast S, islands=5 |
| 11 | Shirevane     | Tokyo          | Capital  | 55 km | water +10, temp +20, moist +30, islands=17 |
| 12 | Drenmire      | Beijing        | Capital  | 50 km | temp +10, moist −30 |
| 13 | Pelagora      | Shanghai       | Trade    | 48 km | water −20, temp +30, moist +40, coast E |
| 14 | Aelthis       | Seoul          | Capital  | 45 km | temp −30, moist +10, coast W (Yellow Sea) |
| 15 | Lyssandor     | Singapore      | Trade    | 35 km | water −40, temp +90, moist +90, islands=11 (tropical archipelago) |
| 16 | Maravhen      | Mumbai         | Trade    | 50 km | water −20, temp +70, moist +50, coast W |
| 17 | Ashenveil     | New York       | Trade    | 50 km | water −10, temp +10, coast E, islands=7 |
| 18 | Eldrath       | Los Angeles    | Capital  | 55 km | water +30, temp +60, arid −50, coast W |
| 19 | Tonalca       | Mexico City    | Resource | 50 km | water +80, temp +50, arid −20 (highland plateau) |
| 20 | Verador       | São Paulo      | Trade    | 50 km | temp +50, moist +40 (humid subtropical) |
| 21 | Mirethane     | Sydney         | Capital  | 45 km | water −10, temp +30, coast E, islands=19 |
| 22 | Grimhollow    | Johannesburg   | Resource | 45 km | water +90, temp +30, arid −40 (highveld) |
| 23 | Seralune      | Rio de Janeiro | Capital  | 42 km | water −10, temp +60, moist +40, coast E, islands=13 |

### `data/heroes.ts`

83 hero NFT templates across 5 categories. **Immutable** — supply caps are the only field that can be updated post-create (via `update heroes --supply-caps`).

```typescript
export interface HeroTemplateData {
  templateId: number;              // non-sequential, grouped by category
  name: string;                    // max 32 bytes, null-padded on chain
  heroType: number;                // 0=Offensive, 1=Defensive, 2=Economic, 3=Hybrid
  category: number;                // 0=Historical, 1=Mythological, 2=CryptoIcons, 3=Gaming, 4=Original
  mintCostLamports: number;
  supplyCap: number;               // 0 = unlimited
  enabled: boolean;
  eventExclusive: boolean;
  requiredPlayerLevel: number;
  meditationCityId: number;        // 0=Any, 1-23=specific city
  buffs: { stat: number; baseBps: number }[];   // up to 4 buffs
  abilityKind?: number;
  abilityStat?: number;
  abilityParam1?: number;
  abilityParam2?: number;
  abilityCooldownSecs?: number;
}
```

**Template ID ranges by category:**

| Category | ID Range | Examples |
|----------|----------|----------|
| Common starters | 1-9 | Warrior, Archer, Mage, Paladin |
| Historical | 10-21 | Alexander, Caesar, Napoleon, Genghis Khan |
| Mythological | 50-57 | Zeus, Odin, Thor, Ra, Amaterasu |
| Legends & folk | 70-92 | Robin Hood, Merlin, Mulan, Sinbad, Gilgamesh |
| Crypto / Web3 | 150-155 | Satoshi, Diamond Hands, Degen, Bored Ape |
| Mythic tier | 160-163 | Chronos, Void Walker |
| Original | 200-290 | Theophilos, Kassandra, Astrid, Akira |

**18 buff stat types** (`BuffStat` enum in `src/types/enums.ts`):

| ID | Stat | ID | Stat | ID | Stat |
|---:|------|---:|------|---:|------|
| 1 | AttackPower | 7  | CriticalHitChance | 13 | UnitCapacity |
| 2 | DefensePower | 8  | SynchronyBonus    | 14 | EncounterDamage |
| 3 | CashCollectionRate | 9  | ResourceCapacity  | 15 | LootBonus |
| 4 | XpGain | 10 | WeaponEfficiency  | 16 | ArmorEfficiency |
| 5 | TrainingCostReduction | 11 | StaminaRegen      | 17 | MiningAffinity |
| 6 | RallyCapacity | 12 | ProduceGeneration | 18 | FishingAffinity |

### `data/research.ts`

Re-exports `RESEARCH_CATALOG` from `src/data/research-catalog.ts` — the catalog is the single source of truth shared by this CLI and the web UI. 30 templates split 10 / 10 / 10 across Battle / Economy / Growth.

**Battle research (category 0, types 0-9):**

| Type | Name | Max Lvl | Buff (per lvl) | Prereq |
|-----:|------|--------:|----------------|--------|
| 0 | Attack Power        | 25 | +200 bps  | — |
| 1 | Defense Power       | 25 | +200 bps  | — |
| 2 | Unit Capacity       | 25 | +200 bps  | — |
| 3 | Critical Hit Chance | 20 | +100 bps  | Attack Power lv10 |
| 4 | Critical Hit Damage | 20 | +500 bps  | Crit Chance lv10 |
| 5 | Rally Capacity      | 15 | +100 bps  | Attack Power lv5 |
| 6 | Encounter Success   | 20 | +200 bps  | — |
| 7 | Loot Bonus          | 20 | +200 bps  | — |
| 8 | Unit Training Speed | 20 | +500 bps  | — |
| 9 | Ambush Damage       | 15 | +300 bps  | Attack Power lv15 |

**Economy research (category 1, types 10-19):**

| Type | Name | Max Lvl | Buff (per lvl) | Prereq |
|-----:|------|--------:|----------------|--------|
| 10 | Production Efficiency | 25 | +200 bps | — |
| 11 | Resource Capacity     | 25 | +200 bps | — |
| 12 | Market Tax Reduction  | 20 | +100 bps | Production Efficiency lv10 |
| 13 | Trade Speed           | 20 | +500 bps | — |
| 14 | Mining Output         | 20 | +300 bps | — |
| 15 | Cash Generation       | 20 | +300 bps | — |
| 16 | Construction Speed    | 20 | +500 bps | — |
| 17 | Upkeep Reduction      | 20 | +200 bps | Resource Capacity lv15 |
| 18 | Black Market Access   | 10 | +100 bps | Market Tax Reduction lv15 |
| 19 | Tax Collection        | 15 | +200 bps | — |

**Growth research (category 2, types 20-29):**

| Type | Name | Max Lvl | Buff (per lvl) | Prereq |
|-----:|------|--------:|----------------|--------|
| 20 | Daily Rewards System | 5  | +5000 bps | — |
| 21 | Mining Operations    | 10 | +1000 bps | — |
| 22 | Fishing Industry     | 10 | +1000 bps | — |
| 23 | Loot Magnetism       | 15 | +500 bps  | Lucky Streak lv10 |
| 24 | Reputation Mastery   | 20 | +300 bps  | — |
| 25 | Stamina Vitality     | 25 | +400 bps  | — |
| 26 | Lucky Streak         | 20 | +50 bps   | Reputation Mastery lv5 |
| 27 | Fragment Discovery   | 15 | +500 bps  | Loot Magnetism lv5 |
| 28 | Gem Prospecting      | 10 | +50 bps   | Fragment Discovery lv5 |
| 29 | Collection Mastery   | 20 | +200 bps  | — |

Time scaling: `base_time * (1.5 ^ level)`. Cost scaling: `base_cost * (1.8 ^ level)` (NOVI sink). Gem speed-up cost per minute scales from 1 → 10 by level bracket.

### `data/subscriptions.ts`

4 subscription tier configs. **Always updated** on every run.

| Field | Rookie | Expert | Epic | Legendary |
|-------|------:|------:|----:|---------:|
| Cost (USD cents) | 500 | 1,000 | 5,000 | 25,000 |
| Duration (days) | 30 | 30 | 30 | 30 |
| NOVI generation (per 5min) | 50 | 100 | 500 | 2,500 |
| Max locked NOVI (display) | 3,000 | 6,000 | 30,000 | 150,000 |
| Sign-on NOVI grant (display) | 2,500 | 5,000 | 25,000 | 125,000 |
| Daily reward multiplier | 1.0× | 1.5× | 2.0× | 3.0× |
| Synchrony bonus (bps) | 0 | 500 | 1,000 | 1,500 |
| Cash grant | 10M | 50M | 200M | 1B |
| Defensive units (total) | 25k | 50k | 125k | 300k |
| Operative units (total) | 60k | 120k | 300k | 720k |
| Weapons (total) | 25k | 50k | 125k | 300k |
| Armor | 25k | 50k | 125k | 300k |
| Produce | 50k | 250k | 1.25M | 6.25M |
| Vehicles | 50 | 250 | 1,250 | 6,250 |
| Reputation | 100 | 1,000 | 10,000 | 100,000 |
| XP | 100 | 1,000 | 10,000 | 100,000 |
| Rally caps (active/per-day) | 1/1 | 3/3 | 5/5 | 10/10 |
| Max rally size | 3 | 5 | 10 | 20 |
| Max rally duration | 1h | 2h | 6h | 24h |
| Max team members | 5 | 10 | 25 | 50 |
| Max daily transfer (cash) | 0 | 1B | 25B | ∞ |
| Max daily transfer count | 0 | 25 | 100 | 255 |
| Travel speed bonus (bps) | 0 | 1,000 | 2,500 | 5,000 |

Cost ladder is 1 : 2 : 10 : 50. NOVI perks scale cost-linear. Standard stats (cash, units, weapons, armor) scale 1 : 2 : 5 : 12. Produce/vehicles scale superlinearly 1 : 5 : 25 : 125. Free stats (rep, XP) scale 1 : 10 : 100 : 1000.

### `data/shop-items.ts`

**Items** (create-or-update). Currency/material/consumable items 1-9, then ~131 cosmetic items (badges, titles, colors, frames) 100-140.

| ID | Name | Category | Price (SOL) | Max/player | Max/day |
|---:|------|----------|------------:|-----------:|--------:|
| 1 | Gem Pack (100)        | Currency    | 0.01  | ∞ | ∞ |
| 2 | Fragment Pack (100)   | Currency    | 0.01  | ∞ | ∞ |
| 3 | Material Pack (50)    | Material    | 0.01  | ∞ | ∞ |
| 4 | Stamina Refill (legacy) | Consumable | 0.005 | ∞ | 10 |
| 5 | Small NOVI Pack       | Currency    | 0.05  | ∞ | ∞ |
| 6 | Gem Pack (1,000)      | Currency    | 0.09  | ∞ | ∞ |
| 7 | Gem Pack (10,000)     | Currency    | 0.80  | ∞ | ∞ |
| 8 | Gem Pack (100,000)    | Currency    | 7.00  | ∞ | ∞ |
| 9 | Stamina Refill (100)  | Consumable  | 0.005 | ∞ | 10 |
| 100-108 | Badges (Vanguard's Mark, Kingdom Pioneer, Genesis Patron, Forgemaster, Wanderer, Crowned Patron, Sigilbearer, Sun-Sealed, Goldleafed) | Cosmetic | 0.005 – 0.05 | 1 | — |
| 109-120 | Titles (Wayfarer, Hearthkeeper, Stormcaller, Dungeon Conqueror, Treasury Whale, Realm Pillar, Patron, Maecenas, Endowed, Skirmisher, Lancer, Crossbowman) | Cosmetic | 0.005 – 0.05 | 1 | — |
| 121-136 | Colors (Parchment Ink, Mossbark, Ember, Royal Purple, Goldleaf, Iridescent, Copper, Electrum, Mithril, Adamantine, Obsidian, Pulse, Embered, Glimmer, Vesper, Cinder) | Cosmetic | 0.005 – 0.08 | 1 | — |
| 137-140 | Frames (Parchment Scroll, Royal Crest, Dragon Coil, Starlight Aureole) | Cosmetic | 0.005 – 0.05 | 1 | — |

**Bundles** (create-or-update):

| ID | Name | Contents | Price (SOL) | Savings |
|---:|------|----------|------------:|--------:|
| 1 | Starter Bundle | Gems ×200, Fragments ×100, Materials ×50 | 0.02 | 1500 bps |
| 2 | Combat Bundle  | Fragments ×500, Stamina ×3                | 0.04 | 2000 bps |

### `data/flash-sales.ts`

Per-sale templates. `init shop` step 4 creates each (skip if exists) and optionally activates if `autoActivate` is set. Sale IDs are auto-allocated from `ShopConfig.nextFlashSaleId`.

### `data/dungeons.ts`

4 dungeon templates. **Immutable** — skip if exists. Initial week-1 leaderboard PDA is created alongside each template.

| ID | Name | Theme | Floors | Rooms/floor | Min level | Stamina | Boss multiplier |
|---:|------|------:|------:|------------:|----------:|--------:|-----------------|
| 1 | Goblin Caves     | 0 RadiantWeakness     | 5  | 4 | 5  | 10 | 1.5× |
| 2 | Shadow Crypt     | 1 FastMobs            | 8  | 5 | 15 | 20 | 2.0× |
| 3 | Dragon's Lair    | 2 DarknessVulnerable  | 10 | 6 | 30 | 35 | 3.0× |
| 4 | Abyssal Depths   | 3 ArmoredMobs         | 10 | 7 | 50 | 50 | 4.0× |

Each template carries checkpoint intervals, room-type weights (combat / treasure / camp / rest / trap), darkness config, time limits, and reward scaling — see `data/dungeons.ts` for the full table.

### `data/castles.ts`

23 castles (one per non-Ashenmere city). **Immutable** — skip if exists. Names updatable via `update castle-config`. `latitude` / `longitude` are **grid-unit anchor corner** values (×10,000 = `LocationAccount` precision); `footprintSize` defaults from tier via `defaultFootprintForTier()`:

```
tier 0 Outpost     → 2
tier 1 Keep        → 2
tier 2 Stronghold  → 3
tier 3 Fortress    → 3
tier 4 Citadel     → 4
```

| ID | Name | City | Tier | Min level | Min networth (M) | Min troops (k) |
|---:|------|-----:|------|----------:|-----------------:|---------------:|
| 0  | Tower of London     | 1  | 4 Citadel    | 30 | 50 | 10 |
| 1  | Bastille Fortress   | 2  | 3 Fortress   | 25 | 30 | 8 |
| 2  | Castel Sant Angelo  | 3  | 3 Fortress   | 25 | 30 | 8 |
| 3  | Acropolis Citadel   | 4  | 4 Citadel    | 30 | 50 | 10 |
| 4  | Brandenburg Gate    | 5  | 2 Stronghold | 20 | 20 | 5 |
| 5  | Kremlin Fortress    | 6  | 4 Citadel    | 30 | 50 | 10 |
| 6  | Topkapi Palace      | 7  | 3 Fortress   | 25 | 30 | 8 |
| 7  | Cairo Citadel       | 8  | 3 Fortress   | 25 | 30 | 8 |
| 8  | Edo Castle          | 9  | 4 Citadel    | 30 | 50 | 10 |
| 9  | Forbidden City      | 10 | 4 Citadel    | 30 | 50 | 10 |
| 10 | Shanghai Keep       | 11 | 2 Stronghold | 20 | 20 | 5 |
| 11 | Gyeongbok Palace    | 12 | 2 Stronghold | 20 | 20 | 5 |
| 12 | Mumbai Fort         | 13 | 2 Stronghold | 20 | 20 | 5 |
| 13 | Sydney Stronghold   | 14 | 1 Keep       | 15 | 10 | 3 |
| 14 | Dubai Citadel       | 15 | 3 Fortress   | 25 | 30 | 8 |
| 15 | Baghdad Palace      | 16 | 3 Fortress   | 25 | 30 | 8 |
| 16 | Liberty Fortress    | 17 | 4 Citadel    | 30 | 50 | 10 |
| 17 | Aztec Stronghold    | 18 | 2 Stronghold | 20 | 20 | 5 |
| 18 | Bandeirantes Fort   | 19 | 2 Stronghold | 20 | 20 | 5 |
| 19 | La Plata Keep       | 20 | 1 Keep       | 15 | 10 | 3 |
| 20 | Inca Citadel        | 21 | 1 Keep       | 15 | 10 | 3 |
| 21 | Lagos Outpost       | 22 | 0 Outpost    | 10 |  5 | 2 |
| 22 | Nairobi Outpost     | 23 | 0 Outpost    | 10 |  5 | 2 |

`create_castle` creates the `CastleAccount` plus `footprintSize²` `LocationAccount`s, each marked `OCCUPANT_CASTLE`. A tier-4 Citadel creates 16 LocationAccounts in one tx — well under the 200k CU budget at ~4k CU per Location.

### `data/events.ts`

Starter events. **Immutable** per event — new entries added to the data file are created on the next run.

| ID | Name | Type | Duration | Min level | Prize type | Prize amount |
|---:|------|-----:|---------:|----------:|------------|-------------:|
| 1 | Launch Tournament   | 0 | 7 days  | 1  | LockedNOVI | 1,000,000 |
| 2 | Weekly PvP          | 1 | 7 days  | 10 | Gems       | 10,000    |
| 3 | Newcomer Challenge  | 2 | 14 days | 1  | Cash       | 50,000    |

### `data/arena.ts`

Arena season 1 config. **Immutable** per season — skip if exists.

```typescript
export const ARENA_SEASON = {
  seasonId: 1,
  masterPrizePool: 500_000,
  dailyPrizePool: 10_000,
  dailyDistributionCap: 50_000,
  minLevelRequired: 10,
};
```

### `data/buildings.ts`

Building templates per on-chain building type — cost / time / unlock data. Created via building-template instructions; immutable post-create.

### `data/player-tiers.ts`

Consumed by `create-player`, not by any init phase. Defines preset power tiers:

| Aspect | beginner | advanced | epic | legendary |
|--------|----------|----------|------|-----------|
| Init (user+player+research) | yes | yes | yes | yes |
| Estate + gems | no | yes + 10 | yes + 50 | yes + 200 |
| Buildings | none | Mansion, Barracks, Market | + Stables, Workshop, Academy, Citadel | All 19 types |
| NOVI funded | 0 | 50,000 | 500,000 | 5,000,000 |
| Units (NOVI spend) | none | du1:200, op1:200 | du1:1k, du2:500, op1:1k, op2:500 | All 6 types, 5k each |
| Equipment | none | melee:50, armor:100 | + ranged:100, siege:50 | All types, large qty |
| Research | none | Attack lv1 | Attack/Defense/Economy lv3 | All 5 types lv5 |

Per-player flow: init → estate+gems → buildings → fund NOVI → hire units → purchase equipment → research. Keypairs stored in `keys/players/player-<index>.json`, auto-generated if missing.

---

## Phase Details

### Phase 1 — Engine (`novus init engine`)

- Derives GameEngine PDA from `kingdomId`.
- If exists → skip (immutable). Else → create with full config (economic, gameplay, minting, theme).
- Creates NOVI mint (kingdom 0 only — single mint shared across kingdoms).
- Sets `authority = daoAuthority`, `treasury = treasury`.
- On localnet: airdrops 50 SOL to authority, 1 SOL to treasury via `ensureFunded`.

### Phase 2 — Cities (`novus init cities`)

- 3 transactions: cities 0-7, 8-15, 16-23.
- Uses `createBatchCitiesInstruction` (up to 8 per tx).
- Batch is skipped only when EVERY city in it already exists.
- Coordinates quantized to grid: `Math.round(coord * 10000)`.
- Per-city payload includes `biomeSeed`, `widthGrid`, `heightGrid`, plus the 5 `CityBiomePreset` knob bytes (`waterLevelDelta`, `tempBias`, `moistureBias`, `coast`, `landmassSeed`).

### Phase 3 — Heroes (`novus init heroes`)

- Step 1: create `HeroCollection` (skip if exists).
- Step 2: for each of 83 templates, parallel in batches of 8:
  - If not exists → `createCreateTemplateInstruction`
  - If exists → skip (supply cap update path lives in `update heroes --supply-caps`)

### Phase 4 — Research (`novus init research`)

- For each of 30 templates (research_type 0-29):
  - If not exists → `createInitializeTemplateInstruction`
  - If exists → `createUpdateTemplateInstruction` (0 = leave-unchanged sentinel pattern)
- Must include prerequisite chain data for tech-tree dependencies.

### Phase 5 — Buildings (`novus init buildings`)

- For each building template: create if missing (skip if exists).
- Templates carry cost / time / level requirements per building type.

### Phase 6 — Subscriptions (`novus init subscriptions`)

- **Always runs** — subscription configs are frequently tuned.
- Calls `createUpdateTierConfigInstruction` for each tier (0-3).
- Full 232-byte struct per tier written every run.
- 4 transactions total.

### Phase 7 — Shop (`novus init shop`)

- Step 1: `ShopConfig` (skip if exists; `createInitializeConfigInstruction`).
- Step 2: items — `createOrUpdate` (`createCreateItemInstruction` / `createUpdateItemInstruction`).
- Step 3: bundles — `createOrUpdate` (`createCreateBundleInstruction` / `createUpdateBundleInstruction`).
- Step 4: flash sales — `createOrSkip` with `nextFlashSaleId` from the parsed `ShopConfig`; `createActivateSaleInstruction` if `autoActivate`.

### Phase 8 — Dungeons (`novus init dungeons`)

- For each template: create if missing (skip if exists).
- Creates the week-1 leaderboard PDA alongside each template.

### Phase 9 — Castles (`novus init castles`)

- 23 transactions (one per castle).
- For each: `createOrSkip` via `createCreateCastleInstruction` with anchor coords + `footprintSize` (defaults from tier).
- Creates `footprintSize²` `LocationAccount`s with `OCCUPANT_CASTLE` in the same tx.

### Phase 10 — Arena (`novus init arena`)

- Skip if exists. Else → `createCreateSeasonInstruction` with the `ARENA_SEASON` constants.

### Phase 11 — Events (`novus init events`)

- For each event in `data/events.ts`:
  - Derive event PDA from game engine + event ID.
  - Skip if exists. Else → `createCreateEventInstruction`.
- New events added to the data file are created on the next run.

---

## Update Capability Matrix

| Account Type | Create ix | Update ix | `init` behaviour | `update` behaviour |
|--------------|----------:|----------:|------------------|--------------------|
| GameEngine | 0 | — | Skip if exists | Error (immutable) |
| Cities | 3 / 5 | — | Skip if exists | Error (immutable) |
| Hero Templates | 130 | 311 (cap only) | Skip if exists | Update caps only (`--supply-caps`) |
| Hero Collection | 131 | — | Skip if exists | Error (immutable) |
| Research Templates | 120 | 126 | Create or update | Update only |
| Building Templates | (per type) | — | Skip if exists | — |
| Subscription Tiers | — | 101 | Always update | Always update |
| Shop Config | 140 | 155 | Skip if exists | Update oracle / config only |
| Shop Items | 150 | 151 | Create or update | Update only |
| Shop Bundles | 153 | 154 | Create or update | Update only |
| Flash Sales | 168 (create) / 170 (activate) / 171 (close) | — | Skip if exists; auto-activate optional | Use `flash-sale` subcommands |
| Dungeon Templates | 258 | — | Skip if exists | Error (immutable) |
| Dungeon Leaderboards | 260 | — | Skip if exists | Error (immutable) |
| Castles | 270 | 286 (config) | Skip if exists | Name update via `castle-config` |
| Arena Seasons | 230 | — | Skip if exists | Error (immutable) |
| Events | 80 | — | Skip if exists; create new on next run | Error (immutable) |

---

## Example Output

### `novus init all`

```
Kingdom 0 (localnet)

Phase 1/11 — Engine
  - Skipped: GameEngine [exists]
  - Skipped: NOVI Mint [exists]
  = 0 created, 0 updated, 2 skipped

Phase 2/11 — Cities
  + Created: Batch: cities 0-7 [8 created]
  + Created: Batch: cities 8-15 [8 created]
  + Created: Batch: cities 16-23 [8 created]
  = 24 created, 0 updated, 0 skipped

Phase 3/11 — Heroes
  - Skipped: Hero Collection [exists]
  + Created: Hero Template #1 (Warrior)
  + Created: Hero Template #2 (Archer)
  ... (83 templates)
  = 83 created, 0 updated, 1 skipped

Phase 4/11 — Research
  + Created: Research Template #0 (Attack Power)
  + Created: Research Template #1 (Defense Power)
  ... (30 templates)
  = 30 created, 0 updated, 0 skipped

Phase 5/11 — Buildings
  + Created: 19 building templates
  = 19 created, 0 updated, 0 skipped

Phase 6/11 — Subscriptions
  ~ Updated: Rookie
  ~ Updated: Expert
  ~ Updated: Epic
  ~ Updated: Legendary
  = 0 created, 4 updated, 0 skipped

Phase 7/11 — Shop
  [1/4] ShopConfig
  + Created: ShopConfig
  [2/4] Items (140)
  + Created: Shop Item #1 (Gem Pack (100))
  ...
  [3/4] Bundles (2)
  + Created: Bundle #1 (Starter Bundle)
  + Created: Bundle #2 (Combat Bundle)
  [4/4] Flash Sales (0)
  = 143 created, 0 updated, 0 skipped

Phase 8/11 — Dungeons
  + Created: 4 templates + 4 leaderboards
  = 8 created, 0 updated, 0 skipped

Phase 9/11 — Castles
  + Created: Castle #0 (Tower of London)
  ... (23 castles)
  = 23 created, 0 updated, 0 skipped

Phase 10/11 — Arena
  + Created: Arena Season 1
  = 1 created, 0 updated, 0 skipped

Phase 11/11 — Events
  + Created: Event #1 (Launch Tournament)
  + Created: Event #2 (Weekly PvP)
  + Created: Event #3 (Newcomer Challenge)
  = 3 created, 0 updated, 0 skipped

Done — 334 created, 4 updated, 3 skipped
Done in 24.7s
```

### `novus status`

```
Kingdom 0 Status (localnet)

System              Status    Details
─────────────────────────────────────────────
GameEngine          OK        Authority: 7xK...3Qp
Cities              OK        24
Heroes              OK        Collection + 83 templates
Research            OK        30 templates
Subscriptions       OK        4 tiers
Shop                OK        Config + 140 items + 2 bundles
Dungeons            OK        4 templates, 4 leaderboards
Castles             OK        23
Arena               OK        Season 1
Events              OK        3 events

Use "novus status <target>" for detailed view
```

### `novus init all --dry-run`

```
Kingdom 0 (localnet)
[dry-run mode — no transactions will be sent]

Phase 1/11 — Engine
  [dry-run] Would skip GameEngine [exists]

Phase 2/11 — Cities
  [dry-run] Would create 24 cities in 3 batches

Phase 3/11 — Heroes
  [dry-run] Would skip Hero Collection [exists]
  [dry-run] Would create 75 hero templates
  ...
```

Each `sendWithRetry` builds a signed v0 transaction and runs `simulateTransaction` against the live RPC — so CU overruns, account-not-found errors, and bad encoding all surface in dry-run mode.

---

## Notes for the next dev

- **No external CLI framework.** Argument parsing is hand-rolled in `lib/context.ts:parseArgs`. Don't add `commander` or `yargs`.
- **`bun` is the runtime.** Some commands shell out to `solana-test-validator` and `cargo build-sbf` — those need to be on PATH.
- **PDAs are kingdom-scoped.** Every helper takes `ctx.gameEngine` (derived from `--kingdom-id`). Cross-kingdom operations require multiple contexts.
- **`dry-run` is real.** It simulates a signed v0 transaction against the live RPC, so it catches CU overruns and missing accounts. Use it before mainnet pushes.
- **The terrain phase is gone.** Biome data is procedural — `biome_at(seed, ox, oy)` on chain and `biomeAt(...)` in the SDK return bit-identical results. The wire vector lives at `tests/fixtures/biome-vectors.json`.
- **Castles own multiple cells.** A tier-4 castle creates 16 `LocationAccount`s. `create_castle` budgets ~4k CU per Location create — well under the 200k limit even at N=4.
- **`encounters cleanup` must run.** Without it the active-encounter counter never drops and cities saturate. Schedule on a loop.
- **`update castle-config` only changes names.** Other castle fields (tier, location, footprint, level requirements) are immutable post-create.

### Adding a new init phase

1. Add a file in `cli/lib/phases/<name>.ts` exporting:
   - `initX(ctx): Promise<PhaseStats>` (creates / updates)
   - `statusX(ctx): Promise<string>` (one-line summary)
   - `detailX(ctx): Promise<string>` (full table — optional but encouraged)
2. Register the phase in `cli/lib/commands/init.ts` `PHASES` array (order matters — earlier phases run first under `init all`).
3. Register status hooks in `cli/lib/commands/status.ts` `STATUS_ENTRIES`.
4. If the phase has updatable accounts, also add an `updateX(ctx)` export and register it in `cli/lib/commands/update.ts` `UPDATE_TARGETS`.
5. Drop the source-of-truth data table in `cli/data/<name>.ts` with TypeScript types and exhaustive entries.

The helpers in `cli/lib/helpers.ts` already cover create-or-skip / create-or-update / update-only — phases should compose them, not roll their own send loops.
