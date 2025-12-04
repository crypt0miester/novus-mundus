# Technical Challenges & Solutions for Novus Mundus on Solana

## Core Challenges

### 1. **Time-Based Novi Generation on Solana**
**Challenge**: Solana programs can't run background processes. Novi "generates per minute" but blockchain is stateless.

**Solution**: Calculate on-demand when user claims
```rust
// Pseudo-code
let time_elapsed = current_timestamp - last_claim_timestamp;
let tier_rate = user.tier.novi_per_minute();
let generated_novi = min(
    time_elapsed * tier_rate / 60,
    user.tier.max_novi() - user.current_novi
);
```

**Implementation**:
- Store `last_claim_timestamp` in user account
- Calculate accrued Novi when user calls `claim_novi()` instruction
- Cap at tier maximum (3K/6K/30K/150K)
- User must come online to claim (creates engagement loop)

---

### 2. **Event System Architecture**
**Challenge**: Dynamic events need triggering, randomness, and state management.

**Solutions**:

**Option A: Hybrid (Recommended)**
- Event triggers: Off-chain admin authority or Clockwork scheduler
- Event state: Stored on-chain (start time, end time, rewards pool)
- Verification: All claims verified on-chain
- Example: Admin calls `start_event("RaidersBounty", 24hrs, 100K_novi_pool)`

**Option B: Fully Decentralized**
- Use Clockwork/Switchboard for automated triggers
- More complex, more expensive, but trustless
- Community governance for event creation

**Event Structure**:
```rust
pub struct GameEvent {
    pub event_type: EventType,
    pub start_timestamp: i64,
    pub end_timestamp: i64,
    pub prize_pool: u64,
    pub participants: Vec<Pubkey>,
    pub winners_claimed: bool,
}
```

---

### 3. **Leaderboards & Rankings**
**Challenge**: Maintaining real-time leaderboards on-chain is expensive and slow.

**Solution**: Hybrid approach
- **On-chain**: Store user stats (networth, kills, resources)
- **Off-chain**: Index and rank using a program like The Graph or Helius
- **Verification**: When claiming leaderboard rewards, verify on-chain stats
- **Snapshot**: Take snapshots at event end times for reward distribution

```rust
// Verify user was top 10 when claiming
pub fn claim_leaderboard_reward(
    user_stats: &UserStats,
    merkle_proof: Vec<[u8; 32]>, // Proves user was in top 10
    position: u8,
) -> Result<()> {
    require!(position <= 10, ErrorCode::NotInTopTen);
    verify_merkle_proof(user_stats.pubkey, position, merkle_proof)?;
    // Award Novi based on position
}
```

---

### 4. **Account Size & Rent**
**Challenge**: Storing all user data (units, resources, teams, events) uses space.

**Solution**: Account structure optimization
- User account: ~1KB (basic stats, novi, tier)
- Army account: ~500 bytes (unit counts)
- Event participation: Separate PDA per event
- Use `realloc` to grow accounts as needed
- Rent costs: ~0.002 SOL per account (minimal)

---

### 5. **NFT Minting Limits**
**Challenge**: "20 Fighter Jets per month, 500 max forever" needs tracking.

**Solution**: Global state accounts + Metaplex
```rust
pub struct NFTMintTracker {
    pub nft_type: NFTType,
    pub total_minted: u16,
    pub max_supply: u16,
    pub monthly_minted: u16,
    pub monthly_cap: u16,
    pub month_start: i64,
}

// Before minting
require!(tracker.total_minted < tracker.max_supply);
require!(tracker.monthly_minted < tracker.monthly_cap);
```

Reset monthly counter with cron job or first mint of new month.

---

### 6. **Attack/Defense Mechanics**
**Challenge**: Complex battle calculations need to be deterministic and efficient.

**Solution**:
- Store battle formulas in program
- Use fixed-point math (avoid floating point)
- Emit events for battle logs (off-chain indexing)
- Consider compute unit limits (max ~1.4M per transaction)

```rust
pub fn execute_attack(
    attacker: &mut User,
    defender: &mut User,
) -> BattleResult {
    // Calculate attacker power
    let attack_power = calculate_power(
        attacker.militia,
        attacker.mercenaries,
        attacker.elites,
        attacker.weapons,
    );

    // Calculate defender power
    let defense_power = calculate_defense(
        defender.militia,
        defender.mercenaries,
        defender.elites,
        defender.has_bunker,
        defender.has_iron_dome,
    );

    // Determine outcome (deterministic based on stats)
    if attack_power > defense_power {
        let stolen_cash = calculate_loot(defender.cash, attack_power, defense_power);
        // Transfer cash, burn Novi, update stats
    }
}
```

