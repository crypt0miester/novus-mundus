# 3D Model Guide — V2 (Revised)

Required format, specs, tooling, prompts, and asset checklist for adding 3D models to Novus Mundus.

---

## Current Rendering Architecture

The terrain builder uses **Three.js** with all geometry built procedurally at runtime — no external model files are loaded. Everything is constructed from primitive geometries (`BoxGeometry`, `CylinderGeometry`, `ConeGeometry`, `SphereGeometry`, `ExtrudeGeometry`, etc.) with `MeshStandardMaterial`. NPCs and animals are rendered via `InstancedMesh` (colored cones for bodies, spheres for heads).

**The game is viewed from a fixed isometric camera angle (top-down ~45°).** All models must be designed and optimized for this viewing angle — detail the top and front-facing surfaces, simplify or skip the back and underside. The camera does not rotate freely; players always see buildings and characters from the same elevated perspective.

To add actual 3D models, you need to integrate a model loader into the pipeline.

---

## Recommended Model Format

| Format | Extension | Why |
|--------|-----------|-----|
| **glTF Binary** | `.glb` | Single-file, compressed, web-native. Three.js `GLTFLoader` has first-class support. Embeds meshes, materials, textures, and animations in one file. |

**Do not use:** `.obj` (no animations, separate material files), `.fbx` (proprietary, large), `.blend` (editor format).

### Model Specs

| Property | Target |
|----------|--------|
| **Polycount** | 500-3,000 tris per building, 300-1,500 tris per character/hero |
| **Texture size** | 512x512 (buildings), 256x256 (props/characters) |
| **Texture format** | PNG (diffuse, normal, roughness-metalness packed) |
| **Scale** | 1 unit = 1 meter in Blender/modeling tool |
| **Origin** | Bottom-center of the model |
| **Viewing angle** | Isometric (top-down ~45°) — detail roofs/tops, simplify backs/undersides |
| **Orientation** | Forward = -Z (Three.js convention) |
| **Animations** | Embedded in `.glb` via glTF animation clips |
| **Max file size** | < 500KB per building, < 200KB per character (use Draco compression) |

### Material Setup

Use **PBR metallic-roughness** workflow (glTF default):
- `baseColorTexture` — diffuse/albedo (sRGB)
- `metallicRoughnessTexture` — G=roughness, B=metallic (linear)
- `normalTexture` — tangent-space normal map (linear)
- `emissiveTexture` — for glowing elements (windows, forges, sanctuary crystals)

---

## Tooling

### Primary: Meshy AI + Tripo3D

| Tool | Use For | Workflow |
|------|---------|---------|
| **Meshy AI** | Buildings, props, environment pieces | Text-to-3D or Image-to-3D, export `.glb` |
| **Tripo3D** | Hero characters, NPCs, animals | Image-to-3D from concept art, cleaner topology for characters |

### Cleanup: Blender (required for all models)

AI-generated models are never perfectly game-ready. Every model needs a Blender pass:

1. **Retopology** — AI models often have messy topology (overlapping faces, non-manifold edges, high density in flat areas). Use Blender's Remesh modifier or manual retopo to hit polycount targets.
2. **UV Unwrapping** — Re-unwrap UVs if the AI output has stretching or overlapping UV islands. Use Smart UV Project as a starting point.
3. **Material cleanup** — Consolidate materials (AI tools often create 10+ materials per model). Bake down to a single PBR material with atlas texture.
4. **Scale & origin** — Set origin to bottom-center, scale to match game units (buildings ~0.1-0.2 Three.js units wide based on current `BuildingFactory.js`).
5. **Named anchors** — Add Empty objects as particle/effect attachment points (see Modeling Guidelines below).
6. **Rigging** (characters only) — Add armature with basic skeleton. Use Mixamo for auto-rigging if the mesh is clean enough.
7. **Animation** (characters only) — Add idle animation clip at minimum. Use Mixamo animation library or hand-animate.
8. **Export** — File > Export > glTF Binary (.glb) with Draco compression enabled.

### Blender Cleanup Checklist

```
[ ] Import AI-generated model
[ ] Delete loose vertices/edges (Mesh > Clean Up > Delete Loose)
[ ] Remove doubles (Merge by Distance, threshold 0.0001)
[ ] Fix normals (Shift+N recalculate outside)
[ ] Decimate if over polycount budget (Decimate modifier, ratio to target)
[ ] Re-unwrap UVs if needed
[ ] Consolidate to 1-2 materials max
[ ] Set origin to bottom-center (Origin > Origin to 3D Cursor at base)
[ ] Apply all transforms (Ctrl+A > All Transforms)
[ ] Add named Empty nodes for particle anchors
[ ] Rig + animate (characters only)
[ ] Export as .glb with Draco compression
[ ] Verify file size under budget
```

---

## Prompt Guide

### Style Prefix (use on ALL prompts)

Every prompt should start with a consistent style prefix to keep the art cohesive across all 164 models.

**Meshy style prefix:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors,
warm lighting, game-ready asset, clean topology, single mesh,
viewed from isometric top-down 45-degree angle, detailed roof and top surfaces
```

**Tripo style prefix (for image-to-3D):**
Generate concept art first using any 2D AI tool with this prefix, then feed the image to Tripo:
```
stylized medieval fantasy character, full body, front-facing T-pose,
clean background, soft hand-painted art style, warm palette,
game character design sheet, optimized for isometric top-down view
```

---

## FACELESS HERO DESIGN RULES

All hero characters must have **no visible face**. Every hero's identity is communicated entirely through silhouette, armor, weapons, posture, and culturally appropriate face-covering. The face-covering must feel natural to the character — not arbitrary.

### Approved Face-Covering Methods

| Method | Use For | Examples |
|--------|---------|---------|
| **Full helmet with closed visor** | European knights, heavy warriors | Gawain, El Cid, Joan of Arc, Mordred |
| **Deep hood in shadow** | Rogues, mages, mysterious figures | Merlin, Satoshi, Alexios, Zara |
| **War mask / battle face-plate** | Eastern warriors, samurai, gladiators | Musashi, Mulan, Tomoe Gozen, Leonidas |
| **Ornamental face veil + headdress** | Royalty, queens, priestesses | Cleopatra, Scheherazade, Shirin, Nimue |
| **Skull/bone mask** | Undead, dark characters | Koschei, Mordred, Attila |
| **Divine mask / god-face** | Gods, mythological beings | Zeus, Ra, Anubis, Athena, Odin |
| **Kasa / wide-brim hat in shadow** | Ronin, travelers, wanderers | Wandering Ronin, Zhuge Liang, Robin Hood |
| **Wrapped turban/keffiyeh covering lower face** | Desert warriors, Arabian characters | Khalid, Rashid, Sinbad, Ali Baba |
| **Mempo / oni mask** | Japanese warriors | Akira Steelblossom, Sun Wukong |
| **Morion/barbute with nose guard** | Roman/Byzantine soldiers | Marcus Aurelius Maximus, Heraclius |
| **Fur/animal-head hood** | Berserkers, shamanic warriors | Attila, Ragnar, Beowulf, Bjorn |

### Silhouette-First Design

Since faces are hidden, each hero MUST be instantly recognizable from silhouette alone:
- **Unique weapon shape** — the primary identifier
- **Distinctive headgear profile** — horns, plumes, crests, wide brims
- **Shoulder/cape outline** — asymmetric capes, fur mantles, wing-like pauldrons
- **Stance** — every hero has a unique pose that reads at small scale

---

### Building Prompts (Meshy text-to-3D)

Each building has 4 tier prompts. The style prefix is prepended to all.

#### 0 — Mansion

**Tier 1 (Foundation):**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Small single-room timber cottage with A-frame structure. Steeply pitched thatched straw roof with visible wooden ridge beam. Front-facing arched wooden plank door with iron ring handle, set into a rough-cut stone door frame. One small square window to the right of the door with two wooden shutters open outward, warm orange candlelight glowing from inside. Exterior walls made of horizontal oak planks nailed to vertical timber frame posts. Stone chimney on the left side wall, built from stacked river stones, with a thin wisp of smoke rising from the top. Packed dirt foundation with three flat stepping stones forming a short path to the door. A single wooden barrel beside the door. Overall footprint roughly 4m x 3m.
```

**Tier 2 (Established):**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Two-story stone manor house, roughly 8m x 6m footprint. Ground floor built from coursed gray stone blocks with visible mortar joints. Upper floor half-timbered construction — dark oak frame beams with white lime-plastered infill panels. Clay tile roof in terracotta orange, gabled with a central ridge line. Front facade has a centered double wooden door with iron strap hinges and a semicircular stone arch above. Three mullioned glass windows on the upper floor with warm amber light glowing through, and two smaller windows flanking the ground-floor door. Stone chimney on the right gable end with thin smoke. Cobblestone path leading from the front door to the edge of the model. Small herb garden with low wooden fence on the left side. Stone foundation base visible, raised two steps above ground level.
```

**Tier 3 (Grand):**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Grand three-wing manor estate in U-shape plan, roughly 14m x 10m footprint. Central main hall is two stories with a steeply pitched slate gray roof and a decorative wooden gable finial. Two single-story wings extend forward from each side, framing a cobblestone courtyard. Walls of dressed ashlar stone blocks in warm cream color. Front entrance is a wide arched double door of dark oak with silver-colored iron bands and a heraldic shield mounted above. Six tall arched windows across the upper floor of the main hall, each with leaded glass panes and warm golden light inside. Ornate carved wooden balcony on the second floor above the entrance, supported by two stone corbels. Each wing has three windows with wooden shutters. Manicured box-hedge garden in the courtyard with a small stone birdbath at center. Silver trim on roof ridges and dormer edges. Two stone chimneys, one on each wing.
```

**Tier 4 (Legendary):**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Palatial medieval estate of white polished limestone, roughly 18m x 12m footprint. Three stories with a grand central tower rising one story higher than the flanking wings, topped with a gold-leafed conical spire with a pennant flag. Roof of dark blue-gray slate with gold trim running along every ridge, hip, and eave line. Main entrance: a grand pointed-arch portal framed by two fluted stone columns with gilded Corinthian capitals, heavy double doors of dark wood with gold lion-head knockers. Eight large stained-glass windows across the front facade depicting colorful heraldic scenes, each radiating warm multicolored light. Ornate stone balconies on the second and third floors with carved balusters and gold-capped newel posts. Rose garden courtyard with a three-tiered marble fountain at center. Flanking walls have ivy climbing the stone. Subtle golden magical aura emanating from the tower spire and window edges. Two grand stone chimneys with decorative chimney pots.
```

#### 1 — Barracks

**Tier 1:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Open-air military training yard, roughly 6m x 6m. Packed hard-dirt ground square. A single canvas A-frame tent on the left side (tan fabric, wooden center pole, rope guy-lines staked to ground). One wooden training dummy in the center — vertical post with horizontal crossbar arms, burlap sack torso, straw stuffing visible. Rough-hewn wooden post fence around the perimeter, waist-height, with sharpened tops. A wooden rack on the right side holding three wooden practice swords and two wooden shields. Small campfire ring of stones near the tent with a thin trail of smoke.
```

**Tier 2:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Wooden military longhouse, roughly 10m x 5m footprint. Constructed of thick horizontal pine logs with notched corners. Flat roof with a low crenellated wooden parapet around the edge (squared merlons). A single wooden door at center front, reinforced with iron cross-straps. Two narrow window slits flanking the door. A tall wooden pole on the right side of the roof flying a red triangular banner flag. Outside the front: a weapon rack holding iron spears, swords, and a round shield. Raised wooden platform base (half-meter high) with three wooden steps leading up to the door. Packed dirt ground around the base.
```

**Tier 3:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Stone fortress barracks compound, roughly 14m x 8m footprint. Main building of rough-cut gray stone blocks, two stories, with a flat roof ringed by stone crenellated battlements (alternating merlons and crenels). Attached single-story armory wing extending from the right side with its own flat roof. Central arched iron-reinforced gate with iron portcullis teeth visible at the top of the arch. Two red war banners hanging from iron poles mounted to the front wall, flanking the gate. Four iron torch sconces on the front wall — two on each side of the gate, with visible flame. Arrow-slit windows on the upper floor (six across). Stone staircase on the exterior left wall leading up to the battlements. Two training dummies in front of the building on a dirt training area.
```

**Tier 4:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Grand war academy fortress, roughly 18m x 10m footprint. Heavy dark stone walls three stories tall with crenellated battlements on top. Four square corner turrets rising one story above the main roofline, each capped with a pointed stone finial. Central gate: massive double iron doors under a pointed stone arch with a carved eagle relief above. Flanking the gate, two translucent glowing blue energy barrier panels (magical force fields) set into stone archways. A very large red war banner (3m tall) hanging from a horizontal iron bar above the gate. Gold-colored trim along all battlement edges and turret caps. Runic inscriptions carved into the stone around the gate arch, with a faint blue glow. Interior courtyard visible through the gate with a weapons drill area. Magical blue torches in iron sconces along the front wall.
```

#### 2 — Workshop

**Tier 1:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Small open-front lean-to workshop, roughly 4m x 3m footprint. Three walls of rough vertical planks, open on the front side. Sloped plank roof (higher at the back, lower at the front) supported by two thick corner posts. Inside: a sturdy oak workbench running along the back wall with a hand saw, mallet, and chisel laid on top. A pile of rough ore rocks and raw timber logs on the ground to the left. Iron tongs and a hand drill hanging from iron nails on the back wall. Dirt floor with wood shavings scattered. A single wooden stool in front of the workbench.
```

