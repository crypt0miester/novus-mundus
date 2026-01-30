# Multi-Kingdom Implementation Plan

## Overview

This document outlines the complete implementation plan for adding multi-kingdom support to Novus Mundus. The goal is to allow players who join later to have fair starts by creating separate "kingdoms" with different start times, where all players in a kingdom begin together.

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         GLOBAL (Shared)                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  • NOVI Mint (single token economy)                                      │
│  • HeroTemplate (same heroes everywhere)                                 │
│  • ResearchTemplate (same research tree)                                 │
│  • DungeonTemplate (same dungeon designs)                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                       ▼
┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐
│   Kingdom 0           │ │   Kingdom 1           │ │   Kingdom 2           │
│   "Genesis"           │ │   "Vanguard"          │ │   "Frontier"          │
│   Medieval Theme      │ │   Cyberpunk Theme     │ │   Post-Apoc Theme     │
│   Launch: Jan 2025    │ │   Launch: Apr 2025    │ │   Launch: Jul 2025    │
├───────────────────────┤ ├───────────────────────┤ ├───────────────────────┤
│ • GameEngine          │ │ • GameEngine          │ │ • GameEngine          │
│ • 24 Cities           │ │ • 24 Cities           │ │ • 24 Cities           │
│ • Players             │ │ • Players             │ │ • Players             │
│ • Teams               │ │ • Teams               │ │ • Teams               │
│ • Rallies             │ │ • Rallies             │ │ • Rallies             │
│ • Castles             │ │ • Castles             │ │ • Castles             │
│ • Events              │ │ • Events              │ │ • Events              │
│ • Arena Seasons       │ │ • Arena Seasons       │ │ • Arena Seasons       │
│ • Dungeon Leaderboards│ │ • Dungeon Leaderboards│ │ • Dungeon Leaderboards│
│ • Encounters          │ │ • Encounters          │ │ • Encounters          │
│ • Shop Config/Items   │ │ • Shop Config/Items   │ │ • Shop Config/Items   │
└───────────────────────┘ └───────────────────────┘ └───────────────────────┘
```

---

## Phase 1: Core State Changes

### 1.1 GameEngine

**File:** `state/game_engine.rs`

**Current Seeds:** `["game_engine"]`
**New Seeds:** `["game_engine", kingdom_id: u16]`

```rust
// ADD to GameEngine struct
pub struct GameEngine {
    pub kingdom_id: u16,            // NEW: Kingdom identifier (0, 1, 2, ...)
    pub kingdom_name: [u8; 32],     // NEW: "Genesis", "Vanguard", etc.
    pub created_at: i64,            // NEW: Kingdom start time (fair start reference)
    pub registration_open: bool,    // NEW: Can new players join?
    pub registration_closes_at: i64,// NEW: Optional deadline to join

    // ... existing fields unchanged
    pub authority: Pubkey,
    pub payment_authority: Pubkey,
    pub game_authority: Pubkey,
    pub treasury_wallet: Pubkey,
    pub bump: u8,
    // ...
}

// UPDATE derive_pda
impl GameEngine {
    pub fn derive_pda(kingdom_id: u16) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[GAME_ENGINE_SEED, &kingdom_id.to_le_bytes()],
            &crate::ID,
        )
    }

    pub fn create_pda(kingdom_id: u16, bump: u8) -> Result<Pubkey, ProgramError> {
        let bump_seed = [bump];
        pinocchio::pubkey::create_program_address(
            &[GAME_ENGINE_SEED, &kingdom_id.to_le_bytes(), &bump_seed],
            &crate::ID,
        )
    }

    // UPDATE load_checked to accept kingdom_id
    pub fn load_checked<'a>(
        account: &'a AccountInfo,
        kingdom_id: u16,
        program_id: &Pubkey,
    ) -> Result<super::Loaded<'a, Self>, ProgramError> {
        // ... validation with kingdom_id
    }
}
```

**Processor Changes:**
- `processor/initialization/game_engine.rs` - Accept `kingdom_id` parameter

---

### 1.2 PlayerCore

**File:** `state/player.rs`

**Current Seeds:** `["player", owner]`
**New Seeds:** `["player", game_engine, owner]`

```rust
// ADD to PlayerCore struct
pub struct PlayerCore {
    pub game_engine: Pubkey,        // NEW: Which kingdom this player belongs to

    // ... existing fields
    pub owner: Pubkey,
    pub created_at: i64,
    pub bump: u8,
    // ...
}

// UPDATE derive_pda
impl PlayerCore {
    pub fn derive_pda(game_engine: &Pubkey, owner: &Pubkey) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[PLAYER_SEED, game_engine.as_ref(), owner.as_ref()],
            &crate::ID,
        )
    }

    pub fn create_pda(game_engine: &Pubkey, owner: &Pubkey, bump: u8) -> Result<Pubkey, ProgramError> {
        let bump_seed = [bump];
        pinocchio::pubkey::create_program_address(
            &[PLAYER_SEED, game_engine.as_ref(), owner.as_ref(), &bump_seed],
            &crate::ID,
        )
    }

    // UPDATE load_checked to accept game_engine
    pub fn load_checked<'a>(
        account: &'a AccountInfo,
        game_engine: &Pubkey,
        expected_owner: &Pubkey,
        program_id: &Pubkey,
    ) -> Result<super::Loaded<'a, Self>, ProgramError> {
        // ... validation with game_engine
    }
}
```

**Processor Changes:**
- `processor/initialization/player.rs` - Accept `game_engine` account, store reference

---

### 1.3 CityAccount

**File:** `state/city.rs` (UPDATE existing or create)

**Current Seeds:** `["city", city_id]` (if exists)
**New Seeds:** `["city", game_engine, city_id]`

```rust
#[repr(C)]
#[derive(Copy, Clone)]
pub struct CityAccount {
    pub game_engine: Pubkey,            // NEW: Kingdom this city belongs to
    pub city_id: u16,
    pub bump: u8,
    pub _padding: [u8; 5],

    // Identity
    pub name: [u8; 32],                 // Can be themed per kingdom
    pub city_type: u8,                  // 0=Capital, 1=Resource, 2=Combat, 3=Trade

    // Geography (same coordinates, different names/themes)
    pub latitude: f64,
    pub longitude: f64,
    pub radius_km: f32,

    // Encounter config
    pub min_encounter_level: u8,
    pub max_encounter_level: u8,

    // Castle slots
    pub max_castles: u8,
    pub castle_count: u8,

    // Activity tracking
    pub players_present: u32,
    pub active_encounters: u32,
    pub total_encounters_spawned: u64,

    // DAO controls
    pub enabled: bool,
    pub activates_at: i64,              // City opens at this time
    pub founded_at: i64,
}

