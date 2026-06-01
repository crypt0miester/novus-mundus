# Town View — Design Document

## Vision

A persistent, isometric 3D town that every player sees from the same camera angle — but whose buildings, decorations, activity, and life emerge entirely from on-chain state. Two players standing in the same city see the same terrain contours, but one sees a barren clearing with a lone Mansion skeleton, while another sees a sprawling compound with forges belching sparks, observatory domes rotating, and a Citadel tower piercing through low clouds. The town is never "designed" — it *grows*.

**The town should tell the player's story.** When you look at someone's estate, you should immediately understand: what they've invested in, how far they've progressed, and what kind of player they are (combat-focused? economic? explorer?). The town is the player's home — it should feel alive and earned.

**Diorama aesthetic.** The town should feel like a precious hand-crafted miniature — a snow globe you want to stare into. Tilt-shift blur, saturated colors, tiny bustling villagers, smoke curling from chimneys. Think model railroad, not Skyrim.

---

## 1. Architecture & Data Flow

```
┌─────────────────────────────────────────────────────┐
│  Browser                                            │
│                                                     │
│  ┌──────────────┐   ┌───────────────────────────┐   │
│  │  React UI    │   │  Three.js Scene            │   │
│  │  (overlays,  │◄──┤                            │   │
│  │   tooltips,  │   │  TownRenderer              │   │
│  │   panels)    │   │    ├─ TerrainMesh           │   │
│  └──────┬───────┘   │    ├─ DistrictSystem        │   │
│         │           │    ├─ BuildingInstances[]   │   │
│         │           │    ├─ PopulationSystem      │   │
│         │           │    ├─ ParticleManager       │   │
│         │           │    ├─ WaterSystem           │   │
│         │           │    ├─ WeatherSystem         │   │
│         │           │    ├─ DayNightCycle         │   │
│         │           │    └─ PostProcessing        │   │
│         │           └───────────────────────────┘   │
│         │                        ▲                   │
│         │                        │                   │
│  ┌──────▼────────────────────────┴──────────────┐   │
│  │  TownStateManager                             │   │
│  │    ├─ CityTerrain (from CityAccount)          │   │
│  │    ├─ EstateAccount (buildings, plots, buffs)  │   │
│  │    ├─ PlayerCore (level, sub, resources)       │   │
│  │    ├─ GameEngine (theme, time config)          │   │
│  │    └─ WebSocket subscription (live updates)    │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Data Flow

1. **On load**: Fetch `CityAccount` (terrain anchors), `EstateAccount` (buildings), `PlayerCore` (progression)
2. **Terrain mesh**: Generated once from `CityTerrain` data using `terrainElevation()` + `terrainMoisture()` — guarantees visual matches on-chain passability
3. **District placement**: Voronoi districts seeded by terrain context + building types (see Section 3)
4. **Building placement**: Deterministic from district + building type — no user layout needed
5. **Live updates**: WebSocket subscription to `EstateAccount` triggers building state transitions (construction animations, level-up effects)

---

## 2. State-to-Visual Mapping

The renderer consumes on-chain state and maps every field to a visual:

```typescript
interface TownVisualState {
  // From EstateAccount
  buildings: {
    type: BuildingType;
    status: BuildingStatus;   // → construction scaffold vs active model
    level: number;            // → model LOD tier (1-5/6-12/13-18/19-20)
    mastery: number;          // → subtle glow intensity (0-100)
    constructionProgress: number; // → scaffold fill percentage (0-1)
    noviInvested: bigint;     // → building "wealth" particle density
  }[];

  plotsOwned: number;         // → which districts are unlocked (1-5)
  estateLevel: number;        // → town square evolution tier + population count

  // Cached buffs → ambient effects
  attackBps: number;          // → red aura intensity on Barracks
  defenseBps: number;         // → blue shield shimmer on walls
  resourceGenBps: number;     // → green growth particles on Workshop/Dock
  craftSuccessBps: number;    // → Forge flame color (dull → bright)

  // Daily activity → atmospheric events
  windowsCompleted: number;   // → bitflags for Dawn/Midday/Dusk effects (0b00000DML)
  loginStreak: number;        // → town decorations (banners, flowers)
  permanentBonus: number;     // → eternal flame in square

  // Active states
  activeCraft: {              // → Forge visual
    qualityTier: QualityTier;
    progress: number;
  } | null;
  activeResearch: {           // → Academy visual
    researchId: number;
    progress: number;
  } | null;
  meditatingHeroes: number;   // → Sanctuary translucent figures

  // From PlayerCore
  playerLevel: number;        // → NPC dialogue, visitor types
  subscriptionTier: number;   // → banner quality, road materials
  networth: bigint;           // → prop density (richer = more detail)

  // From CityTerrain
  terrain: CityTerrain;       // → ground mesh, water, biome
  terrainAffinity: TerrainAffinity; // → Workshop/Dock bonus glow

  // From GameEngine
  theme: Theme;               // → entire asset set
  currentTime: number;        // → day/night cycle phase
}
```

---

## 3. Terrain & Biomes

### Organic Terrain, Not a Flat Square

The town sits in natural terrain shaped by the city's actual terrain data. A town near mountains has rocky hillside terrain. A coastal town has a beach and harbor inlet. A plains town is gently rolling grassland.

- **Use the city terrain anchors** to generate real elevation
- **The town boundary is irregular** — defined by natural features (river, cliff, forest edge) rather than a square wall
- **Elevation matters visually:** Workshop sits against a hillside, Dock at the water's edge, Sanctuary on the highest point, Arena in a natural depression
- **A river or stream** runs through or alongside the town (sourced from terrain moisture data)

### Heightmap Generation

Sample `terrainElevation(terrain, ox, oy)` on a 128×128 grid across the patch:

```typescript
function buildTerrainGeometry(
  terrain: CityTerrain,
  centerOx: number,
  centerOy: number,
  gridSize: number = 128,
  patchRadius: number = 100,
): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(
    patchRadius * 2, patchRadius * 2,
    gridSize - 1, gridSize - 1,
  );
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const ly = pos.getY(i);
    const ox = Math.round(centerOx + lx);
    const oy = Math.round(centerOy + ly);

    const elev = terrainElevation(terrain, ox, oy);
    const moist = terrainMoisture(terrain, ox, oy);
    pos.setZ(i, (elev - terrain.waterLine) * 0.12);

    const [r, g, b] = elevationToColor(elev, terrain.waterLine, terrain.peakLine, moist);
    colors[i * 3] = r / 255;
    colors[i * 3 + 1] = g / 255;
    colors[i * 3 + 2] = b / 255;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}
