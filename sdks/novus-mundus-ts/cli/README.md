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

### `validator` — Local Test Validator Management

Start, stop, and monitor the local Solana test validator with all game programs pre-loaded.

```bash
novus validator start              # Start with game programs loaded (detached)
novus validator start --reset      # Kill existing + fresh start
novus validator stop               # Stop running validator
novus validator status             # Show validator status, slot, version
```

Loads 4 programs: Novus Mundus, MPL Core, TLD House, ALT Name Service. Clones TLD state accounts from mainnet. PID is tracked in `.validator.pid` for reliable stop/status.

---

### `reset` — Wipe and Reinitialize

Kill the validator, start fresh, and reinitialize all game systems.

```bash
novus reset                        # Stop → restart → init all
novus reset --skip-init            # Stop → restart only
```

---

### `logs` — Tail Program Logs

Stream real-time program logs via WebSocket subscription.

```bash
novus logs                         # Tail Novus Mundus program logs only
novus logs --all                   # Tail all program logs (unfiltered)
```

Press `Ctrl+C` to stop. Each log entry shows timestamp, tx signature prefix, status, and instruction logs.

---

### `airdrop` — SOL Airdrop (Localnet)

Quick SOL airdrop to any address on localnet.

```bash
novus airdrop <pubkey>             # Airdrop 2 SOL
novus airdrop <pubkey> --amount 10 # Airdrop 10 SOL
novus airdrop dao                  # Airdrop to DAO authority
novus airdrop treasury             # Airdrop to treasury
```

Shows before/after balance. Only works on `--env localnet`.

---

### `deploy` — Build and Deploy Program

Build the Solana program and deploy to the target cluster.

```bash
novus deploy                       # Build + deploy to localnet
novus deploy --skip-build          # Deploy existing .so only
novus deploy --env devnet          # Deploy to devnet
```

Runs `cargo build-sbf` then `solana program deploy`. Respects `--dry-run`.

---

### `player` — Manage Existing Players

Fund or move existing players.

```bash
novus player fund <pubkey> --novi 100000     # Mint NOVI to player's reserved balance
novus player fund <keypair-path> --novi 50000  # Resolve pubkey from keypair file
novus player travel <keypair-path> --city 5  # Teleport player to city (requires keypair)
```

**`fund`** mints NOVI via DAO authority to the player's reserved balance. The player must call `reservedToLocked` separately to convert to usable NOVI. Accepts pubkey or keypair file path.

**`travel`** teleports the player instantly to the destination city using the intercity teleport instruction. Requires the player's keypair (must sign the transaction). Costs Locked NOVI on-chain.

---

### `snapshot` — Save and Restore Validator State

Save and restore validator ledger state for reproducible testing.

```bash
novus snapshot save <name>         # Save current ledger as named snapshot
novus snapshot load <name>         # Stop validator, restore snapshot, restart
novus snapshot list                # List available snapshots with sizes
novus snapshot delete <name>       # Delete a snapshot
```

Snapshots are stored in `.snapshots/` as copies of the `.validator-ledger/` directory. `load` stops the validator, replaces the ledger, and restarts without `--reset`.

---

### `nuke` — Full Environment Setup

One command to get a fully populated development environment.

```bash
novus nuke                         # Reset + init + 10 advanced players + encounters
novus nuke --tier epic             # Use epic tier instead of advanced
novus nuke --count 5               # Create 5 players instead of 10
novus nuke --skip-players          # Skip player creation
novus nuke --skip-encounters       # Skip encounter spawning
```

Runs: `validator stop` → `validator start --reset` → `init all` → `create-player` → `encounters spawn --all`.

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
