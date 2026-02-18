# Novus Mundus: State Discriminator & Real-Time Architecture Audit

> Audit date: 2026-02-16
> Scope: Rust program state, SDK deserialization, web app data layer, websocket usage

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem 1: Missing Account Discriminators](#2-problem-1-missing-account-discriminators)
3. [Problem 2: Fragmented Real-Time Architecture](#3-problem-2-fragmented-real-time-architecture)
4. [Problem 3: Zustand Underutilized](#4-problem-3-zustand-underutilized)
5. [Fix Plan: Rust Program](#5-fix-plan-rust-program)
6. [Fix Plan: SDK Client & State](#6-fix-plan-sdk-client--state)
7. [Fix Plan: Web App Data Layer](#7-fix-plan-web-app-data-layer)
8. [Fix Plan: Tests](#8-fix-plan-tests)
9. [Migration Strategy](#9-migration-strategy)
10. [File Inventory](#10-file-inventory)

---

## 1. Executive Summary

Three architectural issues are degrading the data layer:

| # | Issue | Severity | Impact |
|---|-------|----------|--------|
| 1 | No discriminator on any Rust account struct | High | Raw bytes from `getProgramAccounts` or WebSocket `onProgramAccountChange` cannot be routed to the correct deserializer. Forces per-PDA fetching instead of bulk program-wide subscriptions. |
| 2 | Only `usePlayer` has WebSocket — every other hook polls via React Query staleTime | High | Encounters, expeditions, loot, arena, castle, team, rallies all go stale for 10-30s. Users see outdated timers, miss loot, see ghost encounters. |
| 3 | Zustand holds only UI state (sidebar, modals, selectedCity) — zero game state | Medium | Each component independently calls `useQuery`, no shared reactive store. SDK's `GameSubscriptionManager` exists but is completely unused by the web app. |

**Proposed solution**: Add a 1-byte `AccountKey` discriminator as the first field of every Rust account, then build a single Zustand store that uses the SDK's subscription layer to push real-time updates to all components simultaneously.

---

## 2. Problem 1: Missing Account Discriminators

### Current State

Every account struct in `programs/novus_mundus/src/state/` uses `#[repr(C)]` with **no discriminator field**. Account type identification relies entirely on PDA derivation — if you know the seeds, you know the type.

**Affected structs (15 account types):**

| Struct | File | Size | First Field |
|--------|------|------|-------------|
| `GameEngine` | `state/game_engine.rs` | ~1800B | `kingdom_id: u16` |
| `PlayerCore` | `state/player.rs` | 1048-1946B | `game_engine: Pubkey` |
| `UserAccount` | `state/player.rs` | 144B | `owner: Pubkey` |
| `CityAccount` | `state/city.rs` | 128B+ | `game_engine: Pubkey` |
| `TeamAccount` | `state/team.rs` | 272B | `game_engine: Pubkey` |
| `TeamMemberSlot` | `state/team.rs` | 96B | `team: Pubkey` |
| `TeamInviteAccount` | `state/team.rs` | 128B | `team: Pubkey` |
| `TreasuryRequest` | `state/team.rs` | 104B | `team: Pubkey` |
| `EncounterAccount` | `state/encounter.rs` | 96B+ | `game_engine: Pubkey` |
| `RallyAccount` | `state/rally.rs` | 360B | `game_engine: Pubkey` |
| `RallyParticipant` | `state/rally.rs` | 312B | rally fields |
| `ReinforcementAccount` | `state/reinforcement.rs` | 264B | sender/receiver |
| `ExpeditionAccount` | `state/expedition.rs` | 104B | `player: Pubkey` |
| `LootAccount` | `state/loot.rs` | 192B | `owner: Pubkey` |
| `ArenaSeasonAccount` | `state/arena.rs` | 600B | `game_engine: Pubkey` |
| `ArenaParticipantAccount` | `state/arena.rs` | 536B | season fields |
| `CastleAccount` | `state/castle.rs` | variable | castle fields |
| `DungeonRunAccount` | `state/dungeon.rs` | variable | dungeon fields |
| `EstateAccount` | `state/estate.rs` | variable | estate fields |
| `ShopConfigAccount` | `state/shop.rs` | variable | config fields |

### Why This Matters

1. **`getProgramAccounts` is blind**: When fetching all program accounts (e.g., "all encounters in city X"), the RPC returns raw bytes with no type hint. The SDK currently works around this by deriving PDAs for specific accounts and fetching one-by-one, which is N RPC calls instead of 1.

2. **`onProgramAccountChange` is unusable**: The Solana WebSocket can notify on ALL account changes for a program in a single subscription. Without a discriminator, the callback gets raw bytes and cannot route them to the correct parser. This forces per-account subscriptions (one WebSocket per player, per encounter, per loot, etc.).

3. **Size-based guessing is fragile**: Some accounts have the same size or overlapping sizes. `TeamMemberSlot` (96B) and `ExpeditionAccount` (104B) are close. `CityAccount` with terrain anchors could overlap with `RallyAccount` (360B). Adding fields to any struct could create size collisions.

4. **SDK deserialization has no safety check**: Every `deserialize*` function in the SDK blindly reads bytes at expected offsets. If the wrong account data is passed, it silently produces garbage instead of throwing.

---

## 3. Problem 2: Fragmented Real-Time Architecture

### Current WebSocket Usage

**Web app** (`apps/web/src/lib/hooks/`):

| Hook | WebSocket? | Update Strategy |
|------|-----------|-----------------|
| `usePlayer` | YES | `connection.onAccountChange` -> invalidates React Query |
| `useGameEngine` | no | Polls every 60s |
| `useUser` | no | Polls every 30s |
| `useCity` | no | Polls every 30s |
| `useEncounters` | no | Polls every 10s |
| `useTeam` | no | Polls every 30s |
| `useExpedition` | no | Polls every 10s |
| `useLoot` | no | Polls every 10s |
| `useArena` | no | Polls every 10-30s |
| `useCastle` | no | Polls every 30s |
| `useShopConfig` | no | Polls every 60s |

**SDK** (`sdks/novus-mundus-ts/src/subscriptions/`):

The SDK has a `GameSubscriptionManager` class, but it's built wrong — it subscribes to individual accounts one at a time (`subscribeToPlayer()`, `subscribeToTeam()`, etc.). This means N accounts = N WebSocket subscriptions, which doesn't scale and misses accounts you didn't know to subscribe to (new loot, new encounters, etc.).

The SDK also has `subscribeToAllGameAccounts()` which is the right idea, but without discriminators it can't route the raw bytes to the correct parser.

**This entire subscription layer is unused by the web app.** The web app manually creates one `connection.onAccountChange` call inside `usePlayer.ts` and ignores everything else.

### Consequences

- **Stale encounters**: Player sees an encounter, clicks attack, but it despawned 10s ago. TX fails.
- **Stale loot**: Player doesn't see new loot for up to 10s after combat.
- **Stale travel**: Travel completion not reflected until next poll.
- **Stale arena**: ELO changes not visible to opponents.
- **No cross-component sync**: If the dashboard shows player data and the sidebar shows player data, they poll independently and can show different values.
- **Wasted RPC quota**: Polling 10+ accounts every 10-30s per connected user.

---

## 4. Problem 3: Zustand Underutilized

### Current Zustand Stores

**`store/game.ts`** — UI state only:
```
selectedCityId, sidebarOpen, activeModal, walletConnected
```

**`store/notifications.ts`** — Toast notifications:
```
notifications[], add(), dismiss()
```

### What Zustand Should Hold

All game account state that multiple components need. Currently each `useQuery` hook is an independent island — when the player account updates, every component using `usePlayer()` triggers its own re-render cycle through React Query. With zustand:

- Single source of truth for all account state
- WebSocket updates write directly to the store
- Components subscribe to specific slices (e.g., `useGameStore(s => s.player.cash)`)
- Derived values computed once via zustand middleware, not in every component via `useMemo`
- Cross-account reactions (e.g., "when player.cityId changes, refetch encounters for new city")

---

## 5. Fix Plan: Rust Program

### 5.1 Add `AccountKey` Enum

**File**: `programs/novus_mundus/src/state/mod.rs` (or new file `account_key.rs`)

```rust
/// Account type discriminator — first byte of every account.
/// CRITICAL: Once deployed, values must NEVER change or be reordered.
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AccountKey {
    Uninitialized = 0,
    GameEngine = 1,
    Player = 2,
    User = 3,
    City = 4,
    Team = 5,
    TeamMemberSlot = 6,
    TeamInvite = 7,
    TreasuryRequest = 8,
    Encounter = 9,
    Rally = 10,
    RallyParticipant = 11,
    Reinforcement = 12,
    Expedition = 13,
    Loot = 14,
    ArenaSeason = 15,
    ArenaParticipant = 16,
    ArenaLoadout = 17,
    Castle = 18,
    CastleGarrison = 19,
    DungeonRun = 20,
    DungeonTemplate = 21,
    DungeonLeaderboard = 22,
    Estate = 23,
    ShopConfig = 24,
    ShopItem = 25,
    ShopBundle = 26,
    FlashSale = 27,
    HeroTemplate = 28,
    HeroCollection = 29,
    ForgeConfig = 30,
    ForgeSession = 31,
    SanctuaryMeditation = 32,
    ResearchTemplate = 33,
    ResearchProgress = 34,
    GameEvent = 35,
    EventParticipant = 36,
    NameRecord = 37,
    AllowedToken = 38,
    // Reserve 39-63 for future account types
}
```

### 5.2 Add `account_key` as First Field of Every Struct

Add `account_key: u8` as the very first field of every account struct:

```rust
#[repr(C)]
#[derive(Copy, Clone)]
pub struct PlayerCore {
    pub account_key: u8,          // 1 — AccountKey::Player (NEW)
    pub game_engine: Pubkey,      // 32
    pub owner: Pubkey,            // 32
    // ... rest unchanged
}
```

The `account_key` field is set during initialization and validated on every instruction.

### 5.2.1 Padding Audit

The existing Rust structs have inconsistent padding throughout — some sections have explicit `_padding` fields, others rely on implicit `repr(C)` alignment, and some padding sizes are wrong or wasteful. As part of adding the discriminator, **audit and fix all padding across every struct**. Wherever a struct already has `_padding` fields, adjust them to accommodate the new `account_key` byte. Wherever padding is missing or incorrect, add it properly. This is a one-time cleanup — get every struct's layout byte-accurate with explicit padding everywhere, no implicit gaps.

### 5.3 Validate on Every Instruction

In each processor, after loading the account data, validate the key:

```rust
let player = unsafe { PlayerCore::load(player_data) };
if player.account_key != AccountKey::Player as u8 {
    return Err(GameError::InvalidAccountKey.into());
}
```

Add to `error.rs`:
```rust
InvalidAccountKey,
```

### 5.4 Set During Initialization

In every `create_*` / `initialize_*` processor, set the key first:

```rust
let player = unsafe { PlayerCore::load_mut(player_data) };
player.account_key = AccountKey::Player as u8;
// ... rest of initialization
```

### 5.5 Account Size Changes

Every account grows by at least 1 byte (the `account_key: u8`). Final sizes will be determined during the padding audit — some structs may grow or shrink slightly as implicit padding gaps are replaced with explicit fields. Update all `LEN` constants after the audit is complete. The SDK size constants must match exactly.

### 5.6 Files to Modify (Rust)

```
programs/novus_mundus/src/state/mod.rs          — Add AccountKey enum, update Loaded/LoadedMut traits
programs/novus_mundus/src/state/game_engine.rs  — Add account_key field, update LEN, validate in load
programs/novus_mundus/src/state/player.rs       — Add to PlayerCore + UserAccount, update offsets for extensions
programs/novus_mundus/src/state/city.rs         — Add account_key field, update LEN
programs/novus_mundus/src/state/team.rs         — Add to TeamAccount + TeamMemberSlot + TeamInviteAccount + TreasuryRequest
programs/novus_mundus/src/state/encounter.rs    — Add account_key field, update BASE_SIZE
programs/novus_mundus/src/state/rally.rs        — Add to RallyAccount + RallyParticipant
programs/novus_mundus/src/state/reinforcement.rs — Add account_key field
programs/novus_mundus/src/state/expedition.rs   — Add account_key field
programs/novus_mundus/src/state/loot.rs         — Add account_key field
programs/novus_mundus/src/state/arena.rs        — Add to ArenaSeasonAccount + ArenaParticipantAccount + ArenaLoadout
programs/novus_mundus/src/state/castle.rs       — Add to CastleAccount + CastleGarrison
programs/novus_mundus/src/state/dungeon.rs      — Add to DungeonRunAccount + DungeonTemplate + DungeonLeaderboard
programs/novus_mundus/src/state/estate.rs       — Add to EstateAccount
programs/novus_mundus/src/state/hero.rs         — Add to HeroTemplate + HeroCollection
programs/novus_mundus/src/error.rs              — Add InvalidAccountKey variant
programs/novus_mundus/src/constants.rs          — Update any size constants referenced from here

All processor files (100+):
  — Add account_key validation after loading
  — Set account_key during initialization
```

---

## 6. Fix Plan: SDK Client & State

### 6.1 Add AccountKey Enum to SDK

**File**: `sdks/novus-mundus-ts/src/types/enums.ts`

```ts
export enum AccountKey {
  Uninitialized = 0,
  GameEngine = 1,
  Player = 2,
  User = 3,
  City = 4,
  Team = 5,
  TeamMemberSlot = 6,
  TeamInvite = 7,
  TreasuryRequest = 8,
  Encounter = 9,
  Rally = 10,
  RallyParticipant = 11,
  Reinforcement = 12,
  Expedition = 13,
  Loot = 14,
  ArenaSeason = 15,
  ArenaParticipant = 16,
  ArenaLoadout = 17,
  Castle = 18,
  CastleGarrison = 19,
  DungeonRun = 20,
  DungeonTemplate = 21,
  DungeonLeaderboard = 22,
  Estate = 23,
  ShopConfig = 24,
  ShopItem = 25,
  ShopBundle = 26,
  FlashSale = 27,
  HeroTemplate = 28,
  HeroCollection = 29,
  ForgeConfig = 30,
  ForgeSession = 31,
  SanctuaryMeditation = 32,
  ResearchTemplate = 33,
  ResearchProgress = 34,
  GameEvent = 35,
  EventParticipant = 36,
  NameRecord = 37,
  AllowedToken = 38,
}
```

### 6.2 Add Universal Deserializer

**File**: `sdks/novus-mundus-ts/src/state/index.ts` (new export)

```ts
/**
 * Read the account key from raw bytes and route to the correct parser.
 * This enables getProgramAccounts and onProgramAccountChange to work.
 */
export function deserializeAnyAccount(data: Buffer | Uint8Array): {
  key: AccountKey;
  account: unknown;
} {
  if (data.length < 8) throw new Error('Account data too short');
  const key = data[0] as AccountKey;

  switch (key) {
    case AccountKey.Player: return { key, account: deserializePlayer(data) };
    case AccountKey.GameEngine: return { key, account: deserializeGameEngine(data) };
    case AccountKey.User: return { key, account: deserializeUser(data) };
    case AccountKey.City: return { key, account: deserializeCity(data) };
    case AccountKey.Team: return { key, account: deserializeTeam(data) };
    case AccountKey.Encounter: return { key, account: deserializeEncounter(data) };
    case AccountKey.Loot: return { key, account: deserializeLoot(data) };
    // ... all types
    default: throw new Error(`Unknown account key: ${key}`);
  }
}
```

### 6.3 Update Every Deserializer

Each `deserialize*` function must read the first byte as the account key and validate it:

```ts
export function deserializePlayer(data: Uint8Array | Buffer): PlayerCore {
  const reader = new BufferReader(data);
  const accountKey = reader.readU8();
  if (accountKey !== AccountKey.Player) {
    throw new Error(`Expected Player account (key=${AccountKey.Player}), got key=${accountKey}`);
  }
  // No padding to skip — Pubkey has alignment 1, starts immediately
  // ... rest of deserialization unchanged
}
```

**Exception**: `deserializeGameEngine` must skip 1 implicit padding byte before reading `kingdom_id: u16`.

### 6.4 Update Size Constants

Every `*_ACCOUNT_SIZE` constant increases by 1:

```ts
// Before
export const PLAYER_CORE_SIZE = 1048;
// After
export const PLAYER_CORE_SIZE = 1049;
```

### 6.5 Rewrite `GameSubscriptionManager` as Program-Wide Listener

The current `GameSubscriptionManager` subscribes to individual accounts. **Replace it entirely** with a single `onProgramAccountChange` subscription that catches everything.

**How it works:**

1. **One WebSocket** — `connection.onProgramAccountChange(PROGRAM_ID, callback)` receives every account write in the program.
2. **Read byte 0** — the `account_key` discriminator tells you the account type instantly.
3. **Read the `game_engine` field** — most account types have `game_engine: Pubkey` as their second field (right after the discriminator). Check if it matches the user's kingdom. If not, ignore it.
4. **Route to the correct handler** — based on the `AccountKey`, deserialize and check if it's relevant to this user (is it their player? their city? an encounter in their city? loot addressed to them?).
5. **Fire typed callbacks** — consumers register handlers per account type. Only matching, relevant updates get dispatched.

```ts
export class GameSubscriptionManager {
  private subId: number | null = null;
  private handlers = new Map<AccountKey, Set<(pubkey: PublicKey, account: any) => void>>();
  private kingdomGameEngine: PublicKey;
  private wallet: PublicKey;
  private connection: Connection;

  constructor(connection: Connection, gameEngine: PublicKey, wallet: PublicKey) {
    this.connection = connection;
    this.kingdomGameEngine = gameEngine;
    this.wallet = wallet;
  }

  /** Start the single program-wide subscription */
  start(): void {
    this.subId = this.connection.onProgramAccountChange(
      PROGRAM_ID,
      (accountInfo, context) => {
        const data = accountInfo.accountInfo.data;
        if (data.length < 1) return;

        const key = data[0] as AccountKey;

        // Kingdom filter: most accounts have game_engine at offset 1
        // (right after the 1-byte discriminator). Check it matches ours.
        if (!this.isRelevantToKingdom(key, data)) return;

        // Relevance filter: is this account about this user?
        if (!this.isRelevantToUser(key, data)) return;

        // Deserialize and dispatch
        try {
          const { account } = deserializeAnyAccount(data);
          const handlers = this.handlers.get(key);
          if (handlers) {
            for (const handler of handlers) {
              handler(accountInfo.accountId, account);
            }
          }
        } catch (e) {
          // Malformed data, skip
        }
      },
      'confirmed'
    );
  }

  /** Register a handler for a specific account type */
  on<T>(key: AccountKey, handler: (pubkey: PublicKey, account: T) => void): () => void {
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(handler);
    return () => this.handlers.get(key)?.delete(handler);
  }

  /** Check if account belongs to our kingdom */
  private isRelevantToKingdom(key: AccountKey, data: Buffer): boolean {
    // GameEngine itself doesn't have a game_engine field — it IS the game engine
    if (key === AccountKey.GameEngine) {
      // Check by PDA or by kingdom_id field
      return true; // filter more precisely if multi-kingdom
    }
    // Most accounts: game_engine Pubkey at offset 1 (after the 1-byte key)
    // Accounts that start with owner/player instead: User, Loot, Expedition
    // — these are filtered by wallet relevance instead
    const KINGDOM_ACCOUNTS = [
      AccountKey.Player, AccountKey.City, AccountKey.Team,
      AccountKey.Encounter, AccountKey.Rally, AccountKey.ArenaSeason,
      AccountKey.Castle, AccountKey.Estate,
    ];
    if (KINGDOM_ACCOUNTS.includes(key) && data.length >= 33) {
      const geBytes = data.slice(1, 33);
      return Buffer.compare(geBytes, this.kingdomGameEngine.toBuffer()) === 0;
    }
    return true; // let wallet-scoped accounts through, filter by user below
  }

  /** Check if account is relevant to this specific user */
  private isRelevantToUser(key: AccountKey, data: Buffer): boolean {
    // For user-scoped types, check if owner/player matches
    // For global types (City, GameEngine, ArenaSeason), always relevant
    // For city-scoped (Encounter), check against player's current city
    // This is the fine-grained filter — implementations per type
    return true; // default pass-through, refine per account type
  }

  stop(): void {
    if (this.subId !== null) {
      this.connection.removeProgramAccountChangeListener(this.subId);
      this.subId = null;
    }
    this.handlers.clear();
  }
}
```

**Key insight**: One WebSocket subscription replaces potentially hundreds of individual ones. The discriminator byte makes routing O(1). Kingdom filtering happens before deserialization (just compare 32 bytes), so irrelevant accounts from other kingdoms are dropped cheaply.

### 6.6 Files to Modify (SDK)

```
sdks/novus-mundus-ts/src/types/enums.ts         — Add AccountKey enum
sdks/novus-mundus-ts/src/state/player.ts         — Read + validate key byte, update sizes
sdks/novus-mundus-ts/src/state/game-engine.ts    — Same
sdks/novus-mundus-ts/src/state/user.ts           — Same
sdks/novus-mundus-ts/src/state/city.ts           — Same
sdks/novus-mundus-ts/src/state/team.ts           — Same (3 account types)
sdks/novus-mundus-ts/src/state/encounter.ts      — Same
sdks/novus-mundus-ts/src/state/rally.ts          — Same (2 account types)
sdks/novus-mundus-ts/src/state/reinforcement.ts  — Same
sdks/novus-mundus-ts/src/state/expedition.ts     — Same
sdks/novus-mundus-ts/src/state/loot.ts           — Same
sdks/novus-mundus-ts/src/state/arena.ts          — Same (2-3 account types)
sdks/novus-mundus-ts/src/state/castle.ts         — Same
sdks/novus-mundus-ts/src/state/dungeon.ts        — Same
sdks/novus-mundus-ts/src/state/event.ts          — Same
sdks/novus-mundus-ts/src/state/shop.ts           — Same
sdks/novus-mundus-ts/src/state/index.ts          — Add deserializeAnyAccount universal router
sdks/novus-mundus-ts/src/subscriptions/game.ts   — REWRITE: single program-wide subscription with discriminator routing
sdks/novus-mundus-ts/src/client.ts               — Update fetchMultiple to use discriminator for type safety
sdks/novus-mundus-ts/src/constants.ts            — Update size constants after padding audit
```

---

## 7. Fix Plan: Web App Data Layer

### 7.1 Replace Hook-per-Account with Zustand Game Store

**Delete** the individual polling hooks and replace with a single reactive store.

**New file**: `apps/web/src/lib/store/accounts.ts`

```ts
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { PlayerCore, UserAccount, CityAccount, ... } from 'novus-mundus-sdk';

interface AccountStore {
  // === Account State ===
  player: PlayerCore | null;
  user: UserAccount | null;
  city: CityAccount | null;
  encounters: EncounterAccount[];
  team: TeamAccount | null;
  expedition: ExpeditionAccount | null;
  loot: LootAccount[];
  arenaSeason: ArenaSeasonAccount | null;
  arenaParticipant: ArenaParticipantAccount | null;
  castle: CastleAccount | null;
  gameEngine: GameEngine | null;
  shopConfig: ShopConfigAccount | null;

  // === Connection State ===
  connected: boolean;
  subscriptionCount: number;

  // === Actions ===
  setPlayer: (p: PlayerCore | null) => void;
  setUser: (u: UserAccount | null) => void;
  setCity: (c: CityAccount | null) => void;
  setEncounters: (e: EncounterAccount[]) => void;
  updateEncounter: (e: EncounterAccount) => void;
  removeEncounter: (id: bigint) => void;
  // ... setters for all account types

  // === Lifecycle ===
  initialize: (client: NovusMundusClient, wallet: PublicKey) => void;
  cleanup: () => void;
}
```

### 7.2 Single Program Subscription -> Zustand

**New file**: `apps/web/src/lib/store/subscriptions.ts`

One `GameSubscriptionManager` instance, one WebSocket, everything flows into zustand:

```ts
import { GameSubscriptionManager, AccountKey } from 'novus-mundus-sdk';

let manager: GameSubscriptionManager | null = null;

export function startSubscriptions(
  connection: Connection,
  gameEngine: PublicKey,
  wallet: PublicKey,
  store: AccountStore
) {
  manager = new GameSubscriptionManager(connection, gameEngine, wallet);

  // Register handlers per account type — each writes to zustand
  manager.on(AccountKey.Player, (pubkey, player) => {
    store.setPlayer(player);
  });

  manager.on(AccountKey.User, (pubkey, user) => {
    store.setUser(user);
  });

  manager.on(AccountKey.City, (pubkey, city) => {
    // Only update if it's the player's current city
    if (city.cityId === store.player?.currentCity) {
      store.setCity(city);
    }
  });

  manager.on(AccountKey.Encounter, (pubkey, encounter) => {
    // Only track encounters in the player's current city
    if (encounter.cityId === store.player?.currentCity) {
      store.upsertEncounter(pubkey, encounter);
    }
  });

  manager.on(AccountKey.Loot, (pubkey, loot) => {
    store.upsertLoot(pubkey, loot);
  });

  manager.on(AccountKey.Expedition, (pubkey, expedition) => {
    store.setExpedition(expedition);
  });

  manager.on(AccountKey.Team, (pubkey, team) => {
    store.setTeam(team);
  });

  manager.on(AccountKey.ArenaSeason, (pubkey, season) => {
    store.setArenaSeason(season);
  });

  manager.on(AccountKey.Castle, (pubkey, castle) => {
    store.setCastle(castle);
  });

  // ... register for any other types the UI cares about

  // Start the single program-wide WebSocket
  manager.start();

  return () => {
    manager?.stop();
    manager = null;
  };
}
```

The beauty: **one WebSocket catches everything**. New loot appears instantly. Encounters spawn/despawn in real-time. Another player attacks an encounter and you see the HP drop. A rally finishes and results appear. No polling, no per-account subscriptions, no stale data.

### 7.3 Reactive City Switching

When the player changes city (travel completes), the subscription manager is already receiving all program events. The `AccountKey.City` and `AccountKey.Encounter` handlers just check `store.player?.currentCity` — when the player's city changes via the `AccountKey.Player` update, subsequent encounter/city events automatically filter for the new city. No re-subscription needed.

### 7.4 Keep React Query for Initial Fetches Only

React Query is still useful for:
- **Initial data loading** (fetch once, then WebSocket keeps it fresh)
- **Paginated/filtered lists** (e.g., leaderboards, shop items)
- **One-off fetches** (e.g., other player profiles)

Pattern:
```ts
// Initial fetch populates zustand
const { isLoading } = useQuery({
  queryKey: ['player', wallet],
  queryFn: async () => {
    const result = await client.fetchPlayer(wallet);
    useAccountStore.getState().setPlayer(result.account);
    return result;
  },
  staleTime: Infinity, // WebSocket keeps it fresh
});

// Components read from zustand, not React Query
const cash = useAccountStore(s => s.player?.cashOnHand);
```

### 7.5 Derived Selectors (Replace useMemo Hooks)

Move all derived computations into zustand selectors:

```ts
// Replace useCombatPower hook
export const selectCombatPower = (s: AccountStore) => {
  const p = s.player;
  if (!p) return null;
  return calculateCombatPower(p); // SDK calculator
};

// Replace useSubscriptionStatus hook
export const selectSubscriptionStatus = (s: AccountStore) => {
  const p = s.player;
  if (!p) return { tier: 0, active: false };
  return {
    tier: p.subscriptionTier,
    active: p.subscriptionEnd > Date.now() / 1000,
    expiresAt: p.subscriptionEnd,
  };
};

// Usage in component
const power = useAccountStore(selectCombatPower);
```

### 7.6 No Page-Level Subscriptions Needed

Since the program-wide subscription catches all account changes for our kingdom, individual pages don't need their own subscriptions. A page just reads from zustand — the data is already being pushed there by the single WebSocket. Components mount, read `useAccountStore(s => s.castle)`, and it's already live.

### 7.7 Files to Modify (Web App)

```
NEW:  apps/web/src/lib/store/accounts.ts       — Central game state store
NEW:  apps/web/src/lib/store/subscriptions.ts   — SDK subscription -> zustand bridge
NEW:  apps/web/src/lib/store/selectors.ts       — Derived selectors (combat power, sub status, etc.)

MODIFY: apps/web/src/lib/store/game.ts          — Keep UI-only state, remove anything that overlaps

MODIFY: apps/web/src/lib/solana/provider.tsx     — Initialize accounts store + subscriptions on wallet connect

MODIFY: apps/web/src/lib/hooks/usePlayer.ts      — Simplify to initial fetch + zustand write, remove manual onAccountChange
MODIFY: apps/web/src/lib/hooks/useGameEngine.ts   — Same pattern
MODIFY: apps/web/src/lib/hooks/useUser.ts          — Same pattern
MODIFY: apps/web/src/lib/hooks/useCity.ts          — Same pattern
MODIFY: apps/web/src/lib/hooks/useEncounters.ts    — Same pattern
MODIFY: apps/web/src/lib/hooks/useTeam.ts          — Same pattern
MODIFY: apps/web/src/lib/hooks/useExpedition.ts    — Same pattern
MODIFY: apps/web/src/lib/hooks/useLoot.ts          — Same pattern
MODIFY: apps/web/src/lib/hooks/useArena.ts         — Same pattern
MODIFY: apps/web/src/lib/hooks/useCastle.ts        — Same pattern
MODIFY: apps/web/src/lib/hooks/useShop.ts          — Same pattern

MODIFY: apps/web/src/lib/hooks/useDerived.ts       — Replace useMemo hooks with zustand selector re-exports

KEEP:   apps/web/src/lib/hooks/useTransact.ts      — Keep as-is, but invalidation writes to zustand instead of queryClient
KEEP:   apps/web/src/lib/hooks/useStamina.ts       — Keep (client-side interpolation timer)
KEEP:   apps/web/src/lib/hooks/useCountdown.ts     — Keep (client-side timer)

MODIFY: All page components that use individual hooks — switch to useAccountStore selectors
```

---

## 8. Fix Plan: Tests

### 8.1 Rust Program Tests

Add to every existing test:
- Verify `account_key` is set correctly after initialization
- Verify `account_key` validation rejects wrong types
- Add test for `InvalidAccountKey` error

**New test file**: `tests/account_key.rs`
```
- Test every account type has correct key after creation
- Test passing wrong account type returns InvalidAccountKey
- Test AccountKey::Uninitialized (0) is rejected
```

### 8.2 SDK Unit Tests

Update deserialization tests to include the 8-byte prefix:

**Modify**: `sdks/novus-mundus-ts/tests/unit/deserialize.test.ts`
```
- Update all test buffers to include account_key + padding
- Add test: deserializePlayer rejects data with wrong key
- Add test: deserializeAnyAccount routes correctly for all types
- Add test: deserializeAnyAccount throws on unknown key
```

**Modify**: `sdks/novus-mundus-ts/tests/unit/serialize.test.ts`
```
- Update all expected sizes (+8)
- Verify serialized output starts with correct key byte
```

### 8.3 E2E Tests

**Modify**: All `sdks/novus-mundus-ts/tests/e2e/*.test.ts`
```
- Update expected account sizes in assertions
- Add discriminator validation checks after account creation
- Verify getProgramAccounts + deserializeAnyAccount works
```

### 8.4 Web App Tests (if added)

```
- Test: zustand store updates when subscription fires
- Test: derived selectors compute correctly
- Test: page-level subscriptions cleanup on unmount
- Test: city switch triggers encounter re-subscription
```

---

## 9. Migration Strategy

### Phase 1: Discriminator (Program + SDK) — Breaking Change

This is a breaking change to account layout. Options:

**Option A: Version field migration (recommended for mainnet)**
- Add `version: u8` field that doubles as discriminator
- Existing accounts have version=0 (no key). New accounts get version=1 (with key)
- SDK checks version before choosing deserialization path
- Gradually migrate accounts via a migration instruction

**Option B: Clean redeploy (acceptable for devnet/pre-launch)**
- Add discriminator to all structs
- Redeploy program
- Wipe all accounts (devnet only)
- Simpler, no migration logic

**Recommended**: Option B if still pre-mainnet. Option A if any mainnet accounts exist.

### Phase 2: SDK Updates

1. Add `AccountKey` enum
2. Update all deserializers (read + validate key byte)
3. Add `deserializeAnyAccount` universal router
4. Update all size constants after padding audit
5. Rewrite `GameSubscriptionManager` — single `onProgramAccountChange` with discriminator routing, kingdom filtering, user relevance filtering
6. Run `bun test` — fix all test failures

### Phase 3: Web App Data Layer

1. Create `accounts.ts` zustand store
2. Create `subscriptions.ts` bridge
3. Create `selectors.ts` derived values
4. Update `provider.tsx` to initialize store on wallet connect
5. Migrate hooks one-by-one (player first, then encounters, then rest)
6. Update page components to read from zustand
7. Remove React Query polling (set `staleTime: Infinity` on WS-backed queries)
8. Run `npx next build` — fix all type errors

### Phase 4: Verification

2. Verify WebSocket updates propagate to UI in <1s
3. Verify no stale data in combat/encounter/loot flows
4. Verify RPC call count decreased (monitor with devtools)
5. Verify cleanup: no WebSocket leaks on page navigation

---

## 10. File Inventory

### Total Files Affected

| Layer | New | Modified | Deleted |
|-------|-----|----------|---------|
| Rust program | 1 | ~120 | 0 |
| SDK | 1 | ~20 | 0 |
| Web app | 3 | ~25 | 0 |
| Tests | 1 | ~25 | 0 |
| **Total** | **6** | **~190** | **0** |

### Execution Order

```
1. programs/novus_mundus/src/state/mod.rs           — AccountKey enum
2. programs/novus_mundus/src/error.rs               — InvalidAccountKey error
3. programs/novus_mundus/src/state/*.rs              — Add field to all structs (15 files)
4. programs/novus_mundus/src/processor/**/*.rs       — Validate + set key (100+ files)
5. sdks/novus-mundus-ts/src/types/enums.ts          — AccountKey enum (TS)
6. sdks/novus-mundus-ts/src/state/*.ts              — Update deserializers (15 files)
7. sdks/novus-mundus-ts/src/subscriptions/game.ts   — Discriminator routing
8. sdks/novus-mundus-ts/src/client.ts               — Update client
9. sdks/novus-mundus-ts/tests/**/*.ts               — Fix all tests
10. apps/web/src/lib/store/accounts.ts              — New zustand store
11. apps/web/src/lib/store/subscriptions.ts         — Subscription bridge
12. apps/web/src/lib/store/selectors.ts             — Derived selectors
13. apps/web/src/lib/solana/provider.tsx             — Wire up initialization
14. apps/web/src/lib/hooks/*.ts                     — Migrate all hooks
15. apps/web/src/app/(game)/**/*.tsx                — Update page components
```

---

## Appendix A: Account Key Quick Reference

```
 0 = Uninitialized          13 = Expedition
 1 = GameEngine             14 = Loot
 2 = Player                 15 = ArenaSeason
 3 = User                   16 = ArenaParticipant
 4 = City                   17 = ArenaLoadout
 5 = Team                   18 = Castle
 6 = TeamMemberSlot         19 = CastleGarrison
 7 = TeamInvite             20 = DungeonRun
 8 = TreasuryRequest        21 = DungeonTemplate
 9 = Encounter              22 = DungeonLeaderboard
10 = Rally                  23 = Estate
11 = RallyParticipant       24 = ShopConfig
12 = Reinforcement          25-38 = Shop/Hero/Forge/Sanctuary/Research/Event/Name/Token
```

## Appendix B: Single Subscription — Relevance Filtering

One `onProgramAccountChange` subscription receives everything. The `GameSubscriptionManager` filters by relevance before writing to zustand:

| Filter Layer | Logic | Cost |
|-------------|-------|------|
| **Discriminator** | Read byte 0 — is this an account type we care about? Drop `Uninitialized`, unknown keys. | O(1), 1 byte read |
| **Kingdom** | Read bytes 1-32 — does the `game_engine` Pubkey match ours? Drop other kingdoms. | O(1), 32 byte compare |
| **User relevance** | Per-type check: is this the player's loot? Their city's encounter? Their team? | O(1), field comparison |
| **Write to zustand** | Deserialize and call the appropriate store setter | Only for relevant accounts |

Account types the UI doesn't need handlers for (e.g., `DungeonTemplate`, `ResearchTemplate`, `ShopConfig`) simply have no registered handler — the manager receives the event, sees no handler, and drops it. If a page needs that data, it uses a one-time React Query fetch with a long staleTime.
