# Arena PvP System

## Overview

The Arena is a non-lethal competitive PvP mode where players battle for glory and rewards without losing their troops. Players accumulate points throughout a weekly season, with the top 10 players earning placement on the on-chain leaderboard and receiving master rewards.

### Core Philosophy

- **Fun First:** Arena is about determining strength and skill, not economic warfare
- **No Permanent Loss:** Troops, weapons, and equipment are never consumed or destroyed
- **Skill Expression:** Strategic hero selection, loadout optimization, and ELO-based matchmaking
- **Weekly Competition:** Fresh seasons keep competition dynamic
- **Tiered Rewards:** Daily participation rewards + weekly master rewards for top performers
- **Anti-Exploit:** Rolling limits, opponent diversity requirements, and ELO prevent gaming

---

## Design Principles

### Stateless Combat Resolution

Combat is resolved entirely within a single transaction. No `ArenaBattleAccount` is stored on-chain. Instead:

1. Compute combat outcome deterministically
2. Update participant stats
3. Emit event with full battle details
4. Indexers capture events for history/replays

This saves ~5000 lamports per battle and reduces complexity.

### Loadout Validation at Battle Time

Loadouts are validated against current player assets when a battle starts, not when configured. This prevents "phantom army" exploits where a player configures a loadout then loses assets in regular gameplay.

### ELO-Based Skill Rating

In addition to power rating (asset-based), players have an ELO rating that tracks actual performance. ELO is used for:
- **Off-chain matchmaking** (primary factor for opponent selection)
- **Leaderboard ranking** (secondary to points)
- **Skill tracking** for player profiles

### Off-Chain Matchmaking

Matches are assigned by an off-chain matchmaker service. The `game_authority` signs each match to validate it on-chain.

**Why Off-Chain Matchmaking?**
- Prevents collusion (two players farming points off each other)
- Prevents target selection abuse (always picking weak opponents)
- Prevents sybil attacks (fighting your own alt accounts)
- Enables ELO-based fair matching without on-chain queue complexity

**Matchmaking Flow:**
```
1. Player calls "queue_for_match" API endpoint
2. Matchmaker finds suitable opponent based on:
   - ELO range (±200 preferred, expands over time)
   - Recent opponent history (avoid rematches)
   - Queue wait time (prioritize long-waiters)
3. Matchmaker returns signed match assignment:
   - match_id (unique, prevents replay)
   - match_timestamp (expires in 5 minutes)
   - defender pubkey
4. Player submits challenge_player tx with game_authority co-sign
5. On-chain validation ensures match is fresh and valid
```

**Match Assignment Expiry:** 5 minutes. If not submitted, player must re-queue.

**Anti-Abuse (On-Chain Backup):**
- Even with game_authority signature, on-chain still validates:
  - Max 2 battles vs same opponent per 24h
  - Max 10 battles per 24h total
  - Both players have valid loadouts

---

## State Accounts

### ArenaSeasonAccount

Tracks the current season state and global leaderboard.

```rust
pub const ARENA_SEASON_ACCOUNT_SIZE: usize = 560;

pub struct ArenaSeasonAccount {
    // ===== Identity (38 bytes) =====
    pub season_id: u32,                          // 4 - Incrementing season number
    pub city_id: u16,                            // 2 - City this arena belongs to (0 = global)
    pub authority: Pubkey,                       // 32 - Who can finalize/admin

    // ===== Timing (25 bytes) =====
    pub start_time: i64,                         // 8 - Unix timestamp
    pub end_time: i64,                           // 8 - start_time + 7 days
    pub claim_deadline: i64,                     // 8 - end_time + 30 days
    pub status: u8,                              // 1 - 0=pending, 1=active, 2=finalized, 3=rewards_distributed

    // ===== Leaderboard - Top 10 Only (411 bytes) =====
    pub leaderboard: [ArenaLeaderboardEntry; 10], // 400 (10 × 40)
    pub leaderboard_count: u8,                   // 1
    pub leaderboard_claimed: [bool; 10],         // 10 - Track who claimed master reward

    // ===== Prize Pool (52 bytes) =====
    pub master_prize_pool: u64,                  // 8 - Total NOVI for top 10
    pub daily_prize_pool: u64,                   // 8 - Total NOVI for daily rewards
    pub daily_distribution_cap: u64,             // 8 - Max distributed per day
    pub distributed_today: u64,                  // 8 - Tracks today's distributions
    pub last_distribution_day: u32,              // 4 - Day number for reset
    pub _padding1: [u8; 4],                      // 4 - Alignment padding
    pub prize_remaining: u64,                    // 8 - Unclaimed prizes

    // ===== Thresholds (26 bytes) =====
    pub min_level_required: u8,                  // 1 - Minimum player level to join
    pub _padding2: [u8; 7],                      // 7 - Alignment padding
    pub min_points_for_leaderboard: u64,         // 8 - Prevents sybil attacks (default: 500)
    pub total_battles: u64,                      // 8 - Counter for deterministic battle seed
    pub bump: u8,                                // 1 - PDA bump
    pub _reserved: [u8; 7],                      // 7 - Future use
}

pub struct ArenaLeaderboardEntry {
    pub player: Pubkey,                          // 32 bytes
    pub total_points: u64,                       // 8 bytes
}                                                // Total: 40 bytes
```

**Size:** 560 bytes (38 + 25 + 411 + 52 + 26 + padding = 560)

---

### ArenaParticipantAccount

Per-player, per-season state tracking. Minimal on-chain storage - derived stats computed from battle_opponents.

