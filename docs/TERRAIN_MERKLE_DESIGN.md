# Terrain System

> Terrain is a pure function — computed on-chain in ~100 CU, zero proofs, zero transaction overhead.

## Problem

Movement validates only that a destination falls within a city's circular radius. Players can walk into the ocean, through mountains, or across lakes. We need passability without external infrastructure.

## How It Works

Every city has a set of **anchors** — weighted points beneath the surface. Each anchor has mass and lift. Heavy anchors sink the surface (water). Light buoyant anchors raise it (land, hills). Where anchors meet, directional pressure between them creates ridges or depressions. A noise layer adds organic texture.

```
elevation = buoyancy(nearest_anchor) + pressure_effect(boundary) + noise
passable  = elevation > water_line AND elevation < peak_line
```

The function is **deterministic and pure**. Same inputs → same output on every validator, every client, every test. The on-chain data IS the terrain — no external files, no proofs, no infrastructure.

## Data Structures

### Anchor (8 bytes)

```rust
#[repr(C)]
pub struct Anchor {
    pub x: i16,        // 2 — offset from city center (grid units, 0.0001°)
    pub y: i16,        // 2 — offset from city center
    pub mass: u8,       // 1 — weight (0=featherlight, 255=heavy). Heavy sinks.
    pub lift: u8,       // 1 — buoyancy (0=none, 255=max). More lift = higher surface.
    pub push_x: i8,     // 1 — directional pressure x (-128 to 127)
    pub push_y: i8,     // 1 — directional pressure y
}
```

| Surface type | mass | lift | push | Resulting elevation |
|---|---|---|---|---|
| Deep water | 210-240 | 30-60 | varies | Very low → below water_line |
| Shallow water | 180-210 | 50-80 | varies | Low → below water_line |
| Shore/beach | 110-140 | 120-150 | varies | Barely above water_line |
| Flat land | 80-110 | 150-180 | ~0 | Moderate |
| Rolling hills | 70-90 | 170-200 | slight | Higher |
| Mountains | 60-80 | 190-220 | convergent | High + pressure uplift |

### CityAccount (extended)

Terrain fields appended to the existing CityAccount. The anchor array is a variable-length tail.

```rust
pub struct CityAccount {
    // --- existing fields (164 bytes) ---
    pub game_engine: Pubkey,
    pub city_id: u16,
    pub name: [u8; 32],
    pub latitude: f64,
    pub longitude: f64,
    pub radius_km: f32,
    pub city_type: u8,
    pub players_present: u32,
    pub active_encounters: u64,
    pub total_encounters_spawned: u64,
    pub founded_at: i64,
    pub min_encounter_level: u8,
    pub max_encounter_level: u8,
    pub bump: u8,
    pub _padding1: [u8; 1],
    pub arena_season_id: u32,

    // --- terrain fields ---
    pub terrain_seed: u32,      // 4 — noise seed (unique per city)
    pub water_line: u8,         // 1 — elevation ≤ this = water (impassable)
    pub peak_line: u8,          // 1 — elevation ≥ this = mountain (impassable)
    pub anchor_count: u16,      // 2 — number of anchors
    pub terrain_version: u8,    // 1 — incremented on updates (client cache key)
    pub _terrain_reserved: [u8; 7], // 7 — future use

    // --- TERRAIN_HEADER = 16 bytes ---

    // Variable-length tail
    pub anchors: [Anchor],      // anchor_count × 8 bytes
}
```

**Total new fixed overhead**: 16 bytes. Each anchor adds 8 bytes.

| Anchors | Extra bytes | Rent delta |
|---|---|---|
| 10 | 96 | ~0.001 SOL |
| 50 | 416 | ~0.004 SOL |
| 200 | 1,616 | ~0.012 SOL |
| 500 | 4,016 | ~0.030 SOL |

When `anchor_count == 0`, terrain is disabled and all coordinates are passable.

## The Elevation Function

### 1. Nearest Anchor (Voronoi)

Each point on the map belongs to whichever anchor is closest. The second-closest anchor defines the boundary zone.

```rust
fn two_nearest(anchors: &[Anchor], ox: i32, oy: i32) -> (usize, usize, u64, u64) {
    let mut best = (0, u64::MAX);
    let mut second = (0, u64::MAX);
    for (i, a) in anchors.iter().enumerate() {
        let dx = ox as i64 - a.x as i64;
        let dy = oy as i64 - a.y as i64;
        let d = (dx * dx + dy * dy) as u64;
        if d < best.1 {
            second = best;
            best = (i, d);
        } else if d < second.1 {
            second = (i, d);
        }
    }
    (best.0, second.0, best.1, second.1)
}
```

