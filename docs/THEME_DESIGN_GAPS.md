# Multi-Theme Design Gaps

> Places in `programs/novus_mundus/` where the multi-theme design (Medieval / Cyberpunk / SciFi / Modern / PostApocalyptic) doesn't translate cleanly. This is a discussion doc — pick which items to fix.

## Theme design recap

The intended model:
- `GameEngine.kingdom_theme` is set per kingdom (5 themes defined in `src/types.rs`).
- Core mechanics stay identical across themes; only **display names** and **visual flavor** change.
- Generic concepts in code (`defensive_unit_1/2/3`, `melee_weapons`, etc.) get re-skinned by the SDK.

Where this breaks down: many code paths bake theme-specific terminology into struct fields, enum variants, error names, and even mechanic behaviors.

---

## Heavily baked-in fantasy / medieval terminology


### 2. Estate buildings
**File**: `src/state/estate.rs:14-43` (`BuildingType` enum)

The enum variants include several names that are not just cosmetic — they reference specific real-world activities:

```rust
pub enum BuildingType {
    Mansion = 0,
    Barracks = 1,
    Workshop = 2,
    Dock = 4,       // Fishing expeditions
    Forge = 5,
    Market = 6,
    Academy = 7,
    Arena = 8,
    Sanctuary = 9,
    Observatory = 10,
    Treasury = 11,
    Citadel = 12,
    Camp = 13,
    Mine = 14,
    Catacombs = 15, // Dungeon access
    Farm = 16,
    Stables = 17,   // Travel gating
    Infirmary = 18,
}
```

Two distinct problems:
- **Cosmetic naming**: `Mansion`, `Forge`, `Sanctuary` can be re-skinned by the SDK. Fine.
- **Activity-baked names**: `Stables` literally implies horses. `Dock` literally implies water. `Catacombs` is a fantasy-horror term tied to dungeon access. `Forge` implies metal-working.

**Proposed fix options**:

**A. Cosmetic rename only (cheap)** — Rename the most egregious activity-baked variants to genre-neutral:
- `Stables` → `TransportBay` (or `Garage`)
- `Catacombs` → `LowerLevels` (or simply `DungeonEntry`)
- `Sanctuary` → `MeditationChamber`
- `Forge` → keep (concept of crafting station is universal enough) or → `Workshop2`

Then the SDK reskins per theme.

**B. Numbered slots (deep refactor)** — Drop the enum variants entirely; use building-id integers with a per-kingdom config table mapping `id → required_level + display_key`. Big change.

**Recommendation**: Option A. Two or three surgical renames close the worst gaps. `Catacombs` in particular is hardcoded into the dungeon system as a building requirement (`CatacombsRequired` error).

**Effort**: 1–2 hour rename across grep matches.
**Severity**: medium — players in Cyberpunk would see "Stables" in their UI.

---

### 3. Dungeon themes
**File**: `src/state/dungeon.rs:101-123`

```rust
pub enum DungeonTheme {
    Crypts = 0,   // Undead - Holy damage, Radiant aura
    Caverns = 1,  // Beasts - Beast slayer, Trap detection
    Abyss = 2,    // Demons - Demon bane, Darkness resistance
    Forge = 3,    // Constructs - Siege specialist, Armor pierce
}
```

"Undead / Holy / Demons / Radiant" don't translate to Cyberpunk. In a sci-fi kingdom what is "Holy damage"?

**Proposed fix**: Rename variants to abstract mechanical categories rather than mythological flavor:
- `Crypts` → `RadiantWeakness`
- `Caverns` → `FastMobs` 
- `Abyss` → `DarknessVulnerable`
- `Forge` → `ArmoredMobs` 

Then theme-flavored names ("Crypts" / "Server Farms" / "Voidspace" / "Fab Plant") come from the SDK.

**Effort**: 1 hour — enum rename + a few `match` arms.
**Severity**: medium-low — the enum is small, but the names leak into event payloads and templates.

---

### 5. Relic names in comments and code
**Files**: `src/constants.rs:393-454`, `src/helpers/dungeon.rs`

Relic IDs are 0-19 (good — mechanic-only). But the names leak via comments:

```rust
// 0: Warrior's Fury (+15% attack)
// 4: Vampiric Touch (5% lifesteal)
// 5: Shadow Cloak (-30% darkness)
// 11: Phoenix Feather (one-time resurrection)
// 12: Berserker (+30% attack, +15% damage taken)
// 13: Stalwart (cannot be one-shot)
```

Names like `Phoenix Feather`, `Vampiric Touch`, `Shadow Cloak` are fantasy-genre. Function names in `helpers/dungeon.rs` (`has_phoenix_feather`, `has_stalwart`, `has_torch_bearer`) further entrench them.

