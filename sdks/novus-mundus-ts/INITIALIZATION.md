# Novus Mundus Initialization Plan

## Overview

This document outlines the initialization sequence required to set up a fully functional Novus Mundus game instance for local testing.

## Initialization Phases

### Phase 0: Prerequisites
- Deploy program to localnet/devnet
- Create treasury wallet (receives SOL payments)
- Prepare test wallets (DAO authority, players)

---

## Phase 1: Core Infrastructure (DAO Authority Only)

### 1.1 Game Engine (MUST BE FIRST)
**Instruction:** `createInitGameEngineInstruction`
**Accounts Created:**
- GameEngine PDA (global config)
- NOVI token mint PDA

```typescript
const ix = createInitGameEngineInstruction({
  authority: daoAuthority.publicKey,
  treasuryWallet: treasuryWallet.publicKey,
});
```

### 1.2 Shop Config
**Instruction:** `createInitializeConfigInstruction`
**Purpose:** Configure shop settings, oracle feeds, fees

```typescript
const ix = createInitializeConfigInstruction({
  authority: daoAuthority.publicKey,
  solPythFeed: SOL_PYTH_FEED, // or null for localnet
  solSwitchboardFeed: null,
  // ... config params
});
```

### 1.3 Hero Collection (MPL Core)
**Instruction:** `createCreateCollectionInstruction`
**Purpose:** Create the MPL Core collection for hero NFTs

```typescript
const ix = createCreateCollectionInstruction({
  authority: daoAuthority.publicKey,
  collection: heroCollectionKeypair.publicKey, // new Keypair
  name: "Novus Mundus Heroes",
  uri: "https://example.com/collection.json",
});
```

---

## Phase 2: Game Content (DAO Authority)

### 2.1 Hero Templates
**Instruction:** `createCreateTemplateInstruction`
**Count:** Create templates for each hero class

| Template ID | Name | Class | Rarity |
|-------------|------|-------|--------|
| 1 | Warrior | Melee | Common |
| 2 | Archer | Ranged | Common |
| 3 | Mage | Magic | Common |
| 4 | Paladin | Melee | Rare |
| 5 | Assassin | Ranged | Rare |
| ... | ... | ... | ... |

```typescript
for (const template of heroTemplates) {
  const ix = createCreateTemplateInstruction({
    authority: daoAuthority.publicKey,
    templateId: template.id,
    name: template.name,
    class: template.class,
    rarity: template.rarity,
    baseStats: template.stats,
    // ... more config
  });
}
```

### 2.2 Cities
**Instruction:** `createInitCityInstruction`
**Count:** At least 1 city required for player spawn

| City ID | Name | Latitude | Longitude |
|---------|------|----------|-----------|
| 1 | Novus Prime | 40.7128 | -74.0060 |
| 2 | Solana City | 37.7749 | -122.4194 |
| 3 | Epoch Harbor | 51.5074 | -0.1278 |

```typescript
const ix = createInitCityInstruction({
  authority: daoAuthority.publicKey,
  cityId: 1,
  latitude: 40.7128,
  longitude: -74.0060,
  name: "Novus Prime",
});
```

### 2.3 Research Templates
**Instruction:** `createInitializeTemplateInstruction`
**Count:** One per research node in the tech tree

| Research ID | Name | Category | Tier | Prerequisites |
|-------------|------|----------|------|---------------|
| 1 | Basic Combat | Combat | 1 | None |
| 2 | Advanced Combat | Combat | 2 | [1] |
| 3 | Resource Efficiency | Economy | 1 | None |
| ... | ... | ... | ... | ... |

```typescript
const ix = createInitializeTemplateInstruction({
  authority: daoAuthority.publicKey,
  researchId: template.id,
  name: template.name,
  category: template.category,
  tier: template.tier,
  prerequisites: template.prerequisites,
  baseCost: template.cost,
  baseDuration: template.duration,
  // ... effects
});
```

### 2.4 Shop Items (Optional)
**Instruction:** `createCreateItemInstruction`
**Purpose:** Create purchasable items

```typescript
const ix = createCreateItemInstruction({
  authority: daoAuthority.publicKey,
  itemId: 1,
  itemType: ShopItemType.Resource,
  price: new BN(1_000_000_000), // 1 SOL
  maxPurchases: 0, // unlimited
  // ... item details
});
```