~20 CU per anchor.

### 2. Buoyancy — Base Elevation

```rust
fn buoyancy(mass: u8, lift: u8) -> u8 {
    // lift × (255 - mass) / 255
    // High lift + low mass → high elevation
    // Low lift + high mass → low elevation
    ((lift as u32 * (255 - mass as u32)) / 255) as u8
}
```

This is isostasy in one line. A featherlight anchor with max lift produces elevation 255. A heavy anchor with no lift produces 0.

### 3. Pressure Effect — Boundary Interaction

Where two anchors meet, their directional pressure determines if the boundary rises (ridge) or sinks (valley).

```rust
fn pressure_effect(
    nearest: &Anchor,
    second: &Anchor,
    dist_n: u64,
    dist_s: u64,
) -> i16 {
    let total = dist_n + dist_s;
    if total == 0 { return 0; }

    // How close to the boundary (0=anchor center, 128=boundary edge)
    let proximity = (dist_n * 128 / total) as u32;
    if proximity < 64 { return 0; } // Too far from boundary

    let strength = ((proximity - 64) * 4).min(255) as i32;

    // Relative pressure between the two anchors
    let rpx = nearest.push_x as i32 - second.push_x as i32;
    let rpy = nearest.push_y as i32 - second.push_y as i32;
    if rpx == 0 && rpy == 0 { return 0; }

    // Boundary direction (nearest → second)
    let bx = second.x as i32 - nearest.x as i32;
    let by = second.y as i32 - nearest.y as i32;
    let mag = (bx.abs() + by.abs()).max(1);
    let nx = (bx * 64) / mag;
    let ny = (by * 64) / mag;

    // Positive dot = pushing together = uplift
    // Negative dot = pulling apart = depression
    let dot = rpx * nx + rpy * ny;
    let effect = (dot / 128).clamp(-60, 60);

    (effect * strength / 256) as i16
}
```

### 4. Noise — Organic Texture

Three octaves of hash noise at different scales. Large features dominate (4:2:1 weighting).

```rust
fn terrain_hash(seed: u32, x: i32, y: i32) -> u8 {
    let mut h = seed ^ (x as u32) ^ (y as u32).rotate_left(16);
    h ^= h >> 13;
    h = h.wrapping_mul(0x45D9F3B);
    h ^= h >> 16;
    h = h.wrapping_mul(0x45D9F3B);
    h ^= h >> 16;
    (h & 0xFF) as u8
}

/// Octave 1 (>>10): ~11 km — coastline shapes
/// Octave 2 (>>7):  ~1.4 km — bays, peninsulas
/// Octave 3 (>>4):  ~180 m — coves, small islands
fn noise(seed: u32, x: i32, y: i32) -> u8 {
    let o1 = terrain_hash(seed, x >> 10, y >> 10) as u32;
    let o2 = terrain_hash(seed ^ 0x9E3779B9, x >> 7, y >> 7) as u32;
    let o3 = terrain_hash(seed ^ 0x517CC1B7, x >> 4, y >> 4) as u32;
    ((o1 * 4 + o2 * 2 + o3) / 7) as u8
}
```

### 5. Combine

```rust
pub fn elevation(city: &CityTerrain, ox: i32, oy: i32) -> u8 {
    if city.anchors.len() < 2 {
        return if city.anchors.len() == 1 {
            buoyancy(city.anchors[0].mass, city.anchors[0].lift)
        } else {
            128
        };
    }

    let (ni, si, dn, ds) = two_nearest(&city.anchors, ox, oy);
    let base = buoyancy(city.anchors[ni].mass, city.anchors[ni].lift) as i32;
    let pressure = pressure_effect(&city.anchors[ni], &city.anchors[si], dn, ds) as i32;
    let texture = (noise(city.terrain_seed, ox, oy) as i32 - 128) / 4; // ±32

    (base + pressure + texture).clamp(0, 255) as u8
}

pub fn is_passable(city: &CityTerrain, ox: i32, oy: i32) -> bool {
    if city.anchor_count == 0 { return true; }
    let e = elevation(city, ox, oy);
    e > city.water_line && e < city.peak_line
}
```

### Compute Budget

