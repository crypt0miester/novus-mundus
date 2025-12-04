# King's Castle Event System

## Overview

King's Castle is a persistent territorial control system where players compete to claim, defend, and upgrade strategic locations. Castles generate passive rewards for the ruling team and provide combat bonuses to garrisoned players.

## Core Concepts

### Tiers

| Tier | Has King | Has Court | Garrison | Rewards |
|------|----------|-----------|----------|---------|
| Outpost | No | No | No | Small material drops |
| Castle | Yes | Yes (1-3) | Yes | Full rewards (cash, materials, bonuses) |

**Outpost Rewards:**
- Generate small passive material rewards for nearby players
- No garrison required
- Available to be claimed and upgraded to Castle

### Terminology

- **King**: The ruler of a castle, must be a team leader
- **Court**: Appointed positions that provide bonuses (DAO configurable: min 1, max 3)
- **Garrison**: Players who contribute troops/weapons/heroes to defend
- **Rally**: Attacking force assembled to challenge a castle
- **Contest Period**: 2-hour window after claiming where the castle can be challenged
- **Protection Period**: 10-day immunity after successfully holding through contest period

---

## Account Architecture

All accounts use PDA-based expandable architecture to handle Solana's transaction limits.

### CastleAccount

Primary account storing castle state and configuration.

```
PDA Seeds: [CASTLE_SEED, city_id, castle_id]
```

**Fields:**
- Castle identity (id, name, tier)
- Location (city_id, coordinates)
- Ruler info (king pubkey, team pubkey, claimed_at timestamp)
- Garrison tracking (contributor_count, total slots)
- Court tracking (position_count, max_positions)
- Upgrade levels (fortification, treasury, chambers, watchtower, armory)
- DAO configuration (protection_duration, upgrade costs, bonus rates)
- Eligibility requirements (min_level, min_networth, min_troops)
- Statistics (times_claimed, successful_defenses, total_rewards_distributed)

**Computed State (not stored):**
- `is_protected()`: Returns true if within protection period
- `is_vacant()`: Returns true if no king assigned
- `has_court()`: Returns true if tier is Castle

### CourtPositionAccount

Created when a position is filled, closed when vacated.

```
PDA Seeds: [COURT_SEED, castle_pubkey, position_type]
```

**Fields:**
- Castle reference
- Position type (enum)
- Holder (player pubkey)
- Appointed timestamp
- Bonus multiplier

**Position Types:**

| Position | Primary Bonus | Theme Variations |
|----------|---------------|------------------|
| Advisor | Attack Power +15% | Warlord, General, Champion |
| Scholar | Research Speed +20% | Sage, Wizard, Scribe |
| Guardian | Defense Rating +15% | Shield, Sentinel, Protector |
| Treasurer | Economy Bonus +10% | Banker, Merchant, Steward |
| Marshal | Battle Coordination +10% | Commander, Captain, Lieutenant |

### GarrisonContributionAccount

Tracks individual player contributions to the garrison.

```
PDA Seeds: [GARRISON_SEED, castle_pubkey, contributor_pubkey]
```

**Fields:**
- Castle reference
- Contributor (player pubkey)
- Contribution timestamp
- Resources committed:
  - Troops (units)
  - Melee weapons
  - Ranged weapons
  - Siege weapons
  - Armor pieces
  - Heroes (if applicable)
- Is King flag (boolean)
- Contribution cap (based on player power/research)

**Important:**
- Maximum garrison size depends on King's subscription tier:
  - Rookie: 5 contributors
  - Expert: 10 contributors
  - Epic: 15 contributors
  - Legendary: 25 contributors (maximum)
- King MUST be part of garrison
- Contribution cap calculated from player's power rating and research level
- Resources are locked while garrisoned

### TeamCastleRewardAccount

Tracks time-based reward accumulation for team members.

```
PDA Seeds: [TEAM_CASTLE_REWARD_SEED, castle_pubkey, team_member_pubkey]
```

**Fields:**
- Castle reference
- Team member (player pubkey)
- Last claim timestamp
- Accumulated time (seconds since last claim)
- Reward rate snapshot (at time of last claim)

**Reward Calculation:**
```
reward = (current_time - last_claim_time) * base_rate * tier_multiplier * upgrade_bonus
```

