# Novus Mundus: Implementation Roadmap

## Document Structure Overview

You now have a complete game design with security hardening:

1. **README.md** - Original 10-day round concept
2. **README2.md** - Continuous world with event-based engagement ⭐
3. **TECHNICAL_CHALLENGES.md** - Solana feasibility + initial bot mitigation
4. **DUAL_ACCOUNT_SYSTEM.md** - Locked vs Reserved Novi architecture ⭐⭐
5. **SECURITY_HARDENING.md** - Comprehensive exploit mitigation ⭐⭐⭐

---

## Core Design Principles (Final)

### 1. Dual-Account Economy ✅
- **Player Account (Locked Novi)**: Generated passively, purchased, never withdrawable
- **User Account (Reserved Novi)**: Event rewards, fully withdrawable
- **Flow**: Reserved → Player (optional) → Burned via gameplay

**Why it works:**
- Bots farming passive generation get worthless locked Novi
- Real earnings require winning competitive events (skill-based)
- Clear value proposition for players

### 2. Transfer Activity Graph (TAG) ✅
- Track ALL cash/resource movements on-chain
- Flag suspicious patterns (one-way funneling, consolidation)
- Event eligibility based on "organic growth" vs "transfer received"

**Why it works:**
- Sybil accounts consolidating resources get flagged
- High-value events require majority of networth from attacks/collection
- Transfer ratios enforced (received ≤ 3x sent for tournaments)

### 3. Event-Driven Engagement ✅
- Daily, weekly, seasonal events with Reserved Novi prizes
- Dynamic requirements (age, diversity, organic growth %)
- Tiered eligibility (casual vs competitive events)

**Why it works:**
- Constant opportunities to earn withdrawable Novi
- Bots can't win without diverse, skilled gameplay
- Legitimate players always have a path to profit

---

## Critical Security Measures

### Tier 1: Must Have (Launch Blockers)

| Feature | Purpose | Implementation |
|---------|---------|----------------|
| **Transfer Activity Graph** | Prevent Sybil consolidation | Track sent/received, ratio limits, cooldowns |
| **Organic Growth Scoring** | Detect transfer-based accounts | `networth_from_attacks` / `total_networth` |
| **Event Eligibility Gates** | Protect high-value events | Age + diversity + organic % requirements |
| **Multi-Sig Admin** | Prevent centralized abuse | 3-of-5 multisig for event prizes |
| **Emergency Pause** | Stop exploits in progress | Global pause mechanism |
| **Civic Pass Integration** | Proof of humanity | Required for events >50K reserved Novi |

### Tier 2: Should Have (Month 2-3)

| Feature | Purpose | Implementation |
|---------|---------|----------------|
| **Behavioral Analysis** | Detect bot patterns | Timing variance, diversity, social metrics |
| **Team Reputation System** | Accountability | Flag members → team loses eligibility |
| **Withdrawal Vesting** | Prevent market dumps | Large prizes (>100K) vest over 30 days |
| **ML Sybil Detection** | Off-chain cluster analysis | Graph analysis, funding source correlation |

### Tier 3: Nice to Have (Month 4+)

| Feature | Purpose | Implementation |
|---------|---------|----------------|
| **Dynamic Tier Pricing** | Economic balance | Legendary cost increases with adoption |
| **Community Governance** | Decentralization | Vote on flagging decisions |
| **Insurance Pools** | Player protection | Compensate victims of exploits |
| **Advanced Game Theory** | Continuous improvement | Rebalance based on player behavior |

---

## The Cash Movement Exploit (SOLVED)

### Original Vulnerability
```
Attacker creates 100 accounts → Farms resources → Transfers to main account
→ Main account wins "Resource Baron" event → Withdraws 50K reserved Novi → Profit
```

### Multi-Layer Defense

