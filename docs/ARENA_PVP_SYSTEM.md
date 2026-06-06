# Arena PvP System

## Overview

The Arena is a non-lethal competitive PvP mode where players battle for glory and rewards without losing their troops. Players accumulate points throughout a weekly season, with the top 10 players earning placement on the on-chain leaderboard and receiving master rewards.

### Core Philosophy

- **Fun First:** Arena is about determining strength and skill, not economic warfare
- **No Permanent Loss:** Troops, weapons, and equipment are never consumed or destroyed
- **Skill Expression:** Strategic hero selection, loadout optimization, and ELO-based matchmaking
- **Weekly Competition:** Fresh seasons keep competition dynamic
- **Tiered Rewards:** Daily participation rewards + weekly master rewards for top performers
- **Anti-Exploit:** Rolling battle limits, per-opponent cooldown, match-replay protection, and game-authority co-signed matchmaking prevent gaming (opponent diversity is enforced off-chain by the matchmaker)

---

## Design Principles

### Stateless Combat Resolution

Combat is resolved entirely within a single transaction. No `ArenaBattleAccount` is stored on-chain. Instead:

1. Compute combat outcome deterministically
2. Update participant stats
3. Emit event with full battle details
4. Indexers capture events for history/replays

This saves ~5000 lamports per battle and reduces complexity.

### Loadout Clamping (Non-Lethal Design)

Loadouts are **not** gated at configure time. There is no `validate_loadout` instruction and no `last_validated` staleness check, so `update_loadout` stores values verbatim and never fails. Instead, the guard lives at **battle time**: in `calculate_arena_power`, every loadout field's power contribution is clamped to the assets the player actually owns, `min(loadout_field, owned_field)`, for both the challenger and the defender.

This closes the phantom-army exploit (you cannot manufacture power you cannot back, so an inflated loadout wins nothing) while keeping the non-lethal, no-failure design (a stale loadout never fails the battle, it simply contributes the units still on hand). Nothing is consumed or destroyed; clamping only affects the power comparison. It stays cheap because the challenger/defender `PlayerAccount`s are already loaded for the power calculation.

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

Tracks the season state and the kingdom leaderboard. **Kingdom-scoped:** every season belongs to one `game_engine`. Pubkeys are `pinocchio::Address` (32 bytes).

```rust
pub const ARENA_SEASON_ACCOUNT_SIZE: usize = 608;

#[repr(C)]
pub struct ArenaSeasonAccount {
    pub account_key: u8,                          // 1 - AccountKey::ArenaSeason discriminator

    // Kingdom & Identity
    pub game_engine: Address,                     // 32 - Kingdom this season belongs to
    pub season_id: u32,                           // 4 - Incrementing season number
    pub city_id: u16,                             // 2 - Always 0 (kingdom-wide arena)
    pub authority: Address,                       // 32 - Who can admin / receives rent on close

    // Timing
    pub start_time: i64,                          // 8 - Unix timestamp
    pub end_time: i64,                            // 8 - start_time + 7 days
    pub claim_deadline: i64,                      // 8 - end_time + 30 days
    pub status: u8,                               // 1 - ArenaStatus (0=Pending,1=Active,2=Finalized,3=RewardsDistributed)

    // Leaderboard - Top 10 Only
    pub leaderboard: [ArenaLeaderboardEntry; 10], // 400 (10 × 40)
    pub leaderboard_count: u8,                    // 1
    pub leaderboard_claimed: [bool; 10],          // 10 - Track who claimed master reward

    // Prize Pool
    pub master_prize_pool: u64,                   // 8 - Total NOVI for top 10
    pub daily_prize_pool: u64,                    // 8 - Total NOVI for daily rewards
    pub daily_distribution_cap: u64,              // 8 - Max distributed per day
    pub distributed_today: u64,                   // 8 - Tracks today's distributions
    pub last_distribution_day: u32,               // 4 - Day number for reset
    pub _padding1: [u8; 4],                       // 4 - Alignment padding
    pub prize_remaining: u64,                     // 8 - Unclaimed master prize

    // Thresholds
    pub min_level_required: u8,                   // 1 - Minimum player level to join
    pub _padding2: [u8; 7],                       // 7 - Alignment padding
    pub min_points_for_leaderboard: u64,          // 8 - Prevents sybil attacks (default: 500)
    pub total_battles: u64,                       // 8 - Counter for stats / battle_id
    pub bump: u8,                                 // 1 - PDA bump
    pub _reserved: [u8; 7],                       // 7 - Future use
}

#[repr(C)]
pub struct ArenaLeaderboardEntry {
    pub player: Address,                          // 32 bytes
    pub total_points: u64,                        // 8 bytes
}                                                 // Total: 40 bytes
```

**Size:** 608 bytes (`repr(C)` with alignment padding; enforced by a compile-time `size_of` assertion in `state/arena.rs`).

**Status transitions:** seasons are created directly as `Active`. The `Active → Finalized` transition happens lazily inside `claim_master_reward` (see Lifecycle). There is no separate finalize instruction.

---

### ArenaParticipantAccount

Per-player, per-season state tracking. **Kingdom-scoped** (carries `game_engine`). Derived stats are computed from `battle_opponents` / `battle_timestamps` at runtime; the `player` field stores the **PlayerAccount PDA** (not the wallet).

```rust
pub const ARENA_PARTICIPANT_ACCOUNT_SIZE: usize = 536;

#[repr(C)]
pub struct ArenaParticipantAccount {
    pub account_key: u8,                         // 1 - AccountKey::ArenaParticipant discriminator

    // Identity
    pub game_engine: Address,                    // 32 - Kingdom reference
    pub player: Address,                         // 32 - PlayerAccount PDA
    pub season_id: u32,                          // 4

    // Daily Battle Tracking - Rolling Window
    pub battle_timestamps: [i64; 10],            // 80 - Circular buffer of last 10 battle times
    pub battle_opponents: [Address; 10],         // 320 - Who we fought (for diversity + cooldown checks)
    pub battle_index: u8,                        // 1 - Current index in circular buffer

    // Matchmaking
    pub last_match_id: u64,                      // 8 - Prevents match replay attacks
    pub daily_reward_claimed_day: u32,           // 4 - Which day was last claim

    // Skill Rating
    pub elo_rating: u32,                         // 4 - Starts at 1000

    // Season Statistics
    pub total_points: u64,                       // 8 - Saturating, never wraps
    pub wins: u32,                               // 4 - Season cumulative wins (for daily reward calc)
    pub losses: u32,                             // 4 - Season cumulative losses

    // Claim Tracking
    pub master_reward_claimed: bool,             // 1
    pub bump: u8,                                // 1 - PDA bump

    pub _reserved: [u8; 17],                     // 17 - alignment + future use
}
```

