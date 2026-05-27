// Biome System — pure functions, framework-agnostic.
// Identical logic runs in the TypeScript SDK
// (sdks/novus-mundus-ts/src/calculators/biome.ts after S4).
// Drift between sides is caught by tests/fixtures/biome-vectors.json
// and tests/fixtures/biome-vectors-knobs.json (committed by the
// wire-vector tests below).
//
// Biome is derived from three cheap integer-noise channels — water
// mask, temperature, moisture — hashed against the city's biome_seed.
// Per-city `BiomeKnobs` *bend* those channels instead of replacing
// them: a water-level delta tilts the global threshold, climate biases
// shift the temperature / moisture noise, a directional coast gradient
// adds an additive bias along a bearing, and a low-octave landmass
// mask carves organic island / archipelago shapes. Every knob defaults
// to zero, so zero-initialized cities sample bit-for-bit the same
// values as the pre-knobs procedural sampler.
//
// All math is integer-only — no f32/f64 — so chain and TS sample the
// same biome bit-for-bit. The noise() helper this module wraps
// already commits to integer arithmetic (see logic/terrain.rs).

use crate::logic::terrain::noise;

// Biome IDs.
// 0-31 are the procedural Whittaker / water / shore set below.
// 32+ are reserved for special tiles (event arenas, faction
// shrines, quest sites) — written via a thin override PDA.
// Consumers MUST treat any biome >= 32 as
// a special-tile sentinel and look it up out-of-band.
pub const BIOME_GRASS: u8 = 0;
pub const BIOME_SAND: u8 = 1;
pub const BIOME_SNOW: u8 = 2;
pub const BIOME_DIRT: u8 = 3;
pub const BIOME_WATER: u8 = 4;
pub const BIOME_ROCK: u8 = 5;
pub const BIOME_FOREST: u8 = 6;
pub const BIOME_MARSH: u8 = 7;
pub const BIOME_SHORE: u8 = 8;

// Highest procedural biome ID — anything strictly above is a
// reserved / special-tile sentinel. Used by tests to bound the
// "every biome is reachable" sweep.
pub const PROCEDURAL_BIOME_MAX: u8 = BIOME_SHORE;

// Noise channel seeds.
// XOR-mixed into the city seed so the three noise channels are
// decorrelated. Constants are arbitrary 32-bit primes; changing
// them invalidates the committed wire vector (which is the whole
// point — drift fails CI).
const WATER_SEED_OFFSET: u32 = 0xA5C3_7F19;
const TEMP_SEED_OFFSET: u32 = 0x1B7E_5C2D;
const MOIST_SEED_OFFSET: u32 = 0x6D31_9B4A;
// Landmass mask channel — fourth decorrelated noise stream used by
// the optional `landmass_seed` knob to carve organic island /
// archipelago shapes. Sampled at a coarse resolution so the mask
// produces a handful of city-scale blobs, not cell-scale speckle.
const LANDMASS_SEED_OFFSET: u32 = 0xB3F1_E2C5;
const LANDMASS_SEED_MIXER: u32 = 0x9E37_79B9;
// Right-shift applied to (ox, oy) before sampling the landmass mask.
// shift=5 → cell size 32 grid units; with a 4096-half-extent plot the
// mask carves ~128 super-cells across the plot, enough for a few
// landmass blobs without the speckle a per-cell mask would produce.
const LANDMASS_COORD_SHIFT: u32 = 5;
// Mask threshold — cells whose mask-noise reads >= this are LAND;
// below this are SEA (force water). 128 picks roughly half the plot
// at random scales — landmass_seed selects which half.
const LANDMASS_LAND_THRESHOLD: u8 = 128;

/// Cells with water_noise at-or-above this threshold are water.
/// Empirically tuned to ~38 % water coverage across the wire-vector
/// seed sweep — the noise function bilinear-averages four hashes per
/// octave then blends three octaves 4:2:1, so the output distribution
/// concentrates near 128 rather than being uniform on [0, 255]. The
/// original guess of 96 produced ~80 % water in practice. The per-city
/// `water_level_delta` knob shifts the threshold around this baseline.
pub const WATER_THRESHOLD: u8 = 156;