**Layer 1: Transfer Restrictions**
```rust
// Can only transfer if:
- Same team (enforced)
- Both accounts 7+ days old
- Max 100M per day per relationship
- 1 hour cooldown between transfers
- Ratio check: received ≤ 10x sent
- Max 20 unique recipients
- Cluster score < 75 (off-chain analysis)
```

**Layer 2: Event Eligibility**
```rust
// To enter "Resource Baron" (50K prize):
- Account age: 30+ days
- Organic growth: 50% of networth from attacks/collection
- Max received transfers: 200M lifetime
- Transfer ratio: received ≤ 3x sent
- Unique opponents attacked: 20+
```

**Layer 3: Team Accountability**
```rust
// Team requirements:
- 10+ active members (logged in last 7 days)
- Member creation variance: 7+ days spread
- Internal transfer ratio: <50% of team wealth
- Reputation: 60+ (loses points if members flagged)
```

**Result:**
- Sybil attacker can transfer, BUT main account fails eligibility
- Organic growth % too low (mostly from transfers)
- Transfer ratio too high (received >> sent)
- Gets flagged, cannot participate in high-value events
- **Attack becomes unprofitable**

---

## Economic Model (Final)

### Novi Flow Diagram
```
┌─────────────────────────────────────────────────────┐
│              EXTERNAL PURCHASES                     │
│   0.5-420 SOL → Locked Novi (direct)               │
│   4-39 SOL/month → Generation boost (subscription)│
└─────────────┬───────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────┐
│         PLAYER ACCOUNT (LOCKED NOVI)                │
│                                                     │
│  Sources:                                           │
│  • Time generation (10-500/min based on tier)      │
│  • Purchases                                        │
│  • NFT bonuses (reduced)                           │
│  • Transfers from User Account                     │
│                                                     │
│  Uses:                                              │
│  • Hire units                                       │
│  • Attack players                                   │
│  • Collect resources                               │
│  • Tier upgrades                                    │
│                                                     │
│  Rule: CANNOT WITHDRAW (burns via gameplay)        │
└─────────────────────────────────────────────────────┘
              ▲
              │ (Optional deposit)
              │
┌─────────────┴───────────────────────────────────────┐
│         USER ACCOUNT (RESERVED NOVI)                │
│                                                     │
│  Sources:                                           │
│  • Daily challenges (5-50K)                        │
│  • Weekly tournaments (60-500K)                    │
│  • Seasonal events (1M+)                           │
│  • Leaderboard payouts (10-200K)                   │
│                                                     │
│  Uses:                                              │
│  • WITHDRAW to wallet (main use)                   │
│  • Deposit to Player Account                       │
│                                                     │
│  Rule: CAN WITHDRAW (real earnings)                │
└─────────────┬───────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────┐
│           YOUR SOLANA WALLET                        │
│       (Withdrawable, tradeable on DEX)             │
└─────────────────────────────────────────────────────┘
```

### Player Archetypes & Profitability

**Free Casual Player (No Investment)**
- Entry: 0.1 SOL one-time
- Generation: 10 Novi/min → 14,400/day (all locked)
- Event participation: 3 daily challenges/week → 30K reserved Novi/week
- Weekly earnings: ~30K reserved Novi withdrawable
- ROI: If Novi = $0.001, earns $30/week for casual play

**Competitive Free Player (Time Investment)**
- Entry: 0.1 SOL
- Generation: 10 Novi/min → locked
- Event domination: 7 dailies (1st) + weekly tournament (top 5) = 275K reserved/week
- Weekly earnings: ~275K reserved Novi withdrawable
- ROI: If Novi = $0.001, earns $275/week for serious play

**Epic Subscriber (10 SOL/month)**
- Entry: 0.1 SOL + 10 SOL/month subscription
- Generation: 100 Novi/min → 4.32M/month locked (for gameplay fuel)
- Event domination: Massive locked Novi enables tier upgrades + powerful army
- Reserved earnings: ~500K/month from events
- ROI: Spend 10 SOL, earn 500K Novi → If Novi = $0.02, that's $10,000 profit (100x)

