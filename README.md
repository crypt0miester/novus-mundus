# Novus Mundus: A Multiplayer Strategy Game on Solana

> **A persistent, event-driven world where empires rise, alliances form, and only the strategic survive.**

Novus Mundus is a continuous strategy game built on Solana where players command armies, collect resources, and compete in dynamic events to earn **NOVI** - the game's dual-purpose token that fuels both gameplay and real rewards.

**Multi-Kingdom System:** Join a kingdom where everyone starts together. New kingdoms launch periodically so late joiners compete on equal footing. Each kingdom has its own theme, leaderboards, and events.

**Theme-Flexible Design:** Medieval, cyberpunk, sci-fi, or post-apocalyptic - each kingdom has its own theme. Unit names and visuals change, but strategy stays the same.

**Deterministic Gameplay:** No randomness. All mechanics use the golden ratio family for predictable, skill-based outcomes.

---

## Game Overview

### Kingdoms: Fair Starts for Everyone

Novus Mundus uses a **multi-kingdom system** to ensure fair competition:

- **New kingdoms launch periodically** - Everyone in a kingdom starts at the same time
- **Join late? No problem** - Pick a newer kingdom and compete with players at your level
- **Each kingdom is independent** - Separate leaderboards, events, and rankings
- **Same wallet, multiple kingdoms** - Play in Genesis (medieval) and Vanguard (cyberpunk) simultaneously
- **Shared heroes and NOVI** - Your NFT heroes and token work across all kingdoms

**Example Kingdoms:**
| Kingdom | Theme | Launch |
|---------|-------|--------|
| Genesis | Medieval | Day 1 |
| Vanguard | Cyberpunk | Month 2 |
| Frontier | Post-Apocalyptic | Month 4 |

### The Persistent World

Unlike traditional games with resets, each kingdom is a **persistent world** where:
- Your progress within a kingdom never resets
- Events occur continuously (daily, weekly, seasonal)
- Alliances and rivalries develop organically over time
- Strategic decisions compound into long-term advantages

### Your Empire

Command your forces across multiple **cities** within your kingdom, each with unique strategic advantages:
- Deploy **defensive units** to protect your holdings
- Manage **operative units** to collect resources
- Launch attacks on rival kingdoms
- Form alliances through team mechanics
- Travel between locations to raid or trade

---

## The NOVI Economy

### Dual-Account System

Novus Mundus uses a two-account economy:

#### Player Account (Locked NOVI)
**Your Gameplay Fuel** - Powers all in-game actions but cannot be withdrawn

**Sources:**
| Source | Rate | Notes |
|--------|------|-------|
| Time Generation | 1-50 NOVI/5min | Based on subscription tier |
| SOL Purchases | Market rate | Converted via shop |
| Deposits | One-way | Reserved to Locked conversion |

**Uses:**
- **Hire units** - Spend NOVI to recruit defensive and operative units
- **Launch attacks** - Consumes NOVI + produce + weapons to raid enemies
- **Attack encounters** - Fight spawned PvE enemies for loot and reserved NOVI
- **Collect resources** - Spend NOVI + produce to generate cash from operative units
- **Purchase equipment** - Buy weapons, produce, and vehicles with NOVI

**CRITICAL: All consumed NOVI is BURNED (destroyed permanently)**
- Not transferred - literally removed from supply
- Creates deflationary pressure
- Every action makes NOVI scarcer

**Key Rule:** Locked NOVI CANNOT be withdrawn - It exists solely for gameplay

#### User Account (Reserved NOVI)
**Your Real Earnings** - Withdrawable rewards for competitive play

**Sources:**
| Source | Prize Range | Notes |
|--------|-------------|-------|
| Daily Events | 5K-50K NOVI | Quick challenges |
| Weekly Tournaments | 60K-500K NOVI | Competitive rankings |
| World Events | 250K+ NOVI | Epic battles |
| Seasonal Championships | 1M+ NOVI | Month-long competitions |
| Encounter Loot | Varies | PvE rewards (rare+) |

