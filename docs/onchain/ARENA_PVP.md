# Arena PvP System - On-Chain Reference

## Overview

The Arena is a **non-lethal** competitive PvP mode where players battle for glory and NOVI token rewards without losing their troops. Seasons run weekly per city, with top 10 leaderboard players earning master rewards.

### Key Design Decisions

- **Non-lethal**: Troops, weapons, and equipment are never consumed or destroyed
- **Stateless Combat**: Battles resolved in single transaction, no battle accounts stored
- **Trusted Loadouts**: No loadout validation - values trusted since arena is isolated and non-lethal
- **Per-City Seasons**: Each city tracks its own `arena_season_id`
- **Permissionless Claims**: Daily and master reward claims require no signer (crankable)
- **Auto-Close**: Old seasons (4+ behind current) can be closed by anyone

---

## Instructions

| ID | Instruction | Description |
|----|-------------|-------------|
| 230 | `create_season` | DAO creates new arena season for a city |
| 231 | `join_season` | Player joins active season |
| 232 | `update_loadout` | Player configures arena loadout |
| 233 | `challenge_player` | Execute matchmaker-assigned battle |
| 234 | `claim_daily_reward` | Claim daily participation reward (permissionless) |
| 235 | `claim_master_reward` | Claim top 10 leaderboard reward (permissionless) |
| 236 | `close_season` | Close old season, return rent to authority |

---

## State Accounts

### ArenaSeasonAccount (560 bytes)

PDA Seeds: `["arena_season", authority, season_id]`

```rust
pub struct ArenaSeasonAccount {
    // Identity (38 bytes)
    pub season_id: u32,                          // Auto-incremented per city
    pub city_id: u16,                            // City this arena belongs to
    pub authority: Pubkey,                       // DAO authority (receives rent on close)

    // Timing (25 bytes)
    pub start_time: i64,                         // Unix timestamp
    pub end_time: i64,                           // start_time + 7 days
    pub claim_deadline: i64,                     // end_time + 30 days
    pub status: u8,                              // ArenaStatus enum

    // Leaderboard - Top 10 (411 bytes)
    pub leaderboard: [ArenaLeaderboardEntry; 10], // 400 bytes
    pub leaderboard_count: u8,
    pub leaderboard_claimed: [bool; 10],

    // Prize Pool (52 bytes)
    pub master_prize_pool: u64,                  // Total NOVI for top 10
    pub daily_prize_pool: u64,                   // Total NOVI for daily rewards
    pub daily_distribution_cap: u64,             // Max distributed per day
    pub distributed_today: u64,
    pub last_distribution_day: u32,
    pub prize_remaining: u64,

    // Thresholds (26 bytes)
    pub min_level_required: u8,
    pub min_points_for_leaderboard: u64,         // Default: 500
    pub total_battles: u64,
    pub bump: u8,
}

pub enum ArenaStatus {
    Pending = 0,
    Active = 1,
    Finalized = 2,      // Season ended (time-based, no explicit finalize)
    RewardsDistributed = 3,
}
```

### ArenaParticipantAccount (488 bytes)

PDA Seeds: `["arena_participant", season_authority, season_id, player_account_pda]`

**Note**: Uses `player_account.key()` (the PlayerAccount PDA), not the wallet pubkey.

```rust
pub struct ArenaParticipantAccount {
    // Identity (36 bytes)
    pub player: Pubkey,                          // PlayerAccount PDA
    pub season_id: u32,

    // Rolling Battle Window (401 bytes)
    pub battle_timestamps: [i64; 10],            // Circular buffer
    pub battle_opponents: [Pubkey; 10],          // Who we fought
    pub battle_index: u8,

    // Matchmaking (12 bytes)
    pub last_match_id: u64,                      // Prevents replay attacks
    pub daily_reward_claimed_day: u32,

    // Skill Rating (4 bytes)
    pub elo_rating: u32,                         // Starts at 1000

    // Season Statistics (16 bytes)
    pub total_points: u64,
    pub wins: u32,                               // Season cumulative
    pub losses: u32,

    // Claim Tracking (2 bytes)
    pub master_reward_claimed: bool,
    pub bump: u8,
}
```

### ArenaLoadoutAccount (128 bytes)

PDA Seeds: `["arena_loadout", player_wallet]`

Reusable across seasons. Player's configured arena loadout.

