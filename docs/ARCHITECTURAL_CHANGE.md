# Architectural Change

> *Comprehensive System Redesign for Novus Mundus*

---

## Overview

This document outlines comprehensive architectural improvements to Novus Mundus, covering:

1. **Resizable Account Architecture** - Progressive unlocking via `realloc()`
2. **Shop System** - Equipment variety, consumables, materials, bundles, deals
3. **Game Systems Redesign** - Teams, encounters, cities, loot, research, rallies, heroes
4. **Leaderboard Architecture** - Event, general, and team leaderboards
5. **Extensibility Patterns** - Future-proof design

The core principle: **pay for what you use**. New players start with minimal rent (~0.0011 SOL), and accounts grow as features unlock.

```
                    ╔═══════════════════════════════════════╗
                    ║           NOVUS SHOP                  ║
                    ║   "Fortune favors the prepared"       ║
                    ╠═══════════════════════════════════════╣
                    ║                                       ║
                    ║   ┌─────────┐  ┌─────────┐           ║
                    ║   │EQUIPMENT│  │CONSUMABL│           ║
                    ║   │   ⚔️    │  │   🧪    │           ║
                    ║   └─────────┘  └─────────┘           ║
                    ║                                       ║
                    ║   ┌─────────┐  ┌─────────┐           ║
                    ║   │MATERIALS│  │COSMETICS│           ║
                    ║   │   🔧    │  │   ✨    │           ║
                    ║   └─────────┘  └─────────┘           ║
                    ║                                       ║
                    ║   ┌─────────┐  ┌─────────┐           ║
                    ║   │ BUNDLES │  │  DEALS  │           ║
                    ║   │   📦    │  │   🔥    │           ║
                    ║   └─────────┘  └─────────┘           ║
                    ║                                       ║
                    ╚═══════════════════════════════════════╝
```

---

## Table of Contents

