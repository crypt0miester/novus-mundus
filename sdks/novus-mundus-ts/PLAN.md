# TypeScript SDK Plan for Novus Mundus

## Scope Summary

- **170 instructions** across 25 modules
- **20 state account types** (Player is 1,914 bytes with extensions)
- **191 event types** across 20 modules
- **466 error codes**
- **30+ PDA seeds**
- **5 external dependencies** (MPL Core, Pyth, Switchboard, ANS, TLD House)

---

## SDK Architecture

```
sdks/novus-mundus-ts/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # Main exports
│   ├── program.ts                  # Program ID, constants
│   ├── pda.ts                      # All PDA derivation functions
│   ├── errors.ts                   # Error enum + parsing
│   ├── constants.ts                # Game constants
│   │
│   ├── types/
│   │   ├── index.ts
│   │   ├── common.ts               # Shared types (Pubkey aliases, etc.)
│   │   └── enums.ts                # All enums (EncounterType, EventType, etc.)
│   │
│   ├── state/                      # Account deserialization (20 files)
│   │   ├── index.ts
│   │   ├── gameEngine.ts
│   │   ├── player.ts               # Complex: 1,914 bytes with sections
│   │   ├── team.ts
│   │   ├── rally.ts
│   │   ├── castle.ts
│   │   ├── dungeon.ts
│   │   ├── ... (15 more)
│   │
│   ├── instructions/               # Instruction builders (25 modules)
│   │   ├── index.ts
│   │   ├── initialization/
│   │   ├── economy/
│   │   ├── combat/
│   │   ├── team/
│   │   ├── travel/
│   │   ├── rally/
│   │   ├── reinforcement/
│   │   ├── research/
│   │   ├── hero/
│   │   ├── shop/
│   │   ├── estate/
│   │   ├── forge/
│   │   ├── expedition/
│   │   ├── arena/
│   │   ├── dungeon/
│   │   ├── castle/
│   │   ├── sanctuary/
│   │   ├── subscription/
│   │   ├── event/
│   │   ├── name/
│   │   ├── loot/
│   │   ├── progression/
│   │   ├── token/
│   │   └── encounter/
│   │
│   ├── events/                     # Event parsing (191 types)
│   │   ├── index.ts
│   │   ├── parser.ts               # Main event parser
│   │   ├── combat.ts
│   │   ├── castle.ts
│   │   ├── team.ts
│   │   ├── ... (17 more modules)
│   │
│   ├── parser/                     # Transaction & instruction parsing
│   │   ├── index.ts
│   │   ├── transaction.ts          # Parse full transactions
│   │   ├── instruction.ts          # Parse individual instructions
│   │   └── logs.ts                 # Parse transaction logs for events
│   │
│   ├── external/                   # External program integrations
│   │   ├── index.ts
│   │   ├── mplCore.ts              # MPL Core (hero NFTs)
│   │   ├── pyth.ts                 # Pyth oracle price feeds
│   │   ├── switchboard.ts          # Switchboard oracle price feeds
│   │   ├── nameService.ts          # ALT Name Service (ANS)
│   │   └── tldHouse.ts             # TLD House (primary domains)
│   │
│   └── utils/
│       ├── index.ts
│       ├── serialize.ts            # Borsh-like serialization
│       ├── deserialize.ts          # Account data parsing
│       └── helpers.ts              # Common utilities
```

---

## External Dependencies

### 1. MPL Core (p-core) - Hero NFT System

**Program ID:** `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`

**Purpose:** Metaplex Core NFT operations for hero creation, transfers, and on-chain attributes.

**Instructions Used:**

| Instruction | Usage | Files |
|-------------|-------|-------|
| `CreateV1` | Mint new hero NFT | `hero/mint.rs` |
| `CreateCollectionV1` | Create hero collection | `hero/create_collection.rs` |
| `TransferV1` | Lock/unlock heroes, expedition/dungeon/sanctuary | `hero/lock.rs`, `hero/unlock.rs`, `expedition/*.rs`, `dungeon/*.rs`, `sanctuary/*.rs` |
| `AddPluginV1` | Add Attributes plugin with hero stats | `hero/mint.rs` |
| `UpdatePluginV1` | Update hero level/buffs | `hero/level_up.rs`, `hero/lock.rs`, `hero/unlock.rs`, `sanctuary/claim_meditation.rs` |

**Account Requirements:**
- `hero_mint` - Hero NFT (MPL Core Asset)
- `hero_collection` - Hero Collection PDA
- `game_engine` - Update authority (PDA signer)
- `p_core_program` - MPL Core program

**Hero Attributes (stored on-chain in NFT):**
- `level`, `xp`, `attack_buff`, `defense_buff`, `crit_buff`
- `speed_buff`, `economy_buff`, `locked` (boolean)

---

### 2. Pyth Network (p-pyth) - Primary Oracle

**Purpose:** Decentralized price oracle for SPL token payment conversions.

**Key Function:** `load_pyth_price_with_confidence()`

**Parameters:**
- `pyth_data: &[u8]` - Raw account data
- `current_slot: u64` - Current blockchain slot
- `max_staleness_slots: u64` - Maximum acceptable age
- `max_confidence_bps: u16` - Maximum confidence threshold

**Magic Number:** `0xa1b2c3d4` (used to detect Pyth vs Switchboard accounts)

**Required Accounts:**
- `sol_pyth_feed` - SOL/USD Pyth price feed
- `token_pyth_feed` - TOKEN/USD Pyth price feed

**Shop Config Fields:**
- `sol_pyth_feed: Pubkey`
- `sol_max_staleness_slots: u16`
- `sol_confidence_threshold_bps: u16`

**Used In:** Shop purchases, subscription purchases, flash sales

---

### 3. Switchboard On-Demand - Secondary Oracle

**Purpose:** Alternative decentralized price oracle for token payments.

**Key Type:** `QuoteVerifier`

**Methods:**
- `.new()` - Create verifier
- `.slothash_sysvar()` - Set SlotHashes sysvar
- `.ix_sysvar()` - Set Instructions sysvar
- `.clock_slot()` - Set current slot
- `.queue()` - Set Switchboard queue
- `.max_age()` - Set staleness limit
- `.verify_account()` - Verify and return quote data

**Required Accounts:**
- `sol_oracle_feed` - SOL/USD Switchboard quote
- `token_oracle_feed` - TOKEN/USD Switchboard quote
- `switchboard_queue` - Switchboard queue account
- `slothashes_sysvar` - SlotHashes system variable
- `instructions_sysvar` - Instructions system variable

**Used In:** Same as Pyth (fallback oracle)

---

### 4. ALT Name Service (ANS) - Domain Names

**Program ID:** Custom (in `alt_name_service::ID`)

**Purpose:** Domain name registration, ownership, and transfers.

**Key Types:**
- `NameRecordHeader` - Domain record structure
  - Methods: `is_valid()`, `is_owner(pubkey)`, `is_expired(timestamp)`
  - Fields: `parent_name`, `nclass`, `owner`

**Instructions:**
- `Transfer` - Transfer domain ownership to PlayerAccount/TeamAccount PDA

**PDA Derivation:**
- Forward: `[SHA256("ALT Name Service" + domain_name), NULL_PUBKEY, name_parent.key()]`
- Reverse: `[SHA256("ALT Name Service" + name_account.key().to_base58()), tld_house.key(), NULL_PUBKEY]`

