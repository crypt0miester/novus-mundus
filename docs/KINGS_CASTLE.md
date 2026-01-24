# King's Castle Event System

## Overview

King's Castle is a persistent territorial control system where players compete to claim, defend, and upgrade strategic locations. Castles generate passive rewards for the ruling team and provide combat bonuses to garrisoned players.

## Core Concepts

### Castle Tiers

| Tier | Reward Multiplier | Has Court | Garrison | Description |
|------|-------------------|-----------|----------|-------------|
| Outpost | 0.25x | No | No | Small strategic point |
| Keep | 0.5x | Yes (1) | Yes | Minor fortification |
| Stronghold | 1.0x | Yes (1-3) | Yes | Standard castle |
| Fortress | 1.5x | Yes (1-3) | Yes | Major military installation |
| Citadel | 2.0x | Yes (1-3) | Yes | Legendary stronghold |

> **Note**: The tier "Stronghold" (not "Castle") is used to avoid confusion with the feature name "King's Castle".

**Tier Multiplier Effect:**
- All daily rewards are multiplied by tier multiplier
- Example: King at Citadel (2.0x) receives 1,000,000 NOVI/day instead of 500,000
- Tier is set by DAO during castle creation

**Outpost Behavior:**
- Generate small passive material rewards for nearby players
- No garrison required
- Available to be claimed and upgraded to higher tiers

### Terminology

- **King**: The ruler of a castle, must be a team leader
- **Court**: Appointed positions that provide bonuses (DAO configurable: min 1, max 3)
- **Garrison**: Team members who contribute troops/weapons/heroes to defend (max 25)
- **Rally**: Attacking force assembled to challenge a castle (uses existing rally system with `target_type = 2`)
- **Contest Period**: 2-hour window after claiming where the castle can be challenged
- **Protection Period**: 10-day immunity after successfully holding through contest period

---

## Account Architecture

All accounts use PDA-based expandable architecture to handle Solana's transaction limits.

### CastleAccount

Primary account storing castle state and configuration.

```
PDA Seeds: [CASTLE_SEED, city_id (u16 LE), castle_id (u16 LE)]
Size: ~600 bytes
```

**Fields:**

```rust
#[repr(C)]
pub struct CastleAccount {
    // Identity (8 bytes)
    pub castle_id: u16,                     // Unique castle ID within city
    pub city_id: u16,                       // City where castle is located
    pub tier: u8,                           // CastleTier enum (0-4)
    pub status: u8,                         // CastleStatus enum
    pub bump: u8,
    pub _padding1: u8,

    // Name (36 bytes)
    pub name: [u8; 32],                     // Castle name
    pub name_len: u8,
    pub _padding2: [u8; 3],

    // Location (16 bytes)
    pub latitude: f64,
    pub longitude: f64,

    // Ruler Info (80 bytes)
    pub king: Pubkey,                       // King's wallet (NULL_PUBKEY if vacant)
    pub team: Pubkey,                       // Ruling team
    pub claimed_at: i64,                    // When current king claimed
    pub contest_end_at: i64,                // When contest period ends (claimed_at + 2 hours)

    // Garrison Tracking (4 bytes)
    pub garrison_count: u8,                 // Current garrison contributors
    pub max_garrison: u8,                   // Max based on King's subscription (5/10/15/25)
    pub _padding3: [u8; 2],

    // Court Tracking (4 bytes)
    pub court_count: u8,                    // Current filled positions
    pub max_court: u8,                      // Max positions (1-3, DAO configurable)
    pub court_appointment_cooldown: u16,    // Hours between appointments

    // Upgrade Levels (8 bytes) - persist across ownership changes
    pub fortification_level: u8,            // Defense bonus (max 10)
    pub treasury_level: u8,                 // Reward bonus (max 10)
    pub chambers_level: u8,                 // Court size prerequisite (max 3)
    pub watchtower_level: u8,               // Visibility/warning bonuses (max 5)
    pub armory_level: u8,                   // Defense quality bonus (max 10)
    pub _padding4: [u8; 3],

    // Upgrade In Progress (16 bytes)
    pub upgrade_type: u8,                   // 0=none, 1-5 for each upgrade type
    pub upgrade_target_level: u8,
    pub _padding5: [u8; 6],
    pub upgrade_end_at: i64,                // When upgrade completes (0 if none)

    // DAO Configuration - Eligibility (16 bytes)
    pub min_level: u8,
    pub min_networth_millions: u8,          // In millions (e.g., 10 = 10M networth)
    pub min_troops_thousands: u8,           // In thousands (e.g., 5 = 5000 troops)
    pub _padding6: [u8; 5],
    pub protection_duration: i64,           // Default: 10 days in seconds

    // DAO Configuration - Reward Rates (48 bytes)
    pub tier_multiplier_bps: u16,           // 2500 = 0.25x, 10000 = 1.0x, 20000 = 2.0x
    pub king_loot_cut_bps: u16,             // King's cut of combat loot (1500 = 15%)
    pub _padding7: [u8; 4],
    pub king_novi_per_day: u64,             // Base: 500,000 (before tier multiplier)
    pub king_cash_per_day: u64,             // Base: 1,000,000
    pub court_novi_per_day: u64,            // Base: 50,000
    pub court_cash_per_day: u64,            // Base: 100,000
    pub member_novi_per_day: u64,           // Base: 5,000
    pub member_cash_per_day: u64,           // Base: 25,000

    // Statistics (24 bytes)
    pub times_claimed: u32,
    pub successful_defenses: u32,
    pub failed_defenses: u32,
    pub _padding8: [u8; 4],
    pub total_rewards_distributed: u64,

    // Reserved (32 bytes)
    pub _reserved: [u8; 32],
}
```

