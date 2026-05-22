# Research System Design

## Overview

The Research system provides a tech tree progression system that grants permanent buffs to players. Research nodes have multiple levels with exponentially increasing time requirements, creating a long-term progression sink for gems and NOVI.

**Key Features**:
- 30 research nodes across 3 categories (Battle, Economy, Growth)
- Multi-level progression (5-25 levels per node)
- Exponential time scaling (30 minutes → 30 days)
- Gem-based speed-ups (gems earned from Growth research)
- Prerequisite tech tree dependencies
- Permanent buffs that compound with heroes and monuments
- Sequential research (one node at a time)

## Core Mechanics

### Research Categories

**Battle Research (10 nodes)**:
- Attack Power (25 levels): +2% per level → 50% total
- Defense Power (25 levels): +2% per level → 50% total
- Unit Capacity (25 levels): +2% per level → 50% total
- Critical Hit Chance (20 levels): +1% per level → 20% total
- Critical Hit Damage (20 levels): +5% per level → 100% total
- Rally Capacity (15 levels): +1 participant per level → 15 total
- Encounter Success (20 levels): +2% per level → 40% total
- Loot Bonus (20 levels): +2% per level → 40% total
- Unit Training Speed (20 levels): +5% per level → 100% total
- Ambush Damage (15 levels): +3% per level → 45% total

**Economy Research (10 nodes)**:
- Production Efficiency (25 levels): +2% per level → 50% total
- Resource Capacity (25 levels): +2% per level → 50% total
- Market Tax Reduction (20 levels): -1% per level → -20% total
- Trade Speed (20 levels): +5% per level → 100% total
- Mining Output (20 levels): +3% per level → 60% total
- Cash Generation (20 levels): +3% per level → 60% total
- Construction Speed (20 levels): +5% per level → 100% total
- Upkeep Reduction (20 levels): -2% per level → -40% total
- Black Market Access (10 levels): Unlock rare items per level
- Tax Collection (15 levels): +2% per level → 30% total

**Growth Research (10 nodes)**:
- Daily Rewards System (5 levels): Unlocks daily claim, +50% rewards per level → 350% total
- Mining Operations (10 levels): Unlocks vehicle-based mining, +10% efficiency per level → 90% total
- Fishing Industry (10 levels): Unlocks produce multiplication, +10% efficiency per level → 90% total
- Loot Magnetism (15 levels): +5% extra loot drop chance per level → 75% total
- Reputation Mastery (20 levels): +3% reputation gain per level → 60% total
- Stamina Vitality (25 levels): +4% max stamina per level → 100% total (doubles stamina)
- Lucky Streak (20 levels): +50 basis points luck per level → +1000 bps (10%) total
- Fragment Discovery (15 levels): Unlocks fragments, +5% drop rate per level → 70% total
- Gem Prospecting (10 levels): Unlocks gems, +0.5% drop rate per level → 5.5% total
- Collection Mastery (20 levels): +2% all collection types per level → 40% total

### Time Scaling System

Research times scale exponentially to create long-term progression:

**Level 1-5** (Early Game): 30 min, 1 hr, 2 hrs, 4 hrs, 8 hrs
**Level 6-10** (Mid Game): 16 hrs, 1 day, 2 days, 3 days, 4 days
**Level 11-15** (Late Game): 5 days, 6 days, 7 days, 8 days, 10 days
**Level 16-20** (End Game): 12 days, 14 days, 16 days, 18 days, 20 days
**Level 21-25** (Max): 22 days, 24 days, 26 days, 28 days, 30 days

Formula: `time_seconds = base_time * (1.5 ^ level)`

Where base_time varies by research node importance:
- Critical nodes (Hero/City slots): 3600s (1 hour base)
- Major nodes (Attack, Defense, XP): 1800s (30 min base)
- Minor nodes (Tax, Trade): 1200s (20 min base)

### Speed-Up Mechanics

Players can spend gems to instantly complete research:

**Speed-Up Formula**:
```rust
gems_required = (remaining_seconds / 60) * gem_cost_per_minute

where gem_cost_per_minute scales by level:
- Levels 1-5: 1 gem/min
- Levels 6-10: 2 gems/min
- Levels 11-15: 5 gems/min
- Levels 16-20: 10 gems/min
- Levels 21-25: 20 gems/min
```

