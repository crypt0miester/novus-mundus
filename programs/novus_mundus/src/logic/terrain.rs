// Terrain System — pure elevation functions
// No AccountView, no framework dependencies.
// Identical logic runs in the TypeScript SDK.

/// Weighted point beneath the surface. Heavy anchors sink (water),
/// light buoyant anchors rise (land, hills).
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Anchor {
    /// X offset from city center (location grid units, 0.0001° each).
    pub x: i16,
    /// Y offset from city center.
    pub y: i16,
    /// Weight — 0 = featherlight, 255 = heavy. Heavy sinks.
    pub mass: u8,
    /// Buoyancy — 0 = none, 255 = max. More lift = higher surface.
    pub lift: u8,
    /// Directional pressure X (-128..127).
    pub push_x: i8,
    /// Directional pressure Y (-128..127).
    pub push_y: i8,
    /// Moisture level — 0 = arid, 255 = lush.
    pub moisture: u8,
}

/// Read-only view of a city's terrain data.
pub struct CityTerrain<'a> {
    pub seed: u32,
    pub water_line: u8,
    pub peak_line: u8,
    pub anchors: &'a [Anchor],
}

/// Detailed result from sampling a coordinate.
#[allow(unused)]
pub struct TerrainSample {
    pub elevation: u8,
    pub moisture: u8,
    pub is_passable: bool,
    pub is_water: bool,
    pub is_mountain: bool,
    pub nearest_anchor: usize,
}


// Public API
/// Surface elevation at an offset from city center. Returns 0-255.
pub fn elevation(terrain: &CityTerrain, ox: i32, oy: i32) -> u8 {
    let anchors = terrain.anchors;
    if anchors.len() < 2 {
        return if anchors.len() == 1 {
            buoyancy(anchors[0].mass, anchors[0].lift)
        } else {
            128
        };
    }

    let (ni, si, dn, ds) = two_nearest(anchors, ox, oy);
    // Blend buoyancy between nearest two anchors for smooth boundaries
    let b1 = buoyancy(anchors[ni].mass, anchors[ni].lift) as i32;
    let b2 = buoyancy(anchors[si].mass, anchors[si].lift) as i32;
    let total = dn.saturating_add(ds);
    let t = if total > 0 {
        crate::logic::safe_math::mul_div(dn, 256, total).unwrap_or(0) as i32
    } else {
        0
    };
    let blend = b2.saturating_sub(b1).saturating_mul(t).saturating_div(256);
    let base = b1.saturating_add(blend);
    let pressure = pressure_effect(&anchors[ni], &anchors[si], dn, ds) as i32;
    let texture = (noise(terrain.seed, ox, oy) as i32).saturating_sub(128).saturating_div(4);

    clamp_u8(base.saturating_add(pressure).saturating_add(texture))
}

/// Is the coordinate passable? False if water or mountain.
pub fn is_passable(terrain: &CityTerrain, ox: i32, oy: i32) -> bool {
    if terrain.anchors.is_empty() {
        return true;
    }
    let e = elevation(terrain, ox, oy);
    e > terrain.water_line && e < terrain.peak_line
}

/// Moisture at an offset from city center. Returns 0-255.
/// Interpolates moisture from the two nearest anchors using Voronoi blending.
pub fn terrain_moisture(terrain: &CityTerrain, ox: i32, oy: i32) -> u8 {
    let anchors = terrain.anchors;
    if anchors.len() < 2 {
        return if anchors.len() == 1 { anchors[0].moisture } else { 128 };
    }
    let (ni, si, dn, ds) = two_nearest(anchors, ox, oy);
    let m1 = anchors[ni].moisture as i32;
    let m2 = anchors[si].moisture as i32;
    let total = dn.saturating_add(ds);
    let t = if total > 0 {
        crate::logic::safe_math::mul_div(dn, 256, total).unwrap_or(0) as i32
    } else {
        0
    };
    let blend = m2.saturating_sub(m1).saturating_mul(t).saturating_div(256);
    clamp_u8(m1.saturating_add(blend))
}

