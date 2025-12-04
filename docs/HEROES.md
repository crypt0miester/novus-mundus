# Hero System Design

## Overview

Heroes are personal NFTs (MPL-Core) that provide combat and economic buffs to players. Players can own unlimited heroes but can only have 3 active at a time. Heroes gain levels through fragment investment, with unlimited progression (u32::MAX). Each level-up randomly increases buff power based on the hero's template configuration.

**IMPORTANT PREREQUISITE**: MPL-Core must be ported to Pinocchio-compatible instructions before implementation, as the current MPL-Core crate is not compatible with Pinocchio's no_std environment.

---

## Core Mechanics

### Hero Locking

**How it works:**
- Player owns hero NFT in their wallet
- Player locks hero → NFT transfers from wallet to PlayerAccount PDA
- Hero becomes "locked" and gains buffs for the player
- Locked heroes cannot be traded (not in wallet)
- Player unlocks hero → NFT transfers back to wallet

**Benefits:**
- Simple: Just an NFT transfer, no extra PDAs
- Secure: Can't trade while locked
- Clear ownership: Either in wallet (tradeable) or in PlayerAccount (active)

### Active Hero Slots

**3 Active Slots:**
- Players can lock up to 3 heroes
- Each slot provides buffs
- One slot can be designated as "defensive" (used when player is attacked)
- Can swap heroes anytime (unlock old, lock new)

**PlayerAccount Fields:**
```rust
pub active_heroes: [Pubkey; 3],      // 3 locked hero mints (NULL_PUBKEY if empty)
pub defensive_hero_slot: u8,         // Which slot (0-2) used for defense
pub hero_buffs: HeroBuffs,           // Pre-calculated total buffs
```

### Hero Templates (DAO-Controlled)

**HeroTemplate Account:**
```rust
pub struct HeroTemplate {
    pub template_id: u16,              // Unique ID
    pub name: [u8; 32],                // "Alexander the Great"
    pub hero_type: HeroType,           // Offensive/Defensive/Economic/Hybrid
    pub category: HeroCategory,        // Historical/Mythological/Gaming/etc.

    // Minting config (SOL-based)
    pub mint_cost_sol: u64,            // Cost in SOL (lamports) for treasury
    pub supply_cap: u32,               // Max mintable (0 = unlimited)
    pub minted_count: u32,             // Current supply
    pub enabled: bool,                 // Can be minted now?
    pub event_exclusive: bool,         // Only available during events?
    pub required_level: u8,            // Player level to mint

    // Buff configuration
    pub base_buffs: [BuffConfig; 4],   // Up to 4 different buffs
    pub buff_weight_ranges: [WeightRange; 4], // Random weight ranges per buff

    pub bump: u8,
}

pub struct BuffConfig {
    pub stat: BuffStat,                // AttackPower, DefensePower, etc.
    pub base_bps: u32,                 // Base buff at level 1 (in basis points)
    pub weight: u8,                    // Probability weight for random increases (0-100)
}

pub struct WeightRange {
    pub min_increase_bps: u16,         // Min buff increase per level (e.g., 10 bps)
    pub max_increase_bps: u16,         // Max buff increase per level (e.g., 100 bps)
}

pub enum HeroType {
    Offensive,    // Focuses on attack buffs
    Defensive,    // Focuses on defense buffs
    Economic,     // Focuses on economy buffs
    Hybrid,       // Balanced across multiple stats
}

pub enum HeroCategory {
    Historical,   // Real historical figures
    Mythological, // Gods, legends, folklore
    CryptoIcons,  // Web3 personalities
    Original,     // Game-original characters
}
```

**Template Examples:**