**Examples**:
- Level 5 (8 hrs remaining): 480 minutes × 1 gem = 480 gems
- Level 15 (10 days remaining): 14,400 minutes × 5 gems = 72,000 gems
- Level 25 (30 days remaining): 43,200 minutes × 20 gems = 864,000 gems

This creates a massive gem sink for impatient players.

### Tech Tree Prerequisites

Some research nodes require completing other nodes first:

```
Battle Tree:
├─ Attack Power (no prereq)
├─ Defense Power (no prereq)
├─ Critical Hit Chance → requires Attack Power lvl 10
├─ Critical Hit Damage → requires Critical Hit Chance lvl 10
├─ Rally Capacity → requires Attack Power lvl 5, Defense Power lvl 5
└─ Ambush Damage → requires Attack Power lvl 15

Economy Tree:
├─ Production Efficiency (no prereq)
├─ Resource Capacity (no prereq)
├─ Market Tax Reduction → requires Production Efficiency lvl 10
├─ Black Market Access → requires Market Tax Reduction lvl 15
└─ Upkeep Reduction → requires Resource Capacity lvl 15

Growth Tree:
├─ Daily Rewards System (no prereq)
├─ Collection Mastery (no prereq)
├─ Reputation Mastery (no prereq)
├─ Stamina Vitality (no prereq)
├─ Mining Operations (no prereq)
├─ Fishing Industry (no prereq)
├─ Lucky Streak → requires Reputation Mastery lvl 5
├─ Loot Magnetism → requires Lucky Streak lvl 10
├─ Fragment Discovery → requires Loot Magnetism lvl 5
└─ Gem Prospecting → requires Fragment Discovery lvl 5
```

## Data Structures

### ResearchTemplate (DAO-Controlled)

Defines each research node's properties:

```rust
#[repr(C)]
pub struct ResearchTemplate {
    pub research_type: u8,           // 0-29 (30 research nodes)
    pub category: u8,                // 0=Battle, 1=Economy, 2=Growth
    pub max_level: u8,               // 10-25 depending on node
    pub base_time_seconds: u32,      // Base research time for level 1
    pub base_novi_cost: u64,         // NOVI cost for level 1
    pub buff_type: u8,               // What stat this buffs
    pub buff_per_level_bps: u16,     // Basis points per level (e.g., 200 = 2%)
    pub prerequisite_research: u8,   // 255 = no prereq, else research_type
    pub prerequisite_level: u8,      // Required level of prerequisite
    pub gem_cost_per_minute: u16,    // Gems per minute for speed-up
    pub is_active: bool,             // DAO can disable nodes
    pub padding: [u8; 5],
}
// Size: 32 bytes
```

### ResearchProgress (Per-Player)

Tracks player's research progress:

```rust
#[repr(C)]
pub struct ResearchProgress {
    pub player: Pubkey,                    // Owner
    pub current_research: u8,              // Active research type (255 = none)
    pub current_level: u8,                 // Current level being researched
    pub started_at: i64,                   // Unix timestamp research started
    pub completes_at: i64,                 // Unix timestamp research completes
    pub completed_levels: [u8; 30],        // Current level of each research node (0-25)
    pub total_gems_spent: u64,             // Total gems spent on speed-ups
    pub total_novi_spent: u64,             // Total NOVI spent on research
    pub buff_cache_version: u32,           // Increments on research completion
    pub buffs: ResearchBuffs,              // Cached total buffs
    pub bump: u8,
    pub padding: [u8; 3],
}
// Size: 32 + 1 + 1 + 8 + 8 + 30 + 8 + 8 + 4 + 64 + 1 + 3 = 168 bytes
```

### ResearchBuffs

Buffs are split between PlayerAccount (combat/frequent) and ResearchProgress PDA (economy/passive):