**Tier 2:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Timber-framed workshop building, roughly 8m x 5m footprint. Post-and-beam oak frame with daub-and-wattle infill walls. Steeply gabled roof with wooden shingles. A functional wooden waterwheel (1.5m diameter) mounted on the right exterior wall, with a narrow wooden water sluice feeding it. Front entrance: wide double barn-style doors of thick planks, one door open inward. Stone foundation base (half-meter high). Brick chimney on the left gable end with wisps of smoke. Various tools hanging on the exterior front wall — saws, hammers, and iron tongs. Two small windows with wooden shutters on the upper gable area. A stack of cut lumber beside the building.
```

**Tier 3:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Industrial stone workshop complex, roughly 12m x 8m footprint. Solid gray stone block construction. Three round brick chimneys rising from the roof at intervals, each belching dark smoke. Long gabled roof with corrugated metal panels. Wide arched entrance at center front with a set of iron minecart rail tracks emerging from inside and curving to the right, ending at a wooden ore dump bin. A loaded iron minecart sits on the tracks near the entrance. Heavy iron-reinforced double doors, currently open. Four narrow arched windows along the front wall between the door and corners. A mechanical ore-crushing mechanism (wooden frame with iron jaw plates) visible just inside the entrance. Stacked crates and barrels of refined materials along the right exterior wall.
```

**Tier 4:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Grand industrial engineering complex, roughly 16m x 10m footprint. Massive stone building with reinforced iron beam supports visible on the exterior. Four tall round smokestacks with iron caps, two actively emitting smoke with orange-lit interiors. Steep metal-paneled roof with three dormer windows glowing bright orange from forge-light inside. Central entrance: a towering arched opening (4m tall) framed with decorative golden gear-shaped motifs bolted to the stone. An exposed mechanical conveyor belt mechanism runs along the right exterior wall, carrying glowing ingots. Golden decorative gears and cog wheels mounted on the front facade as ornamentation. Windows across the front have a warm forge-fire glow. Steampunk-medieval hybrid aesthetic — iron pipes, brass fittings, and stone masonry combined. Magical amber sparks drifting upward from the smokestacks.
```

#### 3 — Vault

**Tier 1:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Small cylindrical stone vault building, roughly 3m diameter, 3m tall. Circular walls built from heavy stacked stone blocks. Domed roof of overlapping stone slabs forming a corbelled dome. Single front-facing heavy wooden door, arched top, reinforced with three horizontal iron bands and a large iron padlock at center. No windows. Two iron torch brackets on the wall flanking the door (unlit). Three flat stone steps leading up to the door. Rough cobblestone base. Overall impression: a small, impenetrable medieval strong-room.
```

**Tier 2:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Cylindrical stone bank vault, roughly 5m diameter, 5m tall. Smooth-coursed stone walls with a reinforced hemispherical dome bound by three visible iron bands running meridian-lines over the dome. Single heavy iron door (not wood) — circular vault door with a central wheel-lock mechanism and decorative rivet heads around the frame. Two iron torch sconces flanking the door, flames lit with warm orange glow. Five stone steps with iron handrails leading up to the raised entrance. A narrow decorative stone cornice wrapping the building at the base of the dome. No windows. Overall impression: a serious medieval banking house vault.
```

**Tier 3:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Fortified cylindrical vault, roughly 7m diameter, 6m tall. Walls of polished dressed stone in warm gray. Hemispherical dome reinforced with silver-colored iron bands forming a grid pattern. Ornate iron vault door with an elaborate multi-tumbler lock mechanism visible on the face — three concentric rotating rings and a central keyhole. Silver-plated door frame with decorative fleur-de-lis corner mounts. Two recessed guard alcoves flanking the door, each with a stone bench. Polished stone steps (seven) leading up to the entrance with silver-capped handrail posts. A narrow band of carved stone relief (coins and keys motif) wrapping the building below the dome line. Torch sconces with silver brackets. Overall impression: a high-security medieval treasury.
```

**Tier 4:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Grand legendary vault, roughly 9m diameter, 8m tall. Walls of gleaming white polished marble. Dome of burnished silver plates with gold-traced seam lines, catching light. Enchanted vault door: massive circular silver door with gold-inlaid rune circles that emit a soft blue-white glow — three rotating runic rings around a central glowing keystone crystal. Door frame encrusted with cut gemstones (rubies, sapphires, emeralds) set into gold bezels. Magical glowing rune inscriptions spiraling up the exterior walls in faint blue light. Grand stone staircase (nine steps) with gold-capped baluster railings. Two sculpted stone guardian lion statues flanking the base of the stairs. A faint magical ward shimmer in the air around the dome. Overall impression: a mythical treasure vault of impossible wealth.
```

#### 4 — Dock

**Tier 1:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Simple wooden dock pier, roughly 8m x 3m footprint. A straight wooden boardwalk of weathered oak planks on cross-beam supports, extending outward from the shore-side edge. Two vertical wooden mooring posts at the far end with coiled hemp rope around each. On the shore end: a small fishing shack (2m x 2m) with vertical plank walls, a lean-to roof of scrap wood, and an open doorway (no door). A wicker basket of fish beside the shack. Wooden ladder on the left side of the pier descending to water level. Overall impression: a humble medieval fishing dock.
```

**Tier 2:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Wooden dock complex, roughly 12m x 6m footprint. Extended L-shaped wooden boardwalk pier with thick log pilings visible underneath. A warehouse building (6m x 4m) at the shore end — vertical timber plank walls, gabled wooden-shingle roof, wide sliding barn door on the front, a smaller side door with iron hinges. Stacked cargo: three wooden crates, two barrels, and a coil of heavy rope on the pier. Fishing nets draped over a horizontal drying rack between two poles. Four mooring posts along the pier edge. A hanging wooden sign with a painted anchor symbol on the warehouse. Iron lantern on a post at the pier's end.
```

**Tier 3:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Stone harbor dock, roughly 16m x 8m footprint. Reinforced stone-block pier platform extending from a stone seawall, with iron mooring rings embedded in the stone edge. A large stone warehouse (8m x 5m) with thick walls, arched double wooden doors reinforced with iron, and a clay tile gabled roof. A wooden crane mechanism (A-frame derrick with rope-and-pulley block) mounted at the pier's edge for loading cargo. Six iron mooring posts along the pier. Four iron lantern posts with glass panes lining the pier. Stacked cargo — barrels, crates, and hemp sacks. A stone bollard at each corner of the pier. Narrow stone steps descending from the pier to a lower water-level landing. Overall impression: a busy medieval trading port.
```

**Tier 4:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Grand harbor with lighthouse tower, roughly 20m x 10m footprint. Stone-reinforced docks of polished gray stone with gold-capped iron mooring posts. A cylindrical lighthouse tower (10m tall) at the pier's end, built of white stone with a spiraling external stone staircase, topped with a glass-and-iron lantern room emitting a bright magical golden beacon light with visible light rays. Ornate stone warehouse with three arched stained-glass windows on the front facade, each depicting ships at sea, warm colored light glowing through. Golden ship figurehead decoration (carved eagle) mounted on a stone pedestal at the pier's entrance. Iron cargo crane with gilded fittings. Stone seawall with carved wave-pattern relief. A decorative iron gate archway at the pier entrance with gold scrollwork.
```

#### 5 — Forge

**Tier 1:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Small open-air blacksmith forge, roughly 4m x 3m footprint. A stone fire pit (chest-height, built from stacked rough stone) at center with glowing orange-red coals visible inside and a clay chimney hood above it. A cast-iron anvil on a thick oak tree-stump base to the right. A wooden hand-bellows leaning against the fire pit. Behind the fire pit: a wooden rack (vertical posts with horizontal bars) holding iron tongs, two hammers, and a pair of metal files. Dirt floor with soot stains around the forge. No enclosing walls — just a single-slope canvas awning overhead supported by two wooden posts, open on all four sides. A wooden bucket of water on the ground for quenching.
```

**Tier 2:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Stone blacksmith forge building, roughly 7m x 5m footprint. Three stone walls with an open front (the working side faces the viewer). Large brick chimney stack (2m wide) rising from the back wall with a bright orange-red glow emanating from the forge opening at its base. An iron anvil on a stump to the right of the forge. Outside the front: a wooden display rack holding finished weapons — two swords, an axe, and a shield. Clay tile gabled roof over the enclosed portion. Stone foundation step running the length of the open front. Two iron hook racks on the side walls for tools. A leather bellows with iron nozzle connected to the forge. Soot blackening around the chimney and forge area. A wooden barrel of water for quenching near the anvil.
```

**Tier 3:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Grand stone forge complex, roughly 12m x 7m footprint. Fully enclosed stone block building with a massive central chimney (3m wide) belching thick dark smoke with orange underlighting. Two additional smaller chimneys on the sides. Heavy arched wooden double doors at front, both open, revealing the red-lit interior. Outside the entrance: three iron anvils of different sizes on stump bases, arranged in a semicircle. Weapon display racks on both sides of the door — swords, shields, axes, and spears. A long stone water trough for quenching along the right wall. Four iron torch sconces on the exterior walls with flame. Tile roof with metal ridge cap. Iron-barred windows (two) on each side wall glowing orange from interior forges. Soot and char marks on the stone around every opening.
```

**Tier 4:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Legendary forge of mythical craft, roughly 16m x 9m footprint. Towering central chimney (8m tall) of dark volcanic stone with magical fire erupting from the top — blue and orange flames intertwined. Glowing molten metal channels (narrow trenches with bright orange-yellow liquid) running along the exterior base of the building from side vents. Inside visible through the grand arched entrance: a massive enchanted anvil with glowing blue-white runic inscriptions pulsing on its surface. Exterior weapon displays feature ornate golden weapons on iron wall-mounts — glowing enchanted swords and shields. Magical amber embers and sparks floating upward around the chimney in a slow spiral. Stone walls reinforced with dark iron plates and decorative bronze rivets. Two sculpted iron dragon-head brackets flanking the entrance, jaws open, orange forge-light glowing from within. Dark stone with orange-lit cracks throughout, as if built over a lava source.
```

#### 6 — Market

**Tier 1:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Simple market stall, roughly 3m x 2m footprint. Four rough-cut wooden corner posts supporting a flat canvas canopy (tan/cream colored) with slight sag in the center. A wooden plank counter at waist height across the front. On the counter: a wicker basket of bread loaves, a small stack of round cheese wheels, and a ceramic jug. One wooden barrel behind the counter. A hand-painted wooden sign hanging from the front edge of the canopy reading "GOODS" in simple lettering. Dirt ground. A burlap sack leaning against the right post.
```

**Tier 2:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Open-air market with colorful canopy, roughly 6m x 4m footprint. Six wooden posts supporting a peaked fabric canopy in alternating red and gold striped panels. Long wooden display table (4m) across the front with neatly arranged goods: stacked fabric bolts, pottery, small wooden boxes, and a brass weighing scale. Three wooden barrels and four stacked wooden crates behind the counter. A tall vertical banner pole on the left post with a hanging fabric pennant in red. Two hanging iron lanterns from the canopy cross-beams. Cobblestone ground beneath. A woven rug draped over the side of the table for display.
```

**Tier 3:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Grand covered market hall, roughly 12m x 8m footprint. Eight stone columns (round, with simple capitals) supporting a large timber-framed roof with clay tile covering, open on all four sides between the columns. Inside: four separate vendor stall tables arranged in two rows, each loaded with different goods — fabrics, spices in open sacks, metalwork, pottery. Colorful fabric banners hanging between the columns (red, gold, green, blue). Iron chain chandeliers with candles hanging from the roof beams (three chandeliers). Cobblestone floor with a central stone drainage channel. Stacked exotic goods — rolled carpets, sealed amphorae, wooden treasure chests. Stone steps (two) at each open side entrance.
```

**Tier 4:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Legendary merchant palace, roughly 16m x 10m footprint. Ornate stone and timber structure with a soaring canopy of gold-trimmed silk fabric supported by carved marble columns with gilded acanthus-leaf capitals. Silk banners in rich jewel-tone colors (ruby, sapphire, emerald) hanging from every column. Jeweled glass display cases with golden frames showing precious items — gemstones, golden crowns, enchanted artifacts. A few items appear to hover magically above their pedestals with a faint glow. Overflowing treasure: gold coins spilling from open chests at the base of columns, exotic silks draped everywhere. Magical floating golden motes of light drifting through the space like fireflies. Mosaic tile floor in geometric patterns. An opulent central fountain with gold-leafed basin where coins glitter in the water.
```

#### 7 — Academy

**Tier 1:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Small stone schoolhouse, roughly 5m x 4m footprint. Simple rectangular stone building with thick walls. One large arched window on the front wall with blue-tinted glass panes and warm light glowing from inside. Wooden arched door with iron ring handle, slightly recessed into the stone wall. Steeply pitched slate gray roof with a small stone finial on the ridge peak. A small wooden bookshelf visible through the window. Stone foundation step running the front length. A carved stone plaque above the door showing an open book symbol. A wooden bench outside to the left of the door. Overall impression: a humble medieval scholar's study.
```

