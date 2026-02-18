# Estate Visual Design — Component Layer System

The estate (town center) uses a **modular component system** where 8 independent layers compose together at runtime. Each layer has its own progression stages across 60 estate levels. Instead of swapping one monolithic model per level, individual components upgrade at staggered intervals — ensuring every level-up produces a visible change.

## Architecture

### Runtime Assembly

Each component is a separate `.glb` file. Some components are **sectional** — the AI generates a small piece and the renderer assembles multiples into the full shape. This produces much better 3D models because the AI can focus on detail instead of struggling with large/circular shapes.

```
estate/
  terrain_tile_01.glb      ... terrain_tile_08.glb       (flat tile, renderer tiles into disc)
  perimeter_wall_01.glb    ... perimeter_wall_10.glb     (straight wall section, renderer places 5 in ring)
  perimeter_gate_01.glb    ... perimeter_gate_10.glb     (gate section, 1 per ring)
  courtyard_tile_01.glb    ... courtyard_tile_08.glb     (floor tile, renderer tiles inside walls)
  keep_01.glb              ... keep_15.glb               (single building, placed at center)
  monument_01.glb          ... monument_08.glb           (single object, placed in courtyard)
  wing_left_01.glb         ... wing_left_10.glb          (left wing building)
  wing_right_01.glb        ... wing_right_10.glb         (right wing building)
  garden_bush_01.glb       ... garden_bush_08.glb        (bush cluster, renderer scatters multiple)
  garden_tree_01.glb       ... garden_tree_08.glb        (single tree, renderer scatters multiple)
  garden_feature_01.glb    ... garden_feature_08.glb     (pond/trellis/topiaries, 1-2 placed)
  crown_01.glb             ... crown_06.glb              (single object, placed atop keep)
```

### Sectional vs Whole Pieces

```
SECTIONAL (renderer assembles from pieces):
  Terrain    — flat tile section, tiled into a circular disc
  Perimeter  — wall section + gate section, placed in a ring (5 walls + 1 gate)
  Courtyard  — floor tile section, tiled to fill inside walls
  Gardens    — individual pieces (bush, tree, feature), scattered in gaps
  Wings      — left wing + right wing as separate GLBs

WHOLE (single object, placed once):
  Keep       — one building at center
  Monument   — one object in courtyard
  Crown      — one object atop keep
```

Layer stacking order:

```
Layer 7  Crown      — single object floating above keep
Layer 6  Gardens    — scattered bush/tree/feature pieces in gaps
Layer 5  Wings      — left wing + right wing flanking keep
Layer 4  Monument   — single courtyard centerpiece
Layer 3  Keep       — single main building at center
Layer 2  Courtyard  — tiled floor sections inside walls
Layer 1  Perimeter  — wall sections in ring + gate section
Layer 0  Terrain    — tiled ground sections forming disc
```

### Estate Map — Top Down

```
                              N
                              |
                  . . . . . . . . . . . . .            <-- Terrain disc edge
              .                                 .
          .        ~ ~ ~ ~ ~ ~ ~ ~ ~ ~            .
        .       ~    [T]         [T]    ~            .   ~ = Moat
      .       ~   ========================  ~          .  = = Perimeter wall
     .      ~   ||                        ||  ~         .  [T] = Tower
    .      ~   ||    {g}    {g}    {g}    ||   ~         .  {g} = Garden
   .      ~   ||                          ||    ~        .
   .     ~   ||  [MILITARY]  [TREASURY]   ||    ~        .  Wings flank the keep
  .      ~   ||   WING   |    WING        ||     ~       .
  .     ~   ||     ------+------          ||     ~       .  ---- = Walkways
  .     ~   ||           |               ||      ~       .
  .     ~   ||    +======+=======+        ||     ~       .
  .     ~   ||    ||             ||       ||     ~       .
  .     ~   ||    ||    KEEP     ||       ||     ~       .  Keep = center building
  .     ~   ||    ||   (main)    ||       ||     ~       .
  .     ~   ||    ||             ||       ||     ~       .
  .     ~   ||    +======+=======+        ||     ~       .
  .      ~   ||          |               ||     ~       .
  .      ~   ||          |              ||      ~       .
   .     ~   ||     ( MONUMENT )        ||     ~        .  Monument = courtyard center
   .      ~   ||    (           )       ||    ~         .
    .      ~   ||                      ||    ~         .
     .      ~   ||       GATE         ||   ~          .   Gate faces south (camera)
      .       ~   =======[  ]========  ~             .
        .       ~                     ~            .
          .        ~ ~ ~ ~ ~ ~ ~ ~ ~            .
              .                              .
                  . . . . . . . . . . . . .
                              |
                              S (camera faces here)
```

