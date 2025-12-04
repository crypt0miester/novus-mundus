# Novus Mundus: Tokenomics & Economic Model

> **Dual-account system with deflationary locked NOVI and controlled reserved NOVI emissions, powered by deterministic golden ratio mathematics**

---

## Table of Contents

1. [Dual-Account System](#dual-account-system)
2. [NOVI Flow Diagram](#novi-flow-diagram)
3. [Token Burns (Deflationary)](#token-burns-deflationary)
4. [Token Mints (Controlled Inflation)](#token-mints-controlled-inflation)
5. [Fibonacci Efficiency System](#fibonacci-efficiency-system)
6. [Golden Ratio Multipliers](#golden-ratio-multipliers)
7. [Anti-Bot Economics](#anti-bot-economics)
8. [Shop & Premium Currency](#shop--premium-currency)
9. [Event Eligibility](#event-eligibility)
10. [Token Supply Management](#token-supply-management)
11. [Player Archetypes & ROI](#player-archetypes--roi)

---

## Dual-Account System

### Core Innovation

**Two separate NOVI balances with different rules** - cleanly separates **gameplay fuel** from **earned rewards**.

```
┌─────────────────────────────────────────────────────────────────┐
│                    TOKEN SEPARATION                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PlayerAccount                    UserAccount                    │
│  ┌─────────────────────┐         ┌─────────────────────┐        │
│  │   LOCKED NOVI       │         │   RESERVED NOVI      │        │
│  │                     │         │                     │         │
│  │   - Generated       │         │   - Earned          │         │
│  │   - Purchased       │   ──>   │   - Vested          │         │
│  │   - BURNED on use   │         │   - WITHDRAWABLE    │         │
│  │   - NOT withdrawable│         │   - Real income     │         │
│  └─────────────────────┘         └─────────────────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### PlayerAccount (Locked NOVI)

**Purpose**: In-game currency that powers all gameplay

**Key Rule**: **CANNOT BE WITHDRAWN** - Exists solely for gameplay

**Sources**:
| Source | Rate | Notes |
|--------|------|-------|
| Time Generation | 1-50 NOVI/5min | Based on subscription tier |
| SOL Purchases | Market rate | Converted via shop |
| Tier Deposits | Fixed amounts | 20K, 100K, 1M NOVI |
| NFT Bonuses | One-time | Hero mint bonuses |

**Uses** (All BURN NOVI from supply):
- Hire units (defensive and operative)
- Launch attacks
- Attack encounters (PvE)
- Collect resources
- Purchase equipment
- Research speed-ups
- Teleportation
- Team creation

### UserAccount (Reserved NOVI)

**Purpose**: Withdrawable earnings from competitive play

**Key Rule**: **CAN BE WITHDRAWN** - This is real play-to-earn income

**Sources**:
| Source | Prize Range | Frequency |
|--------|-------------|-----------|
| Daily Challenges | 5K-50K NOVI | Daily |
| Weekly Tournaments | 60K-500K NOVI | Weekly |
| Seasonal Events | 1M+ NOVI | Seasonal |
| World Events | 250K+ NOVI | Special |
| Encounter Loot | Varies | PvE rewards |

**Uses**:
- Withdraw to wallet (after 7-day vesting)
- Trade on DEX
- Deposit to PlayerAccount (becomes locked)

**Expiration**: Reserved NOVI expires after 90 days if not claimed → BURNED

---

## NOVI Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      EXTERNAL INFLOWS                            │
│   - SOL purchases (shop)                                         │
│   - Subscription payments                                        │
│   - Time generation (subscription-based)                         │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                 PLAYER ACCOUNT (LOCKED NOVI)                     │
│                                                                  │
│  Inflows:                        Outflows (BURNS):               │
│  ├─ Time generation              ├─ Hire units                   │
│  ├─ SOL purchases                ├─ Attack players               │
│  ├─ Tier deposits                ├─ Attack encounters            │
│  └─ Reserved → Locked            ├─ Collect resources            │
│                                  ├─ Purchase equipment           │
│  ┌─────────────────────────┐     ├─ Research speed-up            │
│  │ FIBONACCI BONUS         │     ├─ Teleportation                │
│  │ Using Fibonacci amounts │     ├─ Team creation                │
│  │ grants √φ (1.272x)      │     └─ Location claiming            │
│  │ efficiency!             │                                     │
│  └─────────────────────────┘     Rule: CANNOT WITHDRAW           │
│                                  Effect: DEFLATIONARY             │
└─────────────────────────────────────────────────────────────────┘
                          │
                          │ (Event wins, encounter loot)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                  USER ACCOUNT (RESERVED NOVI)                    │
│                                                                  │
│  Inflows:                        Outflows:                       │
│  ├─ Daily challenge wins         ├─ WITHDRAW to wallet           │
│  ├─ Tournament prizes            ├─ Deposit to Locked            │
│  ├─ Seasonal event rewards       └─ Expiration (90 days)         │
│  ├─ Leaderboard payouts                                          │
│  └─ Encounter loot (rare+)       7-day vesting before withdraw   │
│                                                                  │
│  Rule: CAN WITHDRAW              Effect: Controlled inflation    │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SOLANA WALLET                                │
│                (Tradeable on DEX, real value)                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Token Burns (Deflationary)

### Burn Mechanisms

**All NOVI consumed in gameplay is permanently destroyed from the token supply via SPL `token::burn()`.**

| Action | Burn Formula | Notes |
|--------|--------------|-------|
| **Collection** | base × time_mult × (√φ)^(level/10) | Operative units consume NOVI |
| **Player Attacks** | fixed_cost + damage_dealt × rate | Combat costs NOVI |
| **Encounter Attacks** | stamina_cost × research_mult | PvE burns NOVI |
| **Hire Units** | base_cost × (√φ)^tier | Scaling by unit tier |
| **Purchase Equipment** | fixed costs (config) | Weapons/Produce/Vehicles |
| **Research Speed-up** | gems × gem_value | Gems represent NOVI value |
| **Teleport** | distance_km ÷ 100 × base_cost | Distance-based |
| **Location Claim** | 10K NOVI | 30-day ownership |
| **Team Creation** | 50K NOVI | One-time cost |

### Deterministic Consumption Formula

```rust
// DETERMINISTIC: No randomness!
pub fn calculate_consumption(
    base_amount: u64,
    secondary_mult_bps: u64,  // Config-based
    luck_bps: u64,            // From research
    fib_bonus_bps: u64,       // If Fibonacci amount
) -> u64 {
    let result = ((base_amount as u128)
        .saturating_mul(10000)  // Base multiplier
        .saturating_mul(secondary_mult_bps)
        .saturating_mul(luck_bps)
        / 1_000_000_000_000u128) as u64;

    // Apply Fibonacci bonus if applicable
    ((result as u128).saturating_mul(fib_bonus_bps) / 10000) as u64
}
```

### SPL Token Burn (Actual Supply Reduction)

```rust
// Step 1: Reduce player's locked balance
player.locked_novi = player.locked_novi.saturating_sub(consumed);

// Step 2: BURN from total supply (actual SPL burn)
// This reduces novi_mint.supply permanently
token::burn(cpi_ctx, consumed)?;

emit!(NoviBurnedFromSupply {
    player: player.key(),
    amount: consumed,
    new_total_supply: novi_mint.supply - consumed,
});
```

---

## Token Mints (Controlled Inflation)

### Mint Sources

| Source | Cap | Approval Required |
|--------|-----|-------------------|
| **Event Prizes** | 10M/event, 50M/day | Normal DAO (3/5 + 50%) |
| **Liquidity** | 200M allocation | High (4/5 + 60%) |
| **Development** | 150M (3mo cliff, 12mo vest) | High (4/5 + 60%) |
| **Marketing** | 100M allocation | Normal DAO |
| **Partnerships** | 50M (vested) | High (4/5 + 60%) |
| **Treasury** | 50M allocation | High (4/5 + 60%) |
| **Emergency** | 50M allocation | Super-Majority (5/5 + 75%) |

### Purpose-Based Tracking

```rust
pub struct MintingConfig {
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

### Multi-Token Events (No NOVI Minting)

Sponsors can fund events with BONK, USDC, or other SPL tokens:
- Held in escrow
- DAO validates legitimacy
- **Zero impact on NOVI supply**

---

## Fibonacci Efficiency System

### The Fibonacci Bonus

**Using Fibonacci amounts grants deterministic efficiency bonuses.**

The Fibonacci sequence: 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765...

| Spending Amount | Fibonacci? | Efficiency Bonus |
|-----------------|------------|------------------|
| 1,000 NOVI | No | 1.0x (base) |
| 987 NOVI | Yes | **√φ (1.272x)** |
| 1,597 NOVI | Yes | **√φ (1.272x)** |
| 2,000 NOVI | No | 1.0x (base) |

### Implementation

```rust
pub fn is_fibonacci(n: u64) -> bool {
    // A number is Fibonacci if 5n²+4 or 5n²-4 is a perfect square
    let n2 = n.saturating_mul(n);
    let five_n2 = n2.saturating_mul(5);
    is_perfect_square(five_n2.saturating_add(4)) ||
    is_perfect_square(five_n2.saturating_sub(4))
}

// Apply bonus to consumption
let efficiency = if is_fibonacci(novi_amount) {
    GOLDEN_ROOT  // 1.272x
} else {
    1.0
};
```

### Strategic Implications

- Players memorize Fibonacci values
- Incentivizes exact spending amounts
- Creates skill expression in resource management
- Deterministic advantage for attentive players

---

## Golden Ratio Multipliers

### Time-of-Day Bonuses

All activities scale with golden ratio based on time:

| Time Period | Attack Mult | Defense Mult | Collection Mult |
|-------------|-------------|--------------|-----------------|
| Deep Night (00-03) | **φ (1.618x)** | 1/φ (0.618x) | 1/φ |
| Dawn (03-06) | √φ (1.272x) | 1.0x | 1.0x |
| Midday (09-15) | 1.0x | **φ (1.618x)** | 1.0x |
| Dusk (18-21) | 1.0x | 1.0x | 1.0x |
| Evening (21-00) | 1.0x | 1.0x | 1.0x |

### Level Scaling

```rust
// All level-based progression uses golden root
pub fn level_multiplier(level: u16) -> f64 {
    libm::pow(GOLDEN_ROOT, level as f64 / 10.0)
}
```

| Level | Multiplier | Effective Power |
|-------|------------|-----------------|
| 10 | 1.272x | √φ |
| 20 | 1.618x | φ |
| 40 | 2.618x | φ² |
| 100 | 10.86x | (√φ)^10 |

### Research Scaling

Research costs and buffs also use golden ratio:

```rust
// Cost scales exponentially
pub fn research_cost(base: u64, level: u8) -> u64 {
    (base as f64 * libm::pow(1.8, level as f64)) as u64
}

// Buff scales with golden root
pub fn research_buff(base_bps: u16, level: u8) -> u16 {
    (base_bps as f64 * libm::pow(GOLDEN_ROOT, level as f64 / 5.0)) as u16
}
```

---

## Anti-Bot Economics

### Core Principle

**Make botting unprofitable, not impossible.**

### Why Passive Farming Fails

```
Bot Strategy:
1. Create 100 accounts (10 SOL cost)
2. Generate passive NOVI (10/min each)
3. Accumulate millions of locked NOVI

Why It Fails:
❌ All generated NOVI is LOCKED
❌ Locked NOVI CANNOT be withdrawn
❌ To use it, must burn it in gameplay
❌ Bots get $0 profit from passive farming
✅ UNPROFITABLE
```

### Why Consolidation Farming Fails

```
Bot Strategy:
1. Create 100 accounts
2. Farm resources via collection
3. Transfer to main account
4. Main enters high-value events

Why It Fails:
❌ Main has high total_received / total_sent ratio
❌ Transfer ratio check: received/sent > 3:1 fails
❌ FAILS event eligibility
❌ Only eligible for small events (5K-10K NOVI)
✅ UNPROFITABLE
```

### Transfer Restrictions

| Restriction | Value | Purpose |
|-------------|-------|---------|
| Same team only | Required | Prevents cross-account Sybil |
| Account age | 7+ days | Prevents rapid cycling |
| Daily limit | 500M | Prevents mass consolidation |
| Tracking | total_sent/received | Enables ratio checks |

---

## Shop & Premium Currency

### Multi-Currency System

| Currency | Source | Use |
|----------|--------|-----|
| **SOL** | External wallet | Premium purchases |
| **NOVI** | Gameplay | Most purchases (burned) |
| **Gems** | Premium, events, research | Speed-ups, premium items |
| **Fragments** | Encounters, events | Hero leveling |
| **Cash** | Collection | Unit hiring, equipment |

### Shop Discount Layers

**Layer 1: Base Discounts** (up to 60%)
- Flash Sales (minutes-hours)
- Daily Deals (24 hours)
- Weekly Sales (7 days)
- Seasonal Sales (event-tied)

**Layer 2: Bundle Savings** (up to 35%)
| Bundle | Discount |
|--------|----------|
| Starter | 10% |
| Combat | 15% |
| Crafter | 20% |
| Explorer | 25% |
| Supreme | 35% |

**Layer 3: Fibonacci Bonus** (up to 20%)
- Spending Fibonacci amounts grants efficiency bonus

**Maximum Combined Discount**: 75%

### Milestone Loyalty

| Milestone | Spend Threshold | Permanent Discount |
|-----------|-----------------|-------------------|
| Bronze | Config | 2% |
| Silver | Config | 4% |
| Gold | Config | 6% |
| Platinum | Config | 8% |
| Diamond | Config | 10% |

---

## Event Eligibility

### Tiered Requirements

**Low-Value Events** (<25K Reserved NOVI):
```
min_account_age: 7 days
min_attacks: 5
max_transfer_ratio: 10:1
```

**Medium-Value Events** (25K-100K Reserved NOVI):
```
min_account_age: 30 days
min_attacks: 20
max_transfer_ratio: 3:1
```

**High-Value Events** (100K+ Reserved NOVI):
```
min_account_age: 60 days
min_attacks: 50
max_transfer_ratio: 2:1
require_verification: true
```

### Eligibility Check

```rust
pub fn check_eligibility(player: &PlayerAccount, event: &EventAccount) -> bool {
    // Account age
    if player.account_age_days() < event.min_account_age { return false; }

    // Activity requirement
    if player.total_attacks < event.min_attacks { return false; }

    // Transfer ratio (anti-Sybil)
    if player.total_received > 0 {
        let ratio = player.total_received / player.total_sent.max(1);
        if ratio > event.max_transfer_ratio { return false; }
    }

    // Not flagged
    if player.flagged_by_governance { return false; }

    true
}
```

---

## Token Supply Management

### Supply Allocation

```
Total Max Supply: 1,000,000,000 NOVI

Allocation Caps:
├─ Event Prizes:    400M (40%)  - Ongoing rewards
├─ Liquidity:       200M (20%)  - DEX pools
├─ Development:     150M (15%)  - Team (vested 3yr)
├─ Marketing:       100M (10%)  - Airdrops
├─ Partnerships:     50M (5%)   - Strategic (vested)
├─ Treasury:         50M (5%)   - DAO reserves
└─ Emergency:        50M (5%)   - Crisis response
```

### Supply Equilibrium

**Inflationary Pressure** (Controlled):
| Source | Amount | Frequency |
|--------|--------|-----------|
| Daily events | ~500K NOVI | Daily |
| Weekly tournaments | ~3M NOVI | Weekly |
| Seasonal events | ~10M NOVI | Monthly |
| **Total** | ~25M NOVI | Monthly (capped) |

**Deflationary Pressure** (Market-Driven):
| Source | Notes |
|--------|-------|
| Every attack | Burns NOVI |
| Every collection | Burns NOVI |
| Hiring units | Burns NOVI |
| Research speed-ups | Burns NOVI |
| Teleportation | Burns NOVI |
| Reserved expiration | 90-day inactive |
| **Total** | Scales with activity |

### Long-Term Target

**Burn Rate > Mint Rate = Deflationary**

As activity increases:
- More attacks → more burns
- More collections → more burns
- Mint rate stays capped (fixed event pools)

**Result**: NOVI becomes scarcer over time.

---

## Player Archetypes & ROI

### Free Casual Player (Rookie Tier)

| Metric | Value |
|--------|-------|
| Entry cost | 0.1 SOL |
| Subscription | None |
| Generation | 1 NOVI/5min (max 3,000) |
| Daily passive | ~288 NOVI |
| Weekly earnings | ~2K NOVI (passive only) |
| **Focus** | Event participation for Reserved NOVI |

### Competitive Free Player (Rookie Tier)

| Metric | Value |
|--------|-------|
| Entry cost | 0.1 SOL |
| Subscription | None |
| Participation | Daily + weekly events |
| Weekly earnings | ~50K+ Reserved NOVI |
| **ROI** | Skill-based (event wins = real income) |

### Epic Subscriber

| Metric | Value |
|--------|-------|
| Entry cost | 0.1 SOL |
| Subscription | 10 SOL/month |
| Generation | 10 NOVI/5min (max 30,000) |
| Daily passive | ~2,880 NOVI |
| Monthly passive | ~86K NOVI (locked, gameplay fuel) |
| **Focus** | Strong event participation + passive generation |

### Legendary Whale

| Metric | Value |
|--------|-------|
| Entry cost | 0.1 SOL |
| Subscription | 39 SOL/month |
| Generation | 50 NOVI/5min (max 150,000) |
| Daily passive | ~14,400 NOVI |
| Monthly passive | ~432K NOVI (locked, gameplay fuel) |
| **Focus** | Maximum generation + competitive dominance |

**Note**: Locked NOVI is gameplay fuel (burned on use). Real income comes from Reserved NOVI earned through events and competitions.

---

## Summary

### The Dual-Account Innovation

**PlayerAccount (Locked NOVI)**:
- Cannot withdraw
- Burns create deflation
- Makes botting worthless

**UserAccount (Reserved NOVI)**:
- Can withdraw (after vesting)
- Skill-based rewards
- Real play-to-earn

### Economic Security

**Anti-Bot Mechanisms**:
1. Passive farming → locked NOVI → worthless
2. Consolidation → fails event eligibility
3. Transfer ratio tracking → catches Sybils
4. Deterministic outcomes → no exploitation

**Legitimate Player Rewards**:
1. Organic growth → passes checks
2. Skill-based wins → reserved NOVI
3. Fibonacci efficiency → strategic advantage
4. Positive ROI → sustainable model

### Token Supply

**Deflationary Forces**:
- Burns from gameplay
- Expiration of unclaimed
- Locked NOVI eventually burned

**Controlled Inflation**:
- Capped event rewards
- Purpose-based minting
- DAO approval required
- Transparent tracking

**Result**: Sustainable tokenomics with deterministic golden ratio mathematics that rewards skill over exploitation.
