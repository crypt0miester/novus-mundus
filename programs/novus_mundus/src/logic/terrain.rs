// Terrain noise + grid helpers.
//
// After the flat-strategy cut this module is the thin surviving piece
// of the old elevation system — the anchor-based Voronoi noise field,
// the per-cell elevation, the `Anchor`/`CityTerrain` types, all the
// passability and affinity helpers are gone. What remains:
//
//   - `noise()` — multi-octave integer noise used by `logic::biome`
//     for its water / temperature / moisture channels. Bit-identical
//     between chain and SDK; the wire vector at
//     `sdks/novus-mundus-ts/tests/fixtures/biome-vectors.json`
//     locks that contract.
//
//   - `to_grid` / `city_offset` — coordinate quantization helpers.
//     Match `LocationAccount::to_grid`; reused by every processor
//     that needs to convert a (lat, long) into centre-relative grid
//     coordinates.
//
// Everything else (`elevation`, `is_passable`, `terrain_moisture`,
// `sample`, `terrain_affinity`, `Anchor`, `CityTerrain`,
// `parse_terrain_header`, `TERRAIN_HEADER_SIZE`, `ANCHOR_SIZE`, the
// 1000+ line anchor test suite) retired with the elevation model.
// Biome is now a pure function of `(biome_seed, ox, oy)` — see
// `logic::biome`.

// Coordinate helpers.

/// Convert geographic coordinate to location grid units.
/// Matches `LocationAccount::to_grid`.
pub fn to_grid(coord: f64) -> i32 {
    libm::round(coord * 10000.0) as i32
}

/// Compute (offset_x, offset_y) from city center in grid units.
pub fn city_offset(grid_lat: i32, grid_long: i32, city_lat: f64, city_long: f64) -> (i32, i32) {
    (
        grid_long.saturating_sub(to_grid(city_long)),
        grid_lat.saturating_sub(to_grid(city_lat)),
    )
}

// Integer noise (consumed by logic::biome).

fn terrain_hash(seed: u32, x: i32, y: i32) -> u8 {
    let mut h = seed ^ (x as u32) ^ (y as u32).rotate_left(16);
    h ^= h >> 13;
    h = h.wrapping_mul(0x45D9F3B);
    h ^= h >> 16;
    h = h.wrapping_mul(0x45D9F3B);
    h ^= h >> 16;
    (h & 0xFF) as u8
}

/// Smoothstep in fixed-point: t in 0..256, returns 0..256.
/// Formula: t² × (3×256 − 2×t) / 256²
fn smoothstep256(t: u32) -> u32 {
    let two_t = t.saturating_mul(2);
    let curve = 768u32.saturating_sub(two_t);
    t.saturating_mul(t).saturating_mul(curve) >> 16
}

/// Bilinear-interpolated octave with smoothstep. Returns 0..255.
fn smooth_octave(seed: u32, x: i32, y: i32, shift: u32) -> u32 {
    let s = 1i32 << shift;
    let gx = x.div_euclid(s);
    let gy = y.div_euclid(s);
    // Fractional position in cell, scaled to 0..256
    let fx = (x.rem_euclid(s) as u32)
        .saturating_mul(256)
        .saturating_div(s as u32);
    let fy = (y.rem_euclid(s) as u32)
        .saturating_mul(256)
        .saturating_div(s as u32);
    // 4 corner hashes
    let v00 = terrain_hash(seed, gx, gy) as u32;
    let v10 = terrain_hash(seed, gx.saturating_add(1), gy) as u32;
    let v01 = terrain_hash(seed, gx, gy.saturating_add(1)) as u32;
    let v11 = terrain_hash(seed, gx.saturating_add(1), gy.saturating_add(1)) as u32;
    // Smoothstep interpolation factors
    let tx = smoothstep256(fx);
    let ty = smoothstep256(fy);
    let itx = 256u32.saturating_sub(tx);
    let ity = 256u32.saturating_sub(ty);
    // Bilinear interpolation, result in 0..255
    let c00 = v00.saturating_mul(itx).saturating_mul(ity);
    let c10 = v10.saturating_mul(tx).saturating_mul(ity);
    let c01 = v01.saturating_mul(itx).saturating_mul(ty);
    let c11 = v11.saturating_mul(tx).saturating_mul(ty);
    c00.saturating_add(c10)
        .saturating_add(c01)
        .saturating_add(c11)
        .saturating_div(256u32.saturating_mul(256))
}

/// Multi-octave integer noise — three octaves blended 4:2:1. Wraps
/// for the `logic::biome` water / temperature / moisture channels
/// via different XOR'd seeds.
pub(crate) fn noise(seed: u32, x: i32, y: i32) -> u8 {
    let o1 = smooth_octave(seed, x, y, 10);
    let o2 = smooth_octave(seed ^ 0x9E3779B9, x, y, 7);
    let o3 = smooth_octave(seed ^ 0x517CC1B7, x, y, 4);
    let weighted = o1
        .saturating_mul(4)
        .saturating_add(o2.saturating_mul(2))
        .saturating_add(o3);
    weighted.saturating_div(7) as u8
}

// Tests.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_grid_matches_location_quantization() {
        assert_eq!(to_grid(51.5074), 515074);
        assert_eq!(to_grid(-74.006), -740060);
        assert_eq!(to_grid(0.0), 0);
    }

    #[test]
    fn city_offset_at_center() {
        let (ox, oy) = city_offset(515074, -1278, 51.5074, -0.1278);
        assert_eq!(ox, 0);
        assert_eq!(oy, 0);
    }

    #[test]
    fn noise_is_deterministic() {
        for seed in [0u32, 1, 0xCAFE_0000, 0xDEAD_BEEF] {
            for y in [-1000i32, 0, 1000] {
                for x in [-1000i32, 0, 1000] {
                    assert_eq!(noise(seed, x, y), noise(seed, x, y));
                }
            }
        }
    }

    #[test]
    fn noise_is_bounded_u8() {
        // Trivially true at the type level, but the test also
        // confirms no panic on extreme inputs (i32::MIN/MAX).
        let _ = noise(0xCAFE_0000, i32::MIN, i32::MAX);
        let _ = noise(0xCAFE_0000, i32::MAX, i32::MIN);
    }
}