### Estate Map — Side Elevation

```
                         CROWN
                       /beacon\
                      /  flag   \
                     /           \
                    '             '
                   |   .-----.    |
              .----|  /  KEEP \   |----.
             /     | |  main   |  |     \
    [TOWER] /      | | building|  |      \ [TOWER]
    |=====|/  WING | |         |  | WING  \|=====|
    |     |  left  | |         |  | right  |     |
    |     |--------| '---------'  |--------|     |
    |=====|        |   MONUMENT   |        |=====|
    |     |  {garden}  |     |  {garden}   |     |
    +=====+============+=====+============+=====+=
    | WALL|  COURTYARD FLOOR  | COURTYARD  |WALL |
    +-----+-------------------------------------------+
    |              TERRAIN DISC                       |
    +-------------------------------------------------+
```

### Rendering

```js
async function buildEstate(estateLevel, estateGroup) {
  const stage = (component) => getComponentStage(estateLevel, component);

  // --- Whole pieces (single placement) ---
  const keep     = await loadGLB(`estate/keep_${stage('keep')}.glb`);
  const monument = await loadGLB(`estate/monument_${stage('monument')}.glb`);
  const crown    = await loadGLB(`estate/crown_${stage('crown')}.glb`);
  const wingL    = await loadGLB(`estate/wing_left_${stage('wings')}.glb`);
  const wingR    = await loadGLB(`estate/wing_right_${stage('wings')}.glb`);

  keep.position.set(0, 0, 0);
  monument.position.set(0, 0, 3);
  crown.position.set(0, 5, 0);
  wingL.position.set(-4, 0, 0);
  wingR.position.set(4, 0, 0);

  estateGroup.add(keep, monument, crown, wingL, wingR);

  // --- Perimeter (5 wall sections + 1 gate, placed in a ring) ---
  const wallGLB = await loadGLB(`estate/perimeter_wall_${stage('perimeter')}.glb`);
  const gateGLB = await loadGLB(`estate/perimeter_gate_${stage('perimeter')}.glb`);

  const WALL_ANGLES = [0, 60, 120, 240, 300];  // degrees (skip 180 for gate)
  const RING_RADIUS = 8;

  for (const angle of WALL_ANGLES) {
    const wall = wallGLB.clone();
    const rad = (angle * Math.PI) / 180;
    wall.position.set(Math.sin(rad) * RING_RADIUS, 0, Math.cos(rad) * RING_RADIUS);
    wall.rotation.y = rad;
    estateGroup.add(wall);
  }
  gateGLB.position.set(0, 0, RING_RADIUS);  // south-facing gate
  estateGroup.add(gateGLB);

  // --- Terrain tiles (tiled into disc) ---
  const terrainTile = await loadGLB(`estate/terrain_tile_${stage('terrain')}.glb`);
  tileIntoDisc(terrainTile, estateGroup, /*radius=*/ 10, /*tileSize=*/ 4);

  // --- Courtyard tiles (tiled inside walls) ---
  const courtTile = await loadGLB(`estate/courtyard_tile_${stage('courtyard')}.glb`);
  tileIntoDisc(courtTile, estateGroup, /*radius=*/ 7, /*tileSize=*/ 3);

  // --- Gardens (scattered pieces) ---
  const bush    = await loadGLB(`estate/garden_bush_${stage('gardens')}.glb`);
  const tree    = await loadGLB(`estate/garden_tree_${stage('gardens')}.glb`);
  const feature = await loadGLB(`estate/garden_feature_${stage('gardens')}.glb`);

  const GARDEN_SPOTS = [
    { piece: bush, pos: [-5, 0, -5] }, { piece: bush, pos: [5, 0, -5] },
    { piece: tree, pos: [-6, 0, 2] },  { piece: tree, pos: [6, 0, 2] },
    { piece: bush, pos: [-3, 0, -6] }, { piece: bush, pos: [3, 0, -6] },
    { piece: feature, pos: [0, 0, -6] },
  ];
  for (const spot of GARDEN_SPOTS) {
    const g = spot.piece.clone();
    g.position.set(...spot.pos);
    estateGroup.add(g);
  }
}
```