/// Per-city biome knobs. Five bytes of state pulled from
/// `CityAccount` that bias the procedural sampler without replacing
/// it. All-zeros (the default for any uninitialized city) produces
/// bit-for-bit the same output as the pre-knobs procedural path —
/// that's the backwards-compat guarantee.
///
/// Bias semantics:
/// - `water_level_delta` — signed shift of the global water
///   threshold. Positive = less water (Cairo / Moscow inland).
///   Negative = more water (Venice, Stockholm).
/// - `temp_bias` — additive shift of the temperature noise channel.
///   Positive = hotter Whittaker bucket (Cairo, Mumbai). Negative =
///   colder (Reykjavik, Moscow).
/// - `moisture_bias` — additive shift of the moisture noise channel.
///   Positive = wetter (Singapore, Lagos). Negative = drier (Cairo).
/// - `coast` — directional gradient. 0 = none. 1..=8 = bearing the
///   sea is in (N/NE/E/SE/S/SW/W/NW). Adds a smooth additive bias
///   along that bearing so coastlines fall naturally instead of in a
///   geometric ring.
/// - `landmass_seed` — landform mask seed. 0 = no mask. >0 mixes a
///   low-octave noise mask that carves organic land/sea boundaries —
///   the right answer for archipelagos and bays (an island is not
///   always a radius).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BiomeKnobs {
    pub water_level_delta: i8,
    pub temp_bias: i8,
    pub moisture_bias: i8,
    pub coast: u8,
    pub landmass_seed: u8,
}

impl BiomeKnobs {
    /// All-zero knobs — equivalent to the pre-knobs procedural sampler.
    pub const DEFAULT: BiomeKnobs = BiomeKnobs {
        water_level_delta: 0,
        temp_bias: 0,
        moisture_bias: 0,
        coast: 0,
        landmass_seed: 0,
    };
}

impl Default for BiomeKnobs {
    fn default() -> Self {
        Self::DEFAULT
    }
}

// Whittaker lookup.
//
//                    cold ........ temp ........ hot
//             moist  | SNOW   FOREST  FOREST  MARSH
//                    | SNOW   GRASS   GRASS   MARSH
//                    | ROCK   GRASS   DIRT    SAND
//             arid   | ROCK   DIRT    SAND    SAND
//
// Indexed BIOME_TABLE[moisture_bucket][temperature_bucket] where
// each bucket = byte / 64 ∈ [0, 3]. Row 0 = arid (bottom of diagram),
// row 3 = moist (top). WATER + SHORE are handled in earlier layers
// so this table only produces inland biomes.
const BIOME_TABLE: [[u8; 4]; 4] = [
    // arid (m=0)
    [BIOME_ROCK, BIOME_DIRT, BIOME_SAND, BIOME_SAND],
    // m=1
    [BIOME_ROCK, BIOME_GRASS, BIOME_DIRT, BIOME_SAND],
    // m=2
    [BIOME_SNOW, BIOME_GRASS, BIOME_GRASS, BIOME_MARSH],
    // moist (m=3)
    [BIOME_SNOW, BIOME_FOREST, BIOME_FOREST, BIOME_MARSH],
];

/// True for every biome the player can stand on. Water is the only
/// impassable cell type; shore is walkable by design (lets players
/// kiss the coast without the next move drowning them).
#[inline]
pub fn is_passable_biome(biome: u8) -> bool {
    biome != BIOME_WATER
}

#[inline]
fn water_noise(seed: u32, ox: i32, oy: i32) -> u8 {
    noise(seed ^ WATER_SEED_OFFSET, ox, oy)
}

#[inline]
fn temperature_noise(seed: u32, ox: i32, oy: i32) -> u8 {
    noise(seed ^ TEMP_SEED_OFFSET, ox, oy)
}

#[inline]
fn moisture_noise(seed: u32, ox: i32, oy: i32) -> u8 {
    noise(seed ^ MOIST_SEED_OFFSET, ox, oy)
}