```rust
pub struct ArenaLoadoutAccount {
    // Identity (33 bytes)
    pub player: Pubkey,                          // PlayerAccount PDA
    pub bump: u8,

    // Hero Selection (32 bytes)
    pub arena_hero: Pubkey,                      // Hero NFT mint (or default for none)

    // Unit Loadout (24 bytes)
    pub defensive_units: [u64; 3],               // Tier 1, 2, 3

    // Equipment Loadout (32 bytes)
    pub melee_weapons: u64,
    pub ranged_weapons: u64,
    pub siege_weapons: u64,
    pub armor_pieces: u64,
}
```

---

## Instruction Details

### 230: Create Season

Creates a new arena season for a city. Auto-increments `city.arena_season_id`.

**Authority**: DAO (GameEngine authority)

**Accounts**:
| # | Account | Signer | Writable | Description |
|---|---------|--------|----------|-------------|
| 0 | arena_season | | W | ArenaSeasonAccount PDA (created) |
| 1 | authority | S | W | DAO authority (pays rent) |
| 2 | game_engine | | | GameEngine PDA |
| 3 | city_account | | W | CityAccount PDA |
| 4 | system_program | | | System program |

**Instruction Data** (27 bytes):
```
city_id: u16
master_prize_pool: u64
daily_prize_pool: u64
daily_distribution_cap: u64
min_level_required: u8
```

**Logic**:
1. Verify authority matches GameEngine authority
2. Verify city_account PDA and city_id
3. Increment `city.arena_season_id`
4. Create ArenaSeasonAccount PDA
5. Initialize with Active status, timing (7 day duration, 30 day claim deadline)

---

### 231: Join Season

Player joins an active arena season. Creates participant and loadout accounts.

**Accounts**:
| # | Account | Signer | Writable | Description |
|---|---------|--------|----------|-------------|
| 0 | arena_season | | W | ArenaSeasonAccount |
| 1 | participant_account | | W | ArenaParticipantAccount (created) |
| 2 | loadout_account | | W | ArenaLoadoutAccount (created if needed) |
| 3 | player_account | | | PlayerAccount |
| 4 | player_authority | S | W | Player wallet (pays rent) |
| 5 | system_program | | | System program |

**Instruction Data** (4 bytes):
```
season_id: u32
```

**Validation**:
- Season must be Active
- Season not expired (`now < end_time`)
- Player level >= `min_level_required`
- Participant account doesn't already exist

**Logic**:
1. Create ArenaParticipantAccount with starting ELO (1000)
2. Create ArenaLoadoutAccount if doesn't exist (reusable across seasons)

---

### 232: Update Loadout

Player configures their arena loadout. **No validation against assets** - loadout values are trusted.

**Accounts**:
| # | Account | Signer | Writable | Description |
|---|---------|--------|----------|-------------|
| 0 | loadout_account | | W | ArenaLoadoutAccount |
| 1 | player_authority | S | | Player wallet |

**Instruction Data** (88 bytes):
```
arena_hero: Pubkey (32)
defensive_units: [u64; 3] (24)
melee_weapons: u64 (8)
ranged_weapons: u64 (8)
siege_weapons: u64 (8)
armor_pieces: u64 (8)
```

---

### 233: Challenge Player

Main battle instruction. Requires `game_authority` co-signature for matchmaking validation.

**Accounts**:
| # | Account | Signer | Writable | Description |
|---|---------|--------|----------|-------------|
| 0 | challenger_authority | S | | Challenger wallet |
| 1 | game_authority | S | | GameEngine game_authority |
| 2 | game_engine | | | GameEngine PDA |
| 3 | challenger_player | | | Challenger PlayerAccount |
| 4 | challenger_participant | | W | Challenger ArenaParticipantAccount |
| 5 | challenger_loadout | | | Challenger ArenaLoadoutAccount |
| 6 | challenger_hero | | | Challenger Hero NFT (optional) |
| 7 | challenger_estate | | | Challenger EstateAccount (optional) |
| 8 | defender_player | | | Defender PlayerAccount |
| 9 | defender_participant | | W | Defender ArenaParticipantAccount |
| 10 | defender_loadout | | | Defender ArenaLoadoutAccount |
| 11 | defender_hero | | | Defender Hero NFT (optional) |
| 12 | defender_estate | | | Defender EstateAccount (optional) |
| 13 | arena_season | | W | ArenaSeasonAccount |

