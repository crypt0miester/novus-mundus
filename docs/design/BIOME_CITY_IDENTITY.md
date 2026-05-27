# Biome City Identity — Design + Handoff

Status: design · For: next session · Last touched: 2026-05-27

A follow-up to FLAT_STRATEGY_MAP.md. The flat-strategy refactor gave every city a procedurally-generated biome map driven by `biome_seed`. That made every city *unique* (different noise pattern) but left every city *thematically interchangeable* — Cairo isn't desert, Tokyo isn't coastal-archipelago, Reykjavik isn't snow. They're all "procedural mixes."

This doc specs how to give cities *identity*: let the chain force a city to be all desert, an island, all forest, etc.

---

## 1. The gap

In `cli/data/cities.ts` each entry has `lat`/`lon`/`radiusKm`/`type` plus a derived `biomeSeed`. The seed maps through `noise() × 3 channels → Whittaker table` to produce a mix of grass/sand/water/forest/etc. **There is no way to say "this city is a desert."**

Real-world consequences for the canonical 24 cities:
- **Auren Khet** (Cairo) should be desert. Currently it's whatever `seedForCity(7)` happens to produce.
- **Lyssandor** (Singapore), **Shirevane** (Tokyo), **Mirethane** (Sydney) should feel like coastal/island cities. Currently random.
- **Vraenholdt** (Moscow), **Aelthis** (Seoul) should have snow biomes. Currently random.
- **Duskara** (Lagos), **Maravhen** (Mumbai) should be tropical/jungle-leaning. Currently random.

The procedural mix is good as a *fallback* for cities without strong identity (Trade hubs, Capitals). It's wrong as the *only* option.

---

## 2. Goal

Add a per-city knob on `CityAccount` that selects one of:

- **Procedural** (current default — preserve backwards-compat for cities without strong identity)
- **Monobiome** (force every cell to one specific biome ID — "all sand", "all snow", etc.)
- **Island** (radial: land near centre, water past `island_radius` from centre)
- **Coast** (linear: water on one half, land on the other; useful for port cities)
- Reserve room for more modes later (archipelago, oasis, etc.) without re-bumping `layout_version`.

The procedural pipeline stays untouched — modes are an OPTIONAL override layer that runs BEFORE the noise sampler kicks in.

---

## 3. Chain changes

### 3.1 `CityAccount` struct

Current layout (post flat-strategy cut, see `state/city.rs`):

```rust
pub biome_seed: u32,           // 4 bytes
pub width_grid: u16,           // 2 bytes
pub height_grid: u16,          // 2 bytes
pub layout_version: u8,        // 1 byte
pub _biome_reserved: [u8; 7],  // 7 bytes  ← repurpose two of these
```

Repurpose **two** of the reserved bytes — no struct size change, no `layout_version` bump needed (the bytes were already zero in v2 inits):

```rust
pub biome_seed: u32,
pub width_grid: u16,
pub height_grid: u16,
pub layout_version: u8,
pub biome_mode: u8,            // 0=procedural, 1=monobiome, 2=island, 3=coast
pub biome_param: u8,           // mode-specific (biome ID for monobiome, radius/8 for island, bearing for coast)
pub _biome_reserved: [u8; 5],  // 7 → 5 bytes
```

Existing chain accounts already zero those bytes, so old cities read as `mode=0, param=0 = procedural` — no migration needed. The flat-strategy cutover already requires layout_version=2; this change doesn't bump it.

### 3.2 `logic/biome.rs` — extend `biome_at` signature

The current signature is:

```rust
pub fn biome_at(seed: u32, ox: i32, oy: i32) -> u8
```

Wrap it with a mode-aware front door. Keep the inner pure function exported for the wire vector + raw callers:

```rust
pub const BIOME_MODE_PROCEDURAL: u8 = 0;
pub const BIOME_MODE_MONOBIOME:  u8 = 1;
pub const BIOME_MODE_ISLAND:     u8 = 2;
pub const BIOME_MODE_COAST:      u8 = 3;

/// Procedural-only sampler (current `biome_at` renamed). Wire vector
/// continues to test this — modes are deterministic overrides on top.
pub fn biome_procedural(seed: u32, ox: i32, oy: i32) -> u8 { … }  // current biome_at body

/// Mode-aware sampler — the function every processor + renderer
/// SHOULD call. Falls through to `biome_procedural` for mode 0.
pub fn biome_at(
    seed: u32,
    ox: i32,
    oy: i32,
    mode: u8,
    param: u8,
) -> u8 {
    match mode {
        BIOME_MODE_MONOBIOME => param,  // every cell is `param`
        BIOME_MODE_ISLAND => {
            // Land near centre, water past a ring. `param` encodes the
            // ring radius in 8-grid-unit steps (so a u8 reaches 2040
            // grid units ≈ 22 km — plenty).
            let radius = (param as i32) * 8;
            let dist_sq = ox.saturating_mul(ox).saturating_add(oy.saturating_mul(oy));
            if dist_sq > radius.saturating_mul(radius) {
                BIOME_WATER
            } else {
                biome_procedural(seed, ox, oy)
            }
        }
        BIOME_MODE_COAST => {
            // Half water, half land, split along a bearing encoded in
            // `param`. param is 0-7 for N/NE/E/SE/S/SW/W/NW (cardinal
            // direction the water is in). One half is forced water,
            // the other falls through to procedural.
            let water_side = match param % 8 {
                0 => oy > 0,                    // water to the north
                1 => oy > 0 && ox > 0,          // NE
                2 => ox > 0,                    // E
                3 => oy < 0 && ox > 0,          // SE
                4 => oy < 0,                    // S
                5 => oy < 0 && ox < 0,          // SW
                6 => ox < 0,                    // W
                7 => oy > 0 && ox < 0,          // NW
                _ => false,
            };
            if water_side { BIOME_WATER } else { biome_procedural(seed, ox, oy) }
        }
        _ => biome_procedural(seed, ox, oy),
    }
}
```

Notes:
- **Don't call `biome_procedural` directly from processors** — they should call the mode-aware front door.
- **Keep `biome_procedural` exported** so the wire-vector test still hits the inner function unmodified. Otherwise the vector would test "procedural via mode 0" which is the same thing, but separating them documents intent.
- **`param=0` for monobiome means BIOME_GRASS** — that's intentional. If a city is in mode-monobiome with param=0, every cell is grass. Default param is 0, so flipping mode without setting param produces all-grass (the friendliest default).
- **Island radius=0 (param=0)** would make the whole plot water. Add an early-return / minimum: `param.max(1)` or a doc note that island cities should pick param ≥ 5 (40 grid units ≈ 440 m).

### 3.3 Update every `biome_at` caller in the chain

Search-and-replace `biome_at(seed, ox, oy)` → `biome_at(seed, ox, oy, city_data.biome_mode, city_data.biome_param)` across:

- `state/city.rs` — `require_passable_at` and `biome_at` helpers
- `processor/economy/collect_resources.rs` — `biome_affinity(biome_at(…))`
- `processor/combat/attack_player.rs` — combat affinity block
- `processor/castle/create_castle.rs` — footprint passability scan

About 6 call sites. The `CityAccount` reference is already in scope at each.

### 3.4 Init flow

Add `biome_mode` + `biome_param` to:

1. **`processor/initialization/batch_cities.rs`** — per-city payload grows from 25 to 27 bytes (8 lat + 8 lon + 4 biome_seed + 1 city_type + 2 width_grid + 2 height_grid + 1 biome_mode + 1 biome_param).
2. **`processor/initialization/city.rs`** (single-city init) — payload grows from 59 to 61 bytes; biome_mode at offset 59, biome_param at offset 60.

Mirror in `sdks/novus-mundus-ts/src/instructions/initialization.ts` (`createInitCityInstruction` + `createBatchCitiesInstruction`).

Default both to 0 in `CityInfo` if omitted (TS optional fields).

---

## 4. SDK changes

### 4.1 State parser

`sdks/novus-mundus-ts/src/state/city.ts`:

```ts
export interface CityAccount {
  …
  layoutVersion: number;
  biomeMode: number;
  biomeParam: number;
}
```

In `deserializeCity` after `layoutVersion`:

```ts
const biomeMode = reader.readU8();   // offset 137
const biomeParam = reader.readU8();  // offset 138
reader.skip(5);                      // offset 139 _biome_reserved (5 bytes now)
// total still 144 bytes
```

### 4.2 Biome calculator

`sdks/novus-mundus-ts/src/calculators/biome.ts`:

```ts
export const BIOME_MODE_PROCEDURAL = 0;
export const BIOME_MODE_MONOBIOME = 1;
export const BIOME_MODE_ISLAND = 2;
export const BIOME_MODE_COAST = 3;

export function biomeProcedural(seed, ox, oy): BiomeType { … }  // rename current biomeAt body

export function biomeAt(seed, ox, oy, mode = 0, param = 0): BiomeType {
  // Same match logic as Rust above. Mirror bit-for-bit.
}
```

Keep `biomeProcedural` exported. The wire-vector JSON tests `biomeProcedural` (mode 0 path) so the existing committed vector stays valid.

### 4.3 Wire vector

The existing wire vector tests the procedural path only. Add a SECOND vector that covers mode 1/2/3 sample points. Either:

- A new `biome-vectors-modes.json` with `[{seed, ox, oy, mode, param, biome}]` tuples, OR
- Extend `biome-vectors.json` to include `mode` and `param` fields (default 0) and sweep a few mode+param combos.

The first option is cleaner — it keeps the procedural vector locked at its current shape (so historical drift detection isn't disturbed) and the mode vector grows independently.

Chain side: a new `tests/biome_wire_vector_modes.rs` that mirrors the existing test but writes the modes vector.

### 4.4 CLI data

`sdks/novus-mundus-ts/cli/data/cities.ts`:

```ts
export interface CityData {
  id: number;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  type: CityType;
  biomeMode?: number;   // default 0 (procedural)
  biomeParam?: number;  // default 0
}

// Helper convenience constants
export const MONOBIOME_SAND   = { biomeMode: 1, biomeParam: 1 };  // all sand
export const MONOBIOME_FOREST = { biomeMode: 1, biomeParam: 6 };
export const MONOBIOME_SNOW   = { biomeMode: 1, biomeParam: 2 };
export const ISLAND_SMALL     = { biomeMode: 2, biomeParam: 12 };  // 96 grid-unit radius
export const ISLAND_LARGE     = { biomeMode: 2, biomeParam: 25 };  // 200 grid-unit radius
export const COAST_NORTH      = { biomeMode: 3, biomeParam: 0 };   // water to the north
```

Then per-city, spread the helper:

```ts
{ id: 7, name: "Auren Khet", lat: 30.0444, lon: 31.2357, radiusKm: 50,
  type: CityType.Resource, ...MONOBIOME_SAND },   // Cairo — all desert

{ id: 11, name: "Shirevane", lat: 35.6762, lon: 139.6503, radiusKm: 55,
  type: CityType.Capital, ...ISLAND_LARGE },     // Tokyo — island

{ id: 5, name: "Vraenholdt", lat: 55.7558, lon: 37.6173, radiusKm: 50,
  type: CityType.Combat, ...MONOBIOME_SNOW },     // Moscow — all snow

{ id: 15, name: "Lyssandor", lat: 1.3521, lon: 103.8198, radiusKm: 35,
  type: CityType.Trade, ...ISLAND_SMALL },        // Singapore — island

// procedural cities omit biomeMode/biomeParam
{ id: 0, name: "Valdenmoor", lat: 51.5074, lon: -0.1278, radiusKm: 52,
  type: CityType.Capital },                       // London — procedural
```

### 4.5 CLI phase

`sdks/novus-mundus-ts/cli/lib/phases/cities.ts` — the `createBatchCitiesInstruction` call must pass through the two new fields:

```ts
cities: batch.map(c => {
  const dim = dimsFromRadius(c.radiusKm);
  return {
    name: c.name,
    lat: c.lat,
    lon: c.lon,
    biomeSeed: seedForCity(c.id),
    cityType: c.type,
    widthGrid: dim,
    heightGrid: dim,
    biomeMode: c.biomeMode ?? 0,
    biomeParam: c.biomeParam ?? 0,
  };
}),
```

---

## 5. Web changes

The web bake calls `biomeAt(biomeSeed, ox, oy)` in two places — `buildTerrainMesh.ts` and `CityTerrainMap2DFallback.tsx`. Both need updating to pass `biomeMode` + `biomeParam`:

```ts
const biome = biomeAt(
  cityAccount.biomeSeed,
  ox,
  oy,
  cityAccount.biomeMode ?? 0,
  cityAccount.biomeParam ?? 0,
);
```

Same for `CellAffinityPanel.tsx` and `useCityOccupied.ts` (anywhere biome is sampled for the local city).

`apps/web/src/lib/world/biome.ts` re-exports from SDK — no code change, just the new constants get re-exported automatically.

### Cache key

`CityTerrainMap2DFallback.tsx` keys its 2048² bake cache on `(cityId, biomeSeed, radiusGridUnits)`. Add `biomeMode` + `biomeParam` to the cache key so a city flipping mode invalidates correctly.

---

## 6. CityAffinityPanel — biome-themed hover

Currently `CellAffinityPanel.tsx` shows `the land offers · {biomeName}`. Under monobiome mode, every cell returns the same biome → the panel reads as "the land offers · sand" everywhere. That's still correct.

Under island mode at a cell past the radius ring, the panel reads "the land offers · water · balanced ground" — also correct.

No code change needed for the panel; it inherits correctness from `biomeAt`.

---

## 7. Tests

### 7.1 Wire vector (new)

`programs/novus_mundus/tests/biome_wire_vector_modes.rs` — write a fixture covering each mode at a few seeds and coords. Mirror in `sdks/novus-mundus-ts/tests/unit/biome.test.ts`.

### 7.2 Unit tests

`logic/biome.rs#tests`:

- `monobiome_returns_param_for_every_cell` — for `biome_at(seed, ox, oy, 1, b)` returns `b` regardless of (seed, ox, oy)
- `island_returns_water_past_radius` — for `biome_at(seed, ox, oy, 2, r)` returns WATER when `ox² + oy² > (r * 8)²` and procedural otherwise
- `coast_splits_along_bearing` — for each bearing, half the plane returns water

### 7.3 E2E

Pick one test city to use monobiome (probably city 7 in test fixtures — Cairo-equivalent) and assert that `biomeAt` returns BIOME_SAND for every cell.

Existing tests using `TEST_BIOME_SEED = 282` (no-water seed) continue to work with `biomeMode=0`.

### 7.4 Spawn picker

`sdks/novus-mundus-ts/src/spawn/pick.ts` — when a city is monobiome, the spawn picker should land anywhere passable inside the AABB; that's already what it does. When island, the picker should bias toward the land disc. Either:

- Trust `isPassableBiome(biomeAt(…))` to reject the water ring, and the spawn picker's "drop water cells" line continues to work
- Or, more sophisticated, bias the radial sample distribution toward the land radius

The first option works for v1.

---

## 8. Open design decisions

### 8.1 Should monobiome SHORE be allowed?

Shore by definition has a water neighbour. If you force every cell to shore, the "shore = has water neighbour" invariant breaks. **Solution:** treat monobiome shore as forest+water composite — every cell renders as shore-coloured but `is_passable_biome` returns true. OR reject `biome_mode=1, biome_param=8` at city init.

Decision needed: which.

### 8.2 Island radius — fixed or per-city?

Above I proposed `param * 8` (so a u8 reaches 2040 grid units). With `widthGrid = 8000` (4000 grid half-extent), max useful radius is ~4000 grid units. `param * 16` would reach exactly that; `param * 32` would reach beyond. Trade-off:

- `× 8` — finer granularity, max radius 2040 (smaller islands only)
- `× 16` — fits the full plot, coarser granularity
- `× 32` — overkill, granularity too coarse

Recommend `× 16` so islands can fill the plot.

Decision needed: multiplier.

### 8.3 Coast — single half or quadrant?

The proposed encoding has 8 directions (N/NE/E/SE/S/SW/W/NW) but the math returns water for diagonals only when BOTH axes are on the water side, which means a NE-coast city has water only in the upper-right *quadrant* and land in the other 3 quadrants. That's not how real coasts work — a NE coast has water on roughly half the plot, not a quarter.

Fix: for diagonal bearings (NE/SE/SW/NW), use a half-plane line `oy > ox` style instead of quadrant.

Decision needed: half-plane vs quadrant semantics for diagonal bearings.

### 8.4 Combining modes

What about "island + monobiome interior" (sand island, water ring)? Currently the proposed `mode` is exclusive. Either:

- Stack: `mode = 2 (island)`, the interior falls through to procedural; if the interior should be monobiome too, we'd need a third byte.
- Compose: mode is a bitfield (1 = monobiome, 2 = island ring, 3 = both — interior is monobiome). Param picks the biome; ring radius derived from city size.

The bitfield approach is more compositional. Worth considering.

Decision needed: scalar mode enum vs bitfield.

### 8.5 Migration

Existing on-chain cities (if any have been deployed) already have `biome_mode=0, biome_param=0` (the bytes were zero-initialised). New cities default to 0 as well. **No migration script needed.** But the cutover script in §9 of FLAT_STRATEGY_MAP.md should be updated to include these two bytes (currently it doesn't know about them).

Decision needed: whether to fold this into the same cutover or ship as a separate post-cut update.

---

## 9. Implementation order

Order matters. Suggested sprints:

**M1 — Chain extension**
1. Add `biome_mode` + `biome_param` to `CityAccount` struct (consume 2 bytes of `_biome_reserved`)
2. Rename current `biome_at` to `biome_procedural`; add new mode-aware `biome_at` wrapper
3. Update all chain callers to pass `(city_data.biome_mode, city_data.biome_param)`
4. Unit tests for monobiome / island / coast modes

**M2 — Init flow + SDK**
1. `batch_cities.rs` + `city.rs` (single init) — parse 2 more bytes
2. SDK `createInitCityInstruction` + `createBatchCitiesInstruction` — write the bytes
3. SDK `state/city.ts` parser — read the bytes
4. SDK `calculators/biome.ts` — mode-aware `biomeAt`

**M3 — Wire vector**
1. New `tests/biome_wire_vector_modes.rs` covering each mode
2. New SDK test asserting modes match chain
3. Commit both vectors

**M4 — CLI data**
1. `cli/data/cities.ts` interface change + per-city `biomeMode`/`biomeParam` assignments
2. `cli/lib/phases/cities.ts` — thread the fields through

**M5 — Web**
1. Update biome callers (renderer, panel, hooks) to pass mode/param
2. Bake cache key extension

**M6 — Tests**
1. E2E test that creates a monobiome city and asserts every cell is the forced biome
2. Update `TEST_BIOME_SEED` cities to remain procedural (mode 0) so existing tests don't change

The chain + SDK + CLI ship together (single cutover-style deploy). Web release can lag by hours.

---

## 10. What this doc DOES NOT cover

- **Cell-level overrides** (event arenas, faction shrines on a single cell) — that's the separate "special tiles" follow-up reserving biome IDs ≥ 32 with an override PDA. See FLAT_STRATEGY_MAP.md §12.
- **Dynamic biomes** (day/night water level, seasonal snow) — out of scope.
- **Per-cell paint tool** (DAO-painted custom maps) — would need per-cell storage; rejected by the flat-strategy design goal of "no per-cell on-chain data".
- **Biome themes per kingdom** (kingdom 0 is medieval-temperate, kingdom 1 is sci-fi-arctic) — could fold kingdom_id into seedForCity later, but orthogonal to this doc.

---

## 11. Memory / context to load before starting

Read these in order:
1. `docs/design/FLAT_STRATEGY_MAP.md` §3.2 (biome function), §6 (biome system), §11 checklist
2. `programs/novus_mundus/src/logic/biome.rs` (current biome implementation)
3. `programs/novus_mundus/src/state/city.rs` (CityAccount with the `_biome_reserved: [u8; 7]` to repurpose)
4. `sdks/novus-mundus-ts/cli/data/cities.ts` (where the per-city decisions land)
5. This doc, in full

User context note: The user has been iterating on flat-strategy across multiple sessions. The previous session missed that real-world cities have *thematic identity* (Cairo = desert, Tokyo = coastal-island, etc.) and that the procedural-only biome model doesn't surface that. This work fixes that gap.

User preference notes worth respecting:
- `feedback_no_divider_comments.md` — never use box-drawing rule lines in code or comments
- `feedback_comment_style.md` — `// …` for code comments, JSDoc `/** */` excepted
- `feedback_checked_math.md` — checked_*/saturating_* for arithmetic in `programs/novus_mundus/`
- `feedback_use_bun.md` — run scripts with bun, never npm/npx
- `feedback_no_fallbacks.md` — make fields required where chain layout dictates, don't `??`-shim required state
- `feedback_never_restart_validator.md` — `solana program deploy` for hot upgrades; don't restart the validator just to redeploy