**Size:** 536 bytes (`repr(C)`; packed fields total 520, padding to 536 for i64 alignment; enforced by a compile-time `size_of` assertion).

**Derived from `battle_opponents` at runtime:**
- `unique_opponents_today`: Count unique pubkeys in window within last 24h
- `opponent_battle_count`: Count occurrences of specific pubkey in window within last 24h

**Season Cumulative Win Rate:**
- `wins` and `losses` track the entire season's performance
- Used for daily reward calculation - rewards consistent daily play
- If you skip a day, you miss out on building your win count

---

### ArenaLoadoutAccount

Stores the player's arena-specific **choices** only. Power is computed at battle time. **Kingdom-scoped** and reusable across seasons (one loadout per player per kingdom). `player` stores the **PlayerAccount PDA**.

There is **no `last_validated` field and no validation timestamp.** Configure-time values are stored verbatim; the asset check happens at battle time, where each field is clamped to `min(loadout, owned)` in `calculate_arena_power` (see Design Principles / Loadout Clamping). A loadout that exceeds the player's real assets therefore contributes only what they own.

```rust
pub const ARENA_LOADOUT_ACCOUNT_SIZE: usize = 168;

#[repr(C)]
pub struct ArenaLoadoutAccount {
    pub account_key: u8,                          // 1 - AccountKey::ArenaLoadout discriminator

    // Identity
    pub game_engine: Address,                     // 32 - Kingdom reference
    pub player: Address,                          // 32 - PlayerAccount PDA
    pub bump: u8,                                 // 1 - PDA bump

    // Hero Selection
    pub arena_hero: Address,                      // 32 - Hero NFT mint (default = use active heroes)

    // Unit Loadout (defensive units only)
    pub defensive_units: [u64; 3],                // 24 - Tier 1, 2, 3 defensive units

    // Equipment Loadout
    pub melee_weapons: u64,                       // 8
    pub ranged_weapons: u64,                      // 8
    pub siege_weapons: u64,                       // 8
    pub armor_pieces: u64,                        // 8

    pub _reserved: [u8; 7],                       // 7 - future use
}
```

**Size:** 168 bytes (`repr(C)`; packed fields total 160, padding to 168 for u64 alignment; enforced by a compile-time `size_of` assertion).

**Computed at battle time:**
- Power → from defensive units + weapons + armor + PlayerCore buffs + Hero NFT + EstateAccount
- Winner determined by power comparison (no health system)

---

## Instructions

### Instruction Discriminants

The arena occupies discriminants **230–236** (single `u8` tag, dispatched in `lib.rs`). There is **no** separate `validate_loadout`, `finalize_season`, or `redistribute_unclaimed` instruction.

```rust
230 => arena::create_season::process
231 => arena::join_season::process
232 => arena::update_loadout::process
233 => arena::challenge_player::process
234 => arena::claim_daily_reward::process
235 => arena::claim_master_reward::process
236 => arena::close_season::process
```

The SDK mirrors these exactly (`DISCRIMINATORS.ARENA_CREATE_SEASON = 230` … `ARENA_CLOSE_SEASON = 236` in `src/program.ts`).

---

### 230: Create Season

Creates a new arena season for a kingdom. **Permissioned:** the signer must equal `game_engine.game_authority` (DAO). The season is created directly as `Active`. `city_id` is hard-coded to `0` (kingdom-wide arena). `min_points_for_leaderboard` is **not** an argument; it is set to the `ARENA_MIN_POINTS_FOR_LEADERBOARD` constant (500).

**Instruction data (29 bytes):**
```rust
season_id: u32,                  // explicit season number (next id for the kingdom)
master_prize_pool: u64,
daily_prize_pool: u64,
daily_distribution_cap: u64,     // max distributed per day
min_level_required: u8,
```

**Accounts (exact, 4):**
- `[writable]` arena_season (PDA: `["arena_season", game_engine, u32(season_id)]`)
- `[signer, writable]` authority (must be `game_engine.game_authority`, pays rent)
- `[]` game_engine
- `[]` system_program

**Logic:**
```rust
fn create_season(season_id, master_prize_pool, daily_prize_pool,
                 daily_distribution_cap, min_level_required) -> Result<()> {
    require!(authority == game_engine.game_authority, Unauthorized);
    require!(arena_season.is_data_empty(), ArenaSeasonAlreadyExists);

    let now = Clock::get()?.unix_timestamp;
    season.game_engine     = *game_engine;
    season.season_id       = season_id;
    season.city_id         = 0;                                   // kingdom-wide
    season.authority       = authority;
    season.start_time      = now;
    season.end_time        = now + ARENA_SEASON_DURATION;          // 7 days
    season.claim_deadline  = end_time + ARENA_CLAIM_DEADLINE;      // +30 days
    season.status          = ArenaStatus::Active;
    season.master_prize_pool = master_prize_pool;
    season.prize_remaining   = master_prize_pool;
    season.daily_prize_pool  = daily_prize_pool;
    season.daily_distribution_cap = daily_distribution_cap;
    season.last_distribution_day  = now / SECONDS_PER_DAY;
    season.min_level_required     = min_level_required;
    season.min_points_for_leaderboard = ARENA_MIN_POINTS_FOR_LEADERBOARD; // 500

    emit!(KingdomArenaSeasonStarted { kingdom_id, game_engine, season_id,
                                      start_time, end_time, prize_pool: master_prize_pool });
    Ok(())
}
```

---

### 231: Join Season

Player joins the current arena season. Creates the participant account and, if it does not already exist, the loadout account (loadouts are reusable across seasons within the kingdom).

**Instruction data (4 bytes):** `season_id: u32`

**Accounts (exact, 6):**
- `[writable]` arena_season
- `[writable]` participant_account (PDA: `["arena_participant", game_engine, u32(season_id), player_pda]`)
- `[writable]` loadout_account (PDA: `["arena_loadout", game_engine, player_pda]`, created if empty)
- `[]` player_account
- `[signer, writable]` player_authority (wallet, pays rent)
- `[]` system_program

**Validation:**
- `player_authority` owns `player_account`
- Player level >= `season.min_level_required` (else `InsufficientLevel`)
- Season status == Active (`ArenaSeasonNotActive`)
- Season not expired, `now < end_time` (`ArenaSeasonExpired`)
- Participant account does not already exist (`ArenaParticipantAlreadyExists`)

