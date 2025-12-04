# NOVI Token Flow: Technical Implementation

> **Detailed token flow mechanics using Pinocchio framework with deterministic golden ratio mathematics**

---

## Overview

This document describes the complete token flow implementation where:
1. **GameEngine is the mint authority** of NOVI tokens
2. **Tokens are generated over time** based on subscription tier
3. **Burning happens on consumption** with deterministic multipliers
4. **Fibonacci amounts grant efficiency bonuses** (√φ multiplier)
5. **DAO controls minting** for prizes and events
6. **All calculations are deterministic** (no randomness)

---

## Token Types

### Locked NOVI (`player.locked_novi`)

| Property | Value |
|----------|-------|
| **Withdrawable** | No |
| **Source** | Time generation, purchases, deposits |
| **Consumption** | Hiring, attacking, collecting, etc. |
| **On Use** | BURNED from SPL supply |
| **Tracked In** | PlayerAccount |

### Reserved NOVI (`user.reserved_novi`)

| Property | Value |
|----------|-------|
| **Withdrawable** | Yes (after 7-day vesting) |
| **Source** | Events, encounters, leaderboards |
| **Expiration** | 90 days if unclaimed |
| **Tracked In** | UserAccount |

---

## Token Generation Flow

### Subscription-Based Generation

```
┌─────────────────────────────────────────────────────────────────┐
│                    SUBSCRIPTION FLOW                             │
└─────────────────────────────────────────────────────────────────┘

User subscribes (pays SOL to treasury)
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  player.subscription_tier = tier (0-3)                          │
│  player.subscription_end = now + duration                       │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼ (on claim_locked_novi call)
         │
┌─────────────────────────────────────────────────────────────────┐
│  intervals = (now - last_claim_timestamp) / 5_minutes           │
│  tokens_to_mint = intervals × generation_rate[tier]             │
│  tokens_to_mint = min(tokens_to_mint, max_cap - current)        │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  GameEngine MINTS tokens via SPL CPI                            │
│  player.locked_novi += tokens_to_mint                           │
│  player.last_claim_timestamp = now                              │
└─────────────────────────────────────────────────────────────────┘
```

### Generation Rates by Tier

| Tier | Generation (per 5 min) | Max Cap | Max Stamina |
|------|------------------------|---------|-------------|
| Rookie (Free) | 1 NOVI | 3,000 | 100 |
| Expert | 2 NOVI | 6,000 | 500 |
| Epic | 10 NOVI | 30,000 | 1,000 |
| Legendary | 50 NOVI | 150,000 | 10,000 |

**Max Cap Formula**: `max_locked_novi` from tier config (caps at 3K-150K based on tier)

---

## Token Consumption Flow (Burning)

### Deterministic Consumption Formula

```rust
/// Calculate NOVI consumption amount (DETERMINISTIC - no randomness!)
pub fn calculate_consumption(
    novi_amount: u64,
    base_mult_bp: u64,        // From economy_config
    secondary_mult_bp: u64,   // From research/hero
    luck_bp: u64,             // From research
    is_fibonacci: bool,       // Fibonacci efficiency bonus
) -> u64 {
    // Base consumption calculation using basis points
    let base_value = ((novi_amount as u128)
        .saturating_mul(base_mult_bp as u128)
        .saturating_mul(secondary_mult_bp as u128)
        .saturating_mul(luck_bp as u128)
        / 1_000_000_000_000u128) as u64;

    // Fibonacci bonus: √φ (1.272x) efficiency
    let fib_bonus_bp = if is_fibonacci {
        12720u64  // √φ = 1.272x
    } else {
        10000u64  // 1.0x
    };

    ((base_value as u128).saturating_mul(fib_bonus_bp) / 10000) as u64
}
```

### Hiring Units

```
┌─────────────────────────────────────────────────────────────────┐
│                     HIRE UNITS FLOW                              │
└─────────────────────────────────────────────────────────────────┘

Player wants to hire 100 units
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  base_cost = unit_cost × count                                  │
│  time_mult = get_time_multiplier(hiring, time_of_day)           │
│  final_cost = base_cost × time_mult                             │
│  fib_efficiency = is_fibonacci(final_cost) ? √φ : 1.0           │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  require!(player.locked_novi >= final_cost)                     │
│  player.locked_novi -= final_cost                               │
│  player.defensive_unit_N += count                               │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  // SPL Token Burn (actual supply reduction)                    │
│  token::burn(cpi_ctx, final_cost)?;                             │
└─────────────────────────────────────────────────────────────────┘
```

