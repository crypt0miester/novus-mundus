# Rally System Documentation

## Overview

The Rally system enables coordinated team attacks against players or encounters. Multiple participants pool their units and weapons for a combined assault, with loot distributed proportionally based on contribution.

## Key Concepts

### Accounts

| Account | Description | Paid By |
|---------|-------------|---------|
| `RallyAccount` | Stores rally state, targets, totals, loot | Leader (refunded on close) |
| `RallyParticipant` | Per-participant state, committed units/weapons, loot share | Each participant (refunded on return) |

### Rally Status Lifecycle

```
Gathering → Marching → Combat → Returning → Completed
    ↓                                           ↓
Cancelled ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←
```

| Status | Description |
|--------|-------------|
| `Gathering` (0) | Participants joining, traveling to rally point |
| `Marching` (1) | Army marching to target (not currently used, execute transitions directly) |
| `Combat` (2) | Combat resolution in progress |
| `Returning` (3) | Participants traveling back home |
| `Completed` (4) | All participants returned, rally can be closed |
| `Cancelled` (5) | Rally cancelled, participants returning |

### Key Counters

| Field | Description |
|-------|-------------|
| `participant_count` | Current participants (decremented by `leave`) |
| `arrived_count` | Participants at rally point |
| `marched_count` | Participants included in the attack |
| `returned_count` | Participants who completed return journey |

---

## Instruction Reference

| Discriminant | Instruction | Description |
|--------------|-------------|-------------|
| 60 | `create` | Create rally, auto-join as leader |
| 61 | `join` | Join existing rally |
| 62 | `execute` | Resolve combat at target |
| 63 | `leave` | Leave during Gathering phase |
| 64 | `cancel` | Cancel rally (leader only) |
| 65 | `process_return` | Complete return, receive units/loot |
| 66 | `speedup` | Speed up gather/march/return with gems |
| 67 | `close_rally` | Close rally account, refund rent |

---

## User Journeys

### 1. Leader Journey

The leader creates and commands the rally.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LEADER JOURNEY                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌────────┐│
│  │  CREATE  │───→│  WAIT    │───→│ EXECUTE  │───→│  RETURN  │───→│ CLOSE  ││
│  │  RALLY   │    │  (gather)│    │  COMBAT  │    │  HOME    │    │ RALLY  ││
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘    └────────┘│
│       │               │                               │                     │
│       │               │ (optional)                    │                     │
│       │               ↓                               │                     │
│       │         ┌──────────┐                          │                     │
│       │         │  CANCEL  │──────────────────────────┘                     │
│       │         │  RALLY   │                                                │
│       │         └──────────┘                                                │
│       │                                                                     │
│       └── Pays rent for RallyAccount + RallyParticipant                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Step 1: Create Rally (`create.rs`, discriminant 60)

**What happens:**
1. Leader specifies target (player/encounter), gather duration, units, weapons
2. `RallyAccount` created (leader pays rent)
3. `RallyParticipant` created for leader (leader pays rent)
4. Units/weapons deducted from leader's `PlayerAccount`
5. Buffs snapshotted (research, hero, equipment bonuses)
6. Travel time calculated from leader's position to rally point (city center)
7. Status set to `Gathering`

**Accounts:**
```
0. [WRITE] creator_player
1. [WRITE] rally_account (PDA to create)
2. [WRITE] participant_account (PDA to create)
3. [SIGNER, WRITE] creator_owner
4. [] game_engine
5. [] rally_city_account
6. [] system_program
```

**Instruction Data (99 bytes):**
```
rally_id: u64
target: Pubkey
target_type: u8 (0=player, 1=encounter)
gather_duration: i64 (seconds)
target_city: u16
units_1: u64
units_2: u64
units_3: u64
melee: u64
ranged: u64
siege: u64
```

#### Step 2: Wait for Participants

Leader waits until `gather_at` timestamp. Can optionally:
- **Speedup** other participants' travel to rally point
- **Cancel** the rally if needed

#### Step 3: Execute Rally (`execute.rs`, discriminant 62)

**Requirements:**
- Current time >= `execute_at` (same as `gather_at`)
- Minimum participants met
- All `RallyParticipant` accounts passed

**What happens:**
1. All participants who arrived are marked `included_in_march = true`
2. Aggregates total units/weapons from all marchers
3. Calculates total damage using leader's buffs
4. Resolves combat against target
5. Distributes casualties proportionally
6. Distributes loot proportionally (by `contribution_bps`)
7. Sets `return_started_at` and `return_duration` for each marcher
8. Status → `Returning`

**Accounts:**
```
0. [WRITE] rally_account
1. [WRITE] target (PlayerAccount or EncounterAccount)
2. [] game_engine
3..N. [WRITE] rally_participant accounts (all participants)
```

#### Step 4: Return Home (`process_return.rs`, discriminant 65)

**Requirements:**
- Rally status is `Returning`, `Completed`, or `Cancelled`
- Return journey complete (`now >= return_started_at + return_duration`)