**Logic:**
```rust
fn join_season(season_id) -> Result<()> {
    // ... level / status / expiry / dedup checks ...
    *participant = ArenaParticipantAccount {
        game_engine,
        player: player_pda,
        season_id,
        elo_rating: ARENA_STARTING_ELO, // 1000
        // remaining fields zero-initialized
        ..
    };
    emit!(ArenaPlayerJoined { season_id, player: player_pda, timestamp: now });

    if loadout_account.is_data_empty() {
        // create + zero-init loadout (arena_hero = default, all unit/equipment counts = 0)
    }
    Ok(())
}
```

---

### 232: Update Loadout

Player configures their arena loadout. **No asset validation** is performed here; the values are stored verbatim. The asset check is deferred to battle time, where `calculate_arena_power` clamps each field to `min(loadout, owned)` (see Design Principles / Loadout Clamping). Hero ownership is also not checked here; the hero NFT is only verified at battle time in `challenge_player`.

**Instruction data (88 bytes):**
```rust
arena_hero: Address,         // 32 - hero NFT mint, or default for "use active heroes"
defensive_units: [u64; 3],   // 24
melee_weapons: u64,          // 8
ranged_weapons: u64,         // 8
siege_weapons: u64,          // 8
armor_pieces: u64,           // 8
```

**Accounts (exact, 2):**
- `[writable]` loadout_account
- `[signer]` player_authority

**Logic:**
```rust
fn update_loadout(arena_hero, defensive_units, melee, ranged, siege, armor) -> Result<()> {
    // Loadout is loaded by stored key; re-derive the player PDA from
    // (loadout.game_engine, player_authority) and require it matches loadout.player.
    require!(loadout.player == PlayerCore::derive_pda(loadout.game_engine, player_authority),
             Unauthorized);

    loadout.arena_hero      = arena_hero;
    loadout.defensive_units = defensive_units;
    loadout.melee_weapons   = melee;
    loadout.ranged_weapons  = ranged;
    loadout.siege_weapons   = siege;
    loadout.armor_pieces    = armor;
    Ok(())
}
```

---

### 233: Challenge Player (Main Battle Instruction)

Initiate and resolve a battle against another player in a single transaction. Winner determined by power comparison.

**Off-Chain Matchmaking Required:** The `game_authority` must sign to validate the match. This prevents:
- Collusion (two players farming points off each other)
- Target selection abuse (always picking weak opponents)
- Sybil attacks (fighting your own alt accounts)

The off-chain matchmaker ensures fair opponent selection based on ELO range, recent opponents, and queue order.

**Instruction data (20 bytes):**
```rust
match_id: u64,           // 8 - unique match ID from matchmaker (prevents replay)
match_timestamp: i64,    // 8 - when match was assigned (expires after 5 min)
season_id: u32,          // 4 - season ID for PDA derivation
```

**Accounts (exact, 14):**
- `[signer]` challenger_authority
- `[signer]` game_authority (must equal `game_engine.game_authority`)
- `[]` game_engine
- `[]` challenger_player
- `[writable]` challenger_participant
- `[]` challenger_loadout
- `[]` challenger_hero (Metaplex Core hero NFT; only inspected if `loadout.arena_hero` is set)
- `[]` challenger_estate (optional; estate buffs applied only if program-owned)
- `[]` defender_player
- `[writable]` defender_participant
- `[]` defender_loadout
- `[]` defender_hero (same as challenger)
- `[]` defender_estate (optional)
- `[writable]` arena_season

**Pre-Battle Validation (inline; real GameError variants):**
```rust
// game_authority must match the kingdom's authority
require!(game_authority == game_engine.game_authority, Unauthorized);

// Season identity + state (loaded by (game_engine, season_id) PDA)
require!(season.season_id == season_id, InvalidParameter);
require!(season.status == ArenaStatus::Active, ArenaSeasonNotActive);
require!(now < season.end_time, ArenaSeasonExpired);

// Prevent match replay - match_id must be strictly greater than last used
require!(match_id > challenger.last_match_id, ArenaMatchAlreadyUsed);

// Match assignment must be fresh (reject future timestamps first to avoid underflow)
require!(match_timestamp <= now, ArenaMatchTimestampInvalid);
require!(now - match_timestamp <= ARENA_MATCH_EXPIRY_SECONDS, ArenaMatchExpired); // 300s

// Cannot challenge self (compared by wallet authority)
require!(challenger_authority != defender_authority, ArenaCannotChallengeYourself);

// NOTE: no loadout validation - arena is non-lethal, loadout values are trusted.

// Rolling 24-hour battle limit (10 battles per 24h)
require!(challenger.count_battles_in_window(now, SECONDS_PER_DAY) < ARENA_MAX_DAILY_BATTLES,
         ArenaDailyBattleLimitReached);

// Per-opponent cooldown - max 2 battles vs same opponent per 24h
require!(challenger.count_opponent_in_window(&defender.player, now, SECONDS_PER_DAY)
            < ARENA_MAX_BATTLES_PER_OPPONENT,
         ArenaOpponentCooldownActive);

// Hero NFTs are verified only when the loadout sets arena_hero:
//   - the passed hero account key must equal loadout.arena_hero (else ArenaHeroMismatch)
//   - parse_hero_nft must succeed (else ArenaHeroAccountRequired)
// (No is_locked / NotInSeason / OpponentNotInSeason gates exist in the shipped code.)
```

**Combat Resolution** (saturating math throughout; `record_battle` is a method on the participant):
```rust
fn challenge_player(match_id, match_timestamp, season_id) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    // ... all the pre-battle validation above ...

    // Power computed at battle time for both players
    let challenger_power = calculate_arena_power(&challenger_loadout, &challenger_player,
                                                challenger_hero, challenger_estate, program_id);
    let defender_power   = calculate_arena_power(&defender_loadout, &defender_player,
                                                defender_hero, defender_estate, program_id);

    let challenger_won = challenger_power > defender_power;
    let is_draw        = challenger_power == defender_power;

    let (challenger_points, defender_points) =
        calculate_battle_points(challenger_won, is_draw, challenger_power, defender_power);
    let (new_challenger_elo, new_defender_elo) =
        update_elo(challenger_part.elo_rating, defender_part.elo_rating, challenger_won, is_draw);

    // Challenger (season-cumulative)
    challenger_part.last_match_id = match_id; // replay guard
    challenger_part.total_points  = challenger_part.total_points.saturating_add(challenger_points);
    challenger_part.elo_rating    = new_challenger_elo;
    if challenger_won { challenger_part.wins = challenger_part.wins.saturating_add(1); }
    else if !is_draw  { challenger_part.losses = challenger_part.losses.saturating_add(1); }
    challenger_part.record_battle(defender_part.player, now);

    // Defender (season-cumulative)
    defender_part.total_points = defender_part.total_points.saturating_add(defender_points);
    defender_part.elo_rating   = new_defender_elo;
    if !challenger_won && !is_draw { defender_part.wins = defender_part.wins.saturating_add(1); }
    else if challenger_won         { defender_part.losses = defender_part.losses.saturating_add(1); }
    defender_part.record_battle(challenger_part.player, now);

    season.total_battles = season.total_battles.saturating_add(1);
    season.update_leaderboard(challenger_part.player, challenger_part.total_points);
    season.update_leaderboard(defender_part.player, defender_part.total_points);

    let slot = Clock::get()?.slot; // fetched once, for the event only
    emit!(ArenaBattleResolved {
        season_id, battle_id: season.total_battles,
        challenger: challenger_part.player, defender: defender_part.player,
        challenger_power, defender_power, challenger_won,
        challenger_points, defender_points,
        new_challenger_elo, new_defender_elo, timestamp: now, slot,
    });
    Ok(())
}
```

