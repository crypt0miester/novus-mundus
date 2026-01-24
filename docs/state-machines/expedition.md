# Expedition System State Machine

## Overview

The Expedition system handles mining and fishing expeditions where players send operatives to gather resources over time. Expeditions are temporary activities that lock resources and optionally include hero NFTs for bonus yields.

---

## 1. Expedition Lifecycle

### States

| State | Description |
|-------|-------------|
| `NonExistent` | No ExpeditionAccount for this player |
| `Active` | Expedition in progress, operatives locked |
| `Complete` | Duration elapsed, ready to claim |

### State Diagram

```
┌────────────────┐  start_expedition  ┌────────────────┐
│                │ ─────────────────> │                │
│  NonExistent   │                    │     Active     │
│                │                    │                │
└────────────────┘                    └───────┬────────┘
       ▲                                      │
       │                                      │ time elapsed
       │                                      ▼
       │                              ┌────────────────┐
       │                              │                │
       │ claim_expedition             │    Complete    │
       │ abort_expedition             │                │
       └──────────────────────────────└────────────────┘
```

### Transitions

#### `NonExistent` → `Active`
```
Trigger: start_expedition
Guards:
  - Player not traveling
  - Has required research (has_mining OR has_fishing)
  - Has required building level:
    - Mining: Workshop at MINING_WORKSHOP_REQ[tier]
    - Fishing: Dock at FISHING_DOCK_REQ[tier]
  - tier <= EXPEDITION_MAX_TIER (4)
  - Sufficient locked NOVI for cost
  - At least 1 operative committed
  - Sufficient operatives of each type
Actions:
  - Create ExpeditionAccount PDA: [EXPEDITION_SEED, owner]
  - Deduct locked NOVI (MINING_NOVI_COST or FISHING_NOVI_COST)
  - Lock operatives (deduct from player)
  - If hero provided:
    - Transfer hero NFT to expedition PDA (escrow)
    - Clear from active_heroes slot if applicable
  - Set expedition_type, tier, city_id, start_time
  - Emit ExpeditionStarted
```

#### `Active` → `Complete` (Automatic)
```
Trigger: Time passage
Guards:
  - now >= expedition.end_time()
Actions:
  - Expedition becomes claimable
  - No state field change (computed)
```

#### `Complete` → `NonExistent`
```
Trigger: claim_expedition
Guards:
  - now >= expedition.end_time()
Actions:
  - Calculate base yield:
    - weighted_ops = op1×1.0 + op2×1.5 + op3×2.0
    - Apply diminishing returns above max_operatives
    - yield = weighted_ops × hours × rate_per_tier / 100
  - Apply bonuses (multiplicative):
    1. Time-of-day bonus
    2. Research collection bonus
    3. Hero buffs (hero_collection_rate_bps or hero_produce_generation_bps)
    4. Strike score bonus (if avg_score >= 80, +25%)
    5. Hero affinity bonus (if has MiningAffinity or FishingAffinity)
    6. Origin city bonus (+25% if affinity + origin match)
  - Check rare find (deterministic):
    - seed = (start_time / 3600) % 10000
    - if seed < (base_rare_chance + observatory_bonus): 5× multiplier
  - Grant rewards (gems OR produce) + fragments
  - Return locked operatives to player
  - If hero was escrowed:
    - Transfer hero NFT back to owner (PDA signs)
  - Close ExpeditionAccount (refund rent)
  - Emit ExpeditionClaimed
```

---

## 2. Strike System (Phase 2)

### States

| State | Description |
|-------|-------------|
| `NotReady` | Strike window hasn't opened yet |
| `WindowOpen` | Player can perform a strike |
| `WindowClosed` | Missed the window |
| `LimitReached` | Max strikes already performed |

### State Diagram

```
                     ┌──────────────────────────────────────────┐
                     │                                          │
    ┌────────────────▼───┐  window opens  ┌────────────────────┐│
    │                    │ ─────────────> │                    ││
    │     NotReady       │                │    WindowOpen      ││
    │ (waiting for time) │                │ (player can strike)││
    └────────────────────┘                └─────────┬──────────┘│
                                                    │           │
                                     strike         │           │
                                     performed      │           │
                                                    ▼           │
                                          ┌────────────────────┐│
                                          │  Next Strike       │─┘
                                          │  Scheduled         │
                                          └────────────────────┘
                                                    │
                                     max_strikes    │
                                     reached        │
                                                    ▼
                                          ┌────────────────────┐
                                          │   LimitReached     │
                                          └────────────────────┘
```

### Strike Window Timing
```
window_opens = start_time + (strikes × SECONDS_PER_HOUR)
window_closes = window_opens + 1 hour (approximately)
max_strikes = duration_hours (1 per hour of expedition)
```

### Transitions

#### `NotReady` → `WindowOpen`
```
Trigger: Time passage
Guards:
  - now >= next_strike_time()
  - strikes < max_strikes()
Actions:
  - Strike window becomes available
```