---

## Phase 3: Feature-Specific Setup (DAO Authority)

### 3.1 Arena Season (if testing arena)
**Instruction:** `createCreateSeasonInstruction`

```typescript
const ix = createCreateSeasonInstruction({
  authority: daoAuthority.publicKey,
  seasonId: 1,
  startTime: Math.floor(Date.now() / 1000),
  duration: 30 * 24 * 60 * 60, // 30 days
  entryFee: new BN(100_000_000), // 0.1 SOL
  prizePool: new BN(10_000_000_000), // 10 SOL
});
```

### 3.2 Dungeon Templates (if testing dungeons)
**Instruction:** `createCreateDungeonTemplateInstruction`

```typescript
const ix = createCreateDungeonTemplateInstruction({
  authority: daoAuthority.publicKey,
  templateId: 1,
  name: "Goblin Caves",
  difficulty: DungeonDifficulty.Normal,
  floors: 5,
  // ... encounter config
});
```

### 3.3 Dungeon Leaderboard
**Instruction:** `createCreateLeaderboardInstruction`

```typescript
const ix = createCreateLeaderboardInstruction({
  authority: daoAuthority.publicKey,
  templateId: 1, // matches dungeon template
  season: 1,
  prizePool: new BN(5_000_000_000), // 5 SOL
});
```

### 3.4 Castles (if testing castle system)
**Instruction:** `createCreateCastleInstruction`

```typescript
const ix = createCreateCastleInstruction({
  authority: daoAuthority.publicKey,
  castleId: 1,
  cityId: 1,
  gridX: 100,
  gridY: 100,
  tier: CastleTier.Common,
  // ... castle config
});
```

---

## Phase 4: Player Initialization (Per Player)

### 4.1 Initialize Player
**Instruction:** `createInitPlayerInstruction`
**Note:** This creates the player account in a specific city

```typescript
const ix = createInitPlayerInstruction({
  owner: playerWallet.publicKey,
  startingCityId: 1, // Novus Prime
});
```

**Starter Resources (Rookie Tier):**
- 100 Locked NOVI
- 10 Defensive Unit 1, 10 Operative Unit 1
- 3 Melee, 2 Ranged, 2 Armor equipment
- 20 Produce, 1000 Cash
- 24-hour New Player Protection

### 4.2 Create Estate (Optional)
**Instruction:** `createCreateEstateInstruction`

```typescript
const ix = createCreateEstateInstruction({
  owner: playerWallet.publicKey,
});
```

### 4.3 Mint Starting Heroes (Optional)
**Instruction:** `createMintHeroInstruction`

```typescript
const heroKeypair = Keypair.generate();
const ix = createMintHeroInstruction({
  owner: playerWallet.publicKey,
  templateId: 1, // Warrior
  heroMint: heroKeypair.publicKey,
});
```

---

## Initialization Order Summary

```
1. Game Engine        [DAO] - Global config, NOVI mint
2. Shop Config        [DAO] - Oracle settings, fees
3. Hero Collection    [DAO] - MPL Core collection
4. Hero Templates     [DAO] - Define hero classes (5-20 templates)
5. Cities             [DAO] - Player spawn locations (3+ cities)
6. Research Templates [DAO] - Tech tree nodes (50-100 templates)
7. Shop Items         [DAO] - Optional purchasables
8. Arena Season       [DAO] - If testing arena
9. Dungeon Templates  [DAO] - If testing dungeons
10. Dungeon Boards    [DAO] - Leaderboards for dungeons
11. Castles           [DAO] - If testing castle system
---
12. Player Init       [PLAYER] - Per-player account creation
13. Estate Init       [PLAYER] - Per-player estate
14. Mint Heroes       [PLAYER] - Starting heroes
```

---

## SDK Coverage Analysis

### Core Initialization - ✅ Complete
| Instruction | SDK File | Status |
|-------------|----------|--------|
| InitGameEngine | initialization.ts | ✅ |
| InitPlayer | initialization.ts | ✅ |
| InitUser | initialization.ts | ✅ |
| InitCity | initialization.ts | ✅ |