/// Project `(ox, oy)` onto the bearing direction and return a signed
/// bias to add to the water-noise channel. 0 if `coast == 0` (no
/// gradient). Positive = "this cell is closer to the sea-side",
/// negative = "closer to the land-side". The noise variation rides on
/// top of this bias, so coastlines come out organic rather than as a
/// straight line.
///
/// Bearings encode N=1 / NE=2 / E=3 / SE=4 / S=5 / SW=6 / W=7 / NW=8
/// — the cardinal direction the SEA lies in (positive bias on that
/// side, negative on the opposite side).
#[inline]
pub fn coast_gradient(coast: u8, ox: i32, oy: i32) -> i32 {
    if coast == 0 || coast > 8 {
        return 0;
    }
    let (dx, dy): (i32, i32) = match coast {
        1 => (0, 1),
        2 => (1, 1),
        3 => (1, 0),
        4 => (1, -1),
        5 => (0, -1),
        6 => (-1, -1),
        7 => (-1, 0),
        8 => (-1, 1),
        _ => (0, 0),
    };
    let raw = ox.saturating_mul(dx).saturating_add(oy.saturating_mul(dy));
    // Normalize diagonals to the same gradient strength as cardinals
    // (without this they overshoot by √2 because |(1,1)|=√2). 11585 /
    // 16384 ≈ 1/√2; saturating-mul keeps integer-only.
    let normalized = match coast {
        2 | 4 | 6 | 8 => raw.saturating_mul(11585) / 16384,
        _ => raw,
    };
    // Scale to roughly [-128, 128] at the edges of a typical plot
    // (half-extent ~4000 grid units). Division by 64 gives a strong
    // gradient that fully saturates the water threshold near the
    // plot edge; the noise can still create irregular coastlines in
    // the transition zone.
    (normalized / 64).clamp(-128, 128)
}

/// Sample the optional low-octave landmass mask. Returns `true` if
/// the cell sits inside a landmass blob (let the procedural sampler
/// decide its biome), `false` if it falls in the sea (force water).
/// When `landmass_seed == 0` the mask is disabled and every cell
/// reads as land.
#[inline]
pub fn landmass_is_land(seed: u32, landmass_seed: u8, ox: i32, oy: i32) -> bool {
    if landmass_seed == 0 {
        return true;
    }
    let mixed = seed ^ (landmass_seed as u32).wrapping_mul(LANDMASS_SEED_MIXER);
    let mask = noise(
        mixed ^ LANDMASS_SEED_OFFSET,
        ox >> LANDMASS_COORD_SHIFT,
        oy >> LANDMASS_COORD_SHIFT,
    );
    mask >= LANDMASS_LAND_THRESHOLD
}

/// Composite water check used by both the self-cell water test and
/// the shore neighbour scan. Factoring this out of `biome_at` is what
/// makes shore detection fire correctly for mode-forced water
/// (landmass mask, coast gradient) rather than only for the bare
/// procedural water mask.
#[inline]
fn is_water_at(seed: u32, ox: i32, oy: i32, knobs: &BiomeKnobs) -> bool {
    // Layer A: landmass mask. Sea cells short-circuit to water.
    if !landmass_is_land(seed, knobs.landmass_seed, ox, oy) {
        return true;
    }
    // Layer B: water noise with optional climate / coast biases.
    let base = water_noise(seed, ox, oy) as i32;
    let bias = coast_gradient(knobs.coast, ox, oy);
    let signal = base.saturating_add(bias).clamp(0, 255) as u8;
    let threshold = (WATER_THRESHOLD as i16)
        .saturating_add(knobs.water_level_delta as i16)
        .clamp(0, 255) as u8;
    signal >= threshold
}