**Uses:**
- Withdraw to wallet (after 7-day vesting)
- Trade on DEX
- Deposit to Player Account (becomes locked, one-way)

**Key Rule:** Reserved NOVI IS WITHDRAWABLE - This is your real play-to-earn income

---

## Core Gameplay

### Unit Types (Theme-Flexible)

**Defensive Units** - Protect your empire from attacks
- **Unit Type 1**: Example: Knights (medieval) / Security Drones (cyberpunk)
- **Unit Type 2**: Example: Archers (medieval) / Netrunners (cyberpunk)
- **Unit Type 3**: Example: Footmen (medieval) / Street Samurai (cyberpunk)

*Hired with Locked NOVI (BURNED on purchase). Require weapons and produce to maintain effectiveness and happiness.*

**Operative Units** - Generate cash through resource collection
- **Unit Type 1**: High yield (1.5x multiplier) - Example: Miners / Data Miners
- **Unit Type 2**: Medium yield (1.3x multiplier) - Example: Merchants / Corporate Traders
- **Unit Type 3**: Standard yield (1.1x multiplier) - Example: Farmers / Factory Workers

*Hired with Locked NOVI (BURNED on purchase). Consume NOVI + produce during collection to generate cash.*

**Theme System:** All unit types are generic in code. Visual themes (medieval, cyberpunk, sci-fi, post-apocalyptic) change names and art, but mechanics stay identical.

### Resources & Equipment

**Weapons**
- Required for unit effectiveness in battle
- Weapon-to-unit ratio affects damage output
- Consumed during attacks

**Produce (Food)**
- Required to maintain unit happiness
- Units consume produce based on army size
- Unhappy units may abandon (deterministic rate based on happiness tier)

**Vehicles**
- Enable "drive-by" attacks (quick raids with golden root bonus)
- Carry 5 units each for rapid deployment
- Strategic advantage for hit-and-run tactics

**Cash**
- In-game currency earned from gameplay
- **Earned from**: Successful attacks (looting) and resource collection
- **Used for**: Contributes to networth (leaderboard rankings)
- **Can be stored in safebox** (75% protected from raids)
- **Not used to hire units** - Units cost NOVI, not cash

### Happiness System (Deterministic)

Unit morale is critical for maintaining your army:

**Happiness Factors:**
- Weapon availability (defensive units need weapons)
- Produce availability (all units need food)
- Calculated per unit type

**Happiness Effects:**
| Happiness | Abandonment Rate |
|-----------|------------------|
| 75-100% (Happy) | Config-based (lowest) |
| 50-75% (Content) | Config-based |
| 25-50% (Unhappy) | Config-based |
| 0-25% (Miserable) | Config-based (highest) |

**Formula:** `abandonment = (total_units x rate_bps) / 10000`

### Time-of-Day System

The game uses real longitude to calculate local time with 7 periods:

| Period | Hours | Best Activities |
|--------|-------|-----------------|
| Deep Night | 00:00-03:00 | Attacking (phi bonus), Mining |
| Dawn | 03:00-06:00 | Golden Hour - Rare spawns |
| Morning | 06:00-09:00 | Balanced |
| Midday | 09:00-15:00 | Defending, Hiring |
| Afternoon | 15:00-18:00 | Balanced |
| Dusk | 18:00-21:00 | Golden Hour - Rare spawns |
| Evening | 21:00-00:00 | Research, Stamina regen |

**Golden Ratio Multipliers:**
- phi (1.618x) for optimal timing
- golden root (1.272x) for good timing
- 1/phi (0.618x) for poor timing

### Cities

Each kingdom has **24 cities** with themed names matching the kingdom's setting:

**City Types:**
| Type | Bonus | Medieval Example | Cyberpunk Example |
|------|-------|------------------|-------------------|
| Capital | Balanced (1.0x) | King's Landing | Neo Tokyo |
| Resource | Collection (1.272x) | Harvest Vale | Data Farm |
| Combat | Attack/Defense (1.272x) | Ironhold | War District |
| Trade | Economy (1.618x) | Merchant's Rest | Black Market |