**Tier 2:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Stone academy tower, roughly 6m diameter, 8m tall. Cylindrical stone tower with a blue-tinted hemispherical dome roof topped with a bronze weather vane in the shape of a quill pen. Four tall arched windows equally spaced around the tower at mid-height, each with deep blue-and-gold stained glass and warm light glowing through. Wooden arched entrance door at ground level with an iron knocker shaped like an owl. A narrow stone stringcourse (decorative band) wrapping the tower at the spring of the dome. A small external stone shelf below one window holding a telescope-like instrument. Stone base with three steps up to the door. Ivy beginning to climb the stone on the back side.
```

**Tier 3:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Grand academy complex, roughly 14m x 8m footprint. Central tall cylindrical tower (10m) with a blue-tinted dome and a bronze armillary sphere at the peak. Two-story rectangular library wing attached to the right, with arched windows (six on the upper floor, four on the lower) each with stained glass in blue and gold. Multiple stained-glass rose windows on the tower — one large one facing front, two smaller ones on the sides. Astronomical instruments on a stone observation deck at the base of the dome: a brass astrolabe on a stand and a small sextant. A pointed-arch entrance portal in the base of the tower with carved stone trim featuring stacked books and scrolls in relief. Stone courtyard in front with a stone sundial on a pedestal. Slate roof on the library wing. Iron lanterns flanking the entrance.
```

**Tier 4:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Legendary arcane academy, roughly 16m x 10m footprint. Towering central spire (14m tall) with a crystalline glowing dome that radiates soft blue-white light — the dome appears to be made of enchanted crystal rather than stone. Magical floating books (three or four) orbiting slowly around the spire at mid-height, pages open, glowing faintly. Enchanted stained-glass windows (eight across the front facade) actively emitting beams of colored light outward — not just glowing but projecting visible light rays. Rune-carved stone walls where every rune line has a subtle blue luminescence. Grand pointed-arch entrance flanked by two stone owl statues on pedestals with glowing blue eyes. A floating crystal orb above the entrance archway. Two-story wings on each side with arched cloisters on the ground floor. Stone courtyard with a magical levitating globe of the world at center. Overall impression: a mystical university where knowledge has physical magical form.
```

#### 8 — Arena

**Tier 1:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Simple circular fighting pit, roughly 8m diameter. Circular wooden post-and-rail fence (waist-height) enclosing a sand-floored arena. The fence is made of rough-hewn logs — vertical posts every 1.5m with two horizontal rails. Inside the ring: flat packed sand ground with a few footprint marks. Outside the fence on one side: a single tier of rough wooden bench seating (three benches, accommodating ~15 spectators). A gap in the fence on the opposite side serves as the entrance, flanked by two taller posts. A single wooden weapon rack near the entrance holding a practice sword and a buckler shield. Overall impression: a modest medieval gladiator training ring.
```

**Tier 2:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Stone arena, roughly 12m diameter. Circular stone walls (3m tall) with one large arched stone entrance gateway. Inside: flat sand-covered pit floor. Tiered stone seating wrapping three-quarters of the interior — three rows of stone bench seats rising in concentric semicircles. Two iron weapon racks mounted on the interior wall flanking the entrance, holding swords, tridents, and shields. Two red triangular banners on iron poles mounted atop the wall on either side of the entrance. Four iron torch sconces on the interior walls, flames lit, casting warm flickering light on the sand. A carved stone archway over the entrance with a simple crossed-swords relief above.
```

**Tier 3:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Grand colosseum arena, roughly 18m diameter. Tall circular stone walls (6m) with three arched entrance gateways equally spaced. Tiered stone seating on all sides — five rows of seats with a VIP stone canopy-covered viewing box at the top tier on one side. Sand pit floor with iron drain grates. A heavy iron portcullis gate at the main entrance (central arch), raised halfway, with chains visible. Iron torch sconces (eight) around the interior walls with large flames. Red and gold fabric banners hanging from the top of the walls (six banners). Stone relief carvings of warriors and beasts around the exterior of the arched entrances. A stone announcer's platform on one wall above the seating.
```

**Tier 4:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Legendary arena colosseum, roughly 24m diameter. Towering circular stone walls (10m) with gold trim running along every ledge, arch, and cornice. A translucent magical force-field dome overhead — faint blue-purple energy barrier visible with hexagonal grid pattern. Glowing blue-white runic inscriptions spiraling around the exterior walls. Tiered seating with a floating spectator platform hovering above the top tier on the far side (magical levitation, blue glow underneath). Four grand arched entrances with gold-leafed columns flanking each. Two sculpted stone champion statues (armored warriors with raised swords) flanking the main entrance, each 3m tall on stone pedestals. Iron portcullis at the main gate, fully raised. Sand floor with embedded glowing rune circles for magical dueling. Golden fire braziers (four) at cardinal points on the wall top, burning with bright magical fire.
```

#### 9 — Sanctuary

**Tier 1:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Small stone shrine, roughly 4m diameter overall. Central octagonal stone pedestal (1m tall, 1m wide) with a pointed conical stone roof cap on top, a small rough-cut crystal (clear/white) set into the peak. A ring of six standing stones (natural rough boulders, 1m tall each) arranged in a circle around the pedestal at 2m radius. Mossy stone ground between the standing stones. A narrow gap between two stones serves as the entrance path. Wildflowers and small ferns growing at the bases of the standing stones. A single stone step up to the pedestal. No walls, no door — an open sacred site. Overall impression: a humble medieval holy site in a forest clearing.
```

**Tier 2:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Octagonal stone sanctuary, roughly 6m diameter. Octagonal stone walls (2m tall) with open arched openings on four alternating sides (no doors, just arched gaps). Conical spiral-ribbed stone spire roof rising to 6m, with a purple crystal orb (fist-sized) at the summit emitting a soft purple glow. Four carved stone pillars at the corners of the arched openings, each with a spiral carved pattern. A ring of eight standing stones (1.5m tall each) encircling the building at 4m radius, mossy and ancient. Soft purple ambient glow emanating from inside through the arched openings. Stone floor inside with a central circular carved rune pattern. A stone altar (low, waist-height) at the center of the interior. Overall impression: a mystical medieval temple.
```

**Tier 3:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Grand octagonal sanctuary temple, roughly 10m diameter. Tall octagonal stone walls (4m) with ornate carved stone tracery — interlocking arches and vine patterns. A tall spiraling stone spire (10m to peak) twisting upward in a helical pattern, with a large glowing purple crystal (basketball-sized) at the summit radiating visible purple light beams in four directions. Eight arched stained-glass windows (one per wall) in deep purple and gold, each glowing from interior light. An elaborate pointed-arch entrance portal on the front face with carved angel figures flanking the doorway. Magical standing stone circle around the building (twelve stones, 2m tall, each with a carved rune that glows faintly). Floating candles (eight) hovering at various heights around the entrance, flames purple-white. Thin ethereal purple mist drifting at ground level around the base. Stone steps (five) leading up to the entrance with carved banister walls.
```

**Tier 4:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Legendary divine sanctuary, roughly 14m diameter. Towering crystalline spire (16m tall) that transitions from rough stone at the base to translucent purple-white crystal at the top — as if the stone itself is transforming into crystal. Massive glowing purple crystal at the summit (1.5m diameter) radiating intense light beams outward in all directions like a star. Golden rune-carved walls — every surface covered in intricate runic script inlaid with gold that pulses with slow rhythmic light. Enchanted floating stones: five large stone fragments orbiting the spire at different heights, slowly rotating, each trailing purple magical particle trails. The standing stone circle (sixteen stones) around the building has fully activated glowing runes, connected by arcs of purple energy between them. Celestial energy aura — a pillar of soft purple-white light rising from the crystal peak into the sky. Grand entrance: a pointed arch framed in gold with a floating keystone crystal above the apex. Stone steps (seven) with golden handrails. The ground around the building is cracked with purple light leaking through the fissures. Overall impression: a mythical temple where divine power physically manifests.
```

#### 10 — Observatory

**Tier 1:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Small stone lookout tower, roughly 3m diameter, 6m tall. Cylindrical stone tower with thick walls. Flat roof platform with a low stone parapet wall (waist-height). A simple brass telescope (tabletop size) on a wooden tripod stand on the roof, angled upward. Three narrow vertical arrow-slit windows spiraling up the tower at different heights. A simple arched wooden door at ground level with iron hinges. A star chart — a painted wooden board with constellation patterns — mounted on the exterior wall beside the door. Stone base with two steps. Overall impression: a humble medieval watchtower repurposed for stargazing.
```

**Tier 2:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Cylindrical stone observatory tower, roughly 5m diameter, 8m tall. Smooth stone walls with a rotating copper dome roof — the dome has a vertical slit opening (observation slot) facing front, revealing darkness inside. A brass telescope tube protruding through the slit, angled upward at 45 degrees. Four narrow arched windows with blue-tinted glass spaced around the tower at mid-height. A wooden arched door at ground level with an iron knocker shaped like a star. A copper weather vane on top of the dome in the shape of a crescent moon. Faint green patina on the copper dome. Stone foundation with three steps up to the door. A small stone shelf below one window holding a brass astrolabe.
```

**Tier 3:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Grand observatory tower, roughly 7m diameter, 12m tall. Tapered cylindrical stone tower (wider at base, narrower at top). Polished silver-colored metal dome with a wide slit opening and mechanical track visible at the base of the dome for rotation. A large brass telescope (2m long tube) protruding through the slit on a pivoting brass mount. An orrery mechanism (mechanical model of planets on brass arms) visible through a large arched window on the front — four brass spheres on rotating arms around a central sun sphere. Star map engravings carved into the stone exterior — constellation patterns in low relief with dots for stars wrapping the upper portion of the tower. A stone observation balcony with iron railing wrapping halfway around the tower below the dome. Arched entrance door with carved zodiac symbols on the stone frame. Stone staircase visible through a side window spiraling upward inside.
```

**Tier 4:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Legendary observatory spire, roughly 9m diameter, 16m tall. Gleaming metallic silver dome that opens in two halves (currently half-open, one hemisphere retracted). A magical holographic star map — a translucent glowing three-dimensional constellation map of rotating stars and planets — floating 2m above the open dome, slowly rotating, rendered in blue-white ethereal light. An enchanted crystal lens telescope inside (visible through the opening), with a massive crystal focusing element instead of glass, glowing faint purple. Astral energy beams — thin lines of starlight — descending from the holographic map down through the telescope. Golden astronomical instruments (armillary sphere, celestial globe) on the exterior observation balcony. The tower exterior is dark polished stone with gold-inlaid astronomical patterns — zodiac signs, orbital paths, constellation lines — all glowing with faint gold light. Iron-and-gold railing on the observation deck. Crystal finials on four decorative spires at the dome's base. Overall impression: a place where the cosmos itself is captured and studied.
```

#### 11 — Treasury

**Tier 1:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Small stone treasury building, roughly 5m x 4m footprint. Simple rectangular building of heavy stone blocks. Gabled slate roof with a plain stone ridge. Front-facing reinforced wooden door — thick oak planks with iron strap hinges, a heavy iron bolt lock, and a visible iron keyhole plate. Two simple square stone columns flanking the entrance (half-pilasters, flush with the wall). One narrow barred window on each side wall (iron bars, no glass). Stone foundation raised two steps above grade. A carved stone plaque above the door showing a coin stack symbol. No decorative elements — purely functional and solid. Overall impression: a no-nonsense medieval counting house.
```

**Tier 2:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Classical stone treasury, roughly 7m x 5m footprint. Rectangular building with four round stone columns across the front forming a porch (colonnade). Gabled roof with a triangular pediment above the columns — the pediment has a carved relief of a balance scale. Heavy bronze-colored door set back behind the columns with a large decorative golden door knocker in the shape of a lion's head. Three stone steps across the full width of the front, leading up to the columned porch. Stone base of a slightly different (darker) stone color. Two iron torch sconces on the columns flanking the door, lit with warm flame. Smooth dressed stone walls on the sides with no windows. Overall impression: a dignified medieval bank building.
```

**Tier 3:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Grand classical treasury, roughly 10m x 7m footprint. Imposing rectangular building with six tall fluted stone columns (Doric style) across the front supporting a grand pediment. The pediment features an ornate gold-leafed relief sculpture of an overflowing cornucopia. Polished stone steps (seven) spanning the full building width leading up to the columned portico. Massive bronze double doors with gold-inlaid geometric patterns and silver ring handles. A golden sphere (1m diameter) mounted on a stone pedestal at the roof peak of the pediment. Silver trim along the roofline, column capitals, and step edges. Walls of polished cream-colored stone with subtle carved panel details. Two iron-and-gold torchère stands flanking the doors with large flames. Overall impression: a grand medieval treasury of great wealth and authority.
```

**Tier 4:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Legendary golden treasury temple, roughly 14m x 9m footprint. Gleaming white marble building with eight tall gold-plated Corinthian columns across the front, each with detailed gilded acanthus-leaf capitals. Grand pediment with a jewel-encrusted golden relief of a radiant sun surrounded by coins and gemstones. Massive golden double doors (4m tall) with diamond-shaped inlaid gems forming a pattern and golden lion-head knockers. A colossal golden sphere (2m diameter) on the roof peak, radiating warm golden light beams outward like a small sun. White marble steps (nine) with gold-veined stone and golden balustrade railings. At the base of the steps: gold coins, gemstones, and small treasure items spilling outward from the building's foundation as if the vault is overflowing. A magical golden aura — warm amber light — radiates from the entire building. Overall impression: a mythical treasure palace of infinite wealth.
```

#### 12 — Citadel

**Tier 1:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Small square stone keep, roughly 6m x 6m footprint, 8m tall. Simple square tower of rough-cut gray stone blocks. Flat roof with a crenellated parapet (alternating merlons and crenels, each about 0.5m wide). A single heavy wooden gate at ground level — arched top, thick oak planks reinforced with three iron horizontal bands and large iron nail heads. Four narrow arrow-slit windows (one per wall, at mid-height). A stone machicolation (defensive overhanging projection with a floor opening) above the gate. No decorative elements. Stone base with a slight battered (sloped) foundation wall. Overall impression: a purely functional medieval defensive tower.
```