impl CityAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub fn derive_pda(game_engine: &Pubkey, city_id: u16) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[CITY_SEED, game_engine.as_ref(), &city_id.to_le_bytes()],
            &crate::ID,
        )
    }
}
```

**New Processor:**
- `processor/initialization/city.rs` - Create city for kingdom (DAO instruction)
- `processor/initialization/initialize_kingdom_cities.rs` - Batch create all 24 cities

---

## Phase 2: Kingdom-Scoped Systems

### 2.1 Castle System

**Files:** `state/castle.rs`, `processor/castle/*.rs`

#### CastleAccount

**Current Seeds:** `["castle", city_id, castle_id]`
**New Seeds:** `["castle", game_engine, city_id, castle_id]`

```rust
pub struct CastleAccount {
    pub game_engine: Pubkey,        // NEW
    pub castle_id: u16,
    pub city_id: u16,
    // ... rest unchanged
}

impl CastleAccount {
    pub fn derive_pda(
        game_engine: &Pubkey,
        city_id: u16,
        castle_id: u16,
    ) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[
                CASTLE_SEED,
                game_engine.as_ref(),
                &city_id.to_le_bytes(),
                &castle_id.to_le_bytes(),
            ],
            &crate::ID,
        )
    }
}
```

#### KingRegistryAccount

**Current Seeds:** `["king_registry", king]`
**New Seeds:** `["king_registry", game_engine, king]`

```rust
impl KingRegistryAccount {
    pub fn derive_pda(game_engine: &Pubkey, king: &Pubkey) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[KING_REGISTRY_SEED, game_engine.as_ref(), king.as_ref()],
            &crate::ID,
        )
    }
}
```

#### CourtPositionAccount, GarrisonContributionAccount, TeamCastleRewardAccount
- Seeds already include `castle` pubkey → inherit kingdom scope automatically
- No seed changes needed, but add validation that participants are same kingdom

**Processor Updates (20+ files):**
| File | Changes |
|------|---------|
| `create_castle.rs` | Accept `game_engine`, derive new seeds |
| `claim_vacant_castle.rs` | Validate player.game_engine == castle.game_engine |
| `appoint_court.rs` | Validate all parties same kingdom |
| `join_garrison.rs` | Validate contributor same kingdom |
| `attack_castle.rs` | Validate attacker same kingdom |
| `claim_castle_rewards.rs` | Kingdom validation |
| All others | Pass game_engine, validate kingdom |

---

### 2.2 Team System

**Files:** `state/team.rs`, `processor/team/*.rs`

#### TeamAccount

**Current Seeds:** `["team", team_id]`
**New Seeds:** `["team", game_engine, team_id]`

```rust
pub struct TeamAccount {
    pub game_engine: Pubkey,        // NEW
    pub team_id: u64,
    // ... rest unchanged
}

impl TeamAccount {
    pub fn derive_pda(game_engine: &Pubkey, team_id: u64) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[TEAM_SEED, game_engine.as_ref(), &team_id.to_le_bytes()],
            &crate::ID,
        )
    }
}
```

#### TeamSlotAccount

**Current Seeds:** `["team_slot", team, slot_index]`
- Inherits kingdom from team → no seed change needed
- Add validation: slot player must be same kingdom as team

#### TeamInviteAccount

**Current Seeds:** `["team_invite", inviter, invitee]`
**New Seeds:** `["team_invite", game_engine, inviter, invitee]`

```rust
impl TeamInviteAccount {
    pub fn derive_pda(
        game_engine: &Pubkey,
        inviter: &Pubkey,
        invitee: &Pubkey,
    ) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[TEAM_INVITE_SEED, game_engine.as_ref(), inviter.as_ref(), invitee.as_ref()],
            &crate::ID,
        )
    }
}
```

#### TreasuryRequestAccount

**Current Seeds:** `["treasury_request", team, request_id]`
- Inherits kingdom from team → no seed change needed

**Processor Updates (8+ files):**
| File | Changes |
|------|---------|
| `create_team.rs` | Accept `game_engine`, derive new seeds |
| `invite_member.rs` | Validate inviter and invitee same kingdom |
| `accept_invite.rs` | Validate all parties same kingdom |
| `join_team.rs` | Validate player and team same kingdom |
| `leave_team.rs` | Standard update |
| `kick_member.rs` | Standard update |
| `transfer_leadership.rs` | Validate same kingdom |
| `disband_team.rs` | Standard update |

---

### 2.3 Rally System

**Files:** `state/rally.rs`, `processor/rally/*.rs`

#### RallyAccount

**Current Seeds:** `["rally", rally_id]`
**New Seeds:** `["rally", game_engine, rally_id]`

```rust
pub struct RallyAccount {
    pub game_engine: Pubkey,        // NEW
    pub rally_id: u64,
    // ... rest unchanged
}

impl RallyAccount {
    pub fn derive_pda(game_engine: &Pubkey, rally_id: u64) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[RALLY_SEED, game_engine.as_ref(), &rally_id.to_le_bytes()],
            &crate::ID,
        )
    }
}
```

#### RallyParticipantAccount

**Current Seeds:** `["rally_participant", rally, player]`
- Inherits kingdom from rally → no seed change needed
- Add validation: participant must be same kingdom

**Processor Updates (6+ files):**
| File | Changes |
|------|---------|
| `create_rally.rs` | Accept `game_engine`, derive new seeds |
| `join_rally.rs` | Validate player and rally same kingdom |
| `leave_rally.rs` | Standard update |
| `start_rally.rs` | Standard update |
| `resolve_rally.rs` | Standard update |
| `cancel_rally.rs` | Standard update |

---

### 2.4 Event System

**Files:** `state/event.rs`, `processor/event/*.rs`

#### EventAccount

**Current Seeds:** `["event", event_id]`
**New Seeds:** `["event", game_engine, event_id]`

```rust
pub struct EventAccount {
    pub game_engine: Pubkey,        // NEW
    pub event_id: u64,
    // ... rest unchanged
}

impl EventAccount {
    pub fn derive_pda(game_engine: &Pubkey, event_id: u64) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[EVENT_SEED, game_engine.as_ref(), &event_id.to_le_bytes()],
            &crate::ID,
        )
    }
}
```

#### EventParticipationAccount

**Current Seeds:** `["event_participation", event, player]`
- Inherits kingdom from event → no seed change needed
- Add validation: participant must be same kingdom as event

**Processor Updates (5+ files):**
| File | Changes |
|------|---------|
| `create_event.rs` | Accept `game_engine`, derive new seeds |
| `join_event.rs` | Validate player and event same kingdom |
| `submit_score.rs` | Standard update |
| `claim_reward.rs` | Standard update |
| `end_event.rs` | Standard update |

---

### 2.5 Arena System

**Files:** `state/arena.rs`, `processor/arena/*.rs`

#### ArenaSeasonAccount

**Current Seeds:** `["arena_season", authority, season_id]`
**New Seeds:** `["arena_season", game_engine, season_id]`

```rust
pub struct ArenaSeasonAccount {
    pub game_engine: Pubkey,        // NEW
    pub season_id: u32,
    // ... rest unchanged (remove authority from seeds, keep as field)
}

impl ArenaSeasonAccount {
    pub fn derive_pda(game_engine: &Pubkey, season_id: u32) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[ARENA_SEASON_SEED, game_engine.as_ref(), &season_id.to_le_bytes()],
            &crate::ID,
        )
    }
}
```

#### ArenaParticipantAccount

**Current Seeds:** `["arena_participant", season, player]`
- Inherits kingdom from season → no seed change needed

#### ArenaLoadoutAccount

**Current Seeds:** `["arena_loadout", season, player]`
- Inherits kingdom from season → no seed change needed

**Processor Updates (5+ files):**
| File | Changes |
|------|---------|
| `create_season.rs` | Accept `game_engine`, derive new seeds |
| `join_season.rs` | Validate player and season same kingdom |
| `submit_loadout.rs` | Standard update |
| `battle.rs` | Validate both players same kingdom |
| `claim_rewards.rs` | Standard update |

---

### 2.6 Dungeon System

**Files:** `state/dungeon.rs`, `processor/dungeon/*.rs`

#### DungeonTemplate
- **NO CHANGE** - Global, shared across all kingdoms
- Seeds: `["dungeon_template", dungeon_id]`

#### DungeonRun
- **NO CHANGE** - Seeds include player which inherits kingdom
- Seeds: `["dungeon_run", player]`

#### DungeonLeaderboard

**Current Seeds:** `["dungeon_leaderboard", dungeon_id, week]`
**New Seeds:** `["dungeon_leaderboard", game_engine, dungeon_id, week]`

```rust
pub struct DungeonLeaderboard {
    pub game_engine: Pubkey,        // NEW
    pub dungeon_id: u16,
    pub week_number: u16,
    // ... rest unchanged
}

impl DungeonLeaderboard {
    pub fn derive_pda(
        game_engine: &Pubkey,
        dungeon_id: u16,
        week_number: u16,
    ) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[
                DUNGEON_LEADERBOARD_SEED,
                game_engine.as_ref(),
                &dungeon_id.to_le_bytes(),
                &week_number.to_le_bytes(),
            ],
            &crate::ID,
        )
    }
}
```

**Processor Updates (4 files):**
| File | Changes |
|------|---------|
| `create_leaderboard.rs` | Accept `game_engine`, derive new seeds |
| `claim.rs` | Pass `game_engine` for leaderboard lookup |
| `claim_leaderboard_prize.rs` | Validate player same kingdom |
| `enter.rs` | No change (player inherits kingdom) |

---

### 2.7 Encounter System

**Files:** `state/encounter.rs`, `processor/encounter/*.rs`

#### EncounterAccount

**Current Seeds:** `["encounter", location, encounter_id]` or similar
**New Seeds:** `["encounter", game_engine, city_id, location_x, location_y, encounter_id]`

```rust
pub struct EncounterAccount {
    pub game_engine: Pubkey,        // NEW
    pub city_id: u16,
    pub encounter_id: u64,
    // ... rest unchanged
}

impl EncounterAccount {
    pub fn derive_pda(
        game_engine: &Pubkey,
        city_id: u16,
        cell_x: u16,
        cell_y: u16,
        encounter_id: u64,
    ) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[
                ENCOUNTER_SEED,
                game_engine.as_ref(),
                &city_id.to_le_bytes(),
                &cell_x.to_le_bytes(),
                &cell_y.to_le_bytes(),
                &encounter_id.to_le_bytes(),
            ],
            &crate::ID,
        )
    }
}
```

#### LootAccount

**Current Seeds:** `["loot", encounter, player]`
- Inherits kingdom from encounter → no seed change needed

**Processor Updates (5+ files):**
| File | Changes |
|------|---------|
| `spawn.rs` | Accept `game_engine`, derive new seeds |
| `attack.rs` | Validate player and encounter same kingdom |
| `claim_loot.rs` | Standard update |
| `despawn.rs` | Standard update |

---

### 2.8 Location System

**Files:** `state/location.rs` (if exists)

#### LocationAccount

**Current Seeds:** `["location", city_id, cell_x, cell_y]`
**New Seeds:** `["location", game_engine, city_id, cell_x, cell_y]`

```rust
impl LocationAccount {
    pub fn derive_pda(
        game_engine: &Pubkey,
        city_id: u16,
        cell_x: u16,
        cell_y: u16,
    ) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[
                LOCATION_SEED,
                game_engine.as_ref(),
                &city_id.to_le_bytes(),
                &cell_x.to_le_bytes(),
                &cell_y.to_le_bytes(),
            ],
            &crate::ID,
        )
    }
}
```

---

### 2.9 Reinforcement System

**Files:** `state/reinforcement.rs`, `processor/reinforcement/*.rs`

#### ReinforcementAccount

**Current Seeds:** `["reinforcement", sender, receiver]`
**New Seeds:** `["reinforcement", game_engine, sender, receiver]`

```rust
pub struct ReinforcementAccount {
    pub game_engine: Pubkey,        // NEW
    pub sender_player: Pubkey,
    pub receiver_player: Pubkey,
    // ... rest unchanged
}

impl ReinforcementAccount {
    pub fn derive_pda(
        game_engine: &Pubkey,
        sender: &Pubkey,
        receiver: &Pubkey,
    ) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[REINFORCEMENT_SEED, game_engine.as_ref(), sender.as_ref(), receiver.as_ref()],
            &crate::ID,
        )
    }
}
```

**Processor Updates:**
| File | Changes |
|------|---------|
| `send_reinforcement.rs` | Validate sender and receiver same kingdom |
| `recall_reinforcement.rs` | Standard update |

---

## Phase 3: Validation Helpers

### 3.1 Kingdom Validation Helper

**File:** `helpers/kingdom.rs` (NEW)

```rust
use pinocchio::{account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey};
use crate::error::GameError;

/// Validate that a player belongs to the specified kingdom
pub fn validate_player_kingdom(
    player_game_engine: &Pubkey,
    expected_game_engine: &Pubkey,
) -> Result<(), ProgramError> {
    if player_game_engine != expected_game_engine {
        return Err(GameError::CrossKingdomAction.into());
    }
    Ok(())
}

/// Validate that two players are in the same kingdom
pub fn validate_same_kingdom(
    player1_game_engine: &Pubkey,
    player2_game_engine: &Pubkey,
) -> Result<(), ProgramError> {
    if player1_game_engine != player2_game_engine {
        return Err(GameError::CrossKingdomAction.into());
    }
    Ok(())
}

/// Validate that a player can interact with a kingdom-scoped entity
pub fn validate_entity_kingdom(
    player_game_engine: &Pubkey,
    entity_game_engine: &Pubkey,
    entity_name: &str,
) -> Result<(), ProgramError> {
    if player_game_engine != entity_game_engine {
        return Err(GameError::CrossKingdomAction.into());
    }
    Ok(())
}
```

### 3.2 New Error Codes

**File:** `error.rs`

```rust
// ADD new error variants
pub enum GameError {
    // ... existing errors

    /// Player attempted to interact with entity in different kingdom
    CrossKingdomAction = 180,

    /// Kingdom registration is closed
    KingdomRegistrationClosed = 181,

    /// Kingdom has not started yet
    KingdomNotStarted = 182,

    /// Invalid kingdom ID
    InvalidKingdomId = 183,

    /// Player already exists in this kingdom
    PlayerAlreadyExistsInKingdom = 184,
}
```

---

## Phase 4: New Instructions

### 4.1 Initialize Kingdom

**File:** `processor/initialization/kingdom.rs` (NEW)

```rust
/// Initialize a new kingdom (DAO only)
///
/// Accounts:
/// 0. [signer] Authority (DAO)
/// 1. [writable] GameEngine PDA (to be created)
/// 2. [writable] Payer
/// 3. [] System Program
///
/// Data:
/// - kingdom_id: u16
/// - kingdom_name: [u8; 32]
/// - start_time: i64 (when kingdom opens for play)
/// - registration_closes_at: i64 (optional, 0 = never)
/// - theme: u8
pub fn process_initialize_kingdom(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Parse accounts
    // Validate authority
    // Create GameEngine with kingdom_id in seeds
    // Initialize all config fields
    // Emit KingdomCreated event
}
```

### 4.2 Initialize Kingdom Cities (Batch)

**File:** `processor/initialization/kingdom_cities.rs` (NEW)

```rust
/// Initialize all 24 cities for a kingdom (DAO only)
/// Called after initialize_kingdom
///
/// Accounts:
/// 0. [signer] Authority (DAO)
/// 1. [] GameEngine
/// 2. [writable] City 1 PDA
/// 3. [writable] City 2 PDA
/// ... (up to remaining account limit)
/// N. [writable] Payer
/// N+1. [] System Program
///
/// Data:
/// - start_city_id: u16 (for batching, e.g., 1-8, 9-16, 17-24)
pub fn process_initialize_kingdom_cities(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Parse accounts
    // Validate authority and game_engine
    // Create each city with predefined data from CITIES config
    // Apply kingdom theme to city names if needed
}
```

### 4.3 Close Kingdom Registration

**File:** `processor/initialization/close_registration.rs` (NEW)

```rust
/// Close registration for a kingdom (DAO only)
/// No new players can join after this
///
/// Accounts:
/// 0. [signer] Authority (DAO)
/// 1. [writable] GameEngine
pub fn process_close_kingdom_registration(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Set registration_open = false
    // Emit KingdomRegistrationClosed event
}
```

---

## Phase 5: Processor Updates Summary

### 5.1 Files Requiring `game_engine` Parameter Addition

| Module | Files | Change Type |
|--------|-------|-------------|
| **Initialization** | `game_engine.rs`, `player.rs` | Core restructure |
| **Castle** | All 20+ files | Add game_engine, validate kingdom |
| **Team** | All 8+ files | Add game_engine, validate kingdom |
| **Rally** | All 6+ files | Add game_engine, validate kingdom |
| **Event** | All 5+ files | Add game_engine, validate kingdom |
| **Arena** | All 5+ files | Add game_engine, validate kingdom |
| **Dungeon** | 4 files (leaderboard-related) | Add game_engine |
| **Encounter** | All 5+ files | Add game_engine, validate kingdom |
| **Reinforcement** | 2+ files | Add game_engine, validate kingdom |
| **Combat** | All PvP files | Validate both players same kingdom |
| **Travel** | All files | Validate player in kingdom city |

### 5.2 Files Requiring Only Validation (No Seed Changes)

| Module | Notes |
|--------|-------|
| **Shop** | Already scoped via `game_engine` in seeds ✓ |
| **Subscription** | Reads from GameEngine ✓ |
| **Hero** | Templates global, validate hero ownership only |
| **Research** | Templates global, state in player |
| **Expedition** | Scoped to player → inherits kingdom |
| **Forge** | Scoped to player → inherits kingdom |
| **Sanctuary** | Scoped to player → inherits kingdom |
| **Progression** | Scoped to player → inherits kingdom |
| **Name** | Scoped to player → inherits kingdom |
| **Token** | NOVI is global, no kingdom validation needed |
| **Economy** | Scoped to player → inherits kingdom |

---

## Phase 6: Constants Updates

**File:** `constants.rs`

```rust
// ADD new constants
pub const KINGDOM_SEED: &[u8] = b"kingdom";  // If separate metadata account needed

// Kingdom limits
pub const MAX_KINGDOMS: u16 = 100;           // Maximum kingdoms that can exist
pub const MIN_KINGDOM_START_DELAY: i64 = 86400; // 1 day minimum before kingdom starts

// Default kingdom config
pub const DEFAULT_REGISTRATION_PERIOD: i64 = 604800; // 7 days registration window
```

---

## Phase 7: Events

**File:** `events/kingdom.rs` (NEW)

```rust
/// Emitted when a new kingdom is created
pub struct KingdomCreated {
    pub kingdom_id: u16,
    pub kingdom_name: [u8; 32],
    pub theme: u8,
    pub start_time: i64,
    pub created_by: Pubkey,
}

/// Emitted when kingdom registration closes
pub struct KingdomRegistrationClosed {
    pub kingdom_id: u16,
    pub total_players: u64,
    pub closed_at: i64,
}

/// Emitted when a player joins a kingdom
pub struct PlayerJoinedKingdom {
    pub kingdom_id: u16,
    pub player: Pubkey,
    pub owner: Pubkey,
    pub joined_at: i64,
}
```

---

## Phase 8: Migration Strategy

### 8.1 Backward Compatibility (Genesis Kingdom)

For existing deployments, use `kingdom_id = 0` as the "Genesis" kingdom:

1. Deploy updated program with multi-kingdom support
2. Existing GameEngine at `["game_engine"]` continues working
3. New GameEngines use `["game_engine", kingdom_id]`
4. Migration script updates existing accounts to include `kingdom_id = 0`

### 8.2 Fresh Deployment

For new deployments:
1. Deploy program
2. Call `initialize_kingdom` with `kingdom_id = 0` for Genesis
3. Call `initialize_kingdom_cities` (3 batches of 8 cities)
4. Open for player registration

### 8.3 Adding New Kingdoms

When launching a new kingdom:
1. DAO calls `initialize_kingdom` with next `kingdom_id`
2. DAO calls `initialize_kingdom_cities` for all 24 cities
3. Optionally customize city names for theme
4. Set `start_time` for fair start
5. Players can register during registration window
6. Kingdom gameplay begins at `start_time`

---

## Phase 9: Testing Plan

### 9.1 Unit Tests

| Test Category | Tests |
|---------------|-------|
| **GameEngine** | Create with kingdom_id, validate PDA derivation |
| **Player** | Create in kingdom, validate same kingdom checks |
| **City** | Create per kingdom, validate kingdom scoping |
| **Castle** | Claim, attack - validate cross-kingdom blocked |
| **Team** | Create, invite - validate cross-kingdom blocked |
| **Rally** | Create, join - validate cross-kingdom blocked |
| **Event** | Create, participate - validate cross-kingdom blocked |
| **Arena** | Season, battle - validate cross-kingdom blocked |
| **Dungeon** | Leaderboard per kingdom, validate scoping |
| **Combat** | PvP - validate cross-kingdom blocked |

### 9.2 Integration Tests

| Test Scenario | Description |
|---------------|-------------|
| **Multi-Kingdom Isolation** | Create 2 kingdoms, verify complete isolation |
| **Player in Multiple Kingdoms** | Same wallet, different players per kingdom |
| **Kingdom Lifecycle** | Create → Register → Start → Play |
| **Fair Start** | All players in kingdom start at same time |

### 9.3 Security Tests

| Test | Description |
|------|-------------|
| **Cross-Kingdom Attack** | Verify player can't attack castle in other kingdom |
| **Cross-Kingdom Team** | Verify player can't join team in other kingdom |
| **Cross-Kingdom Rally** | Verify player can't join rally in other kingdom |
| **Leaderboard Isolation** | Verify leaderboards are kingdom-specific |

---

## Phase 10: Implementation Order

### Sprint 1: Core (Week 1-2)
1. [ ] Update `GameEngine` state and PDA derivation
2. [ ] Update `PlayerCore` state and PDA derivation
3. [ ] Create `CityAccount` state with kingdom scope
4. [ ] Add kingdom validation helpers
5. [ ] Add new error codes
6. [ ] Update `processor/initialization/game_engine.rs`
7. [ ] Update `processor/initialization/player.rs`
8. [ ] Create `processor/initialization/city.rs`
9. [ ] Create `processor/initialization/kingdom.rs`

### Sprint 2: Teams & Social (Week 3)
1. [ ] Update `TeamAccount` state and PDA
2. [ ] Update `TeamInviteAccount` state and PDA
3. [ ] Update all team processors with kingdom validation
4. [ ] Update `RallyAccount` state and PDA
5. [ ] Update all rally processors with kingdom validation
6. [ ] Update `ReinforcementAccount` state and PDA

### Sprint 3: Competitive (Week 4)
1. [ ] Update `EventAccount` state and PDA
2. [ ] Update all event processors
3. [ ] Update `ArenaSeasonAccount` state and PDA
4. [ ] Update all arena processors
5. [ ] Update `DungeonLeaderboard` state and PDA
6. [ ] Update dungeon claim/leaderboard processors

### Sprint 4: Territory (Week 5)
1. [ ] Update `CastleAccount` state and PDA
2. [ ] Update `KingRegistryAccount` state and PDA
3. [ ] Update all 20+ castle processors
4. [ ] Update `EncounterAccount` state and PDA
5. [ ] Update all encounter processors
6. [ ] Update `LocationAccount` if exists

### Sprint 5: Combat & Travel (Week 6)
1. [ ] Update all combat processors with kingdom validation
2. [ ] Update all travel processors with kingdom city validation
3. [ ] Comprehensive cross-kingdom validation audit

### Sprint 6: Testing & Polish (Week 7-8)
1. [ ] Unit tests for all updated state
2. [ ] Integration tests for multi-kingdom scenarios
3. [ ] Security audit for cross-kingdom isolation
4. [ ] Documentation updates
5. [ ] SDK updates for multi-kingdom

---

## Appendix A: Complete PDA Reference

### Global (No Kingdom Scope)

| Account | Seeds |
|---------|-------|
| `NoviMint` | `["novi_mint"]` |
| `HeroTemplate` | `["hero_template", template_id]` |
| `ResearchTemplate` | `["research_template", template_id]` |
| `DungeonTemplate` | `["dungeon_template", dungeon_id]` |

### Kingdom-Scoped (New)

| Account | Seeds |
|---------|-------|
| `GameEngine` | `["game_engine", kingdom_id]` |
| `CityAccount` | `["city", game_engine, city_id]` |
| `Player` | `["player", game_engine, owner]` |
| `Team` | `["team", game_engine, team_id]` |
| `TeamInvite` | `["team_invite", game_engine, inviter, invitee]` |
| `Rally` | `["rally", game_engine, rally_id]` |
| `Event` | `["event", game_engine, event_id]` |
| `ArenaSeason` | `["arena_season", game_engine, season_id]` |
| `Castle` | `["castle", game_engine, city_id, castle_id]` |
| `KingRegistry` | `["king_registry", game_engine, king]` |
| `Encounter` | `["encounter", game_engine, city_id, x, y, enc_id]` |
| `Location` | `["location", game_engine, city_id, x, y]` |
| `Reinforcement` | `["reinforcement", game_engine, sender, receiver]` |
| `DungeonLeaderboard` | `["dungeon_leaderboard", game_engine, dungeon_id, week]` |

### Derived (Inherit Kingdom from Parent)

| Account | Seeds | Inherits From |
|---------|-------|---------------|
| `User` | `["user", owner]` | N/A (global per wallet) |
| `TeamSlot` | `["team_slot", team, slot]` | Team |
| `TreasuryRequest` | `["treasury_request", team, req_id]` | Team |
| `RallyParticipant` | `["rally_participant", rally, player]` | Rally |
| `EventParticipation` | `["event_participation", event, player]` | Event |
| `ArenaParticipant` | `["arena_participant", season, player]` | Season |
| `ArenaLoadout` | `["arena_loadout", season, player]` | Season |
| `CourtPosition` | `["court", castle, position]` | Castle |
| `Garrison` | `["garrison", castle, contributor]` | Castle |
| `TeamCastleReward` | `["team_castle_reward", castle, member]` | Castle |
| `DungeonRun` | `["dungeon_run", player]` | Player |
| `Expedition` | `["expedition", player, exp_id]` | Player |
| `Loot` | `["loot", encounter, player]` | Encounter |

---

## Appendix B: Estimated Line Changes

| Category | Files | Lines (Est.) |
|----------|-------|--------------|
| State structs | 15 | ~500 |
| PDA derivation | 25 | ~400 |
| Processor updates | 80+ | ~2000 |
| New instructions | 5 | ~500 |
| Validation helpers | 2 | ~100 |
| Error codes | 1 | ~20 |
| Events | 2 | ~100 |
| Constants | 1 | ~30 |
| Tests | 50+ | ~2500 |
| **Total** | **~180** | **~6150** |

---

## Appendix C: Leaderboard & Event Systems - Critical Findings

### CRITICAL ISSUES FOUND

After detailed code review, the following systems have **NO kingdom scoping** and will allow cross-kingdom competition (unfair for late joiners):

---

### C.1 EventAccount - NOT SCOPED ❌

**File:** `state/event.rs`

**Current Structure:**
```rust
pub struct EventAccount {
    pub id: u64,
    pub name: [u8; 64],
    // ... NO game_engine field!
    pub leaderboard: [LeaderboardEntry; 10],
    pub leaderboard_count: u8,
    // ...
}
```

**Current PDA:** `["event", event_id]` - Completely global!

**Problem:** All kingdoms share the same event leaderboards. Genesis players dominate.

**Fix Required:**
```rust
pub struct EventAccount {
    pub game_engine: Pubkey,        // ADD: Kingdom reference
    pub id: u64,
    // ...
}

// New PDA
pub fn derive_pda(game_engine: &Pubkey, event_id: u64) -> (Pubkey, u8) {
    pinocchio::pubkey::find_program_address(
        &[EVENT_SEED, game_engine.as_ref(), &event_id.to_le_bytes()],
        &crate::ID,
    )
}
```

**Files to Update:**
- `state/event.rs` - Add game_engine field, update derive_pda, load_checked
- `processor/event/create.rs` - Accept game_engine, use new seeds
- `processor/event/join.rs` - Validate player kingdom matches event
- `processor/event/finalize.rs` - Standard update
- `processor/event/claim_prize.rs` - Validate kingdom match
- `helpers/event_scoring.rs` - No change (uses event reference)

---

### C.2 ArenaSeasonAccount - PARTIALLY SCOPED ⚠️

**File:** `state/arena.rs`

**Current Structure:**
```rust
pub struct ArenaSeasonAccount {
    pub season_id: u32,
    pub city_id: u16,           // Field exists but NOT in PDA seeds!
    pub authority: Pubkey,
    pub leaderboard: [ArenaLeaderboardEntry; 10],
    // ...
}
```

**Current PDA:** `["arena_season", authority, season_id]`

**Problem:** `city_id` is just a data field, NOT enforced by PDA derivation. Different authorities could create conflicting seasons. The `authority` in seeds is meant for admin control, not kingdom scoping.

**Fix Required:**
```rust
pub struct ArenaSeasonAccount {
    pub game_engine: Pubkey,    // REPLACE authority concept
    pub season_id: u32,
    pub city_id: u16,           // Keep for city-specific arenas within kingdom
    // ...
}

// New PDA - kingdom scoped
pub fn derive_pda(game_engine: &Pubkey, season_id: u32) -> (Pubkey, u8) {
    pinocchio::pubkey::find_program_address(
        &[ARENA_SEASON_SEED, game_engine.as_ref(), &season_id.to_le_bytes()],
        &crate::ID,
    )
}
```

**ArenaParticipantAccount - Also needs update:**
```rust
// Current: ["arena_participant", season_authority, season_id, player]
// New:     ["arena_participant", game_engine, season_id, player]

pub fn derive_pda(game_engine: &Pubkey, season_id: u32, player: &Pubkey) -> (Pubkey, u8) {
    pinocchio::pubkey::find_program_address(
        &[ARENA_PARTICIPANT_SEED, game_engine.as_ref(), &season_id.to_le_bytes(), player.as_ref()],
        &crate::ID,
    )
}
```

**ArenaLoadoutAccount - Also needs update:**
```rust
// Current: ["arena_loadout", season_authority, season_id, player]
// New:     ["arena_loadout", game_engine, season_id, player]
```

**Files to Update:**
- `state/arena.rs` - Update all 3 account types
- `processor/arena/create_season.rs` - Use game_engine instead of authority
- `processor/arena/join_season.rs` - Validate player kingdom
- `processor/arena/battle.rs` - Validate both players same kingdom
- `processor/arena/claim_daily_reward.rs` - Standard update
- `processor/arena/claim_master_reward.rs` - Standard update
- `processor/arena/finalize_season.rs` - Standard update

---

### C.3 DungeonLeaderboard - NOT SCOPED ❌

**File:** `state/dungeon.rs`

**Current Structure:**
```rust
pub struct DungeonLeaderboard {
    pub dungeon_id: u16,
    pub week_number: u16,
    // ... NO game_engine field!
    pub leaderboard: [LeaderboardEntry; 10],
    pub prize_pool: u64,
    pub claimed_mask: u16,
}
```

**Current PDA:** `["dungeon_leaderboard", dungeon_id, week_number]` - Completely global!

**Problem:** All kingdoms share dungeon leaderboards. Genesis players with max heroes dominate forever.

**Fix Required:**
```rust
pub struct DungeonLeaderboard {
    pub game_engine: Pubkey,        // ADD: Kingdom reference
    pub dungeon_id: u16,
    pub week_number: u16,
    // ...
}

// New PDA
pub fn derive_pda(game_engine: &Pubkey, dungeon_id: u16, week_number: u16) -> (Pubkey, u8) {
    pinocchio::pubkey::find_program_address(
        &[
            DUNGEON_LEADERBOARD_SEED,
            game_engine.as_ref(),
            &dungeon_id.to_le_bytes(),
            &week_number.to_le_bytes(),
        ],
        &crate::ID,
    )
}
```

**Files to Update:**
- `state/dungeon.rs` - Add game_engine to DungeonLeaderboard
- `processor/dungeon/create_leaderboard.rs` - Accept game_engine
- `processor/dungeon/claim.rs` - Pass game_engine for leaderboard update
- `processor/dungeon/claim_leaderboard_prize.rs` - Validate player kingdom

---

### C.4 Summary: Leaderboard Kingdom Scoping

| System | Current Seeds | Scoped? | Fix |
|--------|---------------|---------|-----|
| **EventAccount** | `["event", event_id]` | ❌ NO | Add game_engine |
| **ArenaSeasonAccount** | `["arena_season", authority, season_id]` | ⚠️ Partial | Replace authority with game_engine |
| **ArenaParticipantAccount** | `["...", authority, season_id, player]` | ⚠️ Partial | Replace authority with game_engine |
| **ArenaLoadoutAccount** | `["...", authority, season_id, player]` | ⚠️ Partial | Replace authority with game_engine |
| **DungeonLeaderboard** | `["...", dungeon_id, week]` | ❌ NO | Add game_engine |
| **DungeonRun** | `["dungeon_run", player]` | ✅ Yes | Inherits from player |
| **DungeonTemplate** | `["dungeon_template", id]` | ✅ N/A | Global by design |

---

### C.5 EventParticipation - Inherits from Event

**Current PDA:** `["event_participation", event_id, player_owner]`

Since EventParticipation references event_id, and events will be kingdom-scoped, we have two options:

**Option A: Keep current seeds (Recommended)**
- Event is already kingdom-scoped
- Participation inherits scope through event lookup
- No PDA change needed

**Option B: Add game_engine to seeds**
- More explicit but redundant
- Would require updating all participation processors

**Recommendation:** Option A - let it inherit from event.

---

### C.6 Additional Event Emissions Needed

**File:** `events/kingdom.rs` (NEW) - Add:

```rust
/// Emitted when kingdom event is created
pub struct KingdomEventCreated {
    pub kingdom_id: u16,
    pub event_id: u64,
    pub event_type: u8,
    pub start_time: i64,
    pub end_time: i64,
    pub prize_pool: u64,
}

/// Emitted when arena season starts in kingdom
pub struct KingdomArenaSeasonStarted {
    pub kingdom_id: u16,
    pub season_id: u32,
    pub start_time: i64,
    pub end_time: i64,
    pub prize_pool: u64,
}

/// Emitted when dungeon leaderboard created for kingdom
pub struct KingdomDungeonLeaderboardCreated {
    pub kingdom_id: u16,
    pub dungeon_id: u16,
    pub week_number: u16,
    pub prize_pool: u64,
}
```

---

## Appendix D: TypeScript SDK Changes

The SDK at `/sdks/novus-mundus-ts` requires updates to match the on-chain program changes.

### D.1 PDA Derivation Functions

**File:** `src/pda.ts`

All these functions need `gameEngine: PublicKey` parameter added:

```typescript
// BEFORE
export function derivePlayerPda(owner: PublicKey): [PublicKey, number]
export function deriveEventPda(eventId: BN): [PublicKey, number]
export function deriveArenaSeasonPda(authority: PublicKey, seasonId: number): [PublicKey, number]
export function deriveDungeonLeaderboardPda(templateId: number, weekNumber: number): [PublicKey, number]
export function deriveCastlePda(cityId: number, castleId: number): [PublicKey, number]
export function deriveTeamPda(teamId: BN): [PublicKey, number]
export function deriveRallyPda(creator: PublicKey, rallyId: BN): [PublicKey, number]
export function deriveCityPda(cityId: number): [PublicKey, number]
export function deriveEncounterPda(city: PublicKey, encounterIndex: BN): [PublicKey, number]

// AFTER
export function deriveGameEnginePda(kingdomId: number): [PublicKey, number]
export function derivePlayerPda(gameEngine: PublicKey, owner: PublicKey): [PublicKey, number]
export function deriveEventPda(gameEngine: PublicKey, eventId: BN): [PublicKey, number]
export function deriveArenaSeasonPda(gameEngine: PublicKey, seasonId: number): [PublicKey, number]
export function deriveDungeonLeaderboardPda(gameEngine: PublicKey, templateId: number, weekNumber: number): [PublicKey, number]
export function deriveCastlePda(gameEngine: PublicKey, cityId: number, castleId: number): [PublicKey, number]
export function deriveTeamPda(gameEngine: PublicKey, teamId: BN): [PublicKey, number]
export function deriveRallyPda(gameEngine: PublicKey, rallyId: BN): [PublicKey, number]
export function deriveCityPda(gameEngine: PublicKey, cityId: number): [PublicKey, number]
export function deriveEncounterPda(gameEngine: PublicKey, cityId: number, x: number, y: number, encounterId: BN): [PublicKey, number]
export function deriveKingRegistryPda(gameEngine: PublicKey, king: PublicKey): [PublicKey, number]
export function deriveTeamInvitePda(gameEngine: PublicKey, inviter: PublicKey, invitee: PublicKey): [PublicKey, number]
export function deriveReinforcementPda(gameEngine: PublicKey, sender: PublicKey, receiver: PublicKey): [PublicKey, number]
```

**Implementation Example:**
```typescript
export function deriveGameEnginePda(kingdomId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.GAME_ENGINE, Buffer.from(new Uint16Array([kingdomId]).buffer)],
    PROGRAM_ID
  );
}

export function derivePlayerPda(gameEngine: PublicKey, owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.PLAYER, gameEngine.toBuffer(), owner.toBuffer()],
    PROGRAM_ID
  );
}

export function deriveEventPda(gameEngine: PublicKey, eventId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.EVENT, gameEngine.toBuffer(), eventId.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  );
}

export function deriveArenaSeasonPda(gameEngine: PublicKey, seasonId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.ARENA_SEASON, gameEngine.toBuffer(), Buffer.from(new Uint32Array([seasonId]).buffer)],
    PROGRAM_ID
  );
}
```

---

### D.2 State/Account Interfaces

**Files:** `src/state/*.ts`

Add `gameEngine: PublicKey` field to these interfaces:

| File | Interface | Add Field |
|------|-----------|-----------|
| `player.ts` | `PlayerCore` | `gameEngine: PublicKey` |
| `event.ts` | `EventAccount` | `gameEngine: PublicKey` |
| `arena.ts` | `ArenaSeasonAccount` | `gameEngine: PublicKey` (replace authority) |
| `arena.ts` | `ArenaParticipantAccount` | No change (inherits from season) |
| `dungeon.ts` | `DungeonLeaderboardAccount` | `gameEngine: PublicKey` |
| `castle.ts` | `CastleAccount` | `gameEngine: PublicKey` |
| `castle.ts` | `KingRegistryAccount` | `gameEngine: PublicKey` |
| `team.ts` | `TeamAccount` | `gameEngine: PublicKey` |
| `rally.ts` | `RallyAccount` | `gameEngine: PublicKey` |
| `city.ts` | `CityAccount` | `gameEngine: PublicKey` |
| `encounter.ts` | `EncounterAccount` | `gameEngine: PublicKey` |
| `reinforcement.ts` | `ReinforcementAccount` | `gameEngine: PublicKey` |

**Example Update:**
```typescript
// src/state/player.ts
export interface PlayerCore {
  gameEngine: PublicKey;      // NEW: Kingdom this player belongs to
  owner: PublicKey;
  createdAt: BN;
  bump: number;
  // ... rest unchanged
}

// Update deserialize function to read gameEngine at correct offset
export function deserializePlayerCore(data: Buffer): PlayerCore {
  let offset = 0;
  const gameEngine = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const owner = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  // ... rest of deserialization
}
```

---

### D.3 Client Methods

**File:** `src/client.ts`

Update all account fetching methods to accept `gameEngine`:

```typescript
// Player methods
async fetchPlayer(gameEngine: PublicKey, owner: PublicKey): Promise<PlayerCore | null>
async fetchAllPlayersInKingdom(gameEngine: PublicKey): Promise<PlayerCore[]>

// Event methods
async fetchEvent(gameEngine: PublicKey, eventId: BN): Promise<EventAccount | null>
async fetchAllEventsInKingdom(gameEngine: PublicKey): Promise<EventAccount[]>

// Arena methods
async fetchArenaSeason(gameEngine: PublicKey, seasonId: number): Promise<ArenaSeasonAccount | null>
async fetchArenaParticipant(gameEngine: PublicKey, seasonId: number, player: PublicKey): Promise<ArenaParticipantAccount | null>

// Dungeon methods
async fetchDungeonLeaderboard(gameEngine: PublicKey, templateId: number, weekNumber: number): Promise<DungeonLeaderboardAccount | null>

// Castle methods
async fetchCastle(gameEngine: PublicKey, cityId: number, castleId: number): Promise<CastleAccount | null>
async fetchAllCastlesInKingdom(gameEngine: PublicKey): Promise<CastleAccount[]>

// Team methods
async fetchTeam(gameEngine: PublicKey, teamId: BN): Promise<TeamAccount | null>
async fetchAllTeamsInKingdom(gameEngine: PublicKey): Promise<TeamAccount[]>

// Rally methods
async fetchRally(gameEngine: PublicKey, rallyId: BN): Promise<RallyAccount | null>
async fetchActiveRalliesInKingdom(gameEngine: PublicKey): Promise<RallyAccount[]>

// City methods
async fetchCity(gameEngine: PublicKey, cityId: number): Promise<CityAccount | null>
async fetchAllCitiesInKingdom(gameEngine: PublicKey): Promise<CityAccount[]>

// Encounter methods
async fetchEncounter(gameEngine: PublicKey, cityId: number, x: number, y: number, encounterId: BN): Promise<EncounterAccount | null>
async fetchEncountersInCity(gameEngine: PublicKey, cityId: number): Promise<EncounterAccount[]>
```

**Add Kingdom Helper Methods:**
```typescript
// New methods for kingdom management
async fetchGameEngine(kingdomId: number): Promise<GameEngine | null>
async fetchAllKingdoms(): Promise<GameEngine[]>
async getPlayerKingdom(owner: PublicKey): Promise<{ kingdomId: number; gameEngine: PublicKey } | null>
```

---

### D.4 Instruction Builders

**Files:** `src/instructions/*.ts`

All instruction builders that use affected PDAs need `gameEngine` parameter:

| File | Functions to Update |
|------|---------------------|
| `initialization.ts` | `initializePlayer()`, `initializeCity()` |
| `event.ts` | `createEvent()`, `joinEvent()`, `finalizeEvent()`, `claimEventPrize()` |
| `arena.ts` | `createArenaSeason()`, `joinArenaSeason()`, `arenaBattle()`, `claimArenaReward()` |
| `dungeon.ts` | `createDungeonLeaderboard()`, `claimDungeonLeaderboardPrize()` |
| `castle.ts` | All 20+ castle instruction builders |
| `team.ts` | `createTeam()`, `inviteMember()`, `acceptInvite()`, `joinTeam()`, etc. |
| `rally.ts` | `createRally()`, `joinRally()`, `startRally()`, `resolveRally()` |
| `encounter.ts` | `spawnEncounter()`, `attackEncounter()` |
| `combat.ts` | `attackPlayer()` - validate same kingdom |
| `travel.ts` | `startTravel()` - use kingdom city |
| `reinforcement.ts` | `sendReinforcement()`, `recallReinforcement()` |
| `economy.ts` | Functions that update event scores |
| `progression.ts` | Functions that use event PDAs |

**Example Update:**
```typescript
// src/instructions/event.ts

// BEFORE
export function createEventInstruction(
  payer: PublicKey,
  daoAuthority: PublicKey,
  eventId: BN,
  // ...params
): TransactionInstruction

// AFTER
export function createEventInstruction(
  payer: PublicKey,
  gameEngine: PublicKey,
  daoAuthority: PublicKey,
  eventId: BN,
  // ...params
): TransactionInstruction {
  const [eventPda] = deriveEventPda(gameEngine, eventId);
  // ...
}
```

---

### D.5 New Kingdom Instructions

**File:** `src/instructions/kingdom.ts` (NEW)

```typescript
export function initializeKingdomInstruction(
  payer: PublicKey,
  authority: PublicKey,
  kingdomId: number,
  kingdomName: string,
  theme: number,
  startTime: BN,
  registrationClosesAt: BN,
): TransactionInstruction;

export function initializeKingdomCitiesInstruction(
  payer: PublicKey,
  authority: PublicKey,
  gameEngine: PublicKey,
  startCityId: number,  // For batching: 1-8, 9-16, 17-24
): TransactionInstruction;

export function closeKingdomRegistrationInstruction(
  authority: PublicKey,
  gameEngine: PublicKey,
): TransactionInstruction;
```

---

### D.6 Types Updates

**File:** `src/types.ts` or `src/types/index.ts`

Add kingdom-related types:

```typescript
export interface KingdomConfig {
  kingdomId: number;
  gameEngine: PublicKey;
  name: string;
  theme: Theme;
  startTime: BN;
  registrationOpen: boolean;
  registrationClosesAt: BN;
}

export enum Theme {
  Medieval = 0,
  Cyberpunk = 1,
  SciFi = 2,
  Modern = 3,
  PostApocalyptic = 4,
}

// Helper for client initialization
export interface NovusMundusClientConfig {
  connection: Connection;
  wallet?: Wallet;
  kingdomId?: number;  // Default kingdom to use
}
```

---

### D.7 SDK File Summary

| Category | Files | Changes |
|----------|-------|---------|
| **PDA Functions** | 1 | Update 12+ derive functions |
| **State Interfaces** | 12 | Add gameEngine field |
| **Client Methods** | 1 | Update 20+ fetch methods |
| **Instruction Builders** | 23 | Update PDA derivation calls |
| **New Files** | 2 | `kingdom.ts`, types updates |
| **Tests** | 10+ | Update all affected tests |
| **Total** | **~50** | |

---

## Appendix E: Complete File Change Summary

Based on the detailed analysis, here is the complete list of files requiring changes:

### On-Chain Program (`programs/novus_mundus/`)

### State Files (15 files)

| File | Change Type | Priority |
|------|-------------|----------|
| `state/game_engine.rs` | Add kingdom_id, update PDA | 🔴 Critical |
| `state/player.rs` | Add game_engine, update PDA | 🔴 Critical |
| `state/city.rs` | Add game_engine, update PDA | 🔴 Critical |
| `state/event.rs` | Add game_engine, update PDA | 🔴 Critical |
| `state/arena.rs` | Replace authority with game_engine in all 3 accounts | 🔴 Critical |
| `state/dungeon.rs` | Add game_engine to DungeonLeaderboard | 🔴 Critical |
| `state/castle.rs` | Add game_engine to CastleAccount, KingRegistryAccount | 🟡 High |
| `state/team.rs` | Add game_engine to TeamAccount, TeamInviteAccount | 🟡 High |
| `state/rally.rs` | Add game_engine to RallyAccount | 🟡 High |
| `state/encounter.rs` | Add game_engine to EncounterAccount | 🟡 High |
| `state/reinforcement.rs` | Add game_engine to ReinforcementAccount | 🟢 Medium |
| `state/location.rs` | Add game_engine if exists | 🟢 Medium |

### Processor Files (~85 files)

| Module | Files | Change Type |
|--------|-------|-------------|
| `initialization/` | 5 files | Core restructure + new instructions |
| `event/` | 5 files | Add game_engine, validate kingdom |
| `arena/` | 7 files | Replace authority with game_engine |
| `dungeon/` | 4 files | Add game_engine to leaderboard ops |
| `castle/` | 22 files | Add game_engine, validate kingdom |
| `team/` | 10 files | Add game_engine, validate kingdom |
| `rally/` | 8 files | Add game_engine, validate kingdom |
| `encounter/` | 6 files | Add game_engine, validate kingdom |
| `combat/` | 5 files | Validate same kingdom |
| `travel/` | 4 files | Validate kingdom city |
| `reinforcement/` | 3 files | Add game_engine, validate kingdom |
| `shop/` | 8 files | Already scoped ✅ |
| Others | ~8 files | Validation only |

### Helper & Utility Files (5 files)

| File | Change |
|------|--------|
| `helpers/kingdom.rs` | NEW - validation helpers |
| `helpers/mod.rs` | Add kingdom module |
| `error.rs` | Add CrossKingdomAction errors |
| `constants.rs` | Add kingdom constants |
| `events/kingdom.rs` | NEW - kingdom events |

### Total Estimated Changes

| Category | Files | Lines |
|----------|-------|-------|
| State | 15 | ~800 |
| Processors | 85 | ~2500 |
| Helpers | 5 | ~200 |
| Events | 2 | ~150 |
| Tests | 50+ | ~3000 |
| **Total** | **~157** | **~6650** |

---

## Appendix E: Future Considerations

### E.1 Kingdom vs Kingdom (KvK)

Once multi-kingdom is stable, add:

1. `KvKSeasonAccount` - Cross-kingdom competition season
2. `KingdomStats` - Aggregate kingdom power/rankings
3. `KvKBattle` - Cross-kingdom battle records
4. Global Citadels - Special castles all kingdoms fight over

### Hero Cross-Kingdom

Options for hero NFTs:
1. **Current plan**: Same NFT, separate state per kingdom
2. **Alternative**: Hero "travels" between kingdoms (cooldown)
3. **Alternative**: Hero locked to first kingdom

### Economic Balance

Consider per-kingdom economic adjustments:
1. Different NOVI generation rates for newer kingdoms (catch-up mechanic)
2. Cross-kingdom NOVI trading restrictions
3. Kingdom-specific shop pricing