```rust
pub const ARENA_PARTICIPANT_ACCOUNT_SIZE: usize = 488;

pub struct ArenaParticipantAccount {
    // ===== Identity (36 bytes) =====
    pub player: Pubkey,                          // 32
    pub season_id: u32,                          // 4

    // ===== Daily Battle Tracking - Rolling Window (401 bytes) =====
    pub battle_timestamps: [i64; 10],            // 80 - Circular buffer of last 10 battle times
    pub battle_opponents: [Pubkey; 10],          // 320 - Who we fought (for diversity + cooldown checks)
    pub battle_index: u8,                        // 1 - Current index in circular buffer

    // ===== Matchmaking (12 bytes) =====
    pub last_match_id: u64,                      // 8 - Prevents match replay attacks
    pub daily_reward_claimed_day: u32,           // 4 - Which day was last claim

    // ===== Skill Rating (4 bytes) =====
    pub elo_rating: u32,                         // 4 - Starts at 1000

    // ===== Season Statistics (16 bytes) =====
    pub total_points: u64,                       // 8 - Can never go below 0
    pub wins: u32,                               // 4 - Season cumulative wins (for daily reward calc)
    pub losses: u32,                             // 4 - Season cumulative losses

    // ===== Claim Tracking (2 bytes) =====
    pub master_reward_claimed: bool,             // 1
    pub bump: u8,                                // 1 - PDA bump
}
```

**Size:** ~472 bytes

**Derived from `battle_opponents` at runtime:**
- `unique_opponents_today`: Count unique pubkeys in window within last 24h
- `opponent_battle_count`: Count occurrences of specific pubkey in window within last 24h

**Season Cumulative Win Rate:**
- `wins` and `losses` track the entire season's performance
- Used for daily reward calculation - rewards consistent daily play
- If you skip a day, you miss out on building your win count

---

### ArenaLoadoutAccount

Stores the player's arena-specific **choices** only. Power computed at battle time.

```rust
pub const ARENA_LOADOUT_ACCOUNT_SIZE: usize = 136;

pub struct ArenaLoadoutAccount {
    // ===== Identity =====
    pub player: Pubkey,

    // ===== Hero Choice =====
    pub arena_hero: Pubkey,                      // Which hero to use (different from main game)

    // ===== Unit Allocation (defensive units only) =====
    pub defensive_units: [u64; 3],               // Committed defensive units

    // ===== Equipment Allocation =====
    pub melee_weapons: u64,
    pub ranged_weapons: u64,
    pub siege_weapons: u64,
    pub armor_pieces: u64,

    // ===== Validation =====
    pub last_validated: i64,                     // Must re-validate if stale (24 hours)
}
```

**Size:** ~136 bytes

**Computed at battle time:**
- Power → from defensive units + weapons + armor + PlayerCore buffs + HeroAccount + EstateAccount
- Winner determined by power comparison (no health system)

---

## Instructions

### Instruction Discriminants

```rust
// Arena System: 200-214
200 => arena::initialize_season
201 => arena::join_season
202 => arena::update_loadout
203 => arena::validate_loadout
204 => arena::challenge_player
205 => arena::claim_daily_reward
206 => arena::claim_master_reward
207 => arena::finalize_season
208 => arena::redistribute_unclaimed
```

---

### 230: Initialize Season

Creates a new arena season. Called by game engine authority.

```rust
pub struct InitializeArenaSeasonArgs {
    pub city_id: u16,                            // 0 = global arena
    pub master_prize_pool: u64,
    pub daily_prize_pool: u64,
    pub daily_distribution_cap: u64,             // Max per day
    pub min_level_required: u8,
    pub min_points_for_leaderboard: u64,         // Default: 500
}
```

**Accounts:**
- `[signer]` authority
- `[writable]` game_engine
- `[writable]` arena_season (PDA: `["arena", city_id, season_id]`)
- `[]` system_program

**Logic:**
```rust
fn initialize_season(args: InitializeArenaSeasonArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    arena_season.season_id = game_engine.next_arena_season_id;
    arena_season.city_id = args.city_id;
    arena_season.start_time = now;
    arena_season.end_time = now + (7 * SECONDS_PER_DAY);
    arena_season.claim_deadline = now + (37 * SECONDS_PER_DAY);  // +30 days after end
    arena_season.status = ArenaStatus::Active;
    arena_season.master_prize_pool = args.master_prize_pool;
    arena_season.daily_prize_pool = args.daily_prize_pool;
    arena_season.daily_distribution_cap = args.daily_distribution_cap;
    arena_season.min_level_required = args.min_level_required;
    arena_season.min_points_for_leaderboard = args.min_points_for_leaderboard;

    game_engine.next_arena_season_id += 1;

    Ok(())
}
```

---

### 231: Join Season

Player joins the current arena season.

```rust
pub struct JoinArenaSeasonArgs {
    // No args - loadout configured separately
}
```

**Accounts:**
- `[signer]` player_authority
- `[]` player
- `[writable]` arena_season
- `[writable]` arena_participant (PDA: `["arena_participant", season_id, player]`)
- `[writable]` arena_loadout (PDA: `["arena_loadout", player]`)
- `[]` system_program

**Validation:**
- Player level >= season.min_level_required
- Season status == Active
- Season not expired (now < end_time)
- Player hasn't already joined this season

**Logic:**
```rust
fn join_season() -> Result<()> {
    require!(player.level >= arena_season.min_level_required, ArenaError::MinimumLevelNotMet);
    require!(arena_season.status == ArenaStatus::Active, ArenaError::SeasonNotActive);
    require!(now < arena_season.end_time, ArenaError::SeasonExpired);

    // Initialize participant
    participant.player = player.key();
    participant.season_id = arena_season.season_id;
    participant.elo_rating = 1000;  // Starting ELO

    // Initialize loadout if new
    if loadout.player == Pubkey::default() {
        loadout.player = player.key();
    }

    emit!(ArenaPlayerJoined {
        season_id: arena_season.season_id,
        player: player.key(),
        timestamp: now,
    });

    Ok(())
}
```

---

### 232: Update Loadout

Player configures their arena loadout.

```rust
pub struct UpdateArenaLoadoutArgs {
    pub hero_mint: Pubkey,
    pub defensive_units: [u64; 3],
    pub melee_weapons: u64,
    pub ranged_weapons: u64,
    pub siege_weapons: u64,
    pub armor_pieces: u64,
}
```