---

### 234: Claim Daily Reward

Claim the daily participation reward. **Permissionless** (anyone can crank it for a player). The reward is **minted** as NOVI into the player's NOVI token account and also credited to `player.locked_novi`. There is **no unique-opponent gate** in the shipped code: only the minimum-battles requirement is enforced; `unique_opponents` is computed solely for the emitted event.

**Instruction data (4 bytes):** `season_id: u32`

**Accounts (exact, 8):**
- `[writable]` participant_account
- `[writable]` arena_season
- `[writable]` player_account (receives locked_novi)
- `[]` player_owner (wallet that owns the player account)
- `[writable]` player_novi_ata (must be owned by the PlayerAccount PDA)
- `[writable]` novi_mint (must equal `NOVI_MINT_ADDRESS`)
- `[]` game_engine (mint authority)
- `[]` token_program

**Validation & Logic:**
```rust
fn claim_daily_reward(season_id) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let today = (now / SECONDS_PER_DAY) as u32;

    require!(season.status == ArenaStatus::Active, ArenaSeasonNotActive);
    season.check_and_reset_daily(today);

    let remaining_today = season.daily_distribution_cap.saturating_sub(season.distributed_today);
    require!(remaining_today > 0, ArenaDailyPoolExhausted);

    // Already claimed today? (exact-day compare, not <)
    require!(participant.daily_reward_claimed_day != today, ArenaDailyRewardAlreadyClaimed);

    // Minimum battles in rolling 24h window (5). NO unique-opponent gate.
    let battles_today = participant.count_battles_in_window(now, SECONDS_PER_DAY);
    require!(battles_today >= ARENA_MIN_BATTLES_FOR_DAILY_REWARD, ArenaMinBattlesNotMet);

    let base_reward = calculate_daily_reward(battles_today, participant.wins, participant.losses);
    let actual_reward = base_reward.min(remaining_today).min(season.daily_prize_pool);

    let unique_opponents = participant.count_unique_opponents_in_window(now, SECONDS_PER_DAY); // event only

    participant.daily_reward_claimed_day = today;
    season.distributed_today = season.distributed_today.saturating_add(actual_reward);
    season.daily_prize_pool  = season.daily_prize_pool.saturating_sub(actual_reward);

    mint_tokens(novi_mint, player_novi_ata, game_engine /* authority */, actual_reward, ...);
    player.locked_novi = player.locked_novi.saturating_add(actual_reward);

    emit!(ArenaDailyRewardClaimed { season_id, player: participant.player,
            amount: actual_reward, battles_fought: battles_today, unique_opponents, timestamp: now });
    Ok(())
}
```

---

### 235: Claim Master Reward

Claim the end-of-season reward (leaderboard top 10 only). **Permissionless.** Like the daily reward, NOVI is **minted** into the player's token account and credited to `locked_novi`. This instruction also performs the **lazy finalization** of the season (see Lifecycle).

**Instruction data (4 bytes):** `season_id: u32`

**Accounts (exact, 8):**
- `[writable]` participant_account
- `[writable]` arena_season
- `[writable]` player_account (receives locked_novi)
- `[]` player_owner
- `[writable]` player_novi_ata (must be owned by the PlayerAccount PDA)
- `[writable]` novi_mint (must equal `NOVI_MINT_ADDRESS`)
- `[]` game_engine (mint authority)
- `[]` token_program

**Logic:**
```rust
fn claim_master_reward(season_id) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    // LAZY FINALIZE: Active -> Finalized once end_time has passed (permissionless).
    if season.status == ArenaStatus::Active && now > season.end_time {
        season.status = ArenaStatus::Finalized;
        emit!(ArenaSeasonFinalized { season_id, total_battles: season.total_battles,
                                     leaderboard_count: season.leaderboard_count, timestamp: now });
    }

    require!(season.status >= ArenaStatus::Finalized, ArenaSeasonNotFinalized);
    require!(now <= season.claim_deadline, ArenaClaimDeadlinePassed);
    require!(!participant.master_reward_claimed, ArenaMasterRewardAlreadyClaimed);

    // Find rank (0-based index) on the leaderboard
    let rank_idx = season.leaderboard[..season.leaderboard_count]
        .iter().position(|e| e.player == participant.player)
        .ok_or(ArenaNotOnLeaderboard)?;
    require!(!season.leaderboard_claimed[rank_idx], ArenaMasterRewardAlreadyClaimed);

    // Reward = master_prize_pool * ARENA_PRIZE_DISTRIBUTION[rank_idx] / 10_000
    let reward = season.master_prize_pool.saturating_mul(ARENA_PRIZE_DISTRIBUTION[rank_idx] as u64) / 10_000;

    participant.master_reward_claimed   = true;
    season.leaderboard_claimed[rank_idx] = true;
    season.prize_remaining = season.prize_remaining.saturating_sub(reward);

    mint_tokens(novi_mint, player_novi_ata, game_engine /* authority */, reward, ...);
    player.locked_novi = player.locked_novi.saturating_add(reward);

    emit!(ArenaMasterRewardClaimed { season_id, player: participant.player,
            rank: (rank_idx as u8) + 1 /* 1-based */, amount: reward, timestamp: now });
    Ok(())
}
```

There is **no escrow.** Rewards are minted on demand at claim time, so a season holds no unclaimed pot to redistribute. `prize_remaining` is a bookkeeping counter only; closing a season simply discards it.

---

### 236: Close Season

Closes a finished season account and returns its rent to `season.authority`. **Permissionless.** This is the rent-reclaim half of the season-rollover crank; there is no `redistribute_unclaimed` instruction.