```rust
// In PlayerAccount - Combat & frequently accessed buffs
pub struct PlayerAccount {
    // ... existing fields ...

    // Battle Research Buffs (12 bytes)
    pub research_attack_bps: u16,
    pub research_defense_bps: u16,
    pub research_crit_chance_bps: u16,
    pub research_crit_damage_bps: u16,
    pub research_loot_bonus_bps: u16,
    pub research_encounter_success_bps: u16,

    // Growth Research Buffs (12 bytes)
    pub research_luck_bonus_bps: u16,       // Lucky Streak
    pub research_reputation_bonus_bps: u16, // Reputation Mastery
    pub research_stamina_bonus_bps: u16,    // Stamina Vitality (% increase)
    pub research_collection_bonus_bps: u16, // Collection Mastery
    pub research_loot_magnetism_bps: u16,   // Extra loot chance
    pub research_daily_reward_bps: u16,     // Daily reward multiplier

    // Unlock flags (5 bytes)
    pub has_daily_rewards: bool,            // Daily Rewards unlocked
    pub has_mining: bool,                   // Mining unlocked
    pub has_fishing: bool,                  // Fishing unlocked
    pub has_fragment_drops: bool,           // Fragments unlocked
    pub has_gem_drops: bool,                // Gems unlocked

    // New resources (16 bytes)
    pub fragments: u64,                      // For hero leveling
    pub last_daily_claim: i64,              // Daily cooldown

    pub research_buff_version: u32,         // 4 bytes
    // Total added: ~49 bytes
}

// In ResearchProgress PDA - Economy & passive buffs
pub struct ResearchProgress {
    pub owner: Pubkey,                      // 32 bytes
    pub completed_levels: [u8; 30],         // 30 bytes - all research levels
    pub current_research: u8,               // 1 byte - active research (255=none)
    pub completes_at: i64,                  // 8 bytes
    pub started_at: i64,                    // 8 bytes

    // Economy Research Buffs (20 bytes)
    pub production_efficiency_bps: u16,
    pub resource_capacity_bps: u16,
    pub market_tax_reduction_bps: u16,
    pub trade_speed_bps: u16,
    pub cash_generation_bps: u16,
    pub construction_speed_bps: u16,
    pub upkeep_reduction_bps: u16,
    pub black_market_level: u16,
    pub tax_collection_bps: u16,
    pub mining_efficiency_bps: u16,         // Growth: Mining Operations

    // Additional Growth buffs (8 bytes)
    pub fishing_efficiency_bps: u16,        // Growth: Fishing Industry
    pub fragment_drop_rate_bps: u16,        // Growth: Fragment Discovery
    pub gem_drop_rate_bps: u16,             // Growth: Gem Prospecting
    pub _padding: u16,

    pub bump: u8,                            // 1 byte
    pub _padding2: [u8; 7],                  // 7 bytes
    // Total: 115 bytes
}
```

## PDA Derivation

### ResearchProgress PDA
```rust
seeds = [b"research", player_owner.key().as_ref()]
```

## Economic Analysis

### NOVI Sink

Research costs scale exponentially:

```rust
novi_cost = base_cost * (1.8 ^ level)

Example (Attack Power, base 10,000 NOVI):
- Level 1: 10,000 NOVI
- Level 5: 64,000 NOVI
- Level 10: 1,280,000 NOVI
- Level 15: 25,600,000 NOVI
- Level 20: 512,000,000 NOVI
- Level 25: 10,240,000,000 NOVI

Total to max one node (25 levels): ~15B NOVI
Total to max all 30 nodes: ~450B NOVI
```

This creates an enormous long-term NOVI sink.

### Gem Sink & Generation

**Gem Generation (from Growth Research):**
- Gem Prospecting Level 1: 1% drop rate from encounters
- Gem Prospecting Level 10: 5.5% drop rate from encounters
- Average player: ~5-10 gems per day from encounters

**Gem Consumption (Speed-ups):**
```rust
Total gems to instantly complete max-level research:
- Level 25 node (30 days): 43,200 min × 20 gems/min = 864,000 gems
- To instantly complete all 30 nodes at max level: ~26M gems
```

This creates a sustainable economy where:
- Casual players: Use gems sparingly for critical research
- Dedicated players: Farm encounters heavily for gems
- Whales: May purchase gems (if monetized) for instant progress

## Growth Feature Details

### Daily Rewards System
Once unlocked through research:
```rust
pub fn claim_daily_reward(player: &mut PlayerAccount) -> Result<(), GameError> {
    let now = Clock::get()?.unix_timestamp;

    // Check 24-hour cooldown
    if now - player.last_daily_claim < 86400 {
        return Err(GameError::DailyRewardOnCooldown);
    }

    // Base reward: 100 cash, multiplied by research bonus
    let base_reward = 100u64;
    let multiplier = 10000 + player.research_daily_reward_bps; // e.g., 45000 = 4.5x
    let final_reward = (base_reward as u128 * multiplier as u128 / 10000) as u64;

    player.cash_on_hand += final_reward;
    player.last_daily_claim = now;
    Ok(())
}
```