### Collecting Resources

```
┌─────────────────────────────────────────────────────────────────┐
│                   COLLECT RESOURCES FLOW                         │
└─────────────────────────────────────────────────────────────────┘

Player wants to collect with 1,000 NOVI
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Calculate operative units power:                               │
│    power = Σ(operative_unit_i × weight_i)                       │
│    efficiency = production_efficiency_bps (from research)       │
│    time_mult = get_time_multiplier(collecting, time_of_day)     │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Calculate NOVI consumption:                                    │
│    base = novi_amount × base_consumption_rate                   │
│    fib_bonus = is_fibonacci(novi_amount) ? √φ : 1.0             │
│    consumed = base × efficiency × time_mult × fib_bonus         │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Calculate cash generated:                                      │
│    base_cash = power × consumed × cash_per_novi                 │
│    research_bonus = cash_generation_bps / 10000                 │
│    hero_bonus = hero_economy_bps / 10000                        │
│    final_cash = base_cash × (1 + research + hero)               │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  player.locked_novi -= consumed                                 │
│  player.cash_on_hand += final_cash                              │
│  token::burn(cpi_ctx, consumed)?;  // Actual SPL burn           │
└─────────────────────────────────────────────────────────────────┘
```

### Attacking Players

```
┌─────────────────────────────────────────────────────────────────┐
│                    ATTACK PLAYER FLOW                            │
└─────────────────────────────────────────────────────────────────┘

Player initiates attack
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Calculate attack power (deterministic):                        │
│    base = Σ(defensive_unit_i × tier_weight_i)                   │
│    weapon_cov = min(weapons / total_units, 1.0)                 │
│    time_mult = get_time_multiplier(attacking, time_of_day)      │
│    research = research_attack_bps / 10000                       │
│    hero = hero_attack_bps / 10000                               │
│                                                                  │
│  // Deterministic crit (skill-based, not random!)               │
│    if research_crit_chance_bps >= 5000 {                        │
│        crit_mult = 1.0 + (crit_damage_bps / 10000)              │
│    }                                                             │
│                                                                  │
│    power = base × weapon_cov × time_mult × (1 + research + hero)│
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Calculate defense (deterministic):                             │
│    Similar formula for defender                                 │
│    Midday = φ bonus, Night = 1/φ penalty                        │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Resolve combat:                                                │
│    damage = attacker_power - (defender_power × defense_mult)    │
│    loot = defender resources × loot_bps                         │
│    Transfer loot to attacker                                    │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Burn NOVI (fixed attack cost):                                 │
│    player.locked_novi -= attack_cost                            │
│    token::burn(cpi_ctx, attack_cost)?;                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Time-of-Day Multipliers

### Activity Multiplier Matrix

```rust
pub fn get_time_multiplier(activity: ActivityType, time: TimeOfDay) -> f64 {
    match (activity, time) {
        // Attacking: Best at night
        (Attacking, DeepNight) => PHI,          // 1.618x
        (Attacking, Dawn) => GOLDEN_ROOT,       // 1.272x
        (Attacking, _) => 1.0,

        // Defending: Best at midday
        (Defending, Midday) => PHI,             // 1.618x
        (Defending, DeepNight) => INVERSE_PHI,  // 0.618x
        (Defending, _) => 1.0,

        // Hiring: Best at midday
        (Hiring, Midday) => PHI,                // 1.618x
        (Hiring, DeepNight) => INVERSE_PHI,     // 0.618x
        (Hiring, Evening) => INVERSE_PHI,       // 0.618x
        (Hiring, _) => 1.0,

        // Collecting: Slight penalties at extremes
        (Collecting, DeepNight) => INVERSE_PHI, // 0.618x
        (Collecting, Evening) => INVERSE_PHI,   // 0.618x
        (Collecting, _) => 1.0,

        // Travel: Best at night (empty roads)
        (Traveling, DeepNight) => PHI,          // 1.618x faster
        (Traveling, Dawn) => GOLDEN_ROOT,       // 1.272x faster
        (Traveling, Midday) => INVERSE_PHI,     // 0.618x slower (traffic)
        (Traveling, _) => 1.0,

        _ => 1.0,
    }
}
```

### Local Time Calculation

```rust
pub fn get_local_hour(utc_timestamp: i64, longitude: f64) -> u8 {
    let utc_hours = ((utc_timestamp % 86400) / 3600) as f64;
    let offset = longitude / 15.0;  // 15° per hour
    let local = (utc_hours + offset + 24.0) % 24.0;
    local as u8
}