**Tier 2:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Stone castle keep, roughly 10m x 10m footprint, 10m tall. Square main tower with four smaller square corner turrets extending 2m above the main roofline. All surfaces crenellated (battlements on main tower and each turret). Walls of coursed gray stone with visible mortar joints. Central iron portcullis gate in a pointed stone archway — portcullis raised halfway, iron teeth visible at the top and bottom. Heavy stone walls (1.5m thick, visible at the gate opening). Arrow-slit windows: four on the main tower (two per visible side) and one on each turret. A stone wall-walk (chemin de ronde) visible connecting the turrets at battlement level. Iron torch brackets (four) on the front wall flanking the gate. A flagpole on the tallest turret (rear-right) with a small pennant.
```

**Tier 3:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Grand stone citadel, roughly 16m x 16m footprint, 14m tall. Tall central square keep with four large round corner towers, each topped with a conical slate-gray pointed roof with a stone finial. Thick outer curtain walls (2m thick) connecting the towers, with crenellated battlements running the entire perimeter. Central gatehouse with a pointed arch, iron portcullis (fully raised), and a wooden drawbridge (lowered, spanning a narrow dry moat). Two red-and-gold war banners on tall iron poles mounted atop the front two towers. Arrow-slit windows across all walls — eight on the keep, three per tower. A stone wall-walk with periodic watchtower alcoves. Iron torch sconces (six) along the front curtain wall with lit flames. Dressed gray stone construction with lighter stone quoins (corner blocks) on the towers. Overall impression: a formidable medieval grand fortress.
```

**Tier 4:**
```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, warm lighting, game-ready asset, clean topology, single mesh, isometric top-down view.
Legendary fortress citadel, roughly 22m x 22m footprint, 18m tall. Towering dark stone walls of near-black basalt with four massive round corner towers, each crowned with a golden-tipped spire rising 4m above the tower roof. The spires are polished gold catching light. Glowing blue-white magical runes inscribed in spiraling patterns across the exterior walls — hundreds of small rune characters providing an ambient magical light. Central gatehouse: enormous arched entrance (5m tall) with an enchanted drawbridge that glows faint blue at the edges — the bridge appears partially translucent, a magical force-bridge. Flanking the gate: two carved stone dragon statues (2m tall) on pedestals with glowing blue eyes. Four massive golden war banners (4m tall) flying from the top of each tower, illuminated from below by magical light. A translucent blue energy barrier dome — faint hexagonal grid visible — arcing over the entire citadel like a force-field shield. Arrow slits across all walls glow faint blue from interior magical lighting. Overall impression: a mythical impenetrable fortress protected by both stone and sorcery.
```

---

### Hero Prompts

For heroes, use a **two-step workflow**:
1. Generate 2D concept art (for NFT portrait + as Tripo input)
2. Feed the concept art image into Tripo3D for `.glb` generation

**CRITICAL: NO VISIBLE FACES.** Every hero's face must be fully concealed by a helmet, mask, hood, veil, or other culturally appropriate covering. Identity is communicated through silhouette, weapon, armor, and posture.

#### 2D Concept Art Prompt Template

```
stylized medieval fantasy character, full body, front-facing T-pose,
clean white background, soft hand-painted art style, warm palette,
game character design sheet, optimized for isometric top-down view. Face completely hidden — 
[FACE-COVERING METHOD].
[CHARACTER-SPECIFIC DESCRIPTION]
```

#### Character-Specific Prompts

##### Historical Warriors & Leaders

**Alexander the Great (ID: 10):**
```
Young Macedonian king warrior, face fully hidden behind a golden-bronze Corinthian helmet pulled down with closed cheek guards and a narrow eye slit — no skin visible, tall red horsehair crest flowing behind. Polished bronze muscle cuirass over leather pteruges skirt. Red military cloak draped over left shoulder, fastened with a gold lion-head fibula. Bronze greaves on shins. Right hand gripping a long sarissa spear (shaft extends above head height). Left arm carrying a round bronze aspis shield with the sixteen-ray Vergina Sun emblem embossed at center. Leather sandals with straps up the calves. Commanding forward-leaning stance with spear raised.
```

**Julius Caesar (ID: 11):**
```
Roman emperor general, face fully concealed behind a gold-plated Imperial Gallic helmet with hinged cheek plates closed tight and a full face visor with narrow horizontal eye slits — polished to a mirror finish, red horsehair longitudinal crest on top. White toga praetexta with purple border draped over ornate gold-and-silver lorica musculata (muscle cuirass) with a central SPQR eagle relief. Red paludamentum general's cloak fastened at the right shoulder. Left hand resting on a gladius short sword in a decorated scabbard at the hip. Right hand holding a gold commander's baton (scipio). Leather caligae sandals with iron studs and bronze shin greaves. Authoritative upright dignified stance.
```

**Leonidas (ID: 12):**
```
Spartan king warrior, face fully hidden behind a bronze Corinthian helmet pulled down to the chin with narrow T-shaped eye-and-nose opening entirely in shadow — nothing visible inside, tall crimson horsehair crest. Bare muscular chest (no armor above the waist — Spartan style). Red flowing cape attached at both shoulders with bronze clasps, billowing to the left. Left arm bearing a large round bronze aspis shield with the inverted-V lambda symbol in red at center. Right hand gripping a long dory spear in overhand thrust position. Bronze greaves from knee to ankle. Leather battle skirt with bronze scale trim at the waist. Fierce wide defiant stance, shield forward, spear cocked back.
```

**Cleopatra (ID: 13):**
```
Egyptian queen pharaoh, face completely veiled behind an ornate golden ceremonial face mask in the style of a pharaonic death mask — smooth idealized features with heavy kohl-lined eye shapes painted on the mask, no real face visible underneath. Elaborate golden vulture crown headdress with a rearing cobra uraeus at the brow, lapis lazuli and turquoise inlay. Broad golden usekh collar necklace covering the chest and shoulders, set with carnelian, turquoise, and lapis stones. White pleated linen kalasiris dress falling to ankles. Gold arm bands on both upper arms and gold cuff bracelets on both wrists. Right hand holding a golden ankh scepter vertically. Left hand holding a golden was-scepter. Royal blue sash crossing diagonally across the chest. Gold sandals. Elegant regal upright pose.
```

**Genghis Khan (ID: 14):**
```
Mongol emperor warlord, face fully concealed behind a steel Mongol battle helmet with a riveted iron face plate covering the entire face — a smooth curved iron mask with narrow eye slits and small breathing holes, no features visible. Pointed helmet crown with thick brown fur trim around the brim and back of the neck. Steel lamellar armor plates covering the torso, layered in horizontal rows. Thick brown fur-lined cloak and high fur collar over the armor. Long dark braided hair extensions visible from under the helmet back. Heavy leather gauntlets with iron knuckle plates. Recurve composite bow slung across the back. Curved Mongol saber in a decorated scabbard at the left hip. Leather riding boots with pointed toes. Commanding mounted-warrior stance (standing, legs apart as if dismounted).
```

**Sun Tzu (ID: 15):**
```
Ancient Chinese strategist general, face fully hidden beneath a wide conical bamboo-and-lacquer war hat (dou li) that casts the entire face into deep shadow — only darkness visible below the hat brim, with a sheer black silk face veil hanging from the hat's edge to the chest. Dark silk scholar-warrior robes with gold cloud-pattern trim at the hems and collar. Traditional Chinese lamellar breastplate underneath, visible where the robe parts at the chest. Jade green silk sash tied at the waist. Left hand holding an unrolled bamboo scroll (The Art of War). Right hand resting on the pommel of a jian straight sword sheathed at the waist. Hair hidden entirely under the hat. Black silk shoes. Wise contemplative stance, head slightly bowed so the hat obscures everything.
```

**Joan of Arc (ID: 16):**
```
French holy warrior maiden, face fully hidden behind a polished steel great bascinet helmet with a rounded visor (hounskull style) closed and locked — smooth curved steel with a pointed snout profile, narrow horizontal eye slit, rows of small breathing holes on the right side, no face visible. Full articulated plate silver armor from neck to toe with engraved fleur-de-lis patterns on the breastplate and pauldrons. White linen tabard over the armor with a large gold fleur-de-lis on the chest and a red cross on the back. Right hand holding a tall white banner on a wooden pole — the banner depicts a gold fleur-de-lis and a cross with the words "JHESUS MARIA." Longsword in a leather scabbard at the left hip. A faint golden divine light halo effect behind the helmet. Determined upright holy warrior stance.
```

**Napoleon Bonaparte (ID: 17):**
```
French emperor military commander, face fully concealed behind the shadow of a deep bicorne hat — the hat worn far forward so the front brim covers the face entirely, and a high stiff military collar rises to meet it, leaving only total darkness where the face should be. Dark navy blue double-breasted military coat with two rows of gold buttons, gold bullion epaulettes on both shoulders, red piping on the cuffs and collar. White waistcoat visible at the open front of the coat. White breeches tucked into tall black leather riding boots. The iconic right hand tucked inside the coat front at chest height. Left hand holding a gold-handled commander's saber, point down. Gold sash across the waist. Medals and the Legion of Honor star on the left breast. Short stature, authoritative squared-shoulder stance.
```

**Hannibal Barca (ID: 18):**
```
Carthaginian general, face fully hidden behind a bronze Hellenistic-style face-covering war helmet — a smooth curved bronze mask with stylized beard and stern brow ridges sculpted on the surface, narrow eye slits, no real face visible behind. The helmet has a short red crest and cheek guards molded to the mask. Bronze muscle cuirass with a large elephant head embossed on the chest plate. Purple Carthaginian cloak draped over the left shoulder and fastened with a gold brooch. Dark curly hair visible at the nape below the helmet. Leather arm guards with bronze studs on both forearms. Falcata curved sword in a leather scabbard at the left hip. A war elephant tusk fragment on a leather cord around the neck, resting on the cuirass. Bronze greaves. Battle-hardened veteran wide stance.
```

**William Wallace (ID: 19):**
```
Scottish highland warrior, face completely covered by blue woad war paint — but rendered as a full blue tribal face mask pattern so thick and intricate that no actual skin features are discernible, just an abstract pattern of blue spirals, lines, and Celtic knotwork covering everything from forehead to chin, with eyes hidden in dark shadow beneath a heavy brow ridge of paint. Wild, untamed long brown hair falling past the shoulders, partially matted. Leather padded jerkin armor over a rough-spun linen tunic. Dark green-and-blue plaid tartan cloth draped diagonally over the left shoulder and pinned with an iron Celtic brooch. Both hands gripping the massive two-handed Scottish claymore sword — blade point resting on the ground between his feet, hands on the crossguard. Fur-lined leather boots wrapped with cord. No helmet. Fierce freedom-fighter wide stance.
```

**Heraclius (ID: 20):**
```
Byzantine emperor warrior, face fully hidden behind an ornate golden full-face imperial helmet — a polished gold mask with idealized serene imperial features molded in relief (stylized brows, nose, closed lips), no real face visible, narrow eye slits framed by engraved laurel leaves. A jeweled Byzantine imperial crown integrated into the helmet's brow with ruby and sapphire cabochons and small gold crosses. Ornate golden lamellar armor (klibanion) with jeweled trim — each lamellar plate edged in gold. Purple imperial cloak with dense gold thread embroidery in vine and cross patterns, fastened with a large gold-and-emerald fibula. A golden pectoral cross on a gold chain, resting on the chest armor. Right hand wielding a cruciform sword (cross-shaped guard, gold pommel). Left arm carrying a kite shield with a gold Chi-Rho symbol on a red field. Red leather boots with gold buckles. Dignified holy warrior stance.
```

**Attila the Hun (ID: 21):**
```
Hunnic warlord chieftain, face fully concealed behind a terrifying wolf-skull helmet — an actual wolf's upper skull and face mounted as a helm, upper jaw with fangs framing where the wearer's face would be, but the interior is filled with a riveted iron face plate with narrow eye slits and stitched leather, no human face visible. The wolf's ears stand upright on top. Layered fur and boiled-leather armor plates, overlapping in rough rows. A full wolf pelt cloak draped over both shoulders, the wolf's foreleg skins hanging down the arms. Long braided dark hair emerging from under the helmet at the back. Right hand drawing a bone-handled composite recurve bow at half-draw. A quiver of black-fletched arrows on the back. Left hip: a short curved sword in a leather-and-bone scabbard. Heavy leather boots with fur wraps. Savage conquerer wide forward-leaning stance.
```

##### Mythological Gods & Legends

**Zeus (ID: 50):**
```
Greek king of gods, face fully hidden behind a radiant golden divine mask — a smooth idealized bearded god-face in hammered gold with serene closed eyes and stern brow, no real features visible behind it, edges of the mask blending into a golden olive wreath crown. Flowing white toga draped over one shoulder and golden himation cloak over the other, gathered at the waist with a gold lightning-bolt belt clasp. Muscular elder build visible through the draping. Right hand raised overhead wielding a crackling lightning bolt javelin — a jagged golden bolt with white-blue electrical energy arcing between the prongs. A golden eagle perched on the left shoulder, wings half-spread. Gold arm bands on both biceps. Gold-laced sandals. Commanding divine majesty stance, weight on the back foot, throwing arm cocked.
```

**Athena (ID: 51):**
```
Greek goddess of wisdom and war, face fully hidden behind a polished silver-gold Corinthian helmet with a tall owl-shaped crest — the helmet pulled down with cheek guards closed, narrow T-shaped opening entirely in deep shadow, no face visible. The helmet has engraved olive branch patterns along the brow ridge. Gleaming golden aegis breastplate with a sculpted Medusa face relief at center (the Medusa is on the armor, not a separate item). White flowing chiton dress underneath the armor, visible from the waist down. Left arm carrying a round shield with an embossed owl of Athena emblem. Right hand gripping a long spear (dory), butt-spike resting on the ground. An olive branch tucked into the shield hand. Gold arm bands and golden greaves. Wise warrior goddess balanced stance.
```