**City Mechanics:**
- **Same-city attacks**: Can only attack players in your current city
- **Travel**: Move between cities (uses NOVI, takes time)
- **Strategic positioning**: Different cities have different bonuses
- **Territory Wars**: Events may involve controlling specific cities

### Safebox System

**Protection Mechanism:**
- Store up to **75% of cash** in a protected vault
- Safebox cash is **not lootable** during attacks
- Networth calculation includes safebox (still counts for rankings)
- Strategic balance: liquidity vs security

### Encounter System (PvE Content)

**Spawned Enemies** - Fight AI-controlled encounters for rewards

**Encounter Types:**
| Rarity | Health | Despawn | Max Attackers | Stamina Cost |
|--------|--------|---------|---------------|--------------|
| Common | 1,000 | 1 hour | 2 | 10 |
| Uncommon | 5,000 | 2 hours | 3 | 25 |
| Rare | 25,000 | 4 hours | 4 | 50 |
| Epic | 100,000 | 12 hours | 6 | 100 |
| Legendary | 500,000 | 24 hours | 10 | 250 |
| WorldEvent | 5,000,000 | 7 days | 20 | 500 |

**Rewards (Deterministic):**
- Cash, weapons, produce based on level thresholds
- Reserved NOVI for rare+ encounters
- Fragments and gems (research-gated)
- Loot distributed based on damage contribution

### Dungeons (PvE Challenge)

Test your heroes against progressively difficult dungeon floors for weekly rewards.

**How It Works:**
- Select a dungeon and send your heroes
- Clear floors to progress deeper
- Higher floors = better rewards
- Weekly leaderboards track deepest clears

**Dungeon Types:**
| Dungeon | Difficulty | Specialty |
|---------|------------|-----------|
| Crypt | Easy | Entry-level, learn mechanics |
| Labyrinth | Medium | Balanced challenge |
| Abyss | Hard | Endgame content |

**Rewards:**
- Hero fragments for leveling
- Gems for upgrades
- Weekly leaderboard prizes (kingdom-scoped)
- Reserved NOVI for top performers

### Arena (Competitive PvP)

Seasonal PvP competition where players battle for rankings and prizes.

**How It Works:**
- Each kingdom has its own arena seasons
- Set your battle loadout (heroes + units)
- Challenge other players in your ranking bracket
- Climb the leaderboard for better rewards

**Arena Seasons:**
- Seasons last 1-4 weeks
- Rankings reset each season
- Prizes distributed at season end
- Top players earn Reserved NOVI

**Battle System:**
- Deterministic combat (no luck)
- Strategy matters: unit composition, hero selection
- Daily battle limit encourages smart matchmaking
- Win streaks provide bonus ranking points

### Castle Battles (Territory Control)

Capture and hold castles to earn passive income and prestige for your team.

**Castle System:**
- Each city has castles that teams can capture
- Holding a castle generates rewards for your team
- Appoint court positions (King, General, Treasurer, etc.)
- Garrison troops to defend against attackers

**Capturing Castles:**
- Attack a castle held by another team
- Rally with teammates for coordinated assaults
- Defeat the garrison to claim control
- Defend against counter-attacks

**Castle Benefits:**
| Position | Bonus |
|----------|-------|
| King | Highest share of castle income |
| Court Members | Moderate share + special perks |
| Garrison Contributors | Share based on contribution |

**Strategy:**
- Stronger castles in high-value cities
- Coordinate with your team for defense schedules
- Balance garrison strength vs active army size

### Estates (Personal Property)

Build and upgrade your personal estate to generate passive income and unlock bonuses.

**Estate Features:**
- Personal property that grows with your character
- Generates passive resources over time
- Upgradeable buildings for increased output
- Safe from raids (unlike active resources)