**Accounts:**
- `[signer]` player_authority
- `[]` player
- `[]` hero_account (optional)
- `[writable]` arena_loadout

**Logic:**
```rust
fn update_loadout(args: UpdateArenaLoadoutArgs) -> Result<()> {
    // Validate hero ownership if specified
    if args.hero_mint != Pubkey::default() {
        require!(hero_account.mint == args.hero_mint, ArenaError::HeroNotOwned);
        require!(hero_account.owner == player.key(), ArenaError::HeroNotOwned);
        require!(!hero_account.is_locked, ArenaError::HeroLocked);
        loadout.arena_hero = args.hero_mint;
    }

    // Store requested allocation (validation happens at validate_loadout)
    loadout.defensive_units = args.defensive_units;
    loadout.melee_weapons = args.melee_weapons;
    loadout.ranged_weapons = args.ranged_weapons;
    loadout.siege_weapons = args.siege_weapons;
    loadout.armor_pieces = args.armor_pieces;

    Ok(())
}
```

---

### 233: Validate Loadout

Validates loadout against current player assets. Sets validation timestamp.

```rust
pub struct ValidateLoadoutArgs {
    // No args
}
```

**Accounts:**
- `[signer]` player_authority
- `[]` player
- `[]` hero_account (if hero configured)
- `[writable]` arena_loadout

**Logic:**
```rust
fn validate_loadout() -> Result<()> {
    // Validate defensive units don't exceed owned
    require!(loadout.defensive_units[0] <= player.defensive_unit_1, ArenaError::InsufficientUnits);
    require!(loadout.defensive_units[1] <= player.defensive_unit_2, ArenaError::InsufficientUnits);
    require!(loadout.defensive_units[2] <= player.defensive_unit_3, ArenaError::InsufficientUnits);

    // Validate equipment
    require!(loadout.melee_weapons <= player.melee_weapons, ArenaError::InsufficientWeapons);
    require!(loadout.ranged_weapons <= player.ranged_weapons, ArenaError::InsufficientWeapons);
    require!(loadout.siege_weapons <= player.siege_weapons, ArenaError::InsufficientWeapons);
    require!(loadout.armor_pieces <= player.armor_pieces, ArenaError::InsufficientArmor);

    // Validate hero if configured
    if loadout.arena_hero != Pubkey::default() {
        require!(hero_account.mint == loadout.arena_hero, ArenaError::HeroNotOwned);
        require!(hero_account.owner == player.key(), ArenaError::HeroNotOwned);
    }

    loadout.last_validated = now;

    Ok(())
}
```

---

### 234: Challenge Player (Main Battle Instruction)

Initiate and resolve a battle against another player in a single transaction. Winner determined by power comparison.

**Off-Chain Matchmaking Required:** The `game_authority` must sign to validate the match. This prevents:
- Collusion (two players farming points off each other)
- Target selection abuse (always picking weak opponents)
- Sybil attacks (fighting your own alt accounts)

The off-chain matchmaker ensures fair opponent selection based on ELO range, recent opponents, and queue order.

```rust
pub struct ChallengePlayerArgs {
    pub match_id: u64,           // Unique match ID from matchmaker (prevents replay)
    pub match_timestamp: i64,    // When match was assigned (expires after 5 min)
}
```

**Accounts:**
- `[signer]` challenger_authority
- `[signer]` game_authority (from GameEngine - validates matchmaking)
- `[]` game_engine
- `[]` challenger_player
- `[writable]` challenger_participant
- `[]` challenger_loadout
- `[]` challenger_hero (optional, if loadout.arena_hero is set)
- `[]` challenger_estate (optional)
- `[]` defender_player
- `[writable]` defender_participant
- `[]` defender_loadout
- `[]` defender_hero (optional, if loadout.arena_hero is set)
- `[]` defender_estate (optional)
- `[writable]` arena_season

**Pre-Battle Validation:**
```rust
fn validate_challenge(
    args: &ChallengePlayerArgs,
    game_engine: &GameEngine,
    challenger: &ArenaParticipantAccount,
    challenger_loadout: &ArenaLoadoutAccount,
    defender: &ArenaParticipantAccount,
    defender_loadout: &ArenaLoadoutAccount,
    season: &ArenaSeasonAccount,
    now: i64,
) -> Result<()> {
    // Prevent match replay - match_id must be greater than last used
    require!(args.match_id > challenger.last_match_id, ArenaError::MatchAlreadyUsed);

    // Match assignment must be fresh (5 minute window)
    require!(now - args.match_timestamp < 300, ArenaError::MatchExpired);
    require!(args.match_timestamp <= now, ArenaError::MatchTimestampInvalid);

    // Season must be active
    require!(season.status == ArenaStatus::Active, ArenaError::SeasonNotActive);
    require!(now < season.end_time, ArenaError::SeasonExpired);

    // Cannot challenge self
    require!(challenger.player != defender.player, ArenaError::CannotChallengeYourself);

    // Both must be in same season
    require!(challenger.season_id == season.season_id, ArenaError::NotInSeason);
    require!(defender.season_id == season.season_id, ArenaError::OpponentNotInSeason);

    // Loadouts must not be stale (24 hour max)
    require!(now - challenger_loadout.last_validated < SECONDS_PER_DAY, ArenaError::LoadoutStale);
    require!(now - defender_loadout.last_validated < SECONDS_PER_DAY, ArenaError::LoadoutStale);

    // Rolling 24-hour battle limit (10 battles per 24 hours)
    let battles_in_window = count_battles_in_window(&challenger.battle_timestamps, now, SECONDS_PER_DAY);
    require!(battles_in_window < MAX_DAILY_BATTLES, ArenaError::DailyBattleLimitReached);

    // Opponent diversity enforced by matchmaker, but double-check on-chain
    // Max 2 battles vs same opponent per 24h window
    let battles_vs_opponent = count_opponent_in_window(
        &challenger.battle_opponents,
        &challenger.battle_timestamps,
        defender.player,
        now,
        SECONDS_PER_DAY
    );
    require!(battles_vs_opponent < MAX_BATTLES_PER_OPPONENT, ArenaError::OpponentCooldownActive);

    // Validate hero accounts if loadouts have heroes set
    if challenger_loadout.arena_hero != Pubkey::default() {
        require!(challenger_hero.is_some(), ArenaError::HeroAccountRequired);
        require!(!challenger_hero.unwrap().is_locked, ArenaError::HeroLocked);
        require!(challenger_hero.unwrap().mint == challenger_loadout.arena_hero, ArenaError::HeroMismatch);
    }
    if defender_loadout.arena_hero != Pubkey::default() {
        require!(defender_hero.is_some(), ArenaError::HeroAccountRequired);
        require!(!defender_hero.unwrap().is_locked, ArenaError::HeroLocked);
        require!(defender_hero.unwrap().mint == defender_loadout.arena_hero, ArenaError::HeroMismatch);
    }

    Ok(())
}
```

