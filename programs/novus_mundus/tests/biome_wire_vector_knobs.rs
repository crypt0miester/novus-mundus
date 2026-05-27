// Wire-vector integration test — knobs side.
//
// Companion to `biome_wire_vector.rs`. That fixture covers the
// default-knobs (procedural) path; this one sweeps a curated set of
// knob tuples (Cairo / Moscow / Singapore / Tokyo / Naples-east /
// Reykjavik / defaults) so chain and SDK can lock the climate +
// landform overrides bit-for-bit.
//
// Re-run with `UPDATE_BIOME_VECTORS=1` to regenerate the JSON when
// `biome_at`, `coast_gradient`, or `landmass_is_land` change. The SDK
// asserts identical output in `tests/unit/biome.test.ts`.

use novus_mundus::logic::biome::{biome_at, BiomeKnobs, WIRE_VECTOR_COORDS};


// A trimmed seed list for the knobs vector — we sweep the full coord
// grid against every preset, so multiplying by all five default seeds
// blows the file up unnecessarily. One production-shape seed and one
// high-entropy seed gives enough coverage to catch drift.
const KNOB_VECTOR_SEEDS: [u32; 2] = [0xCAFE_0007, 0xDEAD_BEEF];

// Curated knob tuples covered by this vector. Local to the test
// crate so the label strings don't end up in the deployed BPF
// binary — `programs/novus_mundus/src/logic/biome.rs` stays free of
// test-only data.
const WIRE_VECTOR_KNOB_PRESETS: &[(&str, BiomeKnobs)] = &[
    ("defaults", BiomeKnobs::DEFAULT),
    (
        "cairo",
        BiomeKnobs {
            water_level_delta: 127,
            temp_bias: 80,
            moisture_bias: -100,
            coast: 0,
            landmass_seed: 0,
        },
    ),
    (
        "moscow",
        BiomeKnobs {
            water_level_delta: 127,
            temp_bias: -100,
            moisture_bias: 0,
            coast: 0,
            landmass_seed: 0,
        },
    ),
    (
        "singapore",
        BiomeKnobs {
            water_level_delta: -40,
            temp_bias: 90,
            moisture_bias: 90,
            coast: 0,
            landmass_seed: 11,
        },
    ),
    (
        "tokyo",
        BiomeKnobs {
            water_level_delta: 10,
            temp_bias: 20,
            moisture_bias: 30,
            coast: 0,
            landmass_seed: 17,
        },
    ),
    (
        "naples_east",
        BiomeKnobs {
            water_level_delta: 0,
            temp_bias: 40,
            moisture_bias: 20,
            coast: 3,
            landmass_seed: 0,
        },
    ),
    (
        "reykjavik",
        BiomeKnobs {
            water_level_delta: -30,
            temp_bias: -80,
            moisture_bias: 30,
            coast: 7,
            landmass_seed: 23,
        },
    ),
];

fn generate_biome_knobs_vector_json() -> String {
    let mut out = String::from("[\n");
    let mut first = true;
    for &(label, knobs) in WIRE_VECTOR_KNOB_PRESETS {
        for &seed in &KNOB_VECTOR_SEEDS {
            for &oy in &WIRE_VECTOR_COORDS {
                for &ox in &WIRE_VECTOR_COORDS {
                    let biome = biome_at(seed, ox, oy, &knobs);
                    if !first {
                        out.push_str(",\n");
                    }
                    first = false;
                    out.push_str(&format!(
                        "  {{\"preset\":\"{}\",\"seed\":{},\"ox\":{},\"oy\":{},\
                         \"water_level_delta\":{},\"temp_bias\":{},\"moisture_bias\":{},\
                         \"coast\":{},\"landmass_seed\":{},\"biome\":{}}}",
                        label,
                        seed,
                        ox,
                        oy,
                        knobs.water_level_delta,
                        knobs.temp_bias,
                        knobs.moisture_bias,
                        knobs.coast,
                        knobs.landmass_seed,
                        biome
                    ));
                }
            }
        }
    }
    out.push_str("\n]\n");
    out
}

#[test]
fn biome_knobs_wire_vector_matches_committed() {
    let generated = generate_biome_knobs_vector_json();
    let path = format!(
        "{}/../../sdks/novus-mundus-ts/tests/fixtures/biome-vectors-knobs.json",
        env!("CARGO_MANIFEST_DIR")
    );
    if std::env::var("UPDATE_BIOME_VECTORS").is_ok() {
        std::fs::write(&path, &generated)
            .unwrap_or_else(|e| panic!("Failed to write {}: {}", path, e));
        return;
    }
    let committed = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => panic!(
            "Failed to read {}: {}\n\
             Re-run with UPDATE_BIOME_VECTORS=1 to seed the fixture.",
            path, e
        ),
    };
    if committed.trim() != generated.trim() {
        panic!(
            "Biome knobs wire vector drift between chain and committed fixture.\n\
             Path: {}\n\
             Re-run with UPDATE_BIOME_VECTORS=1 to regenerate (chain wins).",
            path
        );
    }
}
