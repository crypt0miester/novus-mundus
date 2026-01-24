# Hero System State Machine

## Overview

The Hero system manages MPL Core NFT heroes that provide passive buffs to players. Heroes can be equipped in active slots, assigned to defense, sent on meditation for temporary bonuses, or locked in dungeons/expeditions/garrisons.

---

## 1. Hero Ownership State

### States

| State | Description |
|-------|-------------|
| `Unowned` | Hero not minted or owned by another |
| `InWallet` | Hero in player's wallet, not equipped |
| `Active` | Equipped in one of 3 active slots |
| `Defensive` | Assigned as defensive hero |
| `Meditating` | In sanctuary meditation |
| `Locked` | Locked in dungeon/expedition/garrison |

### State Diagram

```
┌────────────────┐  mint_hero     ┌────────────────┐
│                │ ─────────────> │                │
│    Unowned     │                │    InWallet    │◄──────────────────┐
│                │                │                │                    │
└────────────────┘                └───────┬────────┘                    │
                                          │                             │
                     ┌────────────────────┼────────────────────┐       │
                     │                    │                    │       │
                     ▼                    ▼                    ▼       │
             ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
             │              │    │              │    │              │  │
             │    Active    │    │  Defensive   │    │  Meditating  │──┤
             │  (slot 0-2)  │    │              │    │              │  │
             └──────────────┘    └──────────────┘    └──────────────┘  │
                     │                    │                             │
                     │                    │ unassign                    │
                     │                    └─────────────────────────────┤
                     │                                                  │
                     │ lock_in_dungeon/expedition/garrison             │
                     ▼                                                  │
             ┌──────────────┐                                          │
             │              │                                          │
             │    Locked    │──────────────────────────────────────────┘
             │              │  unlock (claim/abort/return)
             └──────────────┘
```

---

## 2. Active Slot Management

### States

| Slot | Value | Description |
|------|-------|-------------|
| Empty | NULL_PUBKEY | No hero in slot |
| Occupied | Hero Pubkey | Hero equipped |

### Transitions

#### `InWallet` → `Active`
```
Trigger: equip_hero (implicit in level_up, lock)
Guards:
  - Hero in player's wallet
  - Slot < 3
  - Slot is empty
  - Player has HEROES extension
Actions:
  - Set player.active_heroes[slot] = hero_mint
  - Aggregate hero buffs to player.*_bps fields
  - Hero stays in wallet (not transferred)
  - Emit HeroEquipped
```

#### `Active` → `InWallet`
```
Trigger: unequip_hero
Guards:
  - Hero in active_heroes[slot]
  - Hero not locked
Actions:
  - Set player.active_heroes[slot] = NULL_PUBKEY
  - Recalculate player buff aggregates
  - Emit HeroUnequipped
```

---

## 3. Defensive Assignment

### Transition

#### `InWallet/Active` → `Defensive`
```
Trigger: assign_defensive_hero
Guards:
  - Hero in player's wallet
  - No current defensive hero assigned
  - Hero not locked elsewhere
Actions:
  - Set player.defensive_hero_slot = slot
  - Apply hero's defensive buffs
  - Emit DefensiveHeroAssigned
```

#### `Defensive` → `InWallet`
```
Trigger: unassign_defensive_hero
Guards:
  - player.defensive_hero_slot != 255
Actions:
  - Set player.defensive_hero_slot = 255
  - Remove defensive buffs
  - Emit DefensiveHeroUnassigned
```

---

## 4. Meditation System

### States

| State | Description |
|-------|-------------|
| `NotMeditating` | No hero meditating |
| `Meditating` | Hero in meditation |

### State Diagram

```
┌────────────────┐  start_meditation  ┌────────────────┐
│                │ ─────────────────> │                │
│ NotMeditating  │                    │   Meditating   │
│  (slot = 255)  │ <───────────────── │  (slot = 0-2)  │
└────────────────┘  claim_meditation  └────────────────┘
```

### Transitions

#### `NotMeditating` → `Meditating`
```
Trigger: start_meditation
Guards:
  - player.meditating_hero_slot == 255
  - hero_slot < 3
  - active_heroes[slot] != NULL_PUBKEY
  - Player in correct city (hero's meditation_city_id)
  - Sanctuary building active in estate
Actions:
  - Set player.meditating_hero_slot = slot
  - Set player.meditation_started_at = now
  - Emit MeditationStarted
```

#### `Meditating` → `NotMeditating`
```
Trigger: claim_meditation
Guards:
  - player.meditating_hero_slot != 255
  - player.meditation_started_at > 0
Actions:
  - elapsed = min(now - meditation_started_at, max_duration)
  - Calculate blessed_hero_bonus from HeroTemplate
  - Apply temporary buffs
  - Set estate.blessed_hero = hero_mint
  - Set player.meditating_hero_slot = 255
  - Set player.meditation_started_at = 0
  - Emit MeditationCompleted
```

---