```rust
// Historical Warriors (Common Tier)
HeroTemplate {
    template_id: 1,
    name: "Roman Centurion",
    hero_type: Defensive,
    category: Historical,
    mint_cost_sol: 50_000_000,  // 0.05 SOL
    supply_cap: 0,  // Unlimited
    enabled: true,
    event_exclusive: false,
    required_level: 1,
    base_buffs: [
        BuffConfig { stat: DefensePower, base_bps: 500, weight: 60 },
        BuffConfig { stat: UnitCapacity, base_bps: 300, weight: 40 },
    ],
    buff_weight_ranges: [
        WeightRange { min_increase_bps: 20, max_increase_bps: 80 },
        WeightRange { min_increase_bps: 10, max_increase_bps: 50 },
    ],
}

// Historical Leaders (Rare Tier)
HeroTemplate {
    template_id: 10,
    name: "Alexander the Great",
    hero_type: Offensive,
    category: Historical,
    mint_cost_sol: 250_000_000,  // 0.25 SOL
    supply_cap: 10000,
    enabled: true,
    event_exclusive: false,
    required_level: 25,
    base_buffs: [
        BuffConfig { stat: AttackPower, base_bps: 1000, weight: 50 },
        BuffConfig { stat: RallyCapacity, base_bps: 500, weight: 30 },
        BuffConfig { stat: XpGain, base_bps: 300, weight: 20 },
    ],
    buff_weight_ranges: [
        WeightRange { min_increase_bps: 50, max_increase_bps: 150 },
        WeightRange { min_increase_bps: 25, max_increase_bps: 100 },
        WeightRange { min_increase_bps: 15, max_increase_bps: 60 },
    ],
}

// Mythological (Epic Tier)
HeroTemplate {
    template_id: 50,
    name: "Zeus",
    hero_type: Hybrid,
    category: Mythological,
    mint_cost_sol: 1_000_000_000,  // 1 SOL
    supply_cap: 1000,
    enabled: true,
    event_exclusive: false,
    required_level: 50,
    base_buffs: [
        BuffConfig { stat: AttackPower, base_bps: 1500, weight: 35 },
        BuffConfig { stat: DefensePower, base_bps: 1500, weight: 35 },
        BuffConfig { stat: CriticalHitChance, base_bps: 1000, weight: 20 },
        BuffConfig { stat: LuckBonus, base_bps: 500, weight: 10 },
    ],
    buff_weight_ranges: [
        WeightRange { min_increase_bps: 75, max_increase_bps: 200 },
        WeightRange { min_increase_bps: 75, max_increase_bps: 200 },
        WeightRange { min_increase_bps: 50, max_increase_bps: 150 },
        WeightRange { min_increase_bps: 25, max_increase_bps: 100 },
    ],
}

// Gaming Icons (Legendary Tier - Licensing Required)
HeroTemplate {
    template_id: 100,
    name: "Master Chief",  // Note: Requires licensing from Microsoft
    hero_type: Offensive,
    category: Gaming,
    mint_cost_sol: 5_000_000_000,  // 5 SOL
    supply_cap: 100,  // Only 100 exist
    enabled: false,  // Disabled until licensing secured
    event_exclusive: true,
    required_level: 75,
    base_buffs: [
        BuffConfig { stat: AttackPower, base_bps: 2500, weight: 40 },
        BuffConfig { stat: WeaponEfficiency, base_bps: 2000, weight: 30 },
        BuffConfig { stat: StaminaRegen, base_bps: 1500, weight: 20 },
        BuffConfig { stat: DefensePower, base_bps: 1000, weight: 10 },
    ],
    buff_weight_ranges: [
        WeightRange { min_increase_bps: 100, max_increase_bps: 300 },
        WeightRange { min_increase_bps: 80, max_increase_bps: 250 },
        WeightRange { min_increase_bps: 60, max_increase_bps: 200 },
        WeightRange { min_increase_bps: 40, max_increase_bps: 150 },
    ],
}

// Crypto Icons (Special Edition)
HeroTemplate {
    template_id: 150,
    name: "Satoshi Nakamoto",
    hero_type: Economic,
    category: CryptoIcons,
    mint_cost_sol: 2_100_000_000,  // 2.1 SOL (Bitcoin reference)
    supply_cap: 21,  // Only 21 exist (Bitcoin reference)
    enabled: true,
    event_exclusive: true,
    required_level: 100,
    base_buffs: [
        BuffConfig { stat: CashCollectionRate, base_bps: 3000, weight: 50 },
        BuffConfig { stat: LuckBonus, base_bps: 2100, weight: 30 },
        BuffConfig { stat: ResourceCapacity, base_bps: 1500, weight: 20 },
    ],
    buff_weight_ranges: [
        WeightRange { min_increase_bps: 150, max_increase_bps: 400 },
        WeightRange { min_increase_bps: 100, max_increase_bps: 300 },
        WeightRange { min_increase_bps: 75, max_increase_bps: 200 },
    ],
}
```