---

## Color Palettes by Era

| Levels | Era | Primary | Secondary | Accent | Mood |
|--------|-----|---------|-----------|--------|------|
| 1–10 | Frontier | Brown wood, rough stone | Thatch tan | Iron gray | Humble, resourceful |
| 11–20 | Established | Cut stone gray | Timber brown | Bronze | Sturdy, respectable |
| 21–30 | Prosperous | Polished stone | Marble white | Gold trim | Wealthy, proud |
| 31–40 | Imperial | White marble | Gold | Stained glass colors | Grand, imposing |
| 41–50 | Arcane | Deep purple | Crystalline teal | Emissive rune glow | Magical, otherworldly |
| **51–60** | **Mythic** | **Black** | **Royal gold** | **Arcane blue** | **Transcendent** |

### Mythic Palette (Levels 51–60)

The mythic era uses a strict **black, gold, blue** palette:

```
BLACK  #0A0A12  — Walls, perimeter, borders, structural frames, shadows
       #0D1B2A  — Terrain, deep surfaces, ground tones
       #1A2744  — Courtyard floor, secondary dark surfaces

GOLD   #D4AF37  — Keep, main structures, trim, accents, rune inscriptions
       #C4A030  — Wings, secondary buildings, walkways

BLUE   #4A90D4  — Energy effects, beacon, monument glow, magical elements
       #2060C0  — Gardens (bioluminescent flora), moat (liquid light)
```

Rules for mythic-era assets:
- **Anything structural/defensive (walls, perimeter, gate frame) = BLACK**
- **Anything prestigious/built (keep, wings, courtyard trim) = GOLD**
- **Anything magical/alive (energy, flora, beacon, monument) = BLUE**
- No white, no gray, no brown — pure black/gold/blue only

---

## Component Sizes

All components are designed to compose together in an isometric 3D scene. Sizes are
defined in **grid units** (1 unit = 1 tile in the isometric grid). The keep is the
reference object — everything else is sized relative to it.

```
                    TOP-DOWN FOOTPRINTS (to scale)

    . . . . . . . . . . . . . . . . . . . . . . .
    .                                             .   Terrain:  20x20 units
    .   ==========================================.
    .   ||                                      ||.   Perimeter: 16x16 ring
    .   ||  ....................................||.
    .   ||  .                                  .||.   Courtyard: 14x14
    .   ||  .                                  .||.
    .   ||  .  [wing]    +------+    [wing]    .||.   Wings: 4x3 each
    .   ||  .   4x3      | KEEP |     4x3     .||.
    .   ||  .            | 6x6  |              .||.   Keep: 6x6
    .   ||  .            +------+              .||.
    .   ||  .               |                  .||.
    .   ||  .            (mon)                 .||.   Monument: 2x2
    .   ||  .             2x2                  .||.
    .   ||  .                                  .||.
    .   ||  ....................................||.
    .   ==========================================.
    .                                             .
    . . . . . . . . . . . . . . . . . . . . . . .
```