### New Collection Types

**Mining (Unlocked via Research):**
- Uses vehicles instead of operative units
- Consumes locked NOVI like normal collection
- Generates weapons and produce instead of cash
- Efficiency boosted by mining_efficiency_bps

**Fishing (Unlocked via Research):**
- Uses operative units
- Consumes produce as "bait"
- Generates more produce (multiplication effect)
- Efficiency boosted by fishing_efficiency_bps

### Fragment & Gem Drops

Integrated into encounter loot calculation:
```rust
pub fn calculate_encounter_loot(
    encounter: &EncounterAccount,
    player: &PlayerAccount,
) -> LootRewards {
    let mut loot = base_calculation();

    // Fragment drops (if unlocked)
    if player.has_fragment_drops {
        let drop_chance = player.research_fragment_drop_rate_bps;
        if random_bp(10000) < drop_chance {
            loot.fragments = calculate_fragment_amount(encounter.level);
        }
    }

    // Gem drops (if unlocked)
    if player.has_gem_drops {
        let drop_chance = player.research_gem_drop_rate_bps;
        if random_bp(10000) < drop_chance {
            loot.gems = 1; // Gems are always single drops
        }
    }

    // Loot Magnetism (chance for double loot)
    let magnetism_chance = player.research_loot_magnetism_bps;
    if random_bp(10000) < magnetism_chance {
        // Create second loot account with same rewards
        loot.create_double = true;
    }

    loot
}
```

## Buff Application

### Recalculating Research Buffs

When research completes, recalculate all buffs:

```rust
pub fn recalculate_research_buffs(
    progress: &mut ResearchProgress,
    templates: &[ResearchTemplate; 30],
) -> Result<()> {
    let mut new_buffs = ResearchBuffs::default();

    for i in 0..30 {
        let template = &templates[i];
        let completed_level = progress.completed_levels[i];

        if completed_level == 0 {
            continue;
        }

        // Calculate total buff for this research
        let total_buff_bps = (template.buff_per_level_bps as u32)
            .checked_mul(completed_level as u32)
            .ok_or(GameError::MathOverflow)? as u16;

        // Apply to appropriate buff field
        match template.buff_type {
            0 => new_buffs.attack_power_bps = total_buff_bps,
            1 => new_buffs.defense_power_bps = total_buff_bps,
            // ... map all 30 buff types
            _ => {}
        }
    }

    progress.buffs = new_buffs;
    progress.buff_cache_version = progress.buff_cache_version.wrapping_add(1);
    Ok(())
}
```

### Compound Stacking

Research buffs multiply with hero and monument buffs:

```rust
// Example: Calculate total attack power
let base_attack = 1000;

let hero_multiplier = 10000 + player.hero_buffs.attack_power_bps;  // e.g., 12000 = 1.2x
let monument_multiplier = 10000 + city.monument_buffs.attack_power_bps;  // e.g., 11500 = 1.15x
let research_multiplier = 10000 + research.buffs.attack_power_bps;  // e.g., 15000 = 1.5x

let final_attack = (base_attack as u128)
    .saturating_mul(hero_multiplier as u128)
    .saturating_div(10000)
    .saturating_mul(monument_multiplier as u128)
    .saturating_div(10000)
    .saturating_mul(research_multiplier as u128)
    .saturating_div(10000) as u64;

// 1000 × 1.2 × 1.15 × 1.5 = 2,070 total attack
```

## Instructions

### 120: Initialize Research (DAO Only)

Initialize ResearchTemplate accounts (done once per research node).

**Accounts**:
- `[signer]` dao_authority: DAO authority
- `[writable]` research_template: ResearchTemplate PDA
- `[]` game_engine: GameEngine (verify DAO)
- `[]` system_program

**Instruction Data**:
```rust
[0]      research_type: u8
[1]      category: u8
[2]      max_level: u8
[3]      base_time_seconds: u32 (4 bytes)
[7]      base_novi_cost: u64 (8 bytes)
[15]     buff_type: u8
[16]     buff_per_level_bps: u16 (2 bytes)
[18]     prerequisite_research: u8
[19]     prerequisite_level: u8
[20]     gem_cost_per_minute: u16 (2 bytes)
```