**Combat Resolution:**
```rust
fn challenge_player(args: ChallengePlayerArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let slot = Clock::get()?.slot;

    validate_challenge(&challenger_participant, &challenger_loadout, &defender_participant, &defender_loadout, &arena_season, now)?;

    // Calculate power for both players (computed at battle time)
    let challenger_power = calculate_arena_power(
        &challenger_loadout,
        &challenger_player,
        challenger_hero.as_ref(),
        challenger_estate.as_ref()
    );
    let defender_power = calculate_arena_power(
        &defender_loadout,
        &defender_player,
        defender_hero.as_ref(),
        defender_estate.as_ref()
    );

    // Determine winner (simple power comparison)
    let challenger_won = challenger_power > defender_power;
    let is_draw = challenger_power == defender_power;

    // Calculate points for both players
    let (challenger_points, defender_points) = calculate_battle_points(
        challenger_won,
        is_draw,
        challenger_power,
        defender_power
    );

    // Update ELO ratings
    let (new_challenger_elo, new_defender_elo) = update_elo(
        challenger_participant.elo_rating,
        defender_participant.elo_rating,
        challenger_won,
        is_draw
    );

    // Update challenger (season cumulative stats)
    challenger_participant.last_match_id = args.match_id;  // Prevent replay
    challenger_participant.total_points += challenger_points;
    challenger_participant.elo_rating = new_challenger_elo;
    if challenger_won {
        challenger_participant.wins += 1;
    } else if !is_draw {
        challenger_participant.losses += 1;
    }
    record_battle(&mut challenger_participant, defender_participant.player, now);

    // Update defender (season cumulative stats)
    defender_participant.total_points += defender_points;
    defender_participant.elo_rating = new_defender_elo;
    if !challenger_won && !is_draw {
        defender_participant.wins += 1;
    } else if challenger_won {
        defender_participant.losses += 1;
    }
    record_battle(&mut defender_participant, challenger_participant.player, now);

    // Update season
    arena_season.total_battles += 1;

    // Update leaderboard if either qualifies
    update_arena_leaderboard(&mut arena_season, challenger_participant.player, challenger_participant.total_points);
    update_arena_leaderboard(&mut arena_season, defender_participant.player, defender_participant.total_points);

    // Emit battle event (for indexers)
    emit!(ArenaBattleResolved {
        season_id: arena_season.season_id,
        battle_id: arena_season.total_battles,
        challenger: challenger_participant.player,
        defender: defender_participant.player,
        challenger_power,
        defender_power,
        challenger_won,
        challenger_points,
        defender_points,
        new_challenger_elo,
        new_defender_elo,
        timestamp: now,
        slot,
    });

    Ok(())
}

fn record_battle(participant: &mut ArenaParticipantAccount, opponent: Pubkey, now: i64) {
    let idx = participant.battle_index as usize;
    participant.battle_timestamps[idx] = now;
    participant.battle_opponents[idx] = opponent;
    participant.battle_index = ((idx + 1) % 10) as u8;
}
```

---

### 235: Claim Daily Reward

Claim participation reward for fighting today.

```rust
pub struct ClaimDailyRewardArgs {
    // No args
}
```

**Accounts:**
- `[signer]` player_authority
- `[writable]` player
- `[writable]` arena_participant
- `[writable]` arena_season

**Validation & Logic:**
```rust
fn claim_daily_reward() -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let today = (now / SECONDS_PER_DAY) as u32;

    // Must not have claimed today
    require!(
        participant.daily_reward_claimed_day < today,
        ArenaError::DailyRewardAlreadyClaimed
    );

    // Must have fought at least 5 battles in last 24 hours
    let battles_today = count_battles_in_window(
        &participant.battle_timestamps,
        now,
        SECONDS_PER_DAY
    );
    require!(battles_today >= MIN_BATTLES_FOR_DAILY_REWARD, ArenaError::InsufficientBattlesForReward);

    // Must have fought at least 5 unique opponents (computed from battle_opponents)
    let unique_opponents = count_unique_opponents_in_window(
        &participant.battle_opponents,
        &participant.battle_timestamps,
        now,
        SECONDS_PER_DAY
    );
    require!(unique_opponents >= MIN_UNIQUE_OPPONENTS_FOR_REWARD, ArenaError::InsufficientOpponentDiversity);

    // Reset daily distribution if new day
    if arena_season.last_distribution_day < today {
        arena_season.distributed_today = 0;
        arena_season.last_distribution_day = today;
    }

    // Check daily cap not exceeded
    let remaining_today = arena_season.daily_distribution_cap
        .saturating_sub(arena_season.distributed_today);
    require!(remaining_today > 0, ArenaError::DailyPoolExhausted);

    // Calculate reward using SEASON CUMULATIVE wins/losses
    // This rewards consistent play - players who skip days have lower win counts
    let base_reward = calculate_daily_reward(
        battles_today,
        participant.wins,
        participant.losses
    );

    let actual_reward = base_reward
        .min(remaining_today)
        .min(arena_season.daily_prize_pool);

    // Distribute reward
    player.locked_novi += actual_reward;
    arena_season.daily_prize_pool -= actual_reward;
    arena_season.distributed_today += actual_reward;

    participant.daily_reward_claimed_day = today;

    emit!(ArenaDailyRewardClaimed {
        season_id: arena_season.season_id,
        player: participant.player,
        amount: actual_reward,
        battles_fought: battles_today,
        unique_opponents,
        timestamp: now,
    });

    Ok(())
}
```