**Instruction Data** (20 bytes):
```
match_id: u64        // Unique from matchmaker, prevents replay
match_timestamp: i64 // When match assigned, expires in 5 min
season_id: u32
```

**Validation**:
- `match_id > challenger.last_match_id` (prevent replay)
- `now - match_timestamp < 300` (5 min expiry)
- Season Active and not expired
- Cannot challenge self
- Battles in 24h window < 10 (`ARENA_MAX_DAILY_BATTLES`)
- Battles vs opponent in 24h < 2 (`ARENA_MAX_BATTLES_PER_OPPONENT`)
- Hero NFTs match loadout if configured

**Combat Resolution**:
1. Calculate power for both players (see Power Calculation)
2. Winner = higher power (draw if equal)
3. Calculate points (see Points System)
4. Update ELO ratings (see ELO System)
5. Update participant stats (wins/losses, points, battle history)
6. Update season leaderboard

---

### 234: Claim Daily Reward

Claim daily participation reward. **Permissionless** - anyone can call.

**Accounts**:
| # | Account | Signer | Writable | Description |
|---|---------|--------|----------|-------------|
| 0 | participant_account | | W | ArenaParticipantAccount |
| 1 | arena_season | | W | ArenaSeasonAccount |
| 2 | player_account | | W | PlayerAccount |
| 3 | player_owner | | | Player wallet |
| 4 | player_novi_ata | | W | Player NOVI token account |
| 5 | novi_mint | | W | NOVI mint |
| 6 | game_engine | | | GameEngine PDA (mint authority) |
| 7 | token_program | | | Token program |

**Instruction Data** (4 bytes):
```
season_id: u32
```

**Validation**:
- Season must be Active
- Not already claimed today (`daily_reward_claimed_day != today`)
- Battles in 24h >= 5 (`ARENA_MIN_BATTLES_FOR_DAILY_REWARD`)
- Daily pool not exhausted

**Reward Calculation**:
```rust
// Base: 100 NOVI (1000 raw with 1 decimal)
// Scale by battles: 5-10 battles = 0.5x-1.0x
// Win rate bonus: 50%+ win rate adds 0-50% bonus

battle_multiplier = battles_today * 10000 / 10
win_rate_bps = (wins * 10000 / total).max(5000)
win_bonus = win_rate_bps - 5000  // 0-5000

reward = BASE_REWARD * battle_multiplier / 10000
reward += reward * win_bonus / 10000
```

**Logic**:
1. Reset daily counter if new day
2. Calculate reward (capped by remaining daily pool)
3. Mint NOVI tokens to player's ATA
4. Update `locked_novi` in PlayerAccount
5. Update season's `distributed_today` and `daily_prize_pool`

---

### 235: Claim Master Reward

Claim top 10 leaderboard reward. **Permissionless** - anyone can call.

**Accounts**:
| # | Account | Signer | Writable | Description |
|---|---------|--------|----------|-------------|
| 0 | participant_account | | W | ArenaParticipantAccount |
| 1 | arena_season | | W | ArenaSeasonAccount |
| 2 | player_account | | W | PlayerAccount |
| 3 | player_owner | | | Player wallet |
| 4 | player_novi_ata | | W | Player NOVI token account |
| 5 | novi_mint | | W | NOVI mint |
| 6 | game_engine | | | GameEngine PDA (mint authority) |
| 7 | token_program | | | Token program |

**Instruction Data** (4 bytes):
```
season_id: u32
```

**Validation**:
- Season status >= Finalized (ended)
- `now <= claim_deadline`
- Not already claimed (`master_reward_claimed == false`)
- Player on leaderboard

**Prize Distribution**:
```rust
const ARENA_PRIZE_DISTRIBUTION: [u16; 10] = [
    4000,  // Rank 1: 40%
    2000,  // Rank 2: 20%
    1300,  // Rank 3: 13%
    900,   // Rank 4: 9%
    600,   // Rank 5: 6%
    400,   // Rank 6: 4%
    300,   // Rank 7: 3%
    200,   // Rank 8: 2%
    200,   // Rank 9: 2%
    100,   // Rank 10: 1%
];
```

---

### 236: Close Season

Close an old season and return rent to authority. **Permissionless**.