pub fn get_time_of_day(hour: u8) -> TimeOfDay {
    match hour {
        0..=2 => TimeOfDay::DeepNight,   // 00:00-03:00
        3..=5 => TimeOfDay::Dawn,        // 03:00-06:00 (Golden Hour)
        6..=8 => TimeOfDay::Morning,     // 06:00-09:00
        9..=14 => TimeOfDay::Midday,     // 09:00-15:00
        15..=17 => TimeOfDay::Afternoon, // 15:00-18:00
        18..=20 => TimeOfDay::Dusk,      // 18:00-21:00 (Golden Hour)
        21..=23 => TimeOfDay::Evening,   // 21:00-00:00
        _ => TimeOfDay::Midday,
    }
}
```

---

## Fibonacci Efficiency System

### Fibonacci Detection

```rust
pub fn is_fibonacci(n: u64) -> bool {
    if n == 0 { return false; }

    // A number is Fibonacci if 5n²+4 or 5n²-4 is a perfect square
    let n2 = n.saturating_mul(n);
    let five_n2 = n2.saturating_mul(5);

    is_perfect_square(five_n2.saturating_add(4)) ||
    is_perfect_square(five_n2.saturating_sub(4))
}

fn is_perfect_square(n: u64) -> bool {
    if n == 0 { return true; }
    let sqrt = (libm::sqrt(n as f64)) as u64;
    sqrt.saturating_mul(sqrt) == n
}
```

### Efficiency Bonus Application

```rust
pub fn apply_fibonacci_bonus(base: u64, is_fib: bool) -> u64 {
    if is_fib {
        // √φ = 1.272x efficiency
        ((base as u128).saturating_mul(12720) / 10000) as u64
    } else {
        base
    }
}
```

### Common Fibonacci Values (for UX reference)

```
1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987,
1597, 2584, 4181, 6765, 10946, 17711, 28657, 46368, 75025,
121393, 196418, 317811, 514229, 832040, 1346269, 2178309,
3524578, 5702887, 9227465, 14930352, 24157817, 39088169,
63245986, 102334155, 165580141, 267914296, 433494437...
```

---

## Reserved NOVI Flow (Withdrawable)

### Earning from Events

```
┌─────────────────────────────────────────────────────────────────┐
│                    EVENT WIN FLOW                                │
└─────────────────────────────────────────────────────────────────┘

Event ends, player ranked in top 10
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Calculate prize share (deterministic):                         │
│    Rank 1: 40%, Rank 2: 20%, Rank 3: 13%, etc.                 │
│    player_prize = event.total_prize × share_bps / 10000        │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Check eligibility:                                             │
│    account_age >= min_account_age                               │
│    total_attacks >= min_attacks                                 │
│    total_received / total_sent <= max_ratio                     │
│    !flagged_by_governance                                       │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Mint to user:                                                  │
│    token::mint_to(cpi_ctx, player_prize)?;                      │
│    user.reserved_novi += player_prize                           │
│    user.reserved_novi_earned_at = now                           │
└─────────────────────────────────────────────────────────────────┘
```

### Withdrawal Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    WITHDRAWAL FLOW                               │
└─────────────────────────────────────────────────────────────────┘

Player requests withdrawal of N reserved NOVI
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Check vesting:                                                 │
│    require!(now - reserved_novi_earned_at >= 7 days)            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Check balance:                                                 │
│    require!(user.reserved_novi >= amount)                       │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Transfer to wallet:                                            │
│    token::transfer(cpi_ctx, amount)?;                           │
│    user.reserved_novi -= amount                                 │
│    user.last_withdrawal = now                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Expiration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXPIRATION FLOW                               │
└─────────────────────────────────────────────────────────────────┘

Crank processor runs (daily)
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  For each UserAccount with reserved_novi > 0:                   │
│    if now - reserved_novi_earned_at > 90 days:                  │
│        expired_amount = user.reserved_novi                      │
│        user.reserved_novi = 0                                   │
│        token::burn(cpi_ctx, expired_amount)?;                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Shop Purchase Flow

### Multi-Layer Discount Calculation

```
┌─────────────────────────────────────────────────────────────────┐
│                    SHOP DISCOUNT LAYERS                          │
└─────────────────────────────────────────────────────────────────┘