| Component | Footprint (W x D) | Max Height | Notes |
|-----------|--------------------|------------|-------|
| Terrain | 20 x 20 | 0.5 | Flat disc, may have slight elevation at edges |
| Perimeter | 16 x 16 (ring) | 3–6 | Wall thickness ~0.5 units. Towers up to 6 high |
| Courtyard | 14 x 14 | 0.1 | Flat floor, sits inside perimeter |
| Keep | 6 x 6 | 4–10 | Grows taller with tiers. Stage 1 (tent) = 2 high. Stage 15 (citadel) = 10 high |
| Monument | 2 x 2 | 2–5 | Small focal point. Never taller than keep |
| Wings | 4 x 3 (each) | 2–6 | Two wings. Always shorter than keep |
| Gardens | scattered | 1–3 | Organic patches ~2x2 each, filling gaps |
| Crown | 1 x 1 | 2–4 | Sits atop keep. Beacon effect extends further but the model itself is small |

**Height reference at max tier:**
```
                 CROWN (beacon origin)
                   |
    10 ─ ─ ─ ─ ─ [KEEP spire] ─ ─ ─ ─ ─
     8 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
     6 ─ ─ ─ [TOWER] ─ ─ ─ ─ [WING] ─ ─   Towers = 6, Wings = 6
     5 ─ ─ ─ ─ ─ ─ ─ ─ [MONUMENT] ─ ─ ─   Monument max = 5
     4 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
     3 ─ ─ [WALL] ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   Wall = 3
     1 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
     0 ═══[COURTYARD]═══[TERRAIN]═════════   Ground level
```

**Key sizing rules for image generation:**
- The keep at stage 1 (tent) is ~2 units tall. It grows to ~10 at stage 15. It should NEVER look like a massive citadel filling the entire frame — it's one building in a compound.
- Wings are always visibly smaller than the keep (about 60-70% of keep height).
- The monument is a small courtyard feature, not a building. Think statue-sized, not tower-sized.
- The perimeter wall is a low ring, not a fortress wall. Even at max tier it's only 3 units tall (the towers go to 6).
- Every component must leave room for the others. No single piece should dominate the entire footprint.

---

## Layer Progressions

### Layer 0 — Terrain Disc `20x20, h:0.5` [SECTIONAL — flat tile]

Generate a **single flat terrain tile** (~4x4 units). The renderer tiles multiples into a circular disc. The tile should be seamlessly tileable on all edges.

**8 stages:**

| Stage | Levels | Visual |
|-------|--------|--------|
| 1 | 1–7 | Raw earth, wild grass, scattered rocks. Uneven terrain. The settler just claimed this plot. |
| 2 | 8–14 | Cleared and leveled. Dirt paths radiate from center. A few tree stumps remain. |
| 3 | 15–21 | Grass is green and maintained. Gravel paths. Small flower patches at edges. |
| 4 | 22–28 | Lush manicured lawn. Stone-lined paths. Hedgerows defining zones. Disc is visibly larger. |
| 5 | 29–35 | Terraced levels appear — the land itself has elevation. Stone retaining walls. Ornamental trees. |
| 6 | 36–42 | Exotic gardens — cherry blossoms, topiaries, reflecting pools at the perimeter. |
| 7 | 43–50 | Subtle luminescence in the ground. Crystal formations at edges. Ancient roots visible beneath translucent stone. |
| 8 | 51–60 | **[BLACK/BLUE]** Deep black earth with blue bioluminescent veins. Floating black rock fragments orbit the disc edges, traced with gold cracks. The ground is alive with faint blue pulse. |

---

### Layer 1 — Perimeter (walls, gate, moat) `16x16 ring, wall h:3, tower h:6` [SECTIONAL — wall + gate]

Generate **two pieces per stage**: a straight **wall section** (4 wide, with a pillar/tower on each end) and a **gate section** (4 wide, with the entrance). The renderer places 5 wall sections + 1 gate section in a hexagonal ring. A low defensive perimeter — NOT a towering fortress.

**10 stages:**

