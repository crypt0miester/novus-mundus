# PDA Seeds Reference

> All Program Derived Address seed patterns used in Novus Mundus.

## Seed Pattern Overview

PDAs (Program Derived Addresses) are deterministically derived accounts that don't have private keys. They allow the program to "own" accounts and sign transactions.

```
PDA = find_program_address([seed1, seed2, ...], program_id)
```

[Source: constants.rs](../../../programs/novus_mundus/src/constants.rs)

---

## Core Account Seeds

### GameEngine

**Seeds:** `["game_engine"]`
**Uniqueness:** Singleton (one per program)

```javascript
const [gameEngine, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("game_engine")],
  programId
);
```

---

### PlayerAccount

**Seeds:** `["player", owner_pubkey]`
**Uniqueness:** One per wallet

```javascript
const [playerAccount, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("player"), ownerPubkey.toBuffer()],
  programId
);
```

---

### UserAccount

**Seeds:** `["user", owner_pubkey]`
**Uniqueness:** One per wallet

```javascript
const [userAccount, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("user"), ownerPubkey.toBuffer()],
  programId
);
```

---

### EstateAccount

**Seeds:** `["estate", player_pubkey]`
**Uniqueness:** One per player

```javascript
const [estateAccount, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("estate"), playerPubkey.toBuffer()],
  programId
);
```

---

### ResearchProgress

**Seeds:** `["research", player_pubkey]`
**Uniqueness:** One per player

```javascript
const [researchProgress, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("research"), playerPubkey.toBuffer()],
  programId
);
```

---

## Activity Account Seeds

### ExpeditionAccount

**Seeds:** `["expedition", owner_pubkey]`
**Uniqueness:** One active per player

```javascript
const [expeditionAccount, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("expedition"), ownerPubkey.toBuffer()],
  programId
);
```

---

### RallyAccount

**Seeds:** `["rally", leader_pubkey, target_city_bytes]`
**Uniqueness:** One per leader+target combination

```javascript
const targetCityBytes = Buffer.alloc(2);
targetCityBytes.writeUInt16LE(targetCityId, 0);

const [rallyAccount, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("rally"), leaderPubkey.toBuffer(), targetCityBytes],
  programId
);
```

---

### ReinforcementAccount

**Seeds:** `["reinforcement", sender_pubkey, receiver_pubkey]`
**Uniqueness:** One per sender+receiver pair

```javascript
const [reinforcementAccount, bump] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("reinforcement"),
    senderPubkey.toBuffer(),
    receiverPubkey.toBuffer()
  ],
  programId
);
```

---

## World Account Seeds

### CityAccount

**Seeds:** `["city", city_id_bytes]`
**Uniqueness:** One per city ID

```javascript
const cityIdBytes = Buffer.alloc(2);
cityIdBytes.writeUInt16LE(cityId, 0);

const [cityAccount, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("city"), cityIdBytes],
  programId
);
```

---

### LocationAccount

**Seeds:** `["location", city_id_bytes, lat_bytes, long_bytes]`
**Uniqueness:** One per grid cell

```javascript
const cityIdBytes = Buffer.alloc(2);
cityIdBytes.writeUInt16LE(cityId, 0);

const latBytes = Buffer.alloc(2);
latBytes.writeInt16LE(gridLat, 0);

const longBytes = Buffer.alloc(2);
longBytes.writeInt16LE(gridLong, 0);

const [locationAccount, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("location"), cityIdBytes, latBytes, longBytes],
  programId
);
```

---

### EncounterAccount

**Seeds:** `["encounter", location_pubkey]`
**Uniqueness:** One per location

```javascript
const [encounterAccount, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("encounter"), locationPubkey.toBuffer()],
  programId
);
```

---

### LootAccount

**Seeds:** `["loot", player_pubkey, source_pubkey]`
**Uniqueness:** One per player+source

```javascript
const [lootAccount, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("loot"), playerPubkey.toBuffer(), sourcePubkey.toBuffer()],
  programId
);
```

---

## Social Account Seeds

### TeamAccount

**Seeds:** `["team", leader_pubkey]`
**Uniqueness:** One per leader

```javascript
const [teamAccount, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("team"), leaderPubkey.toBuffer()],
  programId
);
```

---

### EventAccount

**Seeds:** `["event", event_id_bytes]`
**Uniqueness:** One per event ID

```javascript
const eventIdBytes = Buffer.alloc(4);
eventIdBytes.writeUInt32LE(eventId, 0);

const [eventAccount, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("event"), eventIdBytes],
  programId
);
```

---

### EventParticipation

**Seeds:** `["participation", event_pubkey, player_pubkey]`
**Uniqueness:** One per event+player

```javascript
const [participation, bump] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("participation"),
    eventPubkey.toBuffer(),
    playerPubkey.toBuffer()
  ],
  programId
);
```

---

## Shop Account Seeds

### ShopConfig