**Instruction data (6 bytes):** `season_id: u32`, `city_id: u16`

**Accounts (exact, 3):**
- `[writable]` arena_season (closed)
- `[]` city_account (read for current `arena_season_id`)
- `[writable]` season_authority (must equal `season.authority`, receives the rent)

**Logic:**
```rust
fn close_season(season_id, city_id) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(city.city_id == city_id && season.season_id == season_id
             && season.city_id == city_id, InvalidParameter);
    require!(season_authority == season.authority, Unauthorized);

    // Closeable if past the claim deadline OR at least 4 seasons behind current.
    let past_deadline   = now > season.claim_deadline;
    let seasons_behind  = city.arena_season_id.saturating_sub(season_id) >= SEASONS_BEHIND_FOR_AUTO_CLOSE; // 4
    require!(past_deadline || seasons_behind, ArenaUnclaimedRedistributionTooEarly);

    close_account(arena_season, season_authority); // rent -> authority
    Ok(())
}
```

---

## Combat Mathematics

### Constants

These are the real values from `programs/novus_mundus/src/constants.rs` (Arena PvP section). The defensive-unit power constants (`DEFENSIVE_UNIT_{1,2,3}_POWER`) are shared with the main combat system and live elsewhere in `constants.rs`.

```rust
// PDA seeds (all kingdom-scoped)
pub const ARENA_SEASON_SEED: &[u8]      = b"arena_season";
pub const ARENA_PARTICIPANT_SEED: &[u8] = b"arena_participant";
pub const ARENA_LOADOUT_SEED: &[u8]     = b"arena_loadout";

// Timing
pub const SECONDS_PER_DAY: i64       = 86_400;
pub const ARENA_SEASON_DURATION: i64 = 7 * SECONDS_PER_DAY;   // 7 days
pub const ARENA_CLAIM_DEADLINE: i64  = 30 * SECONDS_PER_DAY;  // +30 days after end
pub const ARENA_MATCH_EXPIRY_SECONDS: i64 = 300;             // 5 minutes

// Battle limits
pub const ARENA_MAX_DAILY_BATTLES: u8           = 10;
pub const ARENA_MAX_BATTLES_PER_OPPONENT: u8    = 2;
pub const ARENA_MIN_BATTLES_FOR_DAILY_REWARD: u8 = 5;
// NOTE: there is NO minimum-unique-opponents constant; that gate was removed.

// ELO (integer approximation - see ELO Rating System)
pub const ARENA_STARTING_ELO: u32 = 1000;
pub const ARENA_ELO_K_FACTOR: u32 = 32;
// ELO floor is a literal 100 in update_elo's clamp (no named constant).

// Points
pub const ARENA_BASE_WIN_POINTS: u64  = 100;
pub const ARENA_BASE_LOSS_POINTS: u64 = 20;  // participation points for the loser
pub const ARENA_DRAW_POINTS: u64      = 50;  // both players on a draw
pub const ARENA_UNDERDOG_BONUS_BPS: u64 = 500; // 5% bonus per 10% power disadvantage
pub const ARENA_MIN_POINTS_FOR_LEADERBOARD: u64 = 500;

// Rewards
pub const ARENA_DAILY_BASE_REWARD: u64 = 1000; // 100 NOVI (1 decimal)

// Equipment power values (arena-specific)
pub const ARENA_MELEE_WEAPON_POWER: u64  = 10;
pub const ARENA_RANGED_WEAPON_POWER: u64 = 16; // phi ratio
pub const ARENA_SIEGE_WEAPON_POWER: u64  = 26; // phi^2 ratio
pub const ARENA_ARMOR_POWER: u64         = 5;

// Master prize distribution (basis points, must sum to 10_000)
pub const ARENA_PRIZE_DISTRIBUTION: [u16; 10] =
    [3500, 2500, 1500, 750, 750, 200, 200, 200, 200, 200];

// Defensive unit power (shared with main combat, defined elsewhere in constants.rs)
// DEFENSIVE_UNIT_1_POWER / DEFENSIVE_UNIT_2_POWER / DEFENSIVE_UNIT_3_POWER
```

> Changes from the old spec: loss points are **20** (not 0), draw points are **50** (not 25), ranged/siege/armor power are **16 / 26 / 5** (not 20 / 50 / 15), the daily base reward is **1000** raw units (100 NOVI), and the ELO floor is a literal `100` clamp with no separate `ELO_FLOOR` / `MIN_UNIQUE_OPPONENTS` constant.

---

### Power Calculation

Total arena power is computed at battle time from loadout + player buffs, using all existing combat buffs from `PlayerAccount` (PlayerCore) plus an optional arena hero NFT and an optional `EstateAccount`. All arithmetic is `saturating_*`. The hero and estate are passed as raw `AccountView`s (not typed `Option`s); they are only consulted opportunistically.

