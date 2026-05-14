# Dungeon System State Machine

## Overview

The Dungeon system provides roguelike PvE content where players descend through floors, fight enemies, collect relics, and face bosses.

---

## 1. Dungeon Run Lifecycle

### States

| State | Value | Description |
|-------|-------|-------------|
| `Active` | 0 | In room (combat or non-combat) |
| `AwaitingRelic` | 1 | Between floors, choosing relic |
| `BossFight` | 2 | Final floor boss encounter |
| `Completed` | 3 | Victory - can claim rewards |
| `Failed` | 4 | Units wiped - checkpoint rewards only |
| `Fled` | 5 | Early exit - partial rewards |

### State Diagram

```
                                    ┌─────────────────────────────────────────────────────┐
                                    │                                                     │
                                    ▼                                                     │
┌────────────────┐  enter       ┌────────────────┐                                       │
│                │ ───────────> │                │                                       │
│  No DungeonRun │              │     Active     │ ◄──────────────────────────────┐      │
│                │              │  (room combat  │                                │      │
└────────────────┘              │   or interact) │                                │      │
                                └───────┬────────┘                                │      │
                                        │                                         │      │
                    ┌───────────────────┼───────────────────┬─────────────────┐   │      │
                    │                   │                   │                 │   │      │
                    │ units_wiped       │ floor_complete    │ flee            │   │      │
                    ▼                   ▼                   ▼                 │   │      │
            ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │   │      │
            │                │  │                │  │                │        │   │      │
            │     Failed     │  │ AwaitingRelic  │  │      Fled      │        │   │      │
            │                │  │                │  │                │        │   │      │
            └───────┬────────┘  └───────┬────────┘  └───────┬────────┘        │   │      │
                    │                   │                   │                 │   │      │
                    │                   │ choose_relic      │                 │   │      │
                    │                   ▼                   │                 │   │      │
                    │           ┌────────────────┐          │                 │   │      │
                    │           │  Next Floor    │          │                 │   │      │
                    │           │                │──────────┼─────────────────┘   │      │
                    │           └───────┬────────┘          │                     │      │
                    │                   │                   │                     │      │
                    │                   │ is_boss_floor     │                     │      │
                    │                   ▼                   │                     │      │
                    │           ┌────────────────┐          │                     │      │
                    │           │                │          │                     │      │
                    │           │   BossFight    │          │                     │      │
                    │           │                │          │                     │      │
                    │           └───────┬────────┘          │                     │      │
                    │                   │                   │                     │      │
                    │       ┌───────────┴───────────┐       │                     │      │
                    │       │                       │       │                     │      │
                    │       │ boss_killed           │ wiped │                     │      │
                    │       ▼                       ▼       │                     │      │
                    │ ┌────────────────┐    ┌────────────────┐                    │      │
                    │ │                │    │                │                    │      │
                    │ │   Completed    │    │     Failed     │                    │      │
                    │ │                │    │                │                    │      │
                    │ └───────┬────────┘    └────────────────┘                    │      │
                    │         │                     │                             │      │
                    │         │                     │                             │      │
                    └─────────┴─────────────────────┴─────────────────────────────┘      │
                                        │                                                │
                                        │ claim                                          │
                                        ▼                                                │
                                ┌────────────────┐                                       │
                                │ Account Closed │                                       │
                                │  Hero Returned │ ──────────────────────────────────────┘
                                └────────────────┘     resume (from checkpoint)
```

---

## 2. Room State Machine

### Room Types

| Type | Value | Description |
|------|-------|-------------|
| `Combat` | 0 | Standard enemy encounter |
| `Treasure` | 1 | Loot room, no combat |
| `Camp` | 2 | Abandoned camp, temporary buff |
| `Rest` | 3 | Heal 20% of lost units |
| `Trap` | 4 | Take damage, gain bonus XP |

### Room Flow