**Castle Status Enum:**
```rust
#[repr(u8)]
pub enum CastleStatus {
    Vacant = 0,           // No king, can be claimed
    Contest = 1,          // In 2-hour contest period, can be attacked
    Protected = 2,        // In protection period, cannot be attacked
    Vulnerable = 3,       // Protection expired, can be attacked
    Transitioning = 4,    // Ownership change in progress (multi-phase cleanup)
}
```

**Computed State (not stored):**
```rust
impl CastleAccount {
    pub fn is_in_contest(&self, now: i64) -> bool {
        self.status == CastleStatus::Contest as u8 && now < self.contest_end_at
    }

    pub fn is_protected(&self, now: i64) -> bool {
        self.status == CastleStatus::Protected as u8 &&
        now < self.contest_end_at + self.protection_duration
    }

    pub fn is_vacant(&self) -> bool {
        self.king == NULL_PUBKEY
    }

    pub fn can_appoint_court(&self, now: i64) -> bool {
        // Can only appoint after contest period ends
        self.status != CastleStatus::Contest as u8 &&
        self.status != CastleStatus::Transitioning as u8 &&
        now >= self.contest_end_at
    }
}
```

---

### KingRegistryAccount

**NEW**: Tracks castles ruled by a single king. Never closes - persists permanently.

```
PDA Seeds: [KING_REGISTRY_SEED, king_pubkey]
Size: ~200 bytes
```

**Fields:**
```rust
#[repr(C)]
pub struct KingRegistryAccount {
    // Identity (40 bytes)
    pub king: Pubkey,
    pub bump: u8,
    pub castle_count: u8,                   // Current number of castles ruled
    pub max_castles: u8,                    // DAO configurable limit (default: 5)
    pub _padding1: [u8; 5],

    // Castle References (160 bytes) - up to 5 castles max
    pub castles: [CastleReference; 5],
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct CastleReference {
    pub city_id: u16,
    pub castle_id: u16,
    pub claimed_at: i64,
    pub tier: u8,
    pub _padding: [u8; 19],                 // Align to 32 bytes
}
```

**Key Properties:**
- Created on first castle claim
- **Never closes** - account persists even with 0 castles
- Allows O(1) lookup of "how many castles does this king rule?"
- Prevents iteration over all castles during claim validation

---

### CourtPositionAccount

Created when a position is filled, closed when vacated.

```
PDA Seeds: [COURT_SEED, castle_pubkey, position_type (u8)]
Size: ~80 bytes
```

**Fields:**
```rust
#[repr(C)]
pub struct CourtPositionAccount {
    // Identity (40 bytes)
    pub castle: Pubkey,
    pub position_type: u8,                  // CourtPosition enum (0-4)
    pub bump: u8,
    pub _padding1: [u8; 6],

    // Holder Info (40 bytes)
    pub holder: Pubkey,                     // Player holding this position
    pub appointed_at: i64,
}
```

**Position Types & Buffs:**

| Position | ID | Primary Buff | Buff Amount | Bonus Reward |
|----------|---|--------------|-------------|--------------|
| Advisor | 0 | Attack Power | +15% (1500 bps) | +40 Melee Weapons/day |
| Scholar | 1 | Research Speed | +20% (2000 bps) | +10,000 XP/day |
| Guardian | 2 | Defense Rating | +15% (1500 bps) | +50 Units/day |
| Treasurer | 3 | Economy Output | +10% (1000 bps) | +25 Gems/day |
| Marshal | 4 | Rally Capacity | +10% (1000 bps) | +5 Rally Slots |

**Buff Application:**
- Buffs stored in PlayerAccount's COURT extension section (see below)
- Updated on appointment/dismissal
- Stacks with other bonuses (research, heroes, subscription)

---

### PlayerAccount COURT Extension

**NEW**: Add to PlayerAccount extension system.

```rust
// Extension flag
pub const EXT_COURT: u32 = 1 << 6;  // 0x0040

// Section (48 bytes)
#[repr(C)]
pub struct CourtSection {
    // Active Position (40 bytes)
    pub castle: Pubkey,                     // Castle where holding position (NULL if none)
    pub position_type: u8,                  // CourtPosition enum
    pub _padding1: [u8; 7],

    // Applied Buffs (8 bytes) - computed on appointment, cleared on dismissal
    pub court_attack_bps: u16,
    pub court_research_speed_bps: u16,
    pub court_defense_bps: u16,
    pub court_economy_bps: u16,
}
```

**Lifecycle:**
- Extension unlocked when player is first appointed to any court
- **A player can only hold ONE court position globally** (across all castles)
- Accepting a new appointment automatically resigns from previous position
- Cleared when dismissed or when castle ownership changes

**One Position Limit Rationale:**
- Prevents power concentration (one player buffed by multiple castles)
- Simplifies buff calculation (single source of truth)
- Creates political choices (which castle offers better position?)
- Extension only needs to track one castle reference

---

### GarrisonContributionAccount

Tracks individual player contributions to the garrison.

```
PDA Seeds: [GARRISON_SEED, castle_pubkey, contributor_pubkey]
Size: ~200 bytes
```

**Fields:**
```rust
#[repr(C)]
pub struct GarrisonContributionAccount {
    // Identity (72 bytes)
    pub castle: Pubkey,
    pub contributor: Pubkey,
    pub bump: u8,
    pub is_king: bool,                      // King's contribution (cannot withdraw)
    pub _padding1: [u8; 6],

    // Contribution Timestamp (8 bytes)
    pub contributed_at: i64,

    // Units Committed (24 bytes)
    pub units_1: u64,
    pub units_2: u64,
    pub units_3: u64,

    // Weapons Committed (24 bytes)
    pub melee_weapons: u64,
    pub ranged_weapons: u64,
    pub siege_weapons: u64,

    // Hero (40 bytes)
    pub hero_mint: Pubkey,                  // NULL_PUBKEY if no hero
    pub hero_defense_bps: u16,
    pub hero_weapon_eff_bps: u16,
    pub _padding2: [u8; 4],

    // Combat Loot (24 bytes) - weapons captured from attackers
    pub loot_melee: u64,
    pub loot_ranged: u64,
    pub loot_siege: u64,

    // Flags (8 bytes)
    pub loot_claimed: bool,
    pub _padding3: [u8; 7],
}
```