**Ares (ID: 52):**
```
Greek god of war, face fully concealed behind a menacing black-bronze Corinthian helmet with a tall black horsehair plume — the helmet pulled down past the chin, the T-shaped opening glows with faint red light from within as if his eyes burn, but no face is visible, just an ominous red glow in darkness. Blood-red heavy bronze body armor with skull motifs embossed on the pauldrons and chest plate — a central screaming skull relief. Crimson war cloak, torn and battle-worn, tattered at the edges, fastened at the left shoulder. Right hand gripping a massive war spear with a broad leaf-shaped blade, streaked with dried blood-red stains. Left arm carrying a round dark bronze shield with a snarling boar emblem. Heavy bronze greaves with knee cops shaped like roaring lion heads. Dark leather war skirt. Aggressive forward-leaning violent stance, spear leveled.
```

**Odin (ID: 53):**
```
Norse allfather god, face entirely hidden beneath a wide-brimmed dark traveler's hat pulled low, combined with a dark blue-gray cloth face wrap covering everything below the hat brim — only deep shadow visible where the face should be (the one-eye detail is communicated by a single faint blue-white magical glow piercing through the shadow where the right eye would be, while the left side remains completely dark). Long gray beard flowing out from under the face wrap, reaching mid-chest. Dark blue-gray long cloak with silver embroidered runes along the edges, worn over runic chainmail armor visible at the chest and arms. Two ravens — Huginn (dark, slightly larger) and Muninn (dark with a subtle blue sheen) — perched on each shoulder. Right hand wielding Gungnir, a tall golden spear with intricate knotwork on the shaft and a leaf-shaped blade that glows faint gold. Rune-carved leather bracers on both forearms. Heavy dark leather boots. Ancient wise wanderer stance, leaning slightly on the spear.
```

**Thor (ID: 54):**
```
Norse god of thunder, face fully hidden behind a Viking spectacle helmet — a domed iron helm with a riveted nose guard that extends down to cover the face, and wide circular eye guards (spectacle plates) around the eye holes, the interior entirely in deep shadow, no face visible. Two small iron wings on the helmet sides. Silver-blue Viking chainmail and plate armor — chainmail hauberk with iron plate pauldrons and vambraces. Red flowing cape fastened with two iron wolf-head clasps at the shoulders. Muscular build stretching the armor. Right hand wielding Mjolnir — a massive square-headed war hammer with a short leather-wrapped handle, crackling with white-blue lightning arcs. Left hand wearing Jarngreipr — an oversized iron power gauntlet with runic engravings. Megingjord belt of strength — a wide leather belt with iron plates and a glowing rune buckle. Heavy iron-shod boots. Thunderous heroic wide stance, hammer raised, lightning arcing.
```

**Ra (ID: 55):**
```
Egyptian sun god, face hidden behind a stylized golden falcon-head helm — an elaborate golden mask in the form of a falcon's face with curved beak, painted eye markings in black and blue, and a smooth golden surface, no human face visible anywhere (the falcon head IS the face covering). Towering golden sun disc crown mounted above the falcon head, with a rearing cobra uraeus at the front. Humanoid body in white and gold Egyptian royal kilt (shendyt) with a pleated front panel. Golden broad collar (usekh) pectoral necklace set with lapis, turquoise, and carnelian. Gold arm bands on both biceps and gold cuff bracelets. Right hand wielding a golden was-scepter staff topped with a miniature sun disc. Left hand holding a golden ankh. Radiant solar aura — golden light rays emanating outward from the sun disc. Gold sandals. Divine pharaoh upright stance.
```

**Anubis (ID: 56):**
```
Egyptian god of the dead, face hidden behind a stylized black jackal-head helm — an elaborate mask in the form of a jackal's elongated face with tall pointed ears, golden inner-ear details, and painted eye markings, no human face visible (the jackal head IS the face covering). Humanoid body in dark ceremonial robes — a black linen robe with gold trim at the collar, hems, and cuffs. Golden broad collar pectoral and gold arm bands. Right hand holding a tall golden ankh-topped staff, planted on the ground. Left hand holding golden scales of judgment — a small balance with two suspended pans, one containing a tiny feather (Ma'at's feather). Dark purple cloak over the shoulders. A small gold Anubis amulet hanging from the belt. Black and gold striped nemes cloth hanging from under the jackal helm down the back. Mysterious underworld guardian upright stance.
```

**Poseidon (ID: 57):**
```
Greek god of the sea, face fully hidden behind a sea-encrusted bronze divine mask — a smooth idealized bearded god-face in green-patinated bronze with closed serene eyes, barnacles and small shells growing on the surface, coral fragments at the edges, no real face visible. Muscular elder build. Flowing sea-blue robes and seaweed-trimmed toga gathered at the waist with a rope of twisted kelp. A crown of living coral and shells integrated into the top of the mask and surrounding the head. Long wavy sea-green tinted beard flowing from beneath the mask, reaching the chest, with small seashells tangled in it. Right hand wielding a golden three-pronged trident (2m tall), the prongs gleaming. Barnacle-encrusted bronze chest armor visible under the robes. Swirling ocean wave effect at the feet. Commanding ocean deity wide stance.
```

**Gilgamesh (ID: 160):**
```
Sumerian demi-god king, face fully hidden behind an ornate golden ceremonial war mask — a smooth hammered gold mask with stylized Mesopotamian features: thick angular eyebrows in relief, a long squared ceremonial beard sculpted in tiered curls (Assyrian style) as part of the mask, narrow eye slits, no real face visible. A royal Mesopotamian headdress crown rising above the mask — a tiered golden cap with bull-horn extensions on each side. Ornate golden scale armor with lion-head motifs on the pauldrons. A lion pelt draped over the right shoulder, the lion's head hanging on the chest. Muscular heroic build. Right hand wielding a golden double-headed axe. Gold arm bands with lapis lazuli inlay on both biceps. Decorated leather war skirt with gold fringe. Gold shin guards. Ancient legendary king wide commanding stance.
```

**Amaterasu (ID: 161):**
```
Japanese sun goddess, face completely hidden behind an elegant white porcelain kitsune-style divine mask — a smooth oval mask with painted minimalist features: thin red lips, golden closed eyes, delicate red accent lines, serene expression, no real face visible behind it. The mask is framed by an elaborate golden sun halo mounted behind the head — a circular golden disc with radiating pointed ray extensions, emitting warm golden light. Long flowing jet-black hair cascading down the back to the waist, adorned with small golden sun ornaments and delicate golden chains. Flowing layered kimono robes in white silk with gold embroidery at the hems and sleeves. A radiant golden mirror (Yata no Kagami) held at chest height in both hands, reflecting golden light. A small white fox companion sitting at the feet, looking up. Faint golden divine aura with soft light rays. Serene celestial goddess pose, standing straight.
```

**Quetzalcoatl (ID: 162):**
```
Aztec feathered serpent god, face fully concealed behind a turquoise mosaic serpent mask — an elaborate ceremonial mask in the form of a feathered serpent's open jaws, the face hidden within the serpent's mouth, turquoise and jade mosaic tiles covering the mask surface, obsidian eyes on the serpent, white shell teeth lining the jaw edges, no human face visible. An enormous feathered headdress rising from behind the mask — long iridescent green quetzal plumes (1m tall) radiating upward and back, with smaller red and blue parrot feathers at the base. Turquoise mosaic breastplate with a gold wind-spiral (Ehecatl symbol) at center. Arms and legs adorned with feathered serpent scale armor — overlapping jade and turquoise plates. Jade arm bands. Right hand gripping a golden serpent staff with a coiled snake head. Flowing green-blue feathered cloak trailing behind. Gold sandals with jade ankle bands. Majestic Mesoamerican deity wide stance.
```

**Prometheus (ID: 163):**
```
Greek titan of fire, face fully hidden in deep shadow beneath a heavy ragged hood — a torn, ancient dark cloth hood pulled far forward, the interior completely black, no face visible, only the faintest hint of two dim orange-ember glows where eyes might be. Worn and torn ancient robes in dark gray and brown, tattered at every edge as if aged thousands of years. Muscular build visible through the torn fabric. Broken iron chains hanging from both wrists — thick links, snapped at the ends, dangling 30cm down, with visible chain-burn scars (dark marks) on the exposed forearms. Both hands cupped together in front of the chest, holding a blazing eternal flame — a bright orange-white fire hovering between the palms, illuminating the chest and arms but not reaching the shadowed face. A tattered dark cloak hanging from the shoulders, shredded at the bottom. Bare feet with iron shackle remnants around the ankles. Defiant yet weary titan stance, leaning slightly forward, offering the fire.
```

**Sun Wukong (ID: 70):**
```
Chinese Monkey King, face fully hidden behind a golden opera-style monkey mask — an ornate Peking Opera monkey king face mask with exaggerated painted features: red and gold paint, fierce brow lines, wide grin showing teeth, golden forehead mark, all painted on smooth carved surface, no real face visible behind it. Phoenix feather cap on top of the mask with red tassels. Golden chainmail battle armor with cloud motifs embossed on the chest plate. Tiger-skin patterned skirt (leather with orange-and-black striped print) over armor leggings. Right hand twirling the golden Ruyi Jingu Bang — an extending staff in mid-spin, gold with red end-caps. Red and gold cloud-treading boots with curled toes. Furry monkey hands (covered in golden-brown fur) gripping the staff. A monkey's tail visible curling from behind. Cloud wisps at the feet. Playful mischievous acrobatic stance, one leg raised.
```

**Miyamoto Musashi (ID: 71):**
```
Japanese legendary swordsman ronin, face fully hidden behind a red-lacquered menpo (samurai half-face mask covering nose, cheeks, chin, and throat) combined with a deep black cloth hood (zukin) wrapped over the head and forehead, leaving only a narrow band of shadow at the eye line — no skin visible. The menpo has a fierce scowling mouth with sculpted snarling lips and a small chin beard plate. Worn dark indigo-blue kimono with loose wide sleeves, showing signs of travel wear and fading. Right hand gripping a katana in high guard position (raised above the right shoulder, blade angled forward). Left hand holding a wakizashi short sword in reverse grip at waist level — the famous Niten Ichi-ryu dual-wield stance. Simple rope belt (obi) at the waist. Wooden geta sandals. Long unkempt hair visible from under the hood at the back, tied loosely. Intense focused duelist forward-leaning stance.
```

**Robin Hood (ID: 72):**
```
English outlaw archer, face fully hidden in deep shadow beneath a large Lincoln green hood — the hood pulled far forward and down, with a dark green cloth face wrap (like a bandit mask) covering everything below the eyes, the eye area lost in the hood's shadow, no face visible. Only the tip of a red feather in the hood's peak is visible from the front. Lincoln green hooded tunic with darker green patches, belted at the waist with a brown leather belt with a brass buckle. Brown leather vest over the tunic. Brown leather bracers laced on both forearms. Right hand drawing a yew English longbow at full draw, arrow nocked and aimed forward. A leather quiver of goose-fletched arrows on the back. Brown leather boots, knee-height. A small leather pouch at the belt. Roguish confident stance, one foot forward, bow drawn.
```

**Merlin (ID: 73):**
```
Legendary wizard sage, face entirely hidden in impenetrable darkness beneath a tall pointed wizard hat — the wide brim angled down in front, combined with a deep blue-purple hood underneath, the face area completely black, not even eye glints visible, just void. A long flowing white beard (waist-length) emerges from the darkness below the hat, the only "feature." Deep blue-purple wizard robes with silver embroidered star and crescent moon patterns scattered across the fabric. A leather-bound spellbook chained to the belt with a small iron chain. Right hand gripping a tall gnarled wooden staff topped with a large crystal that glows bright blue-white, illuminating the staff and robes but somehow not the face (the hat shadow is absolute). Left hand slightly raised with faint blue magical sparks at the fingertips. Heavy rope belt with hanging pouches and a small glass vial. Simple leather boots beneath the robes. Ancient wise sorcerer stance, leaning on the staff.
```

**Nimue (ID: 74):**
```
Lady of the Lake enchantress, face fully hidden behind a translucent water-veil — a magical curtain of flowing water that hangs from a silver crescent-moon circlet crown, cascading in front of the face like a living waterfall, constantly flowing and shimmering, the face behind it completely obscured as if behind frosted glass. Long flowing dark hair with water droplets glistening, falling down the back to the waist. Flowing ethereal blue-white priestess robes that ripple and undulate as if underwater, even in still air. Both hands holding Excalibur — a legendary sword held vertically in front of the body, blade pointing up, emerging from a swirl of mist at the base. The sword's blade has a faint blue-white glow. Pale luminous skin on the hands and arms with a slight blue tint. Water magic aura — small floating water droplets suspended in the air around the figure. Bare feet standing on a suggestion of water surface. Mysterious lake sorceress floating stance.
```

**Mordred (ID: 75):**
```
Dark knight traitor, face fully concealed behind a menacing black full-face great helm — angular and harsh, with a narrow horizontal eye slit glowing faint red from within, two short curved horns rising from the temples, riveted black iron plates, no face visible. Jagged black plate armor with aggressive angular edges and thorn-like protrusions on the pauldrons, gauntlets, and greaves. Dark red accents painted on armor edges. A tattered dark crimson cloak, shredded at the bottom as if burned. Right hand gripping a serrated black longsword — the blade has a dark red fuller groove and jagged teeth near the crossguard. Left arm carrying a kite shield with an inverted red dragon emblem. A dark energy aura — faint black-purple wisps rising from the armor like cold smoke. Heavy spiked sabatons. Menacing villainous forward-leaning stance.
```

