# Estate System Implementation Status

> Last Updated: December 7, 2025
>
> **Scope:** On-chain program only. Client work has not started.
> **Program Status:** New - no migrations needed.

---

## Fully Implemented

### Core Estate Infrastructure
- [x] `EstateAccount` state with building slots, plots, level
- [x] `BuildingSlot` with type, level, status, construction times, mastery XP
- [x] All 12 building types enum
- [x] `processor/estate/create.rs` - Estate creation
- [x] `processor/estate/build.rs` - Building construction
- [x] `processor/estate/upgrade.rs` - Building upgrade
- [x] `processor/estate/complete.rs` - Construction completion
- [x] `processor/estate/buy_plot.rs` - Plot purchase

### Daily Mini-Game System
- [x] `processor/estate/daily_activity.rs` - All 12 building activities
- [x] Time window system (Dawn, Morning, Afternoon, Dusk, Night, Midnight)
- [x] Score-based rewards with buff grants
- [x] All buffs wired to consumption points

### Daily Claim (Mansion)
- [x] `processor/estate/daily_claim.rs` - Login streak rewards
- [x] Streak multipliers (1.0x → 3.0x)
- [x] Mansion level bonus (+5% per level)
- [x] Milestone rewards at 7/14/30/60/90/180 days
- [x] Permanent +5% bonus at 180-day milestone

### Forge Crafting (Staged Tempering)
- [x] `CraftedEquipmentAccount` state
- [x] 8-tier quality system (Common → Divine)
- [x] 4 equipment types (Melee, Ranged, Siege, Armor)
- [x] `processor/forge/initialize.rs`
- [x] `processor/forge/start_craft.rs`
- [x] `processor/forge/strike.rs` - Timing mechanic with precision scoring
- [x] `processor/forge/abandon_craft.rs`
- [x] `processor/forge/equip.rs` - Equip/unequip crafted items
- [x] Mastery XP on craft completion

### Building Buff Integration
All daily activity buffs are consumed by their target instructions:

| Buff | Set By | Consumed In |
|------|--------|-------------|
| `unit_effectiveness_bps` | Barracks | attack_player, attack_encounter |
| `mastery_bonus_bps` | Forge | strike.rs (craft completion) |
| `arena_damage_bps` | Arena | attack_player.rs |
| `daily_loot_bonus_bps` | Observatory | attack_encounter.rs |
| `market_discount_bps` | Market | shop purchases |
| `blessed_hero_bonus_bps` | Sanctuary | combat |
| `citadel_stance` | Citadel | attack_player.rs (defense) |

---

## Per-Building Status

### Tier 1: Foundation Buildings

#### Mansion
| Feature | Design Doc | Status |
|---------|-----------|--------|
| Daily login + streak | Login claim system | ✅ Implemented |
| XP/Reputation buff | Per-level passive | ✅ Building buffs |

#### Barracks
| Feature | Design Doc | Status |
|---------|-----------|--------|
| Daily drill (buff) | +5-15% unit effectiveness | ✅ daily_activity.rs |
| Unit hiring | NOVI → units | ✅ hire_units.rs (instant) |
| Barracks level gate | Tier 1/2/3 units | ✅ Required L1/L5/L10 |
| Permanent buffs | attack_bps, training_speed_bps | ✅ Cached |

**Design Doc features NOT implementing:**
- Training queue (timed) - Keeping instant
- Elite unit variants - Deferred

#### Workshop
| Feature | Design Doc | Status |
|---------|-----------|--------|
| Daily activity (materials) | Sorting game | ✅ daily_activity.rs |
| Resource collection | Passive generation | ✅ collect_resources.rs |
| Permanent buffs | resource_gen_bps | ✅ Cached |
| Material conversion | 100 tier N → 20 tier N+1 | ✅ convert_materials.rs (ID: 167) |