---

## BOT & SYBIL ATTACK MITIGATION

This is your **BIGGEST CHALLENGE**. 0.1 SOL alone won't stop determined farmers.

### 🔴 Attack Vectors

1. **Novi Farming**: Create 100 accounts, each generates 10 Novi/min = 1000 Novi/min passive
2. **Event Farming**: Bot accounts win daily challenges repeatedly
3. **Self-Dealing**: Bots attack each other to farm rewards without real competition
4. **Wash Trading**: Transfer resources between bot accounts to manipulate leaderboards

### ✅ Multi-Layer Defense Strategy

---

### **Layer 1: Economic Barriers** 💰

**A. Progressive Entry Fees**
```rust
pub struct GlobalState {
    pub total_players: u32,
}

pub fn calculate_entry_fee(wallet: &Pubkey, global: &GlobalState) -> u64 {
    let accounts_from_wallet = count_accounts_by_wallet(wallet);

    match accounts_from_wallet {
        0 => 0.1,  // First account
        1 => 0.5,  // Second account
        2 => 2.0,  // Third account
        _ => 10.0, // Fourth+ accounts
    }
}
```
*Problem*: Users can use different wallets (Sybil still possible)

**B. Staking Requirement**
- Lock 1 SOL for 30 days to activate account
- Get it back when you quit (but lose Novi)
- Makes mass account creation expensive

**C. Subscription Incentive**
- Free players: 10 Novi/min, capped at 3K
- Subscribers: 20-500 Novi/min, higher caps
- Subscribers get priority in events
- Economic reasoning: If someone pays 4-39 SOL/month, they're invested

---

### **Layer 2: Time-Based Restrictions** ⏰

**A. Claim Cooldowns**
```rust
pub fn claim_novi(user: &mut User) -> Result<()> {
    let time_since_last_claim = clock.unix_timestamp - user.last_claim;
    require!(time_since_last_claim >= 3600, ErrorCode::ClaimTooSoon); // 1 hour minimum

    // Calculate and award novi
}
```
- Forces bots to log in hourly (increases operational cost)
- Free players: 4-hour claim cooldown
- Subscribers: 1-hour claim cooldown

**B. Action Rate Limiting**
- Max 10 attacks per hour
- Max 5 resource collections per hour
- Prevents bot spam

**C. Account Aging**
- New accounts have lower event eligibility
- Must be active for 7 days to enter weekly tournaments
- Must be active for 30 days for seasonal events

---

### **Layer 3: Behavioral Analysis** 🤖

**A. On-Chain Heuristics**
```rust
pub fn detect_suspicious_behavior(user: &User) -> SuspicionScore {
    let mut score = 0;

    // Only attacks/defends same set of users
    if user.unique_opponents < 5 { score += 30; }

    // Never joins a team
    if user.team.is_none() && user.age_days > 14 { score += 20; }

    // Perfect timing (bot-like precision)
    if user.claim_variance < 60 { score += 25; } // Claims within 60s every time

    // Never participates in events
    if user.events_joined == 0 && user.age_days > 30 { score += 15; }

    if score > 50 { flag_for_review(user); }
}
```

**B. Social Graph Analysis** (Off-chain)
- Cluster detection: Find groups of accounts that only interact with each other
- Funding analysis: Flag wallets that fund 10+ accounts
- Pattern matching: Bot accounts have similar behavior patterns

**C. Manual Review**
- High-value rewards require admin approval
- Community reporting system
- Flagged accounts must verify humanity

---

### **Layer 4: Social Proof** 🤝

**A. Team Requirements**
```rust
pub struct TeamRewards {
    solo_player_multiplier: f32, // 0.5x
    team_player_multiplier: f32, // 1.0x
}
```
- Solo players get half rewards
- Team leaders vouch for members
- Teams have minimum member requirements (5+ players)
- Kick suspicious members or whole team gets flagged

**B. Invitation System**
- New players need invitation from existing player
- Inviters lose rewards if invitees are bots
- Creates accountability chain

**C. Reputation Scores**
- Displayed publicly
- Factors: account age, events participated, team status, reports
- Low reputation = restricted access to high-value events

---

### **Layer 5: Proof of Humanity** 🔐

**A. Civic/Identity Integration**
```rust
pub fn register_with_verification(
    civic_pass: &CivicPass,
    user: &mut User,
) -> Result<()> {
    // Verify Civic pass is valid
    require!(civic_pass.is_active(), ErrorCode::InvalidPass);

    user.verified = true;
    user.tier_multiplier = 1.5; // Verified players get boost
}
```
- Optional but highly incentivized
- Verified players: 1.5x Novi generation
- Verified players: Access to exclusive events
- Uses Civic Pass or similar (no KYC, just uniqueness proof)