**Hash Prefix:** `b"ALT Name Service"`

**Required Accounts:**
- `name_account` - Forward domain account
- `reverse_name_account` - Reverse lookup account
- `name_parent` - TLD account (.tld)
- `name_class` - Usually NULL_PUBKEY

**Validation:** `validate_and_get_domain_name()` in `helpers/name_service.rs`

---

### 5. TLD House - Primary Domain Registry

**Program ID:** `TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S`

**Purpose:** Set primary/main domain for accounts.

**Instruction:** `SetMainDomain`

**Anchor Discriminator:** `[0x87, 0x84, 0xe5, 0x4f, 0x2d, 0xc3, 0xcc, 0xf8]`

**Instruction Data:**
```
- discriminator: [u8; 8]
- name: String (4-byte length + data)
- hashed_name: Vec<u8> (4-byte length + 32 bytes)
- tld: String (4-byte length + data)
- reverse_acc_hashed_name: Vec<u8> (4-byte length + 32 bytes)
```

**PDA Derivation:**
- MainDomain: `["main_domain", owner.key()]`
- TldState: `["tld_pda"]`
- TldHouse: `["tld_house", tld_lowercase]`

**TldHouse Account Layout:**
```
Offset 0:   [u8; 8]   discriminator
Offset 8:   [u8; 32]  treasury_manager
Offset 40:  [u8; 32]  authority
Offset 72:  [u8; 32]  tld_registry_pubkey
Offset 104: String    tld (4-byte len + data)
```

**Required Accounts:**
- `payer` - Domain owner (signer)
- `tld_state` - TldState PDA
- `tld_house` - TldHouse account
- `main_domain` - MainDomain PDA (writable)
- `name_account` - Domain account
- `name_parent` - TLD account
- `reverse_name_account` - Reverse lookup
- `name_service_program` - ALT Name Service program

---

### External Programs Summary

| Dependency | Program ID | Primary Use |
|------------|-----------|-------------|
| MPL Core | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` | Hero NFT minting, transfers, attributes |
| Pyth | Various feeds | Token price conversion (primary) |
| Switchboard | Various queues | Token price conversion (secondary) |
| ALT Name Service | Custom | Domain name ownership/transfer |
| TLD House | `TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S` | Primary domain assignment |

---

## Implementation Phases

### Phase 1: Core Infrastructure
1. **Setup** - package.json, tsconfig, dependencies (@solana/web3.js, bn.js)
2. **Program constants** - Program ID, all PDA seeds
3. **PDA derivation** - 30+ `derive*Pda()` functions
4. **Error handling** - All 466 errors with parsing
5. **Common types** - Enums, shared interfaces

### Phase 2: State Account Deserialization
1. **GameEngine** - Global config
2. **Player** - Full 1,914 byte structure with all sections
3. **Team, TeamMemberSlot, TeamInvite, TreasuryRequest**
4. **Rally, RallyParticipant**
5. **Castle, GarrisonContribution, CourtPosition, KingRegistry**
6. **Dungeon, DungeonTemplate, DungeonLeaderboard**
7. **Estate, Shop, Research, Hero, Expedition, Arena, etc.**

### Phase 3: Instruction Builders (All 170 instructions)

| Module | Count | Instructions |
|--------|-------|--------------|
| Initialization | 4 | game_engine, player, user, city |
| Economy | 8 | collect_resources, hire_units, purchase_equipment, purchase_stamina, transfer_cash, update_locked_novi, vault_transfer, mint_for_prize |
| Combat | 2 | attack_player, attack_encounter |
| Team | 21 | create, join, leave, disband, invite, accept_invite, decline_invite, cancel_invite, kick_member, demote_member, promote_member, transfer_leadership, set_motd, update_settings, update_treasury_settings, deposit_treasury, withdraw_treasury, treasury_request_withdraw, treasury_approve_request, treasury_reject_request, treasury_execute_request, treasury_cancel_request |
| Travel | 8 | intracity_start, intracity_complete, intracity_cancel, intercity_start, intercity_complete, intercity_cancel, intercity_teleport, speedup |
| Rally | 8 | create, join, leave, cancel, execute, close_rally, process_return, speedup |
| Reinforcement | 6 | send, recall, relieve, process_arrival, process_return, speedup |
| Research | 8 | start_research, complete_research, cancel_research, speed_up_research, ascend, create_progress, initialize_template, update_template |
| Hero | 7 | mint, lock, unlock, level_up, assign_defensive, create_template, create_collection |
| Shop | 20 | initialize_config, create_item, update_item, create_bundle, update_bundle, purchase_item, purchase_bundle, create_flash_sale, purchase_flash_sale, close_sale, create_daily_deal, rotate_daily_deal, create_weekly_sale, create_seasonal_sale, create_dao_promotion, update_config, create_allowed_token, update_allowed_token, close_allowed_token, activate_sale |
| Estate | 8 | create, buy_plot, build, complete, upgrade, daily_activity, daily_claim, convert_materials |
| Forge | 5 | initialize, start_craft, strike, equip, abandon_craft |
| Expedition | 5 | start, claim, abort, strike, speedup |
| Arena | 7 | create_season, join_season, challenge_player, update_loadout, claim_daily_reward, claim_master_reward, close_season |
| Dungeon | 11 | enter, attack, attack_multi, choose_relic, interact, flee, resume, claim, create_template, create_leaderboard, claim_leaderboard_prize |
| Castle | 22 | create_castle, claim_vacant_castle, attack_castle, cancel_upgrade, initiate_upgrade, complete_upgrade, join_garrison, leave_garrison, relieve_garrison, garrison_cleanup, appoint_court, dismiss_court, court_cleanup, resign_court, update_castle_config, update_castle_status, claim_castle_rewards, claim_garrison_loot, finalize_transition, force_remove_king, rewards_cleanup |
| Sanctuary | 2 | start_meditation, claim_meditation |
| Subscription | 3 | purchase, update_tier, downgrade_expired |
| Event | 4 | create, join, finalize, claim_prize |
| Name | 6 | set_player, update_player, remove_player, set_team, update_team, remove_team |
| Loot | 1 | claim |
| Progression | 1 | claim_daily_reward |
| Token | 2 | reserved_to_locked, withdraw_reserved |
| Encounter | 1 | spawn |

### Phase 4: Event Parsing
1. Event discriminator calculation (sha256 hash of event name)
2. Event type definitions for all 191 events
3. Event parser that decodes transaction logs

### Phase 5: Client Utilities
1. **NovusMundusClient** class - High-level wrapper
2. Account fetching helpers
3. Transaction builders with compute budget
4. Simulation utilities

---

## Key Design Decisions

1. **No Anchor dependency** - Pure @solana/web3.js since program uses Pinocchio
2. **Borsh-compatible serialization** - Manual implementation for instruction data
3. **BN.js for u64/i64** - Standard for Solana amounts
4. **Discriminator-based instructions** - First 2 bytes are instruction index (little-endian u16)
5. **Event parsing via logs** - SHA256 discriminator in sol_log_data

---

## Code Examples

### 1. Program Constants (`program.ts`)

```typescript
import { PublicKey } from '@solana/web3.js';