**What happens:**
1. Surviving units returned (committed - casualties)
2. Surviving weapons returned (proportional to survival rate)
3. Looted weapons/resources added (if won)
4. `locked_novi` added directly to player
5. `RallyParticipant` account closed, rent refunded
6. `returned_count` incremented
7. If all participants returned → Status → `Completed`

**Accounts:**
```
0. [WRITE] rally_account
1. [WRITE] rally_participant
2. [WRITE] player_account
3. [SIGNER] participant_owner
4. [] game_engine
5. [] rally_city_account
6. [] home_city_account
```

#### Step 5: Close Rally (`close_rally.rs`, discriminant 67)

**Requirements:**
- Status is `Completed` or `Cancelled`
- `returned_count >= participant_count`

**What happens:**
1. `RallyAccount` zeroed out
2. Rent refunded to leader

**Note:** Anyone can call this instruction (permissionless cranking). The rent always goes to the leader.

**Accounts:**
```
0. [WRITE] rally_account
1. [WRITE] leader_owner (must match rally.creator, receives rent)
```

---

### 2. Joiner Journey

A teammate joins an existing rally.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              JOINER JOURNEY                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │   JOIN   │───→│  TRAVEL  │───→│  (wait)  │───→│  RETURN  │              │
│  │  RALLY   │    │ to rally │    │ execute  │    │  HOME    │              │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘              │
│       │               │                               ↑                     │
│       │               │ (optional)                    │                     │
│       │               ↓                               │                     │
│       │         ┌──────────┐                          │                     │
│       │         │  LEAVE   │──────────────────────────┘                     │
│       │         │  EARLY   │                                                │
│       │         └──────────┘                                                │
│       │                                                                     │
│       └── Pays rent for RallyParticipant                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Step 1: Join Rally (`join.rs`, discriminant 61)

**Requirements:**
- Rally status is `Gathering`
- Current time < `gather_at`
- Rally not full (`participant_count < max_participants`)
- Not already in rally

**What happens:**
1. `RallyParticipant` created (joiner pays rent)
2. Units/weapons deducted from joiner's `PlayerAccount`
3. Buffs snapshotted
4. Travel time calculated based on:
   - Same city: Intracity walking (5 km/h)
   - Different city: Intercity travel (theme speed)
5. `arrived_at_rally` set to `true` only if travel time = 0
6. Rally totals updated

**Accounts:**
```
0. [WRITE] player_account
1. [WRITE] rally_account
2. [WRITE] participant_account (PDA to create)
3. [SIGNER, WRITE] player_owner
4. [] game_engine
5. [] rally_city_account
6. [] system_program
```

**Instruction Data (48 bytes):**
```
units_1: u64
units_2: u64
units_3: u64
melee: u64
ranged: u64
siege: u64
```

#### Step 2: Travel to Rally Point

Joiner automatically travels to rally point. Can optionally:
- **Speedup** travel with gems
- **Leave** to get full units/weapons back

#### Step 3: Wait for Execute

If arrived before `gather_at`, joiner is included in the march.

#### Step 4: Return Home

Same as leader - call `process_return` when return journey completes.

---

### 3. Early Leaver Journey

A participant leaves during the Gathering phase.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EARLY LEAVER JOURNEY                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │   JOIN   │───→│  TRAVEL  │───→│  LEAVE   │───→│  RETURN  │              │
│  │  RALLY   │    │ to rally │    │  EARLY   │    │  HOME    │              │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘              │
│                                                                             │
│  Result: Full units and weapons returned (no combat losses)                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Leave Rally (`leave.rs`, discriminant 63)

**Requirements:**
- Rally status is `Gathering`
- Caller is NOT the creator (creator must use `cancel`)
- Not already returning

**What happens:**
1. `participant_count` decremented
2. If arrived, `arrived_count` decremented
3. Rally totals reduced by participant's committed units/weapons
4. Return journey started:
   - If at rally point: Calculate return to home city
   - If mid-travel: Turn around (return time = time spent)
5. `included_in_march = false`

**Accounts:**
```
0. [WRITE] rally_account
1. [WRITE] participant_account
2. [] player_account
3. [SIGNER] player_owner
4. [] rally_city_account
5. [] home_city_account
6. [] game_engine
```

#### Process Return (after leaving)

Early leavers call `process_return` to get their full units/weapons back (no casualties).

---

### 4. Late Joiner Journey