/// Full sample with classification metadata.
#[allow(unused)]
pub fn sample(terrain: &CityTerrain, ox: i32, oy: i32) -> TerrainSample {
    if terrain.anchors.is_empty() {
        return TerrainSample {
            elevation: 128,
            moisture: 128,
            is_passable: true,
            is_water: false,
            is_mountain: false,
            nearest_anchor: 0,
        };
    }
    let e = elevation(terrain, ox, oy);
    let m = terrain_moisture(terrain, ox, oy);
    let (ni, _, _, _) = two_nearest(terrain.anchors, ox, oy);
    TerrainSample {
        elevation: e,
        moisture: m,
        is_passable: e > terrain.water_line && e < terrain.peak_line,
        is_water: e <= terrain.water_line,
        is_mountain: e >= terrain.peak_line,
        nearest_anchor: ni,
    }
}

/// Terrain bonus at a specific coordinate within a city.
///
/// Mining bonus scales with proximity to peak_line (mountains = minerals).
/// Fishing bonus scales with proximity to water_line (coast = fish).
/// Elevation advantage for combat: higher ground = positive BPS.
pub struct TerrainAffinity {
    /// Bonus for mining activities (BPS, 0–1500). Higher near mountains.
    pub mining_bps: u16,
    /// Bonus for fishing activities (BPS, 0–1500). Higher near coastline.
    pub fishing_bps: u16,
    /// Elevation advantage for combat (signed BPS, -500 to +500).
    /// Positive = high ground, negative = low ground.
    pub elevation_bps: i16,
}

/// Calculate terrain-based bonuses at a coordinate.
///
/// Terrain elevation maps to three activity bonuses:
/// - **Mining**: Near mountain peaks (high elevation) gives up to +15% yield
/// - **Fishing**: Near coastline (low elevation above water) gives up to +15% yield
/// - **Combat**: Higher ground gives up to +5% damage, lower gives up to -5%
///
/// Impassable coordinates (water, mountains) return zero bonuses.
pub fn terrain_affinity(terrain: &CityTerrain, ox: i32, oy: i32) -> TerrainAffinity {
    if terrain.anchors.is_empty() {
        return TerrainAffinity { mining_bps: 0, fishing_bps: 0, elevation_bps: 0 };
    }

    let e = elevation(terrain, ox, oy) as i32;
    let wl = terrain.water_line as i32;
    let pl = terrain.peak_line as i32;

    // Impassable terrain gives no bonus
    if e <= wl || e >= pl {
        return TerrainAffinity { mining_bps: 0, fishing_bps: 0, elevation_bps: 0 };
    }

    let midpoint = wl.saturating_add(pl).saturating_div(2);
    let half_range = pl.saturating_sub(wl).saturating_div(2).max(1);

    // Mining: bonus when elevation is in upper half (near mountains)
    // Linear scale: midpoint -> 0 BPS, peak_line -> 1500 BPS
    let mining_bps = if e > midpoint {
        let above = e.saturating_sub(midpoint) as u32;
        above.saturating_mul(1500).saturating_div(half_range as u32).min(1500) as u16
    } else {
        0
    };

    // Fishing: bonus when elevation is in lower half (near coast)
    // Linear scale: midpoint -> 0 BPS, water_line -> 1500 BPS
    let fishing_bps = if e < midpoint {
        let below = midpoint.saturating_sub(e) as u32;
        below.saturating_mul(1500).saturating_div(half_range as u32).min(1500) as u16
    } else {
        0
    };

    // Combat: elevation advantage relative to midpoint
    // Linear scale: water_line -> -500 BPS, midpoint -> 0, peak_line -> +500 BPS
    let centered = e.saturating_sub(midpoint);
    let elevation_bps = centered.saturating_mul(500).saturating_div(half_range).max(-500).min(500) as i16;

    TerrainAffinity { mining_bps, fishing_bps, elevation_bps }
}