/** Novus Mundus Program ID */
export const PROGRAM_ID = new PublicKey([
  0xfd, 0x6a, 0x11, 0x5a, 0x69, 0xa1, 0x9d, 0x7c,
  0x75, 0x54, 0x9e, 0x38, 0x7f, 0x11, 0x2d, 0x0b,
  0xb3, 0xe5, 0xb2, 0x5d, 0x5f, 0x7c, 0xa4, 0x6e,
  0x8b, 0x2e, 0x6c, 0xd1, 0xb9, 0xf6, 0x3b, 0x6c,
]);

/** External Program IDs */
export const MPL_CORE_PROGRAM_ID = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
export const TLD_HOUSE_PROGRAM_ID = new PublicKey('TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S');

/** PDA Seeds */
export const SEEDS = {
  GAME_ENGINE: Buffer.from('game_engine'),
  NOVI_MINT: Buffer.from('novi_mint'),
  PLAYER: Buffer.from('player'),
  USER: Buffer.from('user'),
  CITY: Buffer.from('city'),
  TEAM: Buffer.from('team'),
  TEAM_SLOT: Buffer.from('team_slot'),
  TEAM_INVITE: Buffer.from('team_invite'),
  TREASURY_REQUEST: Buffer.from('treasury_request'),
  RALLY: Buffer.from('rally'),
  RALLY_PARTICIPANT: Buffer.from('rally_participant'),
  REINFORCEMENT: Buffer.from('reinforcement'),
  GARRISON: Buffer.from('garrison'),
  EXPEDITION: Buffer.from('expedition'),
  CASTLE: Buffer.from('castle'),
  COURT: Buffer.from('court'),
  DUNGEON_RUN: Buffer.from('dungeon_run'),
  ARENA_PARTICIPANT: Buffer.from('arena_participant'),
  ESTATE: Buffer.from('estate'),
  HERO_COLLECTION: Buffer.from('hero_collection'),
  // ... more seeds
} as const;

/** Instruction Discriminators (little-endian u16) */
export const DISCRIMINATORS = {
  // Initialization (0-9)
  INIT_GAME_ENGINE: 0,
  INIT_PLAYER: 1,
  INIT_USER: 2,
  INIT_CITY: 3,

  // Economy (10-19)
  UPDATE_LOCKED_NOVI: 10,
  HIRE_UNITS: 11,
  COLLECT_RESOURCES: 12,
  PURCHASE_EQUIPMENT: 13,
  MINT_FOR_PRIZE: 14,
  RESERVED_TO_LOCKED: 15,
  WITHDRAW_RESERVED: 16,
  PURCHASE_STAMINA: 17,
  TRANSFER_CASH: 18,
  VAULT_TRANSFER: 19,

  // Combat (20-29)
  ATTACK_PLAYER: 20,
  ATTACK_ENCOUNTER: 21,

  // ... (all 170 instruction discriminators)

  // Castle (270-290)
  CREATE_CASTLE: 270,
  CLAIM_VACANT_CASTLE: 271,
  APPOINT_COURT: 272,
  // ...
} as const;
```

---

### 2. PDA Derivation (`pda.ts`)

```typescript
import { PublicKey } from '@solana/web3.js';
import { PROGRAM_ID, SEEDS, TLD_HOUSE_PROGRAM_ID } from './program';
import { sha256 } from '@noble/hashes/sha256';

/** Derive GameEngine PDA */
export function deriveGameEnginePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.GAME_ENGINE],
    PROGRAM_ID
  );
}

/** Derive PlayerAccount PDA from owner wallet */
export function derivePlayerPda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.PLAYER, owner.toBuffer()],
    PROGRAM_ID
  );
}

/** Derive Team PDA from team ID */
export function deriveTeamPda(teamId: number): [PublicKey, number] {
  const teamIdBuffer = Buffer.alloc(4);
  teamIdBuffer.writeUInt32LE(teamId);
  return PublicKey.findProgramAddressSync(
    [SEEDS.TEAM, teamIdBuffer],
    PROGRAM_ID
  );
}

/** Derive Expedition PDA for a player */
export function deriveExpeditionPda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.EXPEDITION, owner.toBuffer()],
    PROGRAM_ID
  );
}

/** Derive Castle PDA from castle ID */
export function deriveCastlePda(castleId: number): [PublicKey, number] {
  const castleIdBuffer = Buffer.alloc(2);
  castleIdBuffer.writeUInt16LE(castleId);
  return PublicKey.findProgramAddressSync(
    [SEEDS.CASTLE, castleIdBuffer],
    PROGRAM_ID
  );
}

/** Derive Rally Participant PDA */
export function deriveRallyParticipantPda(
  rally: PublicKey,
  player: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.RALLY_PARTICIPANT, rally.toBuffer(), player.toBuffer()],
    PROGRAM_ID
  );
}

/** Derive Hero Collection PDA */
export function deriveHeroCollectionPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.HERO_COLLECTION],
    PROGRAM_ID
  );
}

/** Derive ANS name account PDA */
export function deriveNameAccountPda(
  domainName: string,
  nameParent: PublicKey
): PublicKey {
  const HASH_PREFIX = 'ALT Name Service';
  const hashedName = sha256(Buffer.from(HASH_PREFIX + domainName));
  const NULL_PUBKEY = new PublicKey(new Uint8Array(32));

  const [pda] = PublicKey.findProgramAddressSync(
    [hashedName, NULL_PUBKEY.toBuffer(), nameParent.toBuffer()],
    ALT_NAME_SERVICE_PROGRAM_ID
  );
  return pda;
}

/** Derive TLD House MainDomain PDA */
export function deriveMainDomainPda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('main_domain'), owner.toBuffer()],
    TLD_HOUSE_PROGRAM_ID
  );
}
```

---

### 3. State Account Deserialization (`state/player.ts`)

```typescript
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

/** Account discriminator size */
const DISCRIMINATOR_SIZE = 8;

/** Player account structure (1,914 bytes with extensions) */
export interface PlayerAccount {
  // Base fields (offset 0)
  owner: PublicKey;
  walletAddress: PublicKey;
  cityId: number;
  teamId: number;
  level: number;
  xp: BN;
  reputation: BN;
  subscriptionTier: number;
  subscriptionExpiry: BN;
  name: Uint8Array; // 32 bytes

  // Resources
  lockedNovi: BN;
  reservedNovi: BN;
  reservedNoviTimestamp: BN;
  cash: BN;
  gems: BN;
  weapons: BN;
  produce: BN;
  vehicles: BN;
  fragments: BN;

  // Units
  defensiveUnit1: BN;
  defensiveUnit2: BN;
  defensiveUnit3: BN;
  operativeUnit1: BN;
  operativeUnit2: BN;
  operativeUnit3: BN;

  // Combat stats
  stamina: BN;
  staminaUpdatedAt: BN;
  happiness: number;
  lastAttackedAt: BN;
  newPlayerProtectionEnds: BN;

  // Location
  latitude: number;
  longitude: number;
  travelDestLat: number;
  travelDestLng: number;
  travelStartTime: BN;
  travelEndTime: BN;

  // Hero slots (5 active heroes)
  activeHeroes: PublicKey[];
  defensiveHero: PublicKey;

  // Timestamps
  lastCollectionTime: BN;
  lastDailyClaimTime: BN;
  createdAt: BN;
  lastActiveAt: BN;

  // Extension flags
  hasResearch: boolean;
  hasHeroes: boolean;
  hasInventory: boolean;
  hasRally: boolean;
  hasTeam: boolean;
  hasCosmetics: boolean;
  hasMining: boolean;
  hasFishing: boolean;

