# Arena System State Machine

## Overview

The Arena system provides seasonal competitive PvP rankings. Players earn points from battles, climb tiers, and receive rewards based on their performance at season end.

---

## 1. Season Lifecycle

### States

| State | Description |
|-------|-------------|
| `Inactive` | No active season |
| `Active` | Season in progress |
| `Ended` | Season complete, claiming period |

### State Diagram

```
┌────────────────┐  start_season   ┌────────────────┐
│                │ ──────────────> │                │
│    Inactive    │                 │     Active     │
│                │                 │                │
└────────────────┘                 └───────┬────────┘
       ▲                                   │
       │                                   │ end_season
       │ reset_for_next                    ▼
       │                           ┌────────────────┐
       └───────────────────────────│                │
                                   │     Ended      │
                                   │                │
                                   └────────────────┘
```

### Transitions

#### `Inactive` → `Active`
```
Trigger: start_season (admin)
Guards:
  - No active season
  - Valid season configuration
Actions:
  - Set arena_state.current_season += 1
  - Set arena_state.season_start = now
  - Set arena_state.season_end = now + duration
  - Reset tier thresholds
  - Emit SeasonStarted
```

#### `Active` → `Ended`
```
Trigger: end_season (automatic or admin)
Guards:
  - now >= season_end
Actions:
  - Calculate final rankings
  - Prepare reward distribution
  - Emit SeasonEnded
```

---

## 2. Player Arena State

### States

| State | Description |
|-------|-------------|
| `Unregistered` | Player hasn't joined arena |
| `Registered` | Active arena participant |

### Tier Levels

| Tier | Name | Points Required |
|------|------|-----------------|
| 0 | Bronze | 0 |
| 1 | Silver | 1,000 |
| 2 | Gold | 3,000 |
| 3 | Platinum | 6,000 |
| 4 | Diamond | 10,000 |
| 5 | Master | 15,000 |
| 6 | Grandmaster | 25,000 |
| 7 | Champion | 50,000 |

### State Diagram

```
┌────────────────┐  join_arena   ┌────────────────┐
│                │ ────────────> │                │
│  Unregistered  │               │   Registered   │
│                │               │                │
└────────────────┘               └───────┬────────┘
                                         │
                         ┌───────────────┼───────────────┐
                         │               │               │
                         ▼               ▼               ▼
                   ┌──────────┐  ┌──────────────┐  ┌──────────┐
                   │ Battle   │  │  Tier Up/    │  │  Claim   │
                   │ (win/lose)│  │  Down        │  │  Rewards │
                   └──────────┘  └──────────────┘  └──────────┘
```

### Transitions

#### `Unregistered` → `Registered`
```
Trigger: join_arena (implicit on first battle)
Guards:
  - Active season
  - Player meets minimum requirements
Actions:
  - Initialize player arena stats for season
  - Set tier = 0 (Bronze)
  - Set points = 0
  - Emit ArenaJoined
```

---

## 3. Battle System

### Point Calculation
```
win_points = base_points × tier_multiplier × streak_bonus
lose_points = base_loss × tier_difference_modifier

Where:
- base_points = 100
- tier_multiplier = 1 + (opponent_tier - own_tier) × 0.1
- streak_bonus = 1 + (win_streak × 0.05) capped at 1.5
```

### Battle Resolution
```
Trigger: arena_battle
Guards:
  - Both players registered
  - Active season
  - Battle cooldown elapsed
  - Sufficient stamina
Actions:
  - Calculate combat outcome
  - Update winner points (+)
  - Update loser points (-)
  - Update win/loss streaks
  - Check tier changes
  - Award XP
  - Emit ArenaBattle
```

---

## 4. Daily Rewards

### States

| State | Description |
|-------|-------------|
| `Available` | Daily reward claimable |
| `Claimed` | Already claimed today |

### Tier-Based Daily Rewards