**Important Constraints:**
- **Maximum garrison: 25 contributors** (hard cap regardless of upgrades)
- King's subscription tier determines garrison slots:
  - Rookie: 5 contributors
  - Expert: 10 contributors
  - Epic: 15 contributors
  - Legendary: 25 contributors (maximum)
- King MUST be part of garrison (cannot withdraw while ruling)
- **Contribution BPS computed on-demand during combat resolution** (not stored)
- Resources are locked while garrisoned

### Hero Escrow Mechanism

Heroes contributed to garrison are **escrowed** using MPL Core transfers. The GarrisonContributionAccount PDA becomes the NFT owner.

**On Join Garrison (with hero):**
```rust
// Player transfers hero NFT to GarrisonContributionAccount PDA
p_core::instructions::TransferV1 {
    asset: hero_mint,
    collection: hero_collection,
    current_owner: contributor,                  // Player's wallet
    new_owner: garrison_contribution_account,   // PDA takes ownership
    payer: contributor,
    authority: contributor,                      // Player authorizes
    system_program,
}.invoke()?;

// Store hero reference
garrison.hero_mint = *hero_mint.key();
garrison.hero_defense_bps = parsed_hero.defense_bps;
garrison.hero_weapon_eff_bps = parsed_hero.weapon_efficiency_bps;
```

**On Leave/Relieve Garrison:**
```rust
// GarrisonContributionAccount PDA signs to return hero
let garrison_bump_seed = [garrison.bump];
let garrison_seeds = pinocchio::seeds!(
    GARRISON_SEED,
    castle_account.key().as_ref(),
    contributor.key().as_ref(),
    &garrison_bump_seed
);
let garrison_signer = pinocchio::instruction::Signer::from(&garrison_seeds);

p_core::instructions::TransferV1 {
    asset: hero_mint,
    collection: hero_collection,
    current_owner: garrison_contribution_account,  // PDA owns it
    new_owner: contributor,                        // Return to player
    payer: payer,                                  // Contributor or protocol
    authority: garrison_contribution_account,      // PDA authorizes
    system_program,
}.invoke_signed(&[garrison_signer])?;
```

**On Castle Transition (Crank):**
```rust
// crank_garrison_cleanup must return heroes before closing accounts
// Same pattern as leave, but payer is protocol account
// Each batch processes up to 10 garrison accounts with heroes
```

**Important:**
- Hero is **locked** while in garrison (cannot be used elsewhere)
- A hero already in dungeon/expedition cannot be garrisoned (transfer will fail)
- Heroes provide defense buffs but are **not destroyed** in combat
- On ownership transition, all heroes are returned to their contributors

---

### TeamCastleRewardAccount

Tracks time-based reward accumulation for team members.

```
PDA Seeds: [TEAM_CASTLE_REWARD_SEED, castle_pubkey, team_member_pubkey]
Size: ~80 bytes
```

**Fields:**
```rust
#[repr(C)]
pub struct TeamCastleRewardAccount {
    // Identity (72 bytes)
    pub castle: Pubkey,
    pub member: Pubkey,
    pub bump: u8,
    pub _padding1: [u8; 7],

    // Claim Tracking (16 bytes)
    pub last_claim_at: i64,
    pub total_claimed_novi: u64,
}
```

**Lifecycle:**
- Created lazily on first `claim_castle_rewards` call
- Closed during ownership transition cleanup (rent refunded)
- Player can close manually if they leave team (rent refund)

**Reward Calculation:**
```rust
fn calculate_reward(last_claim: i64, now: i64, base_rate: u64, tier_mult_bps: u16, treasury_level: u8) -> u64 {
    let elapsed_days = (now - last_claim) / SECONDS_PER_DAY;
    if elapsed_days < 1 { return 0; }

    let treasury_bonus_bps = treasury_level as u64 * 1000; // +10% per level
    let effective_rate = base_rate
        .saturating_mul(tier_mult_bps as u64)
        .saturating_div(10000)
        .saturating_mul(10000 + treasury_bonus_bps)
        .saturating_div(10000);

    effective_rate.saturating_mul(elapsed_days as u64)
}
```

---

## Castle Lifecycle

### State Diagram

```
                                    ┌──────────────┐
                                    │   Vacant     │
                                    │  (Outpost)   │
                                    └──────┬───────┘
                                           │ claim_vacant_castle
                                           ▼
                                    ┌──────────────┐
              ┌────────────────────>│   Contest    │<────────────────────┐
              │                     │  (2 hours)   │                     │
              │                     └──────┬───────┘                     │
              │                            │                             │
              │         ┌──────────────────┼──────────────────┐          │
              │         │ loses fight      │ holds 2 hours    │          │
              │         ▼                  ▼                  │          │
              │  ┌─────────────┐    ┌──────────────┐          │          │
              │  │Transitioning│    │  Protected   │          │          │
              │  │(multi-phase)│    │  (10 days)   │          │          │
              │  └──────┬──────┘    └──────┬───────┘          │          │
              │         │                  │ expires          │          │
              │         │ cleanup          ▼                  │          │
              │         │ complete  ┌──────────────┐          │          │
              │         │           │  Vulnerable  │──────────┘          │
              │         │           │  (forever)   │  loses fight        │
              │         │           └──────────────┘                     │
              │         │                                                │
              └─────────┴────────────────────────────────────────────────┘
                        new king enters Contest
```