  // Crafted equipment (if hasInventory)
  craftedMeleeWeapon: number;
  craftedRangedWeapon: number;
  craftedSiegeWeapon: number;
  craftedArmor: number;
}

/** Deserialize PlayerAccount from buffer */
export function deserializePlayerAccount(data: Buffer): PlayerAccount {
  let offset = DISCRIMINATOR_SIZE;

  const owner = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const walletAddress = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const cityId = data.readUInt16LE(offset);
  offset += 2;

  const teamId = data.readUInt32LE(offset);
  offset += 4;

  const level = data.readUInt8(offset);
  offset += 1;

  const xp = new BN(data.subarray(offset, offset + 8), 'le');
  offset += 8;

  // ... continue for all fields

  return {
    owner,
    walletAddress,
    cityId,
    teamId,
    level,
    xp,
    // ... all fields
  };
}

/** Fetch and deserialize PlayerAccount */
export async function fetchPlayerAccount(
  connection: Connection,
  playerPda: PublicKey
): Promise<PlayerAccount | null> {
  const accountInfo = await connection.getAccountInfo(playerPda);
  if (!accountInfo || accountInfo.data.length === 0) {
    return null;
  }
  return deserializePlayerAccount(Buffer.from(accountInfo.data));
}
```

---

### 3.5. Batched Account Fetching (`utils/batch.ts`)

```typescript
import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';

/** Maximum accounts per getMultipleAccountsInfo call */
const BATCH_SIZE = 100;

/**
 * Batch fetch multiple accounts using getMultipleAccountsInfo
 * Automatically chunks requests into batches of 100 (RPC limit)
 */
export async function getMultipleAccountsBatched(
  connection: Connection,
  publicKeys: PublicKey[]
): Promise<(AccountInfo<Buffer> | null)[]> {
  if (publicKeys.length === 0) {
    return [];
  }

  // Split into batches of 100
  const batches: PublicKey[][] = [];
  for (let i = 0; i < publicKeys.length; i += BATCH_SIZE) {
    batches.push(publicKeys.slice(i, i + BATCH_SIZE));
  }

  // Fetch all batches in parallel
  const batchResults = await Promise.all(
    batches.map((batch) => connection.getMultipleAccountsInfo(batch))
  );

  // Flatten results
  return batchResults.flat();
}

/**
 * Generic batched fetch with deserialization
 * Returns Map<PublicKey, T> for non-null accounts
 */
export async function fetchMultipleAccountsBatched<T>(
  connection: Connection,
  publicKeys: PublicKey[],
  deserialize: (data: Buffer) => T
): Promise<Map<string, T>> {
  const accounts = await getMultipleAccountsBatched(connection, publicKeys);
  const result = new Map<string, T>();

  for (let i = 0; i < publicKeys.length; i++) {
    const account = accounts[i];
    if (account && account.data.length > 0) {
      try {
        const deserialized = deserialize(Buffer.from(account.data));
        result.set(publicKeys[i].toBase58(), deserialized);
      } catch {
        // Skip accounts that fail to deserialize
      }
    }
  }

  return result;
}

/**
 * Fetch multiple accounts preserving order (null for missing)
 */
export async function fetchMultipleAccountsOrdered<T>(
  connection: Connection,
  publicKeys: PublicKey[],
  deserialize: (data: Buffer) => T
): Promise<(T | null)[]> {
  const accounts = await getMultipleAccountsBatched(connection, publicKeys);

  return accounts.map((account) => {
    if (!account || account.data.length === 0) {
      return null;
    }
    try {
      return deserialize(Buffer.from(account.data));
    } catch {
      return null;
    }
  });
}
```

---

### 3.6. Account-Specific Batch Fetchers (`state/index.ts`)

```typescript
import { Connection, PublicKey } from '@solana/web3.js';
import { fetchMultipleAccountsBatched, fetchMultipleAccountsOrdered } from '../utils/batch';
import { PlayerAccount, deserializePlayerAccount } from './player';
import { TeamAccount, deserializeTeamAccount } from './team';
import { CastleAccount, deserializeCastleAccount } from './castle';
import { ExpeditionAccount, deserializeExpeditionAccount } from './expedition';
import { RallyAccount, deserializeRallyAccount } from './rally';
import { EstateAccount, deserializeEstateAccount } from './estate';
import { DungeonRunAccount, deserializeDungeonRunAccount } from './dungeon';

// ==================== Player Accounts ====================

/** Fetch multiple player accounts by owner wallets */
export async function fetchMultiplePlayerAccounts(
  connection: Connection,
  owners: PublicKey[]
): Promise<Map<string, PlayerAccount>> {
  const playerPdas = owners.map((owner) => derivePlayerPda(owner)[0]);
  return fetchMultipleAccountsBatched(connection, playerPdas, deserializePlayerAccount);
}

/** Fetch multiple player accounts preserving order */
export async function fetchMultiplePlayerAccountsOrdered(
  connection: Connection,
  owners: PublicKey[]
): Promise<(PlayerAccount | null)[]> {
  const playerPdas = owners.map((owner) => derivePlayerPda(owner)[0]);
  return fetchMultipleAccountsOrdered(connection, playerPdas, deserializePlayerAccount);
}

// ==================== Team Accounts ====================

/** Fetch multiple team accounts by team IDs */
export async function fetchMultipleTeamAccounts(
  connection: Connection,
  teamIds: number[]
): Promise<Map<string, TeamAccount>> {
  const teamPdas = teamIds.map((id) => deriveTeamPda(id)[0]);
  return fetchMultipleAccountsBatched(connection, teamPdas, deserializeTeamAccount);
}

/** Fetch multiple team accounts preserving order */
export async function fetchMultipleTeamAccountsOrdered(
  connection: Connection,
  teamIds: number[]
): Promise<(TeamAccount | null)[]> {
  const teamPdas = teamIds.map((id) => deriveTeamPda(id)[0]);
  return fetchMultipleAccountsOrdered(connection, teamPdas, deserializeTeamAccount);
}

// ==================== Castle Accounts ====================

/** Fetch multiple castle accounts by castle IDs */
export async function fetchMultipleCastleAccounts(
  connection: Connection,
  castleIds: number[]
): Promise<Map<string, CastleAccount>> {
  const castlePdas = castleIds.map((id) => deriveCastlePda(id)[0]);
  return fetchMultipleAccountsBatched(connection, castlePdas, deserializeCastleAccount);
}

/** Fetch all castles in a range (e.g., 0-49 for all cities) */
export async function fetchAllCastles(
  connection: Connection,
  startId: number = 0,
  endId: number = 49
): Promise<Map<string, CastleAccount>> {
  const castleIds = Array.from({ length: endId - startId + 1 }, (_, i) => startId + i);
  return fetchMultipleCastleAccounts(connection, castleIds);
}

// ==================== Expedition Accounts ====================

/** Fetch multiple expedition accounts by owner wallets */
export async function fetchMultipleExpeditionAccounts(
  connection: Connection,
  owners: PublicKey[]
): Promise<Map<string, ExpeditionAccount>> {
  const expeditionPdas = owners.map((owner) => deriveExpeditionPda(owner)[0]);
  return fetchMultipleAccountsBatched(connection, expeditionPdas, deserializeExpeditionAccount);
}

// ==================== Rally Accounts ====================