---

## Castle Lifecycle

### 1. Vacant Outpost

- Small material rewards generated for nearby players
- No garrison, no court
- Any eligible team leader can claim

### 2. Claiming a Castle

**Requirements:**
- Player must be a team leader
- Meet minimum eligibility (level, networth, troops)
- Not currently ruling maximum allowed castles

**Process:**
1. Player submits claim transaction
2. Outpost becomes Castle
3. Claimant becomes provisional King
4. **2-hour contest period begins**
5. King automatically added to garrison
6. Can be challenged during contest period

### 3. Contest Period (2 Hours)

This is the critical "king of the hill" phase:

- **Duration**: 2 hours from claim
- **No rewards generated** during contest
- **No protection** - can be attacked immediately
- King can recruit garrison during this time
- Court appointments NOT available yet

**If challenged and loses:**
1. Challenger becomes new provisional King
2. **New 2-hour contest period begins** for challenger
3. Previous claimant's garrison returned
4. Cycle continues until someone holds for 2 hours

**If no successful challenge in 2 hours:**
1. Provisional King becomes official King
2. 10-day protection period begins
3. Rewards start generating
4. Court appointments become available

### 4. Active Castle (Protected)

- Rewards generate for team members (time-based accumulation)
- Court can be appointed
- Garrison can be assembled
- Cannot be attacked
- Duration: 10 days

### 5. Active Castle (Vulnerable)

- Same as protected, but can be attacked
- Protection never returns (vulnerable forever until ownership changes)

### 6. Castle Under Attack

- Rally assembled against castle
- Combat resolves immediately
- Winner determined by combat calculation

### 7. Ownership Change

- Previous King loses rulership
- Previous garrison contributions returned
- Previous court positions vacated
- New claimant becomes provisional King
- **New 2-hour contest period begins**
- **Upgrades persist** (do not reset)

---

## Court System

### Appointment Rules

- King can appoint **any player** to court positions (not limited to team members)
- This allows for political alliances and diplomacy between teams
- Appointments are free with cooldown (DAO configurable)
- Court size: minimum 1, maximum 3 (DAO configurable per castle tier)
- One player can hold only one court position per castle
- Court appointments only available after contest period ends

### Court Member Benefits

- Bonus applied while holding position
- Earns enhanced reward rate
- Non-team court members still receive bonuses and rewards
- **Note**: Only team members can contribute to garrison (court position alone does not grant garrison access)

### Vacancy

- King can dismiss court members at any time
- Court member can resign voluntarily
- Position account closed on vacancy

---

## Garrison System

### Contributing to Garrison

Similar to rally contribution pattern:

1. Player commits resources (troops, weapons, heroes)
2. GarrisonContributionAccount created
3. Resources locked until withdrawn or relieved
4. Contribution cap based on player's power/research

### Garrison Composition

- **Maximum**: Based on King's subscription tier (5/10/15/25)
- **King**: Must be in garrison, cannot withdraw while ruling
- **Team Members Only**: Only team members can contribute to garrison
- Court members who are not on the team cannot garrison

### Contribution Cap

Each player has an individual cap based on:
- Base power rating
- Research bonuses
- Subscription tier multipliers

```
cap = base_cap * power_modifier * research_bonus * tier_multiplier
```

### Relieving Garrison Members

- King can relieve any garrison member at any time
- Relieved player's resources returned immediately
- Court members can be relieved from garrison (keeps court position)
- King cannot relieve themselves

### Voluntary Withdrawal

- Garrison members (except King) can withdraw anytime
- Resources returned immediately
- GarrisonContributionAccount closed

---

## Combat System

### Rally Formation

Attackers form a rally against the castle:

1. Rally creator initiates attack rally
2. Up to 25 players can join rally
3. Each contributes troops, weapons, heroes
4. Rally targets specific castle

### Combat Resolution

**No siege windows** - combat resolves immediately when rally executes.

**Participants:**
- Attackers: Up to 25 rally participants
- Defenders: Up to 25 garrison contributors