---

## Hero Leveling

### Unlimited Progression

**Max Level:** u32::MAX (4,294,967,295)

**Why unlimited?**
- Sky is the limit for dedicated players
- Creates long-term progression goals
- Random buff increases create unique heroes
- Exponential fragment costs provide natural soft cap

### Leveling Costs (Fragments Only)

**Exponential Fragment Scaling:**
```rust
pub fn calculate_level_cost(current_level: u32) -> u64 {
    // Exponential scaling with base 1.5
    let base_cost = 10u64;
    let growth_rate = 1.5f64;

    // Cap at level 1000 to prevent overflow
    let effective_level = current_level.min(1000);

    (base_cost as f64 * growth_rate.powi(effective_level as i32)) as u64
}
```

**Cost Examples:**
```
Level 1→2:      15 fragments
Level 10→11:    576 fragments
Level 50→51:    ~56,000 fragments
Level 100→101:  ~4M fragments
Level 500→501:  ~350M fragments
Level 1000→1001: ~10B fragments (soft cap)
```

### Random Buff Increases

**How it works:**
When leveling up, the hero randomly increases one or more buffs based on the template's weight configuration.

```rust
pub fn apply_level_up_buffs(
    hero: &mut HeroAccount,
    template: &HeroTemplate,
    level: u32,
) -> Vec<BuffIncrease> {
    let mut increases = Vec::new();
    let mut rng = fastrand::Rng::new();

    // For each configured buff in the template
    for (i, buff_config) in template.base_buffs.iter().enumerate() {
        if buff_config.stat == BuffStat::None { continue; }

        // randomizerfor this buff based on weight (0-100)
        if rng.u8(0..100) < buff_config.weight {
            let range = &template.buff_weight_ranges[i];

            // Random increase within the range
            let increase = rng.u16(
                range.min_increase_bps..=range.max_increase_bps
            );

            // Apply to hero's buff array
            hero.buff_increases[i] = hero.buff_increases[i]
                .saturating_add(increase);

            increases.push(BuffIncrease {
                stat: buff_config.stat,
                amount: increase,
            });
        }
    }

    // Update total buff power for NFT metadata
    hero.total_buff_power = calculate_total_power(hero);

    increases
}
```

**Example Level-Up (Alexander the Great, Level 50):**
```
Rolling for buffs...
- Attack Power (50% weight): SUCCESS! +87 bps
- Rally Capacity (30% weight): FAILED
- XP Gain (20% weight): SUCCESS! +42 bps

Hero gains: +87 attack, +42 XP gain
Total buff power increased: 129 bps
```

### Buff Persistence & NFT Impact

**Key Innovation:** Buffs are stored on the hero NFT itself, not just when locked.

```rust
pub struct HeroAccount {
    pub mint: Pubkey,                  // MPL-Core NFT
    pub template_id: u16,              // Which template
    pub level: u32,                    // Current level (1 to u32::MAX)
    pub owner: Pubkey,                 // Wallet or PlayerAccount PDA

    // Accumulated buff increases from all level-ups
    pub buff_increases: [u16; 4],      // Total increases per buff slot
    pub total_buff_power: u64,         // Sum for leaderboards/rarity

    // Fragment investment tracking
    pub fragments_invested: u64,       // Total fragments used
    pub last_leveled_at: i64,
    pub bump: u8,
}
```

**This means:**
- Heroes retain their buffs when traded
- Higher level heroes are inherently more valuable
- Each hero becomes unique through random leveling
- NFT metadata updates show current power level

---

## Hero State

### HeroAccount (PDA)

```rust
pub struct HeroAccount {
    pub mint: Pubkey,              // MPL-Core NFT mint address
    pub template_id: u16,          // Which template was used
    pub level: u32,                // Current level (1 to u32::MAX)
    pub owner: Pubkey,             // Current owner (wallet or PlayerAccount PDA)
    pub total_buff_power: u64,     // Sum of all buff bps (for leaderboards)
    pub minted_at: i64,
    pub last_leveled_at: i64,
    pub bump: u8,
}

// PDA: [b"hero", mint.key()]
// Size: ~96 bytes
```