**Gawain (ID: 76):**
```
Knight of the Sun, face fully hidden behind a polished silver-white great helm with a golden sun crest rising from the crown — a smooth cylindrical flat-top helm with a narrow cross-shaped vision slit, polished to mirror brightness, no face visible. The golden sun crest has radiating pointed rays. Gleaming polished silver-white full plate armor from head to toe. A golden sun emblem engraved on the center of the breastplate. White linen cloak with gold trim. Left arm carrying a heater shield with a large golden sunburst emblem on a white field. Right hand wielding a longsword with a golden cross-guard and a sun-shaped pommel. Golden spurs on the heels. Radiant noble champion stance, sword raised in salute position.
```

**Beowulf (ID: 77):**
```
Norse legendary warrior hero, face completely hidden behind a Vendel-era boar-crested helm — an iron helmet with a full face plate featuring eyebrow ridges, a nose guard, and cheek panels that cover everything, decorated with interlaced animal knotwork patterns in bronze inlay, a bronze boar figure mounted on the crest, narrow eye slits only. Bare muscular arms visible (no sleeves) with golden arm bands (torque style, twisted gold) on both biceps and a heavy gold neck torque. Chainmail shirt (byrnie) covering the torso to mid-thigh. Fur-trimmed leather belt with a wolf-head iron buckle. Right hand wielding Hrunting — an ancient broad-bladed sword with a pattern-welded blade and a gold pommel. Battle scars — raised pink lines — on both forearms. Leather pants with iron stud reinforcements. Fur-wrapped leather boots. Fearless berserker hero wide aggressive stance.
```

**El Cid (ID: 78):**
```
Spanish medieval knight champion, face fully hidden behind a polished steel great helm (pot helm) with a flat top and a narrow cross-shaped vision slit — a riveted steel helm with a red feathered plume rising from the crown, no face visible. Polished steel full plate armor with red and gold Castilian heraldry — the breastplate features a quartered shield design with the castle of Castile (gold) and the lion of Leon (red). Red cloak with a gold rampant lion emblem. Right hand wielding Tizona — a legendary longsword with an ornate gold crossguard. Left arm carrying a kite shield with the Cross of Castile. Gold spurs on articulated sabatons. Heroic mounted-warrior standing stance, sword raised in triumph.
```

**Sinbad (ID: 79):**
```
Arabian legendary sailor adventurer, face fully concealed behind a wrapped white turban-and-face-veil combination — the turban wound tightly around the head with a tail of cloth pulled across the nose and mouth and tucked in, plus a shadow-casting fold of cloth over the brow, leaving only a narrow band of deep shadow at the eye line, no face visible. A ruby jewel pinned to the turban's front fold. Loose white sailor shirt, open at the chest, tucked into baggy cream-colored pants. A wide red silk sash around the waist. Right hand gripping a curved golden scimitar with an ornate guard. A coiled rope at the belt. Leather boots with folded-down tops. A small ornate treasure chest strapped to the back. A small brass compass hanging from the belt. Adventurous swashbuckler wide stance, scimitar extended forward.
```

**Scheherazade (ID: 80):**
```
Persian legendary storyteller queen, face completely hidden behind an ornate layered silk veil — a sheer gold-embroidered deep blue outer veil (niqab style) covering everything below a jeweled headpiece, with a second sheer inner veil across the upper face, only a band of shadow visible at the eye line. An elaborate jeweled headpiece crown — golden filigree frame set with small pearls, sapphires, and dangling golden coin ornaments at the temples. Ornate layered silk robes in deep blue and gold with intricate Persian paisley embroidery. Multiple golden necklaces of varying lengths. Golden bangles on both wrists. Right hand holding an ornate open storybook at chest height — the pages glow with faint golden light. Left hand raised in an elegant storytelling gesture. Flowing robes to the floor. Elegant queen upright stance.
```

**Baba Yaga (ID: 81):**
```
Slavic witch crone, face entirely hidden in deep shadow beneath an enormous tattered hood — a shapeless dark brown-green fabric hood so oversized and pulled so far forward that the face is completely lost in darkness, with only wisps of wild gray hair escaping from the sides and bottom. Ragged dark brown and green robes patched together from mismatched fabrics. A necklace of small animal skulls on a cord around the neck. Right hand gripping an oversized wooden mortar. Left hand holding a large wooden pestle like a club. A gnarled wooden walking stick/broom tucked under one arm. Hunched posture, head tilted forward so the hood void faces the viewer. Bare gnarled feet visible beneath the robes, standing on dead leaves. Eerie magical crone shuffling stance.
```

**Koschei the Deathless (ID: 82):**
```
Slavic immortal lich king, face fully hidden behind a skeletal iron death mask — a thin iron mask shaped like a skull with hollow eye sockets that glow sickly green from within, a carved nasal bone ridge, and teeth sculpted along the lower edge, no living face visible behind it. An iron crown with dark gems (black onyx, deep amethyst) welded to the top of the skull mask. Gaunt skeletal body frame in tattered dark royal robes with faded gold trim. Right hand wielding a dark iron scepter topped with a trapped glowing green soul orb. A chain belt with a small pendant — an enchanted golden egg on a short chain (his hidden death). Dark leather gloves torn at the fingertips. Tattered dark cloak with a high collar framing the skull mask. Undead sorcerer king gaunt rigid stance.
```

**Ilya Muromets (ID: 83):**
```
Russian bogatyr epic hero, face fully hidden behind a conical Russian helm (shishak) with a riveted iron nose guard extending down into a full chainmail aventail that covers the entire face, jaw, and neck — only a narrow dark slit visible between the nose guard and the hanging mail, no face visible. The helmet has a small iron cross finial at the peak. Heavy chainmail hauberk over a red linen tunic. Right hand wielding a massive iron mace (shestoper) — a flanged mace with six iron fins. Left arm carrying a large teardrop-shaped kite shield with a gold Orthodox cross on a red field. Thick brown beard visible below the aventail. Leather belt with a short axe. Iron-shod leather boots. Mighty Slavic knight hero immovable wide stance.
```

**Vasilisa the Wise (ID: 84):**
```
Russian fairy tale heroine, face completely hidden behind an ornate painted wooden mask — a traditional Russian decorative mask with delicate painted features: rosy cheeks, gentle closed eyes, small red lips, all stylized in folk-art tradition (like a matryoshka doll face), clearly a mask. Framed by an elaborate golden kokoshnik headdress studded with pearls and small red stones. Long golden braided hair in two thick braids over each shoulder, tied with red ribbons. An ornate traditional Russian sarafan dress in red with gold embroidered floral patterns. White linen blouse visible at the sleeves. Right hand raised, holding a glowing magical firebird feather — an iridescent orange-gold feather radiating warm light and small floating sparks. Red leather boots with embroidered trim. Enchanted forest maiden gentle standing stance.
```

**Dobrynya Nikitich (ID: 85):**
```
Russian bogatyr dragon-slayer, face fully hidden behind a conical Russian helm with an iron full-face visor plate — the visor has a sculpted stern brow ridge and a vertical nose guard, riveted to the helm, with narrow eye slits, no face visible. Chainmail aventail covering neck and throat. Heavy plate-and-chainmail armor. Right hand wielding a broad-bladed two-handed Slavic sword raised in high guard. A tattered dark green dragon-wing membrane draped over the left shoulder as a trophy cloak. Left arm carrying a large round iron-bossed shield with a painted red dragon emblem. Battle-worn determined warrior stance, sword high.
```

**Hua Mulan (ID: 86):**
```
Chinese warrior woman disguised as male soldier, face fully hidden behind a Tang dynasty iron war mask (tie mian) — a full-face iron mask with sculpted stern masculine features: angular brows, straight nose, thin lips, all idealized and clearly a mask, no real face visible. A military helmet over the mask with a red horsehair plume and cheek guards. Tang dynasty lamellar armor — overlapping iron plates laced with red cord over a red padded tunic. Two paired dao swords at the sides. Hair completely hidden under the helmet. Iron-plated leather boots. Disciplined Chinese soldier-warrior attention stance, hands on both sword pommels.
```

**Zhuge Liang (ID: 87):**
```
Chinese legendary strategist, face fully hidden beneath a wide Taoist scholar hat tilted forward to cast the entire face in deep shadow, combined with a raised white feather fan held directly in front of the face — the fan obscures whatever the hat shadow doesn't, no face visible at all. Flowing scholarly robes in white and blue silk with wide sleeves. A star chart scroll tucked into a blue silk belt. A crane feather cloak (short cape of white feathers) over the shoulders. Long thin beard visible below the fan. Left hand holding a bamboo scroll. Simple black silk shoes. Wise tactician contemplative stance, fan raised to face level.
```

**Tomoe Gozen (ID: 88):**
```
Japanese female samurai warrior, face fully hidden behind a red-lacquered menpo (full lower-face mask with fierce sculpted snarling mouth, pronounced chin, throat guard) combined with a samurai kabuto helmet with wide iron brim, neck guard of layered lames, and a crescent moon maedate (front crest) — together covering the entire face and head, only a narrow shadow at the eye line. Red-laced o-yoroi samurai armor with large rectangular shoulder guards (sode). Right hand gripping a naginata polearm held diagonally. Long flowing black hair visible from under the helmet at the back, falling to the waist. A katana in a red-lacquered scabbard at the left hip. A small war banner pole in a socket on the back armor. Graceful yet deadly wide samurai stance.
```

**Aladdin (ID: 89):**
```
Arabian street prince adventurer, face fully hidden by a combination of a red fez cap pulled low and a wrapped cloth face covering — a dark red cloth wound around the lower face from chin to nose and tucked into the fez, with the fez brim and shadow falling over the upper face, leaving only a band of darkness at the eye line, no face visible. Purple embroidered vest over a loose white baggy shirt. Baggy cream-colored pants with a wide golden silk sash. Pointed curl-toed shoes in red leather. Right hand holding an ornate golden magic lamp with a thin wisp of magical blue-white smoke curling upward. A small monkey figure on the left shoulder. A small curved dagger tucked into the sash. Charming rogue adventurer relaxed stance, one hip cocked.
```

**Ali Baba (ID: 90):**
```
Arabian clever merchant, face fully hidden behind a wrapped turban-and-face-veil — a large cream-colored turban with excess cloth pulled down across the entire face like a dust veil, a small emerald pin holding the front fold, only a narrow shadow at the eye line, no face visible. Humble brown merchant robes with hidden gold trim at the inner lining. Simple leather belt with a visible fat coin pouch. A curved dagger tucked discreetly into the sash at the back. At the feet: a small open wooden treasure chest with gold coins spilling out. Leather sandals. A coil of rope at the belt. Shrewd confident standing stance, body relaxed but posture alert.
```

**Rostam (ID: 91):**
```
Persian legendary champion hero, face fully hidden behind an ornate Persian war mask — a smooth polished steel mask with sculpted stern features: heavy brows, prominent nose, a full curled beard sculpted in metal relief (Persian style), no real face visible, narrow eye slits. An elaborate crested Persian helmet with a tall spike finial and chainmail aventail. Elaborate Persian scale armor (Babr-e Bayan — legendary leopard-skin armor) with a leopard-skin cloak over the left shoulder. Right hand wielding a massive gurz mace — a heavy mace with a bull-shaped iron head. A lasso rope (kamand) coiled at the belt. Golden arm cuffs on both forearms. Left hip: a Persian shamshir sword. Heavy leather riding boots. Mighty Persian warrior hero commanding wide stance.
```

**Shirin (ID: 92):**
```
Persian princess warrior, face fully hidden behind an ornate golden face-veil — a delicate golden chainmail veil (rouband) suspended from a crescent moon diadem crown, the golden mesh cascading over the entire face like a curtain of tiny gold links, no face visible. The crescent moon diadem with pearl drops at the temples. Flowing black hair with gold ornamental pins visible from the sides and back. Ornate Persian silk dress in deep crimson with gold brocade rose garden vine motifs. An armored bodice of gilded scale mail over the dress. A jeweled Persian shamshir scimitar at the left hip. Gold arm bands and stacked gold bangles on both wrists. Embroidered silk slippers with pointed toes. Graceful yet strong royal Persian princess warrior upright stance.
```
 Golden (ID: 204):**
```
Golden paladin champion, face fully hidden behind a gleaming gold-plated full great helm — a cylindrical flat-top helm with a narrow cross-shaped vision slit, entirely gold-plated with engraved sun-ray patterns radiating from the vision slit, no face visible. A golden halo of light hovering behind the helmet. Gleaming gold-plated full plate armor with engraved sun ray line patterns. A flowing white cape with a large golden sun emblem on the back. Golden winged helmet crest — two small gold wings at the temples. Right hand wielding a radiant golden greatsword that glows with warm golden light, crossguard shaped like outspread wings. Holy golden aura radiating outward. Golden sabatons. Righteous divine champion wide stance, greatsword held vertically.
```

**Bjorn Ironforge (ID: 210):**
```
Norse master blacksmith, face fully hidden behind a riveted iron smith's visor-mask — a heavy iron half-face mask (covering nose, mouth, chin) with a breathing grate, combined with heavy iron-framed smith's goggles with dark smoked-glass lenses, strapped over a leather head-wrap, no face visible. Massive muscular build. Heavy leather blacksmith apron over bare scarred chest. Right hand wielding an enormous forge hammer. Left hand holding iron tongs gripping a glowing orange-hot iron bar. Braided red beard (the only human feature) with iron rings braided in, emerging from below the face mask. Soot-covered skin on bare arms with burn scars. Iron arm bands. A leather belt with forge tools. Heavy leather boots with iron toe caps. Proud master smith standing stance, hammer on shoulder.
```

