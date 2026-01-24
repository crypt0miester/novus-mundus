# Player System State Machine

## Overview

The Player system manages core player state, progression, and optional extension sections that unlock as players advance.

---

## 1. Account Lifecycle

### States

| State | Description |
|-------|-------------|
| `NonExistent` | No PlayerAccount for this wallet |
| `Active` | PlayerAccount exists and is operational |
| `Flagged` | Account flagged by governance (restricted) |

### State Diagram

```
┌────────────────┐  create_player   ┌────────────────┐
│                │ ───────────────> │                │
│  NonExistent   │                  │     Active     │
│                │                  │                │
└────────────────┘                  └───────┬────────┘
                                            │
                                            │ flag_by_governance
                                            ▼
                                    ┌────────────────┐
                                    │                │
                                    │    Flagged     │
                                    │                │
                                    └───────┬────────┘
                                            │
                                            │ unflag_by_governance
                                            ▼
                                    ┌────────────────┐
                                    │     Active     │
                                    └────────────────┘
```

### Transitions

#### `NonExistent` → `Active`
```
Trigger: create_player (via game_engine initialization)
Guards:
  - PlayerAccount PDA does not exist
  - Sufficient lamports for rent
Actions:
  - Create PlayerAccount PDA: [PLAYER_SEED, owner_pubkey]
  - Initialize core fields with defaults
  - Set starting city, coordinates
  - Grant starter resources:
    - 10 defensive_unit_1, 10 operative_unit_1
    - 3 melee, 2 ranged, 2 armor
    - 1000 cash, 100 locked_novi
  - Set new_player_protection_until = now + protection_duration
  - Increment game_engine.total_players
  - Emit PlayerCreated
```

---

## 2. Extension System

### States (Per Extension)

| State | Description |
|-------|-------------|
| `Locked` | Extension not unlocked |
| `Unlocked` | Extension section available |

### Extension Flags

```rust
pub const EXT_RESEARCH: u32   = 1 << 0;  // 0x0001
pub const EXT_HEROES: u32     = 1 << 1;  // 0x0002
pub const EXT_INVENTORY: u32  = 1 << 2;  // 0x0004
pub const EXT_RALLY: u32      = 1 << 3;  // 0x0008
pub const EXT_TEAM: u32       = 1 << 4;  // 0x0010
pub const EXT_COSMETICS: u32  = 1 << 5;  // 0x0020
pub const EXT_COURT: u32      = 1 << 6;  // 0x0040 (Kings Castle)
```

### Unlock Chain (Sequential)

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│          │    │          │    │          │    │          │    │          │    │          │
│   CORE   │───>│ RESEARCH │───>│  HEROES  │───>│INVENTORY │───>│  RALLY   │───>│   TEAM   │───>COSMETICS
│  1016B   │    │   +96B   │    │  +130B   │    │  +424B   │    │   +80B   │    │   +40B   │    +80B
│          │    │          │    │          │    │          │    │          │    │          │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
                     │               │               │               │               │
                     ▼               ▼               ▼               ▼               ▼
               Research tree   Hero slots    Shop/inventory   Rally caps     Team membership
               Daily rewards   Meditation    Materials        Stats          Cosmetics
```

### Transitions

#### `Locked` → `Unlocked`
```
Trigger: unlock_extension (implicit in various instructions)
Guards:
  - Prerequisite extension already unlocked:
    - RESEARCH: None (first unlock)
    - HEROES: RESEARCH
    - INVENTORY: HEROES
    - RALLY: INVENTORY
    - TEAM: RALLY
    - COSMETICS: TEAM
Actions:
  - Calculate new account size
  - Transfer additional lamports from payer for rent
  - Resize account via account.resize(new_size)
  - Set extension bit: player.extensions |= extension_flag
  - Initialize section with defaults