#### `WindowOpen` → `NotReady` (success) / `WindowClosed` (failure)
```
Trigger: strike_expedition (or time passage)
Guards:
  - For strike: now within window, game_authority co-signs
  - For miss: now > window_closes
Actions:
  - On strike:
    - Record score (0-100, validated by game server)
    - strikes += 1
    - score += strike_score
    - Emit ExpeditionStrike
  - On miss:
    - Window passes, no score recorded
    - strikes += 1 (implicitly, window timing advances)
```

---

## 3. Abort Expedition

### Transition

#### `Active` → `NonExistent`
```
Trigger: abort_expedition
Guards:
  - Expedition exists
  - Owner is signer
Actions:
  - Return locked operatives to player (NO penalty)
  - NOVI cost is NOT refunded (burnt as penalty)
  - If hero was escrowed:
    - Transfer hero NFT back to owner
  - Close ExpeditionAccount (refund rent)
  - Emit ExpeditionAborted
```

---

## 4. Speedup Expedition

### Effect

```
Trigger: speedup_expedition
Guards:
  - Expedition exists and not complete
  - Remaining time > 0
  - Sufficient gems for cost
  - Valid speedup_tier (1 or 2)
Actions:
  - Tier 1: 50% time reduction, 1× gem cost
  - Tier 2: 75% time reduction, 2× gem cost
  - gem_cost = minutes_to_reduce × GEMS_PER_MINUTE × tier_multiplier
  - Deduct gems from player
  - Adjust start_time backward (makes end_time closer)
  - Emit ExpeditionSpeedup
```

---

## 5. Expedition Types & Tiers

### Mining Expedition

| Tier | Name | Workshop Req | Duration | NOVI Cost | Gems/Op/Hour |
|------|------|--------------|----------|-----------|--------------|
| 0 | Surface | 1 | Variable | Variable | Rate from config |
| 1 | Shallow | 5 | Variable | Variable | Rate from config |
| 2 | Deep | 10 | Variable | Variable | Rate from config |
| 3 | Volcanic | 15 | Variable | Variable | Rate from config |
| 4 | Abyssal | 20 | Variable | Variable | Rate from config |

### Fishing Expedition

| Tier | Name | Dock Req | Duration | NOVI Cost | Produce/Op/Hour |
|------|------|----------|----------|-----------|-----------------|
| 0 | Shore | 1 | Variable | Variable | Rate from config |
| 1 | River | 5 | Variable | Variable | Rate from config |
| 2 | Lake | 10 | Variable | Variable | Rate from config |
| 3 | DeepSea | 15 | Variable | Variable | Rate from config |
| 4 | Abyss | 20 | Variable | Variable | Rate from config |

---

## 6. Operative Tier Multipliers

| Tier | Multiplier | Effect |
|------|------------|--------|
| 1 | 1.0× (10000 bps) | Base yield |
| 2 | 1.5× (15000 bps) | +50% yield |
| 3 | 2.0× (20000 bps) | +100% yield |

---

## 7. Hero Integration

### Hero Escrow Flow
```
┌──────────┐  start w/hero  ┌──────────────┐  claim/abort  ┌──────────┐
│  Owner   │ ─────────────> │ ExpeditionPDA │ ────────────> │  Owner   │
│  Wallet  │   TransferV1   │   (Escrow)    │   TransferV1  │  Wallet  │
└──────────┘                └──────────────┘   (PDA signs) └──────────┘
```

### Hero Bonuses
- **MiningAffinity** (stat 17): Bonus % to mining yield
- **FishingAffinity** (stat 18): Bonus % to fishing yield
- **Origin City Bonus**: +25% if hero's origin city matches expedition location AND has affinity

---

## 8. Account Structure

### ExpeditionAccount (104 bytes)
```rust
pub struct ExpeditionAccount {
    pub player: Pubkey,              // 32 - Owner
    pub hero_mint: Pubkey,           // 32 - Escrowed hero (NULL if none)
    pub expedition_type: u8,         // 1 - Mining(1) or Fishing(2)
    pub tier: u8,                    // 1 - 0-4
    pub strikes: u8,                 // 1 - Strikes performed
    pub bump: u8,                    // 1 - PDA bump
    pub score: u16,                  // 2 - Accumulated strike score
    pub city_id: u16,                // 2 - Expedition location
    pub start_time: i64,             // 8 - When started
    pub operative_unit_1: u64,       // 8 - Tier 1 ops locked
    pub operative_unit_2: u64,       // 8 - Tier 2 ops locked
    pub operative_unit_3: u64,       // 8 - Tier 3 ops locked
}
```

### PDA Derivation
```
Seeds: [EXPEDITION_SEED, player_pubkey]
```

---

## 9. Invariants

```
1. Only one expedition per player at a time
2. expedition.player == owner wallet pubkey
3. expedition_type ∈ {1=Mining, 2=Fishing}
4. tier ∈ [0, 4]
5. strikes <= max_strikes()
6. score <= strikes × 100
7. Operatives locked are returned on claim or abort
8. Hero (if escrowed) is returned on claim or abort
9. NOVI cost is only refunded on claim (burnt on abort)
```