### PlayerAccount Integration

```rust
pub struct PlayerAccount {
    // ... existing fields ...

    // Hero System
    pub active_heroes: [Pubkey; 3],     // Locked hero mints
    pub defensive_hero_slot: u8,        // 0, 1, or 2
    pub hero_buffs: HeroBuffs,          // Pre-calculated buffs

    // Resources
    pub fragments: u64,                 // Hero leveling material
}

pub struct HeroBuffs {
    pub attack_bps: u32,
    pub defense_bps: u32,
    pub economy_bps: u32,
    pub xp_gain_bps: u32,
    pub training_cost_reduction_bps: u32,
    pub collection_rate_bps: u32,
}
```

---

## Buff Calculation & Caching

### Strategy: Load Heroes on Buff-Changing Actions

**When buffs change:**
```rust
// lock_hero, unlock_hero, level_up_hero
// These instructions MUST load all 3 hero accounts and recalculate

pub fn lock_hero(
    player: &mut PlayerAccount,
    hero_to_lock: &HeroAccount,
    hero_accounts: &[AccountInfo; 3],  // Pass all 3 hero accounts
    slot_index: u8,
) -> Result<()> {
    // Transfer NFT from wallet to PlayerAccount PDA
    transfer_nft(hero_to_lock.mint, player_wallet, player_pda)?;

    // Update slot
    player.active_heroes[slot_index] = hero_to_lock.mint;

    // Recalculate ALL buffs (load all 3 heroes)
    recalculate_hero_buffs(player, hero_accounts)?;

    Ok(())
}
```

### Buff Recalculation

```rust
pub fn recalculate_hero_buffs(
    player: &mut PlayerAccount,
    hero_accounts: &[AccountInfo; 3],
) -> Result<()> {
    let mut total_attack = 0u32;
    let mut total_defense = 0u32;
    let mut total_economy = 0u32;
    let mut total_xp = 0u32;
    let mut total_training_cost = 0u32;
    let mut total_collection = 0u32;

    // Load each active hero
    for (i, hero_mint) in player.active_heroes.iter().enumerate() {
        if hero_mint == &NULL_PUBKEY { continue; }

        // Load hero account
        let hero_account = &hero_accounts[i];
        require_key_match(hero_account, hero_mint)?;

        let hero_data_ref = hero_account.try_borrow_data()?;
        let hero = unsafe { HeroAccount::load(&hero_data_ref) };

        // Load template
        let template = load_hero_template(hero.template_id)?;

        // Calculate buffs for each configured stat
        for buff_config in &template.base_buffs {
            let buff_value = calculate_hero_buff(buff_config, hero.level);

            match buff_config.stat {
                BuffStat::AttackPower => total_attack += buff_value,
                BuffStat::DefensePower => total_defense += buff_value,
                BuffStat::CashCollectionRate => total_collection += buff_value,
                BuffStat::XpGain => total_xp += buff_value,
                BuffStat::UnitTrainingCost => total_training_cost += buff_value,
                // ... handle all stat types
            }
        }
    }

    // Update cached buffs
    player.hero_buffs.attack_bps = total_attack;
    player.hero_buffs.defense_bps = total_defense;
    player.hero_buffs.economy_bps = total_economy;
    player.hero_buffs.xp_gain_bps = total_xp;
    player.hero_buffs.training_cost_reduction_bps = total_training_cost;
    player.hero_buffs.collection_rate_bps = total_collection;

    Ok(())
}
```

### Using Buffs in Combat

```rust
pub fn attack_player(
    attacker: &PlayerAccount,
    defender: &PlayerAccount,
) -> Result<()> {
    // Just use cached buffs - no hero loading needed!
    let base_damage = calculate_base_damage(attacker);

    let hero_multiplier = 10000 + attacker.hero_buffs.attack_bps;
    let final_damage = (base_damage as u128)
        .saturating_mul(hero_multiplier as u128)
        .saturating_div(10000) as u64;

    // ... rest of combat
}
```

