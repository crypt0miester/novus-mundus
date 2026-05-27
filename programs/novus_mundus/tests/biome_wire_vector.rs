// Wire-vector integration test — chain side.
//
// Generates the canonical (seed, ox, oy) -> biome JSON the SDK
// (`sdks/novus-mundus-ts/tests/fixtures/biome-vectors.json`) is
// asserted against in S6. The chain is the source of truth: if
// chain biome_at() output changes, this test rewrites the file
// when run with UPDATE_BIOME_VECTORS=1, then the SDK side picks
// up the new vector on its next CI run.
//
// Why an integration test, not a unit test: the chain crate is
// `no_std`, so unit tests can't use `String` / `std::fs`. Integration
// tests are separate binaries with std by default.

use novus_mundus::logic::biome::{biome_at, BiomeKnobs, WIRE_VECTOR_COORDS};


// Wire vector parameters.
/// Seeds the wire vector sweeps. Adding seeds is fine; removing or
/// renumbering invalidates the committed JSON. Chosen to cover
/// production-shape seeds (0xCAFE0000 | city_id family), a
/// known-no-water test seed (282), and a couple of high-entropy
/// values so the resulting vector reflects real biome variety.
pub const WIRE_VECTOR_SEEDS: [u32; 5] = [
    0xCAFE_0000,
    0xCAFE_0007,
    282,
    0xDEAD_BEEF,
    0x1337_C0DE,
];


// Default-knobs wire vector. Knobs are all-zero, which the sampler
// treats as "use the pre-knobs procedural path" bit-for-bit — that's
// the backwards-compat contract the committed JSON encodes.
fn generate_biome_wire_vector_json() -> String {
    let knobs = BiomeKnobs::DEFAULT;
    let mut out = String::from("[\n");
    let mut first = true;
    for &seed in &WIRE_VECTOR_SEEDS {
        for &oy in &WIRE_VECTOR_COORDS {
            for &ox in &WIRE_VECTOR_COORDS {
                let biome = biome_at(seed, ox, oy, &knobs);
                if !first {
                    out.push_str(",\n");
                }
                first = false;
                out.push_str(&format!(
                    "  {{\"seed\":{},\"ox\":{},\"oy\":{},\"biome\":{}}}",
                    seed, ox, oy, biome
                ));
            }
        }
    }
    out.push_str("\n]\n");
    out
}

#[test]
fn biome_wire_vector_matches_committed() {
    let generated = generate_biome_wire_vector_json();
    let path = format!(
        "{}/../../sdks/novus-mundus-ts/tests/fixtures/biome-vectors.json",
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
            "Biome wire vector drift between chain and committed fixture.\n\
             Path: {}\n\
             Re-run with UPDATE_BIOME_VECTORS=1 to regenerate (chain wins).",
            path
        );
    }
}
