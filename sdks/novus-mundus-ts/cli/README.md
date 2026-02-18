# Novus Mundus CLI

Command-line interface for managing the Novus Mundus game kingdom on Solana.

```
bun run cli/cli.ts <command> [target] [options]
npm run novus <command> [target] [options]
```

## Global Options

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--env` | `localnet` `devnet` `mainnet` | `localnet` | Target Solana cluster |
| `--kingdom-id` | number | `0` | Kingdom ID |
| `--authority` | filepath | `keys/dao-authority.json` | DAO authority keypair |
| `--treasury` | filepath | `keys/treasury.json` | Treasury keypair |
| `--dry-run` | flag | | Preview without sending transactions |
| `--verbose` | flag | | Show transaction signatures |

---

## Commands

### `init` — Initialize Game Systems

Create and configure game accounts in 10 phases.

```bash
novus init all                   # Initialize everything (phases 1-10)
novus init all --from 5          # Resume from phase 5
novus init <target>              # Initialize a specific system
```

**Phases / Targets:**

| Phase | Target | Description |
|-------|--------|-------------|
| 1 | `engine` | GameEngine root account |
| 2 | `cities` | 50 city POIs |
| 3 | `heroes` | Hero collection + templates |
| 4 | `research` | Research templates |
| 5 | `subscriptions` | Subscription tier definitions |
| 6 | `shop` | Shop items + bundles |
| 7 | `dungeons` | Dungeon templates + leaderboards |
| 8 | `castles` | Castle POIs + garrison rewards |
| 9 | `arena` | Arena seasons |
| 10 | `events` | Event templates |

Each phase uses create-or-skip: existing accounts are not overwritten.

---

### `status` — Inspect Initialization State

```bash
novus status                     # Overview of all systems (OK/MISSING)
novus status <target>            # Detailed info for one system
```

Targets are the same as `init`.

---

### `update` — Re-apply Configurations

Update existing accounts without recreating them.

```bash
novus update research            # Update research template configs
novus update subscriptions       # Update subscription configs
novus update shop                # Update shop item/bundle configs
novus update heroes --supply-caps  # Update hero supply caps
novus update castle-config       # Update castle names/configs
```

Fails if the target account doesn't exist (use `init` first).

---

### `crank` — Run Permissionless Operations

Process time-based events on-chain.

```bash
novus crank all                  # Run all cranks
novus crank <target>             # Run a specific crank
```

| Target | Purpose |
|--------|---------|
| `subscriptions` | Process expirations |
| `events` | Process stage transitions |
| `arena` | Process season progressions |
| `dungeons` | Process leaderboard updates |
| `castles` | Process castle transitions |
| `rallies` | Process rally completions |

---

### `flash-sale` — Manage Flash Sales

```bash
novus flash-sale create --item 1 --discount 1000 --duration 3600
novus flash-sale create --item 5 --bundle --discount 2000 --duration 7200 --stock 100
novus flash-sale activate --sale-id 0
novus flash-sale close --sale-id 0
novus flash-sale list
```

**`create` flags:**

| Flag | Required | Description |
|------|----------|-------------|
| `--item <id>` | yes | Shop item ID |
| `--discount <bps>` | yes | Discount in basis points (max 5000 = 50%) |
| `--duration <secs>` | yes | Sale duration in seconds |
| `--bundle` | no | Flag if target is a bundle |
| `--start <unix>` | no | Start timestamp (default: now) |
| `--stock <n>` | no | Max stock, 0 = unlimited |

**`list`** shows a table with ID, status, target, discount, timing, stock, and claim count.

---

### `show` — Inspect On-Chain Game State

```bash
novus show player                # List all players (sorted by networth)
novus show player <pubkey>       # Detailed player state

novus show team                  # List all teams
novus show team <id>             # Team details + members

novus show rally                 # List active rallies
novus show rally <creator> <id>  # Rally details + participants

novus show expedition            # List active expeditions

novus show reinforcement <pk>    # Sent/received reinforcements for player