**Logic**:
1. Verify DAO authority
2. Initialize ResearchTemplate PDA
3. Set all template fields

### 121: Create Research Progress

Create ResearchProgress account for player.

**Accounts**:
- `[signer]` player_owner: Player's wallet
- `[writable]` research_progress: ResearchProgress PDA (to create)
- `[writable]` payer: Pays rent
- `[]` system_program

**Instruction Data**: None

**Logic**:
1. Derive ResearchProgress PDA
2. Allocate account (168 bytes)
3. Initialize with default values (all levels = 0)

### 122: Start Research

Begin researching a specific node.

**Accounts**:
- `[signer]` player_owner: Player's wallet
- `[writable]` research_progress: ResearchProgress PDA
- `[]` research_template: ResearchTemplate for node
- `[writable]` player_account: PlayerAccount (deduct NOVI)
- `[]` game_engine: GameEngine

**Instruction Data**:
```rust
[0] research_type: u8  // Which research to start
```

**Logic**:
1. Verify no active research (current_research == 255)
2. Load ResearchTemplate
3. Check prerequisites met
4. Check current_level < max_level
5. Calculate NOVI cost: `base_cost * (1.8 ^ next_level)`
6. Deduct NOVI from PlayerAccount
7. Calculate completion time: `now + (base_time * 1.5 ^ next_level)`
8. Set current_research, started_at, completes_at
9. Increment total_novi_spent

### 123: Complete Research

Claim completed research (can be called by anyone, gas-less).

**Accounts**:
- `[signer]` payer: Anyone (enables gas-less completions)
- `[writable]` research_progress: ResearchProgress PDA
- `[]` research_template: ResearchTemplate for node

**Instruction Data**: None

**Logic**:
1. Verify current_research != 255 (research active)
2. Verify Clock::get()?.unix_timestamp >= completes_at
3. Increment completed_levels[current_research]
4. Recalculate all research buffs
5. Clear current_research (set to 255)
6. Increment buff_cache_version

### 124: Speed Up Research

Spend gems to instantly complete research.

**Accounts**:
- `[signer]` player_owner: Player's wallet
- `[writable]` research_progress: ResearchProgress PDA
- `[writable]` player_account: PlayerAccount (deduct gems)
- `[]` research_template: ResearchTemplate for node

**Instruction Data**:
```rust
[0..8] speed_up_seconds: u64  // How many seconds to skip (0 = complete all)
```

**Logic**:
1. Verify current_research != 255 (research active)
2. Calculate remaining_seconds = completes_at - now
3. If speed_up_seconds == 0, set speed_up_seconds = remaining_seconds
4. Calculate gems needed: `(speed_up_seconds / 60) * gem_cost_per_minute`
5. Verify PlayerAccount has enough gems
6. Deduct gems from PlayerAccount
7. Subtract speed_up_seconds from completes_at
8. If completes_at <= now, trigger completion automatically
9. Increment total_gems_spent

### 125: Cancel Research

Cancel active research (refunds 50% NOVI, no time refund).

**Accounts**:
- `[signer]` player_owner: Player's wallet
- `[writable]` research_progress: ResearchProgress PDA
- `[writable]` player_account: PlayerAccount (refund NOVI)
- `[]` research_template: ResearchTemplate for node

**Instruction Data**: None

**Logic**:
1. Verify current_research != 255 (research active)
2. Calculate NOVI spent: `base_cost * (1.8 ^ current_level)`
3. Refund 50%: `novi_spent / 2`
4. Add refund to PlayerAccount
5. Clear current_research (set to 255)
6. Subtract refund from total_novi_spent

### 126: Update Research Template (DAO Only)

DAO can update research parameters.

**Accounts**:
- `[signer]` dao_authority: DAO authority
- `[writable]` research_template: ResearchTemplate PDA
- `[]` game_engine: GameEngine (verify DAO)

**Instruction Data**:
```rust
[0]      field_to_update: u8  // 0=base_time, 1=base_cost, 2=buff_bps, etc.
[1..9]   new_value: u64       // New value for field
```

**Logic**:
1. Verify DAO authority
2. Update specified field in ResearchTemplate
3. Emit event for tracking

### 127: Claim Daily Reward