| Step | CU (50 anchors) |
|---|---|
| Two nearest anchors | ~1,000 |
| Buoyancy | ~10 |
| Pressure effect | ~30 |
| 3-octave noise | ~30 |
| Combine + clamp | ~10 |
| **Total** | **~1,080** |

`intracity_start` uses ~60,000 of 200,000 CU. Terrain adds <2%.

**Transaction size impact: zero.** No proofs. No extra instruction data. The travel processor reads terrain from the CityAccount it already loads.

## Integration Points

### Travel Processors

Insert after `is_within_city_bounds()` in `intracity_start`, `intercity_start`, `intercity_teleport`:

```rust
if city.anchor_count > 0 {
    let ox = dest_grid_long - to_grid(city.longitude);
    let oy = dest_grid_lat - to_grid(city.latitude);
    if !terrain::is_passable(city, ox, oy) {
        return Err(GameError::DestinationImpassable.into());
    }
}
```

For `intercity_teleport`, destination is city center (0, 0) — always passable by design, but checked for consistency.

### Encounter Spawns

`encounter/spawn.rs` validates the spawn coordinate:

```rust
if city.anchor_count > 0 {
    let ox = spawn_grid_long - to_grid(city.longitude);
    let oy = spawn_grid_lat - to_grid(city.latitude);
    if !terrain::is_passable(city, ox, oy) {
        return Err(GameError::EncounterSpawnImpassable.into());
    }
}
```

Prevents encounters from appearing in the ocean or on mountain peaks.

### Elevation-Based Gameplay

The elevation value (0-255) is already computed during travel. It can modify gameplay without additional cost:

```rust
let e = terrain::elevation(city, ox, oy);

// Coastal bonus: near water_line → resource collection boost
let coastal_bonus_bps = if e > city.water_line && e < city.water_line + 20 {
    500 // +5% near coastlines
} else { 0 };

// Highland bonus: high elevation → defense boost
let highland_bonus_bps = if e > 180 && e < city.peak_line {
    300 // +3% at high elevation
} else { 0 };
```

This is free — the elevation function already ran for the passability check. Specific bonus values and which systems they affect can be tuned later without changing the terrain system itself.

### Error Codes

```rust
// Terrain Errors (8200-8209)
DestinationImpassable = 8200,       // Water or mountain
TerrainDataCorrupt = 8201,          // Anchor count vs account size mismatch
EncounterSpawnImpassable = 8202,    // Spawn point is water or mountain
```

## Instructions

### `set_terrain` (Discriminator 320)

Sets or replaces terrain data for a city. Reallocs the CityAccount to fit anchors.

```
Authority: DAO-gated (game_engine.dao_authority)
```

| # | W | S | Account |
|---|---|---|---|
| 0 | ✓ | | city |
| 1 | ✓ | ✓ | dao_authority (payer for realloc) |
| 2 | | | game_engine |
| 3 | | | system_program |

```
Instruction data:
[0..4]    terrain_seed: u32
[4]       water_line: u8
[5]       peak_line: u8
[6..8]    anchor_count: u16
[8..]     anchors: [Anchor; anchor_count]
```

Behavior:
1. Validate DAO authority
2. Realloc city account to `CITY_BASE_SIZE + TERRAIN_HEADER + anchor_count * 8`
3. Write terrain header + anchors
4. Increment terrain_version
5. Emit `TerrainUpdated { city_id, anchor_count, version }`

### `add_anchors` (Discriminator 321)

Appends anchors without replacing existing ones. For iterative refinement.

```
[0..2]    count: u16
[2..]     new_anchors: [Anchor; count]
```

Reallocs, appends, increments version.

### `update_anchor` (Discriminator 322)

Modifies a single anchor by index.

```
[0..2]    index: u16
[2..10]   anchor: Anchor
```

### `remove_anchors` (Discriminator 323)

Removes anchors by index (swap-remove from end). Indices sorted descending.

```
[0..2]    count: u16
[2..]     indices: [u16; count]
```

### `update_terrain_config` (Discriminator 324)

Updates seed, water_line, or peak_line without touching anchors.

```
[0..4]    terrain_seed: u32
[4]       water_line: u8
[5]       peak_line: u8
```

## Client Rendering

The on-chain CityAccount data translates directly to a visual terrain map. The client runs the **exact same** elevation function and maps the output to colors.

### Pipeline