### 1. Vacant Outpost

- Small material rewards generated for nearby players
- No garrison, no court
- Any eligible team leader can claim

### 2. Claiming a Castle

**Requirements:**
- Player must be a team leader
- Meet minimum eligibility (level, networth, troops)
- Not currently ruling maximum allowed castles (checked via KingRegistryAccount)

**Process:**
1. Player submits `claim_vacant_castle` transaction
2. KingRegistryAccount created or updated
3. Claimant becomes provisional King
4. **2-hour contest period begins** (`contest_end_at = now + 2 hours`)
5. King automatically added to garrison
6. Status = `Contest`

### 3. Contest Period (2 Hours)

This is the critical "king of the hill" phase:

- **Duration**: 2 hours from claim
- **No rewards generated** during contest
- **No protection** - can be attacked immediately
- King can recruit garrison during this time
- Court appointments **NOT available** until contest ends

**If challenged and loses:**
1. Castle enters `Transitioning` status
2. Multi-phase cleanup begins (see Ownership Change section)
3. Attacker's team becomes new ruling team
4. **New 2-hour contest period begins** for new king

**If no successful challenge in 2 hours:**
1. Status changes to `Protected`
2. 10-day protection period begins
3. Rewards start generating
4. Court appointments become available

### 4. Active Castle (Protected)

- Rewards generate for team members (time-based accumulation)
- Court can be appointed
- Garrison can be assembled
- Cannot be attacked
- Duration: 10 days from `contest_end_at`

### 5. Active Castle (Vulnerable)

- Same as protected, but can be attacked
- Status = `Vulnerable`
- Protection never returns (vulnerable forever until ownership changes)

### 6. Castle Under Attack

Uses existing rally system with `target_type = 2` (Castle).

- Rally assembled against castle
- Combat resolves immediately when rally executes
- Winner determined by combat calculation

### 7. Ownership Change (Multi-Phase)

**IMPORTANT**: Ownership change is a multi-phase process to handle Solana's account limits.

When attackers win:
1. Castle status = `Transitioning`
2. **Upgrade in progress is cancelled** (progress lost, no refund)
3. External crank (or any account) can call cleanup instructions
4. Previous garrison members reclaim their resources
5. Previous court positions vacated
6. Team reward accounts closed (rent refunded to members)
7. New king takes ownership
8. **New 2-hour contest period begins**
9. **Upgrades persist** (levels do not reset)

---

## Multi-Phase Ownership Change (Crank System)

When a castle is conquered, cleanup happens in phases that any account can trigger:

### Phase Instructions

```rust
// Anyone can call these - no special authority required
pub fn crank_garrison_cleanup(castle: Pubkey, batch_size: u8) -> ProgramResult;
pub fn crank_court_cleanup(castle: Pubkey) -> ProgramResult;
pub fn crank_rewards_cleanup(castle: Pubkey, batch_size: u8) -> ProgramResult;
pub fn crank_finalize_transition(castle: Pubkey) -> ProgramResult;
```

### Transition State Tracking

Add to CastleAccount:
```rust
// Transition Progress (8 bytes)
pub transition_garrison_cleaned: u8,    // Count of garrison accounts closed
pub transition_court_cleaned: bool,     // All court positions vacated?
pub transition_rewards_cleaned: u8,     // Count of reward accounts closed
pub transition_new_king: Pubkey,        // Pending new king (set during combat)
```

### Phase 1: Garrison Cleanup

```
Instruction: crank_garrison_cleanup
Accounts:
  - CastleAccount (1)
  - GarrisonContributionAccounts (up to 10)
  - Contributor PlayerAccounts (up to 10)
  - Hero NFT assets (up to 10, if heroes present)
  - Hero collection (1)
  - MPL Core program (1)
  - System program (1)

Batch size: 10 garrison accounts per call (hero escrow requires extra accounts)

Effect:
  1. For each garrison account with hero_mint != NULL_PUBKEY:
     - Transfer hero NFT back to contributor (PDA signs)
  2. Return units/weapons to contributor's PlayerAccount
  3. Close GarrisonContributionAccount (rent refunded to contributor)
```

### Phase 2: Court Cleanup

```
Instruction: crank_court_cleanup
Accounts: castle, up to 3 court position accounts, holders' player accounts
Effect: Clears court buffs from players, closes accounts, refunds rent
```

### Phase 3: Rewards Cleanup

```
Instruction: crank_rewards_cleanup
Accounts: castle, up to 10 team reward accounts, members' wallets
Effect: Closes accounts, refunds rent to members
```

### Phase 4: Finalization

```
Instruction: crank_finalize_transition
Accounts: castle, new king's player account, new king's registry
Effect:
- Verifies all cleanup complete
- Updates castle.king and castle.team
- Sets contest_end_at = now + 2 hours
- Sets status = Contest
- Updates KingRegistryAccount
```

**Security:**
- Any account can call crank instructions (permissionless)
- Instructions verify castle is in `Transitioning` status
- Each phase idempotent - calling twice is safe
- Finalization blocked until all cleanup phases complete

---

## Court System

### Appointment Rules

- King can appoint **any player** to court positions (not limited to team members)
- This allows for political alliances and diplomacy between teams
- Appointments free with cooldown (DAO configurable)
- Court size: minimum 1, maximum 3 (DAO configurable per castle tier)
- **Chambers upgrade is prerequisite**: Must have chambers_level >= desired position count
- **One player can hold only ONE court position globally** (across all castles)
- Accepting appointment automatically resigns from any existing position
- Court appointments only available after contest period ends

### Appointment Flow