#### Vault
| Feature | Design Doc | Status |
|---------|-----------|--------|
| Daily activity (materials) | Observation game | ✅ daily_activity.rs |
| Team transfers | cash_on_hand between team members | ✅ transfer_cash.rs |
| Vault level bonus | +100%/+250%/unlimited transfer limit | ✅ vault_transfer_bonus_bps |
| Raid protection | % of cash_in_vault protected | ✅ safebox_protection_percent |
| Deposit/withdraw | cash_on_hand ↔ cash_in_vault | ✅ vault_transfer.rs (ID: 19) |

**Safebox Rules:**
- Max 75% of total cash can be in vault (from GameEngine.safebox_protection_percent)
- If deposit exceeds limit, only allowed amount is deposited
- Withdraw has no limit

**NOT implementing:**
- Interest on vault (adds complexity, not core)

---

### Tier 2: Advanced Buildings

#### Forge
| Feature | Design Doc | Status |
|---------|-----------|--------|
| Daily activity (mastery buff) | Precision game | ✅ daily_activity.rs |
| Staged Tempering | Multi-strike crafting | ✅ Full system |
| Material consumption | Materials consumed on craft | ✅ start_craft.rs |
| Mastery XP | XP on completion | ✅ strike.rs |
| Equipment equipping | Per-type slots | ✅ equip.rs |
| Quality tiers | 8 tiers with bps bonuses | ✅ Full system |

**TODO:**
- [ ] Salvaging (break down items → materials)

**NOT implementing (excessive complexity):**
- Reforging (stat reroll)
- Enchanting (special effects)

#### Market
| Feature | Design Doc | Status |
|---------|-----------|--------|
| Daily activity (discount) | Deal Finder game | ✅ daily_activity.rs |
| Shop discount | market_discount_bps applied | ✅ shop purchases |

**TODO:**
- [ ] Oracle-based price fluctuation (dynamic pricing)

**DEFERRED to future:**
- Player-to-player trading (escrow system)

#### Academy
| Feature | Design Doc | Status |
|---------|-----------|--------|
| Daily activity (time reduction) | Reduces active research time | ✅ daily_activity.rs |
| Mastery speed bonus | m²/φ formula | ✅ start_research.rs |
| Mastery cost discount | m×φ×10 formula | ✅ start_research.rs |
| Research ascension | +25% buff at max level | ✅ ascend.rs (ID: 127) |

**Academy Mastery System (φ-based):**
- Daily activity: Reduces research time by `score × (10 + mastery/10) × level/2` seconds
- Speed bonus: `mastery² / φ` bps (mastery 100 = 61.8% faster)
- Cost discount: `mastery × φ × 10` bps (mastery 100 = 16.18% off)
- Ascension: Costs Fibonacci mastery (5, 8, 13, 21...) to ascend maxed nodes

#### Arena
| Feature | Design Doc | Status |
|---------|-----------|--------|
| Daily activity (damage buff) | Combat game | ✅ daily_activity.rs |
| arena_damage_bps | Applied to PvP | ✅ attack_player.rs |

**DEFERRED (complex system):**
- Full PvP matchmaking system
- Champion configuration
- Leaderboards/rankings
- Arena seasons

---

### Tier 3: Legendary Buildings

#### Sanctuary
| Feature | Design Doc | Status |
|---------|-----------|--------|
| Daily activity (hero buff) | Choice game | ✅ daily_activity.rs |
| blessed_hero_bonus_bps | +25% to chosen hero | ✅ combat |
| Hero meditation | Passive leveling (φ-based) | ✅ sanctuary processor (ID: 137, 138) |

**Two-Phase Hero Progression:**
1. **Phase 1 (Meditation)**: Free, slow passive leveling
   - XP per hour = sanctuary_level × 100 (5× the original rate; bumped
     alongside the Sanctuary-rebalance pass — see
     `helpers/estate.rs::sanctuary_meditation_xp_per_hour`)
   - XP per level: Linear 200×level (1-19), then 11,200 × 1.1^(level-20)
   - Cap = floor(10 × φ^(sanctuary_level/5)); examples: Lv 5 ≈ 16,
     Lv 10 ≈ 26, Lv 15 ≈ 42, Lv 20 ≈ 69 (helpers/estate.rs::meditation_level_cap)

