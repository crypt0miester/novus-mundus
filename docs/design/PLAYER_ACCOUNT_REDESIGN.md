# Player Account Redesign — Lean Core + Real Sections

Status: **Design — pre-launch, no backward compatibility required**
Scope: `programs/novus_mundus/src/state/player.rs` + every processor/helper/logic call site that touches player fields + TS SDK `sdks/novus-mundus-ts/src/state/player.ts`.

## 1. Problem

Today `PlayerCore` is 1056 bytes and inlines fields for every "section" (research, heroes, inventory state, rally caps + stats, team ref, transfer tracking, shop state, meditation, reinforcement aggregates). The `*Section` structs after the core are defined and the account is resized to include them on unlock, but **no processor reads or writes those bytes** — only `CourtSection` is actually accessed at its offset. Net result:

- New players pay rent for ~545 bytes of "locked" feature data inlined in core.
- Resizes on unlock add 96/130/424/80/40/80 bytes that no code path touches — pure dead rent.
- The `extensions` bitmap works as a gameplay gate, but the byte‑accounting story is fiction.

Pre-launch is the right moment to fix this in one cut.

## 2. Goals

1. New player account starts at the smallest possible size — only fields needed to play from minute zero.
2. Each extension's data lives **only** in its section. No inline mirrors, no sync.
3. Unlocking an extension grows the account and pays additional rent for the bytes that section actually uses.
4. Section data is read/written **at its offset** through typed accessors; no duplication.
5. The unlock-order chain (`RESEARCH → INVENTORY → TEAM → RALLY → HEROES → COSMETICS → COURT`) is preserved as the gameplay gate.

## 3. Target Layout

### 3.1 Byte budget

| Region            | Size (bytes) | Notes                                                              |
|-------------------|--------------|--------------------------------------------------------------------|
| `PlayerCore`      | ~512         | Identity, units, equipment, cash, location, stamina, base stats    |
| `ResearchSection` | ~48          | Buffs + unlock flags + version + last_daily_claim                  |
| `InventorySection`| ~400         | Consumables, materials, equipped, shop state, transfer, 16 item slots |
| `TeamSection`     | ~112         | Team ref + slot index + reinforcement aggregates (72 bytes folded in) |
| `RallySection`    | ~80          | Caps + stats                                                       |
| `HeroesSection`   | ~144         | Active heroes [3], slots, buffs, location synergy, meditation_started_at |
| `CosmeticsSection`| ~80          | Equipped IDs + owned bitfields                                     |
| `CourtSection`    | ~48          | Unchanged                                                          |
| **Total max**     | **~1424**    | vs current 1946 — saves ~520 bytes at max, and ~544 at minimum     |

**Day-1 player footprint: ~512 bytes** (down from 1056). That's the headline.

### 3.2 Lean `PlayerCore` fields

Everything required from minute zero of gameplay:

- **Identity (96 bytes)**: `account_key u8`, `game_engine Address`, `owner Address`, `created_at i64`, `bump u8`, `version u8`, padding
- **Name (56 bytes)**: `name [u8; 48]`, `name_len u8`, padding
- **Extensions bitmap (8 bytes)**: `extensions u32`, padding
- **Locked NOVI (16 bytes)**: `locked_novi u64`, `last_updated_tokens_at i64`
- **Units (48 bytes)**: 6× `u64` (def_1/2/3, op_1/2/3) — starter resources granted on init
- **Equipment variety (48 bytes)**: 6× `u64` (melee/ranged/siege/armor/produce/vehicles) — starter
- **Cash (16 bytes)**: `cash_on_hand`, `cash_in_vault`
- **Happiness (8 bytes)**: 2× `f32`
- **Location (56 bytes)**: current + travel state, current/origin/destination city, departure/arrival, speed
- **Subscription (16 bytes)**: tier + expiry
- **Progression (32 bytes)**: level, current_xp, reputation, networth
- **Stamina (24 bytes)**: encounter_stamina, max, last update
- **Current event (8 bytes)**
- **Basic resources (16 bytes)**: gems, fragments
- **Lifetime stats (56 bytes)**: 7× `u64` (always tracked for rankings)
- **Protection & flags (16 bytes)**: `new_player_protection_until`, `flagged_by_governance`, padding
- **Loot counter (8 bytes)**

**Total: ~512 bytes.** Verified by `core::mem::size_of` compile-time assertion.

### 3.3 Section structs

Each is `#[repr(C)] Copy + Clone` with `LEN = size_of::<Self>()` and lives at a fixed offset after core. **No inline duplicates in `PlayerCore`.**

#### `ResearchSection` (~48 bytes)
```rust
pub struct ResearchSection {
    // Battle Buffs (12)
    pub attack_bps: u16, pub defense_bps: u16,
    pub crit_chance_bps: u16, pub crit_damage_bps: u16,
    pub loot_bonus_bps: u16, pub encounter_success_bps: u16,
    // Growth Buffs (12)
    pub synchrony_bonus_bps: u16, pub reputation_bonus_bps: u16,
    pub stamina_bonus_bps: u16, pub collection_bonus_bps: u16,
    pub loot_magnetism_bps: u16, pub daily_reward_bps: u16,
    // Unlock Flags (8)
    pub has_daily_rewards: bool, pub has_mining: bool, pub has_fishing: bool,
    pub has_fragment_drops: bool, pub has_gem_drops: bool, pub _reserved_flags: [u8; 3],
    // State (16)
    pub buff_version: u32, pub _pad: [u8; 4],
    pub last_daily_claim: i64,
}
```
Active research id/started/ends moves out — it already lives on the `ResearchProgress` PDA. No need to duplicate.