**Estate Buildings:**
| Building | Benefit |
|----------|---------|
| Manor | Increases locked NOVI capacity |
| Barracks | Faster unit training |
| Warehouse | Higher resource storage |
| Market | Better shop discounts |

**Upgrading:**
- Spend NOVI and resources to upgrade buildings
- Higher levels = better bonuses
- Requires minimum player level for each tier

### Combat Mechanics

**Attack Power Formula (Deterministic):**
```
base_power = sum(defensive_unit_i x tier_weight_i)
weapon_coverage = min(weapons / total_units, 1.0)
total_bonus = base + research_bps + hero_bps + level_bonus
total_power = base_power x weapon_coverage x total_bonus / 10000
```

**Critical Hits (Skill-Based, Not Random):**
- If `research_crit_chance_bps >= 5000` (50%): Guaranteed crit
- This is research investment, not luck

**Drive-By Attacks:**
- Requires 10,000+ units and vehicles
- Base bonus: golden root (1.272x)
- Night bonus stacks: up to phi (1.618x) total

---

## Events & Competition

All events and leaderboards are **kingdom-specific** - you compete only with players in your kingdom, ensuring fair matchups regardless of when you started playing.

### Daily Challenges (Every 24 Hours)
Quick, accessible events for all players:

**Example Events:**
- **Raider's Bounty**: Top 10 attackers win 5,000-25,000 Reserved NOVI
- **Resource Baron**: Highest resource collector wins 10,000-50,000 Reserved NOVI
- **Untouchable**: Defend against 5+ attacks, win 3,000-15,000 Reserved NOVI

**Eligibility:**
- Account age: 7+ days
- Minimum activity: 5 attacks made
- Transfer ratio: Received <= 10x sent

### Weekly Tournaments (Every 7 Days)
Competitive rankings with substantial prizes:

**Example Events:**
- **King of the Hill**: Maintain #1 rank longest - 100,000+ Reserved NOVI
- **Team Warfare**: Teams compete by total networth - 500,000+ NOVI prize pool
- **Blitz Attack**: Most successful attacks in 24hrs - 75,000+ Reserved NOVI

**Eligibility:**
- Account age: 30+ days
- Minimum activity: 20 attacks, 5 defenses
- Transfer ratio: Received <= 3x sent

### World Events (Announced Dynamically)
Large-scale events that shape the game world:

**Example Events:**
- **Territory Wars**: Teams battle for location control - Passive NOVI bonuses
- **Legendary Hunts**: Defeat powerful AI bosses - 250,000+ NOVI jackpots
- **Alliance Summit**: Cross-team cooperation - Massive community rewards

**Eligibility:**
- Account age: 60+ days
- Significant activity required
- Transfer ratio: Received <= 2x sent

### Prize Distribution (Top 10)

| Rank | Share |
|------|-------|
| 1 | 40% |
| 2 | 20% |
| 3 | 13% |
| 4 | 9% |
| 5 | 6% |
| 6 | 4% |
| 7 | 3% |
| 8 | 2% |
| 9 | 2% |
| 10 | 1% |

---

## Subscription Tiers

Subscriptions boost your NOVI generation rate and unlock faster progression.

### Free Player (Rookie)

| Metric | Value |
|--------|-------|
| Generation | 1 NOVI/5min |
| Max Locked NOVI | 3,000 |
| Max Stamina | 100 |
| Team Size | 5 |

### Expert Tier
**Unlock:** SOL subscription

| Metric | Value |
|--------|-------|
| Generation | 2 NOVI/5min |
| Max Locked NOVI | 6,000 |
| Max Stamina | 500 |
| Team Size | 10 |

### Epic Tier
**Unlock:** SOL subscription

| Metric | Value |
|--------|-------|
| Generation | 10 NOVI/5min |
| Max Locked NOVI | 30,000 |
| Max Stamina | 1,000 |
| Team Size | 25 |