```rust
fn calculate_arena_power(
    loadout: &ArenaLoadoutAccount,
    player: &PlayerAccount,
    hero_account: &AccountView,    // Metaplex Core hero NFT (parsed only if loadout.arena_hero set)
    estate_account: &AccountView,  // EstateAccount (used only if program-owned + right size)
    program_id: &Address,
) -> u64 {
    // Base power from defensive units (DEFENSIVE_UNIT_*_POWER shared with main combat)
    let unit_power = loadout.defensive_units[0].saturating_mul(DEFENSIVE_UNIT_1_POWER)
        .saturating_add(loadout.defensive_units[1].saturating_mul(DEFENSIVE_UNIT_2_POWER))
        .saturating_add(loadout.defensive_units[2].saturating_mul(DEFENSIVE_UNIT_3_POWER));

    // Equipment power (arena-specific constants: 10 / 16 / 26 / 5)
    let equipment_power = loadout.melee_weapons.saturating_mul(ARENA_MELEE_WEAPON_POWER)
        .saturating_add(loadout.ranged_weapons.saturating_mul(ARENA_RANGED_WEAPON_POWER))
        .saturating_add(loadout.siege_weapons.saturating_mul(ARENA_SIEGE_WEAPON_POWER))
        .saturating_add(loadout.armor_pieces.saturating_mul(ARENA_ARMOR_POWER));

    let base_power = unit_power.saturating_add(equipment_power);

    // Cached PlayerCore buffs (accessors, all bps): research attack+defense,
    // hero attack/defense/weapon_eff/armor_eff, slot_location_bonus[0..3],
    // blessed_hero_bonus, equipped_weapon+armor bonus.
    let research_bonus_bps = player.research_attack_bps() as u64
        + player.research_defense_bps() as u64;
    let hero_bonus_bps = player.hero_attack_bps() as u64 + player.hero_defense_bps() as u64
        + player.hero_weapon_efficiency_bps() as u64 + player.hero_armor_efficiency_bps() as u64;
    let location_bonus_bps = player.slot_location_bonus_at(0) as u64
        + player.slot_location_bonus_at(1) as u64 + player.slot_location_bonus_at(2) as u64;
    let blessed_bonus_bps  = player.blessed_hero_bonus_bps() as u64;
    let equipped_bonus_bps = player.equipped_weapon_bonus_bps() as u64
        + player.equipped_armor_bonus_bps() as u64;

    // Arena-specific hero: parse the NFT and sum AttackPower(1)+DefensePower(2) buffs.
    let arena_hero_bonus_bps = if loadout.arena_hero != Address::default() {
        parse_hero_nft(&hero_account.try_borrow()?)            // returns 0 if unparseable
            .map(|h| sum_attack_defense_buffs(&h)).unwrap_or(0)
    } else { 0 };

    // Estate buffs: only if the estate account is owned by this program and large enough.
    let estate_bonus_bps = if estate_account.owner() == program_id {
        let e = /* cast EstateAccount */;
        e.attack_bps as u64 + e.defense_bps as u64 + e.pvp_damage_bps as u64
            + e.unit_effectiveness_bps as u64 + e.arena_damage_bps as u64
    } else { 0 };

    let total_bonus_bps = research_bonus_bps + hero_bonus_bps + location_bonus_bps
        + blessed_bonus_bps + equipped_bonus_bps + arena_hero_bonus_bps + estate_bonus_bps;

    // base_power × (1 + total_bonus_bps / 10_000)
    base_power.saturating_mul(10_000u64.saturating_add(total_bonus_bps)) / 10_000
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

The shipped code is **integer-only** (no floats). The winner always gets `ARENA_BASE_WIN_POINTS` (100); the loser always gets `ARENA_BASE_LOSS_POINTS` (20, participation); a draw gives both `ARENA_DRAW_POINTS` (50). An underdog bonus is added **only when the winner had less power than the loser**, scaled by the power disadvantage (capped at 50%).

```rust
fn calculate_battle_points(
    challenger_won: bool,
    is_draw: bool,
    challenger_power: u64,
    defender_power: u64,
) -> (u64, u64) {
    if is_draw {
        return (ARENA_DRAW_POINTS, ARENA_DRAW_POINTS); // (50, 50)
    }

    let (winner_power, loser_power) = if challenger_won {
        (challenger_power, defender_power)
    } else {
        (defender_power, challenger_power)
    };

    // Underdog bonus only if the winner was the weaker side.
    let winner_points = if winner_power < loser_power {
        // disadvantage in bps, capped at 5000 (50%). u128 intermediate avoids overflow.
        let disadvantage_bps = if loser_power > 0 {
            (((loser_power - winner_power) as u128 * 10_000) / loser_power as u128).min(5000) as u64
        } else { 0 };
        // bonus = base * disadvantage_bps * ARENA_UNDERDOG_BONUS_BPS / (10_000 * 1000)
        let underdog_bonus = ARENA_BASE_WIN_POINTS
            .saturating_mul(disadvantage_bps)
            .saturating_mul(ARENA_UNDERDOG_BONUS_BPS) / (10_000 * 1000);
        ARENA_BASE_WIN_POINTS.saturating_add(underdog_bonus)
    } else {
        ARENA_BASE_WIN_POINTS
    };

    if challenger_won {
        (winner_points, ARENA_BASE_LOSS_POINTS)
    } else {
        (ARENA_BASE_LOSS_POINTS, winner_points)
    }
}
```

### Points & Underdog Bonus Table

| Outcome | Winner points | Loser points |
|---------|---------------|--------------|
| Draw | 50 | 50 (both) |
| Win, winner stronger/equal | 100 | 20 |
| Win as underdog, 10% weaker | 100 + ~5 = 105 | 20 |
| Win as underdog, 30% weaker | 100 + ~15 = 115 | 20 |
| Win as underdog, 50%+ weaker (capped) | 100 + 25 = 125 | 20 |

The bonus formula yields `+5%` of base win points per 10% of power disadvantage, so at the 50% cap the underdog earns +25 points (125 total).

---

### Helper Functions

These are **methods on `ArenaParticipantAccount`** (in `state/arena.rs`), operating on the participant's own `battle_timestamps` / `battle_opponents` circular buffers. They use saturating subtraction for the cutoff and `Address` (not `Pubkey`).

```rust
impl ArenaParticipantAccount {
    fn record_battle(&mut self, opponent: Address, timestamp: i64) {
        self.battle_timestamps[self.battle_index as usize] = timestamp;
        self.battle_opponents[self.battle_index as usize] = opponent;
        self.battle_index = (self.battle_index + 1) % 10;
    }

    fn count_battles_in_window(&self, now: i64, window: i64) -> u8 {
        let cutoff = now.saturating_sub(window);
        self.battle_timestamps.iter().filter(|&&t| t > cutoff).count() as u8
    }

    fn count_opponent_in_window(&self, opponent: &Address, now: i64, window: i64) -> u8 {
        let cutoff = now.saturating_sub(window);
        (0..10).filter(|&i| self.battle_timestamps[i] > cutoff
                           && &self.battle_opponents[i] == opponent).count() as u8
    }