**Legendary Whale (39 SOL/month)**
- Entry: 0.1 SOL + 39 SOL/month subscription
- Generation: 500 Novi/min → 21.6M/month locked
- Event domination: Top of all leaderboards
- Reserved earnings: ~2M/month from events
- ROI: Spend 39 SOL, earn 2M Novi → Massive if Novi appreciates

### Token Economics

**Deflationary Pressure (Locked Novi Burns):**
- Every attack burns Novi
- Hiring units burns Novi
- Collecting resources burns Novi
- Tier upgrades lock massive amounts (1M for Legendary)
- Total locked Novi across all players = permanent supply reduction

**Inflationary Pressure (Reserved Novi Rewards):**
- Daily events: ~500K reserved Novi/day distributed
- Weekly tournaments: ~3M reserved Novi/week
- Seasonal events: ~10M reserved Novi/month
- Controlled by admin multisig (can adjust based on Novi price)

**Equilibrium:**
- If Novi price too low: Reduce event rewards, increase burn costs
- If Novi price too high: Increase event rewards, reduce burn costs
- Community governance eventually takes over

---

## Development Timeline

### Month 1-2: Core Program Development
**Week 1-2: Account Structure**
- Player account (locked Novi + game stats)
- User account (reserved Novi)
- Team structure
- Global state

**Week 3-4: Core Mechanics**
- Battle system (attack/defend)
- Resource collection
- Unit hiring
- Novi generation + claiming

**Week 5-6: Transfer System**
- Transfer Activity Graph
- Relationship tracking
- Ratio enforcement
- Flagging system

**Week 7-8: Event Infrastructure**
- Event creation by admin
- Eligibility checking (age, organic growth, diversity)
- Prize distribution
- Leaderboard integration

### Month 3: Security + Frontend
**Week 9-10: Security Hardening**
- Multi-sig admin
- Emergency pause
- Civic Pass integration
- Withdrawal limits + vesting

**Week 11-12: Frontend Development**
- Next.js web app
- Wallet connection (Phantom, Backpack)
- Game UI (attack, collect, view stats)
- Event participation interface

### Month 4: Testing + Launch
**Week 13-14: Testing**
- Devnet deployment
- Security audit (external firm)
- Bot simulation testing
- Economic modeling validation

**Week 15-16: Launch Prep**
- Mainnet deployment
- Liquidity provision for Novi token
- Marketing + community building
- Admin multisig setup

---

## Technical Stack

### On-Chain (Solana)
- **Language**: Rust (Anchor framework)
- **Program Size**: ~50KB compiled
- **Accounts**:
  - Player: ~1KB each
  - User: ~500 bytes each
  - Events: ~2KB each
  - Transfer relationships: ~200 bytes each
- **Compute Units**:
  - Attack: ~100K CU
  - Claim Novi: ~50K CU
  - Transfer: ~150K CU (graph updates)

### Off-Chain Services
- **RPC Provider**: Helius or QuickNode (WebSocket + HTTP)
- **Indexer**: Helius DAS or custom (events, leaderboards)
- **Database**: PostgreSQL (player stats, transfer graph)
- **ML Detection**: Python service (scikit-learn)
- **Frontend**: Next.js 14 + Tailwind CSS
- **Wallet**: Solana Wallet Adapter

### Infrastructure
- **Hosting**: Vercel (frontend) + AWS (backend services)
- **Monitoring**: Datadog or Grafana
- **Alerts**: PagerDuty for critical issues

---

## Cost Estimates

### Development (One-Time)
- Solana program development: $40-80K (2 devs, 2 months)
- Frontend development: $30-50K (1 dev, 2 months)
- Security audit: $20-40K (external firm)
- Testing + QA: $10-20K
- **Total**: $100-190K

