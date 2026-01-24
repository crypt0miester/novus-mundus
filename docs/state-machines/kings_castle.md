# Kings Castle State Machine

## Overview

This document defines the complete state machine for the Kings Castle system, including all states, transitions, guards, and side effects.

---

## Table of Contents

1. [Castle Lifecycle](#1-castle-lifecycle)
2. [Garrison Membership](#2-garrison-membership)
3. [Court Position](#3-court-position)
4. [Upgrade System](#4-upgrade-system)
5. [Combat (Rally Attack)](#5-combat-rally-attack)
6. [Ownership Transition](#6-ownership-transition)
7. [Reward Claims](#7-reward-claims)
8. [Hero Escrow](#8-hero-escrow)
9. [King Registry](#9-king-registry)
10. [Composite State Diagram](#10-composite-state-diagram)

---

## 1. Castle Lifecycle

### States

| State | Value | Description |
|-------|-------|-------------|
| `Vacant` | 0 | No king, castle can be claimed |
| `Contest` | 1 | 2-hour challenge window, no rewards, attackable |
| `Protected` | 2 | 10-day immunity, rewards active, not attackable |
| `Vulnerable` | 3 | Rewards active, attackable forever |
| `Transitioning` | 4 | Ownership change in progress, multi-phase cleanup |

### State Diagram

```
                                    ┌─────────────────────────────────────────────────────────┐
                                    │                                                         │
                                    ▼                                                         │
┌──────────────┐  claim_vacant   ┌──────────────┐  2h elapsed    ┌──────────────┐            │
│              │ ─────────────>  │              │ ─────────────> │              │            │
│    Vacant    │                 │   Contest    │                │  Protected   │            │
│              │ <───────────────│              │                │              │            │
└──────────────┘  transition     └──────┬───────┘                └──────┬───────┘            │
       ▲          complete              │                               │                    │
       │          (no new king)         │                               │ 10d elapsed        │
       │                                │                               ▼                    │
       │                                │ loses              ┌──────────────┐                │
       │                                │ combat             │              │                │
       │                                │                    │  Vulnerable  │────────────────┤
       │                                ▼                    │              │  loses combat  │
       │                         ┌──────────────┐            └──────────────┘                │
       │                         │              │                                            │
       │ transition              │Transitioning │<───────────────────────────────────────────┘
       │ complete                │              │
       │ (force_remove)          └──────┬───────┘
       │                                │
       └────────────────────────────────┘
                                 transition complete
                                 (new king installed)
                                        │
                                        │
                                        ▼
                                 ┌──────────────┐
                                 │   Contest    │
                                 │  (new king)  │
                                 └──────────────┘
```

### Transitions

#### `Vacant` → `Contest`
```
Trigger: claim_vacant_castle instruction
Guards:
  - Claimant is team leader
  - Claimant.level >= castle.min_level
  - Claimant.networth >= castle.min_networth_millions * 1_000_000
  - Claimant.total_units >= castle.min_troops_thousands * 1_000
  - KingRegistry.castle_count < KingRegistry.max_castles
Actions:
  - castle.king = claimant
  - castle.team = claimant.team
  - castle.claimed_at = now
  - castle.contest_end_at = now + CASTLE_CONTEST_DURATION
  - castle.status = Contest
  - castle.garrison_count = 1
  - castle.max_garrison = GARRISON_CAP_BY_TIER[claimant.subscription_tier]
  - Create GarrisonContributionAccount for king (is_king = true)
  - Create or update KingRegistryAccount
  - Emit CastleClaimed
```

#### `Contest` → `Protected`
```
Trigger: Time elapsed (automatic on next interaction)
Guards:
  - now >= castle.contest_end_at
  - castle.status == Contest
Actions:
  - castle.status = Protected
  - Emit CastleContestEnded
```

#### `Protected` → `Vulnerable`
```
Trigger: Time elapsed (automatic on next interaction)
Guards:
  - now >= castle.contest_end_at + castle.protection_duration
  - castle.status == Protected
Actions:
  - castle.status = Vulnerable
  - Emit CastleProtectionExpired
```

#### `Contest` → `Transitioning` (Combat Loss)
```
Trigger: execute_rally (attackers win)
Guards:
  - castle.status == Contest
  - attack_power > defense_power
Actions:
  - castle.status = Transitioning
  - castle.transition_new_king = rally.creator
  - castle.transition_garrison_cleaned = 0
  - castle.transition_court_cleaned = false
  - castle.transition_rewards_cleaned = 0
  - Cancel any in-progress upgrade (upgrade_type = 0, upgrade_end_at = 0)
  - Emit CastleTransitionStarted
```

#### `Vulnerable` → `Transitioning` (Combat Loss)
```
Trigger: execute_rally (attackers win)
Guards:
  - castle.status == Vulnerable
  - attack_power > defense_power
Actions:
  - (Same as Contest → Transitioning)
```

#### `Transitioning` → `Contest` (New King)
```
Trigger: crank_finalize_transition
Guards:
  - castle.status == Transitioning
  - castle.transition_garrison_cleaned == previous_garrison_count
  - castle.transition_court_cleaned == true
  - castle.transition_rewards_cleaned >= required_count
  - castle.transition_new_king != NULL_PUBKEY
Actions:
  - old_king_registry.remove_castle(castle)
  - castle.king = castle.transition_new_king
  - castle.team = new_king.team
  - castle.claimed_at = now
  - castle.contest_end_at = now + CASTLE_CONTEST_DURATION
  - castle.status = Contest
  - castle.garrison_count = 1
  - Create GarrisonContributionAccount for new king
  - Update new king's KingRegistryAccount
  - Clear transition fields
  - Emit CastleTransitionComplete
```

#### `Transitioning` → `Vacant` (Force Remove)
```
Trigger: crank_finalize_transition (DAO force_remove case)
Guards:
  - castle.status == Transitioning
  - All cleanup complete
  - castle.transition_new_king == NULL_PUBKEY (set by force_remove_king)
Actions:
  - castle.king = NULL_PUBKEY
  - castle.team = NULL_PUBKEY
  - castle.status = Vacant
  - castle.garrison_count = 0
  - Clear all transition fields
  - Emit CastleTransitionComplete (vacant = true)
```

---

## 2. Garrison Membership

### States (Per Player)

| State | Description |
|-------|-------------|
| `NotInGarrison` | Player has no GarrisonContributionAccount for this castle |
| `InGarrison` | Player has active GarrisonContributionAccount |
| `InGarrisonAsKing` | Player is king, cannot leave voluntarily |

### State Diagram

```
                                  ┌───────────────────────────────────────┐
                                  │                                       │
                                  ▼                                       │
┌────────────────┐  join      ┌────────────────┐                         │
│                │ ────────>  │                │  leave_garrison         │
│ NotInGarrison  │            │  InGarrison    │ ─────────────────────>──┤
│                │ <────────  │                │                         │
└────────────────┘  relieve   └────────────────┘                         │
       ▲              or                                                 │
       │           transition                                            │
       │           cleanup                                               │
       │                                                                 │
       │           transition                                            │
       │           cleanup     ┌────────────────┐                        │
       └───────────────────────│                │                        │
                               │InGarrisonAsKing│                        │
       ┌───────────────────────│                │                        │
       │  claim_vacant_castle  └────────────────┘                        │
       │  (becomes king)              ▲                                  │
       │                              │                                  │
       │                              │ claim_vacant_castle              │
       │                              │ (king of new castle)             │
       ▼                              │                                  │
┌────────────────┐                    │                                  │
│ NotInGarrison  │────────────────────┘                                  │
│ (this castle)  │                                                       │
└────────────────┘                                                       │
                                                                         │
                                           ┌─────────────────────────────┘
                                           │ relieve_garrison
                                           │ (king can relieve others)
                                           ▼
                                    ┌────────────────┐
                                    │ NotInGarrison  │
                                    └────────────────┘
```

### Transitions

#### `NotInGarrison` → `InGarrison`
```
Trigger: join_garrison
Guards:
  - castle.status in [Contest, Protected, Vulnerable]
  - player.team == castle.team
  - castle.garrison_count < castle.max_garrison
  - GarrisonContributionAccount does not exist
  - units_1 + units_2 + units_3 > 0  // Must contribute something
Actions:
  - Deduct units from player: player.defensive_unit_X -= contribution.units_X
  - Deduct weapons from player: player.melee_weapons -= contribution.melee_weapons
  - If hero_mint provided: Transfer hero NFT to GarrisonContributionAccount PDA
  - Create GarrisonContributionAccount
  - castle.garrison_count += 1
  - Emit GarrisonJoined
```

#### `NotInGarrison` → `InGarrisonAsKing`
```
Trigger: claim_vacant_castle
Guards:
  - (See Castle Lifecycle: Vacant → Contest)
Actions:
  - (See Castle Lifecycle)
  - GarrisonContributionAccount.is_king = true
```

#### `InGarrison` → `NotInGarrison` (Voluntary)
```
Trigger: leave_garrison
Guards:
  - GarrisonContributionAccount.is_king == false
  - castle.status != Transitioning
Actions:
  - Return units to player: player.defensive_unit_X += contribution.units_X
  - Return weapons to player: player.melee_weapons += contribution.melee_weapons
  - If contribution.hero_mint != NULL: Transfer hero NFT back to player
  - If contribution has unclaimed loot: Transfer loot to player first
  - Close GarrisonContributionAccount (rent to player)
  - castle.garrison_count -= 1
  - Emit GarrisonLeft
```

#### `InGarrison` → `NotInGarrison` (Relieved)
```
Trigger: relieve_garrison
Guards:
  - Caller is castle.king
  - Target != castle.king (king cannot relieve self)
  - castle.status != Transitioning
Actions:
  - (Same as leave_garrison)
  - Emit GarrisonRelieved
```

#### `InGarrison` / `InGarrisonAsKing` → `NotInGarrison` (Transition Cleanup)
```
Trigger: crank_garrison_cleanup
Guards:
  - castle.status == Transitioning
Actions:
  - Return units to contributor
  - Return weapons to contributor
  - If hero_mint != NULL: Transfer hero NFT back to contributor
  - Close GarrisonContributionAccount (rent to contributor)
  - castle.transition_garrison_cleaned += 1
```

---

## 3. Court Position

### States (Per Player, Global)

| State | Description |
|-------|-------------|
| `NoPosition` | Player holds no court position anywhere |
| `HoldsPosition` | Player holds one court position at one castle |

### State Diagram

```
┌────────────────┐  appoint_court   ┌────────────────┐
│                │ ───────────────> │                │
│  NoPosition    │                  │ HoldsPosition  │
│                │ <─────────────── │                │
└────────────────┘  dismiss_court   └───────┬────────┘
                    or resign_court         │
                    or transition           │
                    cleanup                 │
                                            │ appoint_court
                                            │ (different castle)
                                            │
                                            ▼
                                     ┌────────────────┐
                                     │ HoldsPosition  │
                                     │ (auto-resigned │
                                     │  from previous)│
                                     └────────────────┘
```

### Transitions

#### `NoPosition` → `HoldsPosition`
```
Trigger: appoint_court
Guards:
  - Caller is castle.king
  - castle.status not in [Transitioning, Vacant]
  - now >= castle.contest_end_at (contest period over)
  - castle.court_count < castle.max_court
  - castle.chambers_level >= desired_position_count
  - Position not already filled (CourtPositionAccount doesn't exist)
Actions:
  - Create CourtPositionAccount
  - Unlock EXT_COURT on player if needed
  - player.court_section.castle = castle.key
  - player.court_section.position_type = position_type
  - Apply buffs to player.court_section
  - castle.court_count += 1
  - Emit CourtAppointed
```

#### `HoldsPosition` → `HoldsPosition` (Different Castle)
```
Trigger: appoint_court (to different castle)
Guards:
  - (Same as NoPosition → HoldsPosition)
  - player.court_section.castle != NULL_PUBKEY (has existing position)
Actions:
  - Auto-resign from old position:
    - Close old CourtPositionAccount (rent to player)
    - old_castle.court_count -= 1
    - Emit CourtResigned (old castle)
  - Apply new position:
    - (Same as NoPosition → HoldsPosition)
```

#### `HoldsPosition` → `NoPosition` (Dismissed)
```
Trigger: dismiss_court
Guards:
  - Caller is castle.king
  - CourtPositionAccount exists for target player
Actions:
  - Clear player.court_section (castle = NULL, buffs = 0)
  - Close CourtPositionAccount (rent to holder)
  - castle.court_count -= 1
  - Emit CourtDismissed
```

#### `HoldsPosition` → `NoPosition` (Resigned)
```
Trigger: resign_court
Guards:
  - Caller is the position holder
  - CourtPositionAccount exists
Actions:
  - (Same as dismissed)
  - Emit CourtResigned
```

#### `HoldsPosition` → `NoPosition` (Transition Cleanup)
```
Trigger: crank_court_cleanup
Guards:
  - castle.status == Transitioning
Actions:
  - For each CourtPositionAccount:
    - Clear holder's court_section
    - Close CourtPositionAccount (rent to holder)
  - castle.transition_court_cleaned = true
```

---

## 4. Upgrade System

### States (Per Castle)

| State | Description |
|-------|-------------|
| `NoUpgrade` | No upgrade in progress |
| `Upgrading` | Upgrade in progress, waiting for completion |

### State Diagram

```
┌────────────────┐  initiate_upgrade  ┌────────────────┐
│                │ ─────────────────> │                │
│   NoUpgrade    │                    │   Upgrading    │
│                │ <───────────────── │                │
└────────────────┘  complete_upgrade  └───────┬────────┘
       ▲           (time elapsed)             │
       │                                      │
       │                                      │ cancel_upgrade
       │                                      │ (voluntary)
       │                                      │
       │                                      │ ownership_change
       │                                      │ (forced cancel)
       │                                      │
       └──────────────────────────────────────┘
```

### Transitions

#### `NoUpgrade` → `Upgrading`
```
Trigger: initiate_upgrade
Guards:
  - Caller is castle.king
  - castle.status not in [Transitioning, Vacant]
  - castle.upgrade_type == 0 (no upgrade in progress)
  - target_level <= MAX_LEVEL for upgrade type
  - current_level < target_level
  - Player has sufficient resources (cash/NOVI)
Actions:
  - Deduct upgrade cost from king
  - castle.upgrade_type = upgrade_type
  - castle.upgrade_target_level = target_level
  - castle.upgrade_end_at = now + calculate_duration(upgrade_type, target_level)
  - Emit CastleUpgradeStarted
```

#### `Upgrading` → `NoUpgrade` (Complete)
```
Trigger: complete_upgrade (or any interaction after time elapsed)
Guards:
  - castle.upgrade_type != 0
  - now >= castle.upgrade_end_at
Actions:
  - Apply upgrade: castle.{upgrade_type}_level = castle.upgrade_target_level
  - castle.upgrade_type = 0
  - castle.upgrade_target_level = 0
  - castle.upgrade_end_at = 0
  - Emit CastleUpgradeCompleted
```

#### `Upgrading` → `NoUpgrade` (Cancel)
```
Trigger: cancel_upgrade
Guards:
  - Caller is castle.king
  - castle.upgrade_type != 0
Actions:
  - castle.upgrade_type = 0
  - castle.upgrade_target_level = 0
  - castle.upgrade_end_at = 0
  - NO REFUND
  - Emit CastleUpgradeCancelled { reason: "voluntary" }
```

#### `Upgrading` → `NoUpgrade` (Ownership Change)
```
Trigger: Combat loss (Contest/Vulnerable → Transitioning)
Guards:
  - castle.upgrade_type != 0
Actions:
  - castle.upgrade_type = 0
  - castle.upgrade_target_level = 0
  - castle.upgrade_end_at = 0
  - NO REFUND
  - Emit CastleUpgradeCancelled { reason: "ownership_change" }
```

---

## 5. Combat (Rally Attack)

### States (Per Rally)

```
Note: Uses existing Rally system states with target_type = 2 (Castle)
```

| State | Description |
|-------|-------------|
| `Gathering` | Rally created, accepting participants |
| `Marching` | Gather complete, moving to target |
| `Resolved` | Combat complete, processing returns |

### State Diagram (Simplified for Castle Target)

```
┌────────────────┐  create_rally    ┌────────────────┐
│                │ ───────────────> │                │
│  (No Rally)    │                  │   Gathering    │
│                │                  │                │
└────────────────┘                  └───────┬────────┘
                                            │
                               gather_time  │ join_rally
                               elapsed      │ (participants add)
                                            │
                                            ▼
                                    ┌────────────────┐
                                    │                │
                                    │   Marching     │
                                    │                │
                                    └───────┬────────┘
                                            │
                               march_time   │
                               elapsed      │
                                            │
                                            ▼
                                    ┌────────────────┐
                                    │   execute_     │
                                    │     rally      │
                                    └───────┬────────┘
                                            │
                        ┌───────────────────┴───────────────────┐
                        │                                       │
                        ▼                                       ▼
               ┌────────────────┐                      ┌────────────────┐
               │  Attackers     │                      │  Defenders     │
               │     Win        │                      │     Win        │
               └───────┬────────┘                      └───────┬────────┘
                       │                                       │
                       ▼                                       ▼
               Castle status =                         Castle status
               Transitioning                           unchanged
                       │                                       │
                       ▼                                       ▼
               process_return                          process_return
               (participants                           (participants
               return home)                            return home,
                                                       garrison gets loot)
```

### Combat Resolution Logic

```
Trigger: execute_rally
Guards:
  - rally.target_type == RALLY_TARGET_CASTLE
  - now >= rally.arrive_at
  - castle.status in [Contest, Vulnerable]

Calculate Attack Power:
  attack_power = sum(participant.units * tier_multiplier)
               + sum(participant.weapons * weapon_power)
               + sum(participant.hero_buffs)
               + sum(research_buffs)

Calculate Defense Power:
  base_defense = sum(garrison.units * tier_multiplier)
               + sum(garrison.weapons * weapon_power)
               + sum(garrison.hero_buffs)
               + sum(research_buffs)

  fortification_bonus = castle.fortification_level * 500  // +5% per level
  armory_bonus = castle.armory_level * 300               // +3% per level

  defense_power = base_defense * (10000 + fortification_bonus + armory_bonus) / 10000

Resolution:
  IF attack_power > defense_power:
    // Attackers win
    - Castle status = Transitioning
    - castle.transition_new_king = rally.creator
    - Calculate attacker casualties (proportional to defense/attack ratio)
    - Garrison loses (casualties based on attack/defense ratio)
    - Emit CastleDefenseFailed
  ELSE:
    // Defenders win
    - Castle status unchanged
    - Attacker casualties = attacker_loss_on_defeat_bps
    - Defender casualties minimal
    - Distribute attacker weapons to garrison as loot:
      - King gets 15% cut
      - Remaining 85% distributed by contribution_bps
    - Emit CastleDefenseSuccess
```

---

## 6. Ownership Transition

### States

| State | Description |
|-------|-------------|
| `GarrisonCleanup` | Returning resources to garrison members |
| `CourtCleanup` | Clearing court positions |
| `RewardsCleanup` | Closing team reward accounts |
| `ReadyToFinalize` | All cleanup complete, awaiting finalization |
| `Complete` | New king installed or castle vacated |

### State Diagram

```
┌────────────────────┐
│    Transitioning   │  (castle.status = 4)
│    (entered from   │
│    combat loss)    │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐  crank_garrison_cleanup (batched)
│  GarrisonCleanup   │ ─────────────────────────────────┐
│                    │                                  │
│  garrison_cleaned  │ <────────────────────────────────┘
│  < garrison_count  │
└─────────┬──────────┘
          │ garrison_cleaned == garrison_count
          ▼
┌────────────────────┐  crank_court_cleanup
│   CourtCleanup     │
│                    │
│ court_cleaned=false│
└─────────┬──────────┘
          │ court_cleaned == true
          ▼
┌────────────────────┐  crank_rewards_cleanup (batched)
│  RewardsCleanup    │ ─────────────────────────────────┐
│                    │                                  │
│  rewards_cleaned   │ <────────────────────────────────┘
│  < member_count    │
└─────────┬──────────┘
          │ rewards_cleaned >= required
          ▼
┌────────────────────┐
│ ReadyToFinalize    │
│                    │
│ All cleanup done   │
└─────────┬──────────┘
          │ crank_finalize_transition
          │
          ├──────────────────────────────┐
          │                              │
          ▼                              ▼
┌────────────────────┐        ┌────────────────────┐
│  New King Installed│        │   Castle Vacant    │
│  (Contest status)  │        │  (force_remove)    │
└────────────────────┘        └────────────────────┘
```

### Crank Instruction Details

#### `crank_garrison_cleanup`
```
Input: castle, batch of GarrisonContributionAccounts (up to 10)
Guards:
  - castle.status == Transitioning
  - Accounts are valid garrison contributions for this castle
For Each Contribution:
  - Return units: contributor.defensive_unit_X += contribution.units_X
  - Return weapons: contributor.melee_weapons += contribution.melee_weapons
  - If hero_mint != NULL: TransferV1 hero back to contributor (PDA signs)
  - Close account (rent to contributor)
  - castle.transition_garrison_cleaned += 1
```

#### `crank_court_cleanup`
```
Input: castle, all CourtPositionAccounts (up to 3)
Guards:
  - castle.status == Transitioning
  - castle.transition_garrison_cleaned == previous garrison count
For Each Position:
  - holder.court_section.castle = NULL_PUBKEY
  - holder.court_section buffs = 0
  - Close CourtPositionAccount (rent to holder)
castle.transition_court_cleaned = true
castle.court_count = 0
```

#### `crank_rewards_cleanup`
```
Input: castle, batch of TeamCastleRewardAccounts (up to 10)
Guards:
  - castle.status == Transitioning
  - castle.transition_court_cleaned == true
For Each Account:
  - Close account (rent to member wallet)
  - castle.transition_rewards_cleaned += 1
```

#### `crank_finalize_transition`
```
Input: castle, new_king PlayerAccount (if applicable), new_king's KingRegistry
Guards:
  - castle.status == Transitioning
  - castle.transition_garrison_cleaned >= previous garrison count
  - castle.transition_court_cleaned == true
  - castle.transition_rewards_cleaned >= required count

If castle.transition_new_king != NULL_PUBKEY:
  - Remove castle from old king's KingRegistryAccount
  - castle.king = castle.transition_new_king
  - castle.team = new_king.team
  - castle.claimed_at = now
  - castle.contest_end_at = now + CASTLE_CONTEST_DURATION
  - castle.status = Contest
  - castle.garrison_count = 1
  - castle.max_garrison = GARRISON_CAP_BY_TIER[new_king.subscription_tier]
  - Create GarrisonContributionAccount for new king (is_king = true)
  - Add castle to new king's KingRegistryAccount
Else (force_remove case):
  - Remove castle from old king's KingRegistryAccount
  - castle.king = NULL_PUBKEY
  - castle.team = NULL_PUBKEY
  - castle.status = Vacant
  - castle.garrison_count = 0

Clear transition fields:
  - castle.transition_new_king = NULL_PUBKEY
  - castle.transition_garrison_cleaned = 0
  - castle.transition_court_cleaned = false
  - castle.transition_rewards_cleaned = 0

Emit CastleTransitionComplete
```

---

## 7. Reward Claims

### States (Per Claimant Role)

| Role | Claim Account | Reward Type |
|------|---------------|-------------|
| King | Uses castle.king reference | King rewards (NOVI, cash, materials, gems) |
| Court | Uses CourtPositionAccount | Court rewards + position bonus |
| Team Member | TeamCastleRewardAccount | Member rewards |
| Garrison | GarrisonContributionAccount | Combat loot only |

### State Diagram (Team Member Rewards)

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│ ┌────────────────┐  claim_castle_rewards  ┌────────────────┐  │
│ │ NoRewardAccount│ ──────────────────────>│ RewardAccount  │  │
│ │   (first claim │                        │    Created     │  │
│ │    creates it) │                        │                │  │
│ └────────────────┘                        └───────┬────────┘  │
│                                                   │           │
│                                                   │ 24h+      │
│                                                   │ elapsed   │
│                                                   ▼           │
│                                           ┌────────────────┐  │
│                                           │ Claim Available│  │
│                        claim_castle_      │                │  │
│        ┌──────────────   rewards          └───────┬────────┘  │
│        │                                          │           │
│        ▼                                          │           │
│ ┌────────────────┐                                │           │
│ │ Rewards Minted │                                │           │
│ │ last_claim=now │ ───────────────────────────────┘           │
│ └────────────────┘    wait 24h                                │
│                                                                │
└────────────────────────────────────────────────────────────────┘

On Castle Transition:
  - All TeamCastleRewardAccounts closed by crank
  - No pending rewards saved (claim before transition!)
```

### Transitions

#### First Claim (No Account Exists)
```
Trigger: claim_castle_rewards
Guards:
  - player.team == castle.team
  - castle.status in [Protected, Vulnerable]
  - TeamCastleRewardAccount does not exist
Actions:
  - Create TeamCastleRewardAccount
  - account.last_claim_at = now
  - Calculate rewards based on role:
    - King: king_novi_per_day * tier_mult * treasury_bonus
    - Court: court_novi_per_day * tier_mult + position_bonus
    - Member: member_novi_per_day * tier_mult
  - Mint NOVI to player's token account
  - Add cash to player.cash_on_hand
  - Add materials to player
  - Emit CastleRewardsClaimed
```

#### Subsequent Claim
```
Trigger: claim_castle_rewards
Guards:
  - TeamCastleRewardAccount exists
  - now - account.last_claim_at >= SECONDS_PER_DAY
  - castle.status in [Protected, Vulnerable]
Actions:
  - elapsed_days = (now - last_claim_at) / SECONDS_PER_DAY
  - Calculate rewards * elapsed_days (capped at 7 days max)
  - account.last_claim_at = now
  - account.total_claimed_novi += novi_amount
  - Mint/transfer rewards
  - Emit CastleRewardsClaimed
```

#### Garrison Loot Claim
```
Trigger: claim_garrison_loot
Guards:
  - GarrisonContributionAccount exists
  - contribution.loot_melee > 0 OR loot_ranged > 0 OR loot_siege > 0
  - contribution.loot_claimed == false
Actions:
  - player.melee_weapons += contribution.loot_melee
  - player.ranged_weapons += contribution.loot_ranged
  - player.siege_weapons += contribution.loot_siege
  - contribution.loot_melee = 0
  - contribution.loot_ranged = 0
  - contribution.loot_siege = 0
  - contribution.loot_claimed = true
  - Emit GarrisonLootClaimed
```

---

## 8. Hero Escrow

### States (Per Hero NFT)

| State | Owner | Location |
|-------|-------|----------|
| `InWallet` | Player wallet | Player's wallet |
| `InGarrison` | GarrisonContributionAccount PDA | Castle garrison |
| `InDungeon` | DungeonRun PDA | Dungeon (cannot garrison) |
| `InExpedition` | ExpeditionAccount PDA | Expedition (cannot garrison) |

### State Diagram

```
                      ┌────────────────┐
         ┌───────────>│                │<───────────┐
         │            │   InWallet     │            │
         │            │                │            │
         │            └───────┬────────┘            │
         │                    │                     │
         │    leave_garrison  │ join_garrison       │ claim
         │    relieve_garrison│ (with hero)         │ (dungeon/expedition)
         │    transition      │                     │
         │    cleanup         │                     │
         │                    ▼                     │
         │            ┌────────────────┐            │
         │            │                │            │
         └────────────│  InGarrison    │            │
                      │                │            │
                      └────────────────┘            │
                                                    │
                                                    │
┌────────────────┐        enter        ┌────────────┴───────┐
│                │ ───────────────────>│                    │
│   InWallet     │                     │ InDungeon /        │
│                │ <───────────────────│ InExpedition       │
└────────────────┘   claim / abort     │                    │
                                       └────────────────────┘

Note: Hero can only be in ONE escrow at a time.
Transfer to garrison will FAIL if hero is in dungeon/expedition.
```

### Transitions

#### `InWallet` → `InGarrison`
```
Trigger: join_garrison (with hero_mint provided)
Guards:
  - Hero NFT owner == player wallet (verified via MPL Core asset.owner)
  - Hero not in dungeon (transfer would fail)
  - Hero not in expedition (transfer would fail)
Actions:
  - MPL Core TransferV1: owner → GarrisonContributionAccount PDA
  - contribution.hero_mint = hero_mint.key
  - contribution.hero_defense_bps = parse_hero_nft(hero).defense_bps
  - contribution.hero_weapon_eff_bps = parse_hero_nft(hero).weapon_efficiency_bps
```

#### `InGarrison` → `InWallet`
```
Trigger: leave_garrison / relieve_garrison / crank_garrison_cleanup
Guards:
  - contribution.hero_mint != NULL_PUBKEY
Actions:
  - MPL Core TransferV1 (signed by GarrisonContributionAccount PDA):
    - current_owner: GarrisonContributionAccount
    - new_owner: contributor wallet
  - (Account closed after transfer)
```

---

## 9. King Registry

### States (Per King)

| State | Description |
|-------|-------------|
| `NoRegistry` | Player has never claimed a castle |
| `HasRegistry` | KingRegistryAccount exists (persists forever) |

### State Diagram

```
┌────────────────┐  claim_vacant_castle  ┌────────────────┐
│                │ ─────────────────────>│                │
│   NoRegistry   │     (first castle)    │  HasRegistry   │
│                │                       │  count = 1     │
└────────────────┘                       └───────┬────────┘
                                                 │
                                                 │ claim more
                                                 │ castles
                                                 ▼
                                         ┌────────────────┐
                                         │  HasRegistry   │
                                         │  count = N     │
                                         └───────┬────────┘
                                                 │
                                                 │ lose castle
                                                 │ (transition)
                                                 ▼
                                         ┌────────────────┐
                                         │  HasRegistry   │
                                         │  count = N-1   │
                                         │ (never closes) │
                                         └────────────────┘
```

### Transitions

#### `NoRegistry` → `HasRegistry`
```
Trigger: claim_vacant_castle (first castle for this player)
Guards:
  - KingRegistryAccount does not exist
Actions:
  - Create KingRegistryAccount
  - registry.king = player.key
  - registry.castle_count = 1
  - registry.max_castles = DAO default (5)
  - registry.castles[0] = CastleReference { city_id, castle_id, claimed_at, tier }
```

#### `HasRegistry` (Add Castle)
```
Trigger: claim_vacant_castle (subsequent)
Guards:
  - registry.castle_count < registry.max_castles
Actions:
  - registry.castles[registry.castle_count] = CastleReference { ... }
  - registry.castle_count += 1
```

#### `HasRegistry` (Remove Castle)
```
Trigger: crank_finalize_transition (castle lost)
Guards:
  - registry contains this castle
Actions:
  - Find castle index in registry.castles
  - Shift remaining entries left
  - registry.castle_count -= 1
  - (Account remains open, never closes)
```

---

## 10. Composite State Diagram

### Full System Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    KING'S CASTLE SYSTEM                                 │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              CASTLE LIFECYCLE                                    │   │
│  │                                                                                  │   │
│  │   Vacant ──> Contest ──> Protected ──> Vulnerable ──┐                           │   │
│  │     ▲                        │              │        │                           │   │
│  │     │                        │              │        │ combat                    │   │
│  │     │                        │              │        │ loss                      │   │
│  │     │                        │              ▼        ▼                           │   │
│  │     │                        │         ┌───────────────┐                         │   │
│  │     └────────────────────────┴────────>│ Transitioning │                         │   │
│  │                                        └───────┬───────┘                         │   │
│  │                                                │                                 │   │
│  │                      ┌─────────────────────────┼─────────────────────────┐       │   │
│  │                      │                         │                         │       │   │
│  │                      ▼                         ▼                         ▼       │   │
│  │              ┌───────────────┐        ┌───────────────┐        ┌────────────┐   │   │
│  │              │   Garrison    │        │    Court      │        │  Rewards   │   │   │
│  │              │   Cleanup     │        │   Cleanup     │        │  Cleanup   │   │   │
│  │              └───────────────┘        └───────────────┘        └────────────┘   │   │
│  │                      │                         │                         │       │   │
│  │                      └─────────────────────────┴─────────────────────────┘       │   │
│  │                                                │                                 │   │
│  │                                                ▼                                 │   │
│  │                                         ┌─────────────┐                          │   │
│  │                                         │  Finalize   │                          │   │
│  │                                         └──────┬──────┘                          │   │
│  │                                                │                                 │   │
│  │                                    ┌───────────┴───────────┐                     │   │
│  │                                    ▼                       ▼                     │   │
│  │                             New King (Contest)         Vacant                    │   │
│  │                                                                                  │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐                │
│  │     GARRISON       │  │       COURT        │  │      UPGRADES      │                │
│  │                    │  │                    │  │                    │                │
│  │  NotIn ─> In ─> Out│  │ None ─> Holds ─>   │  │ None ─> Upgrading  │                │
│  │         ▲    │     │  │         None       │  │         ─> Complete│                │
│  │   King  │    │     │  │ (global: one only) │  │      or Cancel     │                │
│  │   ──────┘    │     │  │                    │  │                    │                │
│  │              ▼     │  │                    │  │                    │                │
│  │          Relieved  │  │                    │  │                    │                │
│  └────────────────────┘  └────────────────────┘  └────────────────────┘                │
│                                                                                         │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐                │
│  │    HERO ESCROW     │  │   KING REGISTRY    │  │      REWARDS       │                │
│  │                    │  │                    │  │                    │                │
│  │ Wallet ─> Garrison │  │ None ─> Has        │  │ NoAccount ─> Has   │                │
│  │    ▲         │     │  │ (never closes)     │  │ (24h cooldown)     │                │
│  │    └─────────┘     │  │ count: 0..max      │  │ + Loot claims      │                │
│  │                    │  │                    │  │                    │                │
│  └────────────────────┘  └────────────────────┘  └────────────────────┘                │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Appendix: State Invariants

### Castle Invariants
```
1. status == Vacant ⟹ king == NULL_PUBKEY ∧ team == NULL_PUBKEY ∧ garrison_count == 0
2. status == Contest ⟹ king != NULL_PUBKEY ∧ garrison_count >= 1
3. status == Protected ⟹ now < contest_end_at + protection_duration
4. status == Transitioning ⟹ transition_new_king is set (or NULL for force_remove)
5. garrison_count <= max_garrison <= 25
6. court_count <= max_court <= chambers_level <= 3
7. upgrade_type != 0 ⟹ upgrade_end_at > 0
```

### Garrison Invariants
```
1. GarrisonContributionAccount exists ⟹ garrison_count > 0
2. is_king == true ⟹ contributor == castle.king
3. hero_mint != NULL ⟹ hero NFT owner == GarrisonContributionAccount PDA
4. sum(all contribution.units_X) = total garrison units
```

### Court Invariants
```
1. CourtPositionAccount exists ⟹ castle.court_count > 0
2. holder.court_section.castle == CourtPositionAccount.castle
3. One player can hold at most ONE CourtPositionAccount globally
4. court_count <= chambers_level
```

### King Registry Invariants
```
1. KingRegistryAccount.king == owner wallet
2. castle_count == len(castles where city_id/castle_id != 0)
3. castle_count <= max_castles
4. For each castle in registry: castle.king == registry.king
5. Account never closes (castle_count can be 0)
```

### Hero Escrow Invariants
```
1. Hero can only be owned by ONE PDA at a time
2. hero_mint in GarrisonContribution ⟹ NFT.owner == GarrisonContribution PDA
3. Hero return must happen before account closure
```

---

## Appendix: Error Conditions

| Error | Condition | State Machine Violation |
|-------|-----------|-------------------------|
| `CastleNotVacant` | Claiming non-vacant castle | Vacant guard failed |
| `CastleInContest` | Action requiring post-contest | Contest period check |
| `CastleProtected` | Attacking protected castle | Protected status guard |
| `CastleTransitioning` | Action during transition | Transitioning status guard |
| `GarrisonFull` | Joining full garrison | garrison_count >= max_garrison |
| `NotInGarrison` | Leaving when not in | No GarrisonContributionAccount |
| `KingCannotLeave` | King trying to leave garrison | is_king == true guard |
| `AlreadyHasCourtPosition` | Implicit - auto-resigns | N/A (handled automatically) |
| `MaxCastlesReached` | Claiming too many castles | registry.castle_count >= max |
| `UpgradeInProgress` | Starting second upgrade | upgrade_type != 0 |
| `ClaimCooldown` | Claiming before 24h | last_claim_at + 24h > now |
| `TransitionNotComplete` | Finalizing early | Cleanup counts not met |
| `HeroAlreadyEscrowed` | Garrisoning escrowed hero | MPL Core transfer fails |