#### `InventorySection` (~400 bytes)
Keep ≈ current `InventorySection`. Consumables (32) + materials (24, u32 each) + equipped (24, w/ id+rarity+bps) + shop state (32) + transfer tracking (24) + slot_count + 16× `InventoryItem` slots (256). Add `_reserved` to align to nice boundary.

#### `TeamSection` (~112 bytes) — **absorbs reinforcement aggregates**
```rust
pub struct TeamSection {
    pub team: Address,                       // 32 — NULL_PUBKEY if no team
    pub team_slot_index: u16,                // 2
    pub _pad1: [u8; 6],
    // Reinforcement aggregates (72) — only meaningful with a team
    pub reinforcement_def_1: u64, pub reinforcement_def_2: u64, pub reinforcement_def_3: u64,
    pub reinforcement_melee: u64, pub reinforcement_ranged: u64, pub reinforcement_siege: u64,
    pub reinforcement_original_units: u64, pub reinforcement_original_weapons: u64,
    pub reinforcement_hero_defense_bps: u16,
    pub reinforcement_hero_weapon_eff_bps: u16,
    pub reinforcement_hero_armor_eff_bps: u16,
    pub reinforcement_source_count: u8, pub _pad_r: u8,
}
```
Rationale: you can only receive reinforcements once you have a team. Folding aggregates into `TeamSection` reflects that and avoids a redundant `EXT_REINFORCEMENT` flag.

#### `RallySection` (~80 bytes)
Keep current shape: caps (8) + current state (16) + lifetime stats (48) + reserved (8).

#### `HeroesSection` (~144 bytes)
```rust
pub struct HeroesSection {
    pub active_heroes: [Address; 3],            // 96
    pub defensive_hero_slot: u8,
    pub meditating_hero_slot: u8,               // 255 = none
    pub _pad: [u8; 6],
    // Aggregated buffs (36)
    pub hero_attack_bps: u16, pub hero_defense_bps: u16, pub hero_economy_bps: u16,
    pub hero_xp_gain_bps: u16, pub hero_training_cost_reduction_bps: u16,
    pub hero_collection_rate_bps: u16, pub hero_rally_capacity_bps: u16,
    pub hero_stamina_regen_bps: u16, pub hero_produce_generation_bps: u16,
    pub hero_weapon_efficiency_bps: u16, pub hero_armor_efficiency_bps: u16,
    pub hero_crit_chance_bps: u16, pub hero_encounter_damage_bps: u16,
    pub hero_loot_bonus_bps: u16, pub hero_synchrony_bonus_bps: u16,
    pub hero_resource_capacity_bps: u16, pub hero_unit_capacity_bps: u16,
    pub blessed_hero_bonus_bps: u16,
    // Location synergy (6)
    pub slot_location_bonus: [u16; 3],
    // Meditation (8)
    pub meditation_started_at: i64,
    pub _reserved: [u8; 6],
}
```

#### `CosmeticsSection` (~80 bytes)
Same as current definition (equipped IDs + owned bitfields). Currently dead-defined; this is the activation.

#### `CourtSection` (~48 bytes)
Unchanged. Already works correctly today.

### 3.4 Offsets
Computed in order from the section sizes above:
```
CORE_OFFSET      = 0
RESEARCH_OFFSET  = CORE_SIZE                       // ~512
INVENTORY_OFFSET = RESEARCH_OFFSET + RESEARCH_SIZE // ~560
TEAM_OFFSET      = INVENTORY_OFFSET + INVENTORY_SIZE
RALLY_OFFSET     = TEAM_OFFSET + TEAM_SIZE
HEROES_OFFSET    = RALLY_OFFSET + RALLY_SIZE
COSMETICS_OFFSET = HEROES_OFFSET + HEROES_SIZE
COURT_OFFSET     = COSMETICS_OFFSET + COSMETICS_SIZE
MAX_SIZE         = COURT_OFFSET + COURT_SIZE
```
Offsets follow the **unlock order** (current `prerequisite_for_extension`), so `size_for_extensions(ext)` remains a simple "highest bit set → that section's end offset" lookup.

## 4. API Surface

### 4.1 Section accessors on `PlayerAccount`

Add typed, bounds-checked accessors on `PlayerCore`. These take the raw account `&[u8]` (or `AccountView`) and return a reference at the section offset *iff* the corresponding extension bit is set.