### Legendary Tier
**Unlock:** SOL subscription

| Metric | Value |
|--------|-------|
| Generation | 50 NOVI/5min |
| Max Locked NOVI | 150,000 |
| Max Stamina | 10,000 |
| Team Size | 50 |

---

## Research System

30 research nodes across 3 categories:

**Battle Research (10 nodes):**
- Attack Power, Defense Power, Unit Capacity
- Critical Hit Chance, Critical Hit Damage
- Rally Capacity, Encounter Success, Loot Bonus
- Training Speed, Ambush Damage

**Economy Research (10 nodes):**
- Production Efficiency, Resource Capacity
- Market Tax Reduction, Trade Speed
- Mining Output, Cash Generation
- Construction Speed, Upkeep Reduction
- Black Market Access, Tax Collection

**Growth Research (10 nodes):**
- Daily Rewards System, Mining Operations
- Fishing Industry, Loot Magnetism
- Reputation Mastery, Stamina Vitality
- Lucky Streak, Fragment Discovery
- Gem Prospecting, Collection Mastery

**Cost Scaling:**
```
NOVI_cost = base_cost x 1.8^level
Time = base_time x 1.5^level
```

---

## Hero System

Heroes are NFTs that provide buffs scaling with golden root:

**Buff Formula:**
```
buff_value = base_bps x (golden_root)^level
```

| Level | Multiplier | Example (100 base) |
|-------|------------|-------------------|
| 1 | 1.272x | 127 |
| 2 | 1.618x | 162 |
| 4 | 2.618x | 262 |
| 10 | 10.86x | 1,086 |

**Hero Types:**
- Offensive: Attack, Crit Chance, Encounter Damage
- Defensive: Defense, Unit Capacity, Rally Capacity
- Economic: Cash Collection, Produce Generation, Loot Bonus
- Hybrid: Balanced mix

**Leveling Cost:**
```
fragment_cost = 10 x 1.5^current_level
```

---

## Fibonacci Efficiency System

Spending NOVI amounts that are **Fibonacci numbers** grants deterministic efficiency bonuses:

**Fibonacci Numbers:** 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765...

**Bonus:** golden root (1.272x) efficiency multiplier

**How it works:** When you spend a Fibonacci amount of NOVI on any action (collecting, attacking, hiring), you get 27.2% more value for the same cost.

**Example:**
- Collect with 233 NOVI (Fibonacci) - Gets 1.272x bonus
- Collect with 250 NOVI (not Fibonacci) - No bonus

**Strategy:** Plan your actions around Fibonacci amounts for maximum efficiency.

---

## Anti-Bot Security

### Simple, Effective Rules

**Transfer Restrictions:**
- Same team only (no cross-team transfers)
- Both accounts must be 7+ days old
- Tier-based daily limits (see below)
- Tracked: total_sent and total_received

**Tier-Based Transfer Limits:**

| Tier | Daily Amount | Daily Count | Notes |
|------|--------------|-------------|-------|
| Rookie (Free) | 0 | 0 | Transfers disabled |
| Expert | 1B | 25 | Basic team support |
| Epic | 25B | 100 | Active team play |
| Legendary | Unlimited | Unlimited | Full team coordination |

Subscribing unlocks team transfers - free players must earn through gameplay.

**Event Eligibility (Anti-Sybil):**

| Event Value | Account Age | Min Attacks | Max Transfer Ratio |
|-------------|-------------|-------------|-------------------|
| < 25K NOVI | 7 days | 5 | 10:1 |
| 25K-100K NOVI | 30 days | 20 | 3:1 |
| 100K+ NOVI | 60 days | 50 | 2:1 |

**Why This Works:**
- Bots farming passive generation get **locked NOVI** - Cannot withdraw - Worthless
- Players who receive excessive transfers **fail event eligibility** - Cannot win prizes
- Legitimate players earning through attacks **pass all checks** - Win reserved NOVI

### Governance-Based Security

Using **SPL Governance** for decentralized administration:

**Community Powers:**
- Flag suspicious accounts (community vote, 60% threshold)
- Approve event prize distribution (council vote, 3/5 approval)
- Update game parameters (combined vote)
- Emergency pause mechanisms

---

## Shop System

### Multi-Layer Discount System

**Layer 1: Base Discounts** (up to 60%)
- Flash Sales, Daily Deals, Weekly/Seasonal Sales

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

**Combined Cap:** 75% maximum discount

### Milestone Loyalty

| Milestone | Permanent Discount |
|-----------|-------------------|
| Bronze | 2% |
| Silver | 4% |
| Gold | 6% |
| Platinum | 8% |
| Diamond | 10% |

---

## NFT Technology (Planned)

Limited-edition NFTs that provide strategic advantages. Visuals and names change per theme, mechanics stay identical.

### Strike Force (3 variants)

Team-wide attack NFTs that target all enemy team members.

| Tier | Damage | Bonus |
|------|--------|-------|
| Standard | Base | - |
| Enhanced | +50% | Increased damage |
| Stealth | +75% | Undetected by defenses |

**Theme Variants:**
| Theme | Standard | Enhanced | Stealth |
|-------|----------|----------|---------|
| Modern | F16 | F22 | B2 Bomber |
| Medieval | Cavalry Charge | Dragon Riders | Shadow Assassins |
| Cyberpunk | Drone Swarm | Mech Battalion | Ghost Protocol |
| Sci-Fi | Fighter Wing | Battlecruiser | Cloaked Fleet |
| Post-Apocalyptic | War Convoy | Mutant Horde | Rad Stalkers |

**Mechanics:**
- Attack entire enemy team
- Destroy up to 200,000 units per player
- 2 uses per NFT
- Supply: 20 minted/month, 500 max forever

### Fortification

Permanent defensive structure protecting your assets.

**Theme Variants:**
| Theme | Name |
|-------|------|
| Modern | Fortified Bunker |
| Medieval | Castle Keep |
| Cyberpunk | Firewall Citadel |
| Sci-Fi | Shield Generator |
| Post-Apocalyptic | Vault Shelter |