### Part I: Account Architecture & Shop
1. [Account Architecture](#account-architecture)
2. [Core Currencies](#core-currencies)
3. [Equipment System](#equipment-system)
4. [Consumables](#consumables)
5. [Materials & Crafting](#materials--crafting)
6. [Inventory System](#inventory-system)
7. [Shop Categories](#shop-categories)
8. [Time-Based Sales](#time-based-sales)
9. [Bundle System](#bundle-system)
10. [Discount Mechanics](#discount-mechanics)
11. [DAO Promotions](#dao-promotions)
12. [Loyalty & Milestones](#loyalty--milestones)
13. [Cosmetics](#cosmetics)
14. [Technical Architecture](#technical-architecture)
15. [Extensibility](#extensibility)

### Part II: Game Systems
16. [Existing Systems - Status](#existing-systems---status)
17. [Optional Future Enhancements](#optional-future-enhancements)

### Part III: Leaderboards
18. [Leaderboard Architecture](#leaderboard-architecture)
19. [Event Leaderboards](#event-leaderboards)
20. [General Leaderboards](#general-leaderboards)
21. [Team Leaderboards](#team-leaderboards)

### Part IV: Future Extensibility
22. [System Integration Patterns](#system-integration-patterns)

### Part V: Strategic Combat System
23. [Unit Role Definitions](#unit-role-definitions)
24. [Attack Power Formula](#attack-power-formula)
25. [Defense Power Formula](#defense-power-formula)
26. [Deployment System](#deployment-system)
27. [Reinforcement System](#reinforcement-system)
28. [New Battle Research Nodes](#new-battle-research-nodes)
29. [Time-Based Combat Modifiers](#time-based-combat-modifiers)

---

## Account Architecture

The player account uses a **resizable architecture** where sections unlock progressively. This keeps rent costs low for new players while enabling rich features for engaged players.

### Section Unlock Flow

```
┌─────────────────────────────────────────────────────────────────┐
│              PROGRESSIVE ACCOUNT UNLOCKING                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ CORE (Always Present) ~450 bytes        Rent: 0.0011 SOL│    │
│  │ • Identity, Location, Locked NOVI                       │    │
│  │ • Units (6 types), Basic Equipment                      │    │
│  │ • Level, XP, Reputation, Networth                       │    │
│  │ • Subscription, Stamina, Stats                          │    │
│  │ • Gems, Fragments                                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                           │                                     │
│              ┌────────────┴────────────┐                        │
│              │     ACTION TRIGGERS     │                        │
│              └────────────┬────────────┘                        │
│                           │                                     │
│    ┌──────────────────────┼──────────────────────┐              │
│    │                      │                      │              │
│    ▼                      ▼                      ▼              │
│ ┌────────────┐     ┌────────────┐     ┌────────────┐           │
│ │  RESEARCH  │     │   HEROES   │     │ INVENTORY  │           │
│ │  +100 bytes│     │  +130 bytes│     │ +400 bytes │           │
│ │            │     │            │     │            │           │
│ │ Trigger:   │     │ Trigger:   │     │ Trigger:   │           │
│ │ Start 1st  │     │ Lock 1st   │     │ 1st Shop   │           │
│ │ research   │     │ hero       │     │ purchase   │           │
│ └────────────┘     └────────────┘     └────────────┘           │
│                                                                 │
│    ┌──────────────────────┬──────────────────────┐              │
│    │                      │                      │              │
│    ▼                      ▼                      ▼              │
│ ┌────────────┐     ┌────────────┐     ┌────────────┐           │
│ │   RALLY    │     │    TEAM    │     │ COSMETICS  │           │
│ │  +80 bytes │     │  +60 bytes │     │  +80 bytes │           │
│ │            │     │            │     │            │           │
│ │ Trigger:   │     │ Trigger:   │     │ Trigger:   │           │
│ │ Join 1st   │     │ Join/Create│     │ 1st cosmetic│          │
│ │ rally      │     │ team       │     │ purchase   │           │
│ └────────────┘     └────────────┘     └────────────┘           │
│                                                                 │
│  FULL ACCOUNT: ~1300 bytes                     Rent: 0.0032 SOL │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Extension Flags

```rust
// Bit flags in PlayerCore.extensions
pub const EXT_RESEARCH: u32   = 1 << 0;  // 0x0001 - Research buffs & unlocks
pub const EXT_HEROES: u32     = 1 << 1;  // 0x0002 - Hero slots & buffs
pub const EXT_INVENTORY: u32  = 1 << 2;  // 0x0004 - Inventory + Shop state
pub const EXT_RALLY: u32      = 1 << 3;  // 0x0008 - Rally caps & stats
pub const EXT_TEAM: u32       = 1 << 4;  // 0x0010 - Team membership
pub const EXT_COSMETICS: u32  = 1 << 5;  // 0x0020 - Equipped cosmetics

// Reserved for future extensions
pub const EXT_RESERVED_1: u32 = 1 << 6;  // 0x0040
pub const EXT_RESERVED_2: u32 = 1 << 7;  // 0x0080
pub const EXT_RESERVED_3: u32 = 1 << 8;  // 0x0100
// ... up to 32 possible extensions
```

### ⚠️ Extension Ordering Requirement (User Journey)

**Extensions MUST be unlocked sequentially.** The account layout uses fixed offsets, meaning each section occupies a specific byte range. Unlocking a later section requires all preceding sections to exist (even if unused).

```
┌─────────────────────────────────────────────────────────────────┐
│              MANDATORY USER JOURNEY                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Player Creation                                                │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ CORE (450 bytes) - Always created at initialization │        │
│  └─────────────────────────────────────────────────────┘        │
│       │                                                         │
│       │ First research started OR first hero locked             │
│       │ OR first shop purchase                                  │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ + RESEARCH (100 bytes) - Must exist before Heroes   │        │
│  └─────────────────────────────────────────────────────┘        │
│       │                                                         │
│       ▼ (Automatic if Research exists)                          │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ + HEROES (130 bytes) - Must exist before Inventory  │        │
│  └─────────────────────────────────────────────────────┘        │
│       │                                                         │
│       ▼ (Automatic if Heroes exists)                            │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ + INVENTORY (400 bytes) - Must exist before Rally   │        │
│  └─────────────────────────────────────────────────────┘        │
│       │                                                         │
│       │ First rally joined                                      │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ + RALLY (80 bytes) - Must exist before Team         │        │
│  └─────────────────────────────────────────────────────┘        │
│       │                                                         │
│       │ Joined or created a team                                │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ + TEAM (60 bytes) - Must exist before Cosmetics     │        │
│  └─────────────────────────────────────────────────────┘        │
│       │                                                         │
│       │ First cosmetic purchase                                 │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ + COSMETICS (80 bytes) - Final section              │        │
│  └─────────────────────────────────────────────────────┘        │
│                                                                 │
│  This ensures O(1) access via fixed offsets:                    │
│  • Research always at byte 450                                  │
│  • Heroes always at byte 550                                    │
│  • Inventory always at byte 680                                 │
│  • etc.                                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Why this matters:**
- Without fixed offsets, we'd need variable-length encoding (slower, more complex)
- Sparse extensions would require offset tables (extra storage overhead)
- Sequential unlocking aligns with natural player progression anyway
- The rent cost for "unused" sections is minimal (~0.0003 SOL per section)

### Rent Comparison

| Player Type | Section(s) | Size | Rent Cost |
|-------------|------------|------|-----------|
| New Player | Core only | 450 bytes | 0.0011 SOL |
| Researcher | + Research | 550 bytes | 0.0014 SOL |
| Hero User | + Heroes | 680 bytes | 0.0017 SOL |
| Shopper | + Inventory | 1080 bytes | 0.0027 SOL |
| Team Player | + Rally + Team | 1220 bytes | 0.0030 SOL |
| Full Unlock | All sections | 1300 bytes | 0.0032 SOL |

---

## Core Currencies

| Currency | Source | Shop Usage | Withdrawable | Stored In |
|----------|--------|------------|--------------|-----------|
| **SOL** | Wallet | **PRIMARY** - All shop purchases | Yes | Wallet |
| **Locked NOVI** | Subscription, gameplay | Small consumables, speed-ups | No | Core |
| **Cash** | Collection, PvP | In-game economy (not shop) | No | Core |
| **Gems** | Mining, research | Speed-ups, hero upgrades | No | Core |
| **Fragments** | Encounters | Hero leveling | No | Core |

### Payment Philosophy

```
┌─────────────────────────────────────────────────────────────────┐
│                    PAYMENT HIERARCHY                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SOL = PRIMARY PAYMENT (Real Value)                             │
│  ───────────────────────────────────────────────────────────── │
│  • Equipment (melee, ranged, siege, armor, vehicles)           │
│  • Bundles (all types)                                         │
│  • Cosmetics (all categories)                                  │
│  • Subscriptions                                                │
│  • Premium consumables (XP boosters, loot boosters)            │
│                                                                 │
│  NOVI = SECONDARY PAYMENT (Gameplay Currency)                   │
│  ───────────────────────────────────────────────────────────── │
│  • Basic consumables (stamina potions, small buffs)            │
│  • Materials (crafting ingredients)                            │
│  • Research speed-ups (alternative to gems)                    │
│  • Travel costs (reinforcements)                               │
│                                                                 │
│  Why SOL-Primary?                                               │
│  • Real revenue for treasury/DAO                               │
│  • Sustainable game economy                                    │
│  • NOVI remains valuable as gameplay fuel                      │
│  • Prevents inflation from farmed NOVI                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Currency Flow

```
                         ┌──────────────────────────────────────┐
                         │            SOL (Primary)             │
                         │         Player's Wallet              │
                         └──────────────────┬───────────────────┘
                                            │
              ┌─────────────────────────────┼─────────────────────────────┐
              │                             │                             │
              ▼                             ▼                             ▼
    ┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
    │  Subscription   │          │  Shop Purchase  │          │    Cosmetics    │
    │   (SOL → DAO)   │          │   (SOL → DAO)   │          │   (SOL → DAO)   │
    └────────┬────────┘          └────────┬────────┘          └─────────────────┘
             │                            │
             │ Generates                  │ Credits
             ▼                            ▼
    ┌─────────────────┐          ┌─────────────────┐
    │  Locked NOVI    │          │   Equipment     │
    │ (Core.locked)   │          │   Inventory     │
    └────────┬────────┘          └─────────────────┘
             │
             │ Can spend on:
             ▼
    ┌─────────────────────────────────────────────┐
    │  NOVI Purchases (Secondary)                 │
    │  • Basic consumables                        │
    │  • Materials                                │
    │  • Travel costs                             │
    │  • Research speed-ups                       │
    └─────────────────────────────────────────────┘
             │
             ▼
    ┌─────────────────┐
    │     BURNED      │
    │  (Deflationary) │
    └─────────────────┘

    ┌─────────────────────────────────────────────────────────────────┐
    │  SOL → Treasury (DAO controls)                                  │
    │  NOVI → Burned (deflationary pressure)                          │
    │  Result: Sustainable economy with real revenue                  │
    └─────────────────────────────────────────────────────────────────┘
```

---

## Equipment System

Equipment now has **variety** instead of generic counts. Each type provides different strategic advantages.

### Equipment Types

```
┌─────────────────────────────────────────────────────────────────┐
│                    EQUIPMENT CATEGORIES                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  OFFENSIVE EQUIPMENT                                            │
│  ──────────────────────────────────────────────────────────────│
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   MELEE     │  │   RANGED    │  │   SIEGE     │             │
│  │    ⚔️       │  │    🏹       │  │    💣       │             │
│  │             │  │             │  │             │             │
│  │ +10% vs     │  │ +10% base   │  │ +15% vs     │             │
│  │ defenders   │  │ attack      │  │ encounters  │             │
│  │             │  │             │  │             │             │
│  │ Best for:   │  │ Best for:   │  │ Best for:   │             │
│  │ PvP raids   │  │ All-around  │  │ PvE farming │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
│  DEFENSIVE EQUIPMENT                                            │
│  ──────────────────────────────────────────────────────────────│
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   ARMOR     │  │   PRODUCE   │  │  VEHICLES   │             │
│  │    🛡️       │  │    🍖       │  │    🚗       │             │
│  │             │  │             │  │             │             │
│  │ +10% base   │  │ Unit food   │  │ +25% drive- │             │
│  │ defense     │  │ (happiness) │  │ by damage   │             │
│  │             │  │             │  │             │             │
│  │ Best for:   │  │ Required:   │  │ Best for:   │             │
│  │ Tank builds │  │ All builds  │  │ Hit & run   │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Equipment Stats (Core Storage)

```rust
// In PlayerCore - basic equipment counts
pub melee_weapons: u32,     // Swords, axes, clubs (theme-dependent)
pub ranged_weapons: u32,    // Bows, guns, cannons (theme-dependent)
pub siege_weapons: u32,     // Catapults, tanks (theme-dependent)
pub armor_pieces: u32,      // Shields, vests (theme-dependent)
pub produce: u32,           // Food, supplies (unit maintenance)
pub vehicles: u32,          // Transport (drive-by attacks)
```

### Equipped Items (Inventory Section)

Players can equip **special items** with bonus stats:

```
┌─────────────────────────────────────────────────────────────────┐
│                    EQUIPPED ITEMS                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  WEAPON SLOT        ARMOR SLOT         ACCESSORY SLOT          │
│  ┌───────────┐      ┌───────────┐      ┌───────────┐           │
│  │ Legendary │      │   Epic    │      │   Rare    │           │
│  │ Flame     │      │ Dragon    │      │ Lucky     │           │
│  │ Sword     │      │ Scale     │      │ Charm     │           │
│  │           │      │           │      │           │           │
│  │ +25% ATK  │      │ +18% DEF  │      │ +12% LOOT │           │
│  │           │      │           │      │           │           │
│  │ ID: 47291 │      │ ID: 38104 │      │ ID: 19847 │           │
│  └───────────┘      └───────────┘      └───────────┘           │
│                                                                 │
│  Total Equipped Bonus: +25% ATK, +18% DEF, +12% LOOT           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Equipment Shop Prices

| Equipment | Base Cost | Bulk (x100) | Bulk (x500) |
|-----------|-----------|-------------|-------------|
| Melee Weapons | 30 NOVI | 2,700 NOVI (-10%) | 12,000 NOVI (-20%) |
| Ranged Weapons | 25 NOVI | 2,250 NOVI (-10%) | 10,000 NOVI (-20%) |
| Siege Weapons | 50 NOVI | 4,500 NOVI (-10%) | 20,000 NOVI (-20%) |
| Armor Pieces | 35 NOVI | 3,150 NOVI (-10%) | 14,000 NOVI (-20%) |
| Produce | 15 NOVI | 1,350 NOVI (-10%) | 6,000 NOVI (-20%) |
| Vehicles | 100 NOVI | 9,000 NOVI (-10%) | 40,000 NOVI (-20%) |

---

## Consumables

Consumables are **one-time use items** that provide temporary buffs or instant effects. Stored in the Inventory section.

### Consumable Types

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONSUMABLES                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  INSTANT EFFECTS                                                │
│  ──────────────────────────────────────────────────────────────│
│                                                                 │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐    │
│  │ STAMINA POTION │  │ TELEPORT SCROLL│  │  MYSTERY KEY   │    │
│  │      🧪        │  │       📜       │  │      🔑        │    │
│  │                │  │                │  │                │    │
│  │ +50 Stamina    │  │ Instant travel │  │ Open mystery   │    │
│  │ (instant)      │  │ to any city    │  │ loot crate     │    │
│  │                │  │                │  │                │    │
│  │ 500 NOVI       │  │ 2,000 NOVI     │  │ 1,500 NOVI     │    │
│  └────────────────┘  └────────────────┘  └────────────────┘    │
│                                                                 │
│  TIMED BUFFS (Duration: 1-2 hours)                             │
│  ──────────────────────────────────────────────────────────────│
│                                                                 │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐    │
│  │  XP BOOSTER    │  │  LOOT MAGNET   │  │ ATTACK BOOSTER │    │
│  │      ⭐        │  │      🧲        │  │      ⚔️        │    │
│  │                │  │                │  │                │    │
│  │ +50% XP gain   │  │ +25% loot drops│  │ +20% attack    │    │
│  │ (2 hours)      │  │ (2 hours)      │  │ (1 hour)       │    │
│  │                │  │                │  │                │    │
│  │ 1,000 NOVI     │  │ 2,000 NOVI     │  │ 1,500 NOVI     │    │
│  └────────────────┘  └────────────────┘  └────────────────┘    │
│                                                                 │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐    │
│  │DEFENSE BOOSTER │  │COLLECTION BOOST│  │  SPEED ELIXIR  │    │
│  │      🛡️        │  │      💰        │  │      💨        │    │
│  │                │  │                │  │                │    │
│  │ +20% defense   │  │ +30% resources │  │ +50% travel    │    │
│  │ (1 hour)       │  │ (2 hours)      │  │ (30 minutes)   │    │
│  │                │  │                │  │                │    │
│  │ 1,500 NOVI     │  │ 2,500 NOVI     │  │ 1,000 NOVI     │    │
│  └────────────────┘  └────────────────┘  └────────────────┘    │
│                                                                 │
│  SPECIAL ITEMS                                                  │
│  ──────────────────────────────────────────────────────────────│
│                                                                 │
│  ┌────────────────┐  ┌────────────────┐                        │
│  │ SHIELD TOKEN   │  │  RALLY HORN    │                        │
│  │      🔰        │  │      📯        │                        │
│  │                │  │                │                        │
│  │ Block 1 attack │  │ +15% team dmg  │                        │
│  │ (until used)   │  │ (1 rally)      │                        │
│  │                │  │                │                        │
│  │ 5,000 NOVI     │  │ 3,000 NOVI     │                        │
│  └────────────────┘  └────────────────┘                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Consumable Storage (Inventory Section)

```rust
// In InventorySection
pub stamina_potions: u16,       // Max 65,535
pub xp_boosters: u16,
pub loot_magnets: u16,
pub shield_tokens: u16,
pub speed_elixirs: u16,
pub attack_boosters: u16,
pub defense_boosters: u16,
pub collection_boosters: u16,
pub rally_horns: u16,
pub teleport_scrolls: u16,
pub mystery_keys: u16,
pub _reserved: [u8; 10],        // Future consumables
```

### Consumable Packs

| Pack | Contents | Value | Price | Savings |
|------|----------|-------|-------|---------|
| **Starter Pack** | 5 Stamina, 2 XP Boost, 1 Loot Magnet | 6,500 | 5,200 NOVI | 20% |
| **Combat Pack** | 3 Attack, 3 Defense, 2 Shield | 19,000 | 14,250 NOVI | 25% |
| **Explorer Pack** | 5 Speed, 3 Teleport, 2 Collection | 14,500 | 10,150 NOVI | 30% |
| **Whale Pack** | 10 of each consumable | 195,000 | 117,000 NOVI | 40% |

---

## Materials & Crafting

Materials are used for **crafting special equipment** and **upgrading items**. Five tiers align with rarity system.

### Material Tiers

```
┌─────────────────────────────────────────────────────────────────┐
│                    MATERIAL TIERS                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ⚪ COMMON          🔵 UNCOMMON         🟢 RARE                 │
│  ────────────       ────────────        ────────────            │
│  Drop rate: 60%     Drop rate: 25%      Drop rate: 10%          │
│  Shop: 50 NOVI      Shop: 200 NOVI      Shop: 800 NOVI          │
│  Craft: Basic       Craft: Standard     Craft: Quality          │
│                                                                 │
│  🟣 EPIC            🟡 LEGENDARY                                │
│  ────────────       ────────────                                │
│  Drop rate: 4%      Drop rate: 1%                               │
│  Shop: 3,000 NOVI   Shop: 10,000 NOVI                           │
│  Craft: Superior    Craft: Masterwork                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Material Storage (Inventory Section)

```rust
// In InventorySection
pub common_materials: u32,      // Max 4 billion
pub uncommon_materials: u32,
pub rare_materials: u32,
pub epic_materials: u32,
pub legendary_materials: u32,
```

### Crafting Recipes (Future Feature)

| Recipe | Materials Required | Result |
|--------|-------------------|--------|
| **Basic Weapon** | 10 Common | Random weapon (+5% bonus) |
| **Standard Weapon** | 5 Uncommon, 20 Common | Random weapon (+10% bonus) |
| **Quality Weapon** | 3 Rare, 10 Uncommon | Random weapon (+15% bonus) |
| **Superior Weapon** | 2 Epic, 5 Rare | Random weapon (+20% bonus) |
| **Masterwork Weapon** | 1 Legendary, 3 Epic | Specific weapon (+25% bonus) |

### Material Packs

| Pack | Contents | Value | Price | Savings |
|------|----------|-------|-------|---------|
| **Scavenger Pack** | 50 Common, 10 Uncommon | 4,500 | 3,600 NOVI | 20% |
| **Crafter Pack** | 20 Uncommon, 5 Rare | 8,000 | 6,000 NOVI | 25% |
| **Artisan Pack** | 10 Rare, 2 Epic | 14,000 | 9,800 NOVI | 30% |
| **Master Pack** | 5 Epic, 1 Legendary | 25,000 | 16,250 NOVI | 35% |

---

## Inventory System

The Inventory section unlocks on **first shop purchase** and provides storage for items, consumables, and equipped gear.

### Inventory Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                    PLAYER INVENTORY                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  EQUIPPED GEAR                                                  │
│  ┌──────────────┬──────────────┬──────────────┐                │
│  │    WEAPON    │    ARMOR     │  ACCESSORY   │                │
│  │  [Slot 1]    │  [Slot 2]    │  [Slot 3]    │                │
│  │              │              │              │                │
│  │  Epic Blade  │  Rare Shield │   (empty)    │                │
│  │  +18% ATK    │  +12% DEF    │              │                │
│  └──────────────┴──────────────┴──────────────┘                │
│                                                                 │
│  ITEM SLOTS (6-16 slots, expandable)                           │
│  ┌──────┬──────┬──────┬──────┬──────┬──────┐                   │
│  │ [1]  │ [2]  │ [3]  │ [4]  │ [5]  │ [6]  │                   │
│  │ Epic │ Rare │ Key  │ Pot  │ Mat  │      │                   │
│  │ Axe  │ Ring │ x3   │ x10  │ x50  │ EMPTY│                   │
│  └──────┴──────┴──────┴──────┴──────┴──────┘                   │
│  ┌──────┬──────┬──────┬──────┬──────┬──────┐                   │
│  │ [7]  │ [8]  │ [9]  │ [10] │ [11] │ [12] │                   │
│  │ 🔒   │ 🔒   │ 🔒   │ 🔒   │ 🔒   │ 🔒   │                   │
│  │LOCKED│LOCKED│LOCKED│LOCKED│LOCKED│LOCKED│                   │
│  └──────┴──────┴──────┴──────┴──────┴──────┘                   │
│                                                                 │
│  Slots: 6/16 unlocked                                          │
│  Unlock more: 5,000 NOVI per slot                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Item Structure

```rust
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct InventoryItem {
    pub item_type: u16,         // ItemType (see below) - u16 for event items
    pub rarity: u8,             // 0=Common, 1=Uncommon, 2=Rare, 3=Epic, 4=Legendary
    pub _pad: u8,               // Alignment
    pub quantity: u16,          // Stack count (1 for equipment, N for consumables)
    pub bonus_bps: u16,         // Stat bonus in basis points (500 = 5%)
    pub item_id: u32,           // Unique identifier (player-specific, see below)
    pub obtained_at: u32,       // Days since game launch (for age tracking)
}
// Total: 16 bytes per item

// ITEM ID GENERATION
// Items are NON-TRANSFERABLE (bound to player).
// item_id is unique per-player, generated via hash:
//
// item_id = hash(player_pubkey, item_type, obtained_at, slot_index) & 0xFFFFFFFF
//
// This provides:
// • Uniqueness within a player's inventory
// • Deterministic regeneration (no storage needed for counter)
// • No global coordination required
//
// Note: item_id is for client-side tracking/UI purposes.
// On-chain, items are identified by (player_account, slot_index).

// WHAT ITEMS DO (EFFECT SYSTEM)
// Items provide bonuses based on their type and bonus_bps field:
//
// EQUIPMENT (item_type 1-5):
//   • Equipped items provide persistent stat bonuses
//   • bonus_bps applies to specific stat (attack/defense/loot)
//   • Only ONE item per slot can be equipped at a time
//   • Example: Epic Sword (bonus_bps=1800) → +18% attack
//
// CONSUMABLES (item_type 20-30):
//   • One-time use items with instant or timed effects
//   • Duration stored in bonus_bps for timed buffs (minutes)
//   • Quantity decrements on use
//   • Example: XP Booster (bonus_bps=5000, quantity=3) → 3x +50% XP for duration
//
// MATERIALS (item_type 50-54):
//   • Crafting ingredients (future feature)
//   • quantity = number of materials owned
//   • bonus_bps unused (always 0)
//
// EVENT ITEMS (item_type 1000-9999):
//   • Event-specific collectibles or rewards
//   • Effects defined per-event by DAO
//   • May grant cosmetics, titles, or special abilities
//   • Some may be purely cosmetic/collectible

/// Item Type Ranges (u16 = 65,536 possible types)
///
/// Range allocation:
/// 0-99:        Core items (equipment, consumables, materials)
/// 100-999:     Reserved for future core items
/// 1000-9999:   Event items (event_id * 10 + item_index)
/// 10000-19999: Seasonal items
/// 20000-29999: Achievement items
/// 30000-39999: Team items
/// 40000-65535: Reserved
///
pub mod ItemType {
    // ========== CORE ITEMS (0-99) ==========
    pub const EMPTY: u16 = 0;

    // Equipment (1-19)
    pub const MELEE_WEAPON: u16 = 1;
    pub const RANGED_WEAPON: u16 = 2;
    pub const SIEGE_WEAPON: u16 = 3;
    pub const ARMOR: u16 = 4;
    pub const ACCESSORY: u16 = 5;

    // Consumables (20-49)
    pub const STAMINA_POTION: u16 = 20;
    pub const XP_BOOSTER: u16 = 21;
    pub const LOOT_MAGNET: u16 = 22;
    pub const SHIELD_TOKEN: u16 = 23;
    pub const SPEED_ELIXIR: u16 = 24;
    pub const ATTACK_BOOSTER: u16 = 25;
    pub const DEFENSE_BOOSTER: u16 = 26;
    pub const COLLECTION_BOOSTER: u16 = 27;
    pub const RALLY_HORN: u16 = 28;
    pub const TELEPORT_SCROLL: u16 = 29;
    pub const MYSTERY_KEY: u16 = 30;

    // Materials (50-69)
    pub const COMMON_MATERIAL: u16 = 50;
    pub const UNCOMMON_MATERIAL: u16 = 51;
    pub const RARE_MATERIAL: u16 = 52;
    pub const EPIC_MATERIAL: u16 = 53;
    pub const LEGENDARY_MATERIAL: u16 = 54;

    // Special (70-99)
    pub const LOOT_CRATE: u16 = 70;

    // ========== EVENT ITEMS (1000-9999) ==========
    // Formula: 1000 + (event_id * 10) + item_index
    // Example: Event #5, item #2 = 1000 + 50 + 2 = 1052
    //
    // This allows 899 events with up to 10 unique items each
    // Or fewer events with more items per event

    /// Check if item is an event item
    pub fn is_event_item(item_type: u16) -> bool {
        item_type >= 1000 && item_type < 10000
    }

    /// Get event_id from event item type
    pub fn event_id(item_type: u16) -> Option<u16> {
        if is_event_item(item_type) {
            Some((item_type - 1000) / 10)
        } else {
            None
        }
    }

    /// Create event item type from event_id and index
    pub fn event_item(event_id: u16, index: u8) -> u16 {
        1000 + (event_id * 10) + index as u16
    }
}
```

### Event Item Example

```
Event #42: "Summer Showdown"
├── Item 0: Summer Sword     → ItemType = 1000 + 420 + 0 = 1420
├── Item 1: Beach Shield     → ItemType = 1000 + 420 + 1 = 1421
├── Item 2: Sun Token        → ItemType = 1000 + 420 + 2 = 1422
└── Item 3: Wave Scroll      → ItemType = 1000 + 420 + 3 = 1423

Event #100: "Winter Wars"
├── Item 0: Frost Blade      → ItemType = 1000 + 1000 + 0 = 2000
└── Item 1: Ice Crystal      → ItemType = 1000 + 1000 + 1 = 2001
```

### Slot Expansion

| Slots | Cumulative Cost | Per-Slot Cost |
|-------|-----------------|---------------|
| 6 (base) | Free | - |
| 7-8 | 10,000 NOVI | 5,000 each |
| 9-10 | 25,000 NOVI | 7,500 each |
| 11-12 | 45,000 NOVI | 10,000 each |
| 13-14 | 75,000 NOVI | 15,000 each |
| 15-16 | 125,000 NOVI | 25,000 each |

---

## Shop Categories

### 1. Daily Deals (Rotating Every 24 Hours)

Fresh deals every day at **00:00 UTC**. Each deal slot refreshes independently.

```
┌─────────────────────────────────────────────────────────────────┐
│                    🔥 TODAY'S DEALS 🔥                          │
│                   Refreshes in: 14:32:08                        │
├─────────────────┬─────────────────┬─────────────────────────────┤
│   DEAL SLOT 1   │   DEAL SLOT 2   │        DEAL SLOT 3          │
│                 │                 │                             │
│  ⚔️ Melee x100  │ 🧪 Stamina x10  │   🟣 Epic Material x3       │
│                 │                 │                             │
│  ~~3,000 NOVI~~ │ ~~5,000 NOVI~~ │     ~~9,000 NOVI~~          │
│   2,250 NOVI    │  3,500 NOVI    │       6,300 NOVI            │
│                 │                 │                             │
│   -25% OFF      │   -30% OFF      │      -30% OFF               │
│                 │                 │                             │
│  [PURCHASE]     │  [PURCHASE]     │     [PURCHASE]              │
└─────────────────┴─────────────────┴─────────────────────────────┘
```

**Daily Deal Pool:**

| Category | Item Pool | Discount Range | Max/Day |
|----------|-----------|----------------|---------|
| Equipment | All 6 types | 15-35% | 3 |
| Consumables | All 11 types | 20-40% | 5 |
| Materials | All 5 tiers | 20-35% | 3 |
| Slot Unlock | Inventory slots | 10-25% | 1 |
| Special Items | Equipped gear | 15-30% | 1 |

### 2. Flash Sales (1-6 Hours)

Ultra-short windows with the deepest discounts. **Scarcity drives urgency.**

```
┌─────────────────────────────────────────────────────────────────┐
│              ⚡ FLASH SALE ⚡                                    │
│         ENDS IN: 02:45:30  |  Stock: 847/1000                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│              🎁 LEGENDARY CRAFTING BUNDLE 🎁                   │
│                                                                 │
│              Contains: 3 Legendary Materials                    │
│                        5 Epic Materials                         │
│                        10 Rare Materials                        │
│                                                                 │
│              ████████████░░░░░░░░░░░░░░░░░░░  42% CLAIMED       │
│                                                                 │
│              Regular: 53,000 NOVI                               │
│              FLASH:   29,150 NOVI  (-45%)                       │
│                                                                 │
│                    [⚡ CLAIM NOW ⚡]                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Flash Sale Rules:**
- Maximum 2 flash sales per day
- Global stock limits (first-come, first-served)
- Cannot be combined with other discounts
- Announced 30 minutes before start via in-game notification
- DAO can trigger emergency flash sales

### 3. Weekly Specials

Every week features a **themed sale** aligned with game events:

| Week Theme | Featured Items | Bonus |
|------------|---------------|-------|
| **Combat Week** | Melee, Ranged, Attack Boosters | +10% attack bonus on purchases |
| **Defense Week** | Armor, Defense Boosters, Shields | +10% defense bonus |
| **Resource Week** | Collection Boosters, Materials | +15% collection efficiency |
| **Growth Week** | XP Boosters, Fragments | +20% XP gain |
| **Expedition Week** | Speed Elixirs, Teleports, Vehicles | +25% travel speed |

---

## Time-Based Sales

### Sale Schedule Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    SALE CALENDAR                                 │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  DAILY (24h)      │ 3 rotating deal slots                       │
│  ─────────────────┼───────────────────────────────────────────── │
│  FLASH (1-6h)     │ 0-2 surprise sales per day                  │
│  ─────────────────┼───────────────────────────────────────────── │
│  WEEKEND (48h)    │ Fri 00:00 UTC - Sun 00:00 UTC               │
│  ─────────────────┼───────────────────────────────────────────── │
│  WEEKLY (168h)    │ Themed specials, Mon 00:00 - Sun 23:59 UTC  │
│  ─────────────────┼───────────────────────────────────────────── │
│  SEASONAL         │ 7-14 days, tied to events                   │
│  ─────────────────┼───────────────────────────────────────────── │
│  DAO PROMO        │ Community-voted, custom duration            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Time Period Definitions

| Period | Duration | Refresh | Discount Cap | Stock Limit |
|--------|----------|---------|--------------|-------------|
| Daily Deal | 24 hours | 00:00 UTC | 40% | Per-player |
| Flash Sale | 1-6 hours | Random | 50% | Global |
| Weekend Sale | 48 hours | Fri-Sun | 35% | Per-player |
| Weekly Special | 7 days | Monday | 30% | Unlimited |
| Seasonal Event | 7-14 days | Event-based | 45% | Global |
| DAO Promotion | Custom | DAO vote | 60% | DAO-defined |

---

## Bundle System

Bundles offer **more value** than individual purchases. The more you buy together, the more you save.

### Bundle Tiers

```
┌─────────────────────────────────────────────────────────────────┐
│                    📦 BUNDLE TIERS 📦                           │
├───────────┬───────────┬───────────┬───────────┬─────────────────┤
│  STARTER  │  COMBAT   │  CRAFTER  │  EXPLORER │    SUPREME      │
│    📗     │    ⚔️     │    🔧     │    🗺️     │      👑         │
│           │           │           │           │                 │
│  2 items  │  3 items  │  4 items  │  5 items  │   6+ items      │
│           │           │           │           │                 │
│   -10%    │   -15%    │   -20%    │   -25%    │     -35%        │
└───────────┴───────────┴───────────┴───────────┴─────────────────┘
```

### Pre-Built Bundles (SOL Pricing)

**Note:** Equipment and premium bundles are paid in **SOL**. Basic consumables and materials can optionally be purchased with **NOVI**.

#### Equipment Bundles (SOL)

| Bundle | Contents | Price (SOL) | Savings |
|--------|----------|-------------|---------|
| **Melee Starter** | 100 Melee, 50 Armor | 0.02 SOL | 20% |
| **Ranged Starter** | 100 Ranged, 50 Armor | 0.02 SOL | 20% |
| **Siege Master** | 200 Siege, 100 Armor, 50 Vehicles | 0.08 SOL | 25% |
| **Full Arsenal** | 500 each type | 0.5 SOL | 35% |

#### Premium Consumable Bundles (SOL)

| Bundle | Contents | Price (SOL) | Savings |
|--------|----------|-------------|---------|
| **Daily Grind** | 10 Stamina, 5 XP Boost | 0.05 SOL | 20% |
| **Raid Ready** | 5 Attack, 5 Defense, 3 Shield | 0.1 SOL | 25% |
| **Speed Demon** | 10 Speed, 5 Teleport | 0.08 SOL | 30% |
| **Everything Pack** | 20 of each consumable | 1.0 SOL | 40% |

#### Material Bundles (NOVI Option Available)

| Bundle | Contents | SOL Price | NOVI Price | Savings |
|--------|----------|-----------|------------|---------|
| **Beginner Crafter** | 100 Common, 20 Uncommon | 0.03 SOL | 7,200 NOVI | 20% |
| **Journeyman** | 50 Uncommon, 15 Rare | 0.08 SOL | 16,500 NOVI | 25% |
| **Expert Crafter** | 20 Rare, 5 Epic | 0.15 SOL | 21,700 NOVI | 30% |
| **Master Artisan** | 10 Epic, 3 Legendary | 0.25 SOL | 39,000 NOVI | 35% |

#### Mixed Bundles (SOL)

| Bundle | Contents | Price (SOL) | Savings |
|--------|----------|-------------|---------|
| **New Player Kit** | 100 Melee, 50 Armor, 5 Stamina, 20 Common Mat | 0.03 SOL | 30% |
| **Weekly Essentials** | 200 each equip, 10 each consumable, 50 each mat | 0.25 SOL | 40% |
| **Monthly Power** | Full month of supplies | 1.0 SOL | 45% |

### Payment Method Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                 PAYMENT METHODS BY CATEGORY                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CATEGORY              │ SOL  │ NOVI │ NOTES                    │
│  ─────────────────────┼──────┼──────┼─────────────────────────  │
│  Equipment Bundles     │  ✅  │  ❌  │ SOL only                 │
│  Premium Consumables   │  ✅  │  ❌  │ SOL only                 │
│  Material Bundles      │  ✅  │  ✅  │ Player choice            │
│  Mixed Bundles         │  ✅  │  ❌  │ SOL only                 │
│  Cosmetics             │  ✅  │  ❌  │ SOL only                 │
│  Subscriptions         │  ✅  │  ❌  │ SOL only                 │
│  ─────────────────────┼──────┼──────┼─────────────────────────  │
│  Basic Stamina Pots    │  ❌  │  ✅  │ NOVI only (small items)  │
│  Single Materials      │  ❌  │  ✅  │ NOVI only (small items)  │
│  Travel Costs          │  ❌  │  ✅  │ NOVI burned              │
│  Research Speed-ups    │  ❌  │  ✅  │ NOVI or Gems             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Custom Bundle Builder

Players can create **custom bundles** and receive automatic tiered discounts:

```
┌─────────────────────────────────────────────────────────────────┐
│               🛒 CUSTOM BUNDLE BUILDER 🛒                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  YOUR CART:                                                     │
│  ├── ⚔️  Melee Weapons x100        3,000 NOVI                  │
│  ├── 🛡️  Armor Pieces x100         3,500 NOVI                  │
│  ├── 🧪  Stamina Potions x10       5,000 NOVI                  │
│  └── 🟢  Rare Materials x10        8,000 NOVI                  │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  SUBTOTAL:          19,500 NOVI                                 │
│  ITEMS:             4 categories (CRAFTER TIER)                 │
│  BUNDLE DISCOUNT:   -20%                                        │
│  FIBONACCI BONUS:   -10% (near 21,000)                          │
│  SUB BONUS (Epic):  -15%                                        │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  FINAL TOTAL:       10,725 NOVI                                 │
│  YOU SAVE:          8,775 NOVI (45%)                           │
│                                                                 │
│                  [PURCHASE BUNDLE]                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Discount Mechanics

### Discount Stacking Rules

Discounts apply **multiplicatively** across layers. Each layer reduces the remaining price.

```
┌─────────────────────────────────────────────────────────────────┐
│               DISCOUNT STACKING RULES                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LAYER 1: Base Discount (choose BEST, non-stacking)            │
│  ├── Daily Deal discount (15-40%)                              │
│  ├── Flash Sale discount (up to 50%)                           │
│  ├── Weekly Special discount (up to 30%)                       │
│  └── DAO Promotion discount (up to 60%)                        │
│                                                                 │
│  LAYER 2: Bundle Discount (if buying pre-built bundle)         │
│  └── 10-35% based on bundle tier                               │
│                                                                 │
│  LAYER 3: Fibonacci Bonus (if total ±5% of Fib number)         │
│  └── 10-20% based on which Fibonacci number                    │
│                                                                 │
│  LAYER 4: Subscription Bonus (permanent per tier)              │
│  └── 5-25% based on subscription tier                          │
│                                                                 │
│  LAYER 5: Milestone Bonus (permanent per lifetime spend)       │
│  └── 2-10% based on milestone tier                             │
│                                                                 │
│  LAYER 6: Loyalty Streak Bonus (daily purchase streak)         │
│  └── 2-8% based on streak length                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Example Calculation (Multiplicative)

**Scenario:** Player buys 10,000 NOVI worth of items during a Flash Sale

| Layer | Discount | Multiplier | Running Total |
|-------|----------|------------|---------------|
| Base Price | - | - | 10,000 NOVI |
| Layer 1: Flash Sale | 40% | × 0.60 | 6,000 NOVI |
| Layer 2: (no bundle) | 0% | × 1.00 | 6,000 NOVI |
| Layer 3: Fibonacci (~8,000) | 14% | × 0.86 | 5,160 NOVI |
| Layer 4: Epic Subscription | 15% | × 0.85 | 4,386 NOVI |
| Layer 5: Gold Milestone | 6% | × 0.94 | 4,123 NOVI |
| Layer 6: 5-day streak | 5% | × 0.95 | **3,917 NOVI** |

**Total Savings:** 10,000 - 3,917 = **6,083 NOVI (60.8% off)**

```rust
// Discount calculation (on-chain)
pub fn calculate_final_price(
    base_price: u64,
    base_discount_bps: u16,      // Layer 1 (best of sale types)
    bundle_discount_bps: u16,    // Layer 2
    fib_discount_bps: u16,       // Layer 3
    sub_discount_bps: u16,       // Layer 4
    milestone_discount_bps: u16, // Layer 5
    loyalty_discount_bps: u16,   // Layer 6
) -> u64 {
    let mut price = base_price;

    // Apply each layer multiplicatively
    // discount_bps = 1000 means 10% off → multiply by 0.90 → (10000 - 1000) / 10000
    price = price * (10000 - base_discount_bps as u64) / 10000;
    price = price * (10000 - bundle_discount_bps as u64) / 10000;
    price = price * (10000 - fib_discount_bps as u64) / 10000;
    price = price * (10000 - sub_discount_bps as u64) / 10000;
    price = price * (10000 - milestone_discount_bps as u64) / 10000;
    price = price * (10000 - loyalty_discount_bps as u64) / 10000;

    price
}
```

**Maximum theoretical discount:** ~75% off (all layers at max values)
- Note: This requires Flash Sale + premium subscription + Diamond milestone + 7-day streak + Fibonacci alignment

### Fibonacci Bonus Calculator

Spending amounts close to Fibonacci numbers grants automatic discounts:

| Fibonacci Number | Range (±5%) | Bonus |
|------------------|-------------|-------|
| 1,000 | 950 - 1,050 | 10% |
| 2,000 | 1,900 - 2,100 | 11% |
| 3,000 | 2,850 - 3,150 | 12% |
| 5,000 | 4,750 - 5,250 | 13% |
| 8,000 | 7,600 - 8,400 | 14% |
| 13,000 | 12,350 - 13,650 | 15% |
| 21,000 | 19,950 - 22,050 | 16% |
| 34,000 | 32,300 - 35,700 | 17% |
| 55,000 | 52,250 - 57,750 | 18% |
| 89,000 | 84,550 - 93,450 | 19% |
| 144,000+ | ±5% | 20% |

### Subscription Discounts

| Tier | Shop Discount | Bonus Items |
|------|---------------|-------------|
| Free | 0% | None |
| Rookie | +5% | +2% bonus items |
| Expert | +10% | +5% bonus items |
| Epic | +15% | +10% bonus items |
| Legendary | +25% | +20% bonus items |

---

## DAO Promotions

The DAO can create custom promotions through governance:

### DAO Sale Proposal Template

```
┌─────────────────────────────────────────────────────────────────┐
│               DAO SALE PROPOSAL #127                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  TITLE:     Summer Combat Festival                              │
│  DURATION:  7 days (July 1-7, 2025)                            │
│  TYPE:      Seasonal Event Sale                                 │
│                                                                 │
│  DISCOUNTS:                                                     │
│  ├── All equipment: 30% off                                    │
│  ├── Combat consumables: 40% off                               │
│  └── Weapon crafting materials: 25% off                        │
│                                                                 │
│  BONUSES:                                                       │
│  ├── +50% attack XP during event                               │
│  └── Exclusive "Summer Warrior" title for 50k+ NOVI spent      │
│                                                                 │
│  BUDGET IMPACT:                                                 │
│  ├── Estimated burn increase: +15%                             │
│  └── Estimated player engagement: +40%                         │
│                                                                 │
│  VOTING:                                                        │
│  ├── For:     892,000 NOVI (78%)                               │
│  ├── Against: 251,000 NOVI (22%)                               │
│  └── Quorum:  MET                                              │
│                                                                 │
│  STATUS:    APPROVED - Scheduled for activation                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Automatic DAO Sales

Some sales trigger automatically based on game metrics:

| Trigger | Sale Type | Discount |
|---------|-----------|----------|
| NOVI price drops 20%+ | Economic Stimulus | 30% all items |
| Active players drop 15%+ | Re-engagement Sale | 40% starter bundles |
| Total burn rate low | Burn Incentive | 50% on high-burn items |
| Event participation low | Event Boost | 35% event items |
| New player retention low | New Player Special | 50% starter packs |

---

## Loyalty & Milestones

### Shop State (Inventory Section)

```rust
// Tracked in InventorySection
pub total_shop_spent: u64,      // Lifetime NOVI spent
pub milestone_tier: u8,         // 0=None, 1=Bronze, 2=Silver, 3=Gold, 4=Platinum, 5=Diamond
pub loyalty_streak: u8,         // Consecutive days with purchases
pub last_purchase_day: u32,     // Days since epoch
pub daily_purchase_count: u8,   // Purchases today
pub flash_claims_today: u8,     // Flash sales claimed today
pub first_purchase_claimed: bool, // First-time bonus used
```

### Milestone Tiers

```
┌─────────────────────────────────────────────────────────────────┐
│                 🏆 SHOP MILESTONES 🏆                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ⚪ BRONZE SHOPPER (10,000 NOVI spent)                         │
│  └── Permanent +2% shop discount                               │
│                                                                 │
│  🔵 SILVER SHOPPER (50,000 NOVI spent)                         │
│  └── Permanent +4% discount + Priority flash sale access       │
│                                                                 │
│  🟢 GOLD SHOPPER (200,000 NOVI spent)                          │
│  └── Permanent +6% discount + Exclusive bundles unlocked       │
│                                                                 │
│  🟣 PLATINUM SHOPPER (500,000 NOVI spent)                      │
│  └── Permanent +8% discount + Weekly bonus mystery box         │
│                                                                 │
│  🟡 DIAMOND SHOPPER (1,000,000 NOVI spent)                     │
│  └── Permanent +10% discount + VIP support + Exclusive         │
│      cosmetics + Early access to new items                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Loyalty Streak

```
┌─────────────────────────────────────────────────────────────────┐
│                   🔥 LOYALTY STREAK 🔥                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Day 1    ●○○○○○○    No bonus                                 │
│   Day 2    ●●○○○○○    +2% discount                             │
│   Day 3    ●●●○○○○    +3% discount                             │
│   Day 4    ●●●●○○○    +4% discount                             │
│   Day 5    ●●●●●○○    +5% discount + Mystery Key               │
│   Day 6    ●●●●●●○    +6% discount                             │
│   Day 7    ●●●●●●●    +8% discount + Premium Mystery Box       │
│                                                                 │
│   Streak resets after missing a day                            │
│   Maximum streak bonus: +8%                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Mystery Box System

Mystery boxes contain **deterministic rewards** based on player profile (not random):

```
┌─────────────────────────────────────────────────────────────────┐
│                   🎁 MYSTERY BOXES 🎁                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  BASIC MYSTERY BOX (from 5-day streak)                         │
│  └── Value: 150-200% of average daily purchase                 │
│                                                                 │
│  PREMIUM MYSTERY BOX (from 7-day streak)                       │
│  └── Value: 250-300% of average daily purchase                 │
│                                                                 │
│  Contents personalized by playstyle:                           │
│  ├── Combat-focused player → More weapons/attack boosters      │
│  ├── Collection-focused → More operative gear/materials        │
│  ├── Growth-focused → More XP boosters/fragments               │
│  └── Balanced player → Mixed valuable items                    │
│                                                                 │
│  Algorithm selects optimal items worth guaranteed value         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### First Purchase Bonus

New players receive **DOUBLE** value on their first shop purchase:

```
┌─────────────────────────────────────────────────────────────────┐
│           🎉 FIRST PURCHASE BONUS 🎉                           │
│                                                                 │
│   First shop purchase: GET 2X ITEMS!                           │
│                                                                 │
│   Example: Buy 100 Melee Weapons → GET 200 Melee Weapons       │
│                                                                 │
│   One-time only • Applies to any purchase • Auto-applied       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Shop Accounts (On-Chain Structs)

### Account Lifecycle Design

```
┌─────────────────────────────────────────────────────────────────┐
│                 ACCOUNT LIFECYCLE CATEGORIES                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PERSISTENT (never close, updated in place):                   │
│  ├── ShopConfigAccount    → Global config, lives forever       │
│  ├── DailyDealAccount     → 3 slots rotated daily             │
│  ├── ShopItemAccount      → Item definitions (admin can close) │
│  └── BundleAccount        → Bundle definitions (admin close)   │
│                                                                 │
│  CLOSABLE (temporary, rent returned to payer):                 │
│  ├── FlashSaleAccount     → Close after ends or sold out      │
│  ├── WeeklySaleAccount    → Close after week ends             │
│  ├── SeasonalSaleAccount  → Close after event ends            │
│  ├── DAOPromotionAccount  → Close after ends/budget exhausted │
│  └── PlayerPurchaseAccount→ Close when limit reached/delisted │
│                                                                 │
│  DESIGN PRINCIPLES:                                            │
│  • No discriminator (pinocchio doesn't need it)               │
│  • No game_engine in struct (derivable from PDA seeds)        │
│  • No redundant IDs (derivable from PDA seeds)                │
│  • Closable accounts store payer for rent return              │
│  • SOL treasury = GameEngine.sol_treasury (not duplicated)    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### ShopConfigAccount (Global Shop Settings)

**PDA:** `["shop_config", game_engine]`
**Lifecycle:** PERSISTENT (never closed)

```rust
#[repr(C)]
pub struct ShopConfigAccount {
    // Discount Caps (8 bytes) - basis points
    pub max_base_discount_bps: u16,      // Layer 1 cap (6000 = 60%)
    pub max_bundle_discount_bps: u16,    // Layer 2 cap (3500 = 35%)
    pub max_fib_discount_bps: u16,       // Layer 3 cap (2000 = 20%)
    pub max_total_discount_bps: u16,     // Combined cap (7500 = 75%)

    // Sale Limits (8 bytes)
    pub max_flash_sales_per_day: u8,
    pub max_daily_deals: u8,
    pub flash_sale_min_duration_secs: u16,
    pub flash_sale_max_duration_secs: u16,
    pub _padding1: [u8; 2],

    // Milestone Thresholds (40 bytes) - in lamports
    pub bronze_threshold: u64,
    pub silver_threshold: u64,
    pub gold_threshold: u64,
    pub platinum_threshold: u64,
    pub diamond_threshold: u64,

    // Milestone Discount Rates (10 bytes)
    pub bronze_discount_bps: u16,        // 200 = 2%
    pub silver_discount_bps: u16,        // 400 = 4%
    pub gold_discount_bps: u16,          // 600 = 6%
    pub platinum_discount_bps: u16,      // 800 = 8%
    pub diamond_discount_bps: u16,       // 1000 = 10%

    // Loyalty Streak Discounts (8 bytes)
    pub streak_day_2_bps: u16,
    pub streak_day_3_bps: u16,
    pub streak_day_5_bps: u16,
    pub streak_day_7_bps: u16,

    // Global Stats (16 bytes)
    pub total_sol_collected: u64,
    pub total_novi_burned: u64,

    // State (8 bytes)
    pub next_flash_sale_id: u64,         // Incrementing ID for flash sales

    // Reserved (16 bytes)
    pub _reserved: [u8; 16],

    pub bump: u8,
}
// Size: 8 + 8 + 40 + 10 + 8 + 16 + 8 + 16 + 1 = 115 bytes
```

### ShopItemAccount (Individual Item Definition)

**PDA:** `["shop_item", game_engine, item_id.to_le_bytes()]`
**Lifecycle:** PERSISTENT (admin can close via `close_shop_item` if delisted)

```rust
#[repr(C)]
pub struct ShopItemAccount {
    // Item Info (8 bytes)
    pub item_type: u16,                  // Maps to ItemType enum
    pub category: u8,                    // 0=Equipment, 1=Consumable, 2=Material, 3=Cosmetic
    pub rarity: u8,                      // 0=Common...4=Legendary
    pub quantity_per_purchase: u16,      // Units received per purchase
    pub base_stats_bps: u16,             // Bonus stats in basis points

    // Pricing (24 bytes)
    pub price_sol_lamports: u64,         // 0 = not sold for SOL
    pub price_novi: u64,                 // 0 = not sold for NOVI
    pub price_gems: u64,                 // 0 = not sold for gems

    // Availability (16 bytes)
    pub available_from: i64,             // 0 = always available
    pub available_until: i64,            // 0 = no end

    // Stock (16 bytes)
    pub max_global_stock: u64,           // 0 = unlimited
    pub current_global_stock: u64,

    // Limits (8 bytes)
    pub max_per_player: u32,             // 0 = unlimited
    pub max_per_day: u16,                // 0 = unlimited
    pub _padding: [u8; 2],

    // State (2 bytes)
    pub is_active: bool,
    pub is_featured: bool,

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],

    pub bump: u8,
}
// Size: 8 + 24 + 16 + 16 + 8 + 2 + 8 + 1 = 83 bytes
```

### BundleAccount (Pre-Built Bundle)

**PDA:** `["bundle", game_engine, bundle_id.to_le_bytes()]`
**Lifecycle:** PERSISTENT (admin can close if delisted)

```rust
#[repr(C)]
pub struct BundleAccount {
    // Bundle Info (8 bytes)
    pub tier: u8,                        // 0=Starter...4=Supreme
    pub category: u8,                    // 0=Equipment...3=Mixed
    pub item_count: u8,                  // 2-10 items
    pub requires_subscription: u8,       // 0=None, 1=Rookie+...4=Legendary
    pub savings_bps: u16,                // Advertised savings
    pub is_active: bool,
    pub _padding: u8,

    // Items (80 bytes) - up to 10 items
    pub items: [BundleItem; 10],         // 10 * 8 = 80 bytes

    // Pricing (16 bytes)
    pub price_sol_lamports: u64,
    pub price_novi: u64,                 // 0 = SOL only

    // Availability (16 bytes)
    pub available_from: i64,
    pub available_until: i64,

    // Stats (16 bytes)
    pub total_purchases: u64,
    pub total_revenue_lamports: u64,

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],

    pub bump: u8,
}
// Size: 8 + 80 + 16 + 16 + 16 + 8 + 1 = 145 bytes

#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct BundleItem {
    pub item_id: u32,                    // References ShopItemAccount
    pub quantity: u32,                   // Amount of this item
}
// Size: 8 bytes
```

### DailyDealAccount (Rotating Daily Deals)

**PDA:** `["daily_deal", game_engine, slot_index]` (slot_index: 0, 1, or 2)
**Lifecycle:** PERSISTENT (updated in place daily)

```rust
#[repr(C)]
pub struct DailyDealAccount {
    // Current Deal (16 bytes)
    pub item_id: u32,                    // Current item on deal
    pub discount_bps: u16,               // 1500-4000 (15-40%)
    pub _padding1: [u8; 2],
    pub started_at: i64,                 // When this deal became active

    // Next Deal - pre-computed (8 bytes)
    pub next_item_id: u32,
    pub next_discount_bps: u16,
    pub _padding2: [u8; 2],

    // Stats (16 bytes)
    pub purchases_today: u64,
    pub revenue_today_lamports: u64,

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],

    pub bump: u8,
}
// Size: 16 + 8 + 16 + 8 + 1 = 49 bytes
```

### FlashSaleAccount (Time-Limited Flash Sales)

**PDA:** `["flash_sale", game_engine, sale_id.to_le_bytes()]`
**Lifecycle:** CLOSABLE → rent returns to `payer` after sale ends/sells out

```rust
#[repr(C)]
pub struct FlashSaleAccount {
    // Payer for rent return (32 bytes)
    pub payer: Pubkey,                   // Receives rent on close

    // Item (8 bytes)
    pub item_id: u32,                    // Item or bundle ID
    pub is_bundle: bool,
    pub status: u8,                      // 0=Announced, 1=Active, 2=Ended, 3=SoldOut
    pub discount_bps: u16,               // Up to 5000 (50%)

    // Timing (24 bytes)
    pub announced_at: i64,               // 30 min before start
    pub starts_at: i64,
    pub ends_at: i64,

    // Stock (16 bytes)
    pub max_stock: u64,
    pub remaining_stock: u64,

    // Stats (16 bytes)
    pub total_claims: u64,
    pub total_revenue_lamports: u64,

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],

    pub bump: u8,
}
// Size: 32 + 8 + 24 + 16 + 16 + 8 + 1 = 105 bytes

// Close condition: status == Ended || status == SoldOut
// Rent returned to: payer
```

### WeeklySaleAccount (Weekly Themed Specials)

**PDA:** `["weekly_sale", game_engine, week_number.to_le_bytes()]`
**Lifecycle:** CLOSABLE → close after week ends, rent to `payer`

```rust
#[repr(C)]
pub struct WeeklySaleAccount {
    // Payer for rent return (32 bytes)
    pub payer: Pubkey,

    // Theme (4 bytes)
    pub theme: u8,                       // 0=Combat...4=Expedition
    pub bonus_type: u8,                  // What bonus applies
    pub bonus_value_bps: u16,            // 1000 = 10%

    // Category Discounts (8 bytes)
    pub category_discounts: [u16; 4],    // Per category discount

    // Timing (16 bytes)
    pub starts_at: i64,
    pub ends_at: i64,

    // Stats (16 bytes)
    pub total_purchases: u64,
    pub total_revenue_lamports: u64,

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],

    pub bump: u8,
}
// Size: 32 + 4 + 8 + 16 + 16 + 8 + 1 = 85 bytes

// Close condition: Clock::get().unix_timestamp > ends_at
// Rent returned to: payer
```

### SeasonalSaleAccount (Event-Tied Sales)

**PDA:** `["seasonal_sale", game_engine, event_pubkey]`
**Lifecycle:** CLOSABLE → close after event ends, rent to `payer`

```rust
#[repr(C)]
pub struct SeasonalSaleAccount {
    // Payer for rent return (32 bytes)
    pub payer: Pubkey,

    // Sale Info (32 bytes)
    pub name: [u8; 32],                  // "Summer Combat Festival"

    // Featured Items (60 bytes) - up to 10 items
    pub featured_item_ids: [u32; 10],    // 40 bytes
    pub featured_discounts_bps: [u16; 10], // 20 bytes

    // Config (8 bytes)
    pub featured_count: u8,
    pub status: u8,                      // 0=Scheduled, 1=Active, 2=Ended
    pub global_discount_bps: u16,
    pub _padding: [u8; 4],

    // Timing (16 bytes)
    pub starts_at: i64,
    pub ends_at: i64,

    // Exclusive Rewards (16 bytes)
    pub spend_threshold: u64,
    pub exclusive_cosmetic_id: u32,
    pub exclusive_claims: u32,

    // Stats (16 bytes)
    pub total_purchases: u64,
    pub total_revenue_lamports: u64,

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],

    pub bump: u8,
}
// Size: 32 + 32 + 60 + 8 + 16 + 16 + 16 + 8 + 1 = 189 bytes

// Close condition: status == Ended
// Rent returned to: payer
```

### DAOPromotionAccount (Community-Voted Promotions)

**PDA:** `["dao_promotion", game_engine, proposal_id.to_le_bytes()]`
**Lifecycle:** CLOSABLE → close after ends or budget exhausted, rent to `payer`

```rust
#[repr(C)]
pub struct DAOPromotionAccount {
    // Payer for rent return (32 bytes)
    pub payer: Pubkey,

    // Promotion Info (32 bytes)
    pub title: [u8; 32],

    // Discount Config (16 bytes)
    pub equipment_discount_bps: u16,
    pub consumable_discount_bps: u16,
    pub material_discount_bps: u16,
    pub cosmetic_discount_bps: u16,
    pub global_discount_bps: u16,
    pub max_discount_bps: u16,
    pub status: u8,                      // 0=Approved, 1=Active, 2=Ended, 3=BudgetExhausted
    pub _padding: [u8; 3],

    // Timing (24 bytes)
    pub approved_at: i64,
    pub starts_at: i64,
    pub ends_at: i64,

    // Budget (16 bytes)
    pub max_discount_budget_lamports: u64,
    pub used_discount_budget: u64,

    // Stats (24 bytes)
    pub total_purchases: u64,
    pub total_revenue_lamports: u64,
    pub unique_purchasers: u64,

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],

    pub bump: u8,
}
// Size: 32 + 32 + 16 + 24 + 16 + 24 + 8 + 1 = 153 bytes

// Close condition: status == Ended || status == BudgetExhausted
// Rent returned to: payer
```

### PlayerPurchaseAccount (Per-Player Purchase Tracking)

**PDA:** `["player_purchase", player, item_id.to_le_bytes()]`
**Lifecycle:** CLOSABLE → close when lifetime limit reached OR item delisted

```rust
#[repr(C)]
pub struct PlayerPurchaseAccount {
    // Tracking (24 bytes)
    pub lifetime_purchased: u64,         // Total ever purchased
    pub purchased_today: u64,            // Reset daily
    pub last_purchase_day: u64,          // Day number for reset

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],

    pub bump: u8,
}
// Size: 24 + 8 + 1 = 33 bytes

// Close conditions:
// 1. Item delisted (ShopItemAccount.is_active = false)
// 2. Lifetime limit reached AND no daily limit
//    (lifetime_purchased >= max_per_player && max_per_day == 0)
// Rent returned to: player (derived from PDA seeds)
```

### Shop Account Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                    SHOP ACCOUNT SIZES                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PERSISTENT ACCOUNTS (never close):                            │
│  ─────────────────────────────────────────────────────────────  │
│  ShopConfigAccount         │ 115 B   │ shop_config, game        │
│  ShopItemAccount           │  83 B   │ shop_item, game, id      │
│  BundleAccount             │ 145 B   │ bundle, game, id         │
│  DailyDealAccount          │  49 B   │ daily_deal, game, slot   │
│                                                                 │
│  CLOSABLE ACCOUNTS (rent → payer on close):                    │
│  ─────────────────────────────────────────────────────────────  │
│  FlashSaleAccount          │ 105 B   │ flash_sale, game, id     │
│  WeeklySaleAccount         │  85 B   │ weekly_sale, game, week  │
│  SeasonalSaleAccount       │ 189 B   │ seasonal_sale, game, evt │
│  DAOPromotionAccount       │ 153 B   │ dao_promotion, game, id  │
│  PlayerPurchaseAccount     │  33 B   │ player_purchase, plr, id │
│                                                                 │
│  TOTAL SAVINGS vs ORIGINAL:                                    │
│  • Removed discriminator: -8 bytes each                        │
│  • Removed game_engine ref: -32 bytes each                     │
│  • Removed redundant IDs: -4 to -8 bytes each                  │
│  • Smaller BundleItem: -8 bytes × 10 = -80 bytes               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Account Close Instructions

```rust
// Close a flash sale after it ends
pub fn close_flash_sale(ctx: Context<CloseFlashSale>) -> Result<()> {
    let sale = &ctx.accounts.flash_sale;
    require!(
        sale.status == FlashSaleStatus::Ended ||
        sale.status == FlashSaleStatus::SoldOut,
        GameError::SaleStillActive
    );
    // Rent automatically returned to sale.payer via close constraint
    Ok(())
}

// Close expired weekly sale
pub fn close_weekly_sale(ctx: Context<CloseWeeklySale>) -> Result<()> {
    let sale = &ctx.accounts.weekly_sale;
    let clock = Clock::get()?;
    require!(clock.unix_timestamp > sale.ends_at, GameError::SaleStillActive);
    Ok(())
}

// Close player purchase when limit reached
pub fn close_player_purchase(ctx: Context<ClosePlayerPurchase>) -> Result<()> {
    let purchase = &ctx.accounts.player_purchase;
    let item = &ctx.accounts.shop_item;

    // Can close if: item delisted OR (lifetime reached AND no daily limit)
    let can_close = !item.is_active ||
        (item.max_per_player > 0 &&
         purchase.lifetime_purchased >= item.max_per_player as u64 &&
         item.max_per_day == 0);

    require!(can_close, GameError::CannotCloseAccount);
    // Rent returned to player (the signer)
    Ok(())
}
```

### Shop Purchase Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    PURCHASE FLOW (SOL)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. VALIDATION                                                  │
│     ├── Check item/bundle exists and is active                 │
│     ├── Check stock availability (global + player limits)      │
│     ├── Check timing (available_from/until)                    │
│     └── Check player eligibility (subscription, milestone)     │
│                                                                 │
│  2. DISCOUNT CALCULATION                                        │
│     ├── Get base discount (daily/flash/weekly/seasonal/DAO)    │
│     ├── Apply bundle discount (if bundle)                      │
│     ├── Apply Fibonacci bonus (check spend amount)             │
│     ├── Apply subscription discount                            │
│     ├── Apply milestone discount                               │
│     ├── Apply loyalty streak discount                          │
│     └── Enforce max_total_discount_bps cap                     │
│                                                                 │
│  3. PAYMENT                                                     │
│     ├── SOL: Transfer to GameEngine.sol_treasury               │
│     └── NOVI: Burn tokens (reduce supply)                      │
│                                                                 │
│  4. FULFILLMENT                                                 │
│     ├── Add items to player.inventory                          │
│     ├── Update player shop stats (total_spent, streak, etc.)   │
│     ├── Update item/sale stats (purchases, revenue)            │
│     └── Update/create PlayerPurchaseAccount if limited         │
│                                                                 │
│  5. REWARDS                                                     │
│     ├── Check milestone tier upgrade                           │
│     ├── Check loyalty streak bonus (mystery key/box)           │
│     ├── Check first purchase bonus                             │
│     └── Check seasonal exclusive unlock                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Cosmetics

Cosmetics are **visual customizations** that don't affect gameplay stats. Stored in the Cosmetics section.

### Cosmetic Categories

```
┌─────────────────────────────────────────────────────────────────┐
│                    COSMETIC TYPES                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PROFILE COSMETICS                                              │
│  ──────────────────────────────────────────────────────────────│
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │AVATAR FRAME │  │ NAME COLOR  │  │   TITLE     │             │
│  │    🖼️       │  │    🎨       │  │    📜       │             │
│  │             │  │             │  │             │             │
│  │ Border      │  │ Display     │  │ "The Swift" │             │
│  │ around      │  │ name in     │  │ "Destroyer" │             │
│  │ avatar      │  │ custom hue  │  │ "Champion"  │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
│  ┌─────────────┐                                               │
│  │   BADGE     │                                               │
│  │    🏅       │                                               │
│  │             │                                               │
│  │ Achievement │                                               │
│  │ display     │                                               │
│  │ icon        │                                               │
│  └─────────────┘                                               │
│                                                                 │
│  GAMEPLAY COSMETICS                                             │
│  ──────────────────────────────────────────────────────────────│
│  ┌─────────────┐  ┌─────────────┐                              │
│  │ATTACK EFFECT│  │VICTORY POSE │                              │
│  │    💥       │  │    🎭       │                              │
│  │             │  │             │                              │
│  │ Visual FX   │  │ Animation   │                              │
│  │ on attacks  │  │ on wins     │                              │
│  └─────────────┘  └─────────────┘                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Cosmetic Storage (Bitfields)

```rust
// In CosmeticsSection - efficient bitfield storage
// Each bit represents ownership of a cosmetic ID (0-63)

pub equipped_avatar_frame: u16,     // Currently equipped (ID)
pub equipped_name_color: u16,
pub equipped_title: u16,
pub equipped_badge: u16,
pub equipped_attack_effect: u16,
pub equipped_victory_pose: u16,

pub owned_frames: u64,              // Bitfield: bit N = owns frame ID N
pub owned_colors: u64,
pub owned_titles: u64,
pub owned_badges: u64,
pub owned_effects: u64,
pub owned_poses: u64,
```

### Cosmetic Prices

| Category | Common | Uncommon | Rare | Epic | Legendary |
|----------|--------|----------|------|------|-----------|
| Avatar Frame | 500 | 1,500 | 5,000 | 15,000 | 50,000 |
| Name Color | 300 | 1,000 | 3,000 | 10,000 | 30,000 |
| Title | 1,000 | 3,000 | 10,000 | 30,000 | 100,000 |
| Badge | 2,000 | 6,000 | 20,000 | 60,000 | 200,000 |
| Attack Effect | 1,500 | 4,500 | 15,000 | 45,000 | 150,000 |
| Victory Pose | 1,000 | 3,000 | 10,000 | 30,000 | 100,000 |

### Exclusive Cosmetics

Some cosmetics can only be obtained through:
- **Events**: Time-limited event participation
- **Achievements**: Completing specific milestones
- **Milestones**: Shop spending milestones
- **DAO Votes**: Community-voted exclusives

---

## Technical Architecture

### Account Sections

```rust
// CORE SECTION (Always present, ~450 bytes)
#[repr(C)]
pub struct PlayerCore {
    // Identity (48 bytes)
    pub owner: Pubkey,                      // 32
    pub created_at: i64,                    // 8
    pub bump: u8,                           // 1
    pub version: u8,                        // 1 - For migrations
    pub _padding1: [u8; 6],                 // 6

    // Extension Flags (4 bytes)
    pub extensions: u32,                    // Which sections are unlocked

    // Locked NOVI (16 bytes)
    pub locked_novi: u64,
    pub last_updated_tokens_at: i64,

    // Units (48 bytes)
    pub defensive_unit_1: u64,
    pub defensive_unit_2: u64,
    pub defensive_unit_3: u64,
    pub operative_unit_1: u64,
    pub operative_unit_2: u64,
    pub operative_unit_3: u64,

    // Equipment Variety (24 bytes)
    pub melee_weapons: u32,
    pub ranged_weapons: u32,
    pub siege_weapons: u32,
    pub armor_pieces: u32,
    pub produce: u32,
    pub vehicles: u32,

    // Cash (16 bytes)
    pub cash_on_hand: u64,
    pub cash_in_vault: u64,

    // Happiness (8 bytes)
    pub happiness_defensive: f32,
    pub happiness_operative: f32,

    // Location (56 bytes)
    pub current_lat: f64,
    pub current_long: f64,
    pub traveling_to_lat: f64,
    pub traveling_to_long: f64,
    pub arrival_time: i64,
    pub current_city: u16,
    pub travel_type: u8,
    pub _padding_loc: [u8; 5],
    pub origin_city: u16,
    pub destination_city: u16,
    pub departure_time: i64,
    pub travel_speed_locked: f32,

    // Subscription (16 bytes)
    pub subscription_tier: u8,
    pub _padding_sub: [u8; 7],
    pub subscription_end: i64,

    // Progression (32 bytes)
    pub level: u8,
    pub _padding_lvl: [u8; 7],
    pub current_xp: u64,
    pub reputation: u64,
    pub networth: u64,

    // Stamina (24 bytes)
    pub encounter_stamina: u64,
    pub max_encounter_stamina: u64,
    pub last_stamina_update: i64,

    // Event (8 bytes)
    pub current_event: u64,

    // Basic Resources (16 bytes)
    pub gems: u64,
    pub fragments: u64,

    // Stats (56 bytes) - Always present for rankings
    pub total_attacks: u64,
    pub total_defenses: u64,
    pub total_attack_power: u64,
    pub total_encounter_attacks: u64,
    pub total_locked_novi_acquired: u64,
    pub total_sent: u64,
    pub total_received: u64,

    // Protection & Flags (16 bytes)
    pub new_player_protection_until: i64,
    pub flagged_by_governance: bool,
    pub _padding_end: [u8; 7],

    // Loot Counter (8 bytes)
    pub loot_counter: u64,
}

// RESEARCH SECTION (+100 bytes, offset 450)
#[repr(C)]
pub struct ResearchSection {
    // Buffs (24 bytes)
    pub attack_bps: u16,
    pub defense_bps: u16,
    pub crit_chance_bps: u16,
    pub crit_damage_bps: u16,
    pub loot_bonus_bps: u16,
    pub encounter_success_bps: u16,
    pub luck_bonus_bps: u16,
    pub reputation_bonus_bps: u16,
    pub stamina_bonus_bps: u16,
    pub collection_bonus_bps: u16,
    pub loot_magnetism_bps: u16,
    pub daily_reward_bps: u16,

    // Unlock Flags (8 bytes)
    pub has_daily_rewards: bool,
    pub has_mining: bool,
    pub has_fishing: bool,
    pub has_fragment_drops: bool,
    pub has_gem_drops: bool,
    pub _reserved_flags: [u8; 3],

    // State (16 bytes)
    pub buff_version: u32,
    pub _padding: [u8; 4],
    pub last_daily_claim: i64,

    // Active Research (48 bytes)
    pub active_research_id: u16,
    pub _padding2: [u8; 6],
    pub active_research_started: i64,
    pub active_research_ends: i64,
    pub _reserved: [u8; 24],
}

// HEROES SECTION (+130 bytes, offset 550)
#[repr(C)]
pub struct HeroesSection {
    // Active Heroes (96 bytes)
    // Empty slots are represented by NULL_PUBKEY ([0u8; 32])
    pub active_heroes: [Pubkey; 3],

    // Config (8 bytes)
    pub defensive_hero_slot: u8,   // Which slot (0, 1, or 2) used for defense
    pub _padding: [u8; 7],

    // Cached Buffs (14 bytes) - Recalculated when heroes change
    pub hero_attack_bps: u16,
    pub hero_defense_bps: u16,
    pub hero_economy_bps: u16,
    pub hero_xp_gain_bps: u16,
    pub hero_training_cost_reduction_bps: u16,
    pub hero_collection_rate_bps: u16,
    pub hero_rally_capacity_bps: u16,

    // Reserved (12 bytes)
    pub _reserved: [u8; 12],
}

// NULL_PUBKEY constant for empty slots
pub const NULL_PUBKEY: Pubkey = [0u8; 32];

// Helper to check if hero slot is empty
pub fn is_hero_slot_empty(slot: &Pubkey) -> bool {
    slot == &NULL_PUBKEY
}

// Count active heroes (non-empty slots)
pub fn count_active_heroes(heroes: &[Pubkey; 3]) -> u8 {
    heroes.iter().filter(|h| *h != &NULL_PUBKEY).count() as u8
}

// INVENTORY SECTION (+400 bytes, offset 680)
#[repr(C)]
pub struct InventorySection {
    // Consumables (32 bytes)
    pub stamina_potions: u16,
    pub xp_boosters: u16,
    pub loot_magnets: u16,
    pub shield_tokens: u16,
    pub speed_elixirs: u16,
    pub attack_boosters: u16,
    pub defense_boosters: u16,
    pub collection_boosters: u16,
    pub rally_horns: u16,
    pub teleport_scrolls: u16,
    pub mystery_keys: u16,
    pub _reserved_consumables: [u8; 10],

    // Materials (24 bytes)
    pub common_materials: u32,
    pub uncommon_materials: u32,
    pub rare_materials: u32,
    pub epic_materials: u32,
    pub legendary_materials: u32,
    pub _padding_mats: [u8; 4],

    // Equipped Items (24 bytes)
    pub equipped_weapon_id: u32,
    pub equipped_weapon_rarity: u8,
    pub equipped_weapon_bonus_bps: u16,
    pub _pad1: u8,
    pub equipped_armor_id: u32,
    pub equipped_armor_rarity: u8,
    pub equipped_armor_bonus_bps: u16,
    pub _pad2: u8,
    pub equipped_accessory_id: u32,
    pub equipped_accessory_rarity: u8,
    pub equipped_accessory_bonus_bps: u16,
    pub _pad3: u8,

    // Shop State (32 bytes)
    pub total_shop_spent: u64,
    pub milestone_tier: u8,
    pub loyalty_streak: u8,
    pub daily_purchase_count: u8,
    pub flash_claims_today: u8,
    pub first_purchase_claimed: bool,
    pub _padding_shop: [u8; 3],
    pub last_purchase_day: u32,
    pub last_daily_reset: i64,

    // Item Slots (264 bytes)
    pub slot_count: u8,
    pub _padding_slots: [u8; 7],
    pub items: [InventoryItem; 16],     // 16 * 16 = 256 bytes
}

#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct InventoryItem {
    pub item_type: u16,         // u16 for event items (see ItemType ranges)
    pub rarity: u8,
    pub _pad: u8,
    pub quantity: u16,
    pub bonus_bps: u16,
    pub item_id: u32,
    pub obtained_at: u32,
}

// RALLY SECTION (+80 bytes, offset 1080)
#[repr(C)]
pub struct RallySection {
    // Caps (8 bytes)
    pub max_concurrent_rallies: u8,
    pub max_rallies_per_day: u8,
    pub _padding1: [u8; 6],

    // Current State (16 bytes)
    pub current_rallies_joined: u8,
    pub rallies_created_today: u8,
    pub _padding2: [u8; 6],
    pub last_rally_creation_reset: i64,

    // Lifetime Stats (48 bytes)
    pub total_rallies_joined: u64,
    pub total_rallies_created: u64,
    pub total_rallies_won: u64,
    pub total_rallies_lost: u64,
    pub total_rally_loot_earned: u64,
    pub total_rally_damage_dealt: u64,

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],
}

// TEAM SECTION (+60 bytes, offset 1160)
#[repr(C)]
pub struct TeamSection {
    // Team Reference (40 bytes)
    pub team: Pubkey,
    pub has_team: bool,
    pub _padding1: [u8; 7],

    // Invite State (20 bytes)
    pub pending_team_invite: Pubkey,
    pub team_invite_expires_at: i64,
}

// COSMETICS SECTION (+80 bytes, offset 1220)
#[repr(C)]
pub struct CosmeticsSection {
    // Equipped (16 bytes)
    pub equipped_avatar_frame: u16,
    pub equipped_name_color: u16,
    pub equipped_title: u16,
    pub equipped_badge: u16,
    pub equipped_attack_effect: u16,
    pub equipped_victory_pose: u16,
    pub _padding: [u8; 4],

    // Owned Bitfields (48 bytes)
    pub owned_frames: u64,
    pub owned_colors: u64,
    pub owned_titles: u64,
    pub owned_badges: u64,
    pub owned_effects: u64,
    pub owned_poses: u64,

    // Reserved (16 bytes)
    pub _reserved: [u8; 16],
}
```

### Section Offsets & Sizes

```rust
// Compile-time constants
pub const CORE_SIZE: usize = 450;
pub const RESEARCH_SIZE: usize = 100;
pub const HEROES_SIZE: usize = 130;
pub const INVENTORY_SIZE: usize = 400;
pub const RALLY_SIZE: usize = 80;
pub const TEAM_SIZE: usize = 60;
pub const COSMETICS_SIZE: usize = 80;

// Fixed offsets (cumulative, in order)
pub const CORE_OFFSET: usize = 0;
pub const RESEARCH_OFFSET: usize = CORE_SIZE;                           // 450
pub const HEROES_OFFSET: usize = RESEARCH_OFFSET + RESEARCH_SIZE;       // 550
pub const INVENTORY_OFFSET: usize = HEROES_OFFSET + HEROES_SIZE;        // 680
pub const RALLY_OFFSET: usize = INVENTORY_OFFSET + INVENTORY_SIZE;      // 1080
pub const TEAM_OFFSET: usize = RALLY_OFFSET + RALLY_SIZE;               // 1160
pub const COSMETICS_OFFSET: usize = TEAM_OFFSET + TEAM_SIZE;            // 1220
pub const MAX_SIZE: usize = COSMETICS_OFFSET + COSMETICS_SIZE;          // 1300

// Extension flags
pub const EXT_RESEARCH: u32   = 1 << 0;
pub const EXT_HEROES: u32     = 1 << 1;
pub const EXT_INVENTORY: u32  = 1 << 2;
pub const EXT_RALLY: u32      = 1 << 3;
pub const EXT_TEAM: u32       = 1 << 4;
pub const EXT_COSMETICS: u32  = 1 << 5;
```

### Resize Function

```rust
/// Calculate required account size for given extensions
pub fn size_for_extensions(ext: u32) -> usize {
    let mut size = CORE_SIZE;

    // Extensions must be unlocked in order
    // Each subsequent section requires previous sections' space

    if ext & EXT_RESEARCH != 0 {
        size = RESEARCH_OFFSET + RESEARCH_SIZE;      // 550
    }
    if ext & EXT_HEROES != 0 {
        size = HEROES_OFFSET + HEROES_SIZE;          // 680
    }
    if ext & EXT_INVENTORY != 0 {
        size = INVENTORY_OFFSET + INVENTORY_SIZE;    // 1080
    }
    if ext & EXT_RALLY != 0 {
        size = RALLY_OFFSET + RALLY_SIZE;            // 1160
    }
    if ext & EXT_TEAM != 0 {
        size = TEAM_OFFSET + TEAM_SIZE;              // 1220
    }
    if ext & EXT_COSMETICS != 0 {
        size = COSMETICS_OFFSET + COSMETICS_SIZE;    // 1300
    }

    size
}

/// Resize account and transfer lamports for additional rent
pub fn resize_account(
    account: &AccountInfo,
    payer: &AccountInfo,
    new_size: usize,
) -> Result<(), ProgramError> {
    let current_size = account.data_len();
    if new_size <= current_size {
        return Ok(());
    }

    // Calculate additional rent needed
    let rent = pinocchio::sysvars::rent::Rent::get()?;
    let current_lamports = account.lamports();
    let required_lamports = rent.minimum_balance(new_size);
    let lamports_needed = required_lamports.saturating_sub(current_lamports);

    // Transfer lamports from payer if needed
    if lamports_needed > 0 {
        **payer.try_borrow_mut_lamports()? -= lamports_needed;
        **account.try_borrow_mut_lamports()? += lamports_needed;
    }

    // Resize the account
    account.realloc(new_size, false)?;

    Ok(())
}
```

### Shop Purchase Flow

```rust
/// Process a shop purchase
pub fn process_shop_purchase(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> Result<(), ProgramError> {
    let [player, owner, system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 1. Load core and check if inventory section exists
    let player_data = player.try_borrow_data()?;
    let core = unsafe { PlayerCore::load(&player_data) };
    let has_inventory = core.extensions & EXT_INVENTORY != 0;
    drop(player_data);

    // 2. If no inventory section, resize account
    if !has_inventory {
        let new_extensions = core.extensions | EXT_INVENTORY;
        // Also unlock Research and Heroes if not present (ordered sections)
        let new_extensions = new_extensions | EXT_RESEARCH | EXT_HEROES;
        let new_size = size_for_extensions(new_extensions);

        resize_account(player, owner, new_size)?;

        // Initialize new sections
        let mut player_data = player.try_borrow_mut_data()?;
        let core = unsafe { PlayerCore::load_mut(&mut player_data) };
        core.extensions = new_extensions;

        // Initialize inventory section with defaults
        let inventory = unsafe {
            &mut *(player_data[INVENTORY_OFFSET..].as_mut_ptr()
                as *mut InventorySection)
        };
        *inventory = InventorySection::default();
        inventory.slot_count = 6;  // Base slots
        inventory.first_purchase_claimed = false;
    }

    // 3. Process purchase (calculate discounts, burn NOVI, credit items)
    // ... purchase logic ...

    Ok(())
}
```

---

## Extensibility

The architecture is designed for easy extension:

### Adding New Extensions

```rust
// 1. Define new extension flag
pub const EXT_GUILDS: u32 = 1 << 6;      // 0x0040
pub const GUILDS_SIZE: usize = 100;
pub const GUILDS_OFFSET: usize = COSMETICS_OFFSET + COSMETICS_SIZE;  // 1300

// 2. Define section struct
#[repr(C)]
pub struct GuildsSection {
    pub guild: Pubkey,
    pub guild_rank: u8,
    // ... guild-specific fields
    pub _reserved: [u8; 32],  // Always reserve space for future
}

// 3. Update size_for_extensions()
if ext & EXT_GUILDS != 0 {
    size = GUILDS_OFFSET + GUILDS_SIZE;
}

// 4. Add accessor methods
impl PlayerAccount {
    pub fn guilds(&self, data: &[u8]) -> Option<&GuildsSection> {
        if self.core().extensions & EXT_GUILDS == 0 { return None; }
        unsafe { Some(&*(data[GUILDS_OFFSET..].as_ptr() as *const GuildsSection)) }
    }
}
```

### Adding New Items

```rust
// 1. Add to ItemType enum
pub enum ItemType {
    // ... existing types ...

    // New consumables (use reserved range 21-29)
    ReviveToken = 21,
    TeamTeleport = 22,

    // New materials (use reserved range 35-49)
    MythicMaterial = 35,

    // New specials (use reserved range 52-99)
    SeasonPass = 52,
}

// 2. Add storage in InventorySection (use _reserved bytes)
pub revive_tokens: u16,      // Was in _reserved_consumables

// 3. Add to shop catalog
```

### Adding New Cosmetics

```rust
// 1. Use reserved bits in owned_* bitfields
// Each u64 supports 64 cosmetics per category

// 2. Add new category if needed
pub owned_trails: u64,       // New category: movement trails
pub equipped_trail: u16,

// 3. Expand _reserved in CosmeticsSection
```

### Version Migration

```rust
// In PlayerCore
pub version: u8,  // Increment on breaking changes

// Migration handler
pub fn migrate_account(
    account: &AccountInfo,
    payer: &AccountInfo,
) -> Result<(), ProgramError> {
    let player_data = account.try_borrow_data()?;
    let core = unsafe { PlayerCore::load(&player_data) };

    match core.version {
        0 => {
            // Migrate from v0 to v1
            // ... migration logic ...
        }
        1 => {
            // Already current version
        }
        _ => return Err(ProgramError::InvalidAccountData),
    }

    Ok(())
}
```

### Reserved Space Strategy

Every section includes `_reserved` bytes for future fields without requiring account resize:

| Section | Reserved Bytes | Purpose |
|---------|----------------|---------|
| Core | 0 | Tightly packed, resize for new fields |
| Research | 24 | New research types |
| Heroes | 12 | Additional hero slots/buffs |
| Inventory | 10 + 2/item | New consumables, item fields |
| Rally | 8 | New rally features |
| Team | 0 | Minimal section |
| Cosmetics | 16 | New cosmetic categories |

---

## Summary

The Novus Shop creates a **compelling economic loop** with progressive unlocking:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Subscribe → Generate NOVI → Shop Purchase → Unlock Inventory  │
│       ↑                                              │          │
│       │                                              ↓          │
│       └────────── Get Rewards ←── Progress ←────────┘          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key Features:**
- Resizable accounts (pay for what you use)
- Equipment variety (melee/ranged/siege/armor)
- Consumables (11 types with timed buffs)
- Materials (5 tiers for crafting)
- Inventory system (16 slots, equipped items)
- Time-limited deals (daily, flash, weekly)
- Bundle system (up to 35% off)
- Fibonacci bonus (up to 20% off)
- Loyalty streaks (up to 8% off + mystery boxes)
- Milestone tiers (permanent discounts)
- Cosmetics (6 categories, 64 items each)
- DAO promotions (community-driven sales)
- Full extensibility (reserved bits, version field)

**Player Benefits:**
- Casual players pay minimal rent
- Engaged players get rich features
- Multiple discount mechanisms stack
- Deterministic rewards (no gambling)

**Economic Benefits:**
- Every purchase burns NOVI (deflationary)
- Progressive unlocking encourages engagement
- DAO controls pricing and promotions
- Sustainable long-term economy

---

---

# Part II: Game Systems

This section reviews existing systems. Most are **already well-designed** with `u8` enums that allow expansion to 256 values. Only note changes where truly needed.

---

## Existing Systems - Status

| System | Status | Notes |
|--------|--------|-------|
| **Events** | ✅ Good | 8 types via `u8`, top-10 leaderboard built-in, extensible |
| **Encounters** | ✅ Good | 6 rarities via `u8`, level system, dynamic attacker list |
| **Teams** | ✅ Good | 50 members, treasury, simple and works |
| **Research** | ✅ Good | 30 nodes, 3 categories, time-based |
| **Rallies** | ✅ Good | Subscription-tier capacity, PvE/PvP targets |
| **Heroes** | ✅ Good | NFT-based, √φ scaling, 3 roles |
| **Cities** | ✅ Good | 4 types, theme-based, level ranges |
| **Loot** | ✅ Good | Expiration, rarity drops |

### Extensibility Pattern

All systems use `u8` enums which allow 256 possible values:

```rust
// Example: EventType has 8 values, 248 reserved for future
pub event_type: u8,  // 0-7 used, 8-255 available

// Example: EncounterType has 6 values
pub rarity: u8,      // 0-5 used, 6-255 available

// Example: CityType has 4 values
pub city_type: u8,   // 0-3 used, 4-255 available
```

No changes needed - just add new enum variants when expanding.

---

## Optional Future Enhancements

These are **ideas for later**, not required now:

### Teams (Optional)
- Officers (multiple leaders)
- Team progression/levels
- Team achievements
- City control mechanic

### Encounters (Optional)
- Element system (Fire/Ice/Thunder/Nature)
- Boss phases for Epic+
- Counter-attack mechanic

### Cities (Optional)
- Team control/conquest
- City events (festivals, etc.)
- Economic tiers

### Loot (Optional)
- Loot magnetism research
- Material drops
- Item drops

These can be added incrementally by:
1. Adding new `u8` enum values
2. Adding new fields with padding
3. Using reserved bytes in existing structs

---

---

# Part III: Leaderboards

---

## Leaderboard Architecture

Leaderboards are critical for player engagement. The current implementation has gaps that need addressing.

### Leaderboard Categories

```
┌─────────────────────────────────────────────────────────────────┐
│                 LEADERBOARD CATEGORIES                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  EVENT LEADERBOARDS (per-event, temporary)                     │
│  └── Built into EventAccount (top 10)                          │
│  └── Resets each event                                         │
│                                                                 │
│  GENERAL LEADERBOARDS (persistent, global)                     │
│  └── Tracked via on-chain aggregation                          │
│  └── Updated on relevant actions                               │
│  └── Top 10 per category                                       │
│                                                                 │
│  TEAM LEADERBOARDS (persistent, team rankings)                 │
│  └── Aggregate team stats                                      │
│  └── Updated on member actions                                 │
│  └── Top 10 teams per category                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Event Leaderboards

Built into `EventAccount` - already implemented, no changes needed.

```rust
// LeaderboardEntry struct (40 bytes total)
#[repr(C)]
pub struct LeaderboardEntry {
    pub player: Pubkey,    // 32 bytes
    pub score: u64,        // 8 bytes
}

// Already in EventAccount
pub leaderboard: [LeaderboardEntry; 10],
pub leaderboard_count: u8,  // 0-10 active entries

// Update on player action
pub fn update_event_score(
    event: &mut EventAccount,
    player: Pubkey,
    score_delta: u64,
) -> Result<(), ProgramError> {
    // Find player in leaderboard or get lowest entry
    let mut found_idx: Option<usize> = None;
    let mut lowest_idx: usize = 0;
    let mut lowest_score: u64 = u64::MAX;

    let count = event.leaderboard_count as usize;
    for (i, entry) in event.leaderboard[..count].iter().enumerate() {
        if entry.player == player {
            found_idx = Some(i);
            break;
        }
        if entry.score < lowest_score {
            lowest_score = entry.score;
            lowest_idx = i;
        }
    }

    // Update existing player's score
    if let Some(idx) = found_idx {
        if event.event_type.is_accumulative() {
            event.leaderboard[idx].score += score_delta;
        } else {
            // Snapshot: only update if higher
            if score_delta > event.leaderboard[idx].score {
                event.leaderboard[idx].score = score_delta;
            }
        }
    }
    // Add new player if slots available
    else if count < 10 {
        event.leaderboard[count] = LeaderboardEntry { player, score: score_delta };
        event.leaderboard_count += 1;
    }
    // Replace lowest if new score qualifies
    else if score_delta > lowest_score {
        event.leaderboard[lowest_idx] = LeaderboardEntry { player, score: score_delta };
    }

    // Sort by score descending (rank is just array index + 1)
    event.leaderboard[..event.leaderboard_count as usize]
        .sort_by(|a, b| b.score.cmp(&a.score));

    Ok(())
}
```

**Note:** Rank is determined by array position (index 0 = rank 1, index 9 = rank 10). Prize claiming is tracked via separate `EventParticipation` PDAs per player.

---

## General Leaderboards

Global leaderboards require dedicated PDA accounts per category.

### Leaderboard Categories

| ID | Category | Metric | Update Trigger |
|----|----------|--------|----------------|
| 0 | Most Attacks Won | PlayerCore.total_attacks | Attack victory |
| 1 | Most Defenses Won | PlayerCore.total_defenses | Defense victory |
| 2 | Highest Attack Power | PlayerCore.total_attack_power | Unit/Equipment/Research/Hero/Level change |
| 3 | Most Encounters Killed | PlayerCore.total_encounter_attacks | Encounter defeat |
| 4 | Most NOVI Acquired | PlayerCore.total_locked_novi_acquired | NOVI received |
| 5 | Most NOVI Sent | PlayerCore.total_sent | NOVI transfer |
| 6 | Most NOVI Received | PlayerCore.total_received | NOVI transfer |
| 7 | Highest Level | PlayerCore.level | Level up |
| 8 | Highest Networth | PlayerCore.networth | Networth change |
| 9 | Highest Reputation | PlayerCore.reputation | Reputation change |

### General Leaderboard Account

```rust
/// Global leaderboard for a specific category
/// PDA: [b"leaderboard", category_id]
#[repr(C)]
pub struct GeneralLeaderboard {
    // Identity (16 bytes)
    pub category: u8,
    pub bump: u8,
    pub _padding: [u8; 6],
    pub last_updated: i64,

    // Entries (400 bytes - top 10 players)
    // Uses same LeaderboardEntry as EventAccount
    pub entries: [LeaderboardEntry; 10],
}

impl GeneralLeaderboard {
    pub const LEN: usize = 16 + (10 * 40); // 416 bytes
}
```

Reuses `LeaderboardEntry` from `state/event.rs` (40 bytes: Pubkey + u64).

### Update Logic

Same pattern as event leaderboards - check if player qualifies for top 10, update if so:

```rust
/// Update leaderboard when player performs relevant action
/// Called from: attack_player, attack_encounter, collect_resources, level_up, etc.
pub fn update_leaderboard(
    leaderboard: &mut GeneralLeaderboard,
    player: Pubkey,
    new_score: u64,
) {
    // Find player in leaderboard or get lowest entry
    let mut found_idx: Option<usize> = None;
    let mut lowest_idx: usize = 0;
    let mut lowest_score: u64 = u64::MAX;

    for (i, entry) in leaderboard.entries.iter().enumerate() {
        if entry.player == player {
            found_idx = Some(i);
            break;
        }
        if entry.score < lowest_score {
            lowest_score = entry.score;
            lowest_idx = i;
        }
    }

    // Update existing player's score
    if let Some(idx) = found_idx {
        leaderboard.entries[idx].score = new_score;
    }
    // Or replace lowest if new score qualifies
    else if new_score > lowest_score {
        leaderboard.entries[lowest_idx] = LeaderboardEntry {
            player,
            score: new_score,
            rank: 0,
            has_claimed: false,
            _padding: [0; 6],
        };
    }
    else {
        return; // Doesn't qualify for top 10
    }

    // Sort by score descending and update ranks
    leaderboard.entries.sort_by(|a, b| b.score.cmp(&a.score));
    for (i, entry) in leaderboard.entries.iter_mut().enumerate() {
        entry.rank = (i + 1) as u8;
    }

    leaderboard.last_updated = Clock::get().unwrap().unix_timestamp;
}
```

### Integration Points

```rust
// In attack_player.rs after victory
if attacker.total_attacks > 0 {
    update_general_leaderboard(
        &mut attacks_leaderboard,
        attacker.owner,
        attacker.total_attacks,
    )?;
}

// In level_up.rs
update_general_leaderboard(
    &mut level_leaderboard,
    player.owner,
    player.level as u64,
)?;

// In collect_resources.rs
update_general_leaderboard(
    &mut networth_leaderboard,
    player.owner,
    player.networth,
)?;
```

---

## Team Leaderboards

Team rankings based on aggregate team performance.

### ⚠️ TeamAccount Stats Extension Required

The current `TeamAccount` only stores basic fields (id, leader, name, members, treasury). For team leaderboards, we need aggregate stats cached in TeamAccount to avoid expensive member aggregation.

**Proposed TeamAccount stats fields (add to existing struct):**

```rust
// Add to TeamAccount after treasury field:
pub total_attacks_won: u64,        // 8 bytes - Incremented when any member wins PvP
pub total_defenses_won: u64,       // 8 bytes - Incremented when any member defends
pub total_rallies_won: u64,        // 8 bytes - Incremented on rally victory
pub total_encounters_cleared: u64, // 8 bytes - Incremented on encounter defeat
pub total_novi_earned: u64,        // 8 bytes - Sum of member NOVI acquisitions
pub total_level: u32,              // 4 bytes - Sum of member levels (avg = total_level / member_count)
pub _padding_stats: [u8; 4],       // 4 bytes - Alignment

// Additional 48 bytes total
```

**Update triggers:** When a member performs an action, also update their team's cached stats.

### Team Leaderboard Categories

| ID | Category | Metric | Update Trigger |
|----|----------|--------|----------------|
| 0 | Most Wins | TeamAccount.total_attacks_won | Member attack victory |
| 1 | Most Defenses | TeamAccount.total_defenses_won | Member defense victory |
| 2 | Most Rallies Won | TeamAccount.total_rallies_won | Rally victory |
| 3 | Most Encounters | TeamAccount.total_encounters_cleared | Encounter defeat |
| 4 | Highest NOVI | TeamAccount.total_novi_earned | NOVI acquired |
| 5 | Highest Avg Level | TeamAccount.total_level / member_count | Member level up |
| 6 | Largest Team | TeamAccount.member_count | Join/leave |

### Team Leaderboard Account

```rust
/// Team leaderboard for a specific category
/// PDA: [b"team_leaderboard", category_id]
#[repr(C)]
pub struct TeamLeaderboard {
    // Identity (16 bytes)
    pub category: u8,
    pub bump: u8,
    pub _padding: [u8; 6],
    pub last_updated: i64,

    // Entries (400 bytes - top 10 teams)
    pub entries: [TeamLeaderboardEntry; 10],
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct TeamLeaderboardEntry {
    pub team: Pubkey,          // 32 bytes
    pub score: u64,            // 8 bytes
}
// 40 bytes per entry

impl TeamLeaderboard {
    pub const LEN: usize = 16 + (10 * 40); // 416 bytes
}
```

**Update Logic:** Same pattern as general leaderboards - check if team qualifies for top 10 on member actions. The key difference is that each member action needs to load the team account and increment the relevant stat.

---

## Leaderboard Display Integration

### UI Patterns

```
┌─────────────────────────────────────────────────────────────────┐
│                 🏆 LEADERBOARDS 🏆                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [GENERAL]   [EVENTS]   [TEAMS]   [SEASONAL]                   │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  CATEGORY: Most Attacks Won                                     │
│                                                                 │
│  RANK │ PLAYER          │ SCORE      │ CHANGE                  │
│  ─────┼─────────────────┼────────────┼─────────────────────────│
│  #1   │ 🥇 DarkLord     │ 15,892     │ ━                       │
│  #2   │ 🥈 SwiftBlade   │ 14,201     │ ▲ +1                    │
│  #3   │ 🥉 NovaStrike   │ 13,847     │ ▼ -1                    │
│  #4   │ ShadowMaster    │ 12,456     │ ▲ +3                    │
│  #5   │ IronFist        │ 11,902     │ ━                       │
│  #6   │ BladeRunner     │ 10,445     │ ▲ +1                    │
│  #7   │ StormBringer    │ 9,823      │ ▼ -1                    │
│  #8   │ NightHawk       │ 8,901      │ NEW                     │
│  #9   │ FireStorm       │ 7,654      │ ━                       │
│  #10  │ IceBreaker      │ 6,234      │ ▼ -2                    │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  REWARDS FOR TOP 10:                                            │
│  #1: 50,000 NOVI + Diamond Frame                               │
│  #2-3: 25,000 NOVI + Gold Frame                                │
│  #4-10: 10,000 NOVI + Silver Frame                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

# Part IV: Future Extensibility

---

## System Integration Patterns

### Cross-System Triggers

Many systems interact. Here's the integration map:

```
┌─────────────────────────────────────────────────────────────────┐
│                 SYSTEM INTEGRATION MAP                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ATTACK ──┬──▶ Update PlayerCore.total_attacks                 │
│           ├──▶ Update General Leaderboard (attacks)            │
│           ├──▶ Update Event Score (if MostAttacksWonPvP)       │
│           ├──▶ Update Team Stats (if has team)                 │
│           ├──▶ Update City Control (if in controlled city)     │
│           ├──▶ Generate Loot (if victory)                      │
│           └──▶ Award XP                                        │
│                                                                 │
│  ENCOUNTER ──┬──▶ Update PlayerCore.total_encounter_attacks    │
│              ├──▶ Update General Leaderboard (encounters)      │
│              ├──▶ Update Event Score (if applicable)           │
│              ├──▶ Update Team Stats                            │
│              ├──▶ Generate Loot                                │
│              ├──▶ Award XP                                     │
│              └──▶ Chance for material drop                     │
│                                                                 │
│  RALLY ──┬──▶ Update RallySection stats                        │
│          ├──▶ Update Team Stats (rallies won)                  │
│          ├──▶ Update Event Score (if applicable)               │
│          ├──▶ Distribute Loot to participants                  │
│          └──▶ Award XP (scaled by contribution)                │
│                                                                 │
│  COLLECTION ──┬──▶ Update PlayerCore.cash/gems                 │
│               ├──▶ Update Event Score (if applicable)          │
│               ├──▶ Update Networth                             │
│               ├──▶ Update General Leaderboard (networth)       │
│               └──▶ Chance for material drop (if mining/fishing)│
│                                                                 │
│  LEVEL UP ──┬──▶ Update General Leaderboard (level)            │
│             ├──▶ Update Team XP                                │
│             └──▶ Unlock features (if milestone level)          │
│                                                                 │
│  SHOP ──┬──▶ Burn NOVI                                         │
│         ├──▶ Update InventorySection                           │
│         ├──▶ Update Event Score (if MostNoviConsumed)          │
│         └──▶ Update Milestone/Loyalty                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Adding New Systems Checklist

When adding a new system, ensure:

1. **Account Design**
   - [ ] Define struct with `#[repr(C)]`
   - [ ] Include `_reserved` bytes for future fields
   - [ ] Calculate exact size for rent
   - [ ] Define PDA seeds

2. **Integration**
   - [ ] Add extension flag if player-bound
   - [ ] Update `size_for_extensions()` if applicable
   - [ ] Identify cross-system triggers
   - [ ] Add leaderboard category if competitive

3. **Events**
   - [ ] Add EventType variant if applicable
   - [ ] Implement scoring in `update_event_score()`

4. **Leaderboards**
   - [ ] Add GeneralLeaderboard if global ranking needed
   - [ ] Add TeamLeaderboard if team competition
   - [ ] Define update triggers

5. **Testing**
   - [ ] Unit tests for new logic
   - [ ] Integration tests for cross-system effects
   - [ ] Rent calculation verification

### Version Migration Strategy

```rust
// Global version tracker
pub const CURRENT_VERSION: u8 = 1;

// In any account that may need migration
pub version: u8,

// Migration dispatcher
pub fn migrate_if_needed(
    account: &AccountInfo,
    payer: &AccountInfo,
) -> Result<(), ProgramError> {
    let data = account.try_borrow_data()?;
    let version = data[VERSION_OFFSET];  // Known offset
    drop(data);

    if version == CURRENT_VERSION {
        return Ok(());
    }

    match version {
        0 => migrate_v0_to_v1(account, payer)?,
        _ => return Err(GameError::UnknownVersion.into()),
    }

    Ok(())
}

fn migrate_v0_to_v1(
    account: &AccountInfo,
    payer: &AccountInfo,
) -> Result<(), ProgramError> {
    // 1. Calculate new size if changed
    let new_size = /* ... */;

    // 2. Resize if needed
    if new_size > account.data_len() {
        resize_account(account, payer, new_size)?;
    }

    // 3. Migrate data
    let mut data = account.try_borrow_mut_data()?;
    // ... move/transform fields ...

    // 4. Update version
    data[VERSION_OFFSET] = 1;

    Ok(())
}
```

---

---

# Part V: Strategic Combat System

---

## Unit Role Definitions

**CRITICAL: Unit roles are strictly separated for strategic depth.**

```
┌─────────────────────────────────────────────────────────────────┐
│                    UNIT ROLE MATRIX                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  UNIT TYPE          │ ATTACK │ DEFEND │ ECONOMY │ TIER WEIGHT  │
│  ───────────────────┼────────┼────────┼─────────┼─────────────  │
│  Defensive Unit 1   │   ✅   │   ✅   │    ❌   │      1       │
│  Defensive Unit 2   │   ✅   │   ✅   │    ❌   │      2       │
│  Defensive Unit 3   │   ✅   │   ✅   │    ❌   │      3       │
│  ───────────────────┼────────┼────────┼─────────┼─────────────  │
│  Operative Unit 1   │   ❌   │   ❌   │    ✅   │     N/A      │
│  Operative Unit 2   │   ❌   │   ❌   │    ✅   │     N/A      │
│  Operative Unit 3   │   ❌   │   ❌   │    ✅   │     N/A      │
│                                                                 │
│  DEFENSIVE UNITS: Combat specialists (attack & defend)          │
│  OPERATIVE UNITS: Economy specialists (collect, fish, produce)  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Strategic Implications:**
- Players must balance combat power vs economic output
- Hiring all defensive units = strong military, weak economy
- Hiring all operative units = strong economy, vulnerable to attacks
- Optimal play requires strategic unit composition

---

## Attack Power Formula

Attack power is calculated and stored as `total_attack_power` in PlayerAccount.
Updated whenever: units change, equipment changes, research completes, hero locks/unlocks, level changes.

### Formula Components

```rust
/// Calculate total attack power
/// ONLY defensive units contribute to attack power
///
/// Formula:
/// base_power = Σ(defensive_unit_i × tier_weight_i)
/// weapon_coverage = min(weapons / total_defensive_units, 1.0)
/// equipment_bonus = ranged_bonus + vehicle_bonus
/// total_attack_power = base_power × weapon_coverage × (1 + all_bonuses)
pub fn calculate_total_attack_power(
    player: &PlayerAccount,
) -> u64 {
    // 1. BASE POWER: Only Defensive Units × Linear Tier Weight
    // Tier weights: 1, 2, 3 (linear scaling)
    // Elite scaling (level 50+) can be added later

    let base_power: u64 =
        (player.defensive_unit_1 * 1)
        .saturating_add(player.defensive_unit_2 * 2)
        .saturating_add(player.defensive_unit_3 * 3);

    if base_power == 0 {
        return 0;
    }

    // 2. WEAPON COVERAGE (0-100%)
    // Units need weapons to fight effectively
    // Coverage = min(weapons / total_defensive_units, 1.0)

    let total_defensive = player.defensive_unit_1
        .saturating_add(player.defensive_unit_2)
        .saturating_add(player.defensive_unit_3);

    let weapon_coverage_bps: u64 = if player.weapons >= total_defensive {
        10000 // 100% coverage
    } else if total_defensive > 0 {
        (player.weapons * 10000) / total_defensive
    } else {
        10000
    };

    // 3. EQUIPMENT BONUSES
    // From new equipment variety system:
    // - ranged_weapons: +10% attack bonus (1000 bps max)
    // - vehicles: +25% drive-by potential (2500 bps max)

    let ranged_bonus_bps: u64 = calculate_equipment_coverage_bonus(
        player.ranged_weapons,
        total_defensive,
        1000, // 10% max
    );

    let vehicle_bonus_bps: u64 = calculate_equipment_coverage_bonus(
        player.vehicles,
        total_defensive,
        2500, // 25% max (drive-by eligibility)
    );

    // 4. RESEARCH + HERO + LEVEL BONUSES
    let research_bonus_bps = player.research_attack_bps as u64;
    let hero_bonus_bps = player.hero_attack_bps as u64;

    // Level bonus: +1% per 10 levels (up to +10% at level 100)
    let level_bonus_bps = ((player.level as u64) / 10) * 100;

    // 5. FINAL CALCULATION (Multiplicative)
    // total = base × (weapon% / 100) × (1 + bonuses%)

    let total_bonus_bps: u64 = 10000  // Base 100%
        .saturating_add(ranged_bonus_bps)
        .saturating_add(vehicle_bonus_bps)
        .saturating_add(research_bonus_bps)
        .saturating_add(hero_bonus_bps)
        .saturating_add(level_bonus_bps);

    // Apply: base × weapon_coverage × total_bonus
    let result = (base_power as u128)
        .saturating_mul(weapon_coverage_bps as u128)
        .saturating_div(10000)
        .saturating_mul(total_bonus_bps as u128)
        .saturating_div(10000);

    result as u64
}

/// Helper: Calculate equipment bonus based on coverage
fn calculate_equipment_coverage_bonus(
    equipment_count: u64,
    unit_count: u64,
    max_bonus_bps: u64,
) -> u64 {
    if unit_count == 0 {
        return 0;
    }

    // Bonus scales linearly with coverage, up to max
    let coverage = core::cmp::min(equipment_count, unit_count);
    (coverage * max_bonus_bps) / unit_count
}
```

### Attack Power Example

```
Player Stats:
- Defensive Unit 1: 1,000 (×1 = 1,000)
- Defensive Unit 2: 500   (×2 = 1,000)
- Defensive Unit 3: 200   (×3 = 600)
- Total Defensive: 1,700 units
- Base Power: 2,600

Equipment:
- Weapons: 1,500 (88% coverage = 8,800 bps)
- Ranged: 850 (50% coverage = +500 bps)
- Vehicles: 340 (20% coverage = +500 bps)

Bonuses:
- Research Attack: +30% (3,000 bps)
- Hero Attack: +15% (1,500 bps)
- Level 45: +4% (400 bps)

Calculation:
base_power = 2,600
weapon_coverage = 8,800 bps (88%)
total_bonus = 10,000 + 500 + 500 + 3,000 + 1,500 + 400 = 15,900 bps

total_attack_power = 2,600 × (8,800/10,000) × (15,900/10,000)
                   = 2,600 × 0.88 × 1.59
                   = 3,638
```

---

## Defense Power Formula

Defense power is calculated and stored as `total_defense_power` in PlayerAccount.
Includes: garrison units + reinforcements from team members.

### Formula Components

```rust
/// Calculate total defense power
/// Garrison = defensive units at home (total - deployed)
/// + Reinforcements from team members
/// + Equipment/Research/Hero bonuses
pub fn calculate_total_defense_power(
    player: &PlayerAccount,
    deployment: Option<&DeploymentState>,
    reinforcements: &[ReinforcementAccount],
) -> u64 {
    // 1. GARRISON: Defensive Units - Deployed Units
    let garrison = if let Some(deploy) = deployment {
        [
            player.defensive_unit_1.saturating_sub(deploy.deployed_def_1),
            player.defensive_unit_2.saturating_sub(deploy.deployed_def_2),
            player.defensive_unit_3.saturating_sub(deploy.deployed_def_3),
        ]
    } else {
        [
            player.defensive_unit_1,
            player.defensive_unit_2,
            player.defensive_unit_3,
        ]
    };

    // Garrison power with tier weights
    let garrison_power: u64 =
        (garrison[0] * 1)
        .saturating_add(garrison[1] * 2)
        .saturating_add(garrison[2] * 3);

    // 2. REINFORCEMENTS FROM TEAM MEMBERS
    // Only count reinforcements that have arrived (not traveling)
    // Team bonus: +20% effectiveness (already applied by sender)

    let mut reinforcement_power: u64 = 0;
    for reinf in reinforcements.iter() {
        // Only count if arrived and not being recalled
        if reinf.arrived_at > 0 && reinf.recall_initiated == 0 {
            let rpower: u64 =
                (reinf.units_def_1 * 1)
                .saturating_add(reinf.units_def_2 * 2)
                .saturating_add(reinf.units_def_3 * 3);

            // Apply hero bonus if hero is present with reinforcements
            let hero_mult = if reinf.sender_hero != NULL_PUBKEY {
                12000 // +20% with hero
            } else {
                10000 // No hero bonus
            };

            reinforcement_power = reinforcement_power
                .saturating_add((rpower * hero_mult) / 10000);
        }
    }

    // 3. BASE DEFENSE POWER
    let base_defense = garrison_power.saturating_add(reinforcement_power);

    if base_defense == 0 {
        return 0;
    }

    // 4. EQUIPMENT BONUSES (Armor)
    let total_garrison = garrison[0]
        .saturating_add(garrison[1])
        .saturating_add(garrison[2]);

    let armor_bonus_bps: u64 = calculate_equipment_coverage_bonus(
        player.armor_pieces,
        total_garrison,
        1500, // 15% max defense bonus from armor
    );

    // 5. RESEARCH + HERO + LEVEL BONUSES
    let research_bonus_bps = player.research_defense_bps as u64;
    let hero_bonus_bps = player.hero_defense_bps as u64;
    let level_bonus_bps = ((player.level as u64) / 10) * 100;

    // 6. FINAL CALCULATION
    let total_bonus_bps: u64 = 10000
        .saturating_add(armor_bonus_bps)
        .saturating_add(research_bonus_bps)
        .saturating_add(hero_bonus_bps)
        .saturating_add(level_bonus_bps);

    let result = (base_defense as u128)
        .saturating_mul(total_bonus_bps as u128)
        .saturating_div(10000);

    result as u64
}
```

---

## Deployment System

Players choose HOW MANY units to send when attacking. This creates strategic risk.

### Deployment Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT SYSTEM                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PLAYER INITIATES ATTACK                                        │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────┐            │
│  │ SELECT UNITS TO DEPLOY                          │            │
│  │                                                  │            │
│  │ Your Defensive Units:                           │            │
│  │ ┌──────────────────────────────────────────┐    │            │
│  │ │ Def 1: [____500____] / 1,000 available  │    │            │
│  │ │ Def 2: [____200____] / 500 available    │    │            │
│  │ │ Def 3: [____100____] / 200 available    │    │            │
│  │ └──────────────────────────────────────────┘    │            │
│  │                                                  │            │
│  │ Total Deploying: 800 / 1,700 (47%)             │            │
│  │ Max Deployment: 1,020 (60%)                     │            │
│  │                                                  │            │
│  │ ⚠️ GARRISON REMAINING: 900 units                │            │
│  │    Your defense power will be REDUCED!          │            │
│  │                                                  │            │
│  │ [DEPLOY & ATTACK]                               │            │
│  └─────────────────────────────────────────────────┘            │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────┐            │
│  │ TRAVEL TO TARGET                                 │            │
│  │ Distance: 15 km                                  │            │
│  │ Travel Time: 45 minutes                          │            │
│  │                                                  │            │
│  │ While traveling:                                 │            │
│  │ • Your base defense is REDUCED                  │            │
│  │ • Deployed units cannot be recalled instantly   │            │
│  │ • Attack happens automatically on arrival       │            │
│  └─────────────────────────────────────────────────┘            │
│       │                                                         │
│       ▼                                                         │
│  ATTACK RESOLVES → Units return home (travel time)              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Max Deployment Formula

```rust
/// Calculate maximum deployment percentage
/// Base: 30%
/// + Research bonus (up to +20%)
/// + Level bonus (up to +20%)
/// + Subscription bonus (0-10%)
/// Maximum: 80%
///
/// Elite Mode (level 50+): Can deploy up to 90% with "All-In"
pub fn calculate_max_deployment_percent(
    player: &PlayerAccount,
    research: &ResearchProgress,
) -> u16 {
    const BASE_DEPLOYMENT_BPS: u16 = 3000; // 30%
    const MAX_DEPLOYMENT_BPS: u16 = 8000;  // 80%
    const ELITE_DEPLOYMENT_BPS: u16 = 9000; // 90% (elite mode)

    // Research: Deployment Efficiency (up to +20%)
    let research_bonus = research.deployment_efficiency_bps; // 0-2000

    // Level bonus: +1% per 5 levels (up to +20% at level 100)
    let level_bonus = ((player.level as u16) / 5) * 100; // 0-2000

    // Subscription bonus (0-10%)
    let sub_bonus = match player.subscription_tier {
        0 => 0,      // Free: 0%
        1 => 200,    // Basic: +2%
        2 => 500,    // Premium: +5%
        3 => 800,    // Elite: +8%
        _ => 1000,   // Legendary: +10%
    };

    let total = BASE_DEPLOYMENT_BPS
        .saturating_add(research_bonus)
        .saturating_add(level_bonus)
        .saturating_add(sub_bonus);

    // Cap at 80% (or 90% for elite mode)
    if player.level >= 50 {
        core::cmp::min(total, ELITE_DEPLOYMENT_BPS)
    } else {
        core::cmp::min(total, MAX_DEPLOYMENT_BPS)
    }
}
```

### Deployment State (PlayerAccount Extension)

```rust
/// Deployment tracking - Add to PlayerAccount or use extension section
/// Tracks units currently deployed for attack
#[repr(C)]
pub struct DeploymentState {
    // Deployed unit counts (24 bytes)
    pub deployed_def_1: u64,            // 8 bytes
    pub deployed_def_2: u64,            // 8 bytes
    pub deployed_def_3: u64,            // 8 bytes

    // Target information (48 bytes)
    pub target_player: Pubkey,          // 32 bytes - Who we're attacking
    pub target_city: u16,               // 2 bytes - Target's city
    pub _padding1: [u8; 6],             // 6 bytes
    pub deployed_hero: u8,              // 1 byte - Hero slot (0-2, 255=none)
    pub _padding2: [u8; 7],             // 7 bytes

    // Timing (24 bytes)
    pub departure_time: i64,            // 8 bytes - When deployment started
    pub arrival_time: i64,              // 8 bytes - When attack happens
    pub return_time: i64,               // 8 bytes - When units return home

    // Status (8 bytes)
    pub is_active: bool,                // 1 byte
    pub attack_completed: bool,         // 1 byte - Attack resolved, returning
    pub _padding3: [u8; 6],             // 6 bytes
}
// Total: 104 bytes

impl DeploymentState {
    pub const LEN: usize = 104;

    /// Total deployed units
    pub fn total_deployed(&self) -> u64 {
        self.deployed_def_1
            .saturating_add(self.deployed_def_2)
            .saturating_add(self.deployed_def_3)
    }

    /// Check if deployment has arrived at target
    pub fn has_arrived(&self, now: i64) -> bool {
        self.is_active && now >= self.arrival_time
    }

    /// Check if units have returned home
    pub fn has_returned(&self, now: i64) -> bool {
        self.attack_completed && now >= self.return_time
    }
}
```

---

## Reinforcement System

Team members can send defensive units to help defend each other.

### Reinforcement Rules

```
┌─────────────────────────────────────────────────────────────────┐
│                  REINFORCEMENT SYSTEM                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  REQUIREMENTS:                                                  │
│  ├── Sender & Receiver MUST be on same team                    │
│  ├── Sender must have "Military Logistics" research            │
│  ├── Receiver must have reinforcement capacity available       │
│  └── Sender pays travel cost (NOVI burn)                       │
│                                                                 │
│  LIMITS:                                                        │
│  ├── Sender: Max 30% of defensive units can be sent            │
│  ├── Receiver: Max capacity based on research                  │
│  │             (Reinforcement Capacity research node)          │
│  └── Per-reinforcement: Max 10,000 units per request           │
│                                                                 │
│  HERO BONUS:                                                    │
│  ├── Optional: Send hero with reinforcements                   │
│  ├── If hero present: +20% defense effectiveness               │
│  └── Hero must travel back when recalled                       │
│                                                                 │
│  RECALL:                                                        │
│  ├── Sender can manually recall at any time                    │
│  ├── Receiver can "relieve" (dismiss) reinforcements           │
│  ├── Auto-recall if sender is attacked (emergency)             │
│  └── Return travel time applies                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Reinforcement Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                 REINFORCEMENT FLOW                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PLAYER B (Sender)              PLAYER A (Receiver)             │
│       │                              │                          │
│       │     "I need help!"           │                          │
│       │◄─────────────────────────────┤                          │
│       │                              │                          │
│       ▼                              │                          │
│  ┌─────────────┐                     │                          │
│  │ Select:     │                     │                          │
│  │ - Units     │                     │                          │
│  │ - Hero (opt)│                     │                          │
│  └──────┬──────┘                     │                          │
│         │                            │                          │
│         │   TRAVEL (hero moves)      │                          │
│         │ ─────────────────────────► │                          │
│         │   (distance-based time)    │                          │
│         │                            │                          │
│         │                       ┌────┴────┐                     │
│         │                       │ +5,000  │                     │
│         │                       │ defense │                     │
│         │                       │ power   │                     │
│         │                       └────┬────┘                     │
│  ┌──────┴──────┐                     │                          │
│  │ -5,000      │                     │                          │
│  │ garrison    │                     │                          │
│  │ (weaker)    │                     │                          │
│  └─────────────┘                     │                          │
│                                      │                          │
│  RECALL OPTIONS:                     │                          │
│  ─────────────────────────────────────────────────────────────  │
│  • Sender clicks "Recall" → units travel back                  │
│  • Receiver clicks "Relieve" → units travel back               │
│  • Sender attacked → AUTO-RECALL (emergency return)            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Reinforcement Capacity Formula

```rust
/// Calculate player's max reinforcement capacity (units they can RECEIVE)
/// Base: 500 units
/// + Research: Reinforcement Capacity (up to +4,500)
/// Maximum: 5,000 units
pub fn calculate_max_reinforcement_capacity(
    research: &ResearchProgress,
) -> u64 {
    const BASE_CAPACITY: u64 = 500;
    const MAX_CAPACITY: u64 = 5000;

    // Research: Reinforcement Capacity (15 levels × 300 = 4,500 max)
    let research_bonus = research.reinforcement_capacity_level as u64 * 300;

    let total = BASE_CAPACITY.saturating_add(research_bonus);
    core::cmp::min(total, MAX_CAPACITY)
}

/// Calculate sender's max units to send (30% of their defensive units)
pub fn calculate_max_send_amount(player: &PlayerAccount) -> u64 {
    let total_defensive = player.defensive_unit_1
        .saturating_add(player.defensive_unit_2)
        .saturating_add(player.defensive_unit_3);

    // 30% max
    (total_defensive * 30) / 100
}
```

### Reinforcement Account (PDA)

```rust
/// Reinforcement record
/// PDA: [b"reinforcement", sender.key(), receiver.key()]
/// Only ONE active reinforcement per sender-receiver pair
#[repr(C)]
pub struct ReinforcementAccount {
    // Identity (64 bytes)
    pub sender: Pubkey,                 // 32 bytes - Who sent troops
    pub receiver: Pubkey,               // 32 bytes - Who receives defense

    // Hero (33 bytes)
    pub sender_hero: Pubkey,            // 32 bytes - Hero mint (NULL_PUBKEY if none)
    pub hero_slot: u8,                  // 1 byte - Which slot hero came from (0-2)

    // Units sent (24 bytes) - Only defensive units
    pub units_def_1: u64,               // 8 bytes
    pub units_def_2: u64,               // 8 bytes
    pub units_def_3: u64,               // 8 bytes

    // Timing (24 bytes)
    pub sent_at: i64,                   // 8 bytes - When sent
    pub arrived_at: i64,                // 8 bytes - When arrived (0 if traveling)
    pub recall_initiated: i64,          // 8 bytes - When recall started (0 if not)

    // Travel info (16 bytes)
    pub origin_city: u16,               // 2 bytes - Sender's city
    pub destination_city: u16,          // 2 bytes - Receiver's city
    pub travel_duration: u32,           // 4 bytes - Seconds for one-way travel
    pub bump: u8,                       // 1 byte
    pub _padding: [u8; 7],              // 7 bytes
}
// Total: 161 bytes

impl ReinforcementAccount {
    pub const LEN: usize = 168; // Aligned to 8 bytes

    /// Total units in this reinforcement
    pub fn total_units(&self) -> u64 {
        self.units_def_1
            .saturating_add(self.units_def_2)
            .saturating_add(self.units_def_3)
    }

    /// Check if reinforcement is active (arrived and not recalled)
    pub fn is_active(&self, now: i64) -> bool {
        self.arrived_at > 0
            && self.recall_initiated == 0
    }

    /// Check if being recalled and has returned to sender
    pub fn has_returned(&self, now: i64) -> bool {
        self.recall_initiated > 0
            && now >= self.recall_initiated + self.travel_duration as i64
    }

    /// Calculate defense power contribution
    pub fn defense_power(&self) -> u64 {
        let base = (self.units_def_1 * 1)
            .saturating_add(self.units_def_2 * 2)
            .saturating_add(self.units_def_3 * 3);

        // +20% if hero present
        if self.sender_hero != NULL_PUBKEY {
            (base * 12000) / 10000
        } else {
            base
        }
    }
}
```

### Travel Cost Formula

```rust
/// Calculate travel cost for reinforcements (sender pays)
/// Based on distance and unit count
/// Cost in NOVI (burned)
pub fn calculate_travel_cost(
    distance_km: f64,
    total_units: u64,
) -> u64 {
    // Base cost: 1 NOVI per 10 units per km
    // Example: 500 units, 20 km = 500/10 * 20 = 1,000 NOVI

    let unit_factor = (total_units + 9) / 10; // Round up
    let distance_factor = (distance_km * 100.0) as u64; // Convert to "centi-km"

    (unit_factor * distance_factor) / 100
}
```

---

## New Battle Research Nodes

Add these to the existing Battle Research category:

```
┌─────────────────────────────────────────────────────────────────┐
│              NEW BATTLE RESEARCH NODES                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  NODE: Military Logistics                                       │
│  ──────────────────────────────────────────────────────────────│
│  Category: Battle                                               │
│  Max Levels: 1 (unlock only)                                   │
│  Effect: UNLOCKS reinforcement system                          │
│  Prerequisite: Defense Power level 10                          │
│  Cost: 50,000 NOVI                                             │
│  Time: 24 hours                                                │
│                                                                 │
│  ──────────────────────────────────────────────────────────────│
│                                                                 │
│  NODE: Deployment Efficiency                                    │
│  ──────────────────────────────────────────────────────────────│
│  Category: Battle                                               │
│  Max Levels: 20                                                │
│  Effect: +1% max deployment per level → +20% total             │
│  Prerequisite: Attack Power level 5                            │
│  Base Cost: 10,000 NOVI                                        │
│  Base Time: 2 hours                                            │
│  Scaling: 1.5x per level                                       │
│                                                                 │
│  ──────────────────────────────────────────────────────────────│
│                                                                 │
│  NODE: Reinforcement Capacity                                   │
│  ──────────────────────────────────────────────────────────────│
│  Category: Battle                                               │
│  Max Levels: 15                                                │
│  Effect: +300 reinforcement slots per level → +4,500 total     │
│  Prerequisite: Military Logistics level 1                      │
│  Base Cost: 20,000 NOVI                                        │
│  Base Time: 4 hours                                            │
│  Scaling: 1.5x per level                                       │
│                                                                 │
│  ──────────────────────────────────────────────────────────────│
│                                                                 │
│  UPDATED TECH TREE:                                             │
│                                                                 │
│  Battle Tree:                                                   │
│  ├─ Attack Power (no prereq)                                   │
│  │   └─► Deployment Efficiency (prereq: Attack 5)              │
│  │   └─► Ambush Damage (prereq: Attack 15)                     │
│  ├─ Defense Power (no prereq)                                  │
│  │   └─► Military Logistics (prereq: Defense 10)               │
│  │       └─► Reinforcement Capacity (prereq: Logistics 1)      │
│  ├─ Critical Hit Chance → requires Attack Power lvl 10         │
│  ├─ Critical Hit Damage → requires Critical Hit Chance lvl 10  │
│  └─ Rally Capacity → requires Attack 5, Defense 5              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Research Template Data

```rust
// Military Logistics (research_type = 30)
ResearchTemplate {
    research_type: 30,
    category: 0, // Battle
    max_level: 1,
    base_time_seconds: 86400, // 24 hours
    base_novi_cost: 50_000,
    buff_type: 30, // UNLOCK_REINFORCEMENTS
    buff_per_level_bps: 0, // Just an unlock
    prerequisite_research: 1, // Defense Power
    prerequisite_level: 10,
    gem_cost_per_minute: 5,
    is_active: true,
}

// Deployment Efficiency (research_type = 31)
ResearchTemplate {
    research_type: 31,
    category: 0, // Battle
    max_level: 20,
    base_time_seconds: 7200, // 2 hours
    base_novi_cost: 10_000,
    buff_type: 31, // DEPLOYMENT_EFFICIENCY
    buff_per_level_bps: 100, // +1% per level
    prerequisite_research: 0, // Attack Power
    prerequisite_level: 5,
    gem_cost_per_minute: 2,
    is_active: true,
}

// Reinforcement Capacity (research_type = 32)
ResearchTemplate {
    research_type: 32,
    category: 0, // Battle
    max_level: 15,
    base_time_seconds: 14400, // 4 hours
    base_novi_cost: 20_000,
    buff_type: 32, // REINFORCEMENT_CAPACITY
    buff_per_level_bps: 300, // +300 units per level (stored as raw, not bps)
    prerequisite_research: 30, // Military Logistics
    prerequisite_level: 1,
    gem_cost_per_minute: 3,
    is_active: true,
}
```

---

## Time-Based Combat Modifiers

Integration with the existing φ-based time cycle system:

```
┌─────────────────────────────────────────────────────────────────┐
│              TIME-BASED COMBAT MODIFIERS                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  TIME        │ ATTACK    │ DEFEND    │ STRATEGIC IMPLICATION    │
│  ───────────┼───────────┼───────────┼─────────────────────────  │
│  DeepNight  │ φ (1.62x) │ 1/φ (.62) │ PRIME ATTACK WINDOW      │
│  Dawn       │ √φ (1.27) │ 1.0x      │ Surprise attacks work    │
│  Morning    │ 1.0x      │ √φ (1.27) │ Defenders waking up      │
│  Midday     │ 1.0x      │ φ (1.62x) │ PRIME DEFENSE WINDOW     │
│  Afternoon  │ 1.0x      │ √φ (1.27) │ Defenders still alert    │
│  Dusk       │ 1.0x      │ 1.0x      │ Neutral window           │
│  Evening    │ 1.0x      │ 1.0x      │ Preparing for night      │
│                                                                 │
│  COMBAT OUTCOME FORMULA:                                        │
│  ───────────────────────────────────────────────────────────── │
│                                                                 │
│  attacker_power = deployed_attack × time_attack_mult            │
│  defender_power = garrison_defense × time_defense_mult          │
│                                                                 │
│  Example (DeepNight attack):                                    │
│  Attacker: 3,000 power × 1.618 = 4,854 effective               │
│  Defender: 2,500 power × 0.618 = 1,545 effective               │
│  Ratio: 4,854 / 1,545 = 3.14x advantage!                       │
│                                                                 │
│  Example (Midday attack):                                       │
│  Attacker: 3,000 power × 1.0 = 3,000 effective                 │
│  Defender: 2,500 power × 1.618 = 4,045 effective               │
│  Ratio: 3,000 / 4,045 = 0.74x (defender advantage!)            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## PlayerAccount Additions

Fields to add for combat system:

```rust
// Add to PlayerAccount struct:

// Combat Power (cached, 16 bytes)
pub total_attack_power: u64,        // 8 bytes - Calculated on unit/equip change
pub total_defense_power: u64,       // 8 bytes - Calculated on unit/equip/reinf change

// Deployment tracking (8 bytes for flag + separate DeploymentState if active)
pub has_active_deployment: bool,    // 1 byte
pub has_reinforcements_sent: bool,  // 1 byte - Any reinforcements out
pub reinforcements_received: u8,    // 1 byte - Count of active incoming reinforcements
pub _padding_combat: [u8; 5],       // 5 bytes

// Research unlock flags (add to existing)
pub has_reinforcements: bool,       // 1 byte - Military Logistics unlocked
```

---

## Instructions Overview

### Deployment Instructions

| ID | Instruction | Description |
|----|-------------|-------------|
| 140 | StartDeployment | Begin attack with selected units |
| 141 | CancelDeployment | Recall units before arrival (abort attack) |
| 142 | ExecuteAttack | Process attack on arrival (can be cranked) |
| 143 | CompleteReturn | Process unit return home (can be cranked) |

### Reinforcement Instructions

| ID | Instruction | Description |
|----|-------------|-------------|
| 150 | SendReinforcement | Send defensive units to teammate |
| 151 | RecallReinforcement | Sender recalls their units |
| 152 | RelieveReinforcement | Receiver dismisses reinforcements |
| 153 | ProcessReinforcementArrival | Crank: mark reinforcement as arrived |
| 154 | ProcessReinforcementReturn | Crank: return units to sender |

---

## Summary

This combat system creates deep strategic gameplay:

1. **Unit Specialization**: Defensive units fight, operative units produce
2. **Deployment Risk**: Send more troops = stronger attack but weaker home defense
3. **Team Cooperation**: Reinforcements add defense but cost sender's garrison
4. **Time Strategy**: Attack at night (φ bonus), defend at midday (φ bonus)
5. **Research Progression**: Unlock and improve deployment/reinforcement capabilities

```
┌─────────────────────────────────────────────────────────────────┐
│              STRATEGIC DECISION MATRIX                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  "Should I attack?"                                             │
│  ├── How many units can I deploy? (deployment efficiency)       │
│  ├── What time is it? (night = attack bonus)                    │
│  ├── Who's defending me? (reinforcements from team)             │
│  └── What's the risk if I'm counter-attacked?                  │
│                                                                 │
│  "Should I send reinforcements?"                                │
│  ├── Is my teammate under threat?                              │
│  ├── Can I spare the garrison?                                 │
│  ├── Should I send a hero for +20% bonus?                      │
│  └── What's the travel time/cost?                              │
│                                                                 │
│  "How should I build my army?"                                  │
│  ├── More defensive = better combat                            │
│  ├── More operative = better economy                           │
│  └── Balance based on playstyle and team role                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

---

## Summary

This architectural change document covers:

### Part I: Account Architecture & Shop
- **Resizable accounts** via `realloc()` for progressive unlocking
- **Equipment variety** with 6 distinct types
- **Consumables** (11 types) and **materials** (5 tiers)
- **Inventory system** with 16 slots
- **Time-based sales** (daily, flash, weekly)
- **Bundle system** with automatic discounts
- **Cosmetics** (6 categories, 64 items each)

### Part II: Game Systems
- **All systems reviewed**: Events, Encounters, Teams, Research, Rallies, Heroes, Cities, Loot
- **Status**: All use `u8` enums - extensible to 256 values without changes
- **Optional enhancements**: Listed for future consideration (not required now)

### Part III: Leaderboards
- **Event leaderboards**: Built-in, per-event, top 10
- **General leaderboards**: 10 categories, top 10 each (~416 bytes per leaderboard)
- **Team leaderboards**: 8 categories, top 10 each (~416 bytes per leaderboard)
- **Seasonal leaderboards**: Quarterly reset with prestige rewards

### Part IV: Extensibility
- **Cross-system triggers**: Clear integration map
- **New system checklist**: Standards for additions
- **Version migration**: Safe upgrade path

### Part V: Strategic Combat System
- **Unit role separation**: Defensive units (combat), Operative units (economy)
- **Attack Power formula**: Base + Equipment + Research + Hero + Level bonuses
- **Defense Power formula**: Garrison + Reinforcements + bonuses
- **Deployment system**: Choose units to send, travel time, risk/reward
- **Reinforcement system**: Team-only, sender pays, hero bonus
- **New Battle Research**: Military Logistics, Deployment Efficiency, Reinforcement Capacity
- **Time-based modifiers**: φ bonuses for night attacks, midday defense

---

*"In Novus Mundus, the prepared player prospers."*