---

### 236: Claim Master Reward

Claim end-of-season reward (top 10 only).

```rust
pub struct ClaimMasterRewardArgs {
    // No args
}
```

**Accounts:**
- `[signer]` player_authority
- `[writable]` player
- `[writable]` arena_participant
- `[writable]` arena_season

**Logic:**
```rust
fn claim_master_reward() -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    // Season must be finalized
    require!(
        arena_season.status == ArenaStatus::Finalized,
        ArenaError::SeasonNotFinalized
    );

    // Must be within claim deadline
    require!(now < arena_season.claim_deadline, ArenaError::ClaimDeadlineExpired);

    // Must not have already claimed
    require!(!participant.master_reward_claimed, ArenaError::MasterRewardAlreadyClaimed);

    // Find player in leaderboard
    let rank = arena_season.leaderboard[..arena_season.leaderboard_count as usize]
        .iter()
        .position(|e| e.player == participant.player);

    let rank = match rank {
        Some(r) => r,
        None => return Err(ArenaError::NotInTopTen.into()),
    };

    // Check not already claimed for this rank
    require!(!arena_season.leaderboard_claimed[rank], ArenaError::MasterRewardAlreadyClaimed);

    // Calculate reward
    let reward = calculate_master_reward(rank as u8, arena_season.master_prize_pool);

    // Distribute
    player.locked_novi += reward;
    arena_season.prize_remaining -= reward;
    arena_season.leaderboard_claimed[rank] = true;
    participant.master_reward_claimed = true;

    emit!(ArenaMasterRewardClaimed {
        season_id: arena_season.season_id,
        player: participant.player,
        rank: rank as u8 + 1,
        amount: reward,
        timestamp: now,
    });

    Ok(())
}
```

---

### 237: Finalize Season

End the season and lock leaderboard.

```rust
pub struct FinalizeSeasonArgs {
    // No args
}
```

**Accounts:**
- `[signer]` authority (or permissionless after end_time)
- `[writable]` arena_season

**Logic:**
```rust
fn finalize_season() -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    // Must be after end_time OR authority is calling
    require!(
        now >= arena_season.end_time || authority.key() == arena_season.authority,
        ArenaError::SeasonNotEnded
    );

    require!(arena_season.status == ArenaStatus::Active, ArenaError::SeasonAlreadyFinalized);

    arena_season.status = ArenaStatus::Finalized;

    emit!(ArenaSeasonFinalized {
        season_id: arena_season.season_id,
        total_battles: arena_season.total_battles,
        leaderboard_count: arena_season.leaderboard_count,
        timestamp: now,
    });

    Ok(())
}
```

---

### 238: Redistribute Unclaimed

Redistribute unclaimed master rewards after deadline.

```rust
pub struct RedistributeUnclaimedArgs {
    // No args
}
```

**Accounts:**
- `[signer]` authority
- `[writable]` arena_season
- `[writable]` treasury_account

**Logic:**
```rust
fn redistribute_unclaimed() -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    require!(now >= arena_season.claim_deadline, ArenaError::ClaimDeadlineNotReached);
    require!(arena_season.status == ArenaStatus::Finalized, ArenaError::SeasonNotFinalized);

    let unclaimed = arena_season.prize_remaining;

    if unclaimed > 0 {
        // Return to treasury or roll over to next season
        treasury_account.balance += unclaimed;
        arena_season.prize_remaining = 0;
        arena_season.status = ArenaStatus::RewardsDistributed;

        emit!(ArenaUnclaimedRedistributed {
            season_id: arena_season.season_id,
            amount: unclaimed,
            timestamp: now,
        });
    }

    Ok(())
}
```

---

## Combat Mathematics

### Constants

```rust
// Battle limits
pub const MAX_DAILY_BATTLES: u8 = 10;
pub const MAX_BATTLES_PER_OPPONENT: u8 = 2;
pub const MIN_BATTLES_FOR_DAILY_REWARD: u8 = 5;
pub const MIN_UNIQUE_OPPONENTS_FOR_REWARD: u8 = 5;

// Time
pub const SECONDS_PER_DAY: i64 = 86_400;
pub const LOADOUT_VALIDITY_DURATION: i64 = 86_400;  // 24 hours

// ELO
pub const STARTING_ELO: u32 = 1000;
pub const ELO_K_FACTOR: i32 = 32;
pub const ELO_FLOOR: u32 = 100;

// Points
pub const BASE_WIN_POINTS: u64 = 100;
pub const BASE_LOSS_POINTS: u64 = 0;  // No penalty for trying
pub const DRAW_POINTS: u64 = 25;
pub const MIN_POINTS_FOR_LEADERBOARD: u64 = 500;

// Unit power values (defensive units only)
pub const DEFENSIVE_UNIT_1_POWER: u64 = 10;
pub const DEFENSIVE_UNIT_2_POWER: u64 = 25;
pub const DEFENSIVE_UNIT_3_POWER: u64 = 60;

// Equipment power values
pub const MELEE_WEAPON_POWER: u64 = 10;
pub const RANGED_WEAPON_POWER: u64 = 20;
pub const SIEGE_WEAPON_POWER: u64 = 50;
pub const ARMOR_POWER: u64 = 15;
```

---

### Power Calculation

Total arena power is computed at battle time from loadout + player buffs. This uses **all existing combat buffs** from PlayerCore and EstateAccount:

```rust
fn calculate_arena_power(
    loadout: &ArenaLoadoutAccount,
    player: &PlayerCore,
    hero: Option<&HeroAccount>,
    estate: Option<&EstateAccount>,
) -> u64 {
    // Base power from defensive units
    let unit_power =
        loadout.defensive_units[0] * DEFENSIVE_UNIT_1_POWER +
        loadout.defensive_units[1] * DEFENSIVE_UNIT_2_POWER +
        loadout.defensive_units[2] * DEFENSIVE_UNIT_3_POWER;

    // Equipment power
    let equipment_power =
        loadout.melee_weapons * MELEE_WEAPON_POWER +
        loadout.ranged_weapons * RANGED_WEAPON_POWER +
        loadout.siege_weapons * SIEGE_WEAPON_POWER +
        loadout.armor_pieces * ARMOR_POWER;

    let base_power = unit_power + equipment_power;

    // ===== RESEARCH BUFFS (from PlayerCore) =====
    // Arena combines attack + defense since it's a power comparison
    let research_bonus_bps = player.research_attack_bps as u64
        + player.research_defense_bps as u64;

    // ===== HERO BUFFS (cached on PlayerCore from active heroes) =====
    let hero_bonus_bps = player.hero_attack_bps as u64
        + player.hero_defense_bps as u64
        + player.hero_weapon_efficiency_bps as u64
        + player.hero_armor_efficiency_bps as u64;

    // ===== LOCATION SYNERGY (heroes at home city get bonus) =====
    // Sum of all active hero location bonuses
    let location_bonus_bps = player.slot_location_bonus[0] as u64
        + player.slot_location_bonus[1] as u64
        + player.slot_location_bonus[2] as u64;

    // ===== BLESSED HERO BONUS (from Sanctuary meditation) =====
    let blessed_bonus_bps = player.blessed_hero_bonus_bps as u64;

    // ===== EQUIPPED ITEM BONUSES (from Forge crafted equipment) =====
    let equipped_bonus_bps = player.equipped_weapon_bonus_bps as u64
        + player.equipped_armor_bonus_bps as u64;

    // ===== ARENA-SPECIFIC HERO (if loadout specifies a different hero) =====
    // This allows players to use a specific hero for arena that differs from their active heroes
    let arena_hero_bonus_bps = if let Some(hero) = hero {
        // Sum relevant hero buffs: AttackPower(1) + DefensePower(2)
        let mut bonus: u64 = 0;
        for buff in hero.buffs.iter() {
            if buff.stat == 1 || buff.stat == 2 {  // Attack or Defense
                bonus += buff.value_at_level(hero.level);
            }
        }
        bonus
    } else {
        0
    };

    // ===== ESTATE BUFFS =====
    let estate_bonus_bps = if let Some(estate) = estate {
        // Permanent building buffs
        let attack_bps = estate.attack_bps as u64;
        let defense_bps = estate.defense_bps as u64;
        let pvp_damage_bps = estate.pvp_damage_bps as u64;  // Arena building (0.5% per level)

        // Daily mini-game buffs (reset each day)
        let unit_effectiveness_bps = estate.unit_effectiveness_bps as u64;  // Barracks mini-game
        let arena_damage_bps = estate.arena_damage_bps as u64;              // Arena mini-game

        attack_bps + defense_bps + pvp_damage_bps + unit_effectiveness_bps + arena_damage_bps
    } else {
        0
    };

    // ===== TOTAL BONUS =====
    let total_bonus_bps = research_bonus_bps
        + hero_bonus_bps
        + location_bonus_bps
        + blessed_bonus_bps
        + equipped_bonus_bps
        + arena_hero_bonus_bps
        + estate_bonus_bps;

    // Apply: base_power × (1 + total_bonus_bps / 10000)
    apply_bp(base_power, 10_000 + total_bonus_bps).unwrap_or(base_power)
}
```

---

### Battle Resolution

Winner is determined by simple power comparison. No health, no rounds - just who is stronger:

```rust
fn resolve_battle(challenger_power: u64, defender_power: u64) -> (bool, bool) {
    let challenger_won = challenger_power > defender_power;
    let is_draw = challenger_power == defender_power;
    (challenger_won, is_draw)
}
```

---

## Points System

### Points Calculation

```rust
fn calculate_battle_points(
    challenger_won: bool,
    is_draw: bool,
    challenger_power: u64,
    defender_power: u64,
) -> (u64, u64) {
    if is_draw {
        return (DRAW_POINTS, DRAW_POINTS);
    }

    // Underdog bonus: beating stronger opponents gives more points
    let power_ratio = if challenger_won {
        (defender_power as f64) / (challenger_power.max(1) as f64)
    } else {
        (challenger_power as f64) / (defender_power.max(1) as f64)
    };

    // Clamp ratio between 0.5x and 2.0x
    let multiplier = power_ratio.min(2.0).max(0.5);
    let winner_points = (BASE_WIN_POINTS as f64 * multiplier) as u64;

    if challenger_won {
        (winner_points, BASE_LOSS_POINTS)
    } else {
        (BASE_LOSS_POINTS, winner_points)
    }
}
```

### Underdog Bonus Table