## 5. Hero Locking (Escrow)

### Lock Targets

| Target | PDA | Returns On |
|--------|-----|------------|
| Dungeon | DungeonRun | claim/abandon |
| Expedition | ExpeditionAccount | claim/abort |
| Garrison | ReinforcementAccount | process_return |

### Lock Transition
```
Trigger: start_dungeon / start_expedition / send_reinforcement (with hero)
Guards:
  - Hero in player's wallet (or active slot)
  - Hero not already locked
Actions:
  - Transfer hero NFT to target PDA (TransferV1)
  - Clear from active_heroes if applicable
  - Record hero_mint in target account
  - Snapshot hero buffs
  - Emit HeroLocked
```

### Unlock Transition
```
Trigger: claim_dungeon / claim_expedition / process_return
Guards:
  - Target account has hero_mint set
  - Target account ready for completion
Actions:
  - Transfer hero NFT back to player (PDA signs TransferV1)
  - Emit HeroUnlocked
```

---

## 6. Hero Level Up

### States

| Level | Description |
|-------|-------------|
| 1-100 | Hero level (increases stats) |

### Transition

#### Level Up
```
Trigger: hero_level_up
Guards:
  - Hero in player's wallet or active slot
  - Hero level < 100
  - Sufficient experience/materials
Actions:
  - Increment hero level on-chain metadata
  - Increase base stats
  - If in active slot: recalculate player buffs
  - Emit HeroLeveledUp
```

---

## 7. Hero Stats & Buffs

### Stat Categories (from HeroTemplate)

| Stat ID | Name | Effect |
|---------|------|--------|
| 0 | Attack | +attack_bps |
| 1 | Defense | +defense_bps |
| 2 | WeaponEfficiency | +weapon_efficiency_bps |
| 3 | ArmorEfficiency | +armor_efficiency_bps |
| 4 | CritChance | +crit_chance_bps |
| 5 | CritDamage | +crit_damage_bps |
| 6 | CashGeneration | +cash_generation_bps |
| 7 | ProduceGeneration | +produce_generation_bps |
| 8 | CollectionRate | +collection_rate_bps |
| 9 | XPGain | +xp_gain_bps |
| 10 | ResearchSpeed | +research_speed_bps |
| 11 | CraftSuccess | +craft_success_bps |
| 12 | RallyCapacity | +rally_capacity_bps |
| 13 | TravelSpeed | +travel_speed_bps |
| 14 | LootBonus | +loot_bonus_bps |
| 15 | EncounterDamage | +encounter_damage_bps |
| 16 | DungeonPower | +dungeon_power_bps |
| 17 | MiningAffinity | +mining affinity bonus |
| 18 | FishingAffinity | +fishing affinity bonus |

### Buff Aggregation
```
For each stat category:
  player.hero_{stat}_bps = sum(active_hero.{stat}_bps for hero in active_heroes)
```

---

## 8. Hero Minting

### Transition

#### `Unowned` → `InWallet`
```
Trigger: mint_hero
Guards:
  - Player has HEROES extension
  - Sanctuary building active
  - Sufficient NOVI/materials
  - Valid HeroTemplate
Actions:
  - Create MPL Core Asset
  - Set hero attributes from template
  - Transfer to player wallet
  - Emit HeroMinted
```

---

## 9. Account Integration

### PlayerAccount Hero Fields
```rust
// Active hero slots
pub active_heroes: [Pubkey; 3],      // MAX_ACTIVE_HEROES

// Defensive hero
pub defensive_hero_slot: u8,         // 255 = none

// Meditation state
pub meditating_hero_slot: u8,        // 255 = none
pub meditation_started_at: i64,

// Aggregated hero buffs (from active heroes)
pub hero_attack_bps: u16,
pub hero_defense_bps: u16,
pub hero_weapon_efficiency_bps: u16,
pub hero_armor_efficiency_bps: u16,
pub hero_crit_chance_bps: u16,
pub hero_crit_damage_bps: u16,
pub hero_cash_generation_bps: u16,
pub hero_produce_generation_bps: u16,
pub hero_collection_rate_bps: u16,
pub hero_xp_gain_bps: u16,
pub hero_research_speed_bps: u16,
pub hero_craft_success_bps: u16,
pub hero_rally_capacity_bps: u16,
pub hero_travel_speed_bps: u16,
pub hero_loot_bonus_bps: u16,
pub hero_encounter_damage_bps: u16,
pub hero_dungeon_power_bps: u16,
```

---

## 10. Invariants

```
1. active_heroes[i] == NULL_PUBKEY OR valid hero owned by player
2. defensive_hero_slot == 255 OR < 3
3. meditating_hero_slot == 255 OR < 3
4. Hero cannot be in multiple states simultaneously
5. Locked hero must be unlocked before other operations
6. Hero buffs are sum of all active heroes (not max)
7. Hero level ∈ [1, 100]
8. Hero NFT ownership verified via MPL Core
```
