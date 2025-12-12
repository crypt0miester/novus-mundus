# Hero Gallery

Complete reference for all heroes in Novus Mundus, including buff configurations, tiers, and template data for easy creation.

---

## Quick Reference

### Hero Types

| Type | Focus | Best For |
|------|-------|----------|
| **Offensive** | Attack, Damage | PvP attackers, Encounter farming |
| **Defensive** | Defense, Protection | Base defense, Survival |
| **Economic** | Resources, Collection | Passive income, Growth |
| **Hybrid** | Balanced stats | Versatile playstyles |

### Hero Categories

| Category | Theme | Examples |
|----------|-------|----------|
| **Historical** | Real historical figures | Alexander, Caesar, Napoleon |
| **Mythological** | Gods, legends, folklore | Zeus, Odin, Thor |
| **CryptoIcons** | Web3 personalities | Satoshi, Pepe |
| **Gaming** | Gaming references | (Requires licensing) |
| **Original** | Game-created characters | Theophilos, Kassandra |

### Buff Statistics

| ID | Stat | Description | Power Weight |
|----|------|-------------|--------------|
| 1 | AttackPower | Increases attack damage | 100% (Tier 1) |
| 2 | DefensePower | Increases defense | 100% (Tier 1) |
| 3 | CashCollectionRate | Faster cash generation | 60% (Tier 3) |
| 4 | XpGain | More XP from actions | 45% (Tier 4) |
| 5 | TrainingCostReduction | Cheaper unit training | 45% (Tier 4) |
| 6 | RallyCapacity | More rally participants | 75% (Tier 2) |
| 7 | CriticalHitChance | Higher crit rate | 75% (Tier 2) |
| 8 | SynchronyBonus | Better coordination | 30% (Tier 5) |
| 9 | ResourceCapacity | Larger storage | 30% (Tier 5) |
| 10 | WeaponEfficiency | Better weapon use | 30% (Tier 5) |
| 11 | StaminaRegen | Faster stamina recovery | 30% (Tier 5) |
| 12 | ProduceGeneration | More produce output | 60% (Tier 3) |
| 13 | UnitCapacity | More unit slots | 30% (Tier 5) |
| 14 | EncounterDamage | More encounter damage | 100% (Tier 1) |
| 15 | LootBonus | Better loot drops | 60% (Tier 3) |
| 16 | ArmorEfficiency | Better armor use | 30% (Tier 5) |
| 17 | MiningAffinity | Bonus yield from mining expeditions | 60% (Tier 3) |
| 18 | FishingAffinity | Bonus yield from fishing expeditions | 60% (Tier 3) |

### Buff Scaling Formula

```
buff_value = base_bps × (√φ)^level
```

Where φ (phi) = 1.618... (golden ratio), √φ ≈ 1.272

**Example (500 base_bps):**
| Level | Buff Value |
|-------|------------|
| 1 | 500 bps |
| 10 | ~5,700 bps |
| 25 | ~85,000 bps |
| 50 | ~14.5M bps |

---

## Rarity Tiers

| Tier | Mint Cost | Supply | Level Req | Typical Base Buffs |
|------|-----------|--------|-----------|-------------------|
| **Common** | 0.05 SOL | Unlimited | 1 | 300-500 bps |
| **Uncommon** | 0.15 SOL | 50,000 | 10 | 500-800 bps |
| **Rare** | 0.25 SOL | 10,000 | 25 | 800-1200 bps |
| **Epic** | 1.0 SOL | 1,000 | 50 | 1200-2000 bps |
| **Legendary** | 5.0 SOL | 100 | 75 | 2000-3000 bps |
| **Mythic** | 10.0+ SOL | 10-50 | 100 | 3000+ bps |

---

## Historical Warriors & Leaders

### Alexander the Great

> *"There is nothing impossible to him who will try."*