| Stage | Levels | Visual |
|-------|--------|--------|
| 1 | 1–5 | No wall. Wooden stakes marking the boundary. |
| 2 | 6–10 | Wooden palisade. Simple gate with a crossbar. |
| 3 | 11–15 | Stone foundation wall, wooden upper section. Proper gate with an arch. |
| 4 | 16–20 | Full stone wall, corner watchtowers (small). Iron-reinforced gate. |
| 5 | 21–25 | Crenellated wall with walkways. Two flanking towers at gate. Dry ditch/moat. |
| 6 | 26–32 | Tall masonry walls, four corner towers with conical roofs. Drawbridge over water moat. Murder holes above gate. |
| 7 | 33–40 | White marble walls with gold trim. Towers have spires. Moat glows faintly. Ornate portcullis. |
| 8 | 41–47 | Embedded rune carvings on walls (emissive blue). Towers project magical shields (translucent domes). |
| 9 | 48–54 | Black obsidian walls with gold rune inlays. Moat turns to blue liquid light. Towers float slightly, tethered by blue energy. |
| 10 | 55–60 | **[BLACK]** Thick black obsidian base ring with gold rune inscriptions. Six tall black crystalline obelisks (6 units high) with gold vein cracks rising from the ring. A towering wall of blue energy extends upward between the obelisks forming a continuous barrier. Grand black gate archway frames a blue portal entrance. Outer moat is deep blue luminous void. Imposing and massive — this is the ultimate defensive perimeter. |

---

### Layer 2 — Courtyard (the floor) `14x14, h:0.1` [SECTIONAL — floor tile]

Generate a **single floor tile** (~3x3 units). The renderer tiles multiples inside the perimeter walls. Seamlessly tileable. Should have subtle directional patterns (radial from center) but no unique features — those come from other layers.

**8 stages:**

| Stage | Levels | Visual |
|-------|--------|--------|
| 1 | 1–7 | Packed dirt. Some straw scattered. |
| 2 | 8–14 | Gravel with wooden plank walkways. |
| 3 | 15–21 | Cobblestone — irregular, hand-laid. |
| 4 | 22–28 | Cut stone tiles. Symmetrical patterns. Drainage channels visible. |
| 5 | 29–35 | Polished stone with geometric inlays. Multiple stone colors forming patterns. |
| 6 | 36–42 | Marble with gold vein inlays. Radial pattern emanating from the monument position. |
| 7 | 43–50 | Semi-translucent crystalline floor. Faint light visible beneath. Mosaic depicting a map or sigil. |
| 8 | 51–60 | **[BLACK/GOLD]** Black polished obsidian floor with gold geometric inlays forming concentric rune circles. Blue energy pulses beneath the surface at key positions. Gold veins radiate from the monument outward like roots. |

---

### Layer 3 — The Keep (main building) `6x6, h:2→10`

The centerpiece. Gets the most stages. Starts as a tiny tent (h:2) and grows to a citadel (h:10), but it's always just ONE building — never a sprawling complex. The keep should occupy roughly 30% of the courtyard, leaving room for wings, monument, and gardens.

**15 stages:**

| Stage | Levels | Visual |
|-------|--------|--------|
| 1 | 1–3 | Canvas tent with a campfire outside. |
| 2 | 4–6 | Wooden shack, single room. Thatched roof. Chimney smoke. |
| 3 | 7–9 | Log cabin, two stories. Proper door, shuttered windows. |
| 4 | 10–12 | Stone base, timber-framed upper floor. Small balcony. First "real" building. |
| 5 | 13–16 | Full stone house. Slate roof. Two chimneys. Attached lean-to workshop. |
| 6 | 17–20 | Manor house. Three stories, symmetric facade. Glass windows. Proper entrance with steps. |
| 7 | 21–24 | Small castle — a central tower emerges. Arched windows. Entrance becomes a gatehouse. |
| 8 | 25–28 | Full castle. Multiple towers connected by walkways. Stained glass. Banners on walls. |
| 9 | 29–32 | Grand castle. Great hall visible (open-sided or massive windows). Flying buttresses. Clock tower. |
| 10 | 33–36 | Palace. Symmetric wings extend from central tower. Domed roof. Gilded trim on everything. |
| 11 | 37–40 | Imperial palace. Multiple domes. Colonnaded galleries. Every surface has carved detail. |
| 12 | 41–45 | Impossible geometry — Escher-like staircases, towers that shouldn't balance. Magical reinforcement implied. |
| 13 | 46–50 | Crystalline palace. Parts of structure translucent. Main tower has visible energy core. Floating buttresses. |
| 14 | 51–55 | **[GOLD/BLACK]** Gold citadel with black structural frame. Black buttresses and columns, gold panels and domes. Blue-glowing windows. The silhouette is sharp and imposing against any backdrop. |
| 15 | 56–60 | **[GOLD/BLACK/BLUE]** Mythic citadel — gold spires on black foundation. The central tower is gold with black veins, crowned by a blue energy core. Structure extends downward through transparent black-glass ground. An impossible single spire pierces the sky, gold with blue energy spiraling up it. |