**Astrid Stormcaller (ID: 211):**
```
Viking shieldmaiden with lightning magic, face fully hidden behind a Viking spectacle helm — domed iron helmet with wide circular eye guards, prominent nose guard, and a chainmail aventail hanging from the lower edge covering jaw, neck, and chin, only darkness visible within the spectacle rings. Braided blonde hair with rune-carved bone beads visible from the back in two thick braids. Chainmail armor with fur trim over a blue tunic. A round Viking shield on the back with a lightning bolt rune (sowilo). Right hand gripping a spear crackling with white-blue electricity. Lightning bolt war paint in blue on the helmet exterior. A faint storm cloud aura above. Leather belt with a seax knife. Fur-lined boots. Fierce stormborn warrior wide stance, spear thrust forward.
```

**Ragnar Bloodaxe (ID: 212):**
```
Viking berserker warlord, face fully concealed behind a snarling wolf-head helm — an iron helmet topped with a full wolf's head, the wolf's open mouth forming the visor with iron fangs, the interior covered by a riveted iron face plate with narrow eye slits, no face visible inside the wolf's jaws. Wild braided dark hair with bone ornaments from the back and sides. Bare-chested with runic tattoos — dark blue Elder Futhark symbols covering chest, shoulders, and arms, with battle scars. A wolf pelt cloak over both shoulders. Right hand wielding a blood-red great axe — massive bearded axe with blade stained dark red. Leather pants with iron studs. Berserker rage aura — faint red mist rising from the body. Fur-wrapped leather boots. Savage attacking forward-lunge stance, axe raised overhead.
```

**Maeve of Ulster (ID: 220):**
```
Celtic warrior queen, face fully hidden behind an ornate bronze Celtic war mask — smooth polished bronze face plate with stylized La Tene art style features: spiral knotwork on cheeks, prominent brow ridge, narrow eye slits, thin sculpted lips, all clearly metallic. The mask attached to a bronze conical helmet with curved horn extensions. Flowing red hair cascading from under the helmet to the shoulders — fiery orange-red, the primary identifier. Bronze Celtic armor with spiral and triple-spiral knotwork on the breastplate. A flowing green Celtic cloak with a large gold Celtic penannular brooch. Right hand wielding a spear with a leaf-shaped bronze blade. Left arm carrying a round Celtic shield with the triple spiral (triskelion) emblem. A heavy gold torque necklace. Gold arm rings. Commanding queen warrior wide stance.
```

**Marcus Aurelius Maximus (ID: 230):**
```
Roman legionnaire centurion, face fully hidden behind an Imperial Italic helmet with full cheek guards closed and a deep brow ridge casting the eyes into shadow, plus a chainmail aventail covering throat and chin — broad cheek plates overlap at center, leaving only a narrow dark gap at eye level. A transverse red horsehair crest (sideways) marking centurion rank. Polished lorica segmentata armor over a red tunic. Right hand gripping a gladius in thrust position. Left arm carrying a large rectangular scutum with a golden eagle SPQR design. A vine staff (vitis) tucked into the belt. Red cloak at the right shoulder. Leather caligae with bronze greaves. Phalerae harness — decorative bronze medallions on leather straps across the chest. Disciplined Roman officer at-attention stance.
```

**Akira Steelblossom (ID: 240):**
```
Japanese samurai with cherry blossom motif, face fully hidden behind a black-and-pink lacquered menpo (full lower-face mask with fierce snarling mouth, painted with cherry blossom petals) combined with a samurai kabuto helmet with wide iron brim, five-plate shikoro neck guard, and a cherry blossom branch maedate (front crest), together covering the entire face, only a narrow shadow at the eye line. Black lacquered samurai armor with cherry blossom petal engravings in pink lacquer. Right hand wielding a katana in mid-level guard (chudan-no-kamae), tsuba shaped like a cherry blossom flower. Cherry blossom petals falling slowly around the figure. A pink silk scarf on the left upper arm. A wakizashi at the left hip. Focused calm elegant samurai draw stance.
```

**Li Wei the Prosperous (ID: 241):**
```
Chinese merchant scholar, face fully hidden beneath a wide merchant's hat — a broad circular straw hat (douli) with silk canopy, tilted forward covering the entire face, combined with a high silk collar rising to meet the hat brim, only deep shadow where the face should be. Rich silk merchant robes in deep green with gold cloud-pattern embroidery. Right hand holding a jade-beaded abacus at chest height. A long thin beard visible below the hat shadow. Multiple coin strings (square-holed Chinese coins on red cord) hanging from the belt. A scroll case on the back. A jade pendant necklace. Silk shoes with upturned toes. A small bronze weight scale at the belt. Prosperous wealthy wise merchant standing stance, abacus presented.
```

**Khalid the Warrior (ID: 250):**
```
Arabian desert warrior knight, face fully hidden behind a white and gold keffiyeh headwrap — wound tightly around the head and pulled across the entire face, secured with a gold agal, leaving only a narrow band of deep shadow at the eye line. A black cloth layer underneath covers any gaps. Damascus steel chainmail hauberk over flowing white desert robes. Right hand wielding a curved scimitar raised in striking pose — Damascus steel blade with gold-inlaid guard. Leather arm guards with gold studs. A sand-colored desert cloak billowing to one side. A leather belt with a curved dagger in an ornate sheath. Simple leather riding boots. Determined fierce desert warrior forward-leaning stance, scimitar high.
```

**Rashid the Defender (ID: 251):**
```
Arabian fortress knight, face fully concealed behind a steel helmet with a chainmail face veil — a conical steel spangenhelm with a wide nose guard and a full curtain of riveted chainmail covering the entire face, jaw, and throat, only a narrow slit between nose guard and mail curtain. Heavy plate armor over chainmail over desert robes. Right hand holding a one-handed flanged mace. Left arm wielding a massive tower shield — nearly body-height, engraved with a fortress gate design in gold on dark blue. A golden desert headwrap visible under the helmet. Sand-worn armor. Heavy leather boots with iron plates. Immovable defensive wall warrior wide planted stance, tower shield forward.
```

**Omar the Orator (ID: 252):**
```
Arabian scholar diplomat, face fully hidden behind an ornate embroidered face veil — a rich deep blue silk veil with gold calligraphy (Kufic script patterns), covering everything from the nose down, combined with an ornate golden turban with a large sapphire at center front, the turban brim and veil leaving only a narrow shadow band at the eye line. Rich embroidered robes in white with deep blue panels and gold threadwork — intricate geometric Islamic patterns. Right hand extended in an eloquent speaking gesture. Left hand holding an elaborate scroll with visible calligraphy. Jeweled rings on three fingers. A trimmed beard visible below the veil — just the tip poking beneath the silk. Embroidered silk shoes. A leather book satchel at the hip. Wise dignified scholarly standing stance, scroll presented.
```

**Zara Moonblade (ID: 260):**
```
Elven-style rogue assassin, face fully hidden behind a dark leather half-mask (covering nose, cheeks, chin) combined with a deep dark hood pulled forward to shadow the eyes — only a narrow band of darkness at the eye line. Pointed ears (elf trait) protruding from the hood, the only "skin" visible. Sleek dark leather armor with crescent moon motifs stamped in silver. Both hands gripping twin crescent-shaped daggers — curved blades shaped like crescent moons. Silver-white hair in a tight braid from the back of the hood. A dark cloak with star-field pattern on the interior lining. A moonstone pendant at the throat, faintly glowing. Lithe agile build. Soft black leather boots. Acrobatic rogue combat stance, crouched, daggers crossed.
```

**Layla Goldweaver (ID: 261):**
```
Merchant princess artisan, face fully hidden behind a golden filigree face veil — ornate golden wire-mesh veil suspended from a golden headdress, covering the entire face like a screen of interlocking gold spirals, tiny gold coins dangling from the lower edge. The golden headdress has a central teardrop ruby and chains of gold coins at the temples. Elegant golden-threaded robes that shimmer — rich cream silk woven with gold thread. Both hands active: right hand holding a golden enchanted weaving shuttle, left hand extended with a thread of gold spiraling outward and winding around the fingers. Multiple gold bangles on both wrists, stacked high. Gold drop earrings visible below the headdress. Embroidered silk slippers. Graceful creative artisan standing stance, hands working golden thread.
```

**Vladimir Ironheart (ID: 270):**
```
Slavic heavy armored knight, face fully concealed behind a blackened iron full-face bascinet — a riveted black iron helmet with a pointed visor (hounskull style) closed and locked, entirely black iron, narrow horizontal eye slit, no face visible. Thick blackened iron full plate armor — every surface dark oxidized iron, matte black, heavy and imposing. A heart-shaped red enamel emblem riveted to the center of the breastplate — the only color. Right hand wielding a flanged iron mace. Left arm carrying a heavy iron heater shield with a single red heart emblem. A dark fur cloak (black bear fur) from the shoulders. Heavy iron sabatons. Unstoppable iron juggernaut warrior wide planted stance, mace raised.
```

**Boris the Mountain (ID: 271):**
```
Giant Slavic warrior, face fully hidden behind a massive rough-hewn wooden mask — a crudely carved oversized wooden face mask with simple features: two round eye holes (dark inside), a triangular nose, a wide rectangular mouth, all crude and primitive, strapped on with thick leather thongs. Towering massive build — significantly larger than other characters. An oversized wooden shield — round, taller than a normal person, thick oak planks with iron bands. Right hand wielding a tree-trunk sized wooden club — a literal uprooted young tree trunk. Thick fur cloak and vest over leather. Leather wraps on arms and legs. Massive leather boots. Wild bushy beard below the mask. Mountain of a man immovable wide stance, club on shoulder.
```

**Durin Ironpick (ID: 280):**
```
Dwarf miner warrior, face fully hidden behind a miner's helm with a full iron face guard — a rounded iron helmet with a mounted lantern (lit, warm yellow glow) on the crown, and a riveted iron face plate with breathing holes and narrow eye slits. Short stocky build — notably shorter and wider than other characters. Heavy mining leather armor with riveted iron plates. Right hand wielding a large iron pickaxe. A long braided brown beard emerging from below the face guard, braided into two thick plaits with gem-shaped clasps (tiny rubies and sapphires). A leather pouch at the belt spilling with rough gemstones. A mine cart wheel motif on the belt buckle. Heavy iron-toed leather boots. Sturdy underground miner planted wide stance, pickaxe over shoulder.
```

**Kai Tidecaller (ID: 281):**
```
Sea mage oceanic warrior, face fully hidden behind a barnacle-encrusted coral helm — a rounded helmet of fused coral and shell in blue-green, with a front face plate of smooth mother-of-pearl (iridescent, opaque) covering the entire face, narrow eye slits lined with small shells. Body armor of barnacle-and-coral-encrusted blue-green plates. Right hand wielding a staff topped with a swirling water orb — driftwood staff with a translucent blue sphere of spinning water. A seaweed cape — long strands of kelp hanging from the shoulders. A shell crown at the top of the helmet. A trident insignia on the chest plate. Left hand extended with floating water droplets. Ocean-blue skin on the visible hands. Heavy waterlogged boots wrapped with kelp. Calm ocean caster standing stance, staff planted.
```

**Hana Luckbringer (ID: 290):**
```
Lucky charm priestess, face fully hidden behind a smiling porcelain fortune mask — a smooth rounded porcelain mask with a lucky-cat (maneki-neko) inspired design: painted crescent-moon eyes, a small painted smile, rosy circles on cheeks, clearly a decorative mask. A flower crown of daisies, clovers, and wildflowers on the head. Bright green and white robes with four-leaf clover patterns. Right hand wielding a staff topped with a golden four-leaf clover, glowing faint gold. A horseshoe pendant (gold, open end up) on a chain. Dice (two golden dice showing sixes) and coins woven into the belt on small chains. Green ribbons at the wrists and ankles. Simple green leather shoes. Playful good-fortune blessing stance, staff raised.
```

##### Common Starters

**Roman Centurion (ID: 1):**
```
Basic Roman legionnaire soldier, face fully hidden behind a standard-issue Imperial Gallic helmet with broad cheek guards closed and a deep brow guard — cheek guards overlap below the chin, nose guard descends to mid-face, chainmail aventail covers the throat, only a narrow dark slit at the eye line. No crest (rank-and-file). Standard lorica segmentata armor over a simple red tunic. Right hand gripping a gladius, blade forward. Left arm carrying a rectangular red scutum with a simple iron boss. A pilum javelin strapped across the back. Leather caligae with iron hobnails. Bronze greaves. Simple leather belt (cingulum) with hanging leather strips. Basic disciplined soldier at-attention stance.
```

**Viking Raider (ID: 2):**
```
Basic Viking warrior, face fully hidden behind a simple conical nasal helmet — iron helm with a prominent nose guard extending down to cover nose and upper lip, combined with a short chainmail curtain covering cheeks, jaw, and chin, only darkness visible at eye level. Simple chainmail byrnie over rough brown wool tunic. Left arm holding a round wooden shield with iron central boss, no painted design. Right hand wielding a single-handed bearded axe. Fur-trimmed leather boots, cross-laced. Simple leather belt with a small pouch. No cloak. Basic aggressive Viking warrior forward-leaning stance, axe raised, shield presented.
```