**Transaction Account Limits:**
- 25 garrison contribution accounts
- 25 rally participant accounts
- System accounts (castle, game engine, etc.)
- Total: ~55-60 accounts (within Solana's 64 limit)

### Combat Calculation

```
attack_power = sum(rally_contributions) * attack_modifiers
defense_power = sum(garrison_contributions) * defense_modifiers * fortification_bonus

if attack_power > defense_power:
    attackers_win()
else:
    defenders_win()
```

**Modifiers include:**
- Court bonuses (Advisor for attack, Guardian for defense)
- Upgrade bonuses (Fortification, Watchtower, Armory)
- Research bonuses
- Hero abilities

### Victory: Attackers

1. Rally creator becomes new King
2. Rally creator's team becomes ruling team
3. Previous garrison contributions returned
4. Previous court vacated
5. New protection period begins
6. Upgrades persist

### Victory: Defenders

1. Castle remains with current King
2. Attacker resources may suffer losses (DAO configurable)
3. Defense statistics updated
4. Garrison remains intact

---

## Upgrade System

Upgrades persist across ownership changes. Only the King can initiate upgrades.

### Upgrade Types

| Upgrade | Effect | Max Level |
|---------|--------|-----------|
| Fortification | Defense bonus +5% per level | 10 |
| Treasury | Reward generation +10% per level | 10 |
| Court Chambers | Court size +1 per level | 3 |
| Watchtower | Early warning, visibility bonuses | 5 |
| Armory | Garrison capacity +2 per level | 10 |

### Upgrade Costs

Costs use golden ratio family scaling:

```
cost = base_cost * (phi ^ level)

where phi = 1.618033988749895
```

Payable in:
- Cash (primary)
- NOVI (premium option)
- Combination (DAO configurable)

### Upgrade Duration

Upgrades complete over time:
```
duration = base_duration * (sqrt_phi ^ level)

where sqrt_phi = 1.272019649514069
```

---

## Reward System

### Team Rewards

All team members earn passive rewards while their team controls a castle.

**Time-Based Accumulation:**
```
accumulated_reward = time_held * base_rate * tier_multiplier * treasury_bonus
```

**Claiming:**
1. Team member calls claim instruction
2. Time since last claim calculated
3. Rewards distributed
4. Timestamp reset

**Vacant Castle:**
- No rewards generated
- Accumulation paused

### Garrison Rewards

Garrison contributors earn enhanced rewards:
```
garrison_bonus = base_reward * garrison_multiplier * contribution_ratio
```

### Court Rewards

Court members earn highest rewards:
```
court_bonus = base_reward * court_multiplier * position_bonus
```

### King Rewards

King earns percentage of all castle revenue:
```
king_cut = total_rewards * king_percentage  // DAO configurable, e.g., 10%
```

---

## Multi-Castle Ruling

A single King can rule multiple castles simultaneously.

### Stacking

- All bonuses stack
- All rewards accumulate
- Court positions are per-castle (same player can be Advisor in multiple castles)

### Limitations

- Maximum castles per King: DAO configurable
- Must maintain eligibility for each castle
- Garrison commitments are per-castle (troops can only be in one garrison)

---

## DAO Governance

The following parameters are DAO-configurable:

### Castle Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| contest_duration | Hours to hold before becoming official King | 2 |
| protection_duration | Days of immunity after contest | 10 |
| max_court_size | Maximum court positions | 3 |
| min_court_size | Minimum court positions | 1 |
| base_garrison_cap | Base garrison cap (scaled by King's tier) | 25 |
| max_castles_per_king | Maximum simultaneous rulerships | 5 |

### Garrison Caps by King's Subscription Tier

| Tier | Garrison Cap |
|------|--------------|
| Rookie | 5 |
| Expert | 10 |
| Epic | 15 |
| Legendary | 25 |

### Economic Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| base_reward_rate | Base rewards per second | 100 |
| king_revenue_share | King's cut of rewards | 10% |
| upgrade_cost_multiplier | Scaling factor for upgrades | 1.0 |
| garrison_reward_bonus | Extra rewards for garrison | 50% |
| court_reward_bonus | Extra rewards for court | 100% |

### Combat Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| attacker_loss_on_defeat | Resource loss % on failed attack | 20% |
| defender_loss_on_defeat | Resource loss % on lost defense | 10% |
| fortification_bonus_per_level | Defense bonus per upgrade | 5% |

### Removal Authority

- **Only DAO can force-remove a King**
- No automatic removal for inactivity
- No army minimum maintenance
- Removal requires governance proposal

---

## Eligibility Requirements

### To Claim a Castle

- Must be team leader
- Minimum player level (DAO configurable)
- Minimum networth (DAO configurable)
- Minimum troops available (DAO configurable)
- Not at maximum castle limit

### To Join Garrison

- Must be team member of ruling team
- Have resources to contribute
- Not already in this garrison

### To Hold Court Position

- Can be **any player** (not limited to team members)
- Appointed by King
- Not holding another position in same castle
- Allows for cross-team political alliances

---

## Instructions Summary

### Castle Management

| Instruction | Description | Authority |
|-------------|-------------|-----------|
| claim_vacant_castle | Claim an unruled castle | Any eligible team leader |
| appoint_court | Fill a court position | King |
| dismiss_court | Remove from court position | King |
| initiate_upgrade | Start castle upgrade | King |

### Garrison Operations

| Instruction | Description | Authority |
|-------------|-------------|-----------|
| join_garrison | Contribute to garrison | Team members |
| leave_garrison | Withdraw from garrison | Garrison members |
| relieve_garrison | Force remove from garrison | King |

### Combat

| Instruction | Description | Authority |
|-------------|-------------|-----------|
| create_castle_rally | Start attack rally | Any eligible player |
| join_castle_rally | Contribute to rally | Any eligible player |
| execute_castle_rally | Resolve combat | Rally creator |

### Rewards

| Instruction | Description | Authority |
|-------------|-------------|-----------|
| claim_castle_rewards | Claim accumulated rewards | Team members |

### DAO Operations

| Instruction | Description | Authority |
|-------------|-------------|-----------|
| update_castle_config | Modify castle parameters | DAO |
| force_remove_king | Remove King from castle | DAO |

---

## State Diagrams

### Castle State

```
[Outpost] --claim--> [Contest 2hr] --hold 2hr--> [Protected 10d] --expires--> [Vulnerable]
                          |                            ^                           |
                          |                            |                           |
                     [loses fight]              [holds 2hr]                  [loses fight]
                          |                            |                           |
                          v                            |                           |
                    [New Claimant] ----contest 2hr-----+                           |
                          ^                                                        |
                          +--------------------------------------------------------+
```

### Garrison Flow

```
[Player] --join_garrison--> [GarrisonContributionAccount Created]
                                      |
                 +--------------------+--------------------+
                 |                    |                    |
           [leave_garrison]    [relieve_garrison]   [castle lost]
                 |                    |                    |
                 v                    v                    v
        [Resources Returned]  [Resources Returned]  [Resources Returned]
                 |                    |                    |
                 v                    v                    v
           [Account Closed]    [Account Closed]     [Account Closed]
```

### Combat Flow

```
[Rally Formed] --execute--> [Combat Resolution]
                                    |
                    +---------------+---------------+
                    |                               |
             [Attackers Win]                 [Defenders Win]
                    |                               |
                    v                               v
          [Ownership Change]             [Castle Unchanged]
          [Protection Starts]            [Attacker Losses]
```

---

## Implementation Notes

### Account Size Considerations

- CastleAccount: ~500 bytes (fixed size)
- CourtPositionAccount: ~100 bytes per position
- GarrisonContributionAccount: ~200 bytes per contributor
- TeamCastleRewardAccount: ~80 bytes per team member

### Transaction Limits

Combat transactions require loading many accounts:
- 25 garrison accounts (defenders)
- 25 rally accounts (attackers)
- Castle account
- Game engine account
- King's player account
- Rally creator's player account
- Token accounts for rewards

**Design ensures we stay under Solana's 64 account limit.**

### Computed vs Stored State

**Computed (not stored):**
- is_protected: `current_time < claimed_at + protection_duration`
- is_vacant: `king == Pubkey::default()`
- has_court: `tier == Castle`
- total_garrison_power: Sum of all contribution accounts
- garrison_slots_used: Count of contribution accounts

**Stored:**
- Upgrade levels
- Timestamps
- Configuration
- Statistics

---

## Future Considerations

- Legendary castle tiers with unique abilities
- Castle alliances between teams
- Seasonal castle events with enhanced rewards
- Castle-specific research trees
- Decorative customization (cosmetic only)