---

### Layer 4 — Monument (courtyard centerpiece) `2x2, h:2→5`

A small courtyard feature — statue-sized, NOT building-sized. Sits between keep and gate. Never taller than the keep. Tells the story of the player's journey.

**8 stages:**

| Stage | Levels | Visual |
|-------|--------|--------|
| 1 | 1–7 | A campfire ring with stones. |
| 2 | 8–14 | A stone well with wooden roof. |
| 3 | 15–21 | Carved stone statue — warrior or founder figure on a pedestal. |
| 4 | 22–28 | War memorial — multiple figures, bronze, on a tiered base. An eternal torch. |
| 5 | 29–35 | Obelisk of dark stone with golden inscriptions. Crystal at the top refracts light. |
| 6 | 36–42 | Floating orrery — metallic rings and spheres representing conquered territories, slowly rotating. |
| 7 | 43–50 | Contained rift — a vertical tear in space, framed by ancient pillars, another realm faintly visible. |
| 8 | 51–60 | **[BLUE/GOLD]** World tree — luminous blue trunk growing from a gold-ringed crack in the black floor. Blue canopy of light, gold leaf-veins. Roots of blue energy spread beneath the courtyard, visible through the obsidian floor. |

---

### Layer 5 — Wings (flanking structures) `4x3 each, h:2→6` [SPLIT — left + right]

Generate **two separate GLBs per stage**: left wing (military) and right wing (economic). Each is its own building. Always shorter than the keep (60-70% of keep height). Shows the estate has institutional capacity.

**10 stages (each stage includes both wings):**

| Stage | Levels | Visual |
|-------|--------|--------|
| 1 | 1–5 | Nothing. Just the keep stands alone. |
| 2 | 6–10 | A wooden lean-to on one side (storage). |
| 3 | 11–15 | Two small wooden outbuildings. One has weapon rack, one has crates/barrels. |
| 4 | 16–20 | Stone foundations. Barracks (training dummy outside) and storehouse (scales, ledgers). |
| 5 | 21–25 | Full stone buildings with own roofs. Connected to keep by covered walkways. |
| 6 | 26–32 | Two-story wings. Military wing has watchbell tower. Economic wing has vault door. |
| 7 | 33–40 | Grand halls — arched windows, own entrances. Nearly as impressive as the keep. |
| 8 | 41–47 | Wings connect to keep via enclosed bridges. Each has own courtyard/garden. |
| 9 | 48–54 | Black-framed palatial wings with gold facades. Military wing has blue-lit armory display. Treasury wing has gold vault door with blue rune lock. |
| 10 | 55–60 | **[GOLD/BLACK]** Each wing is a gold palace on black foundation — mirroring the keep's aesthetic. Black columns, gold walls, blue-glowing windows. Connected to keep by black walkways with gold railings. Each could stand alone as a monument. |

---

### Layer 6 — Gardens & Nature (organic elements) `~2x2 patches, h:1→3` [SECTIONAL — bush + tree + feature]

Generate **three separate piece types per stage**: a **bush cluster** (low, ~1x1), a **tree** (tall, ~1x1 footprint, h:2-3), and a **feature** (pond, trellis, topiary — ~2x2). The renderer scatters multiples of each across the estate gaps. Each piece is a small standalone object.