**Key Insight:** Combat/economy instructions are fast because they use pre-calculated buffs. Only buff-changing instructions (lock/unlock/level) load heroes.

---

## Fragment Economy

### Integration with Research System

**Unlocking Fragments:**
Fragments are NOT available by default. Players must first unlock them through the Growth Research tree:
- **Fragment Discovery** research node (15 levels)
- Level 1 unlocks fragment drops from encounters
- Each level increases drop rate by +5% → 70% max drop rate

**Sources (After Research Unlock):**
- Encounter drops: Variable based on encounter level and research
- Event rewards: 50-500 fragments for top performers
- PvP victories: 1-5 fragments (10% base chance)
- Daily rewards: If Daily Rewards research unlocked
- Future: Special fragment-focused events

**Drop Formula:**
```rust
pub fn calculate_fragment_drop(
    encounter: &EncounterAccount,
    player: &PlayerAccount,
) -> u64 {
    // Must have Fragment Discovery researched
    if !player.has_fragment_drops {
        return 0;
    }

    // Base drop chance from research (up to 7000 bps = 70%)
    let drop_chance = player.research_fragment_drop_rate_bps;
    if !random_roll(drop_chance, 10000) {
        return 0;
    }

    // Base amount scales with encounter level
    let base_amount = match encounter.level {
        1..=10 => fastrand::u64(1..=3),
        11..=25 => fastrand::u64(2..=5),
        26..=50 => fastrand::u64(3..=8),
        51..=75 => fastrand::u64(5..=12),
        76..=100 => fastrand::u64(8..=20),
        _ => fastrand::u64(10..=30),
    };

    // Rarity multiplier
    let rarity_mult = match encounter.rarity {
        0 => 100,  // Common: 1x
        1 => 150,  // Uncommon: 1.5x
        2 => 200,  // Rare: 2x
        3 => 300,  // Epic: 3x
        4 => 500,  // Legendary: 5x
        _ => 100,
    };

    (base_amount * rarity_mult) / 100
}
```

**Usage:**
- Hero leveling (ONLY use case currently)
- Creates critical gameplay loop: Research → Encounters → Fragments → Heroes
- Cannot be purchased - must be earned through gameplay

**Economy Balance:**
- Casual player (50% fragment drop rate): ~20-30 fragments/day
- Active player (70% fragment drop rate): ~50-100 fragments/day
- Hardcore player (70% + events): ~150-200 fragments/day

**Time to Max Heroes:**
- Level 50 hero: ~56,000 fragments = 280-560 days
- Level 100 hero: ~4M fragments = Years of dedication
- Creates permanent long-term goal

---

## Instructions

### 100: create_hero_template (DAO Only)

**Accounts:**
```
[signer] dao_authority
[writable] hero_template (PDA to create)
[] game_engine
[] system_program
```

**Data:**
- template_id: u16
- name: [u8; 32]
- hero_type: u8
- mint_cost_novi: u64
- supply_cap: u32
- base_buffs: [BuffConfig; 4]
- enabled: bool
- event_exclusive: bool
- required_level: u8

**Logic:**
1. Verify DAO authority
2. Create HeroTemplate PDA
3. Initialize template data
4. Emit event

---

### 101: mint_hero

**Accounts:**
```
[signer, writable] player_owner
[writable] player_account (PDA)
[] hero_template
[writable] hero_account (PDA to create)
[writable] hero_mint (MPL-Core mint to create)
[writable] treasury_account (System account for SOL)
[] game_engine
[] system_program
[] mpl_core_program
```

**Data:**
- template_id: u16

**Logic:**
1. Load template, verify enabled
2. Check supply cap (if limited)
3. Verify player level requirement
4. Transfer SOL to treasury (mint_cost_sol)
5. Mint MPL-Core NFT to player wallet
6. Create HeroAccount PDA
7. Initialize hero (level 1, random seed for future buffs)
8. Increment template.minted_count

---

### 102: lock_hero

**Accounts:**
```
[signer] player_owner
[writable] player_account (PDA)
[writable] hero_account
[] hero_mint
[] hero_template
[] hero_account_2 (for buff recalc)
[] hero_account_3 (for buff recalc)
[] mpl_core_program
```