```

### Biome Texturing

Moisture from anchors drives biome variation via a **triplanar shader**:

| Moisture | Elevation Zone | Texture | Ground Cover |
|----------|---------------|---------|--------------|
| 0-64     | Low land      | Cracked earth, sand | Dead shrubs, tumbleweeds |
| 0-64     | Mid land      | Dry grass, tan soil | Sparse cacti, rock outcrops |
| 0-64     | High land     | Red rock, scree | Wind-carved pillars |
| 65-170   | Low land      | Grass + dirt path | Wildflowers, fences |
| 65-170   | Mid land      | Dense grass, moss | Oak trees, hedgerows |
| 65-170   | High land     | Rocky meadow | Pine trees, boulders |
| 171-255  | Low land      | Mud, reeds | Puddles, lily pads, fog |
| 171-255  | Mid land      | Lush moss, ferns | Dense canopy, vines |
| 171-255  | High land     | Wet stone, waterfalls | Cloud forest, mist |

Water tiles (`elev <= waterLine`) render as animated water with depth-based tint. Mountain tiles (`elev >= peakLine`) render as impassable rocky peaks with snow caps.

---

## 4. Unlockable Districts

The town is one continuous, organic settlement. "Buying a plot" doesn't add a fenced square — it **opens up a new district** of the town.

### Voronoi-Based District Layout

Use [Delaunator](https://github.com/mapbox/delaunator) to generate Voronoi diagrams:

1. Place district seed points based on terrain context (Dock near water, Workshop near rock, etc.)
2. Generate Voronoi diagram — divides the town into organic irregular zones
3. Roads follow Voronoi cell edges, producing natural winding paths
4. Apply Lloyd relaxation (2-3 passes) to smooth cell shapes
5. Building footprints placed within cells using the district's shape grammar

This is cheap (one-time O(n log n) computation for 5-20 cells) and produces towns that feel grown rather than planned.

### How Districts Unlock

The town starts as a small cleared area around the town square — just your first district, a few buildings, paths worn into grass. As you buy more plots, the settled area physically **grows outward**:

- **Plot 1 (Starter):** The core. Town square + the immediate ring around it. A small cluster of structures, a single road leading out.
- **Plot 2:** A second district grows adjacent — connected by a road that wasn't there before. Maybe the waterfront opens up, or a hillside clearing appears. New ambient life along the connecting road.
- **Plot 3:** Three distinct neighborhoods flowing into each other. Crossroads form. A bridge might appear if a river separates districts.
- **Plot 4:** The town feels substantial. Multiple converging roads, a proper settlement.
- **Plot 5 (Prestige):** The final district — the grandest location. Hilltop, central island, or cliff overlook. Unlocking this visually crowns the town.

### No Fences Between Districts

Districts **blend** — the cobblestone of the market district gradually transitions to the packed dirt of the barracks yard. Trees thin out between the sacred grove and the forge district. A stream separates the waterfront from the mining area. Boundaries are environmental, not geometric.

### District Placement Is Contextual

| Building Placed | District Gravitates Toward |
|----------------|---------------------------|
| Dock | Water's edge / riverbank |
| Workshop | Rocky hillside / cliff face |
| Sanctuary | Highest point / secluded grove |
| Arena | Natural depression / flat clearing |
| Barracks / Citadel | Near town entrance / outer perimeter |
| Market | Center, near town square |
| Forge | Between mining and military areas |
| Academy / Observatory | Elevated, clear sightlines |
| Vault / Treasury | Deep interior, protected position |

### District Identities

| Building | District Feel | Ground Treatment | Props & Atmosphere |
|----------|--------------|-----------------|-------------------|
| **Mansion** | Noble quarter | Manicured grass, flower beds | Hedges, garden paths, ornamental trees, a gazebo |
| **Barracks** | Military yard | Packed dirt, training ring | Weapon racks, training dummies, tent rows, drill flags |
| **Workshop** | Mining camp | Rocky ground, ore deposits | Mine cart on rails, pickaxes in rock, ore piles, crane |
| **Vault** | Banking quarter | Polished stone floor | Locked chests, coin stacks, iron gates, guard posts |
| **Dock** | Waterfront | Sandy/wooden boardwalk | Pier into water, moored boat, fishing nets, crab pots, rope coils |
| **Sanctuary** | Sacred grove | Mossy stone, glowing ground | Ancient trees, meditation circles, crystal formations, floating motes |
| **Market** | Bazaar | Cobblestone, colorful | Market stalls with awnings, carts of goods, hanging lanterns, rugs |
| **Citadel** | Fortress | Stone battlements | Siege equipment, watchtower, reinforced walls, garrison tents |
| **Academy** | Scholar's court | Clean stone, inscribed | Telescope, scroll racks, astrolabe, glowing runes on ground |
| **Forge** | Smithing district | Scorched stone, soot | Anvil, bellows, quench trough, glowing crucible, spark particles |
| **Arena** | Fighting pit | Sand floor, tiered seating | Circular ring, spectator stands, trophy poles |
| **Observatory** | Tower grounds | Star-map stone floor | Tall spire, lens apparatus, star charts on easels, orrery |
| **Treasury** | Counting house | Gold-veined marble | Scales, ledger stands, gem displays, armored vault door |

**References:**
- [Watabou Medieval Fantasy City Generator](https://watabou.github.io/city.html) — [source](https://github.com/watabou/TownGeneratorOS)
- [Red Blob Games: Polygonal Map Generation](http://www-cs-students.stanford.edu/~amitp/game-programming/polygon-map-generation/)
- [SketchpunkLabs Irregular Grid](https://github.com/sketchpunklabs/irregular_grid)

---

## 5. Building Descriptions

Each of the 13 building types has **4 visual tiers** based on its level:

| Level Range | Visual Tier | Style |
|-------------|-------------|-------|
| 0 (Building) | Construction | Scaffolding, wooden frames, workers hammering |
| 1-5 | Foundation | Simple structure, basic materials, one story |
| 6-12 | Established | Two stories, decorative elements, functional details |
| 13-18 | Grand | Three stories, ornate details, glowing features |
| 19-20 | Legendary | Maximum detail, particle effects, animated elements |

### Tier 1 Buildings (Estate Level 1+)

**Mansion** (slot anchor — always built first)
- *Foundation*: A-frame timber cottage with a chimney
- *Established*: Stone manor house, glass windows, a small garden
- *Grand*: Three-wing mansion with balconies, ivy crawling up walls
- *Legendary*: Palatial estate, gold-leaf roof trim, a rose garden with fireflies
- *Signature detail*: Smoke from chimney (particle system), warmth glow from windows at night

**Barracks**
- *Foundation*: Open-air training yard with straw dummies, a tent
- *Established*: Wooden longhouse with weapon racks outside, flag pole
- *Grand*: Stone fortress barracks, crenellated walls, armory wing
- *Legendary*: War academy with floating combat dummies, sparring rings with energy barriers
- *Signature detail*: NPC soldiers drilling in the yard, clashing weapon sounds

**Workshop**
- *Foundation*: Lean-to shelter with a workbench, raw ore pile
- *Established*: Timber workshop with a waterwheel, conveyor belt
- *Grand*: Industrial workshop, multiple chimneys, minecart tracks leading out
- *Legendary*: Dwarven-style engine house, crystal-powered drills, hovering ore sorters
- *Signature detail*: Pickaxe sounds, sparks from grinding wheels, ore cart animations
- *Bonus visual*: Mining affinity glow — brighter near mountains (`terrain_affinity.mining_bps`)

**Vault**
- *Foundation*: Iron-banded chest behind a locked gate
- *Established*: Stone strongroom with heavy doors, guard NPC
- *Grand*: Underground vault entrance, runic locks, gold visible through grates
- *Legendary*: Floating vault with gravity-defying gold streams, crystalline shields
- *Signature detail*: Gold coin particle effects proportional to `cash_in_vault`

**Dock**
- *Foundation*: Simple wooden pier extending toward water
- *Established*: Covered dock with fish drying racks, a rowboat
- *Grand*: Harbor with a small sailing ship, cranes, fish market stalls
- *Legendary*: Grand port with a ghost ship, bioluminescent water, leviathan skeleton
- *Signature detail*: Seagull NPCs, bobbing boats, fish-splash water particles
- *Bonus visual*: Fishing affinity glow near coast (`terrain_affinity.fishing_bps`)
- *Orientation*: Dock always rotates to face the nearest water (lowest elevation direction)

### Tier 2 Buildings (Estate Level 10+)

**Forge**
- *Foundation*: Open-air anvil with bellows, coal pit
- *Established*: Stone smithy with a glowing furnace, weapon display wall
- *Grand*: Multi-forge complex with molten metal channels, enchanting circles
- *Legendary*: Volcanic forge — lava flows through channels, runic hammers strike autonomously
- *Signature detail*: Hammer-on-anvil animation (looped), ember particles
- *Active craft indicator*: When a craft is in progress, show the item materializing above the anvil with a progress ring. `QualityTier` determines particle color:
  - Common: white sparks | Refined: green | Superior: blue | Elite: purple
  - Masterwork: gold | Legendary: orange fire | Mythic: prismatic shimmer | Divine: white-gold supernova

**Market**
- *Foundation*: Single stall with a striped awning, barrel of goods
- *Established*: Row of market stalls, haggling NPC merchants
- *Grand*: Covered bazaar with multiple floors, exotic goods, a caravan
- *Legendary*: Floating market platforms, interdimensional portals showing other cities
- *Signature detail*: NPC shoppers walking between stalls, coin-clink sounds

**Academy**
- *Foundation*: Lectern under a tree, a few scattered books
- *Established*: Stone library with stained glass, telescope on roof
- *Grand*: University campus, multiple wings, floating books
- *Legendary*: Arcane academy — reality-warped architecture, equations visible in the air
- *Signature detail*: Floating open books, quill writing by itself
- *Active research indicator*: Glowing research tree hologram above the building with current node highlighted, progress ring shows time remaining

**Arena**
- *Foundation*: Dirt fighting pit with rope boundary
- *Established*: Stone colosseum (small), tiered seating, banner poles
- *Grand*: Full arena with iron gates, beast cages, champion statues
- *Legendary*: Spectral arena — ghostly past champions fight eternally in the stands
- *Signature detail*: Crowd roar ambient, dust clouds from fights

### Tier 3 Buildings (Estate Level 25+)

**Sanctuary**
- *Foundation*: Stone circle with a glowing center rune
- *Established*: Marble temple with a meditation garden, koi pond
- *Grand*: Crystal cathedral, stained-glass light beams, floating prayer bells
- *Legendary*: Transcendent sanctuary — building partially phases between dimensions, aurora overhead
- *Signature detail*: Meditating heroes shown as translucent sitting figures with XP particles rising. Count = `max_locked_heroes_for_sanctuary_level(level)`

**Observatory**
- *Foundation*: Wooden platform with a spyglass
- *Established*: Stone tower with rotating copper dome, lens apparatus
- *Grand*: Tall spire with orrery (planetary model) visible through windows
- *Legendary*: The dome opens to reveal a portal to the cosmos — stars swirl inside
- *Signature detail*: Dome rotation animation, lens flare at night, shooting stars

**Treasury**
- *Foundation*: Counting house — a desk with ledgers and a scales
- *Established*: Mint building with coin press, gold bar stacks
- *Grand*: Central bank — marble columns, vault door, currency printing
- *Legendary*: Dragon's hoard — a sleeping dragon atop an impossible mountain of gold
- *Signature detail*: Coins falling into chests (particle), gold reflections

**Citadel**
- *Foundation*: Watchtower with a war horn
- *Established*: Fortified tower, drawbridge, moat
- *Grand*: Castle keep with multiple towers, curtain walls, murder holes
- *Legendary*: Sky citadel — the tower extends beyond the clouds, lightning crackles at the peak
- *Signature detail*: Banner with stance indicator (Defensive=blue shield, Balanced=white, Aggressive=red sword). Visible from anywhere in the town

### Procedural Building Generation — Modular Kit

Define 15-20 modular pieces that snap together:

**Foundation modules:** Stone slab, raised platform, stilts (for Dock)
**Wall modules:** Plain wall, windowed wall, door wall, half-timbered wall, stone wall, shop-front wall (with awning)
**Roof modules:** Gable, hip, flat (with crenellations), dome, thatched, tiled
**Accent modules:** Chimney, balcony, sign post, window box, shutters, awning

Each building type has a **shape grammar**:

```
Mansion: stone_foundation + windowed_wall×4 + gable_roof + chimney + window_boxes
Barracks: raised_platform + plain_wall×4 + crenellation_roof + flag_pole
Dock: stilts_foundation + half_timber_wall×2 + flat_roof + jetty_extension
Forge: stone_foundation + stone_wall×3 + shop_front + flat_roof + tall_chimney + anvil_prop
```

### Deformation for Character

Medieval buildings shouldn't be perfectly geometric. Apply small random vertex displacement:
- Walls lean slightly (±2°)
- Roof ridge sags in the middle
- Corners don't quite meet perfectly

This sells the hand-built, aged look.

### Level Progression Within Each Tier

| Level | Material | Roof | Details | NPCs |
|-------|----------|------|---------|------|
| **1-5** | Wood (brown, rough) | Thatch | Simple shape, 1 floor | 1-2 |
| **6-10** | Stone base + wood upper | Tile | Larger footprint, added windows | 3-5 |
| **11-15** | Full stone | Slate | 2 floors, decorative trim | 6-10 |
| **16-20** | Grand stone + accents | Ornate | Unique silhouette, magical touches, golden accents | 10-15 |

Transitions use the Y-clip reveal shader — new geometry grows up from the old foundation.

**References:**
- [Procedural Modeling of Buildings (Mueller et al.)](http://peterwonka.net/Publications/pdfs/2006.SG.Mueller.ProceduralModelingOfBuildings.final.pdf)
- [Procedural Architecture Using Deformation-aware Split Grammars](https://www.researchgate.net/publication/266160272_Procedural_Architecture_Using_Deformation-aware_Split_Grammars)

---

## 6. Empty Slots & Construction

### Empty Slot Rendering

Unbuilt slots show **plot markers** that signal potential:

- **Locked district** (not yet purchased): Overgrown wilderness with a wooden stake and "FOR SALE" sign. Subtle golden NOVI symbol floats above on hover.
- **Unlocked empty slot**: Flattened earth pad with corner stones. A faint blueprint ghost of a random building flickers. Interaction opens the build menu.
- **Under construction** (`status === "Building"`): Scaffolding skeleton + Y-clip reveal shader (see below).

### Y-Clip Reveal Shader

When a building is being constructed, the full geometry is loaded but a shader clips based on progress:

```glsl
uniform float progress; // 0.0 = empty, 1.0 = complete
uniform float buildingHeight;
float edge = buildingHeight * progress;
float noise = texture2D(noiseMap, uv).r * 0.02;
if (worldPosition.y > edge + noise) discard;
// Glowing construction edge
float edgeGlow = 1.0 - smoothstep(0.0, 0.02, abs(worldPosition.y - edge));
color += edgeGlow * vec3(1.0, 0.7, 0.2);
```

The building "grows" from the ground up with a glowing dissolve edge. ~5 extra instructions per fragment.

### Scaffolding Overlay

When `status === Building` or `status === Upgrading`:
- Temporary scaffolding InstancedMesh (poles + planks) around the building
- 2-3 worker NPCs walk along the scaffold
- Construction sparks particle effect
- Scaffolding fades out when construction completes

**References:**
- [Dissolve Shader Tutorial (Febucci)](https://blog.febucci.com/2018/09/dissolve-shader/)
- [World Reveal Shader](https://blog.febucci.com/2018/09/world-reveal-shader/)

---

## 7. Town Square

The center is always present — a cobblestone plaza that evolves with estate level:

| Estate Level | Town Square Stage | Visual |
|-------------|------------------|--------|
| **1-9** | Bare clearing | Wooden stakes marking boundaries, muddy paths, campfire |
| **10-19** | Cobblestone plaza | Iron lamp posts, a market stall frame, well |
| **20-39** | Proper square | Fountain with flowing water, flower beds, lanterns |
| **40-59** | Grand plaza | Stone archways, seasonal decorations, wandering merchants |
| **60+** | Monumental | Golden trim, floating runic orbs, eternal flame centerpiece |

**Always present:**
- **Road network**: Dirt paths (Lv1-9), cobblestone (10-19), polished stone (20+)
- **Town banner**: Displays the kingdom theme sigil
- **Activity board**: Glowing runes showing active daily window (Dawn/Midday/Dusk)

Estate level = sum of all building levels, reflecting total progression.

---

## 8. Population System — Giving It Life

The difference between a 3D model and a living town. Hundreds of tiny moving entities — villagers, animals, carts, particles — all at 60fps.

### Architecture: InstancedMesh + BVH

Use **[three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)** for:
1. Efficient raycasting against complex terrain + building meshes
2. Spatial queries for NPC ground-height sampling
3. NPC spawning — find road-adjacent positions via spatial query

Use **InstancedMesh** for everything that repeats:
- One `InstancedMesh` for all villager bodies (same geometry, different transforms)
- One for all villager heads
- One for all chickens/animals
- One for all tree trunks, one for all leaf clusters
- One for all grass blade clumps

Hundreds of entities rendered in **a handful of draw calls**.

### NPC Rendering

**Two strategies depending on camera distance:**

**Near camera (within 3 units):** Low-poly 3D figures — body cone + head sphere + optional tool prop. 5-8 triangles each. InstancedMesh with per-instance color tint.

**Far camera (beyond 3 units):** Billboard sprites. Pre-render 4-8 NPC types as isometric sprite sheets (8 directions × 4 animation frames). InstancedMesh with textured quads, per-instance UV offset animated in shader.

### Villager Types

| Type | Appears Near | Behavior |
|------|-------------|----------|
| Worker | Workshop | Walks between mine entrance and ore pile, carries pickaxe |
| Fisher | Dock | Stands at pier, casts line, walks to fish barrel |
| Soldier | Barracks | Marches in formation, patrols perimeter |
| Scholar | Academy | Walks slowly between scroll racks, stargazes at Observatory |
| Merchant | Market | Tends stall, walks between carts |
| Smith | Forge | Hammers at anvil (bobbing animation), tends fire |
| Monk | Sanctuary | Sits in meditation circles, slow deliberate movement |
| Guard | Vault/Gate | Stands at post, paces short route |
| Gladiator | Arena | Circles the ring, practice strikes |
| Citizen | Roads/Square | Wanders between districts |
| Stargazer | Observatory (night) | Stands on platform, points at sky |
| Visitor | Estate level 20+ | Random foreign merchants, pilgrims |

NPC count scales: `floor(building.level / 4) + 1` per building.

### NPC Scheduling (Day/Night)

- **Dawn**: Workers emerge from mansion, walk to their buildings
- **Day**: Full activity at all active buildings
- **Dusk**: NPCs return toward the mansion, lights come on
- **Night**: Guards patrol, observatory NPCs active, forge glow visible, others asleep

### Movement System

- Pre-compute a **road graph** from the Voronoi layout — nodes at intersections, edges along road segments
- Villagers pick a random destination node, walk along edges (A* on a small graph, or random walk)
- Building-specific villagers stay within their district radius, bouncing between 2-3 waypoints
- Collision avoidance: none needed — at this scale they can overlap

**How it runs:**
```js
// Each villager: { position, target, speed, type, buildingId } in a flat Float32Array
// Every frame:
for (let i = 0; i < npcCount; i++) {
  // Advance position toward target
  // Write new transform into InstancedMesh matrix array
}
instanceMatrix.needsUpdate = true;
// No per-entity Object3D. No individual meshes. Just math on arrays.
```

### Population Scale

| Estate Level | Population | Particles |
|-------------|-----------|-----------|
| 1-10 | 10-20 | None |
| 11-25 | 30-60 | Chimney smoke |
| 26-40 | 80-120 | +Forge sparks |
| 41+ | 150-300 | All active |

### Animals

- **Chickens** (3-5) near Mansion/Market — tiny white triangles that peck
- **Horses** (1-2) near Barracks — at hitching posts, occasional head bob
- **Fish jumping** near Dock — mesh arcs out of water, splashes back on random timer
- **Birds** — 20-50 boids using [Craig Reynolds' algorithm](https://www.red3d.com/cwr/boids/). Three rules: separation, alignment, cohesion. See [Three.js GPGPU Birds](https://threejs.org/examples/webgl_gpgpu_birds.html)

### Economy Visualization

**Resource carts between buildings:**
```js
const path = new THREE.CatmullRomCurve3([minePos, waypoint1, forgePos]);
const t = (elapsedTime % tripDuration) / tripDuration;
cart.position.copy(path.getPointAt(t));
cart.lookAt(cart.position.clone().add(path.getTangentAt(t)));
```

**Resource particle arcs** (gold coins, ore chunks arcing from source to destination):
```js
const pos = src.clone().lerp(dst, t);
pos.y += arcHeight * 4 * t * (1 - t); // parabola
```

**References:**
- [instanced-skinned-mesh](https://github.com/luis-herasme/instanced-skinned-mesh)
- [NVIDIA GPU Gems 3: Animated Crowd Rendering](https://developer.nvidia.com/gpugems/gpugems3/part-i-geometry/chapter-2-animated-crowd-rendering)

---

## 9. Physics — Tiny Details That Sell the World

No physics engine. Each prop uses simple analytical math — springs, pendulums, sine waves. ~5 floating-point ops per prop per frame.

### Swinging Shop Signs & Lanterns (Damped Pendulum)

```js
angularVelocity += (-9.81 / ropeLength) * Math.sin(angle) * dt;
angularVelocity *= 0.98; // damping
angle += angularVelocity * dt;
sign.rotation.z = angle;
```

Triggered by: wind gusts (random impulse), NPC walking past (proximity impulse).

### Cart Suspension (Spring-Damper)

```js
const force = -springK * displacement - dampD * velocity;
velocity += force * dt;
displacement += velocity * dt;
cart.position.y = restHeight + displacement;
```

### Windmill Blades & Water Wheels (Angular Momentum)

```js
angularVelocity += (windStrength - friction * angularVelocity) * dt;
blade.rotation.z += angularVelocity * dt;
```

### Drawbridge (Constrained Hinge)

```js
targetAngle = gateOpen ? Math.PI / 2 : 0;
angle += (targetAngle - angle) * 0.05;
drawbridge.rotation.x = angle;
```

**References:**
- [Physics in JS: Pendulum Clock](https://burakkanber.com/blog/physics-in-javascript-rigid-bodies-part-1-pendulum-clock/)
- [Physics in JS: Car Suspension](https://burakkanber.com/blog/physics-in-javascript-car-suspension-part-1-spring-mass-damper/)
- [The Physics Behind Spring Animations](https://blog.maximeheckel.com/posts/the-physics-behind-spring-animations/)

---

## 10. Flags & Cloth

### Sine-Wave Fake Flags (10-20 flags, GPU-only)

A plane geometry (16×8 subdivisions) with layered sine waves, pinned at the pole end:

```glsl
uniform float time;
uniform float windStrength;