**8 stages:**

| Stage | Levels | Visual |
|-------|--------|--------|
| 1 | 1–7 | Nothing deliberate. Wild weeds. |
| 2 | 8–14 | A few planted bushes. A single tree. Practical herb garden. |
| 3 | 15–21 | Flower beds along pathways. Two trees flanking the gate. |
| 4 | 22–28 | Formal garden layout. Hedgerows in geometric patterns. Rose bushes. |
| 5 | 29–35 | Mature trees with canopy. Vine-covered trellises. A small pond. |
| 6 | 36–42 | Exotic species — cherry blossoms, weeping willows, topiary animals. |
| 7 | 43–50 | Magical flora — glowing flowers, trees with luminous fruit, vines that pulse with light. |
| 8 | 51–60 | **[BLUE]** Bioluminescent blue flora on black soil. Trees with black bark and blue-glowing leaves. Crystalline blue flowers. Floating blue seed pods. Gold pollen drifts in the air. The garden is an alien ecosystem — beautiful but unmistakably otherworldly. |

---

### Layer 7 — Crown (sky element / identity) `1x1, h:2→4`

A small object that sits atop the keep — flag, crest, or beacon origin point. The model itself is tiny. The beacon light effect is rendered by the shader, not part of the GLB.

**6 stages:**

| Stage | Levels | Visual |
|-------|--------|--------|
| 1 | 1–10 | Nothing. Estate has no skyline. |
| 2 | 11–20 | A flag on a pole atop the keep. Player's faction colors. |
| 3 | 21–30 | Carved stone banner/crest mounted on the highest tower. |
| 4 | 31–40 | Illuminated crest — sigil glows at night. Lanterns hang from the spire. |
| 5 | 41–50 | Floating emblem — player's sigil hovering as a magical hologram above the keep. Visible energy tether. |
| 6 | 51–60 | **[BLUE/GOLD]** A beacon — column of blue light shooting into the sky from the gold spire's tip. At the apex, a gold sigil floats inside a blue energy sphere. Visible from anywhere on the world map. The signature of a mythic lord. |

---

## Totals

| Layer | Component | Type | Stages | GLBs per stage | Total GLBs |
|-------|-----------|------|--------|----------------|------------|
| 0 | Terrain tile | sectional | 8 | 1 | 8 |
| 1 | Perimeter wall | sectional | 10 | 1 | 10 |
| 1 | Perimeter gate | sectional | 10 | 1 | 10 |
| 2 | Courtyard tile | sectional | 8 | 1 | 8 |
| 3 | Keep | whole | 15 | 1 | 15 |
| 4 | Monument | whole | 8 | 1 | 8 |
| 5 | Wing left | whole | 10 | 1 | 10 |
| 5 | Wing right | whole | 10 | 1 | 10 |
| 6 | Garden bush | sectional | 8 | 1 | 8 |
| 6 | Garden tree | sectional | 8 | 1 | 8 |
| 6 | Garden feature | sectional | 8 | 1 | 8 |
| 7 | Crown | whole | 6 | 1 | 6 |
| | | | | **Total** | **109** |

**109 unique GLBs**. At ~3 concept images per GLB = **327 images** (above the 240 target — some garden/courtyard stages can share images to bring it back down).

## Upgrade Schedule

At every level, at least one component changes. Some levels get two changes. The player never levels up and sees the same estate.

