# Rally System State Machine

## Overview

The Rally system coordinates team-based attacks across cities. Teams gather forces at a rally point, march to a target, execute combat, and return home with loot. The system uses separate RallyParticipant accounts for each joiner to track their committed units, weapons, and loot shares.

---

## 1. Rally Lifecycle

### States

| State | Value | Description |
|-------|-------|-------------|
| `Gathering` | 0 | Participants traveling to rally point |
| `Marching` | 1 | Army marching to target |
| `Combat` | 2 | Combat being resolved |
| `Returning` | 3 | Participants returning home |
| `Completed` | 4 | Rally finished, accounts closable |
| `Cancelled` | 5 | Rally cancelled, all returning |

### State Diagram

```
┌────────────────┐  create_rally   ┌────────────────┐
│                │ ──────────────> │                │
│  NonExistent   │                 │   Gathering    │◄──┐
│                │                 │   (status=0)   │   │ join_rally
└────────────────┘                 └───────┬────────┘───┘
                                           │
                                           │ gather_at elapsed
                                           │ (automatic start_march)
                                           ▼
                                   ┌────────────────┐
                                   │                │
                                   │    Marching    │
                                   │   (status=1)   │
                                   └───────┬────────┘
                                           │
                                           │ arrive_at elapsed
                                           ▼
                                   ┌────────────────┐
                                   │                │
                                   │    Combat      │ (execute_rally)
                                   │   (status=2)   │
                                   └───────┬────────┘
                                           │
                                           │ combat resolved
                                           ▼
                                   ┌────────────────┐
                                   │                │
                                   │   Returning    │◄──┐
                                   │   (status=3)   │   │ process_return
                                   └───────┬────────┘───┘
                                           │
                                           │ all_returned
                                           ▼
                                   ┌────────────────┐
                                   │                │
                                   │   Completed    │
                                   │   (status=4)   │
                                   └───────┬────────┘
                                           │
                                           │ close_rally
                                           ▼
                                   ┌────────────────┐
                                   │  NonExistent   │
                                   └────────────────┘
```

### Transitions

#### `NonExistent` → `Gathering`
```
Trigger: create_rally
Guards:
  - Creator on a team
  - Creator not traveling
  - EXT_INVENTORY unlocked (prerequisite for EXT_RALLY)
  - Citadel building level >= 1
  - Sufficient units committed (total > 0)
  - Sufficient weapons owned
  - gather_duration > 0
Actions:
  - Unlock EXT_RALLY if not unlocked
  - Create RallyAccount PDA: [RALLY_SEED, creator, rally_id]
  - Create RallyParticipant PDA: [RALLY_PARTICIPANT_SEED, creator, rally_id, creator]
  - Deduct units and weapons from creator
  - Snapshot leader buffs to RallyAccount
  - Calculate max_participants from tier + hero + citadel bonuses
  - Set status = Gathering
  - Update creator.rally_stats
  - Emit RallyCreated
```

#### `Gathering` → `Gathering` (Join)
```
Trigger: join_rally
Guards:
  - Rally status == Gathering
  - Joiner on same team as rally
  - Joiner not already joined
  - participant_count < max_participants
  - Sufficient units committed
Actions:
  - Create RallyParticipant PDA for joiner
  - Deduct units and weapons from joiner
  - Calculate travel time to rally point
  - Aggregate totals in RallyAccount
  - Update joiner.rally_stats.current_rallies_joined
  - Emit RallyJoined
```

#### `Gathering` → `Marching`
```
Trigger: start_march (or automatic at gather_at)
Guards:
  - now >= rally.gather_at
  - participant_count >= min_participants
  - At least some participants arrived at rally point
Actions:
  - Mark all arrived participants as included_in_march
  - Calculate march duration based on distance
  - Set rally.march_started_at = now
  - Set rally.arrive_at = now + march_duration
  - Set status = Marching
  - Emit MarchStarted
```

#### `Marching` → `Returning`
```
Trigger: execute_rally
Guards:
  - Rally status == Gathering OR Marching
  - now >= rally.execute_at
  - participant_count >= MIN_RALLY_PARTICIPANTS
  - Target matches rally.target
Actions:
  - Aggregate power from arrived participants only
  - Calculate total damage with leader buffs + citadel bonus
  - Execute combat based on target_type:
    - 0 (Player): Full weapon combat mechanics
    - 1 (Encounter): Damage encounter health, calculate loot pool
  - Distribute casualties proportionally by contribution
  - Distribute loot shares proportionally (only if attacker won)
  - Set return_started_at for all participants
  - Set status = Returning
  - Emit RallyExecuted
```