Claim daily reward (Growth research unlock).

**Accounts**:
- `[signer]` player_owner: Player's wallet
- `[writable]` player_account: PlayerAccount
- `[writable]` user_account: UserAccount (for reserved novi if applicable)

**Instruction Data**: None

**Logic**:
1. Verify has_daily_rewards == true
2. Check last_daily_claim + 86400 < now
3. Calculate reward: base * (10000 + research_daily_reward_bps) / 10000
4. Add to cash_on_hand
5. Update last_daily_claim

### 128: Collect Resources Extended

Modified to support new collection types from Growth research.

**Instruction Data**:
```rust
[0] collection_type: u8  // 0=Industrial, 1=Office, 2=Residential, 3=Mining, 4=Fishing
[1..9] novi_amount: u64
```

**Logic for new types**:

**Mining (type 3)**:
1. Verify has_mining == true
2. Use vehicles instead of operative units for power
3. Generate weapons and produce instead of cash
4. Apply mining_efficiency_bps from ResearchProgress

**Fishing (type 4)**:
1. Verify has_fishing == true
2. Consume produce as "bait" (1:1 with operative units)
3. Generate produce at 150% rate (multiplication)
4. Apply fishing_efficiency_bps from ResearchProgress

### 129: Query Research Buffs

Read-only helper to get current research buffs (not a transaction).

This is implemented client-side by reading ResearchProgress account data.

### 128: Batch Complete Research

Allow completing multiple research nodes in one transaction (gas optimization).

**Accounts**:
- `[signer]` payer: Anyone
- `[writable]` research_progress: ResearchProgress PDA
- `[]` research_template_0..N: Up to 5 ResearchTemplates

**Instruction Data**: None

**Logic**:
1. Check each active research slot (if we allow queuing in future)
2. Complete all that are ready
3. Recalculate buffs once at end

### 129: Get Research Requirements

Client helper to check if prerequisites are met (read-only).

Implemented client-side by reading ResearchProgress.completed_levels and comparing to ResearchTemplate.prerequisite_*.

## Integration with Heroes and Monuments

### Buff Application Order

1. **Base Stats**: Load from PlayerAccount/CityAccount
2. **Hero Buffs**: Load from PlayerAccount.hero_buffs (cached)
3. **Monument Buffs**: Load from CityAccount.monument_buffs (cached)
4. **Research Buffs**: Load from ResearchProgress.buffs (cached)
5. **Multiply All**: `final_stat = base * hero_mult * monument_mult * research_mult`

Example:
```rust
pub fn calculate_total_attack(
    player: &PlayerAccount,
    city: &CityAccount,
    research: &ResearchProgress,
) -> u64 {
    let base = player.offensive_vehicles + player.offensive_weapons;

    let hero_mult = 10000 + player.hero_buffs.attack_power_bps;
    let monument_mult = 10000 + city.monument_buffs.attack_power_bps;
    let research_mult = 10000 + research.buffs.attack_power_bps;

    (base as u128)
        .saturating_mul(hero_mult as u128)
        .saturating_div(10000)
        .saturating_mul(monument_mult as u128)
        .saturating_div(10000)
        .saturating_mul(research_mult as u128)
        .saturating_div(10000) as u64
}
```

### Refresh Strategy

Research buffs are automatically recalculated on:
- Complete Research (instruction 123)
- Speed Up Research (instruction 124) - if auto-completes

No need to pass research account to every instruction since buffs are cached and rarely change (research takes days to complete).

## Client Implementation

### Starting Research

```typescript
const researchType = 0; // Attack Power
const template = await program.account.researchTemplate.fetch(templatePda);
const progress = await program.account.researchProgress.fetch(progressPda);

// Check prerequisites
if (template.prerequisiteResearch !== 255) {
  const prereqLevel = progress.completedLevels[template.prerequisiteResearch];
  if (prereqLevel < template.prerequisiteLevel) {
    throw new Error('Prerequisite not met');
  }
}

// Calculate cost
const nextLevel = progress.completedLevels[researchType] + 1;
const noviCost = template.baseNoviCost * Math.pow(1.8, nextLevel);

await program.methods
  .startResearch(researchType)
  .accounts({
    playerOwner: wallet.publicKey,
    researchProgress: progressPda,
    researchTemplate: templatePda,
    playerAccount: playerPda,
    gameEngine: gameEnginePda,
  })
  .rpc();
```