/** Fetch multiple rally accounts by PDAs */
export async function fetchMultipleRallyAccounts(
  connection: Connection,
  rallyPdas: PublicKey[]
): Promise<Map<string, RallyAccount>> {
  return fetchMultipleAccountsBatched(connection, rallyPdas, deserializeRallyAccount);
}

// ==================== Estate Accounts ====================

/** Fetch multiple estate accounts by owner wallets */
export async function fetchMultipleEstateAccounts(
  connection: Connection,
  owners: PublicKey[]
): Promise<Map<string, EstateAccount>> {
  const estatePdas = owners.map((owner) => deriveEstatePda(owner)[0]);
  return fetchMultipleAccountsBatched(connection, estatePdas, deserializeEstateAccount);
}

// ==================== Dungeon Run Accounts ====================

/** Fetch multiple dungeon run accounts by owner wallets */
export async function fetchMultipleDungeonRunAccounts(
  connection: Connection,
  owners: PublicKey[]
): Promise<Map<string, DungeonRunAccount>> {
  const dungeonPdas = owners.map((owner) => deriveDungeonRunPda(owner)[0]);
  return fetchMultipleAccountsBatched(connection, dungeonPdas, deserializeDungeonRunAccount);
}

// ==================== Generic by PDA ====================

/** Fetch any accounts by PDAs with custom deserializer */
export async function fetchMultipleByPda<T>(
  connection: Connection,
  pdas: PublicKey[],
  deserialize: (data: Buffer) => T
): Promise<Map<string, T>> {
  return fetchMultipleAccountsBatched(connection, pdas, deserialize);
}
```

---

### 4. Instruction Builders (`instructions/expedition/start.ts`)

```typescript
import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import BN from 'bn.js';
import { PROGRAM_ID, DISCRIMINATORS, MPL_CORE_PROGRAM_ID } from '../../program';
import { derivePlayerPda, deriveExpeditionPda, deriveHeroCollectionPda } from '../../pda';
import { serializeU16LE, serializeU8, serializeU64LE } from '../../utils/serialize';

/** Expedition type enum */
export enum ExpeditionType {
  Mining = 1,
  Fishing = 2,
}

/** Parameters for starting an expedition */
export interface StartExpeditionParams {
  owner: PublicKey;
  expeditionType: ExpeditionType;
  tier: number; // 0-4
  operativeUnit1: BN;
  operativeUnit2: BN;
  operativeUnit3: BN;
  heroMint?: PublicKey; // Optional hero to send
}

/**
 * Create instruction to start an expedition
 *
 * Locks operatives and NOVI, starts timer for resource generation.
 * Optionally sends a hero for bonus yields.
 */
export function createStartExpeditionInstruction(
  params: StartExpeditionParams
): TransactionInstruction {
  const { owner, expeditionType, tier, operativeUnit1, operativeUnit2, operativeUnit3, heroMint } = params;

  const [playerPda] = derivePlayerPda(owner);
  const [expeditionPda] = deriveExpeditionPda(owner);
  const [heroCollection] = deriveHeroCollectionPda();

  // Build instruction data
  // Discriminator (2 bytes) + type (1) + tier (1) + ops (3x8 bytes)
  const data = Buffer.alloc(2 + 1 + 1 + 24);
  let offset = 0;

  // Discriminator
  data.writeUInt16LE(DISCRIMINATORS.START_EXPEDITION, offset);
  offset += 2;

  // Expedition type
  data.writeUInt8(expeditionType, offset);
  offset += 1;

  // Tier
  data.writeUInt8(tier, offset);
  offset += 1;

  // Operatives
  operativeUnit1.toArrayLike(Buffer, 'le', 8).copy(data, offset);
  offset += 8;
  operativeUnit2.toArrayLike(Buffer, 'le', 8).copy(data, offset);
  offset += 8;
  operativeUnit3.toArrayLike(Buffer, 'le', 8).copy(data, offset);

  // Build accounts
  const keys = [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: playerPda, isSigner: false, isWritable: true },
    { pubkey: expeditionPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Add hero accounts if hero is being sent
  if (heroMint) {
    keys.push(
      { pubkey: heroMint, isSigner: false, isWritable: true },
      { pubkey: heroCollection, isSigner: false, isWritable: false },
      { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
    );
  }

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data,
  });
}
```

---

### 5. Event Parsing (`events/parser.ts`)

```typescript
import { sha256 } from '@noble/hashes/sha256';
import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';

/** Base event interface */
export interface GameEvent {
  name: string;
  timestamp: BN;
}

/** Expedition started event */
export interface ExpeditionStartedEvent extends GameEvent {
  name: 'ExpeditionStarted';
  player: PublicKey;
  playerName: Uint8Array;
  expeditionType: number;
  tier: number;
  operatives: BN;
  noviLocked: BN;
  heroMint: PublicKey;
  endTime: BN;
}

/** Calculate event discriminator (first 8 bytes of SHA256) */
export function getEventDiscriminator(eventName: string): Buffer {
  const hash = sha256(Buffer.from(`event:${eventName}`));
  return Buffer.from(hash.slice(0, 8));
}

/** Event discriminator map */
const EVENT_DISCRIMINATORS: Record<string, string> = {};

// Pre-compute discriminators for all events
const EVENT_NAMES = [
  'ExpeditionStarted',
  'ExpeditionAborted',
  'ExpeditionClaimed',
  'ExpeditionStrike',
  'ExpeditionSpeedup',
  'PlayerAttacked',
  'RallyCreated',
  'RallyExecuted',
  'CastleClaimed',
  'HeroMinted',
  'HeroLevelUp',
  // ... all 191 event names
];

for (const name of EVENT_NAMES) {
  EVENT_DISCRIMINATORS[getEventDiscriminator(name).toString('hex')] = name;
}

/** Parse event from log data */
export function parseEventData(data: Buffer): GameEvent | null {
  if (data.length < 8) return null;

  const discriminator = data.subarray(0, 8).toString('hex');
  const eventName = EVENT_DISCRIMINATORS[discriminator];

  if (!eventName) return null;

  // Parse based on event type
  switch (eventName) {
    case 'ExpeditionStarted':
      return parseExpeditionStartedEvent(data);
    case 'ExpeditionAborted':
      return parseExpeditionAbortedEvent(data);
    // ... all event parsers
    default:
      return null;
  }
}

function parseExpeditionStartedEvent(data: Buffer): ExpeditionStartedEvent {
  let offset = 8; // Skip discriminator

  const player = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const playerName = data.subarray(offset, offset + 32);
  offset += 32;

  const expeditionType = data.readUInt8(offset);
  offset += 1;

  const tier = data.readUInt8(offset);
  offset += 1;

  const operatives = new BN(data.subarray(offset, offset + 8), 'le');
  offset += 8;

  const noviLocked = new BN(data.subarray(offset, offset + 8), 'le');
  offset += 8;

  const heroMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const endTime = new BN(data.subarray(offset, offset + 8), 'le');
  offset += 8;

  const timestamp = new BN(data.subarray(offset, offset + 8), 'le');

  return {
    name: 'ExpeditionStarted',
    player,
    playerName,
    expeditionType,
    tier,
    operatives,
    noviLocked,
    heroMint,
    endTime,
    timestamp,
  };
}