**B. Captcha on Claims** (Off-chain)
- High-value claims require captcha
- Can use hCaptcha or custom challenge
- Annoying but effective

**C. Discord/Social Linking**
- Link Discord account (min 6 months old)
- Link Twitter (min 100 followers)
- Not foolproof but adds friction

---

### **Layer 6: Game Theory Design** 🎮

**A. Make Botting Unprofitable**
- Novi generation for free accounts: 10/min = 14,400/day per account
- 0.1 SOL entry + operational costs
- If Novi value is low, not worth it
- If Novi value is high, we can increase entry fees

**B. Attack-Based Rewards**
- Rewards for attacking DIVERSE opponents (not same targets)
- Penalize accounts that only attack weak/bot accounts
- Reward accounts that participate in competitive battles

**C. Decay Mechanics**
- Unused accounts lose Novi generation over time
- Forces active participation
- Bots that just farm passively lose efficiency

```rust
pub fn calculate_generation_rate(user: &User) -> u64 {
    let days_inactive = (clock.unix_timestamp - user.last_action) / 86400;
    let decay = match days_inactive {
        0..=3 => 1.0,
        4..=7 => 0.75,
        8..=14 => 0.5,
        _ => 0.25,
    };

    user.base_rate * decay
}
```

---

### **Recommended Stack**

**Minimal Viable Defense (MVP)**:
1. ✅ 0.1 SOL entry fee
2. ✅ Progressive fees for multiple accounts (2nd account = 0.5 SOL)
3. ✅ 4-hour claim cooldown for free players, 1-hour for subscribers
4. ✅ Team-based reward multipliers (solo = 0.5x, team = 1.0x)
5. ✅ Account aging requirements (7 days for tournaments)

**Enhanced Defense (Launch)**:
6. ✅ Civic Pass integration (optional, but 1.5x boost)
7. ✅ Behavioral flagging system
8. ✅ Community reporting + manual review for big claims
9. ✅ Invitation system with accountability

**Long-term/Advanced**:
10. ✅ Machine learning bot detection (off-chain analysis)
11. ✅ Social graph clustering
12. ✅ Decay mechanics for inactive farming

---

## Technical Feasibility: ✅ YES, Very Doable

**Solana is perfect for this because:**
- Low transaction costs (< $0.01 per action)
- Fast finality (400ms) for real-time gameplay
- Large account support for persistent state
- Clockwork for automated events
- Metaplex for NFT minting limits

**Architecture**:
```
┌─────────────────┐
│   Frontend      │ (React/Next.js)
│   Web/Mobile    │
└────────┬────────┘
         │
         ├─────────────┐
         │             │
┌────────▼────────┐   │
│  Solana Program │   │
│  (Game Logic)   │   │
│  - Users        │   │
│  - Events       │   │
│  - Battles      │   │
│  - Novi Claims  │   │
└────────┬────────┘   │
         │            │
    ┌────▼────────────▼─────┐
    │   Off-Chain Services  │
    │  - Event Indexer      │
    │  - Leaderboard Calc   │
    │  - Bot Detection      │
    │  - Social Graph       │
    └───────────────────────┘
```

---

## Estimated Costs

**Development**:
- Solana program: 4-8 weeks
- Frontend: 4-6 weeks
- Bot detection: 2-4 weeks (ongoing)
- **Total**: 3-4 months with 2-3 devs

**Operational**:
- RPC costs: ~$200-500/month (Helius/QuickNode)
- Event management: ~5-10 SOL/month (transaction fees)
- Infrastructure: ~$100/month (indexer, DB)
- **Total**: ~$400-700/month + SOL

**User Costs per Transaction**:
- Register: 0.1 SOL + ~0.001 SOL fee
- Claim Novi: ~0.0005 SOL
- Attack: ~0.001 SOL
- Very affordable for players!

---

## Bottom Line

**Is it possible?** ✅ Absolutely! Solana is ideal for this.

**Is it bot-proof?** ⚠️ Nothing is 100% bot-proof, but with a multi-layer defense:
- Economic barriers make it expensive
- Time restrictions make it tedious
- Social proof makes it risky
- Proof of humanity makes it hard to scale

**Recommended approach**: Start with MVP defense, monitor behavior, iterate based on actual attack patterns.

The key insight: **Bots want passive income. Make the game require active, diverse, social participation to maximize rewards.**