### Polling for Completion

```typescript
// Backend cron job runs every minute
const allResearch = await program.account.researchProgress.all();
const now = Math.floor(Date.now() / 1000);

for (const research of allResearch) {
  if (research.currentResearch !== 255 && research.completesAt <= now) {
    // Gas-less complete (backend pays)
    await program.methods
      .completeResearch()
      .accounts({
        payer: backendWallet.publicKey,
        researchProgress: research.publicKey,
        researchTemplate: templatePdas[research.currentResearch],
      })
      .rpc();
  }
}
```

### Speed-Up UI

```typescript
const remaining = progress.completesAt - now;
const gemCost = Math.floor(remaining / 60) * template.gemCostPerMinute;

// Show user: "Speed up 10 days for 72,000 gems?"
await program.methods
  .speedUpResearch(new BN(remaining))
  .accounts({
    playerOwner: wallet.publicKey,
    researchProgress: progressPda,
    playerAccount: playerPda,
    researchTemplate: templatePda,
  })
  .rpc();
```

## Implementation Timeline

**Week 1-2**: Core data structures and PDAs
- ResearchTemplate and ResearchProgress structs
- Initialize Research (120)
- Create Research Progress (121)

**Week 3-4**: Research flow
- Start Research (122)
- Complete Research (123)
- Cancel Research (125)

**Week 5-6**: Speed-ups and DAO controls
- Speed Up Research (124)
- Update Research Template (126)
- Batch Complete (128)

**Week 7-8**: Buff integration
- Recalculation logic
- Integration with combat/economy processors
- Testing compound buffs with heroes/monuments

**Week 9-10**: Tech tree and prerequisites
- Implement prerequisite checking
- Balance all 30 research nodes
- Economic tuning

**Week 11-12**: Client implementation and polish
- Research UI components
- Backend polling for auto-completion
- Gas-less completion infrastructure
- Analytics and tracking

## Economic Impact Summary

**Total NOVI Sink** (maxing all research):
- ~450B NOVI to max all 30 nodes
- Average player path (~50% completion): ~100B NOVI
- Creates multi-year progression for dedicated players

**Gem Economy**:
- Generation: 5-10 gems/day with maxed Gem Prospecting
- Consumption: ~26M gems to instantly max all research
- Realistic usage: ~5M gems per player over lifetime
- Self-sustaining economy through Growth research

**Fragment Economy**:
- Generation: Unlocked via Fragment Discovery research
- Drop rate: Up to 70% from encounters when maxed
- Usage: Hero leveling system (see HEROES.md)
- Creates bridge to hero progression system

**New Gameplay Unlocks**:
- Daily Rewards: Passive income system for retention
- Mining: Vehicle-based resource generation (weapons/produce)
- Fishing: Produce multiplication mechanic
- Loot Magnetism: Up to 75% chance for double loot
- Collection types expand from 3 to 5

**Time Investment**:
- Minimum time to max one node: 750 days (25 levels × 30 days avg)
- Sequential research: 1 node at a time
- Total time to max all nodes (no speed-ups): ~60+ years
- Realistic progression (with speed-ups): 2-3 years

This creates the longest-term progression system in the game, ensuring player retention and continuous engagement while unlocking new gameplay mechanics throughout the journey.

## Key Design Decisions

### Why Split Buffs Between Accounts

**PlayerAccount stores combat/frequent buffs:**
- Used during rallies (all participants needed)
- Applied in every attack calculation
- Accessed multiple times per instruction
- Avoids passing extra PDAs to rally execution

**ResearchProgress PDA stores economy/passive buffs:**
- Only needed during specific economy actions
- Not required for combat calculations
- Reduces PlayerAccount size pressure
- Can be loaded only when needed

### Growth Research Philosophy

Rather than adding systemic changes that require new infrastructure:
- **Unlocks enhance existing systems** (collection, loot, resources)
- **New features are optional** (daily rewards, mining, fishing)
- **Resources prepare for future** (fragments for heroes, gems for speed-ups)
- **Every node has clear value** (no abstract concepts)

### Sequential Research Benefits

- **Simpler state management** (one active research)
- **Clear progression path** (no confusion about priorities)
- **Forces strategic choices** (can't research everything at once)
- **Reduces account size** (no queue management needed)