2. **Phase 2 (Fragments)**: Beyond meditation cap, use level_up.rs
   - Fragment cost: 10 × 1.5^level (exponential)
   - Faster but costs resources

**Meditation XP Scaling (at Sanctuary Lv 2 — 200 XP/hr, 8h/day play):**
| Hero Level | XP Required | Time |
|------------|-------------|------|
| 1 | 200 | 1 hour |
| 5 | 1,000 | 5 hours |
| 10 | 2,000 | 1.25 days |
| 15 | 3,000 | 1.9 days |
| 19 | 3,800 | 2.4 days |
| 1-19 total | 38,000 | ~24 days |
| 20 | 11,200 | **1 week** |
| 21 | 12,320 | 1.1 weeks |
| 26 | ~18,000 | 1.6 weeks |

At higher Sanctuary tiers the same table compresses linearly: Lv 10
runs 5× this rate, Lv 20 runs 10×.

**Formula:**
- Levels 1-19: `200 × level` (linear, fast early game)
- Levels 20+: `11,200 × 1.1^(level-20)` (1 week base, +10% compound)

**Meditation Caps (φ-based):**
| Sanctuary Lv | Cap | Time to Cap (8h/day) |
|--------------|-----|----------------------|
| 5 | 16 | ~2 weeks |
| 10 | 26 | ~3.5 months |
| 15 | 42 | ~8 months |
| 20 | 69 | ~2 years |

**State:**
- `hero.meditation_xp` stores accumulated XP between sessions
- XP persists until converted to levels

**TODO:**
- [ ] Fragment tier conversion (100 common → 20 uncommon, etc.)

**DROPPED:**
- Synergy chamber (hero combination bonuses) - excessive complexity
- Awakening ritual (permanent hero upgrade)
- Artifact vault

#### Observatory
| Feature | Design Doc | Status |
|---------|-----------|--------|
| Daily activity (loot buff) | Pattern game | ✅ daily_activity.rs |
| daily_loot_bonus_bps | +5-25% encounter loot | ✅ attack_encounter.rs |

**DEFERRED to future:**
- Player location map (strategic intel)
- Encounter spawn visibility

#### Treasury
| Feature | Design Doc | Status |
|---------|-----------|--------|
| Daily activity (NOVI mint) | Memory game | ✅ daily_activity.rs (mints tokens) |

**DROPPED:**
- NOVI staking system (adds complexity, daily mint is sufficient)

#### Citadel
| Feature | Design Doc | Status |
|---------|-----------|--------|
| Daily activity (stance) | Review game | ✅ daily_activity.rs |
| citadel_stance | Defense modifier | ✅ attack_player.rs |
| Rally damage bonus | citadel_rally_damage_bps | ✅ rally execution |

**NOT implementing:**
- Fortress/Raid boss mode (excessive complexity)

---

## Deferred Systems (Separate from Buildings)

These are complete separate systems, not building features:

| System | Reason | Future Phase |
|--------|--------|--------------|
| King's Castle | Territorial control - see KINGS_CASTLE.md | Phase 2+ |
| Arena PvP Matchmaking | Full ranking/matchmaking system | Phase 2+ |
| Mining/Fishing | Active gathering mini-games | Phase 2+ |
| Player-to-Player Trading | Escrow-based marketplace | Phase 2+ |
| Observatory Player Map | All player locations visible | Phase 2+ |
| Team HQ Buildings | Shared team facilities | Phase 2+ |

---

## TODO Summary (Priority Order)

### Completed
1. [x] **Vault deposit/withdraw** - ✅ vault_transfer.rs (ID: 19)
2. [x] **Material conversion** - ✅ convert_materials.rs (ID: 167)
3. [x] **Forge material consumption** - ✅ start_craft.rs uses materials
4. [x] **Academy mastery system** - ✅ φ-based research bonuses
5. [x] **Research ascension** - ✅ ascend.rs (ID: 127)
6. [x] **Sanctuary meditation** - ✅ sanctuary processor (ID: 137, 138)