### Content Setup - ✅ Complete
| Instruction | SDK File | Status |
|-------------|----------|--------|
| CreateHeroTemplate | hero.ts | ✅ |
| CreateHeroCollection | hero.ts | ✅ |
| InitializeResearchTemplate | research.ts | ✅ |
| InitializeShopConfig | shop.ts | ✅ |
| CreateShopItem | shop.ts | ✅ |

### Feature Setup - ✅ Complete
| Instruction | SDK File | Status |
|-------------|----------|--------|
| CreateArenaSeason | arena.ts | ✅ |
| CreateDungeonTemplate | dungeon.ts | ✅ |
| CreateDungeonLeaderboard | dungeon.ts | ✅ |
| CreateCastle | castle.ts | ✅ |
| InitializeForge | forge.ts | ✅ |

### Player Setup - ✅ Complete
| Instruction | SDK File | Status |
|-------------|----------|--------|
| CreateEstate | estate.ts | ✅ |
| MintHero | hero.ts | ✅ |

---

## Test Script Structure

```typescript
// tests/initialization.test.ts
import { describe, it, before } from 'bun:test';
import { Connection, Keypair, Transaction } from '@solana/web3.js';
import * as sdk from '../src';

describe('Game Initialization', () => {
  const connection = new Connection('http://localhost:8899', 'confirmed');
  const daoAuthority = Keypair.generate();
  const treasury = Keypair.generate();
  const player1 = Keypair.generate();

  before(async () => {
    // Airdrop SOL to test wallets
    await connection.requestAirdrop(daoAuthority.publicKey, 100_000_000_000);
    await connection.requestAirdrop(player1.publicKey, 10_000_000_000);
  });

  describe('Phase 1: Core Infrastructure', () => {
    it('should initialize game engine', async () => {
      const ix = sdk.createInitGameEngineInstruction({
        authority: daoAuthority.publicKey,
        treasuryWallet: treasury.publicKey,
      });
      // ... sign and send
    });

    it('should initialize shop config', async () => {
      // ...
    });

    it('should create hero collection', async () => {
      // ...
    });
  });

  describe('Phase 2: Game Content', () => {
    it('should create hero templates', async () => {
      // ...
    });

    it('should create cities', async () => {
      // ...
    });

    it('should create research templates', async () => {
      // ...
    });
  });

  describe('Phase 4: Player Setup', () => {
    it('should initialize player', async () => {
      const ix = sdk.createInitPlayerInstruction({
        owner: player1.publicKey,
        startingCityId: 1,
      });
      // ...
    });
  });
});
```

---

## Local Test Seed Data

### Minimal Setup (Quick Testing)
- 1 Game Engine
- 1 City
- 3 Hero Templates (Warrior, Archer, Mage)
- 5 Research Templates
- 1 Player

### Full Setup (Comprehensive Testing)
- 1 Game Engine
- Shop Config with mock oracle
- Hero Collection
- 10+ Hero Templates
- 5+ Cities
- 50+ Research Templates
- Shop items
- Arena season
- 3+ Dungeon templates
- 10+ Castles
- Multiple test players

---

## Environment Variables

```env
# .env.local for testing
RPC_URL=http://localhost:8899
DAO_AUTHORITY_KEYPAIR=./keys/dao-authority.json
TREASURY_WALLET=./keys/treasury.json

# Pyth feeds (mainnet - for reference)
SOL_PYTH_FEED=H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG
USDC_PYTH_FEED=Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD
```

---

## Common Issues & Solutions

### Issue: "AccountNotInitialized"
**Cause:** Trying to use an account before its initialization instruction was processed.
**Solution:** Ensure proper initialization order. Game Engine must be first.

### Issue: "InvalidAuthority"
**Cause:** Non-DAO wallet trying to create game content.
**Solution:** Use the same authority that initialized the Game Engine.

### Issue: "CityNotFound"
**Cause:** Trying to initialize player in a non-existent city.
**Solution:** Create the city first with `createInitCityInstruction`.

### Issue: "HeroCollectionNotFound"
**Cause:** Trying to mint hero before collection exists.
**Solution:** Create hero collection before minting heroes.

### Issue: Oracle Errors on Localnet
**Cause:** No real oracle feeds on localnet.
**Solution:** Use `null` for oracle feeds or set up mock Pyth accounts.