```rust
impl PlayerCore {
    pub fn research<'a>(data: &'a [u8]) -> Result<&'a ResearchSection, ProgramError> { ... }
    pub fn research_mut<'a>(data: &'a mut [u8]) -> Result<&'a mut ResearchSection, ProgramError> { ... }
    // ... one pair per section
}
```
Behavior:
- If `extensions & EXT_X == 0` → return `GameError::<X>NotUnlocked` (existing error variants).
- If `data.len() < OFFSET + SIZE` → return `ProgramError::AccountDataTooSmall`.
- Otherwise cast at offset, identical to current `CourtSection` access pattern.

Drop `require_extension(player_core, EXT_X)` — section accessor itself is the gate. Keep `extensions` bitmap for cheap pre-checks (combat, shop) where we don't need the section data.

### 4.2 Unlock + resize

`unlock_extension_if_eligible(account, payer, EXT_X)` keeps its current shape:
1. Check prerequisite chain.
2. Set new bit.
3. Resize account to `size_for_extensions(new_extensions)`, transferring rent.
4. **New**: zero the new bytes and write the section's `init()` defaults at its offset.

Step 4 is the piece the current code skips (since nothing read the bytes). Now it matters.

### 4.3 Init path

`processor/initialization/player.rs`:
- `CreateAccount { space: PlayerCore::LEN, lamports: rent_exempt_const(PlayerCore::LEN), ... }` (currently `PlayerAccount::LEN`, which after redesign means lean core only).
- Call `init_with_city(...)` to populate core only — drop every field initializer that referenced an inlined section field.
- No section bytes allocated. `extensions = 0`.

## 5. Migration Plan (pre-launch, single PR-able cut)

Since there's no on-chain state, no migrator needed. Steps:

1. **Rewrite `state/player.rs`**
   - Slim `PlayerCore` struct + `init` + `init_with_city`.
   - Expand each `*Section` struct to be canonical storage (move fields out of core).
   - Reorder `*_OFFSET` constants to match new unlock order in the layout.
   - Add typed `<section>` / `<section>_mut` accessors on `PlayerCore`.
   - Update `size_for_extensions`, `unlock_extension_if_eligible` to write section `init()` at the new offset on resize.
   - Update compile-time assertions to the new sizes.

2. **Update every call site** (`grep` confirms ≈93 files in `processor/`, `helpers/`, `logic/` that read inlined fields). For each:
   - Replace `player.<inlined_field>` with `PlayerAccount::<section>_mut(data)?.<field>` (or immutable variant).
   - For "hot" combat paths that need many fields, fetch the section reference once and reuse.
   - For places that touch fields gated behind `require_extension(player, EXT_X)` — drop the call; the accessor now returns the right error.

3. **Update `helpers/inventory.rs`** to write through the `InventorySection` accessor. This is the largest single change since inventory has many touch points.

4. **Re-key the `Reinforcement` aggregator paths** (`processor/reinforcement/*`, combat) to use `TeamSection`'s reinforcement fields instead of core's.

5. **TS SDK update** (`sdks/novus-mundus-ts/src/state/player.ts`):
   - Update `CORE_SIZE`, all `*_OFFSET`, `MAX_SIZE` constants.
   - Slim `PlayerCore` interface (drop mirrors).
   - Expand `ResearchSection`/`HeroesSection`/`InventorySection`/`RallySection`/`TeamSection`/`CosmeticsSection` deserializers.
   - Update any code in `apps/web` that read mirrors off `PlayerCore` — point it at the section objects (or to `null` if section not unlocked).

6. **Tests**
   - `litesvm` test suite (already 100% green per `625e65f`) is the ground truth — run after each subsystem migration.
   - Add explicit "size-on-unlock" tests: assert `account.data_len()` matches `size_for_extensions(extensions)` after each unlock and at min size after fresh init.

## 6. What gets deleted

- All `INLINE SECTION FIELDS` blocks in `PlayerCore` (lines `state/player.rs:159-291`).
- The "backward compatibility" comment + the "should be synced" comment.
- `require_extension` calls that are now redundant with accessor-level gating (keep the helper itself for cheap bitmap checks).
- Any TS code path that read inlined section fields off the top-level `PlayerCore` interface.

## 7. Open Questions

1. **Should `RallySection` ever be optional?** Today it's mid-chain. Almost every PvP-style player rallies eventually — but charging 80 bytes upfront for a player who never groups up is still wasted rent. Keep gated as designed.
2. **Cosmetics ordering.** Cosmetics currently sits at slot 6 (after heroes). Cosmetics are cheap & flavor — could move earlier in the unlock chain (e.g. after research) so players can express identity without grinding heroes. **Recommend: keep current order for this redesign; cosmetics-ordering is a gameplay tweak, do separately.**
3. **`Reinforcement` placement.** Folded into `TeamSection` per §3.3. Alternative: separate `EXT_REINFORCEMENT` post-team. Folding is simpler and matches gameplay reality.

## 8. Expected savings

- New player: **1056 → ~512 bytes** (~50% rent cut on day-1 accounts).
- Mid-progression (research + inventory + team): **~512 + 48 + 400 + 112 = ~1072 bytes** vs today's flat 1056 — roughly even, but now those bytes are *real* (no dead sections behind them).
- Fully maxed (everything inc. court): **~1424 vs 1946** — saves ~520 bytes.
- Eliminates duplicate-storage class of bugs entirely.