/** Parse all events from transaction logs */
export function parseEventsFromLogs(logs: string[]): GameEvent[] {
  const events: GameEvent[] = [];

  for (const log of logs) {
    // Look for base64-encoded event data
    if (log.startsWith('Program data: ')) {
      const base64Data = log.slice('Program data: '.length);
      const data = Buffer.from(base64Data, 'base64');
      const event = parseEventData(data);
      if (event) {
        events.push(event);
      }
    }
  }

  return events;
}
```

---

### 6. Transaction Parser (`parser/transaction.ts`)

```typescript
import {
  Connection,
  ParsedTransactionWithMeta,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import { PROGRAM_ID, DISCRIMINATORS } from '../program';
import { GameEvent, parseEventsFromLogs } from '../events/parser';

/** Parsed instruction info */
export interface ParsedInstruction {
  name: string;
  discriminator: number;
  accounts: PublicKey[];
  data: Buffer;
}

/** Full parsed transaction result */
export interface ParsedTransaction {
  signature: string;
  slot: number;
  blockTime: number | null;
  success: boolean;
  instructions: ParsedInstruction[];
  events: GameEvent[];
  error?: string;
}

/** Instruction name lookup */
const INSTRUCTION_NAMES: Record<number, string> = {
  [DISCRIMINATORS.INIT_GAME_ENGINE]: 'InitializeGameEngine',
  [DISCRIMINATORS.INIT_PLAYER]: 'InitializePlayer',
  [DISCRIMINATORS.INIT_USER]: 'InitializeUser',
  [DISCRIMINATORS.HIRE_UNITS]: 'HireUnits',
  [DISCRIMINATORS.ATTACK_PLAYER]: 'AttackPlayer',
  [DISCRIMINATORS.CREATE_CASTLE]: 'CreateCastle',
  // ... all 170 instructions
};

/** Parse a single instruction */
export function parseInstruction(
  programId: PublicKey,
  accounts: PublicKey[],
  data: Buffer
): ParsedInstruction | null {
  // Only parse Novus Mundus instructions
  if (!programId.equals(PROGRAM_ID)) {
    return null;
  }

  if (data.length < 2) {
    return null;
  }

  const discriminator = data.readUInt16LE(0);
  const name = INSTRUCTION_NAMES[discriminator] || `Unknown_${discriminator}`;

  return {
    name,
    discriminator,
    accounts,
    data,
  };
}

/** Parse a full transaction by signature */
export async function parseTransaction(
  connection: Connection,
  signature: string
): Promise<ParsedTransaction | null> {
  const tx = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) {
    return null;
  }

  const instructions: ParsedInstruction[] = [];
  const message = tx.transaction.message;

  // Parse each instruction
  for (const ix of message.compiledInstructions) {
    const programId = message.staticAccountKeys[ix.programIdIndex];
    const accountKeys = ix.accountKeyIndexes.map(
      idx => message.staticAccountKeys[idx]
    );
    const data = Buffer.from(ix.data);

    const parsed = parseInstruction(programId, accountKeys, data);
    if (parsed) {
      instructions.push(parsed);
    }
  }

  // Parse events from logs
  const events = tx.meta?.logMessages
    ? parseEventsFromLogs(tx.meta.logMessages)
    : [];

  return {
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    success: tx.meta?.err === null,
    instructions,
    events,
    error: tx.meta?.err ? JSON.stringify(tx.meta.err) : undefined,
  };
}

/** Watch for new transactions and parse them */
export function subscribeToTransactions(
  connection: Connection,
  programId: PublicKey,
  callback: (tx: ParsedTransaction) => void
): number {
  return connection.onLogs(
    programId,
    async (logs, ctx) => {
      const parsed = await parseTransaction(connection, logs.signature);
      if (parsed) {
        callback(parsed);
      }
    },
    'confirmed'
  );
}
```

---

### 7. External Integration (`external/mplCore.ts`)

```typescript
import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { MPL_CORE_PROGRAM_ID } from '../program';

/** MPL Core instruction discriminators */
export const MPL_CORE_DISCRIMINATORS = {
  CREATE_V1: Buffer.from([0]), // CreateV1
  CREATE_COLLECTION_V1: Buffer.from([1]), // CreateCollectionV1
  ADD_PLUGIN_V1: Buffer.from([2]), // AddPluginV1
  UPDATE_PLUGIN_V1: Buffer.from([5]), // UpdatePluginV1
  TRANSFER_V1: Buffer.from([14]), // TransferV1
};

/** Plugin types */
export enum PluginType {
  Attributes = 11,
}

/** Plugin authority types */
export enum PluginAuthority {
  UpdateAuthority = 1,
}

/** Data state for assets */
export enum DataState {
  AccountState = 0,
}

/** Hero attribute keys */
export const HERO_ATTRIBUTE_KEYS = [
  'level',
  'xp',
  'attack_buff',
  'defense_buff',
  'crit_buff',
  'speed_buff',
  'economy_buff',
  'locked',
  'origin_city',
] as const;