**Data:**
- slot_index: u8 (0, 1, or 2)

**Logic:**
1. Verify hero owned by player
2. Verify slot not already occupied
3. Transfer NFT: wallet → PlayerAccount PDA
4. Update active_heroes[slot_index]
5. Recalculate buffs (load all 3 heroes)
6. Update hero.owner to PlayerAccount PDA

---

### 103: unlock_hero

**Accounts:**
```
[signer] player_owner
[writable] player_account (PDA)
[writable] hero_account
[] hero_mint
[] hero_template
[] hero_account_2 (for buff recalc)
[] hero_account_3 (for buff recalc)
[] mpl_core_program
```

**Data:**
- slot_index: u8

**Logic:**
1. Verify hero locked in slot
2. Verify player not in combat/rally/travel
3. Transfer NFT: PlayerAccount PDA → wallet
4. Clear active_heroes[slot_index]
5. Recalculate buffs (load remaining heroes)
6. Update hero.owner to wallet

---

### 104: level_up_hero

**Accounts:**
```
[signer, writable] player_owner
[writable] player_account (PDA)
[writable] hero_account
[] hero_template
[] hero_account_2 (if locked, for buff recalc)
[] hero_account_3 (if locked, for buff recalc)
```

**Data:** None (levels up by 1)

**Logic:**
1. Calculate fragment cost for next level
2. Verify player has enough fragments
3. Deduct fragments from player
4. Apply random buff increases based on template weights
5. Update hero.buff_increases array
6. Increment hero.level
7. Update hero.fragments_invested
8. Update hero.last_leveled_at
9. If hero is locked: recalculate player buffs
10. Update hero.total_buff_power
11. Update NFT metadata with new power level

---

### 105: assign_defensive_hero

**Accounts:**
```
[signer] player_owner
[writable] player_account (PDA)
```

**Data:**
- slot_index: u8 (0, 1, or 2)

**Logic:**
1. Verify hero locked in slot
2. Update defensive_hero_slot
3. (Buffs already cached, no recalc needed)

---

## MPL-Core Integration

### Collection Setup

```rust
Collection {
    name: "Novus Mundus Heroes",
    uri: "https://api.novusmundus.io/heroes/collection.json",
    update_authority: game_engine_pda,
}
```

### Hero NFT Asset

```rust
Asset {
    name: "Hero #{id} - {template_name}",
    uri: "https://api.novusmundus.io/heroes/{id}.json",
    update_authority: game_engine_pda,
    plugins: [
        Attributes {
            attributes: [
                {"trait_type": "Template", "value": "{template_name}"},
                {"trait_type": "Type", "value": "Offensive"},
                {"trait_type": "Level", "value": "1"},
                {"trait_type": "Power", "value": "500"},
            ],
        },
        Royalties {
            basis_points: 100,  // 1%
            creators: [
                { address: game_engine_treasury, share: 100 }
            ],
        },
    ],
}
```

### Metadata Updates on Level Up

When hero levels up, update NFT attributes:
```rust
// Update "Level" and "Power" attributes
update_nft_attribute(hero_mint, "Level", hero.level.to_string())?;
update_nft_attribute(hero_mint, "Power", hero.total_buff_power.to_string())?;
```

---

## Economic Impact

### SOL Revenue (Treasury Funding)

**Minting Costs by Tier:**
- Common heroes: 0.05 SOL each
- Rare heroes: 0.25 SOL each
- Epic heroes: 1 SOL each
- Legendary heroes: 5 SOL each
- Special editions: Variable (e.g., Satoshi = 2.1 SOL)

**Revenue Projections:**
- 10,000 players × 3 heroes average = 30,000 mints
- Average 0.5 SOL per mint = 15,000 SOL treasury revenue
- Funds operational costs and prize pools

### Fragment Economy

**Supply (Research-Gated):**
- No fragments until Fragment Discovery researched
- Casual player (50% drop rate): ~20-30 fragments/day
- Active player (70% drop rate): ~50-100 fragments/day
- Hardcore player: ~150-200 fragments/day (with events)