    // Computed for the daily-reward EVENT only; not used as a gate.
    fn count_unique_opponents_in_window(&self, now: i64, window: i64) -> u8 { /* dedup scan */ }
}
```

---

## ELO Rating System

### ELO Update Formula

The shipped `update_elo` does **not** use floats. It approximates the expected score with an **integer lookup table** keyed on the absolute ELO difference, scores on a 0/50/100 scale, applies the K-factor, and clamps to a floor of **100** (a literal, no `ELO_FLOOR` constant).

```rust
fn update_elo(challenger_elo: u32, defender_elo: u32,
              challenger_won: bool, is_draw: bool) -> (u32, u32) {
    let diff = defender_elo as i64 - challenger_elo as i64;

    // Integer approximation of the challenger's expected score (0-100):
    let challenger_expected = match diff.abs() {
        0..=50   => 50,
        51..=100 => if diff > 0 { 36 } else { 64 },
        101..=200=> if diff > 0 { 24 } else { 76 },
        201..=300=> if diff > 0 { 15 } else { 85 },
        _        => if diff > 0 {  9 } else { 91 },
    };
    let defender_expected = 100 - challenger_expected;

    let (c_actual, d_actual) = if is_draw { (50, 50) }
        else if challenger_won { (100, 0) } else { (0, 100) };

    // delta = K * (actual - expected) / 100
    let c_delta = (ARENA_ELO_K_FACTOR as i64 * (c_actual - challenger_expected)) / 100;
    let d_delta = (ARENA_ELO_K_FACTOR as i64 * (d_actual - defender_expected)) / 100;

    let new_c = (challenger_elo as i64 + c_delta).clamp(100, u32::MAX as i64) as u32;
    let new_d = (defender_elo as i64 + d_delta).clamp(100, u32::MAX as i64) as u32;
    (new_c, new_d)
}
```

### ELO Expected-Score Table (integer approximation)

The lookup brackets the favorite's win probability rather than computing the exact logistic curve. The favorite (lower-rated player when `diff > 0` is the challenger's opponent) is read as:

| ELO Difference | Approx favorite expected score |
|----------------|--------------------------------|
| 0–50 | 50% |
| 51–100 | 64% |
| 101–200 | 76% |
| 201–300 | 85% |
| 301+ | 91% |

---

## Reward Distribution

### Daily Reward Calculation

```rust
// ARENA_DAILY_BASE_REWARD = 1000 raw units = 100 NOVI (1 decimal)

fn calculate_daily_reward(battles_fought_today: u8, season_wins: u32, season_losses: u32) -> u64 {
    // Scale by battles fought TODAY (5-10 maps to 0.5x-1.0x of base)
    let battle_multiplier = (battles_fought_today as u64).saturating_mul(10_000)
                                / ARENA_MAX_DAILY_BATTLES as u64;

    // Win rate bonus based on SEASON CUMULATIVE performance (floored at 50%)
    let total = season_wins.saturating_add(season_losses);
    let win_rate_bps = if total > 0 {
        ((season_wins as u64).saturating_mul(10_000) / total as u64).max(5000)
    } else {
        5000 // No battles yet = neutral 50%
    };
    let win_bonus = win_rate_bps.saturating_sub(5000); // 0-5000 bonus bps

    let reward = ARENA_DAILY_BASE_REWARD.saturating_mul(battle_multiplier) / 10_000;
    let bonus  = reward.saturating_mul(win_bonus) / 10_000;
    reward.saturating_add(bonus)
}
```

**Daily Reward Examples** (raw units; divide by 10 for NOVI). The final paid amount is additionally capped by the season's remaining daily cap and `daily_prize_pool`:

| Battles | Season Win Rate | Reward (raw / NOVI) |
|---------|-----------------|---------------------|
| 5 | 50% | 500 / 50 |
| 10 | 50% | 1000 / 100 |
| 10 | 70% | 1200 / 120 |
| 10 | 90% | 1400 / 140 |

---

### Master Reward Distribution

```rust
const ARENA_PRIZE_DISTRIBUTION: [u16; 10] = [
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
]; // compile-time asserted to sum to 10_000 bps

// Inline in claim_master_reward (rank_idx is 0-based):
let reward = season.master_prize_pool
    .saturating_mul(ARENA_PRIZE_DISTRIBUTION[rank_idx] as u64)
    .checked_div(10_000)
    .unwrap_or(0);
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

### 2. Per-Opponent Cooldown

`ArenaParticipantAccount::count_opponent_in_window()` checks battles vs a specific opponent at battle time. Max 2 battles vs the same opponent per rolling 24h (`ArenaOpponentCooldownActive`) prevents win trading.

> Note: opponent **diversity** (`count_unique_opponents_in_window`) is computed but is **not** an enforced gate in the shipped code. It is reported in the `ArenaDailyRewardClaimed` event only. Diversity is expected to be enforced by the off-chain matchmaker, not on-chain.

### 3. Minimum Points for Leaderboard

`ArenaSeasonAccount::update_leaderboard()` ignores any score below `min_points_for_leaderboard` (default 500), then inserts/re-sorts the top-10 array (descending by `total_points`, swapping `leaderboard_claimed` flags alongside).

```rust
pub fn update_leaderboard(&mut self, player: Address, total_points: u64) -> bool {
    if total_points < self.min_points_for_leaderboard { return false; }
    // find/insert; bubble into sorted position; cap at 10 (replace lowest if it beats it)
}
```

Prevents sybil attacks where many accounts claim minimum positions.

### 4. Match Replay + Freshness

`challenge_player` requires `match_id > last_match_id` (`ArenaMatchAlreadyUsed`) and a `match_timestamp` that is not in the future (`ArenaMatchTimestampInvalid`) and at most 5 minutes old (`ArenaMatchExpired`). Combined with the required `game_authority` co-sign, this binds each battle to a single off-chain matchmaking assignment.

### 5. Loadout Clamping (Phantom-Army Guard)

`calculate_arena_power` clamps every loadout field to the assets the player actually owns, `min(loadout_field, owned_field)`, for both sides at battle time. A player cannot inflate their loadout beyond their real defensive units / weapons / armor to manufacture power, so an over-stated loadout wins nothing. It never fails the battle (non-lethal design) - it simply contributes the assets on hand.

---

## Events (For Indexers)

Six events are emitted. Discriminators are `sha256("event:<Name>")[..8]` on both the program (`events/arena.rs`, `events/kingdom.rs`) and SDK (`src/events/parser.ts`), so the name strings must match byte-for-byte. Pubkey fields are `Address` (32 bytes); player fields carry the **PlayerAccount PDA**, not the wallet. Serialized field order matches the struct field order below.

| Event | Emitted in |
|-------|-----------|
| `KingdomArenaSeasonStarted` | `arena/create_season.rs` (230) |
| `ArenaPlayerJoined` | `arena/join_season.rs` (231) |
| `ArenaBattleResolved` | `arena/challenge_player.rs` (233) |
| `ArenaDailyRewardClaimed` | `arena/claim_daily_reward.rs` (234) |
| `ArenaMasterRewardClaimed` | `arena/claim_master_reward.rs` (235) |
| `ArenaSeasonFinalized` | `arena/claim_master_reward.rs` (235, on lazy Active → Finalized) |