/** Create TransferV1 instruction for hero NFT */
export function createMplCoreTransferInstruction(params: {
  asset: PublicKey;
  collection: PublicKey;
  currentOwner: PublicKey;
  newOwner: PublicKey;
  payer: PublicKey;
  authority: PublicKey;
}): TransactionInstruction {
  const { asset, collection, currentOwner, newOwner, payer, authority } = params;

  // TransferV1 has no additional data, just discriminator
  const data = Buffer.from([14]); // TransferV1 discriminator

  return new TransactionInstruction({
    programId: MPL_CORE_PROGRAM_ID,
    keys: [
      { pubkey: asset, isSigner: false, isWritable: true },
      { pubkey: collection, isSigner: false, isWritable: false },
      { pubkey: currentOwner, isSigner: false, isWritable: false },
      { pubkey: newOwner, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/** Parse hero attributes from MPL Core asset */
export function parseHeroAttributes(
  attributesData: Buffer
): Record<string, string> {
  const attributes: Record<string, string> = {};
  let offset = 0;

  // Read number of attributes
  const count = attributesData.readUInt32LE(offset);
  offset += 4;

  for (let i = 0; i < count; i++) {
    // Key length
    const keyLen = attributesData.readUInt32LE(offset);
    offset += 4;

    // Key
    const key = attributesData.subarray(offset, offset + keyLen).toString('utf8');
    offset += keyLen;

    // Value length
    const valLen = attributesData.readUInt32LE(offset);
    offset += 4;

    // Value
    const value = attributesData.subarray(offset, offset + valLen).toString('utf8');
    offset += valLen;

    attributes[key] = value;
  }

  return attributes;
}
```

---

### 8. High-Level Client (`client.ts`)

```typescript
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import BN from 'bn.js';
import * as pda from './pda';
import * as state from './state';
import * as instructions from './instructions';
import { parseTransaction, ParsedTransaction } from './parser/transaction';
import { GameEvent, parseEventsFromLogs } from './events/parser';

/** Client configuration */
export interface NovusMundusClientConfig {
  connection: Connection;
  wallet?: Keypair;
  computeUnits?: number;
  priorityFee?: number;
}

/** Novus Mundus SDK Client */
export class NovusMundusClient {
  readonly connection: Connection;
  readonly wallet?: Keypair;
  readonly computeUnits: number;
  readonly priorityFee: number;

  constructor(config: NovusMundusClientConfig) {
    this.connection = config.connection;
    this.wallet = config.wallet;
    this.computeUnits = config.computeUnits ?? 200_000;
    this.priorityFee = config.priorityFee ?? 1;
  }

  // ==================== PDA Helpers ====================

  /** Get player PDA for a wallet */
  getPlayerPda(owner: PublicKey): PublicKey {
    return pda.derivePlayerPda(owner)[0];
  }

  /** Get team PDA for a team ID */
  getTeamPda(teamId: number): PublicKey {
    return pda.deriveTeamPda(teamId)[0];
  }

  /** Get expedition PDA for a player */
  getExpeditionPda(owner: PublicKey): PublicKey {
    return pda.deriveExpeditionPda(owner)[0];
  }

  /** Get castle PDA */
  getCastlePda(castleId: number): PublicKey {
    return pda.deriveCastlePda(castleId)[0];
  }

  // ==================== Single Account Fetchers ====================

  /** Fetch player account */
  async getPlayer(owner: PublicKey): Promise<state.PlayerAccount | null> {
    const playerPda = this.getPlayerPda(owner);
    return state.fetchPlayerAccount(this.connection, playerPda);
  }

  /** Fetch team account */
  async getTeam(teamId: number): Promise<state.TeamAccount | null> {
    const teamPda = this.getTeamPda(teamId);
    return state.fetchTeamAccount(this.connection, teamPda);
  }

  /** Fetch expedition account */
  async getExpedition(owner: PublicKey): Promise<state.ExpeditionAccount | null> {
    const expeditionPda = this.getExpeditionPda(owner);
    return state.fetchExpeditionAccount(this.connection, expeditionPda);
  }

  /** Fetch castle account */
  async getCastle(castleId: number): Promise<state.CastleAccount | null> {
    const castlePda = this.getCastlePda(castleId);
    return state.fetchCastleAccount(this.connection, castlePda);
  }

  // ==================== Batched Account Fetchers ====================
  // All batch methods use getMultipleAccountsInfo with 100-account chunking

  /**
   * Fetch multiple player accounts by owner wallets
   * @param owners - Array of wallet public keys
   * @returns Map of base58 PDA -> PlayerAccount (excludes null/uninitialized)
   */
  async getMultiplePlayers(owners: PublicKey[]): Promise<Map<string, state.PlayerAccount>> {
    return state.fetchMultiplePlayerAccounts(this.connection, owners);
  }

  /**
   * Fetch multiple player accounts preserving order
   * @param owners - Array of wallet public keys
   * @returns Array of PlayerAccount | null (same length as input)
   */
  async getMultiplePlayersOrdered(owners: PublicKey[]): Promise<(state.PlayerAccount | null)[]> {
    return state.fetchMultiplePlayerAccountsOrdered(this.connection, owners);
  }

  /**
   * Fetch multiple team accounts by team IDs
   * @param teamIds - Array of team IDs
   * @returns Map of base58 PDA -> TeamAccount
   */
  async getMultipleTeams(teamIds: number[]): Promise<Map<string, state.TeamAccount>> {
    return state.fetchMultipleTeamAccounts(this.connection, teamIds);
  }

  /**
   * Fetch multiple team accounts preserving order
   * @param teamIds - Array of team IDs
   * @returns Array of TeamAccount | null (same length as input)
   */
  async getMultipleTeamsOrdered(teamIds: number[]): Promise<(state.TeamAccount | null)[]> {
    return state.fetchMultipleTeamAccountsOrdered(this.connection, teamIds);
  }

  /**
   * Fetch multiple castle accounts by castle IDs
   * @param castleIds - Array of castle IDs
   * @returns Map of base58 PDA -> CastleAccount
   */
  async getMultipleCastles(castleIds: number[]): Promise<Map<string, state.CastleAccount>> {
    return state.fetchMultipleCastleAccounts(this.connection, castleIds);
  }

  /**
   * Fetch all castles (useful for leaderboards/overview)
   * @param startId - Starting castle ID (default 0)
   * @param endId - Ending castle ID (default 49 for all cities)
   * @returns Map of base58 PDA -> CastleAccount
   */
  async getAllCastles(startId: number = 0, endId: number = 49): Promise<Map<string, state.CastleAccount>> {
    return state.fetchAllCastles(this.connection, startId, endId);
  }

  /**
   * Fetch multiple expedition accounts by owner wallets
   * @param owners - Array of wallet public keys
   * @returns Map of base58 PDA -> ExpeditionAccount
   */
  async getMultipleExpeditions(owners: PublicKey[]): Promise<Map<string, state.ExpeditionAccount>> {
    return state.fetchMultipleExpeditionAccounts(this.connection, owners);
  }

  /**
   * Fetch multiple estate accounts by owner wallets
   * @param owners - Array of wallet public keys
   * @returns Map of base58 PDA -> EstateAccount
   */
  async getMultipleEstates(owners: PublicKey[]): Promise<Map<string, state.EstateAccount>> {
    return state.fetchMultipleEstateAccounts(this.connection, owners);
  }

  /**
   * Fetch multiple dungeon run accounts by owner wallets
   * @param owners - Array of wallet public keys
   * @returns Map of base58 PDA -> DungeonRunAccount
   */
  async getMultipleDungeonRuns(owners: PublicKey[]): Promise<Map<string, state.DungeonRunAccount>> {
    return state.fetchMultipleDungeonRunAccounts(this.connection, owners);
  }

  /**
   * Fetch multiple rally accounts by PDAs
   * @param rallyPdas - Array of rally PDAs
   * @returns Map of base58 PDA -> RallyAccount
   */
  async getMultipleRallies(rallyPdas: PublicKey[]): Promise<Map<string, state.RallyAccount>> {
    return state.fetchMultipleRallyAccounts(this.connection, rallyPdas);
  }

  /**
   * Generic batch fetch for any account type
   * @param pdas - Array of PDAs
   * @param deserialize - Deserializer function
   * @returns Map of base58 PDA -> deserialized account
   */
  async getMultipleByPda<T>(
    pdas: PublicKey[],
    deserialize: (data: Buffer) => T
  ): Promise<Map<string, T>> {
    return state.fetchMultipleByPda(this.connection, pdas, deserialize);
  }

  // ==================== Transaction Builders ====================

  /** Start an expedition */
  async startExpedition(params: {
    expeditionType: 'mining' | 'fishing';
    tier: number;
    operativeUnit1: BN;
    operativeUnit2: BN;
    operativeUnit3: BN;
    heroMint?: PublicKey;
  }): Promise<Transaction> {
    if (!this.wallet) throw new Error('Wallet required');

    const ix = instructions.expedition.createStartExpeditionInstruction({
      owner: this.wallet.publicKey,
      expeditionType: params.expeditionType === 'mining' ? 1 : 2,
      tier: params.tier,
      operativeUnit1: params.operativeUnit1,
      operativeUnit2: params.operativeUnit2,
      operativeUnit3: params.operativeUnit3,
      heroMint: params.heroMint,
    });

    return this.buildTransaction([ix]);
  }

  /** Claim expedition rewards */
  async claimExpedition(): Promise<Transaction> {
    if (!this.wallet) throw new Error('Wallet required');

    const ix = instructions.expedition.createClaimExpeditionInstruction({
      owner: this.wallet.publicKey,
    });

    return this.buildTransaction([ix]);
  }

  /** Attack a player */
  async attackPlayer(params: {
    targetPlayer: PublicKey;
    defensiveUnits: [BN, BN, BN];
  }): Promise<Transaction> {
    if (!this.wallet) throw new Error('Wallet required');

    const ix = instructions.combat.createAttackPlayerInstruction({
      attacker: this.wallet.publicKey,
      targetPlayer: params.targetPlayer,
      defensiveUnit1: params.defensiveUnits[0],
      defensiveUnit2: params.defensiveUnits[1],
      defensiveUnit3: params.defensiveUnits[2],
    });

    return this.buildTransaction([ix]);
  }

  // ==================== Transaction Utilities ====================

  /** Build transaction with compute budget */
  buildTransaction(instructions: TransactionInstruction[]): Transaction {
    const tx = new Transaction();

    // Add compute budget instructions
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: this.computeUnits,
      })
    );
    tx.add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: this.priorityFee,
      })
    );

    // Add program instructions
    for (const ix of instructions) {
      tx.add(ix);
    }

    return tx;
  }

  /** Send and confirm transaction */
  async sendTransaction(tx: Transaction): Promise<string> {
    if (!this.wallet) throw new Error('Wallet required');

    return sendAndConfirmTransaction(this.connection, tx, [this.wallet], {
      commitment: 'confirmed',
    });
  }

  // ==================== Transaction Parsing ====================

  /** Parse a transaction by signature */
  async parseTransaction(signature: string): Promise<ParsedTransaction | null> {
    return parseTransaction(this.connection, signature);
  }

  /** Subscribe to program transactions */
  subscribeToTransactions(callback: (tx: ParsedTransaction) => void): number {
    return this.connection.onLogs(
      pda.PROGRAM_ID,
      async (logs) => {
        const parsed = await this.parseTransaction(logs.signature);
        if (parsed) callback(parsed);
      },
      'confirmed'
    );
  }

  /** Unsubscribe from transactions */
  unsubscribe(subscriptionId: number): void {
    this.connection.removeOnLogsListener(subscriptionId);
  }
}
```

---

### 9. Usage Example

```typescript
import { Connection, Keypair, clusterApiUrl } from '@solana/web3.js';
import BN from 'bn.js';
import { NovusMundusClient } from 'novus-mundus-sdk';