```
┌────────────────┐
│   Enter Room   │
└───────┬────────┘
        │
        ├──────────────────────────────────────────────────────────────────┐
        │                                                                  │
        ▼                                                                  ▼
┌────────────────┐                                                 ┌────────────────┐
│    Combat?     │── No ──────────────────────────────────────────>│   Non-Combat   │
└───────┬────────┘                                                 │    Interact    │
        │ Yes                                                      └───────┬────────┘
        ▼                                                                  │
┌────────────────┐                                                         │
│  Enemy Active  │                                                         │
└───────┬────────┘                                                         │
        │                                                                  │
        │ attack / attack_multi                                            │
        ▼                                                                  │
┌────────────────┐                                                         │
│ Damage Applied │                                                         │
└───────┬────────┘                                                         │
        │                                                                  │
        ├──────────────────┐                                               │
        │                  │                                               │
        ▼                  ▼                                               │
┌────────────────┐  ┌────────────────┐                                     │
│ Enemy Defeated │  │  Player Wiped  │                                     │
│ (health <= 0)  │  │ (units = 0)    │                                     │
└───────┬────────┘  └───────┬────────┘                                     │
        │                   │                                              │
        │                   │                                              │
        ▼                   ▼                                              │
┌────────────────┐  ┌────────────────┐                                     │
│  Loot Granted  │  │     Failed     │                                     │
│  Next Room     │  │    Status      │                                     │
└───────┬────────┘  └────────────────┘                                     │
        │                                                                  │
        └──────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                                ┌────────────────┐
                                │   Room Clear   │
                                │ rooms_cleared++│
                                └───────┬────────┘
                                        │
                        ┌───────────────┴───────────────┐
                        │                               │
                        ▼                               ▼
                ┌────────────────┐              ┌────────────────┐
                │  More Rooms    │              │  Floor Clear   │
                │  on Floor      │              │ (last room)    │
                └───────┬────────┘              └───────┬────────┘
                        │                               │
                        ▼                               ▼
                ┌────────────────┐              ┌────────────────┐
                │ Next Room      │              │ AwaitingRelic  │
                │ (room_type     │              │ (or BossFight) │
                │  from backend) │              │                │
                └────────────────┘              └────────────────┘
```

---

## 3. Boss Fight State Machine

### Boss Wrath System

| Wrath Level | Effect |
|-------------|--------|
| 0-49 | Normal combat |
| 50-74 | Theme ability activates |
| 75-100 | Enraged (enhanced ability) |

### Theme Abilities

| Theme | Ability | Effect |
|-------|---------|--------|
| RadiantWeakness | Lifesteal aura | Boss heals from damage dealt |
| FastMobs | Defense pierce | Ignores player defense for N attacks |
| DarknessVulnerable | Darkness amp | x3 darkness effects when active |
| ArmoredMobs | Iron shell | Shield that absorbs damage |

### Boss State Flow

```
┌────────────────┐
│   Boss Floor   │
│    Entered     │
└───────┬────────┘
        │
        │ status = BossFight
        ▼
┌────────────────┐
│  Boss Active   │
│  wrath = 0     │
│  ability = off │
└───────┬────────┘
        │
        │ attack
        ▼
┌────────────────┐
│ Damage Applied │
│ wrath += Δ     │
└───────┬────────┘
        │
        ├──────────────────────────────────────────────────────┐
        │                                                      │
        │ wrath >= 50                                          │ wrath < 50
        ▼                                                      │
┌────────────────┐                                             │
│ Theme Ability  │                                             │
│   Activates    │                                             │
│ boss_ability_  │                                             │
│ active = true  │                                             │
└───────┬────────┘                                             │
        │                                                      │
        │ (ability counter decrements per attack)              │
        ▼                                                      │
┌────────────────┐                                             │
│ ability_counter│                                             │
│   == 0         │                                             │
└───────┬────────┘                                             │
        │                                                      │
        │ ability ends                                         │
        ▼                                                      │
┌────────────────┐ <───────────────────────────────────────────┘
│ Continue Fight │
└───────┬────────┘
        │
        ├──────────────────────────────────────────┐
        │                                          │
        ▼                                          ▼
┌────────────────┐                         ┌────────────────┐
│ Boss Defeated  │                         │  Player Wiped  │
│ health <= 0    │                         │  units = 0     │
└───────┬────────┘                         └───────┬────────┘
        │                                          │
        ▼                                          ▼
┌────────────────┐                         ┌────────────────┐
│   Completed    │                         │     Failed     │
│   Status       │                         │    Status      │
└────────────────┘                         └────────────────┘
```