```rust
// On create_season (defined in events/kingdom.rs)
pub struct KingdomArenaSeasonStarted {
    pub kingdom_id: u16,
    pub game_engine: Address,
    pub season_id: u32,
    pub start_time: i64,
    pub end_time: i64,
    pub prize_pool: u64,       // = master_prize_pool
}

pub struct ArenaPlayerJoined {
    pub season_id: u32,
    pub player: Address,
    pub timestamp: i64,
}

pub struct ArenaBattleResolved {
    pub season_id: u32,
    pub battle_id: u64,        // season.total_battles after increment
    pub challenger: Address,
    pub defender: Address,
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

pub struct ArenaDailyRewardClaimed {
    pub season_id: u32,
    pub player: Address,
    pub amount: u64,
    pub battles_fought: u8,
    pub unique_opponents: u8,  // informational only (no gate)
    pub timestamp: i64,
}

pub struct ArenaMasterRewardClaimed {
    pub season_id: u32,
    pub player: Address,
    pub rank: u8,              // 1-based
    pub amount: u64,
    pub timestamp: i64,
}

pub struct ArenaSeasonFinalized {
    pub season_id: u32,
    pub total_battles: u64,
    pub leaderboard_count: u8,
    pub timestamp: i64,
}
```

There is no `ArenaUnclaimedRedistributed` event (the redistribute instruction does not exist).

---

## PDA Seeds

All arena PDAs are **kingdom-scoped**: the `game_engine` pubkey is part of every seed. `season_id` is serialized as little-endian `u32`. The SDK uses the identical seed strings (`SEEDS.ARENA_SEASON` etc. in `program.ts`) and derivations (`deriveArenaSeasonPda` / `deriveArenaParticipantPda` / `deriveArenaLoadoutPda` in `pda.ts`). The `player` component is the **PlayerAccount PDA**, not the wallet.

```rust
// Arena Season (per kingdom per season)
["arena_season", game_engine.as_ref(), season_id.to_le_bytes()]

// Arena Participant (per kingdom per season per player)
["arena_participant", game_engine.as_ref(), season_id.to_le_bytes(), player_pda.as_ref()]

// Arena Loadout (per kingdom per player, reusable across seasons)
["arena_loadout", game_engine.as_ref(), player_pda.as_ref()]
```

---

## Error Codes

Arena errors live in the shared `GameError` enum (`src/error.rs`) in the **7900–7930** range (not 8100). The list below is the shipped enum; gaps (7906, 7924–7926) are deliberately removed variants from when loadout validation was dropped.

```rust
// GameError, Arena PvP System Errors (7900-7930)
ArenaSeasonNotActive = 7900,
ArenaSeasonExpired = 7901,
ArenaSeasonNotFinalized = 7902,
ArenaCannotChallengeYourself = 7903,
ArenaNotInSeason = 7904,
ArenaOpponentNotInSeason = 7905,
// 7906 removed - loadout validation now inline in challenge_player
ArenaDailyBattleLimitReached = 7907,
ArenaOpponentCooldownActive = 7908,
ArenaHeroAccountRequired = 7909,
ArenaHeroMismatch = 7910,
ArenaHeroLocked = 7911,
ArenaMatchExpired = 7912,
ArenaMatchTimestampInvalid = 7913,
ArenaMatchAlreadyUsed = 7914,
ArenaDailyRewardAlreadyClaimed = 7915,
ArenaMinBattlesNotMet = 7916,
ArenaDailyPoolExhausted = 7917,
ArenaMasterRewardAlreadyClaimed = 7918,
ArenaNotOnLeaderboard = 7919,
ArenaClaimDeadlinePassed = 7920,
ArenaSeasonAlreadyExists = 7921,
ArenaSeasonNotPending = 7922,
ArenaLoadoutAlreadyExists = 7923,
// 7924-7926 removed - no loadout validation (arena is non-lethal, loadout trusted)
ArenaUnclaimedRedistributionTooEarly = 7927, // reused by close_season as "too early to close"
ArenaNoUnclaimedPrizes = 7928,
ArenaSeasonAlreadyActive = 7929,
ArenaParticipantAlreadyExists = 7930,
```

Note: `ArenaHeroLocked`, `ArenaNotInSeason`, `ArenaOpponentNotInSeason`, `ArenaSeasonNotPending`, `ArenaNoUnclaimedPrizes`, and `ArenaSeasonAlreadyActive` are defined but not currently raised by the shipped processors. Generic errors (`Unauthorized`, `InvalidParameter`, `InvalidPDA`, `InvalidMint`, `InsufficientLevel`) are used for several arena checks as noted in the instruction logic above.

---

## Lifecycle

1. **Create (230):** the DAO (`game_authority`) creates a season directly as `Active` for an explicit `season_id`, `city_id = 0`. `KingdomArenaSeasonStarted` is emitted.
2. **Active play (231–234):** players join (creating participant + loadout), update loadouts, fight via `challenge_player` (game-authority co-signed), and crank daily rewards. `claim_daily_reward` works only while `Active`.
3. **Lazy finalization (235):** there is no dedicated finalize instruction. The first `claim_master_reward` called after `end_time` flips the season `Active → Finalized` in-line and emits `ArenaSeasonFinalized`. Master rewards are then claimable until `claim_deadline` (`end_time + 30 days`).
4. **Rollover crank:** the off-chain crank (`cli/lib/cranks/arena.ts`) drives the cadence: it closes seasons that are past their `claim_deadline` or 4+ behind (Ix 236, rent → authority) and creates the next season (Ix 230) once the latest has run its course.
5. **No escrow / no redistribution:** rewards are minted on claim into `locked_novi`; there is no pot to escrow or redistribute. `close_season` just reclaims rent.

`city_id` is always `0` (global / kingdom-wide arena); the per-city `city.arena_season_id` counter is used only by `close_season` to detect stale seasons.

---

## Summary

The Arena PvP system provides:

| Feature | Implementation |
|---------|---------------|
| **Non-lethal Combat** | Power comparison, no asset loss; loadouts trusted (no validation) |
| **Stateless Battles** | Computed inline, events emitted |
| **Kingdom-Scoped** | game_engine in every PDA seed; one leaderboard per kingdom |
| **Weekly Seasons** | 7-day cycles, 30-day claim window, global arena (city_id = 0) |
| **Top 10 Leaderboard** | On-chain, minimum 500 points entry |
| **Dual Rewards** | Daily (5+ battles) + Master (top 10); both minted to locked_novi |
| **Rolling Daily Limit** | 10 battles per 24 hours (not midnight reset) |
| **Opponent Limits** | Max 2 vs same player per 24h |
| **ELO System** | Integer-approximation rating, floor 100 |
| **Underdog Bonus** | +5% win points per 10% power disadvantage, capped at +25 |
| **Full Buff Integration** | Research, Hero (NFT), Estate, Equipment |
| **Lazy Finalization** | Active → Finalized inside claim_master_reward |
| **Rollover Crank** | close_season (236) + create_season (230) cadence |
| **Sybil Resistance** | 500 point minimum for top 10 |
| **Event Emission** | Six events: full battle/season history for indexers |