void main() {
    vec3 pos = position;
    float distFromPole = pos.x / maxX;
    float wave = sin(pos.x * 4.0 + time * 3.0) * 0.15
               + sin(pos.x * 7.0 + time * 5.0) * 0.07
               + sin(pos.x * 11.0 + time * 2.3) * 0.03;
    pos.y += wave * distFromPole * windStrength;
    pos.z += wave * 0.3 * distFromPole * windStrength;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
```

20 flags at 16×8 = 2,560 extra vertices total, entirely GPU-computed.

### Verlet Cloth (1-3 hero flags near camera)

CPU Verlet integration on a 20×10 grid. 200 particles, 5 constraint iterations = 1000 constraint solves per frame. ~0.01ms. Use for the player's banner at the town gate.

**References:**
- [Three.js Cloth Example (Verlet)](https://va3c.github.io/three.js/examples/webgl_animation_cloth.html)
- [RobertoLovece/Cloth](https://github.com/RobertoLovece/Cloth)

---

## 11. Particle Systems

### Architecture: GPU-Driven Shader Particles

Each particle system is a single `Points` or `InstancedMesh`. All animation in the vertex shader via a `time` uniform. **Zero CPU per-particle cost.**

```glsl
uniform float time;
attribute float birthTime;
attribute float lifetime;
attribute vec3 velocity;
attribute vec3 emitPos;

void main() {
    float age = mod(time - birthTime, lifetime);
    float t = age / lifetime;

    vec3 pos = emitPos + velocity * age + vec3(0.0, buoyancy * age * age, 0.0);
    pos.x += sin(age * turbFreq + birthTime) * turbAmp;
    pos.z += cos(age * turbFreq * 0.7 + birthTime) * turbAmp;

    gl_PointSize = mix(startSize, endSize, t) * (1.0 - t * 0.5);
    vAlpha = 1.0 - smoothstep(0.6, 1.0, t);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
```

### Particle Types

| System | Trigger | Visual | Count | Technique |
|--------|---------|--------|-------|-----------|
| **Forge smoke** | Forge active | Dark grey puffs rising | 30-50 | Points, buoyancy + turbulence |
| **Forge sparks** | Forge active | Orange dots arcing with gravity | 15-25 | Points, velocity + gravity |
| **Chimney smoke** | Any building Lv5+ | Light grey wisps from roof | 5-10/chimney | Points, gentle buoyancy |
| **Sanctuary motes** | Sanctuary active | White/gold dots floating up | 40-60 | Points, slow drift + sine orbit |
| **Fireflies** | Near sanctuary, night | Yellow-green blinks | 30-50 | Points, Brownian motion + random alpha |
| **Water sparkle** | River/harbor | White glints on surface | 20-30 | Points, random position + blink |
| **Torch fire** | Night, any torch/lamp | Yellow-orange flicker | 1/torch | Billboard sprite, animated alpha |
| **Dust motes** | Arena, Barracks, sunbeams | Brown/tan dots | 10-15 | Points, slow drift |
| **Falling leaves** | Near trees | Small flat quads with tumble | 5-10 | InstancedMesh quads, rotate + drift |
| **Mining dust** | Workshop active | Grey puffs near mine entrance | 10-15 | Points, horizontal burst + fade |
| **Construction sparks** | status=Building | Small orange dots from scaffold | 5-10 | Points, random upward burst |
| **Rain** | Weather=rain | Streaked points falling fast | 5000-10000 | Points, GPU-animated fall + recycle |
| **Snow** | Weather=snow | Slow white dots with drift | 2000-5000 | Points, slow fall + sine drift |

### GPGPU Particles (Advanced Effects)

For effects needing particle-to-particle interaction (billowing smoke), use **FBO ping-pong** with `GPUComputationRenderer`. Stores positions + velocities in floating-point textures. Can handle 100K+ particles at 60fps. Reserve for Sanctuary meditation aura.

**References:**
- [Crafting Dreamy Particle Effects with GPGPU (Codrops)](https://tympanus.net/codrops/2024/12/19/crafting-a-dreamy-particle-effect-with-three-js-and-gpgpu/)
- [Three.quarks VFX Engine](https://github.com/Alchemist0823/three.quarks)
- [Three Nebula particle system](https://three-nebula.org/)
- [FBO Particles explanation](https://barradeau.com/blog/?p=621)

---

## 12. Vegetation

### Blade-by-Blade Instanced Grass

Each grass blade is a triangle strip (3-5 segments) rendered via InstancedMesh. Per-instance attributes: position, rotation, height, color tint, wind phase offset. Single draw call.

```glsl
float sway = sin(time * 2.0 + instancePosition.x * 3.0 + instancePhase) * 0.1;
sway *= position.y / bladeHeight; // more sway at top
vec3 displaced = position + vec3(sway, 0.0, sway * 0.5);
```

Scatter 5,000-20,000 blades in meadow areas using Poisson disk sampling.

**LOD:** Full blades within 2 units, billboard clumps beyond, cull entirely beyond 5 units.

### Tree Wind Animation

Multi-layer wind on shared foliage material:

```glsl
float primarySway = sin(time * 1.5 + instancePosition.x * 0.5) * 0.02;
float branchTremor = sin(time * 4.0 + position.y * 8.0) * 0.005;
float leafFlutter = sin(time * 12.0 + position.x * 20.0 + position.z * 15.0) * 0.002;
displaced.x += (primarySway + branchTremor + leafFlutter) * position.y;
```

### Flower Patches & Crop Fields

- **Flowers** near Mansion/Sanctuary: grass blade technique with wider colored tip
- **Crop fields** near Market: rows of wheat blades with coordinated wave

**References:**
- [How to Make the Fluffiest Grass (Codrops)](https://tympanus.net/codrops/2025/02/04/how-to-make-the-fluffiest-grass-with-three-js/)
- [BotW Style Grass in Three.js](https://smythdesign.com/blog/stylized-grass-webgl/)
- [al-ro Grass Instancing Demo](https://al-ro.github.io/projects/grass/)
- [EZ-Tree Procedural Tree Generator](https://github.com/dgreenheck/ez-tree)

---

## 13. Water — Rivers, Harbors, Interactions

### Gerstner Waves + Stylized Toon Shading

Inspired by [jbouny/fft-ocean](https://github.com/jbouny/fft-ocean) but using analytical Gerstner form — cheaper, sufficient for rivers.

**Vertex shader — 4-8 Gerstner waves:**
```glsl
vec3 gerstnerWave(vec3 pos, float time, vec2 dir, float amp, float freq, float steep) {
    float phase = dot(dir, pos.xz) * freq + time;
    float s = sin(phase), c = cos(phase);
    return vec3(steep * amp * dir.x * c, amp * s, steep * amp * dir.y * c);
}
```

**Fragment shader — five layered effects:**

1. **Depth-based color banding** (toon water): 3 discrete bands — shallow turquoise, mid blue, deep navy. See [Creating Toon Water for the Web](https://gamedevjs.com/tutorials/creating-toon-water-for-the-web/).

2. **Depth-buffer intersection foam**: Compare water depth vs scene depth. Where difference is small (object intersects water), draw white foam around rocks, pilings, shorelines. See [thaslle/stylized-water](https://github.com/thaslle/stylized-water).

3. **Flow map animation**: UV distorted by flow map encoding current direction. Two layers crossfaded to prevent stretching.

4. **Subsurface scattering fake**:
```glsl
float sss = pow(max(0.0, dot(viewDir, lightDir)), 4.0) * waveHeight;
color = mix(deepColor, vec3(0.1, 0.8, 0.6), sss * 0.3);
```

5. **Fresnel + sparkle**:
```glsl
float fresnel = pow(1.0 - dot(normal, viewDir), 3.0);
color = mix(waterColor, skyColor, fresnel * 0.4);
float sparkle = step(0.998, noise(pos.xz * 50.0 + time * 3.0)) * sunIntensity;
color += sparkle;
```

### Water Physics

**Boat bobbing:** Sample Gerstner wave height at 3 points (bow, port, starboard), compute tilt from triangle normal:
```js
const h1 = gerstnerHeight(boat.x, boat.z, time);
const h2 = gerstnerHeight(boat.x + 0.1, boat.z, time);
const h3 = gerstnerHeight(boat.x, boat.z + 0.1, time);
boat.position.y = h1;
```

**Interactive ripples (GPGPU wave equation):** From the [Three.js GPGPU Water example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_gpgpu_water.html): 2D wave equation on a heightmap texture. Fish jump or click → spike heightmap → fragment shader propagates.

### Water Geometry Budget

| Component | Triangles | Draw Calls |
|-----------|-----------|------------|
| River (ribbon mesh) | ~500 | 1 |
| Harbor (wider plane) | ~200 | 0 (merged) |
| Fountain spray | 30-50 points | 1 |
| Bridges | ~300 | 1-2 |
| Ripple heightmap | 256×256 RTT | 1 pass |

**References:**
- [Gerstner Water Shader tutorial (sbcode)](https://sbcode.net/threejs/gerstnerwater/)
- [Stylized Water Effects (Codrops)](https://tympanus.net/codrops/2025/03/04/creating-stylized-water-effects-with-react-three-fiber/)
- [romulolink/threejs-water-shader-with-foam](https://github.com/romulolink/threejs-water-shader-with-foam)
- [Three.js GPGPU Water example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_gpgpu_water.html)
- [Generating a Stylized Ocean (Faraz Shaikh)](https://blog.farazshaikh.com/stories/generating-a-stylized-ocean/)

---

## 14. Day/Night Cycle & Lighting

### Sun Arc System

```js
const sunAngle = ((hour - 6) / 12) * Math.PI; // 0 at 6am, PI at 6pm
sun.position.set(Math.cos(sunAngle) * 4, Math.sin(sunAngle) * 4, 2);
```

**Color temperature transitions:**

| Time | Sun Color | Sun Intensity | Ambient Color | Key Visual |
|------|-----------|---------------|---------------|------------|
| 5-8 (Dawn) | #FF6B35 warm orange | 0.3→1.0 | #FFB366 | Mist rising, rooster crow |
| 8-11 (Morning) | #FFE4B5 | 1.0→1.8 | #87CEEB | NPCs walk to buildings, birds chirp |
| 11-14 (Midday) | #FFFDE7 white | 2.0 | #88BBEE | Heat shimmer (arid), peak activity |
| 14-17 (Afternoon) | #FFE4B5 | 1.8→1.0 | #87CEEB | Shadows lengthen, dust motes |
| 17-20 (Dusk) | #FF4500 deep amber | 1.0→0.2 | #CC6633 | Lanterns ignite, fireflies emerge |
| 20-23 (Night) | #2C3E73 pale blue | 0.1 | #1a1a3e | Window glow, owl sounds, torch flames |
| 23-5 (Deep Night) | — | 0.05 | #0a0a2a | Forge glow, ghost particles |

### Daily Activity Windows

The three daily windows (Dawn/Midday/Dusk) from `windows_completed` bitflag (0b00000DML) manifest as **atmospheric events**:

- **Dawn window active**: Golden bell rings, well glows, Barracks NPCs salute
- **Midday window active**: Market stalls bustle, Academy books float faster, Arena crowd cheers
- **Dusk window active**: Sanctuary candles ignite, Observatory dome opens, Treasury coins glow
- **Window completed**: Checkmark rune on corresponding buildings; effect fades to afterglow
- **All three completed**: Town square fountain turns golden for the rest of the day

### Torch & Lamp System

**Performance rule:** Only the sun gets shadow maps. All torches use `castShadow = false`.

**Flicker:**
```js
const flicker = 1.0
  + 0.1 * Math.sin(time * 15)
  + 0.05 * Math.sin(time * 33.7)
  + 0.08 * (Math.random() - 0.5);
torchLight.intensity = baseIntensity * flicker;
```

**Light culling:** Only the 4-6 torches nearest camera are real PointLights. All others are faked with emissive material sphere + bloom glow billboard.

### Window Glow

At night, building windows emit warm light. Emissive material on window geometry + small additive-blended billboard quad outside each window for bloom halo. No PointLight needed.

### God Rays

Screen-space raymarched god rays from sanctuary spire at dawn using [three-good-godrays](https://github.com/Ameobea/three-good-godrays). 60 samples, ~1-2ms GPU.

**References:**
- [THREEx.DayNight](https://github.com/jeromeetienne/threex.daynight)
- [three-good-godrays](https://github.com/Ameobea/three-good-godrays)
- [NVIDIA GPU Gems 3: Volumetric Light Scattering](https://developer.nvidia.com/gpugems/gpugems3/part-ii-light-and-shadows/chapter-13-volumetric-light-scattering-post-process)

---

## 15. Weather System

Weather is procedural but deterministic from `terrain.seed + dayOfYear` — all players in the same city see the same weather:

```typescript
function weatherForDay(seed: number, dayOfYear: number): Weather {
  const h = terrainHash(seed, dayOfYear, 0);
  if (h < 40) return 'rain';
  if (h < 55) return 'fog';
  if (h < 65) return 'storm';
  if (h < 80) return 'overcast';
  if (h < 90) return 'windy';
  return 'clear';
}
```

Moisture affects weather probability: high-moisture towns get more rain/fog; arid towns get more clear/windy with occasional dust storms.

### Weather Effects

| Weather | Particles | Shader | Audio |
|---------|-----------|--------|-------|
| Clear | Butterflies, dust motes | Warm color grade | Birds, wind |
| Overcast | — | Desaturated, flat lighting | Muted ambience |
| Rain | 5K-10K raindrop points + splash rings | Wet surface reflections (darken 20%, increase metalness) | Rain loop, distant thunder |
| Storm | Heavy rain + lightning flashes | Dramatic shadows, flicker | Thunder cracks, howling wind |
| Fog | Height-based exponential | Reduced draw distance | Muffled sounds |
| Windy | Leaf particles, banner flap | Grass sway (vertex shader) | Gusting wind |

A global `windDirection`, `windStrength`, and `weatherState` set of uniforms drives all systems simultaneously: flag wave, smoke drift, tree sway, grass bend, rain angle, wave direction.

### Rain Shader

```glsl
float wetness = u_rainIntensity;
color *= mix(1.0, 0.8, wetness); // darken
roughness *= mix(1.0, 0.3, wetness); // more reflective
```

### Snow Accumulation

```glsl
float snow = smoothstep(0.6, 0.9, worldNormal.y) * u_snowAmount;
color = mix(baseColor, vec3(0.95), snow);
```

### Height-Based Fog

```glsl
float fogDensity = exp(-worldPos.y * heightFalloff) * baseDensity;
color = mix(color, fogColor, fogDensity);
```

**References:**
- [3D Weather Visualization (Codrops)](https://tympanus.net/codrops/2025/09/18/creating-an-immersive-3d-weather-visualization-with-react-three-fiber/)
- [Wet Surface Shader with Puddles](https://gist.github.com/eviltak/e04b83ffdb91aa3d477bbfe0ca370da7)

---

## 16. Post-Processing — The Diorama Look

This transforms a 3D scene into something you want to stare at.

### SSAO

**[N8AO](https://github.com/N8python/n8ao)** — supports orthographic cameras (critical for isometric view), temporal stability. Grounds buildings to terrain, adds depth under overhangs.
- `aoRadius: 0.5, distanceFalloff: 1.0, intensity: 1.5`
- ~1-2ms at half resolution

### Bloom (Selective Glow)

[pmndrs/postprocessing](https://github.com/pmndrs/postprocessing) Bloom:
- Forge embers glow orange, sanctuary crystals glow white/gold, torches bloom warm halos, treasury gold glints
- Luminance threshold 0.8+ so only intentionally bright materials bloom
- ~0.5-1ms

### Tilt-Shift (The Signature Look)

Blur top and bottom edges, keep horizontal band in focus. Creates "looking through a tilt-shift lens at a model" effect.
- [pmndrs TiltShift effect](https://post-processing.tresjs.org/guide/pmndrs/tilt-shift)
- ~0.5ms

### Color Grading + Vignette

- +15% saturation — colors pop like painted miniatures
- Slight warm tint during day, cool tint at night
- Vignette: subtle darkening at screen edges
- Single LUT pass, ~0.2ms

### Post-Processing Budget

| Effect | Cost | Impact |
|--------|------|--------|
| N8AO SSAO | ~1.5ms | Grounding, depth |
| Bloom | ~0.8ms | Magical glow |
| Tilt-Shift | ~0.5ms | Diorama feel |
| Color grade + vignette | ~0.2ms | Polish |
| **Total** | **~3ms** | **Transforms the scene** |

---

## 17. Kingdom Theme Variants

`GameEngine.kingdom_theme` reskins the entire town. Each theme has its own material palette, architecture style, particles, audio, and NPC appearances.

| Element | Medieval | Cyberpunk | Sci-Fi | Modern | Post-Apocalyptic |
|---------|----------|-----------|--------|--------|-----------------|
| Mansion | Stone manor | Neon penthouse | Geodesic dome | Glass tower | Bunker compound |
| Barracks | Training yard | Merc agency | Barracks pod | Military base | Militia camp |
| Workshop | Waterwheel smithy | Chop shop | Refinery | Factory | Scrapyard |
| Forge | Volcanic forge | 3D printer bay | Nano-fabricator | CNC workshop | Irradiated smelter |
| Sanctuary | Crystal temple | Neural link pod | Meditation sphere | Yoga center | Overgrown shrine |
| Citadel | Castle tower | Corporate tower | Command spire | HQ building | Watchtower |
| Roads | Cobblestone | Holographic grid | Light bridges | Asphalt | Cracked asphalt |
| Lights | Torches, lanterns | Neon signs, holograms | Force-field glow | Street lights | Barrel fires |
| Trees | Oaks, pines | Chrome poles, LED vines | Hydroponics | Planted trees | Dead trunks, mutant flora |
| NPCs | Peasants, knights | Augmented citizens | Jumpsuit crew | Civilians | Wasteland survivors |
| Particles | Fire, smoke | Neon sparks, data streams | Plasma, force fields | Electric, clean | Rust, toxic, green sparks |

### Theme-Specific Details

**Cyberpunk**: Buildings have neon-lit holographic signs (emissive + additive blending). Roads have embedded light strips. Walls are energy barriers (transparent + hex pattern + shimmer). Water has bioluminescent glow. Audio: synth ambience.

**Sci-Fi**: Clean geometric domes and spires. Floating platforms + light bridges. Force-field walls. Hydroponics pods instead of gardens. NPCs glide (slower animation, no bob).

**Modern**: Concrete and glass. Asphalt roads with lane markings. Market becomes shopping center. Arena becomes stadium. Vehicles instead of carts.

**Post-Apocalyptic**: Rusted metal and salvaged materials. Cracked roads with weeds (grass blades poking through). Makeshift walls of scrap. Toxic puddles (yellow-green, no flow). Barbed wire. Fewer NPCs.

---

## 18. Progression Milestones

### Estate Level Visual Evolution

| Level | Town Stage | Key Visual Changes | Population |
|-------|-----------|-------------------|------------|
| **1-5** | Camp | Campfire, one tent, rough dirt paths, wooden stakes | 5-10 |
| **6-15** | Hamlet | Wood buildings, packed earth paths, wooden fence, first chimney smoke | 15-30 |
| **16-25** | Village | Stone foundations, cobblestone road centers, well in square, stone wall, grass patches | 40-60 |
| **26-35** | Town | Full stone 2-story, fountain, gatehouse, banners, street lamps, defined districts | 80-120 |
| **36-45** | Prosperous Town | Grand facades, paved roads, guard patrols, ornate fountain, mature trees, flowers | 150-200 |
| **46-55** | City | Impressive architecture, monument in square, grand gate, spire visible from afar | 200-250 |
| **56+** | Grand Estate | Spires, colonnades, golden accents, prestige landmark, animated water, birds | 250-300 |

### Achievement Milestones

| Milestone | Visual Reward |
|-----------|--------------|
| First building completed | Town square gets a notice board |
| All Tier 1 buildings | Stone walls appear around first district |
| First Tier 2 building | A bridge connects districts, road upgrades |
| All Tier 2 buildings | Town gets a gate with the player's name |
| First Tier 3 building | Ambient music shifts to epic orchestral |
| All 13 buildings | "Master Builder" golden aura on entire town |
| Any building hits level 10 | That building gets a flag pole with level banner |
| Any building hits level 20 | Golden roof trim, legendary particle halo |
| 180-day login streak | Eternal flame in town square (`permanent_bonus_bps > 0`) |
| All mastery level 50+ | Ground texture shifts — flowers bloom everywhere |
| All mastery level 100 | Reality warps — the town floats on a sky island |

---

## 19. Footprints & Ground Detail

### Render-to-Texture Footprint Map

Off-screen `WebGLRenderTarget` stores a "footprint map" covering the terrain. When NPCs walk, stamp footprint textures via orthographic camera. Terrain shader reads this to darken diffuse, slight indent, modify roughness.

Footprints fade: each frame, multiply all pixels by 0.995. Cart wheel tracks: continuous line instead of discrete prints.

**References:**
- [Dynamic Terrain Deformation (Codrops)](https://tympanus.net/codrops/2024/11/27/creating-dynamic-terrain-deformation-with-react-three-fiber/)

---

## 20. Camera System

```typescript
const CAMERA_CONFIG = {
  fov: 50,
  pitch: 45,         // Degrees from horizontal
  yaw: 30,           // Rotation around Y axis
  distance: 3.5,
  minDistance: 1.5,
  maxDistance: 8.0,
  targetY: 0.1,
};
```

### Interactions

- **Scroll wheel**: Zoom in/out (minDistance to maxDistance)
- **Right-drag**: Orbit camera (locked to ±20° from default yaw, ±15° pitch)
- **Click building**: Zoom to building, show detail panel (stats, level, mastery, active craft/research)
- **Click empty slot**: Show build menu
- **Click town square**: Zoom out to overview
- **Hover building**: Tooltip with name + level + status
- **Double-click building**: Open building's daily activity mini-game (if window is active)

### LOD Strategy

- **Close zoom** (distance < 2): Full detail, all NPCs, all particles, grass blades
- **Medium zoom** (2-5): Simplified detail, billboard NPC sprites, reduced particles, grass clumps
- **Far zoom** (> 5): Billboard sprites for buildings, no NPCs, minimal particles, no grass

---

## 21. Spatial Audio

Three-layer ambient soundscape using [Howler.js](https://github.com/goldfire/howler.js):

**Layer 1 — Base ambience:** Persistent loop. Day: birdsong + gentle wind. Night: crickets + owls + distant wolf.

**Layer 2 — Zone ambience:** Crossfade as camera pans over districts:
- Market: crowd murmur, vendor calls
- Forge: hammer strikes, bellows
- Sanctuary: choir hum, wind chimes
- Harbor: waves, seagulls
- Barracks: marching, metal clanking

**Layer 3 — Point sources:** 3D-positioned via Web Audio API PannerNode:
- Fountain splash (town square)
- Blacksmith anvil strikes (forge)
- Tavern music (Mansion windows)

~20-30 simultaneous sources. Priority system plays only 3 nearest.

**References:**
- [Howler.js](https://github.com/goldfire/howler.js)
- [MDN: Web Audio Spatialization](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Web_audio_spatialization_basics)

---

## 22. Performance Budget

Target: **stable 60fps on mid-range GPU** (Apple M1 integrated, Intel Iris).

| System | Draw Calls | Triangles | CPU/frame | GPU/frame |
|--------|-----------|-----------|-----------|-----------|
| Terrain mesh + BVH | 1 | ~20K | BVH: one-time build | Static |
| Buildings (InstancedMesh per type) | ~13 | ~5K | Static | Static |
| Building props (InstancedMesh) | ~10 | ~3K | Static | Static |
| Trees (trunk + crown InstancedMesh) | 2 | ~2K | Static | Wind shader: trivial |
| Grass (InstancedMesh) | 1-2 | ~5K | Static | Wind shader: trivial |
| NPC villagers (InstancedMesh) | 2-3 | ~1.5K | Matrix update: ~0.1ms | Trivial |
| Animals + birds (InstancedMesh) | 2-3 | ~300 | Boids + bob: ~0.05ms | Trivial |
| Resource carts (InstancedMesh) | 1 | ~200 | Spline eval: ~0.02ms | Trivial |
| Particle systems (Points) | 8-12 | N/A | Zero (GPU-driven) | Shader: ~0.5ms |
| Flags/banners (InstancedMesh) | 1 | ~300 | Static | Sine shader: trivial |
| Water (river + harbor + ripple RTT) | 2-3 | ~1K | Wave sample: ~0.01ms | Gerstner + foam: ~0.5ms |
| Prop physics (signs, carts, wheels) | 0 | 0 | Spring/pendulum: ~0.02ms | N/A |
| Torch PointLights (night, 4-6) | +4-6 | N/A | Flicker: ~0.01ms | Lighting: ~0.3ms |
| **Subtotal: Scene** | **~45-55** | **~38K** | **~0.3ms** | **~1.5ms** |
| Post: N8AO SSAO | +1 pass | fullscreen | N/A | ~1.5ms |
| Post: Bloom | +3 passes | fullscreen | N/A | ~0.8ms |
| Post: Tilt-Shift | +1 pass | fullscreen | N/A | ~0.5ms |
| Post: Color + Vignette | +1 pass | fullscreen | N/A | ~0.2ms |
| **Subtotal: Post** | **+6 passes** | **fullscreen** | **N/A** | **~3.0ms** |
| **TOTAL** | **~55-60** | **~38K + fullscreen** | **~0.3ms** | **~4.5ms** |
| **Budget remaining (16ms)** | | | | **~11ms headroom** |

---

## 23. Implementation Phases

### Phase 1: Post-Processing + Polish (1-2 days) — HIGHEST IMPACT PER EFFORT
Add N8AO + Bloom + TiltShift + Vignette to existing scene. This alone transforms the flat 3D view into a diorama.

### Phase 2: Life System (3-5 days)
- InstancedMesh NPC crowd (villagers walking roads)
- GPU particle systems (smoke, sparks, motes)
- Shader-based tree sway + flag sine-wave animation
- Bird boids (20-50 birds circling)
- Prop physics (swinging signs, spinning water wheel)

### Phase 3: Water (2-3 days)
- Gerstner wave river with flow direction
- Depth-buffer foam + fresnel + SSS
- Boat bobbing physics
- GPGPU interactive ripples
- Fountain spray particles
- Bridge geometry

### Phase 4: Vegetation (2-3 days)
- Instanced grass blades with wind shader
- Flower patches near Mansion/Sanctuary
- Crop field wave near Market
- Multi-layer tree wind animation

### Phase 5: District System (3-5 days)
- Replace fixed plots with Voronoi districts
- District ground material changes per building type
- Organic road curves along cell edges
- District blending at boundaries

### Phase 6: Day/Night + Weather (2-3 days)
- Sun arc + color temperature transitions
- Torch/lamp system with flicker + culling
- Window glow at night
- Rain/snow particles + wet/snow surface shaders
- God rays on sanctuary at dawn
- Deterministic weather from terrain.seed

### Phase 7: Progression + Construction (3-5 days)
- 7 estate level milestone visual stages
- 4-tier building mesh progression
- Y-clip construction reveal shader
- Scaffolding + construction worker NPCs
- Town square evolution (campfire → well → fountain → monument)
- Achievement milestone visuals

### Phase 8: Economy Visualization (2-3 days)
- Resource carts on CatmullRomCurve3 splines
- Gold coin / resource particle arcs
- Activity indicators on buildings
- Footprint/trail RTT system
- Daily activity window atmospheric events

### Phase 9: Theme Variants (3-5 days)
- Material palette per kingdom theme
- Theme-specific building mesh variations
- Theme-specific props, particles, NPC appearances
- Theme-specific audio profiles

### Phase 10: Audio (2-3 days)
- Howler.js integration
- 3-layer spatial soundscape
- Zone-based ambience crossfade
- Positioned point sources (fountain, anvil, etc.)

---

## 24. File Structure

```
sdks/novus-mundus-ts/src/
├── town/
│   ├── TownRenderer.ts           # Main Three.js scene orchestrator
│   ├── TownStateManager.ts       # On-chain state → visual state mapper
│   ├── terrain/
│   │   ├── TownTerrainBuilder.ts  # Heightmap mesh from CityTerrain
│   │   ├── WaterSystem.ts         # Gerstner waves, foam, ripples, flow
│   │   └── BiomeShader.ts         # Triplanar moisture-driven texturing
│   ├── buildings/
│   │   ├── BuildingFactory.ts     # Modular kit assembly + level-tier selector
│   │   ├── BuildingAnimator.ts    # Construction, upgrade, craft anims
│   │   └── BuildingEffects.ts     # Per-building particle systems
│   ├── layout/
│   │   ├── DistrictSystem.ts      # Voronoi district generation + placement
│   │   ├── RoadNetwork.ts         # Path generation along cell edges
│   │   └── TownSquare.ts          # Central plaza + milestone upgrades
│   ├── atmosphere/
│   │   ├── DayNightCycle.ts       # Sun position, ambient color, shadows
│   │   ├── WeatherSystem.ts       # Rain, fog, wind, snow
│   │   ├── DailyWindows.ts        # Dawn/Midday/Dusk atmospheric events
│   │   └── PostProcessing.ts      # N8AO, Bloom, TiltShift, Vignette
│   ├── population/
│   │   ├── NPCManager.ts          # Spawn, path, schedule NPCs
│   │   ├── NPCRenderer.ts         # InstancedMesh billboard + LOD
│   │   ├── AnimalSystem.ts        # Chickens, horses, birds (boids)
│   │   └── EconomyCarts.ts        # Resource carts on splines
│   ├── physics/
│   │   ├── PropPhysics.ts         # Pendulums, springs, windmills
│   │   ├── ClothSimulation.ts     # Verlet cloth for hero flags
│   │   └── WaterInteraction.ts    # Boat bobbing, GPGPU ripples
│   ├── vegetation/
│   │   ├── GrassSystem.ts         # Instanced blade grass
│   │   ├── TreeWind.ts            # Multi-layer wind animation
│   │   └── FlowerFields.ts        # Flowers + crop wave
│   ├── particles/
│   │   ├── ParticleManager.ts     # System lifecycle + budget
│   │   ├── GPUParticles.ts        # Shader-driven Points systems
│   │   └── GPGPUParticles.ts      # FBO ping-pong for advanced effects
│   ├── camera/
│   │   ├── IsometricCamera.ts     # Default view + zoom/orbit controls
│   │   └── CameraTransitions.ts   # Smooth zoom-to-building
│   ├── audio/
│   │   ├── AudioManager.ts        # Howler.js integration + layer mixing
│   │   └── SpatialSources.ts      # Positioned point sources
│   └── assets/
│       ├── AssetManifest.ts        # Model/texture catalog per theme
│       └── AssetLoader.ts          # Progressive loading
```

---

## 25. Key Libraries

| Library | Purpose | Link |
|---------|---------|------|
| three-mesh-bvh | Terrain raycasting, NPC ground queries | [GitHub](https://github.com/gkjohnson/three-mesh-bvh) |
| N8AO | SSAO with orthographic camera support | [GitHub](https://github.com/N8python/n8ao) |
| pmndrs/postprocessing | Bloom, TiltShift, Vignette, color correction | [GitHub](https://github.com/pmndrs/postprocessing) |
| three-good-godrays | Screen-space god rays | [GitHub](https://github.com/Ameobea/three-good-godrays) |
| Delaunator | Voronoi diagram for district layout | [GitHub](https://github.com/mapbox/delaunator) |
| Howler.js | Spatial audio, ambient sound | [GitHub](https://github.com/goldfire/howler.js) |
| Three.quarks | VFX particle system engine | [GitHub](https://github.com/Alchemist0823/three.quarks) |
| EZ-Tree | Procedural tree generation | [GitHub](https://github.com/dgreenheck/ez-tree) |

---

## 26. Open Questions

1. **Estate coordinates**: `EstateAccount` stores `city_id` but not a specific (ox, oy) offset. Should we add `estate_x: i16, estate_y: i16` so the terrain patch is deterministic? Or derive from PDA hash?

2. **Visiting other towns**: Should players view other estates? The renderer is stateless — just pass a different `EstateAccount`. Could enable "visit neighbor" social feature.

3. **Mini-game rendering**: Daily activities have a `score: u8` parameter. Should the town view host mini-games inline (e.g., click Barracks → drill sergeant mini-game in 3D), or open a separate 2D overlay?

4. **Audio budget**: Full ambient layer (wind + birds + building sounds + NPCs + weather) might be heavy on mobile. Priority system that plays only 3 nearest sound sources?

5. **Castle integration**: When a player is a King with a Castle, should the Citadel visually connect to the Castle system? E.g., a portal or road leading "out" to the King's Castle view?

6. **GLTF vs Procedural**: The modular kit system generates buildings procedurally. Should we eventually create hand-crafted GLTF models (65 models via Blender pipeline, ~15MB) as an upgrade path for higher-end devices?

---

## What This Achieves

1. **It's ALIVE** — hundreds of tiny villagers, birds circling, smoke curling, water flowing, flags flapping, leaves falling
2. **It has PHYSICS** — signs swing when NPCs pass, carts bounce on cobblestone, boats bob on waves, windmills spin
3. **Every town is UNIQUE** — building choices shape districts, terrain places them, progression changes everything
4. **Progression is VISIBLE** — a campfire camp at level 1 becomes a grand city at level 56+
5. **The economy is VISIBLE** — carts move ore from mine to forge, gold arcs into treasury, fishermen haul nets
6. **The game world is COHERENT** — Dock at water, Mine at cliff, Sanctuary on hill, Arena in depression
7. **It's a DIORAMA** — tilt-shift blur, SSAO depth, bloom on magical elements, saturated miniature colors
8. **Kingdom themes TRANSFORM it** — Medieval stone, Cyberpunk neon, Post-Apocalyptic rust — same layout, different world
9. **It's PERFORMANT** — InstancedMesh + GPU shaders + BVH + analytical physics = 60fps in ~55 draw calls with 11ms headroom
10. **State drives everything** — every visual maps to on-chain state via `TownVisualState`, live-updated via WebSocket