Base price: 1,000 SOL
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: Base Discounts (up to 60%)                            │
│    flash_sale_discount = 30%                                    │
│    daily_deal_discount = 0%                                     │
│    base_discount = min(30%, 60%) = 30%                          │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2: Bundle Savings (up to 35%)                            │
│    bundle_type = Combat (15%)                                   │
│    bundle_discount = 15%                                        │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3: Milestone Loyalty (permanent)                         │
│    total_spent = 10,000 SOL (Gold tier)                         │
│    milestone_discount = 6%                                      │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 4: Fibonacci Bonus (up to 20%)                           │
│    final_price_lamports = 510 lamports (near 610 fib)           │
│    fib_bonus = 0% (not exact match)                             │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Total discount calculation:                                    │
│    total = 30% + 15% + 6% = 51%                                 │
│    capped = min(51%, 75%) = 51%                                 │
│    final_price = 1000 × (1 - 0.51) = 490 SOL                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Research Cost & Buff Flow

### Starting Research

```
┌─────────────────────────────────────────────────────────────────┐
│                    START RESEARCH FLOW                           │
└─────────────────────────────────────────────────────────────────┘

Player starts "Attack Power" research (node 0, level 5)
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Check prerequisites:                                           │
│    completed_levels[0] >= 4 (upgrading from 4 to 5)             │
│    current_research == 255 (no active research)                 │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Calculate cost:                                                │
│    base_cost = template.base_novi_cost (e.g., 1000)             │
│    cost = base_cost × 1.8^level                                 │
│    cost = 1000 × 1.8^5 = 18,895 NOVI                            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Calculate time:                                                │
│    base_time = template.base_time_secs (e.g., 3600)             │
│    time = base_time × 1.5^level                                 │
│    time = 3600 × 1.5^5 = 27,337 secs (~7.6 hours)               │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Deduct cost & start:                                           │
│    player.locked_novi -= 18,895                                 │
│    token::burn(cpi_ctx, 18,895)?;                               │
│    research.current_research = 0                                │
│    research.current_level = 5                                   │
│    research.started_at = now                                    │
│    research.completes_at = now + 27,337                         │
└─────────────────────────────────────────────────────────────────┘
```

### Completing Research

```
┌─────────────────────────────────────────────────────────────────┐
│                   COMPLETE RESEARCH FLOW                         │
└─────────────────────────────────────────────────────────────────┘

Player completes "Attack Power" level 5
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Verify completion:                                             │
│    require!(now >= research.completes_at)                       │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Calculate buff:                                                │
│    base_buff = template.base_buff_bps (e.g., 100 = 1%)          │
│    buff = base_buff × (√φ)^(level/5)                            │
│    buff = 100 × 1.272^1 = 127 bps (1.27%)                       │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Apply buff:                                                    │
│    research.completed_levels[0] = 5                             │
│    player.research_attack_bps = 127                             │
│    research.current_research = 255 (none)                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Hero Buff Flow

### Leveling Hero

```
┌─────────────────────────────────────────────────────────────────┐
│                    HERO LEVEL UP FLOW                            │
└─────────────────────────────────────────────────────────────────┘