| Property | Value |
|----------|-------|
| **Template ID** | 10 |
| **Type** | Offensive |
| **Category** | Historical |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Athens (ID: 4) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1000 | World conqueror's might |
| 1 | RallyCapacity | 500 | Commander of armies |
| 2 | XpGain | 300 | Legacy of greatness |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 10,
    name: *b"Alexander the Great\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 0,  // Historical
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 4, // Athens (Pella)
    buffs: [
        BuffConfig { stat: 1, base_bps: 1000, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 6, base_bps: 500, _reserved: [0; 2] },   // RallyCapacity
        BuffConfig { stat: 4, base_bps: 300, _reserved: [0; 2] },   // XpGain
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Julius Caesar

> *"Veni, vidi, vici."*

| Property | Value |
|----------|-------|
| **Template ID** | 11 |
| **Type** | Hybrid |
| **Category** | Historical |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Rome (ID: 3) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 800 | Military genius |
| 1 | DefensePower | 600 | Fortification master |
| 2 | CashCollectionRate | 400 | Empire's tribute |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 11,
    name: *b"Julius Caesar\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 3, // Hybrid
    category: 0,  // Historical
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 3, // Rome
    buffs: [
        BuffConfig { stat: 1, base_bps: 800, _reserved: [0; 2] },   // AttackPower
        BuffConfig { stat: 2, base_bps: 600, _reserved: [0; 2] },   // DefensePower
        BuffConfig { stat: 3, base_bps: 400, _reserved: [0; 2] },   // CashCollectionRate
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Leonidas

> *"Come and take them."*

| Property | Value |
|----------|-------|
| **Template ID** | 12 |
| **Type** | Defensive |
| **Category** | Historical |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Athens (ID: 4) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 1200 | Spartan shield wall |
| 1 | ArmorEfficiency | 600 | Bronze-clad warriors |
| 2 | SynchronyBonus | 400 | 300 fight as one |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 12,
    name: *b"Leonidas\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 1, // Defensive
    category: 0,  // Historical
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 4, // Athens (Sparta)
    buffs: [
        BuffConfig { stat: 2, base_bps: 1200, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 16, base_bps: 600, _reserved: [0; 2] }, // ArmorEfficiency
        BuffConfig { stat: 8, base_bps: 400, _reserved: [0; 2] },  // SynchronyBonus
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Cleopatra

> *"I will not be triumphed over."*

| Property | Value |
|----------|-------|
| **Template ID** | 13 |
| **Type** | Economic |
| **Category** | Historical |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Cairo (ID: 8) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | CashCollectionRate | 1200 | Egyptian wealth |
| 1 | ProduceGeneration | 600 | Nile's bounty |
| 2 | ResourceCapacity | 400 | Royal treasury |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 13,
    name: *b"Cleopatra\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 0,  // Historical
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 8, // Cairo (Alexandria)
    buffs: [
        BuffConfig { stat: 3, base_bps: 1200, _reserved: [0; 2] },  // CashCollectionRate
        BuffConfig { stat: 12, base_bps: 600, _reserved: [0; 2] }, // ProduceGeneration
        BuffConfig { stat: 9, base_bps: 400, _reserved: [0; 2] },  // ResourceCapacity
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Genghis Khan

> *"I am the punishment of God."*

| Property | Value |
|----------|-------|
| **Template ID** | 14 |
| **Type** | Offensive |
| **Category** | Historical |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Beijing (ID: 10) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1800 | Mongol fury |
| 1 | EncounterDamage | 1200 | Horde devastation |
| 2 | RallyCapacity | 800 | Khan's command |
| 3 | LootBonus | 500 | Plunder master |

```rust
HeroTemplate {
    template_id: 14,
    name: *b"Genghis Khan\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 0,  // Historical
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 10, // Beijing (Karakorum)
    buffs: [
        BuffConfig { stat: 1, base_bps: 1800, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 14, base_bps: 1200, _reserved: [0; 2] }, // EncounterDamage
        BuffConfig { stat: 6, base_bps: 800, _reserved: [0; 2] },   // RallyCapacity
        BuffConfig { stat: 15, base_bps: 500, _reserved: [0; 2] },  // LootBonus
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Sun Tzu

> *"Supreme excellence consists of breaking the enemy's resistance without fighting."*

| Property | Value |
|----------|-------|
| **Template ID** | 15 |
| **Type** | Hybrid |
| **Category** | Historical |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Beijing (ID: 10) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | CriticalHitChance | 800 | Strategic precision |
| 1 | DefensePower | 600 | Art of War defense |
| 2 | XpGain | 500 | Master's teachings |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 15,
    name: *b"Sun Tzu\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 3, // Hybrid
    category: 0,  // Historical
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 10, // Beijing (Suzhou)
    buffs: [
        BuffConfig { stat: 7, base_bps: 800, _reserved: [0; 2] },  // CriticalHitChance
        BuffConfig { stat: 2, base_bps: 600, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 4, base_bps: 500, _reserved: [0; 2] },  // XpGain
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Joan of Arc

> *"I am not afraid... I was born to do this."*

| Property | Value |
|----------|-------|
| **Template ID** | 16 |
| **Type** | Defensive |
| **Category** | Historical |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Paris (ID: 2) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 1000 | Divine protection |
| 1 | SynchronyBonus | 700 | Inspiring presence |
| 2 | StaminaRegen | 400 | Unwavering faith |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 16,
    name: *b"Joan of Arc\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 1, // Defensive
    category: 0,  // Historical
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 2, // Paris (Orleans)
    buffs: [
        BuffConfig { stat: 2, base_bps: 1000, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 8, base_bps: 700, _reserved: [0; 2] },   // SynchronyBonus
        BuffConfig { stat: 11, base_bps: 400, _reserved: [0; 2] },  // StaminaRegen
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Napoleon Bonaparte

> *"Impossible is a word to be found only in the dictionary of fools."*

| Property | Value |
|----------|-------|
| **Template ID** | 17 |
| **Type** | Offensive |
| **Category** | Historical |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Paris (ID: 2) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1500 | Artillery master |
| 1 | CriticalHitChance | 1000 | Tactical genius |
| 2 | RallyCapacity | 700 | Grand Armee commander |
| 3 | XpGain | 400 | Rapid advancement |

```rust
HeroTemplate {
    template_id: 17,
    name: *b"Napoleon Bonaparte\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 0,  // Historical
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 2, // Paris
    buffs: [
        BuffConfig { stat: 1, base_bps: 1500, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 7, base_bps: 1000, _reserved: [0; 2] },  // CriticalHitChance
        BuffConfig { stat: 6, base_bps: 700, _reserved: [0; 2] },   // RallyCapacity
        BuffConfig { stat: 4, base_bps: 400, _reserved: [0; 2] },   // XpGain
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Hannibal Barca

> *"We will either find a way, or make one."*

| Property | Value |
|----------|-------|
| **Template ID** | 18 |
| **Type** | Offensive |
| **Category** | Historical |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Cairo (ID: 8) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1400 | Elephant charge |
| 1 | EncounterDamage | 1000 | Mountain crossing fury |
| 2 | CriticalHitChance | 800 | Ambush master |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 18,
    name: *b"Hannibal Barca\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 0,  // Historical
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 8, // Cairo (Carthage)
    buffs: [
        BuffConfig { stat: 1, base_bps: 1400, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 14, base_bps: 1000, _reserved: [0; 2] }, // EncounterDamage
        BuffConfig { stat: 7, base_bps: 800, _reserved: [0; 2] },   // CriticalHitChance
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### William Wallace

> *"Every man dies, not every man really lives."*

| Property | Value |
|----------|-------|
| **Template ID** | 19 |
| **Type** | Defensive |
| **Category** | Historical |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | London (ID: 1) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 1100 | Scottish resistance |
| 1 | SynchronyBonus | 700 | Rally the clans |
| 2 | StaminaRegen | 400 | Highland endurance |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 19,
    name: *b"William Wallace\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 1, // Defensive
    category: 0,  // Historical
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 1, // London (Edinburgh)
    buffs: [
        BuffConfig { stat: 2, base_bps: 1100, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 8, base_bps: 700, _reserved: [0; 2] },   // SynchronyBonus
        BuffConfig { stat: 11, base_bps: 400, _reserved: [0; 2] },  // StaminaRegen
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Heraclius

> *"The sword of God falls upon the enemies of Rome."*

| Property | Value |
|----------|-------|
| **Template ID** | 20 |
| **Type** | Offensive |
| **Category** | Historical |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Istanbul (ID: 7) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1600 | Byzantine reconquest |
| 1 | DefensePower | 1000 | Empire's shield |
| 2 | RallyCapacity | 600 | Imperial legions |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 20,
    name: *b"Heraclius\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 0,  // Historical
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 7, // Istanbul (Constantinople)
    buffs: [
        BuffConfig { stat: 1, base_bps: 1600, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 2, base_bps: 1000, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 6, base_bps: 600, _reserved: [0; 2] },   // RallyCapacity
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Attila the Hun

> *"Where I have passed, the grass will never grow again."*

| Property | Value |
|----------|-------|
| **Template ID** | 21 |
| **Type** | Offensive |
| **Category** | Historical |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Berlin (ID: 5) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1800 | Scourge of God |
| 1 | EncounterDamage | 1000 | Horde devastation |
| 2 | LootBonus | 600 | Pillage master |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 21,
    name: *b"Attila the Hun\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 0,  // Historical
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 5, // Berlin (Budapest)
    buffs: [
        BuffConfig { stat: 1, base_bps: 1800, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 14, base_bps: 1000, _reserved: [0; 2] }, // EncounterDamage
        BuffConfig { stat: 15, base_bps: 600, _reserved: [0; 2] },  // LootBonus
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

## Mythological Heroes

### Zeus

> *"Father of gods and men."*

| Property | Value |
|----------|-------|
| **Template ID** | 50 |
| **Type** | Hybrid |
| **Category** | Mythological |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Athens (ID: 4) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1500 | Lightning bolts |
| 1 | DefensePower | 1500 | Divine aegis |
| 2 | CriticalHitChance | 1000 | Thunder strike |
| 3 | LootBonus | 500 | Olympian favor |

```rust
HeroTemplate {
    template_id: 50,
    name: *b"Zeus\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 3, // Hybrid
    category: 1,  // Mythological
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 4, // Athens (Mount Olympus)
    buffs: [
        BuffConfig { stat: 1, base_bps: 1500, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 2, base_bps: 1500, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 7, base_bps: 1000, _reserved: [0; 2] },  // CriticalHitChance
        BuffConfig { stat: 15, base_bps: 500, _reserved: [0; 2] },  // LootBonus
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Athena

> *"Wisdom in warfare brings victory."*

| Property | Value |
|----------|-------|
| **Template ID** | 51 |
| **Type** | Defensive |
| **Category** | Mythological |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Athens (ID: 4) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 1800 | Aegis shield |
| 1 | CriticalHitChance | 800 | Strategic wisdom |
| 2 | XpGain | 600 | Goddess of wisdom |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 51,
    name: *b"Athena\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 1, // Defensive
    category: 1,  // Mythological
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 4, // Athens
    buffs: [
        BuffConfig { stat: 2, base_bps: 1800, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 7, base_bps: 800, _reserved: [0; 2] },   // CriticalHitChance
        BuffConfig { stat: 4, base_bps: 600, _reserved: [0; 2] },   // XpGain
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Ares

> *"War is my domain."*

| Property | Value |
|----------|-------|
| **Template ID** | 52 |
| **Type** | Offensive |
| **Category** | Mythological |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Athens (ID: 4) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 2000 | God of war |
| 1 | EncounterDamage | 1200 | Bloodlust |
| 2 | WeaponEfficiency | 800 | Divine armaments |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 52,
    name: *b"Ares\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 1,  // Mythological
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 4, // Athens (Sparta)
    buffs: [
        BuffConfig { stat: 1, base_bps: 2000, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 14, base_bps: 1200, _reserved: [0; 2] }, // EncounterDamage
        BuffConfig { stat: 10, base_bps: 800, _reserved: [0; 2] },  // WeaponEfficiency
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Odin

> *"I gave an eye for wisdom, and would give more."*

| Property | Value |
|----------|-------|
| **Template ID** | 53 |
| **Type** | Hybrid |
| **Category** | Mythological |
| **Tier** | Legendary |
| **Mint Cost** | 5.0 SOL |
| **Supply Cap** | 100 |
| **Required Level** | 75 |
| **Meditation City** | Moscow (ID: 6) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 2000 | Gungnir's thrust |
| 1 | DefensePower | 1500 | Allfather's might |
| 2 | XpGain | 1200 | Wisdom of ages |
| 3 | CriticalHitChance | 800 | Raven's foresight |

```rust
HeroTemplate {
    template_id: 53,
    name: *b"Odin\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 3, // Hybrid
    category: 1,  // Mythological
    mint_cost_sol: 5_000_000_000,
    supply_cap: 100,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 75,
    meditation_city_id: 6, // Moscow (Uppsala)
    buffs: [
        BuffConfig { stat: 1, base_bps: 2000, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 2, base_bps: 1500, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 4, base_bps: 1200, _reserved: [0; 2] },  // XpGain
        BuffConfig { stat: 7, base_bps: 800, _reserved: [0; 2] },   // CriticalHitChance
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Thor

> *"Whosoever holds this hammer, if they be worthy..."*

| Property | Value |
|----------|-------|
| **Template ID** | 54 |
| **Type** | Offensive |
| **Category** | Mythological |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Moscow (ID: 6) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1800 | Mjolnir strike |
| 1 | CriticalHitChance | 1200 | Thunder god |
| 2 | StaminaRegen | 600 | Endless vigor |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 54,
    name: *b"Thor\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 1,  // Mythological
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 6, // Moscow (Asgard)
    buffs: [
        BuffConfig { stat: 1, base_bps: 1800, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 7, base_bps: 1200, _reserved: [0; 2] },  // CriticalHitChance
        BuffConfig { stat: 11, base_bps: 600, _reserved: [0; 2] },  // StaminaRegen
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Ra

> *"I am the sun that rises and sets."*

| Property | Value |
|----------|-------|
| **Template ID** | 55 |
| **Type** | Economic |
| **Category** | Mythological |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Cairo (ID: 8) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | CashCollectionRate | 1500 | Sun god's blessing |
| 1 | ProduceGeneration | 1000 | Golden harvest |
| 2 | XpGain | 700 | Eternal cycle |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 55,
    name: *b"Ra\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 1,  // Mythological
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 8, // Cairo (Heliopolis)
    buffs: [
        BuffConfig { stat: 3, base_bps: 1500, _reserved: [0; 2] },  // CashCollectionRate
        BuffConfig { stat: 12, base_bps: 1000, _reserved: [0; 2] }, // ProduceGeneration
        BuffConfig { stat: 4, base_bps: 700, _reserved: [0; 2] },   // XpGain
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Anubis

> *"I weigh the hearts of the dead."*

| Property | Value |
|----------|-------|
| **Template ID** | 56 |
| **Type** | Defensive |
| **Category** | Mythological |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Cairo (ID: 8) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 1600 | Guardian of the dead |
| 1 | LootBonus | 800 | Tomb treasures |
| 2 | ArmorEfficiency | 600 | Jackal's protection |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 56,
    name: *b"Anubis\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 1, // Defensive
    category: 1,  // Mythological
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 8, // Cairo (Memphis)
    buffs: [
        BuffConfig { stat: 2, base_bps: 1600, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 15, base_bps: 800, _reserved: [0; 2] },  // LootBonus
        BuffConfig { stat: 16, base_bps: 600, _reserved: [0; 2] },  // ArmorEfficiency
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Poseidon

> *"The sea is my domain."*

| Property | Value |
|----------|-------|
| **Template ID** | 57 |
| **Type** | Hybrid |
| **Category** | Mythological |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Athens (ID: 4) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1400 | Trident's fury |
| 1 | DefensePower | 1200 | Ocean's embrace |
| 2 | ResourceCapacity | 800 | Depths of wealth |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 57,
    name: *b"Poseidon\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 3, // Hybrid
    category: 1,  // Mythological
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 4, // Athens (Atlantis)
    buffs: [
        BuffConfig { stat: 1, base_bps: 1400, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 2, base_bps: 1200, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 9, base_bps: 800, _reserved: [0; 2] },   // ResourceCapacity
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

## Mythic Tier

> *Ultra-rare heroes of cosmic power. Only the most dedicated players can hope to acquire these.*

### Gilgamesh

> *"He who saw the Deep, the foundation of the land."*

| Property | Value |
|----------|-------|
| **Template ID** | 160 |
| **Type** | Hybrid |
| **Category** | Mythological |
| **Tier** | Mythic |
| **Mint Cost** | 10.0 SOL |
| **Supply Cap** | 50 |
| **Required Level** | 100 |
| **Meditation City** | Baghdad (ID: 16) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 2500 | King of Uruk |
| 1 | DefensePower | 2000 | Two-thirds divine |
| 2 | EncounterDamage | 1500 | Slayer of Humbaba |
| 3 | StaminaRegen | 1000 | Quest for immortality |

```rust
HeroTemplate {
    template_id: 160,
    name: *b"Gilgamesh\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 3, // Hybrid
    category: 1,  // Mythological
    mint_cost_sol: 10_000_000_000,
    supply_cap: 50,
    minted_count: 0,
    enabled: true,
    event_exclusive: true,
    required_player_level: 100,
    meditation_city_id: 16, // Baghdad (Uruk)
    buffs: [
        BuffConfig { stat: 1, base_bps: 2500, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 2, base_bps: 2000, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 14, base_bps: 1500, _reserved: [0; 2] }, // EncounterDamage
        BuffConfig { stat: 11, base_bps: 1000, _reserved: [0; 2] }, // StaminaRegen
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Amaterasu

> *"From darkness, I bring forth the dawn."*

| Property | Value |
|----------|-------|
| **Template ID** | 161 |
| **Type** | Hybrid |
| **Category** | Mythological |
| **Tier** | Mythic |
| **Mint Cost** | 10.0 SOL |
| **Supply Cap** | 50 |
| **Required Level** | 100 |
| **Meditation City** | Tokyo (ID: 9) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | CashCollectionRate | 2500 | Divine prosperity |
| 1 | DefensePower | 2000 | Heavenly radiance |
| 2 | XpGain | 1500 | Celestial wisdom |
| 3 | ProduceGeneration | 1000 | Harvest blessing |

```rust
HeroTemplate {
    template_id: 161,
    name: *b"Amaterasu\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 3, // Hybrid
    category: 1,  // Mythological
    mint_cost_sol: 10_000_000_000,
    supply_cap: 50,
    minted_count: 0,
    enabled: true,
    event_exclusive: true,
    required_player_level: 100,
    meditation_city_id: 9, // Tokyo
    buffs: [
        BuffConfig { stat: 3, base_bps: 2500, _reserved: [0; 2] },  // CashCollectionRate
        BuffConfig { stat: 2, base_bps: 2000, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 4, base_bps: 1500, _reserved: [0; 2] },  // XpGain
        BuffConfig { stat: 12, base_bps: 1000, _reserved: [0; 2] }, // ProduceGeneration
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Quetzalcoatl

> *"The feathered serpent descends from the morning star."*

| Property | Value |
|----------|-------|
| **Template ID** | 162 |
| **Type** | Offensive |
| **Category** | Mythological |
| **Tier** | Mythic |
| **Mint Cost** | 10.0 SOL |
| **Supply Cap** | 50 |
| **Required Level** | 100 |
| **Meditation City** | Mexico City (ID: 19) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 2800 | Divine wind |
| 1 | CriticalHitChance | 1800 | Serpent strike |
| 2 | RallyCapacity | 1200 | God-king command |
| 3 | LootBonus | 800 | Temple treasures |

```rust
HeroTemplate {
    template_id: 162,
    name: *b"Quetzalcoatl\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 1,  // Mythological
    mint_cost_sol: 10_000_000_000,
    supply_cap: 50,
    minted_count: 0,
    enabled: true,
    event_exclusive: true,
    required_player_level: 100,
    meditation_city_id: 19, // Mexico City
    buffs: [
        BuffConfig { stat: 1, base_bps: 2800, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 7, base_bps: 1800, _reserved: [0; 2] },  // CriticalHitChance
        BuffConfig { stat: 6, base_bps: 1200, _reserved: [0; 2] },  // RallyCapacity
        BuffConfig { stat: 15, base_bps: 800, _reserved: [0; 2] },  // LootBonus
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Prometheus

> *"For humanity, I stole fire from the gods."*

| Property | Value |
|----------|-------|
| **Template ID** | 163 |
| **Type** | Economic |
| **Category** | Mythological |
| **Tier** | Mythic |
| **Mint Cost** | 10.0 SOL |
| **Supply Cap** | 50 |
| **Required Level** | 100 |
| **Meditation City** | Athens (ID: 4) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | XpGain | 3000 | Gift of knowledge |
| 1 | TrainingCostReduction | 2000 | Divine teaching |
| 2 | CashCollectionRate | 1500 | Fire of civilization |
| 3 | DefensePower | 1000 | Titan's endurance |

```rust
HeroTemplate {
    template_id: 163,
    name: *b"Prometheus\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 1,  // Mythological
    mint_cost_sol: 10_000_000_000,
    supply_cap: 50,
    minted_count: 0,
    enabled: true,
    event_exclusive: true,
    required_player_level: 100,
    meditation_city_id: 4, // Athens
    buffs: [
        BuffConfig { stat: 4, base_bps: 3000, _reserved: [0; 2] },  // XpGain
        BuffConfig { stat: 5, base_bps: 2000, _reserved: [0; 2] },  // TrainingCostReduction
        BuffConfig { stat: 3, base_bps: 1500, _reserved: [0; 2] },  // CashCollectionRate
        BuffConfig { stat: 2, base_bps: 1000, _reserved: [0; 2] },  // DefensePower
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

## Legends & Folk Heroes

### Sun Wukong

> *"Even the gods cannot stop me."*

| Property | Value |
|----------|-------|
| **Template ID** | 70 |
| **Type** | Offensive |
| **Category** | Mythological |
| **Tier** | Legendary |
| **Mint Cost** | 5.0 SOL |
| **Supply Cap** | 100 |
| **Required Level** | 75 |
| **Meditation City** | Shanghai (ID: 11) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 2200 | Golden cudgel |
| 1 | CriticalHitChance | 1500 | 72 transformations |
| 2 | StaminaRegen | 1000 | Immortal vigor |
| 3 | EncounterDamage | 800 | Heaven challenger |

```rust
HeroTemplate {
    template_id: 70,
    name: *b"Sun Wukong\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 1,  // Mythological
    mint_cost_sol: 5_000_000_000,
    supply_cap: 100,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 75,
    meditation_city_id: 11, // Shanghai (Flower Fruit Mountain)
    buffs: [
        BuffConfig { stat: 1, base_bps: 2200, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 7, base_bps: 1500, _reserved: [0; 2] },  // CriticalHitChance
        BuffConfig { stat: 11, base_bps: 1000, _reserved: [0; 2] }, // StaminaRegen
        BuffConfig { stat: 14, base_bps: 800, _reserved: [0; 2] },  // EncounterDamage
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Miyamoto Musashi

> *"You must understand that there is more than one path to the top of the mountain."*

| Property | Value |
|----------|-------|
| **Template ID** | 71 |
| **Type** | Offensive |
| **Category** | Historical |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Tokyo (ID: 9) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1600 | Two-sword style |
| 1 | CriticalHitChance | 1200 | Sword saint precision |
| 2 | WeaponEfficiency | 800 | Perfect technique |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 71,
    name: *b"Miyamoto Musashi\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 0,  // Historical
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 9, // Tokyo (Kyoto)
    buffs: [
        BuffConfig { stat: 1, base_bps: 1600, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 7, base_bps: 1200, _reserved: [0; 2] },  // CriticalHitChance
        BuffConfig { stat: 10, base_bps: 800, _reserved: [0; 2] },  // WeaponEfficiency
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Robin Hood

> *"Rise and rise again until lambs become lions."*

| Property | Value |
|----------|-------|
| **Template ID** | 72 |
| **Type** | Economic |
| **Category** | Historical |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | London (ID: 1) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | LootBonus | 1000 | Steal from the rich |
| 1 | CashCollectionRate | 800 | Give to the poor |
| 2 | CriticalHitChance | 500 | Perfect aim |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 72,
    name: *b"Robin Hood\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 0,  // Historical
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 1, // London (Nottingham)
    buffs: [
        BuffConfig { stat: 15, base_bps: 1000, _reserved: [0; 2] }, // LootBonus
        BuffConfig { stat: 3, base_bps: 800, _reserved: [0; 2] },   // CashCollectionRate
        BuffConfig { stat: 7, base_bps: 500, _reserved: [0; 2] },   // CriticalHitChance
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Merlin

> *"The future holds great peril, and great promise."*

| Property | Value |
|----------|-------|
| **Template ID** | 73 |
| **Type** | Hybrid |
| **Category** | Mythological |
| **Tier** | Legendary |
| **Mint Cost** | 5.0 SOL |
| **Supply Cap** | 100 |
| **Required Level** | 75 |
| **Meditation City** | London (ID: 1) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | XpGain | 1500 | Arcane wisdom |
| 1 | CriticalHitChance | 1200 | Prophetic sight |
| 2 | DefensePower | 1000 | Magical barriers |
| 3 | CashCollectionRate | 800 | Alchemy |

```rust
HeroTemplate {
    template_id: 73,
    name: *b"Merlin\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 3, // Hybrid
    category: 1,  // Mythological
    mint_cost_sol: 5_000_000_000,
    supply_cap: 100,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 75,
    meditation_city_id: 1, // London (Camelot)
    buffs: [
        BuffConfig { stat: 4, base_bps: 1500, _reserved: [0; 2] },  // XpGain
        BuffConfig { stat: 7, base_bps: 1200, _reserved: [0; 2] },  // CriticalHitChance
        BuffConfig { stat: 2, base_bps: 1000, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 3, base_bps: 800, _reserved: [0; 2] },   // CashCollectionRate
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Nimue

> *"The lake holds secrets deeper than time."*

| Property | Value |
|----------|-------|
| **Template ID** | 74 |
| **Type** | Defensive |
| **Category** | Mythological |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | London (ID: 1) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 1400 | Lady of the Lake |
| 1 | ResourceCapacity | 1000 | Lake's depths |
| 2 | XpGain | 600 | Ancient wisdom |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 74,
    name: *b"Nimue\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 1, // Defensive
    category: 1,  // Mythological
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 1, // London (Avalon)
    buffs: [
        BuffConfig { stat: 2, base_bps: 1400, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 9, base_bps: 1000, _reserved: [0; 2] },  // ResourceCapacity
        BuffConfig { stat: 4, base_bps: 600, _reserved: [0; 2] },   // XpGain
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Mordred

> *"The throne shall be mine."*

| Property | Value |
|----------|-------|
| **Template ID** | 75 |
| **Type** | Offensive |
| **Category** | Mythological |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | London (ID: 1) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1600 | Treacherous strike |
| 1 | CriticalHitChance | 1200 | Betrayer's edge |
| 2 | EncounterDamage | 600 | Dark ambition |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 75,
    name: *b"Mordred\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 1,  // Mythological
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 1, // London (Camelot)
    buffs: [
        BuffConfig { stat: 1, base_bps: 1600, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 7, base_bps: 1200, _reserved: [0; 2] },  // CriticalHitChance
        BuffConfig { stat: 14, base_bps: 600, _reserved: [0; 2] },  // EncounterDamage
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Gawain

> *"My strength waxes with the sun."*

| Property | Value |
|----------|-------|
| **Template ID** | 76 |
| **Type** | Defensive |
| **Category** | Mythological |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | London (ID: 1) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 1000 | Knight of the sun |
| 1 | StaminaRegen | 600 | Solar power |
| 2 | SynchronyBonus | 400 | Round table honor |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 76,
    name: *b"Gawain\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 1, // Defensive
    category: 1,  // Mythological
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 1, // London (Camelot)
    buffs: [
        BuffConfig { stat: 2, base_bps: 1000, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 11, base_bps: 600, _reserved: [0; 2] },  // StaminaRegen
        BuffConfig { stat: 8, base_bps: 400, _reserved: [0; 2] },   // SynchronyBonus
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Beowulf

> *"I shall gain glory or die."*

| Property | Value |
|----------|-------|
| **Template ID** | 77 |
| **Type** | Offensive |
| **Category** | Mythological |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Moscow (ID: 6) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1700 | Monster slayer |
| 1 | EncounterDamage | 1200 | Grendel's bane |
| 2 | DefensePower | 600 | Geatish might |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 77,
    name: *b"Beowulf\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 1,  // Mythological
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 6, // Moscow (Copenhagen)
    buffs: [
        BuffConfig { stat: 1, base_bps: 1700, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 14, base_bps: 1200, _reserved: [0; 2] }, // EncounterDamage
        BuffConfig { stat: 2, base_bps: 600, _reserved: [0; 2] },   // DefensePower
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### El Cid

> *"I was born in a fortunate hour."*

| Property | Value |
|----------|-------|
| **Template ID** | 78 |
| **Type** | Hybrid |
| **Category** | Historical |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Rome (ID: 3) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 800 | Castilian knight |
| 1 | DefensePower | 700 | Champion's honor |
| 2 | RallyCapacity | 500 | Lord of Valencia |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 78,
    name: *b"El Cid\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 3, // Hybrid
    category: 0,  // Historical
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 3, // Rome (Valencia)
    buffs: [
        BuffConfig { stat: 1, base_bps: 800, _reserved: [0; 2] },   // AttackPower
        BuffConfig { stat: 2, base_bps: 700, _reserved: [0; 2] },   // DefensePower
        BuffConfig { stat: 6, base_bps: 500, _reserved: [0; 2] },   // RallyCapacity
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Sinbad

> *"The sea calls to those who dare."*

| Property | Value |
|----------|-------|
| **Template ID** | 79 |
| **Type** | Economic |
| **Category** | Mythological |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Baghdad (ID: 16) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | CashCollectionRate | 1000 | Merchant voyager |
| 1 | LootBonus | 700 | Seven voyages |
| 2 | ResourceCapacity | 400 | Ship's hold |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 79,
    name: *b"Sinbad\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 1,  // Mythological
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 16, // Baghdad
    buffs: [
        BuffConfig { stat: 3, base_bps: 1000, _reserved: [0; 2] },  // CashCollectionRate
        BuffConfig { stat: 15, base_bps: 700, _reserved: [0; 2] },  // LootBonus
        BuffConfig { stat: 9, base_bps: 400, _reserved: [0; 2] },   // ResourceCapacity
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Scheherazade

> *"A thousand and one tales to save a life."*

| Property | Value |
|----------|-------|
| **Template ID** | 80 |
| **Type** | Economic |
| **Category** | Mythological |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Baghdad (ID: 16) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | XpGain | 1500 | Master storyteller |
| 1 | CashCollectionRate | 1000 | Tales of gold |
| 2 | SynchronyBonus | 600 | Captivating presence |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 80,
    name: *b"Scheherazade\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 1,  // Mythological
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 16, // Baghdad
    buffs: [
        BuffConfig { stat: 4, base_bps: 1500, _reserved: [0; 2] },  // XpGain
        BuffConfig { stat: 3, base_bps: 1000, _reserved: [0; 2] },  // CashCollectionRate
        BuffConfig { stat: 8, base_bps: 600, _reserved: [0; 2] },   // SynchronyBonus
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Baba Yaga

> *"Come in, child... if you dare."*

| Property | Value |
|----------|-------|
| **Template ID** | 81 |
| **Type** | Defensive |
| **Category** | Mythological |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Moscow (ID: 6) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 1600 | Iron-toothed witch |
| 1 | CriticalHitChance | 1000 | Cursed magic |
| 2 | EncounterDamage | 600 | Forest terror |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 81,
    name: *b"Baba Yaga\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 1, // Defensive
    category: 1,  // Mythological
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 6, // Moscow
    buffs: [
        BuffConfig { stat: 2, base_bps: 1600, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 7, base_bps: 1000, _reserved: [0; 2] },  // CriticalHitChance
        BuffConfig { stat: 14, base_bps: 600, _reserved: [0; 2] },  // EncounterDamage
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Koschei the Deathless

> *"My soul is hidden where none can find it."*

| Property | Value |
|----------|-------|
| **Template ID** | 82 |
| **Type** | Offensive |
| **Category** | Mythological |
| **Tier** | Legendary |
| **Mint Cost** | 5.0 SOL |
| **Supply Cap** | 100 |
| **Required Level** | 75 |
| **Meditation City** | Moscow (ID: 6) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 2000 | Deathless sorcerer |
| 1 | DefensePower | 1500 | Immortal body |
| 2 | CriticalHitChance | 1000 | Dark magic |
| 3 | EncounterDamage | 600 | Soul stealer |

```rust
HeroTemplate {
    template_id: 82,
    name: *b"Koschei the Deathless\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 1,  // Mythological
    mint_cost_sol: 5_000_000_000,
    supply_cap: 100,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 75,
    meditation_city_id: 6, // Moscow (Kiev)
    buffs: [
        BuffConfig { stat: 1, base_bps: 2000, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 2, base_bps: 1500, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 7, base_bps: 1000, _reserved: [0; 2] },  // CriticalHitChance
        BuffConfig { stat: 14, base_bps: 600, _reserved: [0; 2] },  // EncounterDamage
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Ilya Muromets

> *"I sat for thirty years, now I rise for Russia."*

| Property | Value |
|----------|-------|
| **Template ID** | 83 |
| **Type** | Defensive |
| **Category** | Mythological |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Moscow (ID: 6) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 1800 | Bogatyr champion |
| 1 | StaminaRegen | 1000 | Miraculous recovery |
| 2 | UnitCapacity | 600 | Folk hero |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 83,
    name: *b"Ilya Muromets\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 1, // Defensive
    category: 1,  // Mythological
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 6, // Moscow (Kiev)
    buffs: [
        BuffConfig { stat: 2, base_bps: 1800, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 11, base_bps: 1000, _reserved: [0; 2] }, // StaminaRegen
        BuffConfig { stat: 13, base_bps: 600, _reserved: [0; 2] },  // UnitCapacity
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Vasilisa the Wise

> *"Cleverness is worth more than strength."*

| Property | Value |
|----------|-------|
| **Template ID** | 84 |
| **Type** | Economic |
| **Category** | Mythological |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Moscow (ID: 6) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | CashCollectionRate | 1000 | Clever merchant |
| 1 | XpGain | 700 | Wise beyond years |
| 2 | TrainingCostReduction | 400 | Resourceful |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 84,
    name: *b"Vasilisa the Wise\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 1,  // Mythological
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 6, // Moscow
    buffs: [
        BuffConfig { stat: 3, base_bps: 1000, _reserved: [0; 2] },  // CashCollectionRate
        BuffConfig { stat: 4, base_bps: 700, _reserved: [0; 2] },   // XpGain
        BuffConfig { stat: 5, base_bps: 400, _reserved: [0; 2] },   // TrainingCostReduction
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Dobrynya Nikitich

> *"The dragon shall fall by my blade."*

| Property | Value |
|----------|-------|
| **Template ID** | 85 |
| **Type** | Hybrid |
| **Category** | Mythological |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Moscow (ID: 6) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1400 | Dragon slayer |
| 1 | DefensePower | 1000 | Bogatyr shield |
| 2 | EncounterDamage | 800 | Monster hunter |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 85,
    name: *b"Dobrynya Nikitich\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 3, // Hybrid
    category: 1,  // Mythological
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 6, // Moscow (Kiev)
    buffs: [
        BuffConfig { stat: 1, base_bps: 1400, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 2, base_bps: 1000, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 14, base_bps: 800, _reserved: [0; 2] },  // EncounterDamage
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Hua Mulan

> *"Who says women cannot be heroes?"*

| Property | Value |
|----------|-------|
| **Template ID** | 86 |
| **Type** | Hybrid |
| **Category** | Historical |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Beijing (ID: 10) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 800 | Warrior maiden |
| 1 | DefensePower | 700 | Disguised soldier |
| 2 | SynchronyBonus | 500 | Army's heart |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 86,
    name: *b"Hua Mulan\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 3, // Hybrid
    category: 0,  // Historical
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 10, // Beijing (Xi'an)
    buffs: [
        BuffConfig { stat: 1, base_bps: 800, _reserved: [0; 2] },   // AttackPower
        BuffConfig { stat: 2, base_bps: 700, _reserved: [0; 2] },   // DefensePower
        BuffConfig { stat: 8, base_bps: 500, _reserved: [0; 2] },   // SynchronyBonus
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Zhuge Liang

> *"The wise strategist wins before the battle begins."*

| Property | Value |
|----------|-------|
| **Template ID** | 87 |
| **Type** | Economic |
| **Category** | Historical |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Beijing (ID: 10) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | XpGain | 1500 | Sleeping dragon |
| 1 | CriticalHitChance | 1000 | Strategic genius |
| 2 | TrainingCostReduction | 700 | Efficient commander |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 87,
    name: *b"Zhuge Liang\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 0,  // Historical
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 10, // Beijing (Chengdu)
    buffs: [
        BuffConfig { stat: 4, base_bps: 1500, _reserved: [0; 2] },  // XpGain
        BuffConfig { stat: 7, base_bps: 1000, _reserved: [0; 2] },  // CriticalHitChance
        BuffConfig { stat: 5, base_bps: 700, _reserved: [0; 2] },   // TrainingCostReduction
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Tomoe Gozen

> *"A warrior worth a thousand men."*

| Property | Value |
|----------|-------|
| **Template ID** | 88 |
| **Type** | Defensive |
| **Category** | Historical |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Tokyo (ID: 9) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 1400 | Female samurai |
| 1 | AttackPower | 1000 | Mounted archer |
| 2 | ArmorEfficiency | 600 | Warrior's grace |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 88,
    name: *b"Tomoe Gozen\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 1, // Defensive
    category: 0,  // Historical
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 9, // Tokyo (Kyoto)
    buffs: [
        BuffConfig { stat: 2, base_bps: 1400, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 1, base_bps: 1000, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 16, base_bps: 600, _reserved: [0; 2] },  // ArmorEfficiency
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Aladdin

> *"A diamond in the rough."*

| Property | Value |
|----------|-------|
| **Template ID** | 89 |
| **Type** | Economic |
| **Category** | Mythological |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Dubai (ID: 15) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | LootBonus | 1000 | Lamp finder |
| 1 | CashCollectionRate | 700 | Three wishes |
| 2 | XpGain | 400 | Street wisdom |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 89,
    name: *b"Aladdin\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 1,  // Mythological
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 15, // Dubai (Agrabah)
    buffs: [
        BuffConfig { stat: 15, base_bps: 1000, _reserved: [0; 2] }, // LootBonus
        BuffConfig { stat: 3, base_bps: 700, _reserved: [0; 2] },   // CashCollectionRate
        BuffConfig { stat: 4, base_bps: 400, _reserved: [0; 2] },   // XpGain
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Ali Baba

> *"Open Sesame!"*

| Property | Value |
|----------|-------|
| **Template ID** | 90 |
| **Type** | Economic |
| **Category** | Mythological |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Baghdad (ID: 16) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | LootBonus | 1200 | Cave discoverer |
| 1 | ResourceCapacity | 600 | Forty thieves' treasure |
| 2 | CashCollectionRate | 400 | Humble woodcutter |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 90,
    name: *b"Ali Baba\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 1,  // Mythological
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 16, // Baghdad
    buffs: [
        BuffConfig { stat: 15, base_bps: 1200, _reserved: [0; 2] }, // LootBonus
        BuffConfig { stat: 9, base_bps: 600, _reserved: [0; 2] },   // ResourceCapacity
        BuffConfig { stat: 3, base_bps: 400, _reserved: [0; 2] },   // CashCollectionRate
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Rostam

> *"Seven labors I have conquered."*

| Property | Value |
|----------|-------|
| **Template ID** | 91 |
| **Type** | Offensive |
| **Category** | Mythological |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Baghdad (ID: 16) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1700 | Persian champion |
| 1 | EncounterDamage | 1100 | Demon slayer |
| 2 | StaminaRegen | 600 | Tireless warrior |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 91,
    name: *b"Rostam\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 1,  // Mythological
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 16, // Baghdad (Persepolis)
    buffs: [
        BuffConfig { stat: 1, base_bps: 1700, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 14, base_bps: 1100, _reserved: [0; 2] }, // EncounterDamage
        BuffConfig { stat: 11, base_bps: 600, _reserved: [0; 2] },  // StaminaRegen
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Shirin

> *"Love carves mountains."*

| Property | Value |
|----------|-------|
| **Template ID** | 92 |
| **Type** | Hybrid |
| **Category** | Mythological |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Baghdad (ID: 16) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 800 | Mountain princess |
| 1 | ProduceGeneration | 600 | Royal patron |
| 2 | XpGain | 500 | Persian wisdom |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 92,
    name: *b"Shirin\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 3, // Hybrid
    category: 1,  // Mythological
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 16, // Baghdad (Persepolis)
    buffs: [
        BuffConfig { stat: 2, base_bps: 800, _reserved: [0; 2] },   // DefensePower
        BuffConfig { stat: 12, base_bps: 600, _reserved: [0; 2] },  // ProduceGeneration
        BuffConfig { stat: 4, base_bps: 500, _reserved: [0; 2] },   // XpGain
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

## Crypto & Web3 Icons

### Satoshi Nakamoto

> *"Chancellor on brink of second bailout for banks."*

| Property | Value |
|----------|-------|
| **Template ID** | 150 |
| **Type** | Economic |
| **Category** | CryptoIcons |
| **Tier** | Mythic |
| **Mint Cost** | 2.1 SOL |
| **Supply Cap** | 21 |
| **Required Level** | 100 |
| **Meditation City** | Any (0) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | CashCollectionRate | 3000 | Digital gold |
| 1 | LootBonus | 2100 | Block rewards |
| 2 | ResourceCapacity | 1500 | UTXO accumulation |
| 3 | MiningAffinity | 2100 | Proof of Work pioneer |

```rust
HeroTemplate {
    template_id: 150,
    name: *b"Satoshi Nakamoto\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 2,  // CryptoIcons
    mint_cost_sol: 2_100_000_000,
    supply_cap: 21,
    minted_count: 0,
    enabled: true,
    event_exclusive: true,
    required_player_level: 100,
    meditation_city_id: 0, // Any city
    buffs: [
        BuffConfig { stat: 3, base_bps: 3000, _reserved: [0; 2] },  // CashCollectionRate
        BuffConfig { stat: 15, base_bps: 2100, _reserved: [0; 2] }, // LootBonus
        BuffConfig { stat: 9, base_bps: 1500, _reserved: [0; 2] },  // ResourceCapacity
        BuffConfig { stat: 17, base_bps: 2100, _reserved: [0; 2] }, // MiningAffinity
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Diamond Hands

> *"HODL."*

| Property | Value |
|----------|-------|
| **Template ID** | 151 |
| **Type** | Defensive |
| **Category** | CryptoIcons |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Any (0) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 1200 | Unshakeable conviction |
| 1 | ResourceCapacity | 800 | Never selling |
| 2 | StaminaRegen | 400 | Patient accumulator |
| 3 | MiningAffinity | 1000 | Diamonds from deep mining |

```rust
HeroTemplate {
    template_id: 151,
    name: *b"Diamond Hands\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 1, // Defensive
    category: 2,  // CryptoIcons
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 0, // Any city
    buffs: [
        BuffConfig { stat: 2, base_bps: 1200, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 9, base_bps: 800, _reserved: [0; 2] },   // ResourceCapacity
        BuffConfig { stat: 11, base_bps: 400, _reserved: [0; 2] },  // StaminaRegen
        BuffConfig { stat: 17, base_bps: 1000, _reserved: [0; 2] }, // MiningAffinity
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Pepe

> *"Feels good man."*

| Property | Value |
|----------|-------|
| **Template ID** | 152 |
| **Type** | Economic |
| **Category** | CryptoIcons |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Any (0) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | LootBonus | 1000 | Meme magic |
| 1 | CashCollectionRate | 700 | Viral wealth |
| 2 | XpGain | 500 | Community power |
| 3 | MiningAffinity | 800 | Meme coin mining |

```rust
HeroTemplate {
    template_id: 152,
    name: *b"Pepe\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 2,  // CryptoIcons
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 0, // Any city
    buffs: [
        BuffConfig { stat: 15, base_bps: 1000, _reserved: [0; 2] }, // LootBonus
        BuffConfig { stat: 3, base_bps: 700, _reserved: [0; 2] },   // CashCollectionRate
        BuffConfig { stat: 4, base_bps: 500, _reserved: [0; 2] },   // XpGain
        BuffConfig { stat: 17, base_bps: 800, _reserved: [0; 2] },  // MiningAffinity
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Bored Ape

> *"Ape together strong."*

| Property | Value |
|----------|-------|
| **Template ID** | 153 |
| **Type** | Economic |
| **Category** | CryptoIcons |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Any (0) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | CashCollectionRate | 1500 | Yacht club dividends |
| 1 | LootBonus | 1000 | NFT royalties |
| 2 | SynchronyBonus | 700 | Community strength |
| 3 | MiningAffinity | 1200 | ApeCoin mining rewards |

```rust
HeroTemplate {
    template_id: 153,
    name: *b"Bored Ape\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 2,  // CryptoIcons
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 0, // Any city
    buffs: [
        BuffConfig { stat: 3, base_bps: 1500, _reserved: [0; 2] },  // CashCollectionRate
        BuffConfig { stat: 15, base_bps: 1000, _reserved: [0; 2] }, // LootBonus
        BuffConfig { stat: 8, base_bps: 700, _reserved: [0; 2] },   // SynchronyBonus
        BuffConfig { stat: 17, base_bps: 1200, _reserved: [0; 2] }, // MiningAffinity
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Wojak

> *"I know that feel, bro."*

| Property | Value |
|----------|-------|
| **Template ID** | 154 |
| **Type** | Defensive |
| **Category** | CryptoIcons |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Any (0) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 1000 | Emotional resilience |
| 1 | StaminaRegen | 700 | Keeps going |
| 2 | SynchronyBonus | 500 | Shared feels |
| 3 | MiningAffinity | 600 | Mining through the pain |

```rust
HeroTemplate {
    template_id: 154,
    name: *b"Wojak\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 1, // Defensive
    category: 2,  // CryptoIcons
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 0, // Any city
    buffs: [
        BuffConfig { stat: 2, base_bps: 1000, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 11, base_bps: 700, _reserved: [0; 2] },  // StaminaRegen
        BuffConfig { stat: 8, base_bps: 500, _reserved: [0; 2] },   // SynchronyBonus
        BuffConfig { stat: 17, base_bps: 600, _reserved: [0; 2] },  // MiningAffinity
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Paper Hands

> *"Sell? I sold at the bottom."*

| Property | Value |
|----------|-------|
| **Template ID** | 155 |
| **Type** | Economic |
| **Category** | CryptoIcons |
| **Tier** | Common |
| **Mint Cost** | 0.05 SOL |
| **Supply Cap** | Unlimited |
| **Required Level** | 1 |
| **Meditation City** | Any (0) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | CashCollectionRate | 600 | Quick flips |
| 1 | TrainingCostReduction | 400 | Cut losses fast |
| 2 | MiningAffinity | 300 | Sells mined coins early |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 155,
    name: *b"Paper Hands\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 2,  // CryptoIcons
    mint_cost_sol: 50_000_000,
    supply_cap: 0, // Unlimited
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 1,
    meditation_city_id: 0, // Any city
    buffs: [
        BuffConfig { stat: 3, base_bps: 600, _reserved: [0; 2] },   // CashCollectionRate
        BuffConfig { stat: 5, base_bps: 400, _reserved: [0; 2] },   // TrainingCostReduction
        BuffConfig { stat: 17, base_bps: 300, _reserved: [0; 2] },  // MiningAffinity
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

## Original Game Heroes

### Theophilos the Builder

> *"An empire is built stone by stone."*

| Property | Value |
|----------|-------|
| **Template ID** | 200 |
| **Type** | Economic |
| **Category** | Original |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Istanbul (ID: 7) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | ProduceGeneration | 1000 | Master builder |
| 1 | CashCollectionRate | 800 | Trade magnate |
| 2 | ResourceCapacity | 600 | Imperial treasury |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 200,
    name: *b"Theophilos the Builder\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 4,  // Original
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 7, // Istanbul (Constantinople)
    buffs: [
        BuffConfig { stat: 12, base_bps: 1000, _reserved: [0; 2] }, // ProduceGeneration
        BuffConfig { stat: 3, base_bps: 800, _reserved: [0; 2] },   // CashCollectionRate
        BuffConfig { stat: 9, base_bps: 600, _reserved: [0; 2] },   // ResourceCapacity
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Kassandra the Oracle

> *"The future is written in the stars, for those who know how to read them."*

| Property | Value |
|----------|-------|
| **Template ID** | 201 |
| **Type** | Hybrid |
| **Category** | Original |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Athens (ID: 4) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | CriticalHitChance | 1400 | Prophetic visions |
| 1 | DefensePower | 1000 | Apollo's blessing |
| 2 | XpGain | 800 | Oracle's wisdom |
| 3 | LootBonus | 600 | Fate's favor |

```rust
HeroTemplate {
    template_id: 201,
    name: *b"Kassandra the Oracle\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 3, // Hybrid
    category: 4,  // Original
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 4, // Athens (Delphi)
    buffs: [
        BuffConfig { stat: 7, base_bps: 1400, _reserved: [0; 2] },  // CriticalHitChance
        BuffConfig { stat: 2, base_bps: 1000, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 4, base_bps: 800, _reserved: [0; 2] },   // XpGain
        BuffConfig { stat: 15, base_bps: 600, _reserved: [0; 2] },  // LootBonus
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Nikephoros Ironside

> *"None shall pass while I stand."*

| Property | Value |
|----------|-------|
| **Template ID** | 202 |
| **Type** | Defensive |
| **Category** | Original |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Istanbul (ID: 7) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 2000 | Unbreakable guardian |
| 1 | ArmorEfficiency | 1200 | Iron constitution |
| 2 | SynchronyBonus | 600 | Shield wall commander |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 202,
    name: *b"Nikephoros Ironside\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 1, // Defensive
    category: 4,  // Original
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 7, // Istanbul (Constantinople)
    buffs: [
        BuffConfig { stat: 2, base_bps: 2000, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 16, base_bps: 1200, _reserved: [0; 2] }, // ArmorEfficiency
        BuffConfig { stat: 8, base_bps: 600, _reserved: [0; 2] },   // SynchronyBonus
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Alexios Shadowblade

> *"You never see the blade that kills you."*

| Property | Value |
|----------|-------|
| **Template ID** | 203 |
| **Type** | Offensive |
| **Category** | Original |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Istanbul (ID: 7) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1600 | Silent death |
| 1 | CriticalHitChance | 1400 | Precision strikes |
| 2 | EncounterDamage | 800 | Ambush mastery |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 203,
    name: *b"Alexios Shadowblade\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 4,  // Original
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 7, // Istanbul (Constantinople)
    buffs: [
        BuffConfig { stat: 1, base_bps: 1600, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 7, base_bps: 1400, _reserved: [0; 2] },  // CriticalHitChance
        BuffConfig { stat: 14, base_bps: 800, _reserved: [0; 2] },  // EncounterDamage
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Chrysanthos the Golden

> *"Gold opens all doors."*

| Property | Value |
|----------|-------|
| **Template ID** | 204 |
| **Type** | Economic |
| **Category** | Original |
| **Tier** | Legendary |
| **Mint Cost** | 5.0 SOL |
| **Supply Cap** | 100 |
| **Required Level** | 75 |
| **Meditation City** | Istanbul (ID: 7) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | CashCollectionRate | 2200 | Merchant prince |
| 1 | ProduceGeneration | 1500 | Trade empire |
| 2 | ResourceCapacity | 1000 | Golden vaults |
| 3 | LootBonus | 600 | Bazaar connections |

```rust
HeroTemplate {
    template_id: 204,
    name: *b"Chrysanthos the Golden\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 4,  // Original
    mint_cost_sol: 5_000_000_000,
    supply_cap: 100,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 75,
    meditation_city_id: 7, // Istanbul (Constantinople)
    buffs: [
        BuffConfig { stat: 3, base_bps: 2200, _reserved: [0; 2] },  // CashCollectionRate
        BuffConfig { stat: 12, base_bps: 1500, _reserved: [0; 2] }, // ProduceGeneration
        BuffConfig { stat: 9, base_bps: 1000, _reserved: [0; 2] },  // ResourceCapacity
        BuffConfig { stat: 15, base_bps: 600, _reserved: [0; 2] },  // LootBonus
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Bjorn Ironforge

> *"My shield is my brother's life."*

| Property | Value |
|----------|-------|
| **Template ID** | 210 |
| **Type** | Defensive |
| **Category** | Original |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Moscow (ID: 6) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 1800 | Shield wall commander |
| 1 | ArmorEfficiency | 1000 | Iron constitution |
| 2 | SynchronyBonus | 600 | Nordic brotherhood |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 210,
    name: *b"Bjorn Ironforge\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 1, // Defensive
    category: 4,  // Original
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 6, // Moscow (Stockholm)
    buffs: [
        BuffConfig { stat: 2, base_bps: 1800, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 16, base_bps: 1000, _reserved: [0; 2] }, // ArmorEfficiency
        BuffConfig { stat: 8, base_bps: 600, _reserved: [0; 2] },   // SynchronyBonus
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Astrid Stormcaller

> *"The berserker knows no fear."*

| Property | Value |
|----------|-------|
| **Template ID** | 211 |
| **Type** | Offensive |
| **Category** | Original |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Moscow (ID: 6) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1800 | Berserker queen |
| 1 | CriticalHitChance | 1200 | Storm fury |
| 2 | StaminaRegen | 600 | Battle rage |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 211,
    name: *b"Astrid Stormcaller\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 4,  // Original
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 6, // Moscow (Oslo)
    buffs: [
        BuffConfig { stat: 1, base_bps: 1800, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 7, base_bps: 1200, _reserved: [0; 2] },  // CriticalHitChance
        BuffConfig { stat: 11, base_bps: 600, _reserved: [0; 2] },  // StaminaRegen
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Ragnar Bloodaxe

> *"Raid, plunder, repeat."*

| Property | Value |
|----------|-------|
| **Template ID** | 212 |
| **Type** | Offensive |
| **Category** | Original |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Moscow (ID: 6) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1000 | Raid master |
| 1 | LootBonus | 800 | Plunder expert |
| 2 | EncounterDamage | 500 | Viking fury |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 212,
    name: *b"Ragnar Bloodaxe\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 4,  // Original
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 6, // Moscow (Copenhagen)
    buffs: [
        BuffConfig { stat: 1, base_bps: 1000, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 15, base_bps: 800, _reserved: [0; 2] },  // LootBonus
        BuffConfig { stat: 14, base_bps: 500, _reserved: [0; 2] },  // EncounterDamage
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Maeve of Ulster

> *"A queen bows to no man."*

| Property | Value |
|----------|-------|
| **Template ID** | 220 |
| **Type** | Hybrid |
| **Category** | Original |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | London (ID: 1) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1400 | Warrior queen |
| 1 | RallyCapacity | 1000 | Queen's command |
| 2 | DefensePower | 700 | Celtic pride |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 220,
    name: *b"Maeve of Ulster\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 3, // Hybrid
    category: 4,  // Original
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 1, // London (Dublin)
    buffs: [
        BuffConfig { stat: 1, base_bps: 1400, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 6, base_bps: 1000, _reserved: [0; 2] },  // RallyCapacity
        BuffConfig { stat: 2, base_bps: 700, _reserved: [0; 2] },   // DefensePower
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Marcus Aurelius Maximus

> *"Wisdom guides the sword."*

| Property | Value |
|----------|-------|
| **Template ID** | 230 |
| **Type** | Hybrid |
| **Category** | Original |
| **Tier** | Legendary |
| **Mint Cost** | 5.0 SOL |
| **Supply Cap** | 100 |
| **Required Level** | 75 |
| **Meditation City** | Rome (ID: 3) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1800 | Philosopher warrior |
| 1 | DefensePower | 1500 | Stoic resolve |
| 2 | XpGain | 1200 | Meditations |
| 3 | TrainingCostReduction | 800 | Imperial academy |

```rust
HeroTemplate {
    template_id: 230,
    name: *b"Marcus Aurelius Maximus\0\0\0\0\0\0\0\0\0",
    hero_type: 3, // Hybrid
    category: 4,  // Original
    mint_cost_sol: 5_000_000_000,
    supply_cap: 100,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 75,
    meditation_city_id: 3, // Rome
    buffs: [
        BuffConfig { stat: 1, base_bps: 1800, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 2, base_bps: 1500, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 4, base_bps: 1200, _reserved: [0; 2] },  // XpGain
        BuffConfig { stat: 5, base_bps: 800, _reserved: [0; 2] },   // TrainingCostReduction
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Akira Steelblossom

> *"The way of the ronin is freedom."*

| Property | Value |
|----------|-------|
| **Template ID** | 240 |
| **Type** | Offensive |
| **Category** | Original |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Tokyo (ID: 9) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1600 | Ronin master |
| 1 | CriticalHitChance | 1200 | Perfect cut |
| 2 | WeaponEfficiency | 800 | Blade maintenance |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 240,
    name: *b"Akira Steelblossom\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 4,  // Original
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 9, // Tokyo
    buffs: [
        BuffConfig { stat: 1, base_bps: 1600, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 7, base_bps: 1200, _reserved: [0; 2] },  // CriticalHitChance
        BuffConfig { stat: 10, base_bps: 800, _reserved: [0; 2] },  // WeaponEfficiency
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Li Wei the Prosperous

> *"The Silk Road flows with gold."*

| Property | Value |
|----------|-------|
| **Template ID** | 241 |
| **Type** | Economic |
| **Category** | Original |
| **Tier** | Legendary |
| **Mint Cost** | 5.0 SOL |
| **Supply Cap** | 100 |
| **Required Level** | 75 |
| **Meditation City** | Beijing (ID: 10) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | CashCollectionRate | 2000 | Silk Road magnate |
| 1 | ProduceGeneration | 1400 | Trade networks |
| 2 | ResourceCapacity | 1000 | Imperial warehouses |
| 3 | LootBonus | 600 | Merchant connections |

```rust
HeroTemplate {
    template_id: 241,
    name: *b"Li Wei the Prosperous\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 4,  // Original
    mint_cost_sol: 5_000_000_000,
    supply_cap: 100,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 75,
    meditation_city_id: 10, // Beijing (Xi'an)
    buffs: [
        BuffConfig { stat: 3, base_bps: 2000, _reserved: [0; 2] },  // CashCollectionRate
        BuffConfig { stat: 12, base_bps: 1400, _reserved: [0; 2] }, // ProduceGeneration
        BuffConfig { stat: 9, base_bps: 1000, _reserved: [0; 2] },  // ResourceCapacity
        BuffConfig { stat: 15, base_bps: 600, _reserved: [0; 2] },  // LootBonus
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Khalid the Warrior

> *"In the name of God, we conquer."*

| Property | Value |
|----------|-------|
| **Template ID** | 250 |
| **Type** | Offensive |
| **Category** | Original |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Dubai (ID: 15) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1800 | Arabian conqueror |
| 1 | RallyCapacity | 1200 | Desert commander |
| 2 | EncounterDamage | 800 | Sword of God |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 250,
    name: *b"Khalid the Warrior\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 4,  // Original
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 15, // Dubai (Mecca)
    buffs: [
        BuffConfig { stat: 1, base_bps: 1800, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 6, base_bps: 1200, _reserved: [0; 2] },  // RallyCapacity
        BuffConfig { stat: 14, base_bps: 800, _reserved: [0; 2] },  // EncounterDamage
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Rashid the Defender

> *"None shall pass the gates."*

| Property | Value |
|----------|-------|
| **Template ID** | 251 |
| **Type** | Defensive |
| **Category** | Original |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Baghdad (ID: 16) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 1800 | Gate keeper |
| 1 | ArmorEfficiency | 1200 | Damascus steel |
| 2 | SynchronyBonus | 600 | Garrison commander |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 251,
    name: *b"Rashid the Defender\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 1, // Defensive
    category: 4,  // Original
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 16, // Baghdad (Damascus)
    buffs: [
        BuffConfig { stat: 2, base_bps: 1800, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 16, base_bps: 1200, _reserved: [0; 2] }, // ArmorEfficiency
        BuffConfig { stat: 8, base_bps: 600, _reserved: [0; 2] },   // SynchronyBonus
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Omar the Orator

> *"Words can move mountains."*

| Property | Value |
|----------|-------|
| **Template ID** | 252 |
| **Type** | Hybrid |
| **Category** | Original |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Baghdad (ID: 16) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | SynchronyBonus | 1000 | Inspiring speech |
| 1 | RallyCapacity | 700 | Caliphate command |
| 2 | XpGain | 500 | Scholarly wisdom |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 252,
    name: *b"Omar the Orator\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 3, // Hybrid
    category: 4,  // Original
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 16, // Baghdad
    buffs: [
        BuffConfig { stat: 8, base_bps: 1000, _reserved: [0; 2] },  // SynchronyBonus
        BuffConfig { stat: 6, base_bps: 700, _reserved: [0; 2] },   // RallyCapacity
        BuffConfig { stat: 4, base_bps: 500, _reserved: [0; 2] },   // XpGain
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Zara Moonblade

> *"The desert night hides many secrets."*

| Property | Value |
|----------|-------|
| **Template ID** | 260 |
| **Type** | Offensive |
| **Category** | Original |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Cairo (ID: 8) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 1500 | Desert assassin |
| 1 | CriticalHitChance | 1200 | Silent strike |
| 2 | EncounterDamage | 800 | Shadow blade |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 260,
    name: *b"Zara Moonblade\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 4,  // Original
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 8, // Cairo
    buffs: [
        BuffConfig { stat: 1, base_bps: 1500, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 7, base_bps: 1200, _reserved: [0; 2] },  // CriticalHitChance
        BuffConfig { stat: 14, base_bps: 800, _reserved: [0; 2] },  // EncounterDamage
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Layla Goldweaver

> *"The bazaar is my kingdom."*

| Property | Value |
|----------|-------|
| **Template ID** | 261 |
| **Type** | Economic |
| **Category** | Original |
| **Tier** | Rare |
| **Mint Cost** | 0.25 SOL |
| **Supply Cap** | 10,000 |
| **Required Level** | 25 |
| **Meditation City** | Cairo (ID: 8) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | CashCollectionRate | 1100 | Bazaar queen |
| 1 | ProduceGeneration | 700 | Textile trade |
| 2 | ResourceCapacity | 400 | Market connections |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 261,
    name: *b"Layla Goldweaver\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 4,  // Original
    mint_cost_sol: 250_000_000,
    supply_cap: 10_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 25,
    meditation_city_id: 8, // Cairo
    buffs: [
        BuffConfig { stat: 3, base_bps: 1100, _reserved: [0; 2] },  // CashCollectionRate
        BuffConfig { stat: 12, base_bps: 700, _reserved: [0; 2] },  // ProduceGeneration
        BuffConfig { stat: 9, base_bps: 400, _reserved: [0; 2] },   // ResourceCapacity
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Vladimir Ironheart

> *"Mother Russia's guardian."*

| Property | Value |
|----------|-------|
| **Template ID** | 270 |
| **Type** | Defensive |
| **Category** | Original |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Moscow (ID: 6) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 1700 | Boyar protector |
| 1 | StaminaRegen | 1000 | Winter endurance |
| 2 | ArmorEfficiency | 700 | Russian steel |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 270,
    name: *b"Vladimir Ironheart\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 1, // Defensive
    category: 4,  // Original
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 6, // Moscow
    buffs: [
        BuffConfig { stat: 2, base_bps: 1700, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 11, base_bps: 1000, _reserved: [0; 2] }, // StaminaRegen
        BuffConfig { stat: 16, base_bps: 700, _reserved: [0; 2] },  // ArmorEfficiency
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Boris the Mountain

> *"I am immovable."*

| Property | Value |
|----------|-------|
| **Template ID** | 271 |
| **Type** | Defensive |
| **Category** | Original |
| **Tier** | Legendary |
| **Mint Cost** | 5.0 SOL |
| **Supply Cap** | 100 |
| **Required Level** | 75 |
| **Meditation City** | Moscow (ID: 6) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 2500 | Immovable guardian |
| 1 | ArmorEfficiency | 1500 | Mountain constitution |
| 2 | UnitCapacity | 1000 | Bear strength |
| 3 | StaminaRegen | 600 | Endless endurance |

```rust
HeroTemplate {
    template_id: 271,
    name: *b"Boris the Mountain\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 1, // Defensive
    category: 4,  // Original
    mint_cost_sol: 5_000_000_000,
    supply_cap: 100,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 75,
    meditation_city_id: 6, // Moscow
    buffs: [
        BuffConfig { stat: 2, base_bps: 2500, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 16, base_bps: 1500, _reserved: [0; 2] }, // ArmorEfficiency
        BuffConfig { stat: 13, base_bps: 1000, _reserved: [0; 2] }, // UnitCapacity
        BuffConfig { stat: 11, base_bps: 600, _reserved: [0; 2] },  // StaminaRegen
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Durin Ironpick

> *"Deep in the mountain's heart, where the earth yields its treasures."*

| Property | Value |
|----------|-------|
| **Template ID** | 280 |
| **Type** | Economic |
| **Category** | Original |
| **Tier** | Epic |
| **Mint Cost** | 1.0 SOL |
| **Supply Cap** | 1,000 |
| **Required Level** | 50 |
| **Meditation City** | Any (0) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | MiningAffinity | 2000 | Master of the deep mines |
| 1 | ResourceCapacity | 1200 | Gem hoarder |
| 2 | DefensePower | 800 | Mountain-forged resilience |
| 3 | StaminaRegen | 500 | Tireless miner |

```rust
HeroTemplate {
    template_id: 280,
    name: *b"Durin Ironpick\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 4,  // Original
    mint_cost_sol: 1_000_000_000,
    supply_cap: 1_000,
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 50,
    meditation_city_id: 0, // Any city
    buffs: [
        BuffConfig { stat: 17, base_bps: 2000, _reserved: [0; 2] }, // MiningAffinity
        BuffConfig { stat: 9, base_bps: 1200, _reserved: [0; 2] },  // ResourceCapacity
        BuffConfig { stat: 2, base_bps: 800, _reserved: [0; 2] },   // DefensePower
        BuffConfig { stat: 11, base_bps: 500, _reserved: [0; 2] },  // StaminaRegen
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

## Common Starter Heroes

### Roman Centurion

> *"For Rome!"*

| Property | Value |
|----------|-------|
| **Template ID** | 1 |
| **Type** | Defensive |
| **Category** | Historical |
| **Tier** | Common |
| **Mint Cost** | 0.05 SOL |
| **Supply Cap** | Unlimited |
| **Required Level** | 1 |
| **Meditation City** | Rome (ID: 3) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | DefensePower | 500 | Roman discipline |
| 1 | UnitCapacity | 300 | Legion commander |
| 2 | - | - | - |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 1,
    name: *b"Roman Centurion\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 1, // Defensive
    category: 0,  // Historical
    mint_cost_sol: 50_000_000,
    supply_cap: 0, // Unlimited
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 1,
    meditation_city_id: 3, // Rome
    buffs: [
        BuffConfig { stat: 2, base_bps: 500, _reserved: [0; 2] },  // DefensePower
        BuffConfig { stat: 13, base_bps: 300, _reserved: [0; 2] }, // UnitCapacity
        BuffConfig::NONE,
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Viking Raider

> *"Valhalla awaits!"*

| Property | Value |
|----------|-------|
| **Template ID** | 2 |
| **Type** | Offensive |
| **Category** | Historical |
| **Tier** | Common |
| **Mint Cost** | 0.05 SOL |
| **Supply Cap** | Unlimited |
| **Required Level** | 1 |
| **Meditation City** | Moscow (ID: 6) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | AttackPower | 500 | Berserker rage |
| 1 | LootBonus | 300 | Plunderer |
| 2 | - | - | - |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 2,
    name: *b"Viking Raider\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 0, // Offensive
    category: 0,  // Historical
    mint_cost_sol: 50_000_000,
    supply_cap: 0, // Unlimited
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 1,
    meditation_city_id: 6, // Moscow (Copenhagen)
    buffs: [
        BuffConfig { stat: 1, base_bps: 500, _reserved: [0; 2] },  // AttackPower
        BuffConfig { stat: 15, base_bps: 300, _reserved: [0; 2] }, // LootBonus
        BuffConfig::NONE,
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

### Silk Road Merchant

> *"Every trade tells a story."*

| Property | Value |
|----------|-------|
| **Template ID** | 3 |
| **Type** | Economic |
| **Category** | Historical |
| **Tier** | Common |
| **Mint Cost** | 0.05 SOL |
| **Supply Cap** | Unlimited |
| **Required Level** | 1 |
| **Meditation City** | Beijing (ID: 10) |

**Buffs:**
| Slot | Stat | Base BPS | Description |
|------|------|----------|-------------|
| 0 | CashCollectionRate | 500 | Trade routes |
| 1 | ResourceCapacity | 300 | Camel caravans |
| 2 | - | - | - |
| 3 | - | - | - |

```rust
HeroTemplate {
    template_id: 3,
    name: *b"Silk Road Merchant\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    hero_type: 2, // Economic
    category: 0,  // Historical
    mint_cost_sol: 50_000_000,
    supply_cap: 0, // Unlimited
    minted_count: 0,
    enabled: true,
    event_exclusive: false,
    required_player_level: 1,
    meditation_city_id: 10, // Beijing (Xi'an)
    buffs: [
        BuffConfig { stat: 3, base_bps: 500, _reserved: [0; 2] },  // CashCollectionRate
        BuffConfig { stat: 9, base_bps: 300, _reserved: [0; 2] },  // ResourceCapacity
        BuffConfig::NONE,
        BuffConfig::NONE,
    ],
    bump: 0,
    _padding: [0; 3],
}
```

---

## City Reference Table

All heroes meditate in modern cities (IDs 1-24). Historical/mythological origins shown in parentheses.

| City ID | City Name | Notable Heroes (Origin) |
|---------|-----------|-------------------------|
| 0 | Any | Satoshi Nakamoto, Diamond Hands, Pepe, Bored Ape, Wojak, Paper Hands |
| 1 | London | Robin Hood (Nottingham), Merlin (Camelot), William Wallace (Edinburgh), Nimue (Avalon), Mordred (Camelot), Gawain (Camelot), Maeve (Dublin) |
| 2 | Paris | Napoleon, Joan of Arc (Orleans), El Cid (Burgos) |
| 3 | Rome | Caesar, Roman Centurion, Marcus Aurelius Maximus |
| 4 | Athens | Alexander (Pella), Leonidas (Sparta), Athena, Ares (Sparta), Zeus (Olympus), Poseidon (Atlantis), Kassandra (Delphi), Prometheus (Mount Caucasus) |
| 6 | Moscow | Odin (Uppsala), Thor (Asgard), Viking Raider (Copenhagen), Attila (Pannonia), Beowulf (Geatland), Baba Yaga, Koschei, Ilya Muromets (Murom), Vasilisa, Dobrynya (Kiev), Bjorn, Astrid, Ragnar, Vladimir, Boris |
| 7 | Istanbul | Theophilos (Constantinople), Nikephoros, Alexios, Heraclius (Constantinople), Chrysanthos |
| 8 | Cairo | Cleopatra (Alexandria), Hannibal (Carthage), Ra (Heliopolis), Anubis (Memphis) |
| 9 | Tokyo | Musashi (Kyoto), Tomoe Gozen (Kyoto), Amaterasu (Takamagahara), Akira |
| 10 | Beijing | Genghis Khan (Karakorum), Sun Tzu (Suzhou), Silk Road Merchant (Xi'an), Hua Mulan, Zhuge Liang, Li Wei |
| 11 | Shanghai | Sun Wukong (Flower Fruit Mountain) |
| 15 | Dubai | Khalid (Mecca), Rashid (Mecca), Omar (Medina) |
| 16 | Baghdad | Gilgamesh (Uruk), Sinbad, Scheherazade, Aladdin, Ali Baba |
| 17 | Tehran | Rostam (Sistan), Shirin (Ctesiphon) |
| 18 | Mexico City | Quetzalcoatl (Tenochtitlan) |
| 22 | Lagos | Zara, Layla |

---

## Template Creation Checklist

When creating a new hero template:

1. **Assign Template ID** - Sequential, grouped by category
2. **Choose Name** - Max 32 bytes, null-padded
3. **Set Type** - Offensive (0), Defensive (1), Economic (2), Hybrid (3)
4. **Set Category** - Historical (0), Mythological (1), CryptoIcons (2), Gaming (3), Original (4)
5. **Configure Minting**
   - `mint_cost_sol` in lamports
   - `supply_cap` (0 = unlimited)
   - `required_player_level`
   - `event_exclusive` flag
6. **Set Meditation City** - 0 for any, or specific city ID
7. **Configure Buffs** (up to 4)
   - Choose stat ID
   - Set base_bps based on tier
   - Balance total power with tier expectations

### Recommended Base BPS by Tier

| Tier | Primary Buff | Secondary Buff | Tertiary Buff | Quaternary Buff |
|------|--------------|----------------|---------------|-----------------|
| Common | 400-500 | 200-300 | - | - |
| Uncommon | 600-800 | 400-500 | 200-300 | - |
| Rare | 800-1200 | 500-800 | 300-500 | - |
| Epic | 1400-2000 | 800-1200 | 500-800 | 300-500 |
| Legendary | 2000-2500 | 1200-1500 | 800-1000 | 500-800 |
| Mythic | 2500-3500 | 1500-2100 | 1000-1500 | - |

---

## Power Calculation Example

**Alexander the Great at Level 25:**

```
Buff 0: AttackPower (1000 base) × (√φ)^25 = 1000 × 166.8 = 166,800 bps
Buff 1: RallyCapacity (500 base) × (√φ)^25 = 500 × 166.8 = 83,400 bps
Buff 2: XpGain (300 base) × (√φ)^25 = 300 × 166.8 = 50,040 bps

Weighted Power:
= (166,800 × 10000 + 83,400 × 7500 + 50,040 × 4500) / 10000
= (1,668,000,000 + 625,500,000 + 225,180,000) / 10000
= 251,868 power
```

This deterministic system ensures every hero of the same template at the same level has identical stats.