```
1. Fetch CityAccount from chain
         ↓
2. Deserialize anchor array from variable-length tail
         ↓
3. For each pixel in the city viewport:
     a. Convert pixel → (offset_x, offset_y) in grid units
     b. Compute elevation(anchors, seed, ox, oy)
     c. Map elevation → RGBA color
         ↓
4. Write to canvas ImageData / GPU texture
         ↓
5. Cache keyed by (city_id, terrain_version)
     Only re-render when version changes
```

### Deserialization (TypeScript)

```typescript
interface Anchor {
  x: number;      // i16
  y: number;      // i16
  mass: number;   // u8
  lift: number;   // u8
  pushX: number;  // i8
  pushY: number;  // i8
}

interface CityTerrain {
  seed: number;         // u32
  waterLine: number;    // u8
  peakLine: number;     // u8
  anchorCount: number;  // u16
  version: number;      // u8
  anchors: Anchor[];
}

function deserializeTerrain(data: Buffer, offset: number): CityTerrain {
  const seed = data.readUInt32LE(offset);
  const waterLine = data.readUInt8(offset + 4);
  const peakLine = data.readUInt8(offset + 5);
  const anchorCount = data.readUInt16LE(offset + 6);
  const version = data.readUInt8(offset + 8);

  const anchorsStart = offset + 16; // after header + reserved
  const anchors: Anchor[] = [];
  for (let i = 0; i < anchorCount; i++) {
    const base = anchorsStart + i * 8;
    anchors.push({
      x: data.readInt16LE(base),
      y: data.readInt16LE(base + 2),
      mass: data.readUInt8(base + 4),
      lift: data.readUInt8(base + 5),
      pushX: data.readInt8(base + 6),
      pushY: data.readInt8(base + 7),
    });
  }

  return { seed, waterLine, peakLine, anchorCount, version, anchors };
}
```

### Color Mapping

```typescript
function elevationToColor(
  elev: number,
  waterLine: number,
  peakLine: number,
): [number, number, number] {
  if (elev <= waterLine) {
    // Water: dark blue (deep) → light blue (shallow)
    const depth = (waterLine - elev) / waterLine;
    return [
      Math.round(20 + 40 * (1 - depth)),   // R
      Math.round(60 + 80 * (1 - depth)),   // G
      Math.round(120 + 100 * (1 - depth)), // B
    ];
  }

  if (elev >= peakLine) {
    // Mountains: gray → white
    const height = (elev - peakLine) / (255 - peakLine);
    const v = Math.round(160 + 80 * height);
    return [v, v, v];
  }

  // Land: sandy shore → green plains → brown hills
  const t = (elev - waterLine) / (peakLine - waterLine);

  if (t < 0.1) {
    // Beach/shore
    return [210, 200, 160];
  } else if (t < 0.5) {
    // Green lowlands → darker green
    const g = 1 - (t - 0.1) / 0.4;
    return [
      Math.round(60 + 40 * g),
      Math.round(120 + 60 * g),
      Math.round(40 + 20 * g),
    ];
  } else {
    // Brown hills → rocky
    const h = (t - 0.5) / 0.5;
    return [
      Math.round(100 + 50 * h),
      Math.round(80 + 30 * h),
      Math.round(40 + 30 * h),
    ];
  }
}
```

### Canvas Rendering

```typescript
function renderCityTerrain(
  ctx: CanvasRenderingContext2D,
  terrain: CityTerrain,
  canvasSize: number,
  radiusGridUnits: number,
) {
  const img = ctx.createImageData(canvasSize, canvasSize);
  const center = canvasSize / 2;
  const scale = radiusGridUnits / center;

  for (let py = 0; py < canvasSize; py++) {
    for (let px = 0; px < canvasSize; px++) {
      const ox = Math.round((px - center) * scale);
      const oy = Math.round((center - py) * scale);

      // Circular city boundary
      if (ox * ox + oy * oy > radiusGridUnits * radiusGridUnits) continue;

      const elev = terrainElevation(terrain, ox, oy);
      const [r, g, b] = elevationToColor(elev, terrain.waterLine, terrain.peakLine);

      const i = (py * canvasSize + px) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
}
```

### Rendering Resolution

| View | Pixels | Grid units/pixel | Render time (~) |
|---|---|---|---|
| World map thumbnail | 64×64 | ~140 | <10ms |
| City overview | 256×256 | ~35 | ~50ms |
| City detail | 512×512 | ~18 | ~200ms |
| Zoomed in | 1024×1024 | ~9 | ~800ms |

Render once, cache as texture. Re-render only when `terrain_version` changes.

For the zoomed-in view, a web worker can compute the elevation grid off the main thread, then transfer the ImageData back for display.