Player levels hero from 10 to 11
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Calculate fragment cost:                                       │
│    cost = 10 × 1.5^current_level                                │
│    cost = 10 × 1.5^10 = 576 fragments                           │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Deduct fragments:                                              │
│    require!(player.fragments >= 576)                            │
│    player.fragments -= 576                                      │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Calculate new buff:                                            │
│    base_attack_bps = template.base_attack_buff (e.g., 50)       │
│    new_buff = 50 × (√φ)^11 = 50 × 13.83 = 691 bps (6.91%)       │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Update hero & player:                                          │
│    hero.level = 11                                              │
│    hero.total_fragments_invested += 576                         │
│    hero.total_buff_power = recalculate_power()                  │
│    player.hero_attack_bps = sum(locked_hero_buffs)              │
└─────────────────────────────────────────────────────────────────┘
```

---

## DAO-Controlled Minting

### Prize Distribution

```rust
pub fn mint_for_prize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
    purpose: MintPurpose,
) -> ProgramResult {
    // 1. Verify DAO authority
    require!(
        dao_authority.key() == game_engine.authority,
        ErrorCode::Unauthorized
    );

    // 2. Check allocation caps
    let current = match purpose {
        MintPurpose::Prizes => game_engine.minted_for_prizes,
        MintPurpose::Liquidity => game_engine.minted_for_liquidity,
        MintPurpose::Marketing => game_engine.minted_for_marketing,
        // ...
    };
    require!(
        current + amount <= max_allocation_for_purpose(purpose),
        ErrorCode::AllocationExceeded
    );

    // 3. Mint via CPI (Pinocchio)
    invoke_signed(
        &spl_token::instruction::mint_to(
            token_program,
            novi_mint,
            recipient_ata,
            game_engine_pda,
            &[],
            amount,
        )?,
        accounts,
        &[&[GAME_ENGINE_SEED, &[game_engine.bump]]],
    )?;

    // 4. Update tracking
    match purpose {
        MintPurpose::Prizes => game_engine.minted_for_prizes += amount,
        // ...
    };
    game_engine.total_minted += amount;

    Ok(())
}
```

---

## Supply Controls

### Allocation Caps

```rust
pub struct MintingConfig {
    pub max_supply_cap: u64,             // 1,000,000,000 NOVI
    pub max_mint_per_proposal: u64,      // 100,000,000 per DAO proposal

    // Purpose-specific caps
    pub max_prize_allocation: u64,       // 400,000,000 (40%)
    pub max_liquidity_allocation: u64,   // 200,000,000 (20%)
    pub max_development_allocation: u64, // 150,000,000 (15%)
    pub max_marketing_allocation: u64,   // 100,000,000 (10%)
    pub max_partnership_allocation: u64, // 50,000,000 (5%)
    pub max_treasury_allocation: u64,    // 50,000,000 (5%)
    pub max_emergency_allocation: u64,   // 50,000,000 (5%)

    // Tracking
    pub total_minted: u64,
    pub minted_for_prizes: u64,
    pub minted_for_liquidity: u64,
    pub minted_for_development: u64,
    pub minted_for_marketing: u64,
    pub minted_for_partnerships: u64,
    pub minted_for_treasury: u64,
    pub minted_for_emergency: u64,
}
```

### Daily/Weekly Caps

```rust
pub struct GameCaps {
    pub max_event_minted_prize: u64,        // 10,000,000 per event
    pub max_daily_minted_prize_pool: u64,   // 50,000,000 all events/day
    pub max_weekly_minted_prize_pool: u64,  // 500,000,000 all events/week
}
```

---

## Summary

### Token Flow Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      COMPLETE FLOW                               │
└─────────────────────────────────────────────────────────────────┘

INFLOW:
  Subscription → Time generation → Locked NOVI → PlayerAccount
  SOL Purchase → Shop → Locked NOVI → PlayerAccount
  Event Win → Mint → Reserved NOVI → UserAccount

OUTFLOW (BURNS):
  Locked NOVI → Hire/Attack/Collect/Teleport → SPL burn()
  Reserved NOVI → Expiration (90 days) → SPL burn()

WITHDRAWAL:
  Reserved NOVI → 7-day vesting → SPL transfer() → Wallet

DETERMINISTIC MULTIPLIERS:
  Time-of-Day: φ, √φ, 1, 1/φ based on activity
  Fibonacci: √φ efficiency for Fibonacci amounts
  Level: (√φ)^(level/10) scaling
  Research: (√φ)^(level/5) buff scaling
  Hero: (√φ)^level buff scaling
```

### Key Implementation Points

1. **GameEngine is mint authority** (PDA signs for mint/burn)
2. **All burns use SPL `token::burn()`** (actual supply reduction)
3. **All calculations are deterministic** (no randomness)
4. **Golden ratio family** used for all multipliers
5. **Fibonacci detection** grants efficiency bonuses
6. **Basis points** used for all percentage values (10000 = 100%)
7. **Saturating math** prevents overflow panics