### Operational (Monthly)
- RPC costs: $500-1,000/month
- Infrastructure (AWS, Vercel): $200-500/month
- Database hosting: $100-200/month
- ML service: $100-200/month
- Admin multisig operations: ~5-10 SOL/month (tx fees)
- **Total**: $1,000-2,000/month

### User Costs (Per Transaction)
- Register account: 0.1 SOL + ~0.001 SOL fee
- Claim Novi: ~0.0005 SOL
- Attack: ~0.001 SOL
- Transfer: ~0.0015 SOL (graph updates)
- **Very affordable on Solana!**

---

## Success Metrics

### Security KPIs
- **Flagged account rate**: <5% of total accounts
- **Event self-dealing rate**: <2% of events
- **Sybil cluster detection**: >90% accuracy
- **False positive rate**: <1% (legit players wrongly flagged)

### Economic KPIs
- **Novi price stability**: ±20% weekly volatility max
- **Locked vs Reserved ratio**: 10:1 (10x more locked than reserved)
- **Withdrawal rate**: <30% of reserved Novi withdrawn weekly
- **Tier distribution**: 60% Rookie, 25% Expert, 10% Epic, 5% Legendary

### Engagement KPIs
- **Daily active users**: 1,000+ (month 1) → 10,000+ (month 6)
- **Event participation rate**: >40% of DAU
- **Team formation rate**: >60% of players in teams
- **Retention (30-day)**: >40%

### Revenue KPIs (for sustainability)
- **Subscriptions**: 10% of players (100 users × 10 SOL = 1,000 SOL/month)
- **NFT sales**: 50 NFTs/month × 50 SOL average = 2,500 SOL/month
- **Novi purchases**: 500 SOL/month direct purchases
- **Total**: ~4,000 SOL/month revenue

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Sybil attack at scale | High | Critical | Transfer Activity Graph + Civic Pass + behavioral analysis |
| Smart contract exploit | Medium | Critical | External audit + bug bounty + emergency pause |
| Admin key compromise | Low | Critical | Multi-sig + timelock + community oversight |
| Novi price crash | Medium | High | Vesting + withdrawal limits + burn mechanics |
| Low player adoption | Medium | High | Strong marketing + referral program + free tier |
| Regulatory issues | Low | Medium | Legal review + compliance (avoid securities) |

---

## Next Steps

### Immediate (This Week)
1. ✅ Review all markdown files (DONE)
2. ⬜ Decide on final game design (README2.md = recommended)
3. ⬜ Get legal review (ensure Novi isn't a security)
4. ⬜ Assemble dev team (2-3 devs)

### Short-Term (Weeks 1-4)
1. ⬜ Set up Anchor project structure
2. ⬜ Implement core account schemas
3. ⬜ Build Transfer Activity Graph
4. ⬜ Develop battle mechanics

### Medium-Term (Weeks 5-12)
1. ⬜ Event system implementation
2. ⬜ Frontend development
3. ⬜ Security hardening (multisig, pause, vesting)
4. ⬜ Devnet testing

### Long-Term (Weeks 13-16)
1. ⬜ External security audit
2. ⬜ Mainnet deployment
3. ⬜ Community launch
4. ⬜ Ongoing monitoring + iteration

---

## Conclusion

You have a **solid, secure, engaging game design** that:

✅ **Solves bot farming** - Dual account system + transfer restrictions
✅ **Creates engagement** - Continuous events instead of 10-day resets
✅ **Rewards skill** - Reserved Novi for competitive play
✅ **Works on Solana** - Low fees, fast, persistent state
✅ **Has economic moat** - Multi-layer defense makes Sybil attacks unprofitable

**The critical insight:** By separating locked (gameplay fuel) from reserved (real earnings), you've created a system where passive farming is worthless and active skill is rewarded.

**The transfer exploit is solved** via Transfer Activity Graph, organic growth requirements, and event eligibility gates. Attackers can consolidate resources, but those accounts become ineligible for high-value events.

**You're ready to build.** 🚀

Next decision: Assemble team and start development? Or refine specific game mechanics further?