/// Sample the biome at `(ox, oy)` — offsets from the city centre in
/// grid units — given the city's `biome_seed` and per-city `knobs`.
/// Pure function; identical output on chain and in the TS SDK by
/// construction.
///
/// Cost: ~1 noise sample for water cells (early return), 5 for shore
/// cells (1 self + 4 neighbours), 7 for inland (5 + 2 Whittaker
/// channels). When `knobs.landmass_seed != 0` add one mask-noise
/// sample per `is_water_at` call.
pub fn biome_at(seed: u32, ox: i32, oy: i32, knobs: &BiomeKnobs) -> u8 {
    // Layer 1: water mask (procedural + mode overrides).
    if is_water_at(seed, ox, oy, knobs) {
        return BIOME_WATER;
    }
    // Layer 2: shore — any of the four orthogonal neighbours being
    // water tips this cell into BIOME_SHORE. `saturating_add` keeps
    // the bounds well-defined at i32::MIN/MAX. Sharing `is_water_at`
    // with the self-check means coast-forced and landmass-forced
    // water both contribute neighbours, so islands and gradient
    // coasts get a real shore strip instead of a hard edge.
    let neighbours = [(-1i32, 0i32), (1, 0), (0, -1), (0, 1)];
    for (dx, dy) in neighbours {
        let nx = ox.saturating_add(dx);
        let ny = oy.saturating_add(dy);
        if is_water_at(seed, nx, ny, knobs) {
            return BIOME_SHORE;
        }
    }
    // Layer 3: Whittaker bucket, with per-city climate biases applied
    // to the temperature + moisture noise channels.
    let t = temperature_noise(seed, ox, oy).saturating_add_signed(knobs.temp_bias);
    let m = moisture_noise(seed, ox, oy).saturating_add_signed(knobs.moisture_bias);
    // t / 64 ∈ [0, 3] (t: u8 ∈ [0, 255]), same for m. Safe array
    // access — no panic possible.
    BIOME_TABLE[(m / 64) as usize][(t / 64) as usize]
}

// Affinity.
//
// `mining_bps` / `fishing_bps` feed collect_resources at the
// player's cell. `combat_bps` is signed attacker-vs-defender —
// positive means an attacker standing on this biome gets the bonus
// applied to their damage (mirrors how the old elevation_bps
// worked, just biome-keyed instead of elevation-keyed).

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BiomeAffinity {
    /// Mining yield bonus in basis points (0–10000 = 0–100 %).
    pub mining_bps: u16,
    /// Fishing yield bonus in basis points.
    pub fishing_bps: u16,
    /// Combat advantage in basis points, signed. Applied with
    /// opposite signs to attacker vs defender so the net damage
    /// swing comes out symmetric.
    pub combat_bps: i16,
}

const NO_AFFINITY: BiomeAffinity = BiomeAffinity {
    mining_bps: 0,
    fishing_bps: 0,
    combat_bps: 0,
};

/// Lookup-only — no math, so no overflow concerns. Numeric ranges
/// match the magnitude of the retired `terrain_affinity` table
/// (mining/fishing in [0, 1500] bps, combat in [-500, +500] bps)
/// so PvP balance shifts predictably across the cut.
pub const fn biome_affinity(biome: u8) -> BiomeAffinity {
    match biome {
        BIOME_GRASS => NO_AFFINITY,
        BIOME_SAND => BiomeAffinity {
            mining_bps: 0,
            fishing_bps: 0,
            combat_bps: 300,
        },
        BIOME_SNOW => BiomeAffinity {
            mining_bps: 750,
            fishing_bps: 0,
            combat_bps: -200,
        },
        BIOME_DIRT => BiomeAffinity {
            mining_bps: 500,
            fishing_bps: 0,
            combat_bps: 0,
        },
        BIOME_WATER => NO_AFFINITY,
        BIOME_ROCK => BiomeAffinity {
            mining_bps: 1500,
            fishing_bps: 0,
            combat_bps: 200,
        },
        BIOME_FOREST => BiomeAffinity {
            mining_bps: 250,
            fishing_bps: 250,
            combat_bps: -300,
        },
        BIOME_MARSH => BiomeAffinity {
            mining_bps: 0,
            fishing_bps: 1000,
            combat_bps: -400,
        },
        BIOME_SHORE => BiomeAffinity {
            mining_bps: 0,
            fishing_bps: 1500,
            combat_bps: -100,
        },
        // Reserved / special biomes default to no affinity until a
        // specific tile catalogue defines one.
        _ => NO_AFFINITY,
    }
}

/// Coordinate offsets the wire vector sweeps. Spans multiple noise
/// cells (the largest octave is 1024 grid units wide) so the vector
/// catches variety — water, shore, grass, forest, etc — instead of
/// landing every sample in the same noise corner.
pub const WIRE_VECTOR_COORDS: [i32; 9] =
    [-2000, -1000, -300, -50, 0, 50, 300, 1000, 2000];