**Protection:**
- Protects safebox, produce, and operative units
- 80% reduction vs Devastation attacks
- 90% reduction vs Strike Force attacks
- Permanent (doesn't burn on defense)
- Supply: 200 minted/month, 1,000 max forever

### Devastation Weapon (2 variants)

Massive single-use weapon that devastates entire enemy teams.

| Tier | Destruction |
|------|-------------|
| Standard | 10M units/player |
| Supreme | 2x destruction |

**Theme Variants:**
| Theme | Standard | Supreme |
|-------|----------|---------|
| Modern | Nuclear Missile | MOAB |
| Medieval | Plague Catapult | Dragon Fire |
| Cyberpunk | EMP Bomb | Blackout Virus |
| Sci-Fi | Ion Cannon | Planet Cracker |
| Post-Apocalyptic | Dirty Bomb | Mega Nuke |

**Mechanics:**
- Devastate entire enemy team
- Single-use (burns after detonation)
- 48-hour warning period
- Requires recent hostility with target
- Supply: 10 minted/month, 100 max forever

### Interception System

Advanced defense system against Strike Force and Devastation attacks.

**Theme Variants:**
| Theme | Name |
|-------|------|
| Modern | Iron Dome |
| Medieval | Archer Towers |
| Cyberpunk | Counter-ICE |
| Sci-Fi | Point Defense Grid |
| Post-Apocalyptic | Scrap Turrets |

**Defense:**
- 50% reduction vs Devastation attacks
- 80% reduction vs Strike Force attacks
- Burns after defending or attacking
- Supply: 20 minted/month, 100 max forever

---

## Technical Architecture

### Solana Smart Contract

**Framework:** Pinocchio (low-level, high-performance)

**Key Features:**
- Low transaction costs (~$0.0005 per action)
- Fast finality (400ms)
- Persistent state (no resets)
- SPL Governance integration
- 50-70% compute savings vs Anchor

**Account Structure:**
| Account | Size | Notes |
|---------|------|-------|
| PlayerAccount | ~400 bytes | Game state, locked NOVI |
| UserAccount | ~120 bytes | Reserved NOVI, stats |
| ResearchProgress | ~200 bytes | 30 research nodes |
| HeroAccount | ~80 bytes | Per NFT |

**Deterministic Math:**
- All calculations use golden ratio family
- Basis points for all multipliers (10000 = 100%)
- libm for BPF-compatible float math
- No randomness anywhere

### Governance

**SPL Governance Realm:**
- Council: 5 admin members (3/5 approval for critical actions)
- Community: Token-weighted voting
- Transparent proposals for all admin actions
- On-chain prize distribution verification

---

## Why Play Novus Mundus?

**Never Reset**
Your kingdom is permanent. Build your empire without fear of arbitrary resets.

**Constant Earning Opportunities**
Daily, weekly, and seasonal events mean you always have a path to win reserved NOVI.

**Strategic Depth**
Happiness mechanics, location strategy, unit composition, timing - skill matters.

**Team Dynamics**
Form alliances, coordinate attacks, share resources, dominate together.

**Real Play-to-Earn**
Reserved NOVI is fully withdrawable. Win events, cash out, or reinvest for power.

**Deterministic Gameplay**
No randomness. Every outcome is predictable based on your investment and timing.

**Accessible Yet Competitive**
Free players can compete in dailies. Subscribers dominate high-stakes events. Everyone has a path.

---

## Getting Started

### Step 1: Connect Wallet
- Phantom, Backpack, or any Solana wallet
- Fund with SOL for transactions

### Step 2: Choose Your Kingdom
- Browse available kingdoms and their themes
- **New player?** Join a recently launched kingdom for fair competition
- **Veteran?** Play multiple kingdoms with the same wallet
- Check kingdom age and player count before joining

### Step 3: Register Your Character
- Create your player account in the chosen kingdom
- Receive starting resources
- 24-hour protection begins
- Start generating locked NOVI

### Step 4: Build Your Strategy
- Hire units with locked NOVI
- Maintain happiness (feed and arm your troops)
- Attack diverse opponents
- Collect resources with operative units

### Step 5: Join Events
- Start with daily challenges (7-day eligibility)
- Progress to weekly tournaments (30-day)
- Dominate seasonal championships (60-day+)
- Win reserved NOVI, withdraw to wallet

### Step 6: Grow Your Empire
- Consider subscription for faster progression
- Join or form a team
- Invest in research and heroes
- Accumulate reserved NOVI for real earnings
- Expand to additional kingdoms when ready

---

## Fair Play Commitment

Novus Mundus is designed for **skill-based competition**, not pay-to-win:

- **Fair starts through kingdoms** - New kingdoms launch regularly so everyone can start fresh
- **Kingdom-scoped competition** - Compete only with players who started when you did
- Free players can earn through daily challenges and smart gameplay
- Subscriptions accelerate progression but don't guarantee victories
- Events reward strategy over wallet size
- Community governance prevents centralized abuse
- Transparent on-chain actions ensure fairness
- Deterministic mechanics mean no luck-based advantages

**Late to the game? Join a new kingdom and compete on equal footing.**

---

## Important Notes

### Price Disclaimer
All SOL and NOVI prices mentioned in this document are examples and subject to change based on:
- Market conditions
- Community governance decisions
- Economic balancing updates
- Token supply and demand

### Not Financial Advice
Novus Mundus is a game. NOVI is a gaming token. This is entertainment, not an investment product. Play responsibly.

### Continuous Evolution
Game mechanics, events, and features will evolve based on:
- Community feedback
- Governance proposals
- Security considerations
- Competitive balance

---

**Version:** 3.0 (Multi-Kingdom)
**Framework:** Pinocchio (Solana)