```

---

## 3. Subscription System

### States

| State | Description |
|-------|-------------|
| `Free` | No active subscription (tier 0) |
| `Active` | Paid subscription active |
| `Expired` | Subscription end time passed |

### Tiers

| Tier | Name | Benefits |
|------|------|----------|
| 0 | Rookie | Base rates |
| 1 | Expert | +25% rewards |
| 2 | Epic | +50% rewards |
| 3 | Legendary | +100% rewards |

### State Diagram

```
┌────────────────┐  purchase    ┌────────────────┐
│                │ ───────────> │                │
│      Free      │              │     Active     │
│   (tier = 0)   │              │  (tier = 1-3)  │
└────────────────┘              └───────┬────────┘
       ▲                                │
       │                                │ subscription_end <= now
       │                                ▼
       │                        ┌────────────────┐
       │                        │                │
       │ downgrade_expired      │    Expired     │
       └────────────────────────│                │
                                └────────────────┘
                                        │
                                        │ purchase (renew)
                                        ▼
                                ┌────────────────┐
                                │     Active     │
                                └────────────────┘
```

### Transitions

#### `Free` → `Active`
```
Trigger: purchase_subscription
Guards:
  - Payment provided (SOL/USDC)
  - Valid tier (1-3)
Actions:
  - player.subscription_tier = tier
  - player.subscription_end = now + duration_days * SECONDS_PER_DAY
  - Transfer payment to treasury
  - Emit SubscriptionPurchased
```

#### `Active` → `Expired`
```
Trigger: Time passage (checked on any interaction)
Guards:
  - now >= player.subscription_end
Actions:
  - get_effective_tier() returns 0
  - Benefits revoked until renewal
```

#### `Expired` → `Free`
```
Trigger: downgrade_expired instruction
Guards:
  - now >= player.subscription_end
Actions:
  - player.subscription_tier = 0
  - Emit SubscriptionExpired
```

---

## 4. Protection System

### States

| State | Description |
|-------|-------------|
| `Protected` | New player protection active |
| `Vulnerable` | Protection expired |

### State Diagram

```
┌────────────────┐  time elapsed   ┌────────────────┐
│                │ ══════════════> │                │
│   Protected    │                 │   Vulnerable   │
│                │                 │                │
└────────────────┘                 └────────────────┘
```

### Transitions

#### `Protected` → `Vulnerable`
```
Trigger: Time passage (automatic)
Guards:
  - now >= player.new_player_protection_until
Actions:
  - Player can now be attacked
  - No explicit state change (computed from timestamp)
```

---

## 5. Travel State

### States

| State | Value | Description |
|-------|-------|-------------|
| `Stationary` | 0 | Not traveling |
| `Intracity` | 1 | Moving within city |
| `Intercity` | 2 | Moving between cities |

### State Diagram

```
                    ┌─────────────────────────────────────────┐
                    │                                         │
                    ▼                                         │
┌────────────────┐  intracity_start   ┌────────────────┐     │
│                │ ─────────────────> │                │     │
│   Stationary   │                    │   Intracity    │     │
│  (travel_type  │ <───────────────── │  (travel_type  │     │
│     = 0)       │  intracity_complete│     = 1)       │     │
└───────┬────────┘  or cancel         └────────────────┘     │
        │                                                     │
        │ intercity_start                                     │
        ▼                                                     │
┌────────────────┐                                           │
│                │                                           │
│   Intercity    │ ───────────────────────────────────────────┘
│  (travel_type  │  intercity_complete or cancel
│     = 2)       │
└────────────────┘
```

### Transitions

See [travel.md](./travel.md) for detailed travel state machine.

---

## 6. Meditation State

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
│ (slot = 255)   │ <───────────────── │ (slot = 0-2)   │
└────────────────┘  claim_meditation  └────────────────┘
```

### Transitions

#### `NotMeditating` → `Meditating`
```
Trigger: start_meditation
Guards:
  - hero_slot < 3
  - active_heroes[slot] != NULL_PUBKEY
  - Player in correct city (meditation_city_id from HeroTemplate)
  - Sanctuary building active in estate
Actions:
  - player.meditating_hero_slot = slot
  - player.meditation_started_at = now
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
  - Calculate blessed_hero_bonus
  - player.meditating_hero_slot = 255
  - player.meditation_started_at = 0
  - Apply bonus buffs
  - Emit MeditationCompleted
```

---

## 7. Reinforcement Aggregates

### State (Computed from Active Reinforcements)

| Field | Description |
|-------|-------------|
| `reinforcement_def_1/2/3` | Aggregated units from teammates |
| `reinforcement_melee/ranged/siege` | Aggregated weapons |
| `reinforcement_source_count` | Number of active reinforcement sources |
| `reinforcement_original_units/weapons` | For survival ratio calculation |
| `reinforcement_hero_*_bps` | Best hero buff (max, not sum) |