| Tier | Daily NOVI | Daily Gems |
|------|------------|------------|
| Bronze | 100 | 1 |
| Silver | 250 | 2 |
| Gold | 500 | 5 |
| Platinum | 1,000 | 10 |
| Diamond | 2,500 | 25 |
| Master | 5,000 | 50 |
| Grandmaster | 10,000 | 100 |
| Champion | 25,000 | 250 |

### Transition

#### Claim Daily Reward
```
Trigger: claim_daily_arena_reward
Guards:
  - Registered in arena
  - 24 hours since last claim
Actions:
  - Grant NOVI based on tier
  - Grant gems based on tier
  - Update last_claim timestamp
  - Emit DailyRewardClaimed
```

---

## 5. Season Rewards

### Master Tier Rewards

| Rank | Reward |
|------|--------|
| 1st | 1,000,000 NOVI + Exclusive NFT |
| 2-10 | 500,000 NOVI |
| 11-50 | 100,000 NOVI |
| 51-100 | 50,000 NOVI |

### Tier Completion Rewards

| Tier Reached | Bonus NOVI |
|--------------|------------|
| Silver | 1,000 |
| Gold | 5,000 |
| Platinum | 15,000 |
| Diamond | 50,000 |
| Master | 150,000 |
| Grandmaster | 500,000 |
| Champion | 1,000,000 |

### Transition

#### Claim Master Reward
```
Trigger: claim_master_arena_reward
Guards:
  - Season ended
  - Registered in season
  - Haven't claimed yet
Actions:
  - Calculate final rank
  - Grant rank-based rewards
  - Grant tier completion bonuses
  - Mark as claimed
  - Emit MasterRewardClaimed
```

---

## 6. Account Structures

### ArenaAccount (Global - 128 bytes)
```rust
pub struct ArenaAccount {
    pub current_season: u32,
    pub season_start: i64,
    pub season_end: i64,
    pub total_participants: u32,
    pub total_battles: u64,
    pub is_active: bool,

    // Tier thresholds
    pub tier_thresholds: [u32; 8],

    // Top players (cached)
    pub top_player_1: Pubkey,
    pub top_player_2: Pubkey,
    pub top_player_3: Pubkey,
    pub top_score_1: u32,
    pub top_score_2: u32,
    pub top_score_3: u32,

    pub bump: u8,
}
```

### PlayerArenaStats (in PlayerAccount)
```rust
// Arena extension fields
pub arena_season: u32,           // Which season stats are for
pub arena_points: u32,           // Current points
pub arena_tier: u8,              // Current tier (0-7)
pub arena_wins: u32,             // Total wins this season
pub arena_losses: u32,           // Total losses this season
pub arena_win_streak: u8,        // Current win streak
pub arena_best_streak: u8,       // Best streak this season
pub arena_last_battle: i64,      // Last battle timestamp
pub arena_last_daily_claim: i64, // Last daily reward claim
pub arena_master_claimed: bool,  // Season reward claimed
```

---

## 7. Building Integration

### Arena Building Requirements
- **Unlock**: Estate Level 18
- **Effect**: Enables arena participation
- **Per-Level Bonus**: +0.5% PvP damage per level

### Daily Activity Bonus
Completing Arena building daily activity grants:
- +10% arena damage for 24 hours

---

## 8. Matchmaking

### Rating-Based Matching
```
eligible_opponents = players where:
  |opponent.arena_points - player.arena_points| <= 1000
  AND opponent.arena_tier ∈ [player.tier - 1, player.tier + 2]
```

### Tier Protection
- Cannot drop below current tier floor
- Tier down requires 3 consecutive losses at floor

---

## 9. Invariants

```
1. Points cannot go negative
2. Tier matches point thresholds
3. Only one battle per cooldown period
4. Daily rewards once per 24 hours
5. Season rewards claimed once per season
6. Win streak resets on loss
7. Stats reset each season
8. Cannot battle self
9. Both participants must be registered
```