A participant who joined but didn't arrive in time for the march.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LATE JOINER JOURNEY                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │   JOIN   │───→│  TRAVEL  │───→│  RETURN  │───→│  PROCESS │              │
│  │  RALLY   │    │ (slow)   │    │  EARLY   │    │  RETURN  │              │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘              │
│                       │               ↑                                     │
│                       │               │ Can return during Gathering!        │
│                       │               │ (knows they won't make it)          │
│                       └───────────────┘                                     │
│                                                                             │
│  Result: Full units and weapons returned (wasn't in combat)                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### What Makes a Late Joiner

- Joined the rally
- `arrives_at_rally` > `gather_at` (travel time too long)
- When `execute` runs, `arrived_at_rally = false`
- NOT marked `included_in_march`

#### Early Return (During Gathering)

Late joiners can call `process_return` during `Gathering` phase if they know they won't arrive in time:

1. System checks `arrives_at_rally > gather_at` (late joiner)
2. Decrements `participant_count`, `arrived_count`, and rally totals
3. Starts return journey
4. Returns error `ReturnNotComplete` if duration > 0
5. Second call (after duration) processes return

#### Return After Execute

Late joiners can also wait and call `process_return` after rally is `Returning` or `Completed`:

1. First call starts their return journey (calculates duration)
2. Returns error `ReturnNotComplete` if duration > 0
3. Second call (after duration) processes return:
   - Full units/weapons returned
   - No loot (didn't participate in combat)
   - `returned_count` incremented

---

### 5. Cancelled Rally Flow

When leader cancels the rally.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CANCELLED RALLY FLOW                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  LEADER:                                                                    │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │  CANCEL  │───→│  RETURN  │───→│  PROCESS │───→│  CLOSE   │              │
│  │  RALLY   │    │  (auto)  │    │  RETURN  │    │  RALLY   │              │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘              │
│                                                                             │
│  PARTICIPANTS:                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                              │
│  │  (rally  │───→│  PROCESS │───→│  RETURN  │                              │
│  │cancelled)│    │  RETURN  │    │  HOME    │                              │
│  └──────────┘    └──────────┘    └──────────┘                              │
│                       │                                                     │
│                       └── First call starts return journey                 │
│                           Second call processes return                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Cancel Rally (`cancel.rs`, discriminant 64)

**Requirements:**
- Caller is rally creator
- Status is `Gathering`
- Current time < `gather_at`

**What happens:**
1. Status → `Cancelled`
2. Leader's return journey started
3. Other participants must call `process_return`

---

## Speedup System (`speedup.rs`, discriminant 66)

Speed up various travel phases with gems.

### Speedup Types

| Type | Value | Description | Who Can Pay |
|------|-------|-------------|-------------|
| `SPEEDUP_GATHER` | 0 | Travel to rally point | ANYONE |
| `SPEEDUP_MARCH` | 1 | March to target | ANYONE |
| `SPEEDUP_RETURN` | 2 | Return home | ANYONE |

**Note:** All speedup types are permissionless - anyone willing to spend their gems can speed up any participant/rally.

### Tier System

| Tier | Time Remaining | Gem Cost Multiplier |
|------|----------------|---------------------|
| 1 | 50% | 1x |
| 2 | 25% | 2x |
| 3 | 12.5% | 4x |

**Formula:**
```
gems_cost = remaining_minutes × gem_cost_per_minute × tier_multiplier
```

---

## Travel Time Calculations

### Intracity (Same City)

Walking speed: **5 km/h** (`INTRACITY_WALKING_SPEED_KMH`)

```rust
travel_time_seconds = (distance_km / 5.0) * 3600
```

### Intercity (Different Cities)

Theme-based speed from `game_engine.gameplay_config.theme_travel_speeds_kmh[current_theme]`

```rust
travel_time_seconds = (distance_km / theme_speed) * 3600
```

### Distance Calculation

Uses Haversine formula for great-circle distance between coordinates.

---

## Loot Distribution

### Contribution Calculation

```rust
contribution = units_committed + melee_committed + ranged_committed + siege_committed
contribution_bps = (participant_contribution × 10000) / total_contribution
```

### Loot Share

```rust
participant_loot = (total_loot × contribution_bps) / 10000
```

### Casualty Distribution

```rust
participant_casualties = (total_casualties × participant_contribution) / total_contribution
```

---

## Edge Cases

### 1. Rally with all late joiners
- No one marked `included_in_march`
- `marched_count = 0`
- No combat occurs
- All get full units back

### 2. Cancelled rally
- Status stays `Cancelled` (doesn't become `Completed`)
- Non-leader participants need to call `process_return` to start their return
- First call calculates and starts return journey
- Second call (after travel) processes return

### 3. Close before all returned (PREVENTED)
- `can_close()` checks `returned_count >= participant_count`
- Cannot close until everyone has called `process_return`

### 4. Early leaver during Gathering
- `participant_count` decremented
- Rally totals reduced
- Full units/weapons returned
- Doesn't affect `returned_count` or `marched_count`

---

## Account Cleanup

| Account | Closed By | Rent Goes To |
|---------|-----------|--------------|
| `RallyParticipant` | `process_return` | Participant |
| `RallyAccount` | `close_rally` | Leader |

---

## Security Notes

1. **Units/weapons locked at join** - Cannot be sold/transferred while committed
2. **Buffs snapshotted** - Can't game by buffing after join
3. **process_return is permissionless** - Anyone can crank, but units/loot go to correct participant
4. **close_rally is permissionless** - Anyone can crank, but rent always goes to leader
5. **speedup is permissionless** - Anyone can pay gems to speed up any participant/rally
6. **Travel times calculated** - No instant returns, always requires travel
7. **PDA validation** - All accounts derived deterministically
8. **Late joiner early return** - Late joiners can exit during Gathering, properly decrements counts