**Need to check**: do any `events/*.rs` emit relic display names as strings? If yes, those are theme-leaks.

**Proposed fix**:
- Drop fantasy names from comments — refer by ID and **mechanical effect** only (e.g. `// 4: lifesteal 5%` instead of `// 4: Vampiric Touch (5% lifesteal)`).
- Rename function names: `has_phoenix_feather` → `has_resurrection_relic`; `has_stalwart` → `has_one_shot_immunity_relic`.
- SDK supplies theme-mapped display names.

**Effort**: 30 min mechanical refactor.
**Severity**: low — code-internal only, but the file reads as a D&D rulebook.

---

## Theme-neutral elements (already work fine)

These do **not** need fixing:

- `defensive_unit_1/2/3`, `operative_unit_1/2/3` — generic numbered slots ✅
- `melee_weapons`, `ranged_weapons`, `siege_weapons`, `armor_pieces` — abstract attack categories ✅
- Time periods (`DeepNight`, `Dawn`, `Dusk`, `Midday`, etc.) — universal across themes ✅
- Encounter rarity ladder (`Common` → `Uncommon` → `Rare` → `Epic` → `Legendary` → `WorldEvent`) — generic RPG ✅
- `cash_on_hand`, `cash_in_vault`, NOVI, `vehicles`, `produce` — abstract economic primitives ✅
- Travel mechanics (`Intracity` / `Intercity`) — universal ✅

---

## Priority recommendation

In order of effort-to-impact ratio:

| Priority | Item | Effort | Impact |
|---|---|---|---|
| **1** | **#4** Rename `HeroSpecialization::Mystic` → `Tactician` | 5 min | Removes the most obvious magic-system leak |
| **2** | **#5** Scrub fantasy relic names from comments; rename `has_phoenix_feather`-style helpers | 30 min | Code reads as mechanical, not as fantasy lore |
| **3** | **#3** Rename `DungeonTheme` variants to mechanical categories | 1 hr | Removes fantasy from a customer-facing enum that ships in events |
| **4** | **#2A** Rename `Stables`, `Catacombs`, `Sanctuary` building variants | 1–2 hr | Removes the worst literal-implausibility (horses, crypts) from non-medieval kingdoms — **confirmed in scope** |
| **5** | **#1** Add explanatory comment to `state/castle.rs` and `state/dungeon.rs` clarifying naming convention | 5 min | Documents intent without code churn |
| **6** | **#6/#7** Document Mining/Fishing/Farming as reskinnable categories | 5 min | No code change; intent docs only |

### Estate building rename plan (#2A — confirmed)

When picking up #2A, the concrete rename list and downstream touchpoints:

| Old variant | New variant | Why |
|---|---|---|
| `Stables` | `TransportBay` | "Stables" literally means horse housing |
| `Catacombs` | `Dungeon` (or `LowerLevels`) | Tightly coupled to dungeon-access; fantasy-horror flavor |
| `Sanctuary` | `MeditationChamber` | Religious connotation; meditation is the actual mechanic |

Optional second-pass renames (more cosmetic — discuss before applying):
- `Mansion` → `Estate` or `Hub` — but `Mansion` is mostly fine and `Estate` would collide with the parent account name.
- `Forge` → `Workshop2` or `CraftingStation` — but `Forge` is broadly recognized as a crafting-station archetype across themes. Probably keep.
- `Citadel` → `Bastion` — feudal vs. generic-defensive. Marginal.
- `Camp` → `Outpost` — both work.

**Downstream touchpoints to update when renaming**:
- `BuildingType` enum (`src/state/estate.rs:14-43`)
- Error variants: `StablesRequired`, `CatacombsRequired`, `SanctuaryRequired` in `src/error.rs`
- All `BuildingType::Stables` / `BuildingType::Catacombs` / `BuildingType::Sanctuary` matches across `src/processor/estate/`, `src/processor/dungeon/`, `src/processor/sanctuary/`, `src/helpers/estate.rs`
- Constants referencing the building names (e.g. `MINING_WORKSHOP_REQ` is unaffected, but check `FISHING_DOCK_REQ` and any sanctuary/catacomb-specific config)
- Event payload field names if any leak the building names
- SDK / cli / tests fixtures

**Suggested execution**: do it as one atomic PR — enum rename + error variant rename + all match-arm updates + matching error code preserved. The `repr(u8)` discriminant values must stay identical to preserve on-chain serialization compatibility.

## What to skip

- **#2B** (numbered building IDs with config-driven names) — too much surgery for the marginal win. Stick with option A.
- Renaming `king/court/garrison` field names — touches 30+ files for cosmetic gain. The convention comment in #1 is enough.
- Renaming `Forge` building to fully generic terms — `Forge` as a crafting station works in most settings.