## Generating Cities from Real Locations

### Fitting Algorithm

Given a real city's geography, automatically produce anchor configurations:

```
1. SAMPLE — scatter ~2000 points within the city radius
   - Classify each as land or water (from coastline data)
   - Read elevation for land points (from DEM data)

2. CLUSTER — group by terrain type
   - Water vs land (primary split)
   - Sub-cluster water by depth (shallow coastal / deep ocean)
   - Sub-cluster land by elevation (lowland / hills / mountains)
   - Target: 5-10 clusters initially

3. ASSIGN anchor properties per cluster
   Water cluster:
     mass = 190 + depth_ratio * 50     // 190-240
     lift = 70 - depth_ratio * 40      // 30-70
   Land cluster:
     mass = 120 - elevation_ratio * 50  // 70-120
     lift = 140 + elevation_ratio * 60  // 140-200

4. COMPUTE pressure vectors
   For adjacent anchor pairs:
     - Elevation gradient between them → set push toward each other (ridge)
       or away (valley)

5. CALIBRATE
   - Render terrain with the computed anchors
   - Compare against real land/water classification
   - Binary search water_line (85-100) to minimize error
   - If accuracy < 90%: add corrective anchors at misclassified areas

6. REFINE
   - Repeat step 5, adding 3-5 anchors per pass
   - Typical result: 15-30 anchors at 93-97% accuracy
```

### Example: London

Center: 51.5074°N, -0.1278°W. Radius ~40 km.

Real features within the circle: Thames Estuary widening east into the North Sea. London Basin (flat, 5-50m). North Downs to the south (chalk hills ~250m). Chiltern Hills northwest (~260m).

```json
{
  "seed": 1279872052,
  "waterLine": 90,
  "peakLine": 245,
  "anchors": [
    {"x": -200,  "y": 200,   "mass": 88,  "lift": 172, "pushX": 0,  "pushY": 0},
    {"x": 600,   "y": 800,   "mass": 85,  "lift": 168, "pushX": 0,  "pushY": 0},
    {"x": -1200, "y": -400,  "mass": 82,  "lift": 175, "pushX": 0,  "pushY": 0},
    {"x": -600,  "y": -2200, "mass": 72,  "lift": 192, "pushX": 0,  "pushY": 2},
    {"x": -1800, "y": 1800,  "mass": 70,  "lift": 195, "pushX": 1,  "pushY": -1},
    {"x": 700,   "y": 2500,  "mass": 80,  "lift": 178, "pushX": 0,  "pushY": 0},
    {"x": 3200,  "y": 0,     "mass": 205, "lift": 55,  "pushX": -2, "pushY": 0},
    {"x": 2800,  "y": -1500, "mass": 215, "lift": 45,  "pushX": -1, "pushY": 1},
    {"x": 3500,  "y": 1500,  "mass": 210, "lift": 50,  "pushX": -2, "pushY": -1},
    {"x": 1800,  "y": -600,  "mass": 140, "lift": 120, "pushX": -1, "pushY": 0},
    {"x": 4200,  "y": -2500, "mass": 220, "lift": 40,  "pushX": 0,  "pushY": 0},
    {"x": 200,   "y": -3200, "mass": 78,  "lift": 185, "pushX": 0,  "pushY": 1}
  ]
}
```

- Anchors 0-2: Central London — flat land, moderate lift
- Anchor 3: North Downs — high lift + convergent pressure = hills
- Anchor 4: Chiltern Hills — similar, positioned northwest
- Anchors 6-8: Eastern water — heavy mass, low lift = below water_line
- Anchor 9: Coastal transition — mid-range properties create shoreline
- Noise texture breaks up the coastline into organic shapes

### Example: New York City

Center: 40.7128°N, -74.0060°W. Radius ~50 km.