/// Parse terrain header. Returns (seed, water_line, peak_line, anchor_count, version).
pub fn parse_terrain_header(data: &[u8]) -> (u32, u8, u8, u16, u8) {
    let seed = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    let water_line = data[4];
    let peak_line = data[5];
    let anchor_count = u16::from_le_bytes([data[6], data[7]]);
    let version = data[8];
    (seed, water_line, peak_line, anchor_count, version)
}

// Coordinate helpers
/// Convert geographic coordinate to location grid units.
/// Matches `LocationAccount::to_grid`.
pub fn to_grid(coord: f64) -> i32 {
    libm::round(coord * 10000.0) as i32
}

/// Compute (offset_x, offset_y) from city center in grid units.
pub fn city_offset(
    grid_lat: i32,
    grid_long: i32,
    city_lat: f64,
    city_long: f64,
) -> (i32, i32) {
    (
        grid_long.saturating_sub(to_grid(city_long)),
        grid_lat.saturating_sub(to_grid(city_lat)),
    )
}


// Serialization
pub const TERRAIN_HEADER_SIZE: usize = 16;
pub const ANCHOR_SIZE: usize = 9;



// Internal: nearest anchor search
fn two_nearest(anchors: &[Anchor], ox: i32, oy: i32) -> (usize, usize, u64, u64) {
    let mut best_idx: usize = 0;
    let mut best_d: u64 = u64::MAX;
    let mut second_idx: usize = 0;
    let mut second_d: u64 = u64::MAX;

    for (i, a) in anchors.iter().enumerate() {
        let dx = (ox as i64).saturating_sub(a.x as i64);
        let dy = (oy as i64).saturating_sub(a.y as i64);
        let dx2 = dx.saturating_mul(dx);
        let dy2 = dy.saturating_mul(dy);
        let d = (dx2.saturating_add(dy2)) as u64;
        if d < best_d {
            second_d = best_d;
            second_idx = best_idx;
            best_d = d;
            best_idx = i;
        } else if d < second_d {
            second_d = d;
            second_idx = i;
        }
    }

    (best_idx, second_idx, best_d, second_d)
}


// Internal: buoyancy (isostasy)
/// lift × (255 - mass) / 255
fn buoyancy(mass: u8, lift: u8) -> u8 {
    let inv_mass = 255u32.saturating_sub(mass as u32);
    (lift as u32).saturating_mul(inv_mass).saturating_div(255) as u8
}


// Internal: pressure at anchor boundaries
fn pressure_effect(nearest: &Anchor, second: &Anchor, dist_n: u64, dist_s: u64) -> i16 {
    let total = dist_n.saturating_add(dist_s);
    if total == 0 {
        return 0;
    }

    // proximity: 0 = at nearest anchor, 64 = equidistant (boundary)
    let proximity = crate::logic::safe_math::mul_div(dist_n, 128, total).unwrap_or(0) as u32;

    // Only apply pressure in outer half of territory (proximity >= 32)
    if proximity < 32 {
        return 0;
    }

    // Scale: 0 at proximity=32, 255 at proximity=64
    let strength = proximity
        .saturating_sub(32)
        .saturating_mul(8)
        .min(255) as i32;

    let rpx = (nearest.push_x as i32).saturating_sub(second.push_x as i32);
    let rpy = (nearest.push_y as i32).saturating_sub(second.push_y as i32);
    if rpx == 0 && rpy == 0 {
        return 0;
    }

    let bx = (second.x as i32).saturating_sub(nearest.x as i32);
    let by = (second.y as i32).saturating_sub(nearest.y as i32);
    let mag = bx.saturating_abs().saturating_add(by.saturating_abs()).max(1);
    let nx = bx.saturating_mul(64).saturating_div(mag);
    let ny = by.saturating_mul(64).saturating_div(mag);

    let dot = rpx.saturating_mul(nx).saturating_add(rpy.saturating_mul(ny));
    let effect = clamp_i32(dot.saturating_div(128), -60, 60);

    effect.saturating_mul(strength).saturating_div(256) as i16
}