#### `Returning` → `Completed`
```
Trigger: process_return (per participant, multiple times)
Guards:
  - Rally status == Returning
  - Participant included_in_march
  - now >= return_started_at + return_duration
  - Participant not yet returned
Actions:
  - Return surviving units to player
  - Return surviving weapons (proportional to survival)
  - Grant loot share to player
  - Mark participant as returned
  - Increment rally.returned_count
  - Close RallyParticipant account (refund rent)
  - Emit ParticipantReturned

Final transition when rally.all_returned():
  - Set status = Completed
```

#### `Completed` → `NonExistent`
```
Trigger: close_rally
Guards:
  - Rally status == Completed OR Cancelled
  - rally.all_returned()
Actions:
  - Close RallyAccount (refund rent to creator)
  - Emit RallyClosed
```

---

## 2. Cancellation Flow

### Transitions

#### `Gathering` → `Cancelled`
```
Trigger: cancel_rally
Guards:
  - Rally status == Gathering
  - Caller is creator
Actions:
  - Set status = Cancelled
  - Set return_started_at for all participants
  - Emit RallyCancelled
```

#### `Gathering/Marching` → (Leave)
```
Trigger: leave_rally
Guards:
  - Rally status == Gathering OR Marching
  - Participant is not leader (cannot abandon own rally)
Actions:
  - Return committed units and weapons immediately
  - Update player.rally_stats.current_rallies_joined
  - Decrement rally totals
  - Decrement rally.participant_count
  - Close RallyParticipant account
  - Emit ParticipantLeft
```

---

## 3. Participant State Machine

### States

| State | Description |
|-------|-------------|
| `Traveling` | Moving to rally point |
| `AtRally` | Arrived at rally point, waiting |
| `Marching` | Included in march to target |
| `Returning` | Returning home |
| `Returned` | Back home, account closable |

### State Diagram

```
┌────────────────┐  join_rally   ┌────────────────┐
│                │ ────────────> │                │
│  NonExistent   │               │   Traveling    │
│                │               │ (to rally pt)  │
└────────────────┘               └───────┬────────┘
       ▲                                 │
       │                                 │ arrives_at_rally elapsed
       │                                 ▼
       │                         ┌────────────────┐
       │                         │                │
       │                         │    AtRally     │
       │                         │ (waiting)      │
       │                         └───────┬────────┘
       │                                 │
       │                                 │ start_march
       │                                 ▼
       │                         ┌────────────────┐
       │                         │                │
       │                         │   Marching     │
       │                         │(to target)     │
       │                         └───────┬────────┘
       │                                 │
       │                                 │ execute_rally
       │                                 ▼
       │                         ┌────────────────┐
       │                         │                │
       │                         │   Returning    │
       │                         │ (going home)   │
       │                         └───────┬────────┘
       │                                 │
       │                                 │ process_return
       │                                 ▼
       │                         ┌────────────────┐
       │                         │                │
       │ account closed          │   Returned     │
       └─────────────────────────│                │
                                 └────────────────┘
```

---

## 4. Speedup System

### Travel Speedup (To Rally Point)
```
Trigger: speedup_rally_travel
Guards:
  - Participant traveling to rally
  - not arrived_at_rally
  - Sufficient gems
Actions:
  - Calculate time reduction (50% or 75%)
  - Deduct gems
  - Adjust arrives_at_rally
  - Emit TravelSpeedup
```

### March Speedup
```
Trigger: speedup_rally
Guards:
  - Rally status == Marching
  - Caller is creator
  - Sufficient gems
Actions:
  - Calculate time reduction
  - Deduct gems from creator
  - Adjust rally.arrive_at
  - Emit MarchSpeedup
```

---

## 5. Target Types

| Type | Value | Target | Combat Resolution |
|------|-------|--------|-------------------|
| Player | 0 | PlayerAccount | Full weapon combat, loot from player |
| Encounter | 1 | EncounterAccount | Damage health, loot pool on defeat |
| Castle | 2 | CastleAccount | (Kings Castle extension) |

---

## 6. Account Structures