**Demand (Exponential Scaling):**
- Hero to level 10: ~576 fragments
- Hero to level 50: ~56,000 fragments
- Hero to level 100: ~4M fragments
- 3 heroes to level 50: ~168,000 fragments (1-2 years)
- 3 heroes to level 100: ~12M fragments (impossible without years of dedication)

**Balance:**
- Creates permanent progression goal
- Random buff increases make each hero unique
- Fragment scarcity drives encounter engagement
- Can pay-to-win with fragments but only if Fragment Discovery researched or if at a certain level.

---

## Hero Gallery Examples

### Historical Warriors & Leaders
- **Alexander the Great** (Offensive) - Conquered the known world
- **Julius Caesar** (Hybrid) - Roman emperor and military genius
- **Napoleon Bonaparte** (Offensive) - Master tactician
- **Genghis Khan** (Offensive) - Mongol conqueror
- **Joan of Arc** (Defensive) - French heroine
- **Cleopatra** (Economic) - Egyptian queen and diplomat
- **Sun Tzu** (Hybrid) - Art of War strategist
- **Leonidas** (Defensive) - Spartan king of 300
- **Hannibal Barca** (Offensive) - Crossed the Alps with elephants
- **William Wallace** (Defensive) - Scottish freedom fighter
- **Hercules** (Offensive) - Byzantine conqueror
- **Attila the Hun** (Offensive) - Hun conqueror

### Legends & Folk Heroes

- **Merlin** (Hybrid) - Court wizard and prophet
- **Nimue** (Defensive) - Lady of the Lake
- **Mordred** (Offensive) - Dark knight
- **Gawain** (Defensive) - Knight of the sun
- **Robin Hood** (Economic) - Sherwood Forest outlaw
- **Beowulf** (Offensive) - Geatish monster slayer
- **El Cid** (Hybrid) - Castilian knight
- **Sinbad** (Economic) - Sailor merchant of Baghdad
- **Scheherazade** (Economic) - Thousand tales storyteller
- **Baba Yaga** (Defensive) - Iron-toothed witch
- **Koschei** (Offensive) - Deathless sorcerer
- **Ilya Muromets** (Defensive) - Bogatyr champion
- **Vasilisa** (Economic) - Clever merchant daughter
- **Dobrynya Nikitich** (Hybrid) - Dragon slayer knight
- **Sun Wukong** (Offensive) - Monkey King
- **Hua Mulan** (Hybrid) - Warrior maiden
- **Zhuge Liang** (Economic) - Sleeping dragon strategist
- **Miyamoto Musashi** (Offensive) - Sword saint
- **Tomoe Gozen** (Defensive) - Female samurai
- **Aladdin** (Economic) - Lamp finder
- **Ali Baba** (Economic) - Cave discoverer
- **Rostam** (Offensive) - Persian champion
- **Shirin** (Hybrid) - Mountain carver

### Crypto & Web3 Icons
- **Satoshi Nakamoto** (Economic) - Bitcoin creator
- **Bored Ape** (Economic) - BAYC reference
- **Pepe** (Economic) - Meme lord
- **Wojak** (Defensive) - Feels guy
- **Diamond Hands** (Defensive) - HODLer supreme
- **Paper Hands** (Economic) - Quick trader (negative defense)