| Power Ratio (opponent/self) | Points Multiplier |
|-----------------------------|-------------------|
| 0.5x (you're 2x stronger) | 0.5x = 50 points |
| 1.0x (equal) | 1.0x = 100 points |
| 1.5x (opponent 50% stronger) | 1.5x = 150 points |
| 2.0x+ (opponent 2x+ stronger) | 2.0x = 200 points (capped) |

---

### Helper Functions

```rust
fn count_battles_in_window(timestamps: &[i64; 10], now: i64, window: i64) -> u8 {
    let cutoff = now - window;
    timestamps.iter().filter(|&&t| t > cutoff).count() as u8
}

fn count_unique_opponents_in_window(
    opponents: &[Pubkey; 10],
    timestamps: &[i64; 10],
    now: i64,
    window: i64,
) -> u8 {
    let cutoff = now - window;
    let mut unique: [Pubkey; 10] = [Pubkey::default(); 10];
    let mut unique_count: u8 = 0;

    for i in 0..10 {
        if timestamps[i] > cutoff && opponents[i] != Pubkey::default() {
            // Check if already in unique array
            let mut found = false;
            for j in 0..unique_count as usize {
                if unique[j] == opponents[i] {
                    found = true;
                    break;
                }
            }
            if !found {
                unique[unique_count as usize] = opponents[i];
                unique_count += 1;
            }
        }
    }
    unique_count
}

fn count_opponent_in_window(
    opponents: &[Pubkey; 10],
    timestamps: &[i64; 10],
    target: Pubkey,
    now: i64,
    window: i64,
) -> u8 {
    let cutoff = now - window;
    let mut count = 0;
    for i in 0..10 {
        if timestamps[i] > cutoff && opponents[i] == target {
            count += 1;
        }
    }
    count
}
```

---

## ELO Rating System

### ELO Update Formula

```rust
fn update_elo(
    challenger_elo: u32,
    defender_elo: u32,
    challenger_won: bool,
    is_draw: bool,
) -> (u32, u32) {
    // Calculate expected scores
    let challenger_expected = 1.0 / (1.0 + 10f64.powf((defender_elo as f64 - challenger_elo as f64) / 400.0));
    let defender_expected = 1.0 - challenger_expected;

    // Actual scores
    let (challenger_actual, defender_actual) = if is_draw {
        (0.5, 0.5)
    } else if challenger_won {
        (1.0, 0.0)
    } else {
        (0.0, 1.0)
    };

    // Calculate ELO changes
    let challenger_change = (ELO_K_FACTOR as f64 * (challenger_actual - challenger_expected)) as i32;
    let defender_change = (ELO_K_FACTOR as f64 * (defender_actual - defender_expected)) as i32;

    // Apply with floor
    let new_challenger_elo = (challenger_elo as i32 + challenger_change).max(ELO_FLOOR as i32) as u32;
    let new_defender_elo = (defender_elo as i32 + defender_change).max(ELO_FLOOR as i32) as u32;

    (new_challenger_elo, new_defender_elo)
}
```

### ELO Probability Table

| ELO Difference | Higher ELO Win% |
|----------------|-----------------|
| 0 | 50% |
| 100 | 64% |
| 200 | 76% |
| 300 | 85% |
| 400 | 91% |

---

## Reward Distribution

### Daily Reward Calculation

```rust
const DAILY_BASE_REWARD: u64 = 100;  // Base NOVI

fn calculate_daily_reward(battles_fought_today: u8, season_wins: u32, season_losses: u32) -> u64 {
    // Scale by battles fought TODAY (5-10 maps to 0.5x-1.0x)
    let battle_multiplier = (battles_fought_today as u64 * 10_000) / MAX_DAILY_BATTLES as u64;

    // Win rate bonus based on SEASON CUMULATIVE performance
    // This rewards consistent play - if you skip days, your win rate stays low
    // A player who plays all 7 days builds up wins; a player who skips loses out
    let total = season_wins + season_losses;
    let win_rate_bps = if total > 0 {
        ((season_wins as u64 * 10_000) / total as u64).max(5000)
    } else {
        5000  // No battles yet = neutral 50%
    };
    let win_bonus = win_rate_bps.saturating_sub(5000);  // 0-5000 bonus

    let reward = DAILY_BASE_REWARD;
    let reward = apply_bp(reward, battle_multiplier).unwrap_or(reward);
    let reward = apply_bp_bonus(reward, win_bonus as u16).unwrap_or(reward);

    reward
}
```

**Daily Reward Examples:**

| Battles | Win Rate | Reward |
|---------|----------|--------|
| 5 | 50% | 50 NOVI |
| 10 | 50% | 100 NOVI |
| 10 | 70% | 120 NOVI |
| 10 | 90% | 140 NOVI |

---

### Master Reward Distribution

```rust
const MASTER_PRIZE_DISTRIBUTION_BPS: [u16; 10] = [
    3500,   // Rank 1: 35%
    2500,   // Rank 2: 25%
    1500,   // Rank 3: 15%
    750,    // Rank 4: 7.5%
    750,    // Rank 5: 7.5%
    200,    // Rank 6: 2%
    200,    // Rank 7: 2%
    200,    // Rank 8: 2%
    200,    // Rank 9: 2%
    200,    // Rank 10: 2%
];

fn calculate_master_reward(rank: u8, total_prize_pool: u64) -> u64 {
    if rank >= 10 {
        return 0;
    }

    let share_bps = MASTER_PRIZE_DISTRIBUTION_BPS[rank as usize];
    apply_bp(total_prize_pool, share_bps as u64).unwrap_or(0)
}
```

**Master Reward Example (10,000 NOVI pool):**

| Rank | Share | NOVI |
|------|-------|------|
| 1 | 35% | 3,500 |
| 2 | 25% | 2,500 |
| 3 | 15% | 1,500 |
| 4 | 7.5% | 750 |
| 5 | 7.5% | 750 |
| 6-10 | 2% each | 200 |

---

## Buff Integration

All existing game buffs apply to arena power calculation. Buffs are read from PlayerCore (cached research + hero buffs) plus arena-specific hero and estate bonuses.

See `calculate_arena_power()` in Combat Mathematics section for implementation.

**Buff Sources (from PlayerCore):**

| Source | Buffs Used | Notes |
|--------|-----------|-------|
| **Research** | `research_attack_bps`, `research_defense_bps` | Combined for arena power |
| **Hero (cached)** | `hero_attack_bps`, `hero_defense_bps`, `hero_weapon_efficiency_bps`, `hero_armor_efficiency_bps` | From active heroes (3 slots) |
| **Location Synergy** | `slot_location_bonus[0..3]` | Heroes at home city get 1-10% boost |
| **Blessed Hero** | `blessed_hero_bonus_bps` | From Sanctuary meditation (+25% for 24h) |
| **Equipped Items** | `equipped_weapon_bonus_bps`, `equipped_armor_bonus_bps` | From Forge crafted equipment |

**Buff Sources (from EstateAccount):**

| Source | Buffs Used | Notes |
|--------|-----------|-------|
| **Building Buffs** | `attack_bps`, `defense_bps`, `pvp_damage_bps` | Permanent buffs from building levels |
| **Arena Building** | `pvp_damage_bps` | +0.5% per Arena building level |
| **Daily Mini-games** | `unit_effectiveness_bps`, `arena_damage_bps` | Temporary daily buffs |

**Arena-Specific Hero:**

If the player sets `arena_hero` in their loadout, that hero's AttackPower and DefensePower buffs are calculated directly from the HeroAccount at battle time (not from cached values). This allows using a specialized arena hero different from active heroes.

---

## Anti-Exploit Mechanisms

### 1. Rolling 24-Hour Battle Limit

Uses `count_battles_in_window()` to count battles in last 24 hours (not UTC day boundary).

Prevents timezone exploitation.

### 2. Opponent Diversity Requirement

Uses `count_unique_opponents_in_window()` to count unique opponents fought in last 24 hours.

Must fight 5+ unique opponents to claim daily reward.

### 3. Per-Opponent Cooldown

Uses `count_opponent_in_window()` to check battles vs specific opponent.

Max 2 battles vs same opponent per day prevents win trading.

### 4. Minimum Points for Leaderboard

```rust
fn update_arena_leaderboard(
    season: &mut ArenaSeasonAccount,
    player: Pubkey,
    total_points: u64,
) {
    // Must meet minimum threshold (default: 500 points)
    if total_points < season.min_points_for_leaderboard {
        return;
    }

    // Find or insert player in leaderboard
    // Maintain sorted order by total_points descending
}
```

Prevents sybil attacks where many accounts claim minimum positions.

### 5. Loadout Staleness Check

Loadouts must be re-validated every 24 hours. Checked at battle time via `last_validated` timestamp.

---

## Events (For Indexers)

### Battle Event

```rust
#[event]
pub struct ArenaBattleResolved {
    pub season_id: u32,
    pub battle_id: u64,
    pub challenger: Pubkey,
    pub defender: Pubkey,
    pub challenger_power: u64,
    pub defender_power: u64,
    pub challenger_won: bool,
    pub challenger_points: u64,
    pub defender_points: u64,
    pub new_challenger_elo: u32,
    pub new_defender_elo: u32,
    pub timestamp: i64,
    pub slot: u64,
}
```

### Season Events

```rust
#[event]
pub struct ArenaPlayerJoined {
    pub season_id: u32,
    pub player: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ArenaSeasonFinalized {
    pub season_id: u32,
    pub total_battles: u64,
    pub leaderboard_count: u8,
    pub timestamp: i64,
}

#[event]
pub struct ArenaDailyRewardClaimed {
    pub season_id: u32,
    pub player: Pubkey,
    pub amount: u64,
    pub battles_fought: u8,
    pub unique_opponents: u8,
    pub timestamp: i64,
}

#[event]
pub struct ArenaMasterRewardClaimed {
    pub season_id: u32,
    pub player: Pubkey,
    pub rank: u8,
    pub amount: u64,
    pub timestamp: i64,
}
```

---

## PDA Seeds

```rust
// Arena Season
["arena", city_id.to_le_bytes(), season_id.to_le_bytes()]

// Arena Participant (per player per season)
["arena_participant", season_id.to_le_bytes(), player.as_ref()]

// Arena Loadout (reusable across seasons)
["arena_loadout", player.as_ref()]
```

---

## Error Codes

```rust
pub enum ArenaError {
    // 8100 - 8149: Season Errors
    SeasonNotActive = 8100,
    SeasonAlreadyFinalized = 8101,
    SeasonExpired = 8102,
    SeasonNotEnded = 8103,
    SeasonNotFinalized = 8104,

    // 8150 - 8179: Participation Errors
    AlreadyJoinedSeason = 8150,
    NotInSeason = 8151,
    OpponentNotInSeason = 8152,
    MinimumLevelNotMet = 8153,

    // 8180 - 8199: Battle Errors
    DailyBattleLimitReached = 8180,
    CannotChallengeYourself = 8181,
    OpponentCooldownActive = 8182,
    MatchmakingRangeTooWide = 8183,
    LoadoutNotValidated = 8184,
    LoadoutStale = 8185,

    // 8200 - 8219: Loadout Errors
    InsufficientUnits = 8200,
    InsufficientWeapons = 8201,
    InsufficientArmor = 8202,
    HeroNotOwned = 8203,
    HeroLocked = 8204,
    HeroAccountRequired = 8205,
    HeroMismatch = 8206,
    LoadoutExceedsAssets = 8207,

    // 8220 - 8239: Reward Errors
    InsufficientBattlesForReward = 8220,
    InsufficientOpponentDiversity = 8221,
    DailyRewardAlreadyClaimed = 8222,
    DailyPoolExhausted = 8223,
    MasterRewardAlreadyClaimed = 8224,
    NotInTopTen = 8225,
    ClaimDeadlineExpired = 8226,
    ClaimDeadlineNotReached = 8227,
}
```

---

## Summary

The Arena PvP system provides:

| Feature | Implementation |
|---------|---------------|
| **Non-lethal Combat** | Power comparison, no asset loss |
| **Stateless Battles** | Computed inline, events emitted |
| **Weekly Seasons** | 7-day cycles, 30-day claim window |
| **Top 10 Leaderboard** | On-chain, minimum 500 points entry |
| **Dual Rewards** | Daily (5+ battles, 5+ opponents) + Master |
| **Rolling Daily Limit** | 10 battles per 24 hours (not midnight reset) |
| **Opponent Limits** | Max 2 vs same player per day |
| **ELO System** | Skill-based matchmaking and ranking |
| **Underdog Bonus** | Up to 2x points for beating stronger opponents |
| **Full Buff Integration** | Research, Hero, Estate, Equipment |
| **Loadout Validation** | 24-hour freshness, asset verification |
| **Sybil Resistance** | 500 point minimum for top 10 |
| **Event Emission** | Full battle history for indexers |