**Silk Road Merchant (ID: 3):**
```
Traveling merchant trader, face fully hidden beneath a wide-brimmed straw traveler's hat — oversized circular hat tilted forward, combined with a dust cloth pulled across the entire lower face and tucked under the hat brim, only deep shadow at the eye line. Simple layered traveler robes in earth tones — tan outer robe over brown inner tunic, well-worn and dusty. A leather satchel bag across the chest. A coin purse at the belt. Right hand gripping a tall wooden walking staff. Dusty leather boots. A small wrapped bundle strapped to the upper back. A small brass bell on the satchel strap. Simple rope belt. Hopeful merchant traveler walking stance, mid-stride.
```

**Wandering Ronin (ID: 4):**
```
Simple masterless samurai, face fully hidden beneath a large wide straw kasa hat — oversized circular straw hat (3x head width) tilted forward covering the entire face in deep shadow, combined with a dark cloth wrap across the lower face (nose to chin, tucked under hat ties), leaving only total darkness. Plain worn dark indigo kimono with frayed edges and faded patches. A simple rough rope belt (obi). A single katana in a plain dark wooden scabbard at the left hip. Wooden sandals (waraji) on bare feet. No armor — just cloth. Left hand resting on the katana's tsuba. Right hand hanging at the side. Mysterious lone wanderer calm standing stance, perfectly still, head slightly bowed.
```

---

### NPC Prompts (Meshy text-to-3D)

Use generic medieval villager style. These are background characters seen at distance so keep them simple. **NPCs also have no visible faces** — use simple hoods, hats, or helmets.

**Style prefix for all NPCs:**
```
stylized low-poly medieval fantasy villager, simple design, hand-painted textures,
soft warm colors, game-ready NPC character, clean topology, rigged for animation,
isometric top-down view, face hidden by hat or hood or helmet
```

**Worker (Type 0):**
```
[NPC prefix]. Medieval peasant worker, face hidden under a wide-brimmed leather work hat tilted forward and a cloth wrap over the lower face. Brown linen tunic, leather tool belt with hammer and nails, simple leather boots, rolled up sleeves, sturdy build, carrying wooden plank on shoulder.
```

**Fisher (Type 1):**
```
[NPC prefix]. Medieval fisherman, face hidden under a deep wide straw hat and a linen neck wrap pulled up over the chin. Blue linen vest over white shirt, rolled up pants, bare feet, holding long wooden fishing rod, wicker fish basket on back.
```

**Soldier (Type 2):**
```
[NPC prefix]. Medieval foot soldier, face hidden behind a simple iron kettle helmet with nose guard and chainmail aventail covering the lower face. Green gambeson padded armor, wielding wooden spear, small round shield on back, leather boots.
```

**Scholar (Type 3):**
```
[NPC prefix]. Medieval monk scholar, face hidden in shadow beneath a deep dark blue hood pulled far forward. Dark blue hooded robes, holding leather-bound book, quill behind ear, ink-stained fingers, sandals.
```

**Merchant (Type 4):**
```
[NPC prefix]. Medieval market merchant, face hidden under a wide merchant's cap and a cloth face wrap over the lower face. Gold-brown vest over white shirt, coin pouch at belt, weighing scales in hand, leather apron.
```

**Smith (Type 5):**
```
[NPC prefix]. Medieval blacksmith, face hidden behind heavy smith's goggles with dark lenses and a thick leather face guard covering nose and mouth. Brown leather apron over bare arms, soot on skin, wielding small forge hammer, tongs in belt, muscular build, leather gloves.
```

**Monk (Type 6):**
```
[NPC prefix]. Medieval temple monk, face hidden in deep shadow beneath a large purple hood pulled far forward, hands clasped so sleeves cover everything. Purple hooded robes with rope belt, prayer bead necklace, bare sandals, peaceful posture.
```

**Guard (Type 7):**
```
[NPC prefix]. Medieval town guard, face hidden behind an iron kettle helmet with full cheek guards and a chainmail aventail. Gray chain mail over dark tunic, simple sword at hip, round shield on back, standing at attention.
```

**Gladiator (Type 8):**
```
[NPC prefix]. Medieval arena gladiator, face hidden behind a bronze gladiator helmet with a full face grate and small eye holes. Leather armor on one shoulder, bare chest, wielding short trident, small round buckler, leather sandals, muscular build.
```

**Citizen (Type 9):**
```
[NPC prefix]. Medieval townsperson citizen, face hidden under a simple cloth hood pulled forward and a scarf wrapped over the lower face. Simple earth-tone tunic and pants, leather belt, cloth shoes, carrying bread basket.
```

**Stargazer (Type 10):**
```
[NPC prefix]. Medieval astronomer, face hidden in shadow beneath a tall pointed scholar cap tilted forward and a dark cloth across the lower face. Dark teal robes with star patterns, holding small brass telescope, star chart scroll in belt, looking upward.
```

**Visitor (Type 11):**
```
[NPC prefix]. Medieval traveling visitor, face hidden in deep shadow beneath a red hooded cloak pulled forward over the face. Red hooded cloak over traveling clothes, leather backpack, walking stick, dusty boots.
```

---

### Animal Prompts (Meshy text-to-3D)

```
stylized low-poly medieval fantasy, hand-painted textures, soft colors, game-ready animal, clean topology, rigged for animation, isometric top-down view
```

**Bird:**
```
[Animal prefix]. Small songbird, round plump body with spread wings in mid-flap, short forked tail feathers, tiny pointed beak, brown and cream plumage with darker wing tips, bright orange breast patch, two small black bead eyes, thin twig-like legs with three-toed feet, perched-on-branch pose with wings extended upward.
```

**Chicken:**
```
[Animal prefix]. Farm chicken hen, round plump oval body, small bright red comb on top of head and red wattle beneath beak, brown-white speckled feathers across the body with darker tail feathers curving downward, short yellow beak, two small round eyes, bright yellow scaly feet with three forward toes and one rear spur, pecking-at-ground pose with head lowered and one foot slightly forward.
```

**Horse:**
```
[Animal prefix]. Medieval farm horse, sturdy stocky build (draft horse proportions), warm chestnut-brown coat with dark brown-black mane and matching long tail. Simple leather saddle with stirrups, single leather bridle with iron bit. Four dark brown hooves, feathering at the fetlocks. Gentle expression with dark eyes. Calm standing pose with one rear hoof slightly cocked, head level.
```

**Fish:**
```
[Animal prefix]. River fish (trout-like), streamlined torpedo-shaped body, silver-gray scales with subtle iridescent sheen, darker gray-green back, lighter cream belly. Small round eye, slightly open mouth. Dorsal fin, two pectoral fins, anal fin, and forked tail fin — all with visible fin-ray lines. Medium size (roughly 30cm). Swimming pose with a slight S-curve, tail angled as if mid-stroke.
```

---

### Environment Props Prompts (Meshy text-to-3D)

```
stylized low-poly medieval fantasy prop, hand-painted textures, soft colors, game-ready asset, clean topology, single object, isometric top-down view
```

**Anvil:**
```
[Prop prefix]. Iron blacksmith anvil on an oak stump base. Classic London-pattern anvil shape — flat rectangular face on top, conical horn (beak) from one end, square heel at the other, narrow waist connecting to a heavy pyramidal base. Dark gray cast-iron color with hammer-strike dent marks on the face. Mounted on a thick oak tree-stump base (rough bark, smooth-cut flat top) roughly knee-height.
```

**Barrel:**
```
[Prop prefix]. Wooden wine barrel standing upright. Classic barrel shape — wider at the belly, narrower at top and bottom. Oak staves held together by three iron barrel hoops (top, middle, bottom) with visible rivets. A round wooden bung plug on the top-front face. Warm golden-brown wood, slightly darker staining near the bottom. Height roughly 90cm, belly diameter roughly 60cm.
```

**Crate:**
```
[Prop prefix]. Wooden shipping crate. Rectangular box of rough-sawn pine planks nailed together — visible iron nail heads at every joint. Rope handles on two short sides. Lid slightly ajar (lifted 3cm at one corner), revealing straw packing inside. Iron corner brackets on all eight corners. Faded ink stamp on one side. Size roughly 60cm x 40cm x 40cm.
```

**Cart:**
```
[Prop prefix]. Medieval horse-drawn merchant cart. Two large wooden spoked wheels (1m diameter) with iron tire rims on an iron axle. Open-top wooden bed (2m x 1m) with low side rails (30cm). Wooden yoke-and-shaft at the front. A pile of loose hay in the bed. One barrel and two small crates stacked. Weathered wood. No horse attached.
```

**Market Stall:**
```
[Prop prefix]. Medieval market vendor stall frame. Four corner posts (2.5m tall) supporting a peaked fabric canopy in faded red-and-cream stripes. A wide wooden counter across the front at waist height. A small hanging wooden sign board dangling from a chain. One hanging iron lantern from the center. Open on all sides except the back which has a canvas panel. Size roughly 3m x 2m.
```

**Well:**
```
[Prop prefix]. Medieval stone water well. Circular stone base (1.2m diameter, 80cm tall) of stacked gray river stones with mortar. A wooden A-frame crossbeam with rope-and-bucket pulley — hemp rope wound around a wooden windlass barrel with iron crank handle. A wooden bucket hanging at mid-height. A small thatched peaked roof over the crossbeam. Mossy green patches. A few ferns at the base.
```

**Lamp Post:**
```
[Prop prefix]. Medieval iron street lamp post. Wrought iron pole (2.5m tall) with twisted-vine pattern on the shaft, flared base plate on a square stone foundation. A hanging glass-and-iron lantern (hexagonal, four glass panes) with a visible candle emitting warm light. A short decorative iron bracket arm at the top. Dark iron with slight rust patina at the base.
```

**Training Dummy:**
```
[Prop prefix]. Medieval training dummy. A vertical wooden post (2m tall, 15cm diameter) with a horizontal cross-beam at shoulder height. A burlap sack body stuffed with straw, tied around the post at chest height — straw poking out from tears. A small round wooden shield target nailed to one arm. Visible sword slash marks on post, arms, and sack. The sack has a crude charcoal drawn face (two X eyes, straight line mouth). A wooden base plate for stability.
```

**Fountain:**
```
[Prop prefix]. Medieval stone town fountain. Tiered circular design — large lower basin (2m diameter, 40cm wall), medium middle basin (1m) elevated on a stone pedestal column, small top finial. A carved stone fish spout on the middle basin with water arcing into the lower basin. Aged gray stone with mossy patches. Carved vine patterns on basin rims. A few stone lily pads in the water. Cobblestone base pad (3m x 3m).
```

---

## Asset Count Summary

| Category | Count | Priority |
|----------|-------|----------|
| Building models (13 types x 4 tiers) | 52 | P0 |
| Hero character models | 80 | P0 (start with 4 starters, then batch by category) |
| Hero 2D card art / NFT portraits | 80 | P0 |
| NPC villager models | 12 | P1 |
| Animal models | 4 | P2 |
| Environment props | ~10 | P2 |
| Town layout elements | ~4 | P2 |
| **Total 3D models** | **~162** | |

### Recommended Production Order

1. **4 Common Starter heroes** — Roman Centurion, Viking Raider, Silk Road Merchant, Wandering Ronin
2. **13 buildings Tier 1 (Foundation)** — one per type, get the pipeline working
3. **12 Historical + 8 top Mythological heroes** — high-demand characters
4. **13 buildings Tier 2-4** — fill out remaining tiers
5. **Remaining heroes** — batch by category
6. **12 NPCs** — replace cone+sphere primitives
7. **Props, animals, environment** — polish pass

---

## Integration Steps

### 1. Add GLTFLoader

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);
```

### 2. Asset Directory Structure

```
terrain-builder/
  assets/
    buildings/
      mansion-t1.glb
      mansion-t2.glb
      mansion-t3.glb
      mansion-t4.glb
      barracks-t1.glb
      ...
    heroes/
      portraits/
        alexander.png
        caesar.png
        ...
      models/
        alexander.glb
        caesar.glb
        ...
    npcs/
      worker.glb
      soldier.glb
      ...
    animals/
      bird.glb
      chicken.glb
      horse.glb
      fish.glb
    props/
      anvil.glb
      barrel.glb
      cart.glb
      ...
    environment/
      fountain.glb
      gate.glb
      ...
```

### 3. Naming Convention

```
{type}-t{tier}.glb               # buildings: mansion-t1.glb
{name-kebab}.glb                  # heroes: alexander-the-great.glb
{type-kebab}.glb                  # npcs: town-guard.glb
{name-kebab}.glb                  # props: market-stall.glb
```

### 4. Model Loading Pattern

Replace `createBuildingMesh()` in `BuildingFactory.js` to load `.glb` instead of building procedural geometry. Keep the procedural fallback for cases where models haven't loaded yet.

---

## Modeling Guidelines

1. **Y-up coordinate system** (Three.js default, matches glTF spec)
2. **Apply all transforms** in Blender before export (Ctrl+A > All Transforms)
3. **Name mesh nodes** descriptively — the code uses `traverse()` to find named parts like `'window'`, `'flag'`, `'particle-chimney'`, `'particle-forge-fire'`
4. **Add empty nodes** as particle/effect anchors (e.g., `particle-chimney` at chimney top for smoke)
5. **Use instanced geometry** where possible — the renderer already uses `InstancedMesh` for NPCs, animals, grass, and flowers
6. **Isometric optimization** — the game uses a fixed isometric camera (~45° top-down). Focus polygon budget and texture detail on roofs, tops, and front-facing surfaces. Backs and undersides can be simplified or flat-shaded. Consider 2-3 LOD levels for buildings since the camera can zoom
7. **Draco compression** — compress all `.glb` files with Draco for smaller downloads
8. **Atlas textures** — pack multiple building textures into shared atlases to reduce draw calls