### Original Game Heroes
- **Theophilos** (Economic) - Master builder of empires
- **Kassandra** (Hybrid) - Oracle warrior priestess
- **Nikephoros Ironside** (Defensive) - Unbreakable Byzantine guardian
- **Chrysanthos the Golden** (Economic) - Legendary merchant prince
- **Alexios Shadowblade** (Offensive) - Night stalker assassin
- **Bjorn Ironforge** (Defensive) - Legendary shield wall commander
- **Astrid Stormcaller** (Offensive) - Berserker queen
- **Magnus Goldbeard** (Economic) - Wealthy trade jarl
- **Sigrid the Wise** (Hybrid) - Seer and strategist
- **Ragnar Bloodaxe** (Offensive) - Raid master
- **Brennus the Bold** (Offensive) - Gallic war chief
- **Maeve of Ulster** (Hybrid) - Warrior queen
- **Cormac Silverhand** (Economic) - Druid merchant
- **Brigid Flameheart** (Defensive) - Guardian of the hearth
- **Finnegan the Lucky** (Economic) - Fortune's favorite
- **Marcus Aurelius Maximus** (Hybrid) - Philosopher warrior
- **Valentina the Vigilant** (Defensive) - Praetorian commander
- **Lucius Prosperus** (Economic) - Senate's treasurer
- **Octavia Shadowfoot** (Offensive) - Silent blade
- **Titus** (Defensive) - Last centurion
- **Akira Steelblossom** (Offensive) - Ronin master
- **Li Wei the Prosperous** (Economic) - Silk road magnate
- **Yamato Ironwall** (Defensive) - Samurai protector
- **Mei Ling the Phoenix** (Hybrid) - Reborn from ashes
- **Jin the Silent Storm** (Offensive) - Shadow ninja
- **Darius the Magnificent** (Economic) - Persian trade lord
- **Zara Moonblade** (Offensive) - Desert assassin
- **Omar the Orator** (Hybrid) - Arabian caliph
- **Khalid the Warrior** (Offensive) - Arabian conqueror
- **Nefertari the Noble** (Hybrid) - Egyptian queen
- **Layla Goldweaver** (Economic) - Bazaar queen
- **Rashid the Defender** (Defensive) - Gate keeper
- **Vladimir Ironheart** (Defensive) - Boyar protector
- **Svetlana the Swift** (Offensive) - Cossack raider
- **Dmitri Goldhands** (Economic) - Amber road trader
- **Katarina Nightwhisper** (Offensive) - Silent hunter
- **Boris the Mountain** (Defensive) - Immovable guardian


---

## Implementation Checklist

### Phase 0: Prerequisites
- [ ] **Port MPL-Core to Pinocchio-compatible instructions**
- [ ] Implement Fragment Discovery research in Growth tree
- [ ] Test fragment drops from encounters

### Phase 1: Core Infrastructure
- [ ] Add `fragments: u64` to PlayerAccount (already added for Research)
- [ ] Add `active_heroes: [Pubkey; 3]` to PlayerAccount
- [ ] Add `defensive_hero_slot: u8` to PlayerAccount
- [ ] Add `hero_buffs: HeroBuffs` to PlayerAccount
- [ ] Create `HeroTemplate` state with random buff weights
- [ ] Create `HeroAccount` state with buff_increases array
- [ ] Setup SOL treasury account for minting revenue

### Phase 2: Template Management
- [ ] Implement `create_hero_template` instruction (DAO)
- [ ] Add template validation logic
- [ ] Create initial 3 templates (Offensive, Defensive, Economic)

### Phase 3: Hero Minting
- [ ] Implement `mint_hero` instruction with SOL payment
- [ ] MPL-Core collection creation (requires Pinocchio port)
- [ ] MPL-Core asset minting with random seed for buffs
- [ ] SOL transfer to treasury account
- [ ] Supply cap enforcement
- [ ] Implement diverse hero templates (historical, mythological, etc.)

### Phase 4: Hero Locking
- [ ] Implement `lock_hero` instruction
- [ ] NFT transfer wallet → PlayerAccount PDA
- [ ] Buff recalculation logic
- [ ] Implement `unlock_hero` instruction
- [ ] NFT transfer PlayerAccount PDA → wallet

### Phase 5: Hero Leveling
- [ ] Implement `level_up_hero` instruction (fragments only)
- [ ] Fragment cost calculation (exponential: 1.5^level)
- [ ] Random buff increase system based on weights
- [ ] Fragment deduction from PlayerAccount
- [ ] Update hero.buff_increases array
- [ ] NFT metadata updates with total_buff_power

### Phase 6: Fragment Drops
- [ ] Add fragment drops to encounter attacks
- [ ] Add fragment rewards to events
- [ ] Test drop rates

### Phase 7: Combat Integration
- [ ] Update attack_player with hero buffs
- [ ] Update attack_encounter with hero buffs
- [ ] Update defensive calculations with defensive hero
- [ ] Test buff compounding

### Phase 8: Testing & Balance
- [ ] Test all buff calculations
- [ ] Verify no overflow scenarios
- [ ] Balance costs and buffs
- [ ] Community feedback

**Estimated Time: 3 weeks**