```rust
fn appoint_court(castle: &CastleAccount, holder: &mut PlayerAccount, position_type: u8) {
    // 1. Check if player already holds a position elsewhere
    if holder.court_section().castle != NULL_PUBKEY {
        // Automatically resign from previous position
        let old_castle = holder.court_section().castle;
        let old_position = holder.court_section().position_type;
        close_court_position_account(old_castle, old_position);
        emit!(CourtResigned { ... });
    }

    // 2. Create new CourtPositionAccount
    create_court_position_account(castle, holder, position_type);

    // 3. Update holder's COURT extension
    holder.court_section_mut().castle = castle.key();
    holder.court_section_mut().position_type = position_type;
    holder.court_section_mut().court_attack_bps = position_buffs[position_type].attack;
    // ... set other buffs

    emit!(CourtAppointed { ... });
}
```

### Court Buff Storage

When appointed:
1. Player's COURT extension is updated with castle reference and position
2. Buffs written to PlayerAccount.court_attack_bps, etc.
3. Buffs apply to all player activities while holding position

When dismissed or castle transitions:
1. COURT extension cleared (castle = NULL_PUBKEY)
2. Buff fields zeroed

### Court Member Benefits

- Buff applied while holding position
- Earns enhanced reward rate (court_novi_per_day, court_cash_per_day)
- Non-team court members still receive bonuses and rewards
- **Note**: Only team members can contribute to garrison

### Vacancy

- King can dismiss court members at any time
- Court member can resign voluntarily
- Position account closed on vacancy (rent refunded)
- Player's court buffs immediately cleared

---

## Garrison System

### Maximum Garrison Size

**Hard cap: 25 contributors** (regardless of upgrades)

Garrison slots by King's subscription tier:
| Tier | Max Garrison |
|------|--------------|
| Rookie | 5 |
| Expert | 10 |
| Epic | 15 |
| Legendary | 25 |

### Contributing to Garrison

Similar to rally contribution pattern:

1. Player commits resources (troops, weapons, hero)
2. GarrisonContributionAccount created
3. Resources locked until withdrawn or relieved
4. Resources deducted from PlayerAccount immediately

### Garrison Composition

- **Team Members Only**: Only ruling team members can contribute
- **King Required**: King MUST be in garrison, cannot withdraw while ruling
- Court members who are not on the team cannot garrison

### Armory Upgrade Effect

**Armory does NOT increase garrison capacity** (capacity is fixed by subscription tier).

Instead, armory provides **defense quality bonuses**:
```
defense_bonus_bps = armory_level * 300  // +3% defense per level, max +30%
```

### Relieving Garrison Members

- King can relieve any garrison member at any time
- Relieved player's resources returned immediately
- Court members can be relieved from garrison (keeps court position)
- King cannot relieve themselves

### Voluntary Withdrawal

- Garrison members (except King) can withdraw anytime
- Resources returned immediately
- GarrisonContributionAccount closed (rent refunded)

---

## Combat System

### Rally Integration

Castle attacks use the **existing rally system** with extended target type:

```rust
// In RallyAccount
pub target_type: u8,  // 0 = player, 1 = encounter, 2 = castle
```

When `target_type = 2`:
- `target` field contains the CastleAccount pubkey
- Rally participants contribute units/weapons as normal
- Combat resolution uses castle garrison as defenders

### Rally Formation

1. Rally creator initiates attack rally against castle
2. Up to 25 players can join rally (existing max)
3. Each contributes troops, weapons, heroes
4. Rally executes when gather phase completes

### Combat Resolution

**Immediate resolution** - no siege windows.

**Participants:**
- Attackers: Up to 25 rally participants
- Defenders: Up to 25 garrison contributors