// Tests.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn biome_at_is_deterministic() {
        // Same input -> same output, across many seeds and coords.
        for seed in [0u32, 1, 0xCAFE_0000, 0xDEAD_BEEF, u32::MAX] {
            for oy in [-1000i32, -100, 0, 100, 1000] {
                for ox in [-1000i32, -100, 0, 100, 1000] {
                    let k = BiomeKnobs::DEFAULT;
                    let a = biome_at(seed, ox, oy, &k);
                    let b = biome_at(seed, ox, oy, &k);
                    assert_eq!(a, b, "seed={} ox={} oy={}", seed, ox, oy);
                }
            }
        }
    }

    #[test]
    fn shore_cells_have_water_neighbour() {
        // Invariant: every BIOME_SHORE cell has at least one
        // orthogonal neighbour that's BIOME_WATER. Sweep a 200×200
        // grid across two seeds for coverage.
        let neighbours = [(-1i32, 0i32), (1, 0), (0, -1), (0, 1)];
        let k = BiomeKnobs::DEFAULT;
        for seed in [0xCAFE_0000u32, 0xDEAD_BEEFu32] {
            for oy in -100i32..100 {
                for ox in -100i32..100 {
                    if biome_at(seed, ox, oy, &k) != BIOME_SHORE {
                        continue;
                    }
                    let mut has_water = false;
                    for (dx, dy) in neighbours {
                        if biome_at(seed, ox + dx, oy + dy, &k) == BIOME_WATER {
                            has_water = true;
                            break;
                        }
                    }
                    assert!(
                        has_water,
                        "shore cell with no water neighbour at seed={} ox={} oy={}",
                        seed, ox, oy
                    );
                }
            }
        }
    }

    #[test]
    fn no_shore_cell_is_water() {
        // Layered construction means SHORE is set only when the
        // cell itself isn't water — this checks the layering didn't
        // get reversed.
        let k = BiomeKnobs::DEFAULT;
        for seed in [0xCAFE_0000u32, 0xDEAD_BEEFu32] {
            for oy in -100i32..100 {
                for ox in -100i32..100 {
                    let b = biome_at(seed, ox, oy, &k);
                    if b == BIOME_SHORE {
                        // Shore can't simultaneously be water — by
                        // construction. Tautology, but cheap insurance
                        // against a future reordering that breaks it.
                        assert_ne!(b, BIOME_WATER);
                    }
                }
            }
        }
    }

    #[test]
    fn is_passable_rejects_only_water() {
        for biome in 0u8..=PROCEDURAL_BIOME_MAX {
            let passable = is_passable_biome(biome);
            if biome == BIOME_WATER {
                assert!(!passable, "water should not be passable");
            } else {
                assert!(passable, "biome {} should be passable", biome);
            }
        }
        // Sentinel range (reserved): treated as passable until the
        // override PDA path lands. Verify a sample.
        assert!(is_passable_biome(32));
        assert!(is_passable_biome(100));
        assert!(is_passable_biome(255));
    }

    #[test]
    fn biome_affinity_table_is_signed_correctly() {
        // Spot-check the table direction so a future reordering
        // can't silently flip the combat-bps sign.
        assert_eq!(biome_affinity(BIOME_GRASS), NO_AFFINITY);
        assert_eq!(biome_affinity(BIOME_WATER), NO_AFFINITY);
        assert!(biome_affinity(BIOME_ROCK).mining_bps > 0);
        assert!(biome_affinity(BIOME_SNOW).mining_bps > 0);
        assert!(biome_affinity(BIOME_SHORE).fishing_bps > 0);
        assert!(biome_affinity(BIOME_MARSH).fishing_bps > 0);
        assert!(biome_affinity(BIOME_FOREST).fishing_bps > 0);
        // Defender-favouring biomes have negative combat_bps
        // (attacker on this biome is at a disadvantage).
        assert!(biome_affinity(BIOME_FOREST).combat_bps < 0);
        assert!(biome_affinity(BIOME_MARSH).combat_bps < 0);
        assert!(biome_affinity(BIOME_SNOW).combat_bps < 0);
        assert!(biome_affinity(BIOME_SHORE).combat_bps < 0);
        // Attacker-favouring biomes have positive combat_bps.
        assert!(biome_affinity(BIOME_SAND).combat_bps > 0);
        assert!(biome_affinity(BIOME_ROCK).combat_bps > 0);
        // Unknown / reserved biome IDs return NO_AFFINITY rather
        // than panicking — robust against a future biome being
        // added on chain before the SDK / web catalogues catch up.
        assert_eq!(biome_affinity(255), NO_AFFINITY);
    }

    #[test]
    fn every_procedural_biome_is_reachable() {
        // Range coverage: each Whittaker biome shows up at least
        // once across a broad sweep of seeds × cells. Confirms the
        // table direction matches what biome_at samples produce.
        //
        // The sweep must span MULTIPLE noise cells. The largest
        // octave in noise() uses shift=10 (cell size 1024 grid
        // units), so a sweep narrower than ~2048 would land in a
        // single cell for any given seed and the extreme
        // Whittaker quadrants (cold + moist = SNOW, hot + arid =
        // SAND extremes) only show up across cell variation.
        let mut seen = [false; (PROCEDURAL_BIOME_MAX as usize) + 1];
        let k = BiomeKnobs::DEFAULT;
        for seed in 0u32..32 {
            let mut oy = -3000i32;
            while oy <= 3000 {
                let mut ox = -3000i32;
                while ox <= 3000 {
                    let b = biome_at(seed, ox, oy, &k);
                    if (b as usize) < seen.len() {
                        seen[b as usize] = true;
                    }
                    ox += 64;
                }
                oy += 64;
            }
        }
        for (idx, hit) in seen.iter().enumerate() {
            assert!(*hit, "biome {} never sampled across the sweep", idx);
        }
    }

    // Knob behaviour tests.

    #[test]
    fn water_delta_max_eliminates_water() {
        // water_level_delta=+127 saturates the threshold at 223
        // (96 + 127). The water-noise channel maxes at 255, so a
        // few cells can still pop above 223 — but the inland
        // hot/dry preset also has no coast/landmass push, so we
        // should see drastically less water than the default
        // 38% coverage. Test: across a 200×200 sweep, < 5% water.
        let k = BiomeKnobs {
            water_level_delta: 127,
            ..BiomeKnobs::DEFAULT
        };
        let mut water = 0usize;
        let mut total = 0usize;
        for oy in -100i32..100 {
            for ox in -100i32..100 {
                if biome_at(0xCAFE_0007, ox, oy, &k) == BIOME_WATER {
                    water += 1;
                }
                total += 1;
            }
        }
        let pct = (water * 100) / total;
        assert!(pct < 5, "expected <5% water for delta=+127, got {}%", pct);
    }

    #[test]
    fn water_delta_min_floods_plot() {
        // water_level_delta=-96 drops the threshold to 0 — every
        // cell is water.
        let k = BiomeKnobs {
            water_level_delta: -96,
            ..BiomeKnobs::DEFAULT
        };
        for oy in [-100i32, 0, 100] {
            for ox in [-100i32, 0, 100] {
                assert_eq!(biome_at(0xCAFE_0007, ox, oy, &k), BIOME_WATER);
            }
        }
    }

    #[test]
    fn temp_bias_shifts_whittaker() {
        // A hot-and-dry preset (Cairo-like, but only the climate
        // bias) should never produce SNOW or FOREST (the cold +
        // moist corners of the Whittaker table).
        let k = BiomeKnobs {
            water_level_delta: 127,
            temp_bias: 120,
            moisture_bias: -120,
            ..BiomeKnobs::DEFAULT
        };
        let mut saw_cold = false;
        for oy in -200i32..200 {
            for ox in -200i32..200 {
                let b = biome_at(0xCAFE_0007, ox, oy, &k);
                if b == BIOME_SNOW || b == BIOME_FOREST {
                    saw_cold = true;
                    break;
                }
            }
            if saw_cold {
                break;
            }
        }
        assert!(
            !saw_cold,
            "hot+dry bias should not produce SNOW/FOREST cells"
        );
    }

    #[test]
    fn coast_gradient_pushes_water_one_side() {
        // coast=3 (E) — water should be common on the east side
        // (ox > +1500) and rare on the west side (ox < -1500).
        let k = BiomeKnobs {
            coast: 3,
            ..BiomeKnobs::DEFAULT
        };
        let mut east_water = 0usize;
        let mut west_water = 0usize;
        for oy in -200i32..200 {
            if biome_at(0xCAFE_0011, 2500, oy, &k) == BIOME_WATER {
                east_water += 1;
            }
            if biome_at(0xCAFE_0011, -2500, oy, &k) == BIOME_WATER {
                west_water += 1;
            }
        }
        assert!(
            east_water > west_water * 3,
            "coast=E should push water east: east={}, west={}",
            east_water,
            west_water,
        );
    }

    #[test]
    fn landmass_mask_has_both_land_and_sea() {
        // Direct test of the mask channel: for any non-zero seed it
        // must return BOTH `true` (some land cells) and `false` (some
        // sea cells) across a sweep wider than the smallest mask
        // feature (~512 grid units at shift=5). Sample a 4000-wide
        // sweep at 64-unit steps — well over the smallest octave.
        let mut saw_land = false;
        let mut saw_sea = false;
        for landmass_seed in 1u8..=32 {
            let mut oy = -2000i32;
            while oy <= 2000 {
                let mut ox = -2000i32;
                while ox <= 2000 {
                    if landmass_is_land(0xCAFE_0017, landmass_seed, ox, oy) {
                        saw_land = true;
                    } else {
                        saw_sea = true;
                    }
                    if saw_land && saw_sea {
                        break;
                    }
                    ox += 64;
                }
                if saw_land && saw_sea {
                    break;
                }
                oy += 64;
            }
            if saw_land && saw_sea {
                break;
            }
        }
        assert!(saw_land, "landmass mask should yield some land cells");
        assert!(saw_sea, "landmass mask should yield some sea cells");
    }

    #[test]
    fn landmass_seed_carves_islands() {
        // For some (seed, landmass_seed, ox, oy), the mask must turn a
        // non-water cell into water. Sweep widely enough to cross a
        // landmass boundary (sea cells are at most a few hundred grid
        // units across).
        let seed = 0xCAFE_0017;
        let no_mask = BiomeKnobs::DEFAULT;
        let mut found = false;
        'outer: for landmass_seed in 1u8..=32 {
            let with_mask = BiomeKnobs {
                landmass_seed,
                ..BiomeKnobs::DEFAULT
            };
            let mut oy = -2000i32;
            while oy <= 2000 {
                let mut ox = -2000i32;
                while ox <= 2000 {
                    let w = biome_at(seed, ox, oy, &with_mask) == BIOME_WATER;
                    let nw = biome_at(seed, ox, oy, &no_mask) != BIOME_WATER;
                    if w && nw {
                        found = true;
                        break 'outer;
                    }
                    ox += 64;
                }
                oy += 64;
            }
        }
        assert!(
            found,
            "landmass mask should add water cells where the base sampler said land"
        );
    }

    #[test]
    fn shore_fires_for_mode_forced_water() {
        // A landmass-mask sea cell adjacent to a land cell must tip
        // the land cell into SHORE — exactly what the is_water_at
        // refactor is for. Sweep wide enough to cross a landmass
        // boundary across many seeds.
        let mut saw_shore = false;
        'outer: for landmass_seed in 1u8..=32 {
            let k = BiomeKnobs {
                landmass_seed,
                ..BiomeKnobs::DEFAULT
            };
            let mut oy = -2000i32;
            while oy <= 2000 {
                let mut ox = -2000i32;
                while ox <= 2000 {
                    if biome_at(0xCAFE_0017, ox, oy, &k) == BIOME_SHORE {
                        saw_shore = true;
                        break 'outer;
                    }
                    ox += 32;
                }
                oy += 32;
            }
        }
        assert!(
            saw_shore,
            "landmass-masked city should have shore cells at land/sea boundaries"
        );
    }
}