**Accounts**:
| # | Account | Signer | Writable | Description |
|---|---------|--------|----------|-------------|
| 0 | arena_season | | W | ArenaSeasonAccount (closed) |
| 1 | city_account | | | CityAccount PDA |
| 2 | season_authority | | W | Receives rent (must match season.authority) |

**Instruction Data** (6 bytes):
```
season_id: u32
city_id: u16
```

**Close Conditions** (either):
1. `now > season.claim_deadline`, OR
2. Season is 4+ behind city's current `arena_season_id`

**Logic**:
1. Verify season matches provided IDs
2. Verify `season_authority` matches `season.authority`
3. Check close conditions
4. Close account, transfer lamports to `season_authority`

---

## Power Calculation

Arena power combines loadout assets with all player buffs:

```rust
fn calculate_arena_power(loadout, player, hero, estate) -> u64 {
    // Base power from units
    let unit_power =
        loadout.defensive_units[0] * 10 +   // Tier 1: 10 power
        loadout.defensive_units[1] * 25 +   // Tier 2: 25 power
        loadout.defensive_units[2] * 60;    // Tier 3: 60 power

    // Equipment power
    let equipment_power =
        loadout.melee_weapons * 10 +
        loadout.ranged_weapons * 16 +       // phi ratio
        loadout.siege_weapons * 26 +        // phi^2 ratio
        loadout.armor_pieces * 5;

    let base_power = unit_power + equipment_power;

    // Buff sources (all in basis points)
    let total_bonus_bps =
        player.research_attack_bps + player.research_defense_bps +
        player.hero_attack_bps + player.hero_defense_bps +
        player.hero_weapon_efficiency_bps + player.hero_armor_efficiency_bps +
        location_synergy_bps +              // From hero slots
        player.blessed_hero_bonus_bps +     // Sanctuary
        player.equipped_weapon_bonus_bps + player.equipped_armor_bonus_bps +
        arena_hero_bonus_bps +              // From loadout hero NFT
        estate_bonus_bps;                   // Building buffs

    // Apply: base × (1 + bonus/10000)
    base_power * (10000 + total_bonus_bps) / 10000
}
```

---

## Points System

### Battle Points

```rust
const ARENA_BASE_WIN_POINTS: u64 = 100;
const ARENA_BASE_LOSS_POINTS: u64 = 20;
const ARENA_DRAW_POINTS: u64 = 50;
const ARENA_UNDERDOG_BONUS_BPS: u64 = 500;  // 5% per 10% disadvantage

fn calculate_battle_points(challenger_won, is_draw, c_power, d_power) -> (u64, u64) {
    if is_draw { return (50, 50); }

    let (winner_power, loser_power) = if challenger_won {
        (c_power, d_power)
    } else {
        (d_power, c_power)
    };

    // Underdog bonus: beating stronger opponent = more points
    let winner_points = if winner_power < loser_power {
        let disadvantage_bps = ((loser_power - winner_power) * 10000 / loser_power).min(5000);
        let bonus = BASE_WIN_POINTS * disadvantage_bps * UNDERDOG_BONUS_BPS / (10000 * 1000);
        BASE_WIN_POINTS + bonus
    } else {
        BASE_WIN_POINTS
    };

    // Return (challenger_points, defender_points)
}
```

### Leaderboard

- Minimum 500 points to enter leaderboard (`ARENA_MIN_POINTS_FOR_LEADERBOARD`)
- Top 10 maintained, sorted by total_points descending
- Updated after each battle for both players

---

## ELO System

```rust
const ARENA_STARTING_ELO: u32 = 1000;
const ARENA_ELO_K_FACTOR: u32 = 32;

fn update_elo(challenger_elo, defender_elo, challenger_won, is_draw) -> (u32, u32) {
    // Simplified expected score (0-100 scale)
    let diff = defender_elo - challenger_elo;
    let challenger_expected = match diff.abs() {
        0..=50   => 50,
        51..=100 => if diff > 0 { 36 } else { 64 },
        101..=200 => if diff > 0 { 24 } else { 76 },
        201..=300 => if diff > 0 { 15 } else { 85 },
        _ => if diff > 0 { 9 } else { 91 },
    };

    // Actual score
    let (c_actual, d_actual) = match (challenger_won, is_draw) {
        (_, true) => (50, 50),
        (true, _) => (100, 0),
        (false, _) => (0, 100),
    };

    // New ELO = old + K * (actual - expected) / 100
    let c_delta = K_FACTOR * (c_actual - challenger_expected) / 100;
    let d_delta = K_FACTOR * (d_actual - (100 - challenger_expected)) / 100;

    ((challenger_elo + c_delta).max(100), (defender_elo + d_delta).max(100))
}
```