**Transaction Account Limits:**
- 25 garrison contribution accounts
- 25 rally participant accounts
- CastleAccount, GameEngineAccount, System accounts
- Total: ~55-60 accounts (within Solana's 64 limit)

### Contribution BPS (Computed On-Demand)

During combat resolution:
```rust
fn calculate_contribution_bps(garrison: &[GarrisonContributionAccount]) -> Vec<(Pubkey, u16)> {
    let total_power: u64 = garrison.iter().map(|g| calculate_power(g)).sum();

    garrison.iter().map(|g| {
        let power = calculate_power(g);
        let bps = (power * 10000 / total_power) as u16;
        (g.contributor, bps)
    }).collect()
}
```

### Combat Calculation

```rust
fn resolve_combat(rally: &RallyAccount, castle: &CastleAccount, garrison: &[GarrisonContribution]) {
    let attack_power = calculate_rally_power(rally);

    let base_defense = calculate_garrison_power(garrison);
    let fortification_bonus = castle.fortification_level as u64 * 500; // +5% per level
    let armory_bonus = castle.armory_level as u64 * 300;               // +3% per level
    let defense_power = base_defense
        .saturating_mul(10000 + fortification_bonus + armory_bonus)
        .saturating_div(10000);

    if attack_power > defense_power {
        attackers_win();
    } else {
        defenders_win();
    }
}
```

### Victory: Attackers

1. Castle status = `Transitioning`
2. `transition_new_king` = rally creator
3. Rally creator's team = pending ruling team
4. Multi-phase cleanup begins
5. After cleanup: new king installed, contest period starts
6. **Upgrades persist**

### Victory: Defenders

1. Castle remains with current King
2. Attacker resources suffer losses (DAO configurable %)
3. Defense statistics updated
4. Garrison earns combat loot
5. Garrison remains intact

---

## Upgrade System

Upgrades persist across ownership changes. Only the King can initiate upgrades.

**If ownership changes during upgrade: Upgrade is CANCELLED, progress lost, no refund.**

### Upgrade Types

| Upgrade | Effect | Max Level |
|---------|--------|-----------|
| Fortification | Defense bonus +5% per level | 10 |
| Treasury | Reward generation +10% per level | 10 |
| Chambers | Court size prerequisite (must have level >= court size) | 3 |
| Watchtower | Early warning, visibility bonuses | 5 |
| Armory | Defense quality +3% per level | 10 |

### Upgrade Costs

Costs use golden ratio family scaling (GOLDEN_ROOT = 1.272):

```rust
fn upgrade_cost(base_cost: u64, level: u8) -> u64 {
    // cost = base_cost * (GOLDEN_ROOT ^ level)
    let multiplier = GOLDEN_ROOT.powi(level as i32);
    (base_cost as f64 * multiplier) as u64
}
```

Payable in:
- Cash (primary)
- Locked NOVI (premium option)
- Combination (DAO configurable)

### Upgrade Duration

```rust
fn upgrade_duration(base_duration: i64, level: u8) -> i64 {
    // duration = base_duration * (GOLDEN_ROOT ^ level)
    let multiplier = GOLDEN_ROOT.powi(level as i32);
    (base_duration as f64 * multiplier) as i64
}
```

---

## Reward System

Rewards are **freshly minted NOVI** (not from a pool) and claimable once per 24 hours. All rewards are multiplied by castle tier multiplier.

### NOVI Minting

Castle rewards require mint authority delegation:

```rust
// In claim_castle_rewards instruction
fn mint_novi_reward(
    novi_mint: &AccountInfo,
    recipient_token_account: &AccountInfo,
    mint_authority: &AccountInfo,  // Game engine PDA with mint authority
    amount: u64,
) -> ProgramResult {
    // CPI to token program to mint
    invoke_signed(
        &spl_token::instruction::mint_to(
            &spl_token::id(),
            novi_mint.key,
            recipient_token_account.key,
            mint_authority.key,
            &[],
            amount,
        )?,
        &[novi_mint, recipient_token_account, mint_authority],
        &[&[GAME_ENGINE_SEED, &[game_engine.bump]]],
    )
}
```

### Daily Reward Tables

#### King Rewards (per day at 1.0x tier)

| Resource | Amount | Type |
|----------|--------|------|
| NOVI | 500,000 | **Minted fresh** (liquid) |
| Cash | 1,000,000 | Generated on-hand |
| Epic Materials | 500 | Tier 4 |
| Legendary Materials | 100 | Tier 5 |
| Gems | 50 | Premium |

**King Special:**
- Receives 15% cut of all combat loot from successful defenses
- **Plus** their proportional share of remaining 85% (based on garrison contribution)
- Must remain in garrison to receive rewards

#### Court Rewards (per day at 1.0x tier)

| Resource | Base Amount | Notes |
|----------|-------------|-------|
| NOVI | 50,000 | Minted fresh |
| Cash | 100,000 | On-hand |
| Rare Materials | 200 | Tier 3 |
| Epic Materials | 50 | Tier 4 |

**Plus Position-Specific Bonuses:**
- Advisor: +40 Melee Weapons
- Scholar: +10,000 XP
- Guardian: +50 Defensive Units
- Treasurer: +25 Gems
- Marshal: +5 Rally Capacity

#### Team Member Rewards (per day at 1.0x tier)

| Resource | Amount | Notes |
|----------|--------|-------|
| NOVI | 5,000 | Minted fresh |
| Cash | 25,000 | On-hand |
| Common Materials | 100 | Tier 1 |
| Uncommon Materials | 25 | Tier 2 |

**Team Member Requirements:**
- Must be on the ruling team
- Do NOT need to be in garrison
- Claim once per 24 hours

#### Garrison Rewards

**Garrison members receive NO passive daily rewards.**

Garrison contribution is for **defense only**. Garrison members are rewarded through **combat loot** when they successfully defend.

### Claiming Rewards

**Daily Claim Flow:**
1. Player calls `claim_castle_rewards` instruction
2. System checks player role (King, Court, or Team Member)
3. System checks `last_claim_at` in TeamCastleRewardAccount
4. If 24+ hours elapsed, rewards are minted/generated
5. `last_claim_at` updated to current time

**Reward Calculation:**
```rust
final_reward = base_reward * tier_multiplier_bps / 10000 * (10000 + treasury_level * 1000) / 10000
```

**Vacant Castle:**
- No rewards generated
- Claim timestamps still advance (no "banking" missed days)

---

## Combat Rewards

Garrison members earn rewards through **combat loot** when successfully defending.

### Combat Loot (Weapons from Attackers)

When garrison repels an attack:

1. **Attacker Casualties Calculated:**
   - Units lost by attackers are **destroyed** (not transferable)
   - Weapons lost by attackers become **loot pool** (only lootable resource)

2. **King's Cut (15%):**
   - King receives 15% of captured weapons
   - Applied before garrison distribution

3. **Garrison Distribution (85%):**
   - Remaining weapons distributed to garrison members
   - Distribution proportional to **contribution power** (computed during combat)
   - King also receives their proportional share of this 85%

### Loot Distribution Example

```
Attacker loses: 1000 units (destroyed), 500 weapons (lootable)

King's Cut (15%): 75 weapons

Garrison Pool (85%): 425 weapons

King contribution_bps = 4000 (40% of garrison):
  - King's pool share: 425 * 0.40 = 170 weapons
  - King total: 75 + 170 = 245 weapons

Other Member contribution_bps = 2500 (25%):
  - Member share: 425 * 0.25 = 106 weapons
```

### Claiming Combat Loot

1. After successful defense, loot recorded in GarrisonContributionAccount
2. Garrison member calls `claim_garrison_loot` instruction
3. Weapons transferred to player's inventory
4. `loot_claimed` flag set to true
5. Loot fields reset for next combat

---

## Multi-Castle Ruling

A single King can rule multiple castles simultaneously (up to DAO-configured limit).

### KingRegistryAccount Tracking

```rust
// Check during claim_vacant_castle
fn can_claim_castle(registry: &KingRegistryAccount) -> bool {
    registry.castle_count < registry.max_castles
}

// Update on claim
fn add_castle_to_registry(registry: &mut KingRegistryAccount, city_id: u16, castle_id: u16, now: i64) {
    let slot = registry.castle_count as usize;
    registry.castles[slot] = CastleReference {
        city_id,
        castle_id,
        claimed_at: now,
        tier: castle.tier,
        _padding: [0; 19],
    };
    registry.castle_count += 1;
}

// Update on loss/abdication
fn remove_castle_from_registry(registry: &mut KingRegistryAccount, city_id: u16, castle_id: u16) {
    for i in 0..registry.castle_count as usize {
        if registry.castles[i].city_id == city_id && registry.castles[i].castle_id == castle_id {
            // Shift remaining entries
            for j in i..registry.castle_count as usize - 1 {
                registry.castles[j] = registry.castles[j + 1];
            }
            registry.castle_count -= 1;
            break;
        }
    }
}
```

### Stacking

- All bonuses stack
- All rewards accumulate independently
- Court positions are per-castle (same player can be Advisor in multiple castles)

### Limitations

- Maximum castles per King: DAO configurable (default: 5)
- Must maintain eligibility for each castle
- Garrison commitments are per-castle (troops can only be in one garrison)

---

## DAO Governance

The following parameters are DAO-configurable:

### Castle Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| contest_duration | Seconds to hold before official King | 7,200 (2 hours) |
| protection_duration | Seconds of immunity after contest | 864,000 (10 days) |
| max_court_size | Maximum court positions | 3 |
| min_court_size | Minimum court positions | 1 |
| max_garrison | Hard cap on garrison size | 25 |
| max_castles_per_king | Maximum simultaneous rulerships | 5 |

### Garrison Caps by King's Subscription Tier

| Tier | Garrison Cap |
|------|--------------|
| Rookie | 5 |
| Expert | 10 |
| Epic | 15 |
| Legendary | 25 |

### Economic Parameters (Daily Rewards)

**King Rewards (per day at 1.0x tier):**

| Parameter | Description | Default |
|-----------|-------------|---------|
| king_novi | NOVI reward (minted) | 500,000 |
| king_cash | Cash reward | 1,000,000 |
| king_epic_materials | Epic materials | 500 |
| king_legendary_materials | Legendary materials | 100 |
| king_gems | Gems | 50 |

**Court Rewards (per day at 1.0x tier):**

| Parameter | Description | Default |
|-----------|-------------|---------|
| court_novi | NOVI reward (minted) | 50,000 |
| court_cash | Cash reward | 100,000 |
| court_rare_materials | Rare materials | 200 |
| court_epic_materials | Epic materials | 50 |

**Team Member Rewards (per day at 1.0x tier):**

| Parameter | Description | Default |
|-----------|-------------|---------|
| member_novi | NOVI reward (minted) | 5,000 |
| member_cash | Cash reward | 25,000 |
| member_common_materials | Common materials | 100 |
| member_uncommon_materials | Uncommon materials | 25 |

**Other Economic Parameters:**

| Parameter | Description | Default |
|-----------|-------------|---------|
| king_loot_cut_bps | King's cut of combat loot | 1500 (15%) |
| upgrade_cost_multiplier | Scaling factor for upgrades | 10000 (1.0) |

### Combat Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| attacker_loss_on_defeat | Resource loss % on failed attack | 2000 (20%) |
| defender_loss_on_defeat | Resource loss % on lost defense | 1000 (10%) |
| fortification_bonus_per_level | Defense bonus per upgrade | 500 (5%) |
| armory_bonus_per_level | Defense quality per upgrade | 300 (3%) |

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
- Not at maximum castle limit (checked via KingRegistryAccount)

### To Join Garrison

- Must be team member of ruling team
- Have resources to contribute
- Not already in this garrison

### To Hold Court Position

- Can be **any player** (not limited to team members)
- Appointed by King
- **Cannot hold another position in ANY castle** (one position globally)
- Accepting new position auto-resigns from previous
- Allows for cross-team political alliances

---

## Instructions Summary

### Castle Management

| Instruction | Description | Authority |
|-------------|-------------|-----------|
| claim_vacant_castle | Claim an unruled castle | Any eligible team leader |
| appoint_court | Fill a court position | King |
| dismiss_court | Remove from court position | King |
| resign_court | Voluntarily leave court | Court member |
| initiate_upgrade | Start castle upgrade | King |
| cancel_upgrade | Cancel in-progress upgrade | King |

### Garrison Operations

| Instruction | Description | Authority |
|-------------|-------------|-----------|
| join_garrison | Contribute to garrison | Team members |
| leave_garrison | Withdraw from garrison | Garrison members (not King) |
| relieve_garrison | Force remove from garrison | King |

### Combat (Rally System Extension)

| Instruction | Description | Authority |
|-------------|-------------|-----------|
| create_rally (target_type=2) | Start attack rally against castle | Any eligible player |
| join_rally | Contribute to rally | Any eligible player |
| execute_rally | Resolve combat | Rally creator |

### Ownership Transition (Permissionless Cranks)

| Instruction | Description | Authority |
|-------------|-------------|-----------|
| crank_garrison_cleanup | Return garrison resources (batch) | Any account |
| crank_court_cleanup | Vacate court positions | Any account |
| crank_rewards_cleanup | Close reward accounts (batch) | Any account |
| crank_finalize_transition | Install new king | Any account |

### Rewards

| Instruction | Description | Authority |
|-------------|-------------|-----------|
| claim_castle_rewards | Claim daily rewards | King, Court, Team members |
| claim_garrison_loot | Claim combat loot | Garrison members |

### DAO Operations

| Instruction | Description | Authority |
|-------------|-------------|-----------|
| create_castle | Create new castle in city | DAO |
| update_castle_config | Modify castle parameters | DAO |
| force_remove_king | Remove King from castle | DAO |

---

## Constants to Add

```rust
// PDA Seeds
pub const CASTLE_SEED: &[u8] = b"castle";
pub const GARRISON_SEED: &[u8] = b"garrison";
pub const COURT_SEED: &[u8] = b"court";
pub const KING_REGISTRY_SEED: &[u8] = b"king_registry";
pub const TEAM_CASTLE_REWARD_SEED: &[u8] = b"team_castle_reward";

// Time Constants
pub const CASTLE_CONTEST_DURATION: i64 = 7_200;       // 2 hours
pub const CASTLE_PROTECTION_DURATION: i64 = 864_000;  // 10 days

// Limits
pub const MAX_GARRISON_SIZE: u8 = 25;
pub const MAX_COURT_SIZE: u8 = 3;
pub const MAX_CASTLES_PER_KING: u8 = 5;

// Garrison caps by subscription tier
pub const GARRISON_CAP_BY_TIER: [u8; 4] = [5, 10, 15, 25];

// Upgrade bonuses (basis points per level)
pub const FORTIFICATION_BONUS_PER_LEVEL: u16 = 500;   // +5%
pub const TREASURY_BONUS_PER_LEVEL: u16 = 1000;       // +10%
pub const ARMORY_BONUS_PER_LEVEL: u16 = 300;          // +3%

// Combat loot
pub const KING_LOOT_CUT_BPS: u16 = 1500;              // 15%

// Rally target type
pub const RALLY_TARGET_CASTLE: u8 = 2;
```

---

## Events to Add

```rust
// Castle Events
pub struct CastleClaimed { player, player_name, castle_id, city_id, timestamp }
pub struct CastleContestEnded { castle_id, city_id, king, timestamp }
pub struct CastleProtectionExpired { castle_id, city_id, timestamp }
pub struct CastleTransitionStarted { castle_id, city_id, old_king, new_king, timestamp }
pub struct CastleTransitionComplete { castle_id, city_id, new_king, timestamp }

// Court Events
pub struct CourtAppointed { castle_id, position_type, holder, appointed_by, timestamp }
pub struct CourtDismissed { castle_id, position_type, holder, timestamp }
pub struct CourtResigned { castle_id, position_type, holder, timestamp }

// Garrison Events
pub struct GarrisonJoined { castle_id, contributor, units, weapons, timestamp }
pub struct GarrisonLeft { castle_id, contributor, timestamp }
pub struct GarrisonRelieved { castle_id, contributor, relieved_by, timestamp }

// Combat Events
pub struct CastleDefenseSuccess { castle_id, defender_count, attacker_count, loot_captured, timestamp }
pub struct CastleDefenseFailed { castle_id, new_king, timestamp }

// Upgrade Events
pub struct CastleUpgradeStarted { castle_id, upgrade_type, target_level, completes_at, timestamp }
pub struct CastleUpgradeCompleted { castle_id, upgrade_type, new_level, timestamp }
pub struct CastleUpgradeCancelled { castle_id, upgrade_type, reason, timestamp }

// Reward Events
pub struct CastleRewardsClaimed { castle_id, player, role, novi_amount, cash_amount, timestamp }
pub struct GarrisonLootClaimed { castle_id, player, melee, ranged, siege, timestamp }
```

---

## Implementation Notes

### Account Size Considerations

| Account | Size | Notes |
|---------|------|-------|
| CastleAccount | ~600 bytes | Fixed size |
| KingRegistryAccount | ~200 bytes | Fixed, never closes |
| CourtPositionAccount | ~80 bytes | Per position, closes on vacancy |
| GarrisonContributionAccount | ~200 bytes | Per contributor, closes on leave |
| TeamCastleRewardAccount | ~80 bytes | Per team member, closes on transition |

### Transaction Limits

**Combat Resolution (execute_rally with target_type=2):**
- 25 garrison contribution accounts (defenders)
- 25 rally participant accounts (attackers)
- CastleAccount, RallyAccount, GameEngineAccount
- King's PlayerAccount, Rally creator's PlayerAccount
- System program
- **Total: ~55-58 accounts** (safely under 64 limit)
- **Note**: Hero NFTs are NOT needed during combat - only their buff values (stored in garrison accounts)

**Crank Garrison Cleanup (with heroes):**
- CastleAccount (1)
- GarrisonContributionAccounts (10 per batch)
- Contributor PlayerAccounts (10)
- Hero NFT assets (10)
- Hero collection (1)
- MPL Core program (1)
- System program (1)
- Protocol payer (1)
- **Total: ~35 accounts per batch** (3 batches needed for 25 garrison)

### Instruction Discriminant Range

Suggested range for castle instructions: **270-299**

```rust
// Castle Instructions (270-299)
270 => castle::create_castle,
271 => castle::claim_vacant_castle,
272 => castle::appoint_court,
273 => castle::dismiss_court,
274 => castle::resign_court,
275 => castle::initiate_upgrade,
276 => castle::cancel_upgrade,
277 => castle::join_garrison,
278 => castle::leave_garrison,
279 => castle::relieve_garrison,
280 => castle::claim_castle_rewards,
281 => castle::claim_garrison_loot,
282 => castle::crank_garrison_cleanup,
283 => castle::crank_court_cleanup,
284 => castle::crank_rewards_cleanup,
285 => castle::crank_finalize_transition,
286 => castle::update_castle_config,
287 => castle::force_remove_king,
```

---

## Future Considerations

- Legendary castle tiers with unique abilities
- Castle alliances between teams
- Seasonal castle events with enhanced rewards
- Castle-specific research trees
- Decorative customization (cosmetic only)
- Castle siege equipment (special weapons for castle attacks)
- Mercenary system (non-team members can garrison for reduced rewards)