| Level | Changes |
|-------|---------|
| 1 | Terrain 1, Courtyard 1, Keep 1, Monument 1, Perimeter 1, Crown 1 (initial) |
| 4 | Keep 2 |
| 6 | Perimeter 2, Wings 2 |
| 7 | Keep 3 |
| 8 | Terrain 2, Courtyard 2, Monument 2, Gardens 2 |
| 10 | Keep 4 |
| 11 | Perimeter 3, Crown 2 |
| 13 | Keep 5 |
| 14 | Gardens 3 |
| 15 | Terrain 3, Courtyard 3, Monument 3, Wings 3 |
| 16 | Perimeter 4 |
| 17 | Keep 6 |
| 20 | Wings 4 |
| 21 | Perimeter 5, Keep 7, Crown 3 |
| 22 | Terrain 4, Courtyard 4, Monument 4 |
| 25 | Keep 8, Wings 5 |
| 26 | Perimeter 6 |
| 28 | Gardens 4 |
| 29 | Terrain 5, Keep 9, Courtyard 5, Monument 5 |
| 32 | Wings 6 |
| 33 | Perimeter 7, Keep 10 |
| 35 | Gardens 5 |
| 36 | Terrain 6, Courtyard 6, Monument 6 |
| 37 | Keep 11 |
| 40 | Wings 7 |
| 41 | Perimeter 8, Keep 12, Crown 4 |
| 42 | Gardens 6 |
| 43 | Terrain 7, Courtyard 7, Monument 7 |
| 46 | Keep 13 |
| 47 | Wings 8 |
| 48 | Perimeter 9 |
| 50 | Gardens 7 |
| 51 | Terrain 8, Keep 14, Courtyard 8, Monument 8, Crown 5 |
| 54 | Wings 9 |
| 55 | Perimeter 10 |
| 56 | Keep 15, Gardens 8, Crown 6, Wings 10 |

## Image Generation

**240 concept images** = ~3 reference images per GLB stage:

1. **Hero shot** — full isometric view of the component at this stage
2. **Detail shot** — close-up of materials, textures, architectural detail
3. **Material reference** — isolated surface/texture reference for Tripo3D consistency

### Critical Rules for All Prompts

Every image prompt MUST include:

1. **"Isometric 3D model"** — not a painting, not concept art. It's a reference for a 3D model.
2. **"No background"** — plain white or transparent background. No sky, no ground plane, no environment.
3. **"Single isolated object"** — only the component being generated. No surrounding buildings.
4. **Size reference** — mention the component's footprint and height so the AI doesn't create a massive citadel when you want a 6x6 keep.
5. **"Game asset"** — reinforces that this is a small isometric game piece, not a cinematic render.

### Prompt Template

```
Isometric 3D game asset, {component name}, {stage description},
{size constraint}, {material palette}, {key visual details},
single isolated object, no background, no environment,
clean white backdrop, consistent top-left lighting
```

### Example Prompts

**Keep stage 6 (Manor house):**
```
Isometric 3D game asset, medieval manor house, three stories tall,
small footprint roughly 6x6 meters, symmetric stone facade,
glass windows, slate roof, entrance with stone steps,
cut stone and timber frame materials, bronze accents,
single isolated building, no background, no environment,
clean white backdrop, consistent top-left lighting
```

**Keep stage 15 (Mythic citadel):**
```
Isometric 3D game asset, mythic fantasy citadel, compact single tower
with spire, small footprint roughly 6x6 meters, 10 meters tall,
black structural frame with gold panels and domes, blue glowing windows,
gold spire with blue energy spiral, black and gold color palette,
single isolated building, no background, no environment,
clean white backdrop, consistent top-left lighting
```

**Monument stage 4 (War memorial):**
```
Isometric 3D game asset, small war memorial statue, multiple bronze
figures on a tiered stone pedestal, eternal flame torch,
tiny footprint roughly 2x2 meters, about 3 meters tall,
statue-sized not building-sized, bronze and stone materials,
single isolated object, no background, no environment,
clean white backdrop, consistent top-left lighting
```

**Perimeter stage 10 (Mythic barrier):**
```
Isometric 3D game asset, large circular mythic defensive barrier
for a fantasy estate compound, thick black obsidian base ring with
gold rune inscriptions carved into it, six tall imposing black
crystalline obelisk pillars rising from the base ring with gold
vein cracks, each pillar 6 meters tall, a towering wall of blue
translucent energy extends upward between the pillars forming a
continuous barrier, the ring is large enough that buildings fit
inside it (16 meter diameter), one section has a grand black gate
archway framing a blue portal entrance, black gold and blue color
palette only, single isolated object, no background, no environment,
clean white backdrop, consistent top-left lighting
```