### Medium Complexity
7. [ ] **Market price oracle** - Dynamic pricing for shop items
8. [ ] **Forge salvaging** - Break equipment → materials

### Low Priority (Deferred)
9. [ ] **Fragment tier conversion** - 100 tier N → 20 tier N+1

---

## Instruction Routing (lib.rs)

| ID | Instruction | Status |
|----|-------------|--------|
| 19 | `economy::vault_transfer` | ✅ |
| 127 | `research::ascend` | ✅ |
| 137 | `sanctuary::start_meditation` | ✅ |
| 138 | `sanctuary::claim_meditation` | ✅ |
| 160 | `estate::create` | ✅ |
| 161 | `estate::build` | ✅ |
| 162 | `estate::upgrade` | ✅ |
| 163 | `estate::complete` | ✅ |
| 164 | `estate::buy_plot` | ✅ |
| 165 | `estate::daily_claim` | ✅ |
| 166 | `estate::daily_activity` | ✅ |
| 167 | `estate::convert_materials` | ✅ |
| 180 | `forge::initialize` | ✅ |
| 181 | `forge::start_craft` | ✅ |
| 182 | `forge::strike` | ✅ |
| 183 | `forge::abandon_craft` | ✅ |
| 184 | `forge::equip` | ✅ |

---

## Error Codes

### Estate System (7700-7733)
| Code | Name | Description |
|------|------|-------------|
| 7700 | EstateNotFound | Estate PDA doesn't exist |
| 7701 | EstateAlreadyExists | Estate already initialized |
| 7702 | BuildingRequired | Required building missing |
| 7703 | BuildingLevelInsufficient | Building level too low |
| 7704 | BuildingNotActive | Building under construction |
| 7705 | BuildingSlotFull | No empty building slots |
| 7706 | BuildingAlreadyExists | Building type already built |
| 7707 | BuildingUnderConstruction | Can't operate while building |
| 7708 | ConstructionNotComplete | Construction not finished |
| 7709 | InsufficientEstatePlots | Not enough plots |
| 7710 | EstateLevelInsufficient | Estate level too low |
| 7725 | CraftingInProgress | Can't start new craft |
| 7726 | NoCraftingInProgress | No active craft to strike |
| 7727 | CraftNotComplete | Craft not finished |
| 7728 | MasteryLevelInsufficient | Mastery too low for tier |
| 7729 | InsufficientMaterials | Missing crafting materials |
| 7730 | AlreadyClaimedToday | Daily already claimed |
| 7731 | DailyActivityNotAvailable | Building activity unavailable |
| 7732 | DailyWindowExpired | Missed time window |
| 7733 | WrongTimeWindow | Wrong time for building |

### Staged Tempering (7740-7743)
| Code | Name | Description |
|------|------|-------------|
| 7740 | StrikeTooEarly | Window hasn't opened |
| 7741 | CraftWindowMissed | Window closed, craft failed |
| 7742 | InvalidQualityTier | Invalid tier (e.g., Common) |
| 7743 | InsufficientCraftedItems | Don't own item to equip |

### Hero & Meditation (7760-7766)
| Code | Name | Description |
|------|------|-------------|
| 7760 | HeroAlreadyMeditating | A hero is already meditating |
| 7761 | HeroNotMeditating | No hero is currently meditating |
| 7762 | HeroNotInSlot | No hero in the specified active_heroes slot |
| 7763 | HeroMismatch | Hero account doesn't match expected hero |
| 7764 | HeroLocked | Hero is locked (already in use elsewhere) |
| 7765 | HeroAtMeditationCap | Hero at meditation cap - must use fragments |
| 7766 | WrongCityForMeditation | Hero requires meditation in specific origin city |