async function main() {
  // Setup
  const connection = new Connection(clusterApiUrl('mainnet-beta'));
  const wallet = Keypair.generate(); // Or load from file

  const client = new NovusMundusClient({
    connection,
    wallet,
    computeUnits: 400_000,
    priorityFee: 10,
  });

  // Fetch player data
  const player = await client.getPlayer(wallet.publicKey);
  if (player) {
    console.log('Player level:', player.level);
    console.log('Cash:', player.cash.toString());
    console.log('Operatives:', {
      tier1: player.operativeUnit1.toString(),
      tier2: player.operativeUnit2.toString(),
      tier3: player.operativeUnit3.toString(),
    });
  }

  // Start a mining expedition
  const tx = await client.startExpedition({
    expeditionType: 'mining',
    tier: 2, // Deep mining
    operativeUnit1: new BN(100),
    operativeUnit2: new BN(50),
    operativeUnit3: new BN(10),
  });

  const signature = await client.sendTransaction(tx);
  console.log('Expedition started:', signature);

  // Parse the transaction to get events
  const parsed = await client.parseTransaction(signature);
  if (parsed) {
    console.log('Instructions:', parsed.instructions.map(i => i.name));
    console.log('Events:', parsed.events.map(e => e.name));
  }

  // Subscribe to all game transactions
  const subId = client.subscribeToTransactions((tx) => {
    console.log('New transaction:', tx.signature);
    for (const event of tx.events) {
      console.log('  Event:', event.name);
    }
  });

  // Cleanup
  // client.unsubscribe(subId);
}

main().catch(console.error);
```

---

### 10. Batched Fetching Example

```typescript
import { Connection, PublicKey } from '@solana/web3.js';
import { NovusMundusClient } from 'novus-mundus-sdk';

async function fetchLeaderboardData() {
  const connection = new Connection('https://api.mainnet-beta.solana.com');
  const client = new NovusMundusClient({ connection });

  // Example: Fetch 500 players in a single call (batched into 5 RPC requests)
  const wallets: PublicKey[] = [
    /* ... 500 wallet addresses ... */
  ];

  // Returns Map<string, PlayerAccount> - only non-null accounts
  const players = await client.getMultiplePlayers(wallets);
  console.log(`Found ${players.size} active players out of ${wallets.length}`);

  // Iterate over results
  for (const [pdaBase58, player] of players) {
    console.log(`${player.name}: Level ${player.level}, Cash: ${player.cash.toString()}`);
  }

  // Or preserve order (returns null for missing accounts)
  const playersOrdered = await client.getMultiplePlayersOrdered(wallets);
  playersOrdered.forEach((player, index) => {
    if (player) {
      console.log(`Wallet ${index}: Level ${player.level}`);
    } else {
      console.log(`Wallet ${index}: Not initialized`);
    }
  });

  // Fetch all 50 castles in one call
  const allCastles = await client.getAllCastles();
  console.log(`Found ${allCastles.size} active castles`);

  for (const [pdaBase58, castle] of allCastles) {
    if (castle.king.toBase58() !== PublicKey.default.toBase58()) {
      console.log(`Castle ${castle.castleId}: King = ${castle.king.toBase58()}`);
    } else {
      console.log(`Castle ${castle.castleId}: Vacant`);
    }
  }

  // Fetch team members' data efficiently
  const teamId = 42;
  const team = await client.getTeam(teamId);
  if (team) {
    // Get all team member accounts in parallel batches
    const memberWallets = team.memberSlots
      .filter((slot) => slot.isActive)
      .map((slot) => slot.wallet);

    const memberAccounts = await client.getMultiplePlayers(memberWallets);
    console.log(`Team ${teamId} has ${memberAccounts.size} active members`);

    // Calculate team stats
    let totalLevel = 0;
    let totalCash = 0n;
    for (const [_, member] of memberAccounts) {
      totalLevel += member.level;
      totalCash += BigInt(member.cash.toString());
    }
    console.log(`Average level: ${totalLevel / memberAccounts.size}`);
    console.log(`Total team cash: ${totalCash}`);
  }
}
```

---

## Estimated Output

| Category | Files | Lines (est.) |
|----------|-------|--------------|
| Core (pda, errors, constants, types) | 8 | ~3,000 |
| State accounts | 20 | ~3,500 |
| Instructions | 25 modules (~170 files) | ~8,500 |
| Events | 20 modules | ~2,500 |
| Parser | 4 | ~800 |
| External integrations | 6 | ~1,200 |
| Utils + Client | 5 | ~1,000 |
| **Total** | ~230+ files | ~20,500 lines |

---

## Source Reference

All implementations will be derived from:
- `programs/novus_mundus/src/processor/` - Instruction handlers
- `programs/novus_mundus/src/state/` - Account structures
- `programs/novus_mundus/src/events/` - Event definitions
- `programs/novus_mundus/src/constants.rs` - Game constants
- `programs/novus_mundus/src/error.rs` - Error definitions
- `programs/novus_mundus/src/lib.rs` - Instruction routing (discriminators)

**External SDK References:**
- `sdks/p-core/` - MPL Core types and instructions
- `sdks/p-pyth/` - Pyth oracle types
- `sdks/tld-house/` - TLD House instructions
- `sdks/alt-name-service/` - ANS types and state
- `programs/novus_mundus/src/helpers/name_service.rs` - Name service integration
- `programs/novus_mundus/src/helpers/token_ops.rs` - Oracle price calculations