```json
{
  "seed": 3045891723,
  "waterLine": 88,
  "peakLine": 240,
  "anchors": [
    {"x": -400,  "y": 300,   "mass": 90,  "lift": 170, "pushX": 0,  "pushY": 0},
    {"x": -2000, "y": 1500,  "mass": 82,  "lift": 180, "pushX": 0,  "pushY": 0},
    {"x": 1500,  "y": 1200,  "mass": 85,  "lift": 175, "pushX": 0,  "pushY": 0},
    {"x": 3500,  "y": 500,   "mass": 95,  "lift": 165, "pushX": 0,  "pushY": 0},
    {"x": 2000,  "y": -2500, "mass": 210, "lift": 50,  "pushX": 0,  "pushY": 2},
    {"x": 0,     "y": -3500, "mass": 220, "lift": 40,  "pushX": 0,  "pushY": 1},
    {"x": -2500, "y": -2000, "mass": 205, "lift": 55,  "pushX": 1,  "pushY": 1},
    {"x": 4000,  "y": -1000, "mass": 200, "lift": 60,  "pushX": -1, "pushY": 1},
    {"x": -3000, "y": 2500,  "mass": 72,  "lift": 198, "pushX": 0,  "pushY": -1},
    {"x": 1000,  "y": -800,  "mass": 130, "lift": 130, "pushX": 0,  "pushY": 1},
    {"x": -1200, "y": -200,  "mass": 88,  "lift": 172, "pushX": 0,  "pushY": 0}
  ]
}
```

- Anchors 0-3: Land mass (Manhattan through Long Island)
- Anchors 4-7: Atlantic / Harbor — heavy anchors create water to the south and east
- Anchor 8: Northwest highlands — light, high lift + convergent pressure
- Anchor 9: Harbor shoreline transition
- Noise gives the NY Harbor its irregular shape

### Example: Tokyo

Center: 35.6762°N, 139.6503°E. Radius ~55 km.

```json
{
  "seed": 1953287401,
  "waterLine": 90,
  "peakLine": 235,
  "anchors": [
    {"x": -500,  "y": 500,   "mass": 88,  "lift": 170, "pushX": 0,  "pushY": 0},
    {"x": -2000, "y": -500,  "mass": 85,  "lift": 175, "pushX": 0,  "pushY": 0},
    {"x": 500,   "y": 2000,  "mass": 82,  "lift": 178, "pushX": 0,  "pushY": 0},
    {"x": 1500,  "y": -2000, "mass": 210, "lift": 50,  "pushX": -1, "pushY": 2},
    {"x": 2500,  "y": -3500, "mass": 225, "lift": 35,  "pushX": 0,  "pushY": 1},
    {"x": -500,  "y": -3000, "mass": 215, "lift": 45,  "pushX": 0,  "pushY": 2},
    {"x": -3500, "y": 0,     "mass": 65,  "lift": 215, "pushX": 2,  "pushY": 0},
    {"x": -4200, "y": 1500,  "mass": 60,  "lift": 220, "pushX": 3,  "pushY": -1},
    {"x": 2000,  "y": 1500,  "mass": 90,  "lift": 168, "pushX": 0,  "pushY": 0},
    {"x": 3000,  "y": -800,  "mass": 200, "lift": 55,  "pushX": -1, "pushY": 0},
    {"x": 1000,  "y": -800,  "mass": 145, "lift": 115, "pushX": 0,  "pushY": 1}
  ]
}
```

- Anchors 0-2: Kantō Plain — flat land
- Anchors 3-5: Tokyo Bay → Pacific — heavy anchors, water
- Anchors 6-7: Western mountains — very light, max lift + strong convergent pressure → high elevation ridge
- Anchor 10: Bay shoreline transition

## CLI Tooling

### `terrain generate <city-id>`

Fits anchors from real geographic data.

```
$ terrain generate 0
Sampling 2000 points within 50km of (40.7128, -74.0060)...
Classified: 1247 land, 753 water
Pass 1: 8 anchors, 89% accuracy
Pass 2: 14 anchors, 94% accuracy
Pass 3: 18 anchors, 96% accuracy

Output: cli/data/terrain/city_0.json (18 anchors)
```

### `terrain preview <city-id>`

Renders terrain to terminal or image.

### `terrain register <city-id>`

Submits `set_terrain` instruction on-chain.

### `terrain add <city-id>`

Appends anchors for refinement.

## Rollout

### Phase 1: Core + Prototype
- `logic/terrain.rs` — pure elevation functions
- HTML canvas renderer — visual anchor placement tool
- Anchor configs for 5 pilot cities
- Unit tests

### Phase 2: On-Chain
- Extend CityAccount with terrain fields
- Implement `set_terrain`, `add_anchors`, `update_anchor`, `remove_anchors`
- Terrain validation in travel + encounter processors
- E2E tests

### Phase 3: Client
- SDK terrain computation (matching Rust)
- Canvas renderer in game client
- Terrain texture caching
- Pre-validation before travel TX submission

### Phase 4: Full Rollout
- Generate anchors for all 50 cities
- Register terrain on-chain
- Enable enforcement
- Elevation-based gameplay bonuses