novus show loot <pubkey>         # Unclaimed loot for player
```

---

### `terrain` — Manage City Terrain

```bash
novus terrain preview <city-id>  # ASCII terrain visualization
novus terrain export <city-id>   # Export terrain config to JSON
novus terrain set <city-id>      # Upload terrain to on-chain City account
novus terrain add <city-id> --anchors '[...]'  # Append anchors
```

**`preview`** renders elevation using `.` (land), `~` (water), `^` (mountain) with percentage breakdown.

**`add`** anchor format:
```json
[{"x":0, "y":0, "mass":80, "lift":170, "pushX":0, "pushY":0}]
```

Built-in presets exist for cities 0 (New York), 1 (London), 2 (Tokyo).

---

### `create-player` — Generate Test Players

Create players at preset power tiers for testing and development.

```bash
novus create-player --tier beginner
novus create-player --tier advanced --count 5
novus create-player --tier epic --city 15
novus create-player --tier legendary
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--tier` | yes | | `beginner` `advanced` `epic` `legendary` |
| `--count` | no | `1` | Number of players to create |
| `--city` | no | auto-cycle | City ID for spawn |
| `--start-index` | no | auto-detect | Starting player keypair index |

**Tier Definitions:**

| Aspect | beginner | advanced | epic | legendary |
|--------|----------|----------|------|-----------|
| Init (user+player+research) | yes | yes | yes | yes |
| Estate + gems | no | yes + 10 | yes + 50 | yes + 200 |
| Buildings | none | Mansion, Barracks, Market | +Stables, Workshop, Academy, Citadel | All 19 types |
| NOVI funded | 0 | 50,000 | 500,000 | 5,000,000 |
| Units (NOVI spend) | none | du1:200, op1:200 | du1:1k, du2:500, op1:1k, op2:500 | All 6 types, 5k each |
| Equipment | none | melee:50, armor:100 | +ranged:100, siege:50 | All types, large qty |
| Research | none | Attack Lv1 | Attack/Defense/Economy Lv3 | All 5 types Lv5 |

**Per-player flow:** init → estate+gems → buildings → fund NOVI → hire units → purchase equipment → research

Keypairs are stored in `keys/players/player-<index>.json` and auto-generated if missing. SOL is auto-airdropped on localnet.

---

### `encounters` — Spawn and Inspect PvE Encounters

```bash
novus encounters spawn --city 0 --count 5
novus encounters spawn --all --count 2 --rarity rare
novus encounters status
novus encounters status --city 0
```

**`spawn` flags:**

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--city <id>` or `--all` | yes | | Target city or all cities |
| `--count` | no | `1` | Encounters per city |
| `--rarity` | no | `common` | `common` `uncommon` `rare` `epic` `legendary` |

Uses DAO auto-spawn (no NOVI cost). Encounter index auto-increments per city.

**`status`** shows a table with city name, total spawned, active encounters, and player count. Without `--city`, only cities with encounters are shown.

---

## Data Files

Configuration data loaded by commands during initialization.

| File | Contents |
|------|----------|
| `data/cities.ts` | 50 global cities with coordinates and types |
| `data/player-tiers.ts` | Player creation tier definitions |
| `data/heroes.ts` | Hero NFT template metadata |
| `data/castles.ts` | Castle POI configurations |
| `data/dungeons.ts` | Dungeon template definitions |
| `data/research.ts` | Research template configurations |
| `data/subscriptions.ts` | Subscription tier definitions |
| `data/shop-items.ts` | Shop items, bundles, allowed tokens |
| `data/events.ts` | Event template configurations |
| `data/arena.ts` | Arena season configurations |
| `data/flash-sales.ts` | Flash sale templates |

---

## Keys

```
keys/
├── dao-authority.json        # DAO governance keypair (signs admin txs)
├── treasury.json             # Treasury keypair (receives payments)
└── players/
    ├── player-0.json         # Auto-generated per create-player
    ├── player-1.json
    └── ...
```

All keypairs are auto-generated on first use and stored as JSON arrays of secret key bytes.

---

## Transaction Helpers

The CLI uses shared helpers for all on-chain interactions:

- **`sendWithRetry`** — Send + confirm with exponential backoff (default 3 retries). Supports optional `computeUnits` and `simulate` flags.
- **`batchSend`** — Send multiple transactions with configurable concurrency (default 4).
- **`accountExists`** — Check if a PDA exists on-chain before creating.
- **`createOrSkip` / `createOrUpdate` / `updateOnly`** — Idempotent account management patterns.

All helpers respect `--dry-run` (no txs sent) and `--verbose` (print signatures).