**Seeds:** `["shop_config"]`
**Uniqueness:** Singleton

```javascript
const [shopConfig, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("shop_config")],
  programId
);
```

---

### ShopItemAccount

**Seeds:** `["shop_item", item_id_bytes]`
**Uniqueness:** One per item ID

```javascript
const itemIdBytes = Buffer.alloc(2);
itemIdBytes.writeUInt16LE(itemId, 0);

const [shopItem, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("shop_item"), itemIdBytes],
  programId
);
```

---

### BundleAccount

**Seeds:** `["bundle", bundle_id_bytes]`
**Uniqueness:** One per bundle ID

```javascript
const bundleIdBytes = Buffer.alloc(2);
bundleIdBytes.writeUInt16LE(bundleId, 0);

const [bundleAccount, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("bundle"), bundleIdBytes],
  programId
);
```

---

### FlashSaleAccount

**Seeds:** `["flash_sale", sale_id_bytes]`
**Uniqueness:** One per sale ID

```javascript
const saleIdBytes = Buffer.alloc(4);
saleIdBytes.writeUInt32LE(saleId, 0);

const [flashSale, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("flash_sale"), saleIdBytes],
  programId
);
```

---

## Hero Account Seeds

### HeroCollection

**Seeds:** `["hero_collection"]`
**Uniqueness:** Singleton

```javascript
const [heroCollection, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("hero_collection")],
  programId
);
```

---

### HeroTemplate

**Seeds:** `["hero_template", template_id_bytes]`
**Uniqueness:** One per template ID

```javascript
const templateIdBytes = Buffer.alloc(2);
templateIdBytes.writeUInt16LE(templateId, 0);

const [heroTemplate, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("hero_template"), templateIdBytes],
  programId
);
```

---

## Research Account Seeds

### ResearchTemplate

**Seeds:** `["research_template", template_id_bytes]`
**Uniqueness:** One per template ID

```javascript
const templateIdBytes = Buffer.alloc(2);
templateIdBytes.writeUInt16LE(templateId, 0);

const [researchTemplate, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("research_template"), templateIdBytes],
  programId
);
```

---

## Seed Constants

| Seed String | Constant Name |
|-------------|---------------|
| `"game_engine"` | `GAME_ENGINE_SEED` |
| `"player"` | `PLAYER_SEED` |
| `"user"` | `USER_SEED` |
| `"estate"` | `ESTATE_SEED` |
| `"research"` | `RESEARCH_SEED` |
| `"expedition"` | `EXPEDITION_SEED` |
| `"rally"` | `RALLY_SEED` |
| `"reinforcement"` | `REINFORCEMENT_SEED` |
| `"city"` | `CITY_SEED` |
| `"location"` | `LOCATION_SEED` |
| `"encounter"` | `ENCOUNTER_SEED` |
| `"loot"` | `LOOT_SEED` |
| `"team"` | `TEAM_SEED` |
| `"event"` | `EVENT_SEED` |
| `"shop_config"` | `SHOP_CONFIG_SEED` |
| `"shop_item"` | `SHOP_ITEM_SEED` |
| `"hero_collection"` | `HERO_COLLECTION_SEED` |
| `"hero_template"` | `HERO_TEMPLATE_SEED` |

---

## Utility Functions

### JavaScript Helper

```javascript
import { PublicKey } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('YourProgramIdHere');

function derivePlayerAccount(owner) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("player"), owner.toBuffer()],
    PROGRAM_ID
  );
}

function deriveExpeditionAccount(owner) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("expedition"), owner.toBuffer()],
    PROGRAM_ID
  );
}

function deriveCityAccount(cityId) {
  const cityIdBytes = Buffer.alloc(2);
  cityIdBytes.writeUInt16LE(cityId, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("city"), cityIdBytes],
    PROGRAM_ID
  );
}

// Export all derivation functions
export const pdas = {
  derivePlayerAccount,
  deriveExpeditionAccount,
  deriveCityAccount,
  // ... etc
};
```

### Rust Helper (On-chain)

```rust
pub fn derive_player_pda(owner: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PLAYER_SEED, owner.as_ref()],
        program_id,
    )
}

pub fn derive_expedition_pda(owner: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[EXPEDITION_SEED, owner.as_ref()],
        program_id,
    )
}
```

---

## Validation Pattern

Always verify PDA derivation in processors:

```rust
// 1. Derive expected PDA
let (expected_pda, bump) = Pubkey::find_program_address(
    &[PLAYER_SEED, owner.key().as_ref()],
    program_id,
);

// 2. Compare with provided account
if account.key() != &expected_pda {
    return Err(GameError::InvalidPDA.into());
}

// 3. Store bump for future signing
player_data.bump = bump;
```

---

*PDAs are the address book of the program. Derive correctly, and you'll always find what you need.*

---

*Documentation complete. May your code be bug-free and your deploys successful.*