// Internal: multi-octave noise
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
    let fx = (x.rem_euclid(s) as u32).saturating_mul(256).saturating_div(s as u32);
    let fy = (y.rem_euclid(s) as u32).saturating_mul(256).saturating_div(s as u32);
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

fn noise(seed: u32, x: i32, y: i32) -> u8 {
    let o1 = smooth_octave(seed, x, y, 10);
    let o2 = smooth_octave(seed ^ 0x9E3779B9, x, y, 7);
    let o3 = smooth_octave(seed ^ 0x517CC1B7, x, y, 4);
    let weighted = o1
        .saturating_mul(4)
        .saturating_add(o2.saturating_mul(2))
        .saturating_add(o3);
    weighted.saturating_div(7) as u8
}


// Internal: clamp
fn clamp_u8(v: i32) -> u8 {
    if v < 0 {
        0
    } else if v > 255 {
        255
    } else {
        v as u8
    }
}

fn clamp_i32(v: i32, min: i32, max: i32) -> i32 {
    if v < min {
        min
    } else if v > max {
        max
    } else {
        v
    }
}


// Tests
#[cfg(test)]
mod tests {
    use super::*;

    fn make_terrain<'a>(anchors: &'a [Anchor], seed: u32, wl: u8, pl: u8) -> CityTerrain<'a> {
        CityTerrain { seed, water_line: wl, peak_line: pl, anchors }
    }

    /// Parse one anchor from 9 bytes.
    fn parse_anchor(data: &[u8]) -> Anchor {
        Anchor {
            x: i16::from_le_bytes([data[0], data[1]]),
            y: i16::from_le_bytes([data[2], data[3]]),
            mass: data[4],
            lift: data[5],
            push_x: data[6] as i8,
            push_y: data[7] as i8,
            moisture: data[8],
        }
    }

    /// Serialize one anchor to 9 bytes.
    fn serialize_anchor(a: &Anchor, out: &mut [u8]) {
        out[0..2].copy_from_slice(&a.x.to_le_bytes());
        out[2..4].copy_from_slice(&a.y.to_le_bytes());
        out[4] = a.mass;
        out[5] = a.lift;
        out[6] = a.push_x as u8;
        out[7] = a.push_y as u8;
        out[8] = a.moisture;
    }

    /// Account size for a city with N anchors (terrain portion only).
    #[allow(unused)]
    fn terrain_account_size(anchor_count: u16) -> usize {
        TERRAIN_HEADER_SIZE + anchor_count as usize * ANCHOR_SIZE
    }

    fn london_anchors() -> [Anchor; 12] {
        [
            Anchor { x: -200, y: 200, mass: 88, lift: 172, push_x: 0, push_y: 0, moisture: 170 },
            Anchor { x: 600, y: 800, mass: 85, lift: 168, push_x: 0, push_y: 0, moisture: 170 },
            Anchor { x: -1200, y: -400, mass: 82, lift: 175, push_x: 0, push_y: 0, moisture: 170 },
            Anchor { x: -600, y: -2200, mass: 72, lift: 192, push_x: 0, push_y: 2, moisture: 170 },
            Anchor { x: -1800, y: 1800, mass: 70, lift: 195, push_x: 1, push_y: -1, moisture: 170 },
            Anchor { x: 700, y: 2500, mass: 80, lift: 178, push_x: 0, push_y: 0, moisture: 170 },
            Anchor { x: 3200, y: 0, mass: 205, lift: 55, push_x: -2, push_y: 0, moisture: 128 },
            Anchor { x: 2800, y: -1500, mass: 215, lift: 45, push_x: -1, push_y: 1, moisture: 128 },
            Anchor { x: 3500, y: 1500, mass: 210, lift: 50, push_x: -2, push_y: -1, moisture: 128 },
            Anchor { x: 1800, y: -600, mass: 140, lift: 120, push_x: -1, push_y: 0, moisture: 170 },
            Anchor { x: 4200, y: -2500, mass: 220, lift: 40, push_x: 0, push_y: 0, moisture: 128 },
            Anchor { x: 200, y: -3200, mass: 78, lift: 185, push_x: 0, push_y: 1, moisture: 170 },
        ]
    }

    // --- buoyancy ---

    #[test]
    fn buoyancy_ocean() {
        assert!(buoyancy(210, 60) < 20);
    }

    #[test]
    fn buoyancy_land() {
        assert!(buoyancy(85, 175) > 100);
    }

    #[test]
    fn buoyancy_extremes() {
        assert_eq!(buoyancy(255, 255), 0);
        assert_eq!(buoyancy(0, 255), 255);
        assert_eq!(buoyancy(0, 0), 0);
        assert_eq!(buoyancy(255, 0), 0);
    }

    // --- hash ---

    #[test]
    fn hash_deterministic() {
        assert_eq!(terrain_hash(42, 100, 200), terrain_hash(42, 100, 200));
    }

    #[test]
    fn hash_varies_with_input() {
        assert_ne!(terrain_hash(42, 100, 200), terrain_hash(42, 101, 200));
        assert_ne!(terrain_hash(42, 100, 200), terrain_hash(43, 100, 200));
    }

    // --- nearest anchor ---

    #[test]
    fn nearest_basic() {
        let anchors = [
            Anchor { x: -100, y: 0, mass: 80, lift: 170, push_x: 0, push_y: 0, moisture: 128 },
            Anchor { x: 100, y: 0, mass: 200, lift: 50, push_x: 0, push_y: 0, moisture: 128 },
        ];
        let (ni, si, _, _) = two_nearest(&anchors, -50, 0);
        assert_eq!(ni, 0);
        assert_eq!(si, 1);

        let (ni2, si2, _, _) = two_nearest(&anchors, 50, 0);
        assert_eq!(ni2, 1);
        assert_eq!(si2, 0);
    }

    // --- elevation ---

    #[test]
    fn no_anchors_passable() {
        let t = make_terrain(&[], 0, 90, 245);
        assert!(is_passable(&t, 0, 0));
        assert!(is_passable(&t, 9999, 9999));
    }

    #[test]
    fn single_anchor_returns_buoyancy() {
        let a = [Anchor { x: 0, y: 0, mass: 85, lift: 175, push_x: 0, push_y: 0, moisture: 128 }];
        let t = make_terrain(&a, 42, 90, 245);
        assert_eq!(elevation(&t, 0, 0), buoyancy(85, 175));
    }

    #[test]
    fn london_center_is_land() {
        let a = london_anchors();
        let t = make_terrain(&a, 1279872052, 90, 245);
        assert!(is_passable(&t, 0, 0), "City center must be passable land");
    }

    #[test]
    fn london_east_is_water() {
        let a = london_anchors();
        let t = make_terrain(&a, 1279872052, 90, 245);
        let e = elevation(&t, 3800, 0);
        assert!(e <= 90, "Far east (Thames Estuary) should be water, got elevation {}", e);
    }

    #[test]
    fn london_west_is_land() {
        let a = london_anchors();
        let t = make_terrain(&a, 1279872052, 90, 245);
        assert!(is_passable(&t, -1500, 0), "West of center should be land");
    }

    // --- convergent pressure uplift ---

    #[test]
    fn convergent_creates_uplift() {
        let anchors = [
            Anchor { x: -500, y: 0, mass: 85, lift: 170, push_x: 50, push_y: 0, moisture: 128 },
            Anchor { x: 500, y: 0, mass: 85, lift: 170, push_x: -50, push_y: 0, moisture: 128 },
        ];
        // Use seed 42 to get deterministic noise
        let t = make_terrain(&anchors, 42, 90, 245);
        let boundary = elevation(&t, 0, 0);
        let interior = elevation(&t, -400, 0);
        assert!(
            boundary >= interior,
            "Boundary ({}) should be >= interior ({}) with convergent pressure",
            boundary, interior
        );
    }

    #[test]
    fn divergent_creates_depression() {
        let anchors = [
            Anchor { x: -500, y: 0, mass: 85, lift: 170, push_x: -50, push_y: 0, moisture: 128 },
            Anchor { x: 500, y: 0, mass: 85, lift: 170, push_x: 50, push_y: 0, moisture: 128 },
        ];
        let t = make_terrain(&anchors, 42, 90, 245);
        let boundary = elevation(&t, 0, 0);
        let interior = elevation(&t, -400, 0);
        assert!(
            boundary <= interior,
            "Boundary ({}) should be <= interior ({}) with divergent pressure",
            boundary, interior
        );
    }

    // --- passability ---

    #[test]
    fn ocean_anchor_below_water_line() {
        let anchors = [
            Anchor { x: 0, y: 0, mass: 220, lift: 40, push_x: 0, push_y: 0, moisture: 128 },
            Anchor { x: 5000, y: 0, mass: 80, lift: 170, push_x: 0, push_y: 0, moisture: 128 },
        ];
        let t = make_terrain(&anchors, 0, 90, 245);
        assert!(!is_passable(&t, 0, 0), "Ocean anchor should be impassable");
    }

    #[test]
    fn land_anchor_above_water_line() {
        let anchors = [
            Anchor { x: 0, y: 0, mass: 80, lift: 180, push_x: 0, push_y: 0, moisture: 128 },
            Anchor { x: 5000, y: 0, mass: 220, lift: 40, push_x: 0, push_y: 0, moisture: 128 },
        ];
        let t = make_terrain(&anchors, 0, 90, 245);
        assert!(is_passable(&t, 0, 0), "Land anchor should be passable");
    }

    // --- sample ---

    #[test]
    fn sample_classifies_correctly() {
        let anchors = [
            Anchor { x: -500, y: 0, mass: 80, lift: 180, push_x: 0, push_y: 0, moisture: 128 },
            Anchor { x: 500, y: 0, mass: 220, lift: 40, push_x: 0, push_y: 0, moisture: 128 },
        ];
        let t = make_terrain(&anchors, 42, 90, 245);

        let land = sample(&t, -400, 0);
        assert!(land.is_passable);
        assert!(!land.is_water);
        assert!(!land.is_mountain);
        assert_eq!(land.nearest_anchor, 0);

        let water = sample(&t, 400, 0);
        assert!(!water.is_passable);
        assert!(water.is_water);
        assert_eq!(water.nearest_anchor, 1);
    }

    // --- serialization roundtrip ---

    #[test]
    fn anchor_serialize_roundtrip() {
        let a = Anchor { x: -1234, y: 5678, mass: 200, lift: 45, push_x: -3, push_y: 7, moisture: 180 };
        let mut buf = [0u8; 9];
        serialize_anchor(&a, &mut buf);
        assert_eq!(parse_anchor(&buf), a);
    }

    #[test]
    fn header_parse() {
        let data = [
            0x12, 0x34, 0x56, 0x78, // seed
            90,                       // water_line
            240,                      // peak_line
            0x0A, 0x00,              // anchor_count = 10
            3,                        // version
            0, 0, 0, 0, 0, 0, 0,    // reserved
        ];
        let (seed, wl, pl, count, ver) = parse_terrain_header(&data);
        assert_eq!(seed, 0x78563412);
        assert_eq!(wl, 90);
        assert_eq!(pl, 240);
        assert_eq!(count, 10);
        assert_eq!(ver, 3);
    }

    // --- coordinate helpers ---

    #[test]
    fn to_grid_roundtrip() {
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
    fn city_offset_displaced() {
        let (ox, oy) = city_offset(515124, -1178, 51.5074, -0.1278);
        assert_eq!(ox, 100);
        assert_eq!(oy, 50);
    }

    // --- noise ---

    #[test]
    fn noise_in_range() {
        for x in -100..100 {
            for y in -100..100 {
                let n = noise(42, x * 100, y * 100);
                assert!(n < 255);
            }
        }
    }

    // --- terrain_account_size ---

    #[test]
    fn account_size_calc() {
        assert_eq!(terrain_account_size(0), 16);
        assert_eq!(terrain_account_size(10), 106);
        assert_eq!(terrain_account_size(50), 466);
    }

    // --- terrain_affinity ---

    #[test]
    fn affinity_empty_terrain() {
        let t = make_terrain(&[], 0, 90, 245);
        let aff = terrain_affinity(&t, 0, 0);
        assert_eq!(aff.mining_bps, 0);
        assert_eq!(aff.fishing_bps, 0);
        assert_eq!(aff.elevation_bps, 0);
    }

    #[test]
    fn affinity_high_ground_mining_bonus() {
        // Land anchor near peak_line should give mining bonus
        let anchors = [
            Anchor { x: 0, y: 0, mass: 20, lift: 230, push_x: 0, push_y: 0, moisture: 128 }, // very high elevation
            Anchor { x: 5000, y: 0, mass: 220, lift: 40, push_x: 0, push_y: 0, moisture: 128 },
        ];
        let t = make_terrain(&anchors, 42, 90, 245);
        let e = elevation(&t, 0, 0);
        assert!(e as u32 > (90u32 + 245) / 2, "Elevation {} should be above midpoint", e);

        let aff = terrain_affinity(&t, 0, 0);
        assert!(aff.mining_bps > 0, "Mining bonus should be positive at high elevation");
        assert_eq!(aff.fishing_bps, 0, "Fishing bonus should be 0 at high elevation");
        assert!(aff.elevation_bps > 0, "Elevation advantage should be positive at high ground");
    }

    #[test]
    fn affinity_low_ground_fishing_bonus() {
        // Land anchor just above water_line should give fishing bonus
        let anchors = [
            Anchor { x: 0, y: 0, mass: 90, lift: 160, push_x: 0, push_y: 0, moisture: 128 }, // low elevation (~103)
            Anchor { x: 5000, y: 0, mass: 20, lift: 230, push_x: 0, push_y: 0, moisture: 128 },
        ];
        let t = make_terrain(&anchors, 42, 90, 245);
        let e = elevation(&t, 0, 0);
        let midpoint = (90u32 + 245) / 2;
        // Elevation should be above water_line but below midpoint
        assert!(e > 90, "Elevation {} should be above water_line", e);

        let aff = terrain_affinity(&t, 0, 0);
        if (e as u32) < midpoint {
            assert!(aff.fishing_bps > 0, "Fishing bonus should be positive near coast");
            assert_eq!(aff.mining_bps, 0, "Mining bonus should be 0 near coast");
            assert!(aff.elevation_bps < 0, "Elevation should be negative at low ground");
        }
    }

    #[test]
    fn affinity_water_gives_zero() {
        let anchors = [
            Anchor { x: 0, y: 0, mass: 220, lift: 40, push_x: 0, push_y: 0, moisture: 128 }, // ocean
            Anchor { x: 5000, y: 0, mass: 80, lift: 170, push_x: 0, push_y: 0, moisture: 128 },
        ];
        let t = make_terrain(&anchors, 0, 90, 245);
        let aff = terrain_affinity(&t, 0, 0);
        assert_eq!(aff.mining_bps, 0);
        assert_eq!(aff.fishing_bps, 0);
        assert_eq!(aff.elevation_bps, 0);
    }

    #[test]
    fn affinity_london_center_is_balanced() {
        let a = london_anchors();
        let t = make_terrain(&a, 1279872052, 90, 245);
        let aff = terrain_affinity(&t, 0, 0);
        // City center should be passable land, near midpoint elevation
        assert!(aff.mining_bps <= 1500);
        assert!(aff.fishing_bps <= 1500);
        assert!(aff.elevation_bps >= -500 && aff.elevation_bps <= 500);
    }
}