### Update Flow

```
┌──────────────────┐
│ ReinforcementAcct│
│    Arrives       │
└────────┬─────────┘
         │ process_arrival
         ▼
┌──────────────────┐
│  PlayerAccount   │
│  Aggregates      │
│  Updated         │
└──────────────────┘
         │
         │ (combat occurs, units lost)
         ▼
┌──────────────────┐
│ Survival Ratio   │
│   Calculated     │
└────────┬─────────┘
         │ process_return
         ▼
┌──────────────────┐
│  Aggregates      │
│  Decremented     │
└──────────────────┘
```

---

## 8. Level Progression

### States

| State | Description |
|-------|-------------|
| `Level N` | Player at level N (1-100) |

### Transition

```
┌────────────────┐  gain_xp    ┌────────────────┐
│                │ ──────────> │                │
│    Level N     │             │   Level N+1    │
│  xp < required │             │   xp reset     │
└────────────────┘             └────────────────┘
```

#### Level Up
```
Trigger: Any XP-granting action
Guards:
  - player.current_xp >= xp_required_for_level(player.level)
  - player.level < MAX_LEVEL (100)
Actions:
  - player.level += 1
  - player.current_xp -= xp_required_for_level(old_level)
  - Unlock new features (if any)
  - Emit LevelUp
```

### XP Formula
```
xp_required(level) = BASE_XP_PER_LEVEL * level^XP_EXPONENT
                   = 1000 * level^2
```

---

## Appendix: Field Reference

### PlayerCore Fields (1016 bytes)

| Section | Fields | Size |
|---------|--------|------|
| Identity | owner, created_at, bump, version | 48B |
| Name | name[48], name_len | 56B |
| Extensions | extensions (u32 bitfield) | 4B |
| Locked NOVI | locked_novi, last_updated_tokens_at | 16B |
| Units | defensive_1/2/3, operative_1/2/3 | 48B |
| Equipment | melee, ranged, siege, armor, produce, vehicles | 48B |
| Cash | cash_on_hand, cash_in_vault | 16B |
| Happiness | happiness_defensive, happiness_operative | 8B |
| Location | current_lat/long, traveling_to_lat/long, arrival_time, etc. | 56B |
| Subscription | subscription_tier, subscription_end | 16B |
| Progression | level, current_xp, reputation, networth | 32B |
| Stamina | encounter_stamina, max_encounter_stamina, last_stamina_update | 24B |
| Resources | gems, fragments | 16B |
| Stats | total_attacks, total_defenses, etc. | 56B |
| Protection | new_player_protection_until, flagged_by_governance | 16B |
| Research Buffs | research_*_bps (12 fields) | 24B |
| Research Flags | has_daily_rewards, has_mining, etc. | 8B |
| Hero System | active_heroes[3], defensive_hero_slot, meditating_hero_slot, hero_*_bps | 140B |
| Team | team, team_slot_index | 40B |
| Transfer Tracking | daily_transfer_count, daily_transferred, last_transfer_reset | 24B |
| Rally | rally_caps, rally_stats | 80B |
| Consumables | stamina_potions, xp_boosters, etc. (11 types) | 22B |
| Materials | common, uncommon, rare, epic, legendary | 40B |
| Equipped | equipped_weapon_bonus_bps, equipped_armor_bonus_bps | 8B |
| Shop State | total_shop_spent, milestone_tier, etc. | 32B |
| Meditation | meditation_started_at | 8B |
| Reinforcements | reinforcement_def_1/2/3, melee/ranged/siege, hero buffs | 72B |

### Extension Section Sizes

| Extension | Size | Cumulative |
|-----------|------|------------|
| CORE | 1016B | 1016B |
| RESEARCH | 96B | 1112B |
| HEROES | 130B | 1242B |
| INVENTORY | 424B | 1666B |
| RALLY | 80B | 1746B |
| TEAM | 40B | 1786B |
| COSMETICS | 80B | 1866B |

---

## Invariants

```
1. player.owner == PDA derivation key
2. player.bump matches derived bump
3. extensions unlock sequentially (cannot skip)
4. subscription_tier in [0, 3]
5. level in [1, 100]
6. travel_type in [0, 2]
7. meditating_hero_slot == 255 OR < 3
8. reinforcement_source_count == count of active ReinforcementAccounts
```