---

## Anti-Exploit Mechanisms

| Mechanism | Implementation |
|-----------|---------------|
| **Rolling 24h Limit** | `count_battles_in_window()` - max 10 battles per 24h rolling window |
| **Opponent Cooldown** | `count_opponent_in_window()` - max 2 battles vs same opponent per 24h |
| **Match Replay Prevention** | `match_id > last_match_id` - monotonically increasing |
| **Match Expiry** | `now - match_timestamp < 300` - 5 minute window |
| **Matchmaker Validation** | `game_authority` co-signature required |
| **Leaderboard Minimum** | 500 points to enter top 10 |
| **Season Auto-Close** | 4+ seasons behind can be closed |

---

## Constants

```rust
// Timing
pub const ARENA_SEASON_DURATION: i64 = 7 * 86400;      // 7 days
pub const ARENA_CLAIM_DEADLINE: i64 = 30 * 86400;      // 30 days after end
pub const ARENA_MATCH_EXPIRY_SECONDS: i64 = 300;       // 5 minutes

// Battle Limits
pub const ARENA_MAX_DAILY_BATTLES: u8 = 10;
pub const ARENA_MAX_BATTLES_PER_OPPONENT: u8 = 2;
pub const ARENA_MIN_BATTLES_FOR_DAILY_REWARD: u8 = 5;

// ELO
pub const ARENA_STARTING_ELO: u32 = 1000;
pub const ARENA_ELO_K_FACTOR: u32 = 32;

// Points
pub const ARENA_BASE_WIN_POINTS: u64 = 100;
pub const ARENA_BASE_LOSS_POINTS: u64 = 20;
pub const ARENA_DRAW_POINTS: u64 = 50;
pub const ARENA_MIN_POINTS_FOR_LEADERBOARD: u64 = 500;

// Rewards
pub const ARENA_DAILY_BASE_REWARD: u64 = 1000;         // 100 NOVI (1 decimal)

// Power Values
pub const DEFENSIVE_UNIT_1_POWER: u64 = 10;
pub const DEFENSIVE_UNIT_2_POWER: u64 = 25;
pub const DEFENSIVE_UNIT_3_POWER: u64 = 60;
pub const ARENA_MELEE_WEAPON_POWER: u64 = 10;
pub const ARENA_RANGED_WEAPON_POWER: u64 = 16;
pub const ARENA_SIEGE_WEAPON_POWER: u64 = 26;
pub const ARENA_ARMOR_POWER: u64 = 5;
```

---

## PDA Seeds Reference

```rust
// Arena Season
["arena_season", authority.as_ref(), season_id.to_le_bytes()]

// Arena Participant (NOTE: uses PlayerAccount PDA, not wallet)
["arena_participant", season_authority.as_ref(), season_id.to_le_bytes(), player_account_pda.as_ref()]

// Arena Loadout (uses wallet)
["arena_loadout", player_wallet.as_ref()]

// City (for arena_season_id tracking)
["city", city_id.to_le_bytes()]
```

---

## Season Lifecycle

```
1. CREATE_SEASON (DAO)
   └── city.arena_season_id++
   └── Season starts Active

2. JOIN_SEASON (Players)
   └── Create participant + loadout accounts

3. UPDATE_LOADOUT (Players)
   └── Configure units/equipment for arena

4. CHALLENGE_PLAYER (Matchmaker-assigned battles)
   └── Power comparison → winner
   └── Update points, ELO, leaderboard

5. CLAIM_DAILY_REWARD (Permissionless)
   └── 5+ battles in 24h required
   └── Mints NOVI tokens

6. [Season ends: now > end_time]
   └── Status becomes Finalized automatically

7. CLAIM_MASTER_REWARD (Permissionless, top 10 only)
   └── Within 30 days of season end
   └── Mints NOVI tokens

8. CLOSE_SEASON (Permissionless)
   └── After claim_deadline OR 4+ seasons behind
   └── Rent → season authority
```