### RallyAccount (304 bytes)
```rust
pub struct RallyAccount {
    // Identity (48 bytes)
    pub id: u64,
    pub creator: Pubkey,
    pub team: Pubkey,

    // Location (8 bytes)
    pub rally_city: u16,
    pub target_city: u16,
    pub target_type: u8,

    // Target (32 bytes)
    pub target: Pubkey,

    // Timing (48 bytes)
    pub created_at: i64,
    pub gather_at: i64,
    pub execute_at: i64,
    pub march_started_at: i64,
    pub arrive_at: i64,
    pub march_duration: i32,

    // Leader buffs (16 bytes)
    pub leader_research_attack_bps: u16,
    pub leader_research_crit_chance_bps: u16,
    pub leader_research_crit_damage_bps: u16,
    pub leader_hero_attack_bps: u16,
    pub leader_hero_weapon_efficiency_bps: u16,
    pub leader_hero_crit_chance_bps: u16,
    pub leader_equipped_weapon_bonus_bps: u16,

    // Participants (8 bytes)
    pub min_participants: u8,
    pub max_participants: u8,
    pub participant_count: u8,
    pub arrived_count: u8,
    pub marched_count: u8,
    pub returned_count: u8,

    // Aggregated totals (40 bytes)
    pub total_units: u64,
    pub total_melee_weapons: u64,
    pub total_ranged_weapons: u64,
    pub total_siege_weapons: u64,
    pub total_power: u64,

    // Combat results (24 bytes)
    pub total_casualties: u64,
    pub attack_damage_dealt: u64,
    pub defense_damage_received: u64,

    // Loot totals (96 bytes)
    pub total_loot_cash: u64,
    pub total_loot_locked_novi: u64,
    pub total_loot_melee: u64,
    pub total_loot_ranged: u64,
    pub total_loot_siege: u64,
    pub total_loot_produce: u64,
    pub total_loot_vehicles: u64,
    pub total_loot_fragments: u64,
    pub total_loot_gems: u64,

    // Status (8 bytes)
    pub status: u8,
    pub fallback_triggered: bool,
    pub attacker_won: bool,
    pub bump: u8,
}
```

### RallyParticipant (320 bytes)
```rust
pub struct RallyParticipant {
    // Identity (48 bytes)
    pub rally_id: u64,
    pub rally_creator: Pubkey,
    pub participant: Pubkey,

    // Home (4 bytes)
    pub home_city: u16,

    // Units committed (24 bytes)
    pub units_committed_1: u64,
    pub units_committed_2: u64,
    pub units_committed_3: u64,

    // Weapons committed (24 bytes)
    pub melee_weapons_committed: u64,
    pub ranged_weapons_committed: u64,
    pub siege_weapons_committed: u64,

    // Buffs (16 bytes)
    pub research_attack_bps: u16,
    pub research_crit_chance_bps: u16,
    pub research_crit_damage_bps: u16,
    pub hero_attack_bps: u16,
    pub hero_weapon_efficiency_bps: u16,
    pub hero_crit_chance_bps: u16,
    pub equipped_weapon_bonus_bps: u16,

    // Hero (40 bytes)
    pub hero: Pubkey,
    pub hero_power_contribution: u64,

    // Travel (24 bytes)
    pub travel_started_at: i64,
    pub arrives_at_rally: i64,
    pub travel_duration: i32,

    // Status (8 bytes)
    pub arrived_at_rally: bool,
    pub included_in_march: bool,
    pub returned: bool,
    pub is_leader: bool,

    // Casualties (24 bytes)
    pub casualties_1: u64,
    pub casualties_2: u64,
    pub casualties_3: u64,

    // Loot share (96 bytes)
    pub loot_cash: u64,
    pub loot_locked_novi: u64,
    pub loot_melee: u64,
    pub loot_ranged: u64,
    pub loot_siege: u64,
    pub loot_produce: u64,
    pub loot_vehicles: u64,
    pub loot_fragments: u64,
    pub loot_gems: u64,

    // Return journey (16 bytes)
    pub return_started_at: i64,
    pub return_duration: i32,

    // Contribution (16 bytes)
    pub contribution_power: u64,
    pub contribution_bps: u16,
    pub bump: u8,
}
```

---

## 7. Building Requirements

### Creating Rallies
- **Citadel (Estate Level 12+)**: Required to create rallies
- **Citadel Level Bonus**: +2% rally capacity per level
- **Citadel Damage Bonus**: +0.5% rally damage per level

### Joining Rallies
- No building requirements to join
- Must be on same team as rally creator

---

## 8. Loot Distribution

### Contribution Calculation
```
contribution = units_committed + weapons_committed
contribution_bps = (participant_contribution × 10000) / total_contribution
```

### Loot Share Formula
```
participant_loot = (total_loot × contribution_bps) / 10000
```

### Casualty Distribution
```
participant_casualties = (total_casualties × participant_contribution) / total_contribution
```

---

## 9. Invariants

```
1. rally.creator must be team member
2. All participants must be on rally.team
3. participant_count <= max_participants
4. arrived_count <= participant_count
5. marched_count <= arrived_count
6. returned_count <= marched_count
7. Leader cannot leave their own rally
8. Units/weapons are locked in RallyParticipant until return
9. Loot only distributed if attacker_won == true
10. Rally can only close when all_returned()
```