---

## 4. Relic System

### States

| State | Description |
|-------|-------------|
| `NoRelics` | No relics collected |
| `HasRelics` | One or more relics (bitmask) |
| `Synergy` | Synergy bonus active |

### Relic Selection Flow

```
┌────────────────┐
│ Floor Complete │
│ (not boss)     │
└───────┬────────┘
        │
        │ status = AwaitingRelic
        ▼
┌────────────────┐
│ Backend Sends  │
│ 3 Relic Options│
└───────┬────────┘
        │
        │ choose_relic(relic_id)
        ▼
┌────────────────┐
│ relic_mask |=  │
│ (1 << relic_id)│
└───────┬────────┘
        │
        │ check synergy
        ▼
┌────────────────┐
│ count_relics_  │
│ with_tag(tag)  │
└───────┬────────┘
        │
        ├────────────────────────────────┐
        │ count >= synergy_threshold     │ count < threshold
        ▼                                ▼
┌────────────────┐               ┌────────────────┐
│ synergy_mask |=│               │   No Synergy   │
│ (1 << tag)     │               │    Bonus       │
│ Apply Bonus    │               └───────┬────────┘
└───────┬────────┘                       │
        │                                │
        └────────────────────────────────┘
                        │
                        ▼
                ┌────────────────┐
                │  Next Floor    │
                │ status = Active│
                │ floor++        │
                └────────────────┘
```

### Relic Mask (32 bits)
```
bit 0: Relic 0
bit 1: Relic 1
...
bit 31: Relic 31
```

### Synergy Tags
```
Fire, Ice, Lightning, Holy, Arcane, Shadow, Nature, Blood
```

---

## 5. Darkness System

### State (Computed)

```
darkness_level = darkness_base_bps + (current_floor * darkness_per_floor_bps)
effective_darkness = darkness_level - darkness_mitigation
reward_penalty = effective_darkness / 100  // % reduction
```

### Flow

```
┌────────────────┐
│  Enter Floor   │
└───────┬────────┘
        │
        ▼
┌────────────────┐
│darkness_level +=│
│darkness_per_   │
│floor_bps       │
└───────┬────────┘
        │
        │ (Scout specialization -25%)
        │ (Relics with darkness_reduction)
        ▼
┌────────────────┐
│ Apply Darkness │
│  Mitigation    │
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ Calculate Net  │
│   Darkness     │
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ Reduce Rewards │
│ by % darkness  │
└────────────────┘
```

---

## 6. Checkpoint System

### States

| State | Description |
|-------|-------------|
| `NoCheckpoint` | No checkpoint saved |
| `HasCheckpoint` | Checkpoint at floor N |

### Checkpoint Flow

```
┌────────────────┐
│ Floor N        │
│ N % interval   │
│    == 0        │
└───────┬────────┘
        │
        │ save checkpoint
        ▼
┌────────────────┐
│ last_checkpoint│
│    = N         │
│checkpoint_xp   │
│  = pending_xp  │
│checkpoint_novi │
│  = pending_novi│
└────────────────┘

        ...

┌────────────────┐
│    Failed      │
│  (units = 0)   │
└───────┬────────┘
        │
        │ claim
        ▼
┌────────────────┐
│ Rewards =      │
│ checkpoint_*   │
│ (not pending_*)│
└───────┬────────┘
        │
        │ (optional) resume
        ▼
┌────────────────┐
│ Resume from    │
│ checkpoint     │
│ resume_count++ │
│ (costs gems)   │
└────────────────┘
```

---

## 7. Hero Specialization Modifiers

### Attack Phase Modifiers

```
Warrior:  attack_power *= 1.20 (2000 bps bonus)
Guardian: attack_power *= 0.85 (-1500 bps)
Scout:    no modifier
Tactician: no modifier
```

### Defense Phase Modifiers

```
Warrior:  healing *= 0.90 (-10%)
Guardian: survival *= 1.25 (+2500 bps)
Scout:    no modifier
Tactician: no modifier
```

### Relic Effect Modifiers

```
Warrior:  no modifier
Guardian: no modifier
Scout:    loot_bonus *= 1.15 (+1500 bps)
Tactician: relic_effects *= 1.30 (+3000 bps)
```

---

## 8. Leaderboard System

### States

| State | Description |
|-------|-------------|
| `Active` | Week in progress |
| `Ended` | Week ended, prizes claimable |

### Scoring Formula

```
score = (floors_cleared × 10000)
      + (enemies_killed × 100)
      + (relics_collected × 500)
      - time_seconds
      + (full_clear ? 50000 : 0)
```

### Leaderboard Update Flow

```
┌────────────────┐
│   Completed    │
│    Status      │
└───────┬────────┘
        │
        │ claim (victory)
        ▼
┌────────────────┐
│ Calculate      │
│ Final Score    │
└───────┬────────┘
        │
        │ try_insert(player, score)
        ▼
┌────────────────┐
│ If score >     │
│ min in top 10: │
│  - Insert      │
│  - Sort        │
└────────────────┘
```

---

## Transitions Summary

### `enter`
```
Trigger: enter_dungeon
Guards:
  - player.level >= template.min_player_level
  - player.encounter_stamina >= template.stamina_cost
  - Estate has Arena at required level
  - DungeonRun does not exist
  - Player not traveling
  - Player not in rally
  - Player has defensive units
  - Hero NFT owned by player
Actions:
  - Create DungeonRun PDA
  - Transfer hero NFT to DungeonRun PDA (escrow)
  - Snapshot units and weapons
  - Deduct stamina
  - Initialize first room (generate enemy if combat)
  - Emit DungeonEntered
```

### `attack`
```
Trigger: attack_dungeon
Guards:
  - status == Active OR BossFight
  - room_type == Combat
  - enemy_health > 0
Actions:
  - Calculate damage (units × power + weapons + hero buffs + relic effects)
  - Apply specialization modifiers
  - Reduce enemy_health
  - If boss: increment wrath, check ability
  - Enemy counterattacks (reduce remaining_units)
  - If enemy_health <= 0: room complete, grant loot
  - If remaining_units == 0: status = Failed
  - Emit DungeonAttack
```

### `interact`
```
Trigger: interact_dungeon
Guards:
  - status == Active
  - room_type != Combat
Actions:
  - room_type == Treasure: Grant bonus loot
  - room_type == Camp: Set camp_bonus_bps, camp_expires_floor
  - room_type == Rest: Heal 20% of (original_units - remaining_units)
  - room_type == Trap: Damage units, grant bonus XP
  - Mark room complete
  - Emit DungeonInteract
```

### `choose_relic`
```
Trigger: choose_relic
Guards:
  - status == AwaitingRelic
  - relic_id is valid and offered
Actions:
  - relic_mask |= (1 << relic_id)
  - Check synergy tags, apply if threshold met
  - Increment floor, reset room
  - If final floor: status = BossFight
  - Else: status = Active
  - Emit RelicChosen
```

### `flee`
```
Trigger: flee_dungeon
Guards:
  - status in [Active, BossFight]
Actions:
  - status = Fled
  - Calculate partial rewards (reduced %)
  - Emit DungeonFled
```

### `claim`
```
Trigger: claim_dungeon
Guards:
  - status in [Completed, Failed, Fled]
Actions:
  - Calculate final rewards based on status
  - Transfer hero NFT back to player
  - Apply building bonuses (Academy XP, Treasury NOVI)
  - Grant rewards to player
  - If Completed: Update leaderboard
  - Close DungeonRun account (refund rent)
  - Emit DungeonCompleted
```

### `resume`
```
Trigger: resume_dungeon
Guards:
  - status == Failed
  - last_checkpoint > 0
  - Player has gems for cost
Actions:
  - Deduct gems
  - resume_count += 1
  - Restore to checkpoint state
  - status = Active
  - Emit DungeonResumed
```

---

## Invariants

```
1. DungeonRun exists ⟹ hero NFT owned by DungeonRun PDA
2. status == Completed ⟹ all floors cleared
3. status == Failed ⟹ remaining_units[0..3] == [0, 0, 0]
4. current_floor in [1, template.total_floors]
5. current_room in [1, template.rooms_per_floor]
6. relic_mask bit count == relics_collected
7. darkness_level >= 0
8. boss_wrath in [0, 100]
```
