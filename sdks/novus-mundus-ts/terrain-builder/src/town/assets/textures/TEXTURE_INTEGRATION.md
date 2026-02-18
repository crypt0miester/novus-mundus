# Texture Integration Plan

How to wire the texture packs in `assets/textures/` into the existing renderer.

**Current state:** Everything uses flat hex colors or procedural shaders. The `AssetLoader` and `AssetManifest` infrastructure already exists but all texture paths are placeholders pointing to files that don't exist. The textures now exist — they just need to be connected.

---

## Phase 1: AssetManifest + TextureManager

**Goal:** Create a centralized texture loading layer that the rest of the codebase can pull from.

### 1a. Update AssetManifest.js texture entries

Replace placeholder paths with actual texture pack paths. Each material needs multiple maps.

```javascript
// AssetManifest.js — textures section
// BEFORE:
grass_diffuse: { path: 'textures/grass_diffuse.png', ... },
grass_normal:  { path: 'textures/grass_normal.png', ... },

// AFTER — one entry per pack, multiple maps:
grass_lush: {
  maps: {
    color:        'textures/grass-lush/grass-lush-color.jpg',
    normal:       'textures/grass-lush/grass-lush-normal.jpg',
    roughness:    'textures/grass-lush/grass-lush-roughness.jpg',
    ao:           'textures/grass-lush/grass-lush-ao.jpg',
    displacement: 'textures/grass-lush/grass-lush-displacement.jpg',
  },
  wrapS: 'repeat',
  wrapT: 'repeat',
  minFilter: 'linearMipmapLinear',
  magFilter: 'linear',
  generateMipmaps: true,
},
```

### 1b. Add a TextureManager helper

Sits between `AssetLoader` and the consumers. Loads a full PBR set in one call and configures wrapping/filtering.

```javascript
// TextureManager.js (new file in assets/)

import * as THREE from 'three';

export class TextureManager {
  constructor(assetLoader) {
    this._loader = assetLoader;
    this._sets = new Map(); // cache: packName -> { map, normalMap, ... }
  }

  /**
   * Load a full PBR texture set for a given pack name.
   * Returns { map, normalMap, roughnessMap, aoMap, displacementMap, ... }
   * with all THREE.Texture objects configured for tiling.
   */
  async loadPBRSet(packName, opts = {}) {
    if (this._sets.has(packName)) return this._sets.get(packName);

    const basePath = `textures/${packName}/${packName}`;
    const repeat = opts.repeat ?? [4, 4];

    const mapTypes = {
      map:             `${basePath}-color.jpg`,
      normalMap:        `${basePath}-normal.jpg`,
      roughnessMap:     `${basePath}-roughness.jpg`,
      aoMap:            `${basePath}-ao.jpg`,
      displacementMap:  `${basePath}-displacement.jpg`,
      metalnessMap:     `${basePath}-metalness.jpg`,
      emissiveMap:      `${basePath}-emissive.jpg`,
      alphaMap:         `${basePath}-opacity.jpg`,
    };

    const result = {};
    const promises = [];

    for (const [prop, path] of Object.entries(mapTypes)) {
      promises.push(
        this._loader.load(path, 'textures', { path })
          .then(tex => {
            if (tex) {
              tex.wrapS = THREE.RepeatWrapping;
              tex.wrapT = THREE.RepeatWrapping;
              tex.repeat.set(repeat[0], repeat[1]);
              tex.colorSpace = (prop === 'map' || prop === 'emissiveMap')
                ? THREE.SRGBColorSpace
                : THREE.LinearSRGBColorSpace;
              result[prop] = tex;
            }
          })
          .catch(() => {}) // Skip missing maps (e.g. ao, metalness)
      );
    }

    await Promise.all(promises);
    this._sets.set(packName, result);
    return result;
  }

  /**
   * Apply a loaded PBR set to a MeshStandardMaterial.
   * Optionally tint with a color (multiplied with the diffuse map).
   */
  applyToMaterial(material, pbrSet, opts = {}) {
    if (pbrSet.map)             material.map = pbrSet.map;
    if (pbrSet.normalMap)       material.normalMap = pbrSet.normalMap;
    if (pbrSet.roughnessMap)    material.roughnessMap = pbrSet.roughnessMap;
    if (pbrSet.aoMap)           material.aoMap = pbrSet.aoMap;
    if (pbrSet.displacementMap && opts.displacement) {
      material.displacementMap = pbrSet.displacementMap;
      material.displacementScale = opts.displacementScale ?? 0.02;
    }
    if (pbrSet.metalnessMap)    material.metalnessMap = pbrSet.metalnessMap;
    if (pbrSet.emissiveMap) {
      material.emissiveMap = pbrSet.emissiveMap;
      material.emissive = new THREE.Color(0xffffff);
      material.emissiveIntensity = opts.emissiveIntensity ?? 1.0;
    }
    if (opts.tint) material.color.set(opts.tint);
    material.needsUpdate = true;
  }
}
```

---

## Phase 2: BuildingFactory.js

**Goal:** Replace flat-color materials with textured PBR materials.

### 2a. Modify `mat()` to accept texture sets

The `mat()` function currently only takes a hex color. Extend it to optionally accept a PBR set.

```javascript
// BuildingFactory.js — modified mat() function

function mat(color, opts = {}) {
  const key = /* existing key logic + */ `${opts.texturePack || ''}`;
  if (MAT_CACHE.has(key)) return MAT_CACHE.get(key);

  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.8,
    metalness: opts.metalness ?? 0,
    // ... existing props ...
  });

  // If a PBR set was provided, apply it
  if (opts.pbr) {
    if (opts.pbr.map)          m.map = opts.pbr.map;
    if (opts.pbr.normalMap)    m.normalMap = opts.pbr.normalMap;
    if (opts.pbr.roughnessMap) m.roughnessMap = opts.pbr.roughnessMap;
    if (opts.pbr.aoMap)        m.aoMap = opts.pbr.aoMap;
    // When using a roughnessMap, set base roughness to 1.0 so
    // the map drives it fully
    if (opts.pbr.roughnessMap) m.roughness = 1.0;
    if (opts.pbr.metalnessMap) { m.metalnessMap = opts.pbr.metalnessMap; m.metalness = 1.0; }
  }

  MAT_CACHE.set(key, m);
  return m;
}
```

### 2b. Modify `tierMaterials()` to use texture packs

Receives a preloaded texture map from the caller (TownRenderer).

```javascript
// BuildingFactory.js — modified tierMaterials()

function tierMaterials(tier, textures) {
  // textures = Map<string, PBRSet> from TextureManager
  if (!textures) return tierMaterialsFallback(tier); // existing flat-color fallback

  if (tier <= 1) return {
    wall:   mat(0xffffff, { pbr: textures.get('wood-dark') }),
    roof:   mat(0xffffff, { pbr: textures.get('roof-thatch') }),
    floor:  mat(0xffffff, { pbr: textures.get('stone-rubble') }),
    accent: mat(0xffffff, { pbr: textures.get('wood-aged') }),
  };

  if (tier === 2) return {
    wall:   mat(0xffffff, { pbr: textures.get('brick-classic') }),
    roof:   mat(0xffffff, { pbr: textures.get('roof-clay') }),
    floor:  mat(0xffffff, { pbr: textures.get('stone-cobble') }),
    accent: mat(0xffffff, { pbr: textures.get('wood-dark') }),
    upper:  mat(0xffffff, { pbr: textures.get('plaster-white') }),
  };

  if (tier === 3) return {
    wall:   mat(0xffffff, { pbr: textures.get('wall-stone-clean') }),
    roof:   mat(0xffffff, { pbr: textures.get('roof-slate') }),
    floor:  mat(0xffffff, { pbr: textures.get('stone-medieval') }),
    accent: mat(0xffffff, { pbr: textures.get('stone-rubble') }),
    trim:   mat(0xffffff, { pbr: textures.get('metal-gold-worn'), metalness: 0.8 }),
  };

  // Tier 4 — Legendary
  return {
    wall:   mat(0xffffff, { pbr: textures.get('stone-marble') }),
    roof:   mat(0xffffff, { pbr: textures.get('roof-slate'), metalness: 0.1 }),
    floor:  mat(0xffffff, { pbr: textures.get('stone-marble') }),
    accent: mat(0xffffff, { pbr: textures.get('metal-gold-polished'), metalness: 0.8 }),
    trim:   mat(0xffffff, { pbr: textures.get('metal-gold-polished'), metalness: 0.8, roughness: 0.2 }),
    glow:   mat(0xffffff, { emissive: 0xffeebb, emissiveIntensity: 0.5 }),
  };
}
```

### 2c. Building-specific texture overrides

Some buildings need different textures than their tier default. Handle via an override map.

```javascript
// Building-specific overrides per type+tier
const BUILDING_TEXTURE_OVERRIDES = {
  forge: {
    1: { floor: 'lava-ember' },         // ember pit instead of stone
    2: { wall: 'wall-block-rough' },
    3: { wall: 'wall-block-rough', floor: 'lava-ember' },
    4: { wall: 'stone-rubble', floor: 'lava-cooled', accent: 'lava-molten' },
  },
  citadel: {
    2: { wall: 'brick-castle-red' },
    3: { wall: 'wall-castle-mixed' },
    4: { wall: 'wall-castle-mixed' },
  },
  sanctuary: {
    2: { floor: 'rock-mossy' },
    3: { floor: 'rock-mossy', wall: 'wall-stone-clean' },
  },
  dock: {
    1: { floor: 'wood-floor' },
    2: { floor: 'wood-floor' },
    3: { floor: 'wood-floor' },
    4: { floor: 'wood-floor' },
  },
  arena: {
    2: { floor: 'ground-sand', wall: 'brick-castle-red' },
    3: { floor: 'ground-sand', wall: 'brick-castle-red' },
    4: { floor: 'ground-sand', wall: 'wall-castle-mixed' },
  },
  treasury: {
    3: { floor: 'stone-marble', wall: 'wall-stone-clean' },
    4: { floor: 'stone-marble', trim: 'metal-gold-polished' },
  },
};
```

### 2d. Fabric textures for flags/banners/tents

Apply fabric textures to the specific geometry elements.

```javascript
// In flagPole() — apply fabric-corduroy to the flag plane
function flagPole(h, flagW, flagH, flagColor, textures) {
  const g = new THREE.Group();
  // ... pole code ...

  const flagMat = textures?.get('fabric-corduroy')
    ? mat(flagColor, { pbr: textures.get('fabric-corduroy'), side: THREE.DoubleSide })
    : mat(flagColor, { side: THREE.DoubleSide });
  const flag = mk(new THREE.PlaneGeometry(flagW, flagH, 8, 4), flagMat, ...);
  // ...
}

// In buildBarracks tier 1 — apply fabric-canvas to tent
// In buildMarket — apply fabric-linen to awning planes
```

### 2e. UV considerations

The procedural geometry (BoxGeometry, CylinderGeometry, etc.) has default UV mapping. For tiled textures this works out of the box — the repeat value on the texture handles scaling. The only adjustment needed:

- Set `texture.repeat` based on geometry size so textures don't stretch
- For walls: `repeat.set(wallWidth / textureWorldSize, wallHeight / textureWorldSize)`
- A good default `textureWorldSize` for 1K building textures is ~0.1 world units per tile

```javascript
// Helper: scale texture repeat to match geometry size
function scaleUV(pbrSet, worldWidth, worldHeight, textureWorldSize = 0.1) {
  const rx = worldWidth / textureWorldSize;
  const ry = worldHeight / textureWorldSize;
  for (const tex of Object.values(pbrSet)) {
    if (tex instanceof THREE.Texture) {
      tex.repeat.set(rx, ry);
    }
  }
}
```

---

## Phase 3: Terrain (BiomeShader + TownTerrainBuilder)

**Goal:** Add texture detail to the procedural terrain shader.

### 3a. Approach: Texture splatting in BiomeShader

The BiomeShader already computes biome type per-fragment via elevation + moisture. Layer textures on top using a splat approach.

```glsl
// BiomeShader.js — fragment shader additions

uniform sampler2D uGrassColor;
uniform sampler2D uGrassNormal;
uniform sampler2D uDirtColor;
uniform sampler2D uStoneColor;
uniform sampler2D uSandColor;
uniform sampler2D uGravelColor;
uniform float uTextureScale;  // world-space tile size

void main() {
  // ... existing biome color computation ...
  vec3 biomeColor = /* existing procedural color */;

  // Sample textures in world space (triplanar for cliffs)
  vec2 uvWorld = vWorldPos.xz * uTextureScale;
  vec3 grassTex  = texture2D(uGrassColor, uvWorld).rgb;
  vec3 dirtTex   = texture2D(uDirtColor, uvWorld).rgb;
  vec3 stoneTex  = texture2D(uStoneColor, uvWorld).rgb;

  // Blend based on existing biome weights
  // elevation < 0.3 = grass, 0.3-0.6 = dirt, 0.6+ = stone
  float grassWeight = smoothstep(0.35, 0.25, elevation);
  float stoneWeight = smoothstep(0.55, 0.65, elevation);
  float dirtWeight  = 1.0 - grassWeight - stoneWeight;

  // Slope-based: steep = stone, flat = grass/dirt
  float slopeBlend = smoothstep(0.3, 0.7, slope);
  stoneWeight = max(stoneWeight, slopeBlend);
  grassWeight *= (1.0 - slopeBlend);

  vec3 terrainDetail = grassTex * grassWeight
                     + dirtTex  * dirtWeight
                     + stoneTex * stoneWeight;

  // Multiply with procedural biome color for final result
  // This preserves the biome tinting while adding texture detail
  gl_FragColor.rgb = biomeColor * terrainDetail * 2.0; // * 2.0 compensates for multiply darkening

  // ... existing fog, time-of-day, weather code ...
}
```

### 3b. Load terrain textures in TownRenderer

```javascript
// TownRenderer.js — during init

async _loadTerrainTextures() {
  const tm = this._textureManager;

  const [grass, dirt, stone, sand, gravel, rockCliff] = await Promise.all([
    tm.loadPBRSet('grass-lush',    { repeat: [20, 20] }),
    tm.loadPBRSet('ground-dirt',   { repeat: [20, 20] }),
    tm.loadPBRSet('stone-wall',    { repeat: [20, 20] }),
    tm.loadPBRSet('ground-sand',   { repeat: [20, 20] }),
    tm.loadPBRSet('ground-gravel', { repeat: [20, 20] }),
    tm.loadPBRSet('rock-cliff',    { repeat: [10, 10] }),
  ]);

  this._biomeMaterial.setTerrainTextures({
    grass: grass.map,
    dirt:  dirt.map,
    stone: stone.map,
    sand:  sand.map,
  });
}
```

### 3c. District ground textures

The `BUILDING_INFO[].ground` descriptions map to specific textures per district. Apply these as a ground overlay around buildings.

```javascript
// When placing a building, stamp its ground texture in a radius
// Use the building_ground_mapping from texture-map.json:
//   Market -> stone-cobble
//   Arena  -> ground-sand
//   Forge  -> terrain-rocky-dark (darkened)
//   etc.

// This can be done via the existing footprint system (FootprintSystem.js)
// which already supports render-to-texture stamping
```

---

## Phase 4: Water (WaterSystem.js)

**Goal:** Add authored normal maps to the Gerstner wave shader.

### 4a. Replace procedural noise with water normals

```javascript
// WaterSystem.js — in constructor or init

async loadWaterTextures(textureManager) {
  const basePath = 'textures/water-normal/';

  const [norm1, norm2] = await Promise.all([
    this._loader.load('water-normal-1', 'textures',
      { path: basePath + 'water-normal-1.jpg' }),
    this._loader.load('water-normal-2', 'textures',
      { path: basePath + 'water-normal-2.jpg' }),
  ]);

  for (const tex of [norm1, norm2]) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }

  this._material.uniforms.uWaterNormal1 = { value: norm1 };
  this._material.uniforms.uWaterNormal2 = { value: norm2 };
}
```

### 4b. Modify water fragment shader

```glsl
// WaterSystem.js — fragment shader additions

uniform sampler2D uWaterNormal1;
uniform sampler2D uWaterNormal2;
uniform float uTime;

vec3 getWaterNormal(vec2 worldUV) {
  // Scroll two normal maps at different speeds/directions
  vec2 uv1 = worldUV * 3.0 + vec2(uTime * 0.02, uTime * 0.01);
  vec2 uv2 = worldUV * 5.0 + vec2(-uTime * 0.015, uTime * 0.025);

  vec3 n1 = texture2D(uWaterNormal1, uv1).rgb * 2.0 - 1.0;
  vec3 n2 = texture2D(uWaterNormal2, uv2).rgb * 2.0 - 1.0;

  // Blend normals (UDN blending)
  return normalize(vec3(n1.xy + n2.xy, n1.z * n2.z));
}

// In main():
vec3 waterNorm = getWaterNormal(vWorldPos.xz);
// Mix with existing Gerstner-computed normal
normal = normalize(normal + waterNorm * 0.3);
```

---

## Phase 5: Skybox / Environment (TownRenderer.js)

**Goal:** Load HDRI skyboxes for scene environment and lighting.

### 5a. Load EXR HDRIs

```javascript
// TownRenderer.js — need to add EXRLoader
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

async _loadEnvironment() {
  const exrLoader = new EXRLoader();
  const pmremGenerator = new THREE.PMREMGenerator(this._renderer);

  const dayHDRI = await exrLoader.loadAsync(
    'assets/textures/hdri/hdri-day-clear.exr'
  );
  dayHDRI.mapping = THREE.EquirectangularReflectionMapping;

  this._envDay = pmremGenerator.fromEquirectangular(dayHDRI).texture;
  dayHDRI.dispose();

  // Set as scene environment (affects all PBR materials) and background
  this._scene.environment = this._envDay;
  this._scene.background = this._envDay;
}
```

### 5b. Day/night cycle

Crossfade between HDRIs based on `timeOfDay`.

```javascript
// Preload all 5 HDRIs into a map
this._envMaps = {
  morning: /* hdri-morning.exr */,
  dayClear: /* hdri-day-clear.exr */,
  dayCloudy: /* hdri-day-cloudy.exr */,
  dayWarm: /* hdri-day-warm.exr */,
  night: /* hdri-night.exr */,
};

// In update loop:
updateEnvironment(hour) {
  if (hour >= 5 && hour < 8)       this._scene.environment = this._envMaps.morning;
  else if (hour >= 8 && hour < 16)  this._scene.environment = this._envMaps.dayClear;
  else if (hour >= 16 && hour < 19) this._scene.environment = this._envMaps.dayWarm;
  else                               this._scene.environment = this._envMaps.night;
}
```

---

## Phase 6: Lava (Forge + Volcanic Theme)

**Goal:** Replace emissive color strips with authored lava textures.

### 6a. Lava material helper

```javascript
// In BuildingFactory.js or a shared material helpers file

function lavaMat(packName, pbrSet, intensity = 1.0) {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: pbrSet.map,
    normalMap: pbrSet.normalMap,
    roughnessMap: pbrSet.roughnessMap,
    emissiveMap: pbrSet.emissiveMap,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: intensity,
  });
  return m;
}

// Usage in buildForge():
// Tier 2-3: lavaMat('lava-ember', textures.get('lava-ember'), 0.8)
// Tier 4:   lavaMat('lava-molten', textures.get('lava-molten'), 1.5)
// Volcanic theme terrain: lavaMat('lava-cooled', textures.get('lava-cooled'), 0.5)
```

### 6b. Animated lava UV scroll

```javascript
// In the render loop, scroll lava UVs for flowing effect
// Store lava materials in a list and update each frame:
for (const lavaMat of this._lavaMaterials) {
  if (lavaMat.map) {
    lavaMat.map.offset.x += delta * 0.005;
    lavaMat.emissiveMap.offset.x += delta * 0.005;
  }
}
```

---

## Phase 7: Theme Swaps

**Goal:** When a theme (desert/snow/swamp/volcanic) is active, swap texture packs.

### 7a. Theme texture resolver

```javascript
// TextureManager.js — add theme-aware resolution

const THEME_SWAPS = {
  desert: {
    'grass-lush': 'ground-sand',
    'ground-dirt': 'ground-sand',
    'rock-cliff': 'rock-aerial-light',
  },
  snow: {
    'grass-lush': 'snow-fresh',
    'ground-dirt': 'snow-packed',
  },
  swamp: {
    'grass-lush': 'ground-dirt', // tinted dark in shader
    'stone-wall': 'rock-mossy',
  },
  volcanic: {
    'grass-lush': 'terrain-rocky-dark',
    'stone-wall': 'rock-aerial-dark',
    'ground-dirt': 'terrain-rocky-dark',
  },
};

resolveForTheme(packName, theme) {
  if (!theme || !THEME_SWAPS[theme]) return packName;
  return THEME_SWAPS[theme][packName] || packName;
}
```

---

## Loading Strategy

### Priority order (what to load first)

1. **CRITICAL** (visible immediately): Terrain textures (grass, dirt, stone), skybox HDRI
2. **HIGH** (visible in seconds): Tier-appropriate building textures for on-screen buildings
3. **NORMAL**: Remaining building tiers, water normals, district ground textures
4. **LOW**: Theme variant textures, lava, fabric details
5. **BACKGROUND**: Preload other HDRI variants, unused tier textures

### Memory budget

| Category | Packs | Maps/pack | 1K RGBA | With mipmaps | Total |
|----------|-------|-----------|---------|--------------|-------|
| Terrain (5) | 5 | 5 | 4 MB | 5.3 MB | ~27 MB |
| Buildings (active tier) | ~8 | 5 | 4 MB | 5.3 MB | ~42 MB |
| Water | 1 | 2 | 4 MB | 5.3 MB | ~11 MB |
| HDRI (current) | 1 | 1 | ~8 MB | N/A | ~8 MB |
| Lava + Fabric | ~4 | 5 | 4 MB | 5.3 MB | ~21 MB |
| **Total active** | | | | | **~109 MB** |

The AssetLoader's LRU cache is 64 MB by default. **Bump to 128 MB** to hold the active working set. Textures for inactive tiers and themes get evicted automatically.

### Fallback

If a texture fails to load, the existing flat-color materials still work. The `mat()` function just doesn't apply the PBR maps. This means:
- Works offline / without textures
- Graceful degradation on low-memory devices
- Can progressively enhance as textures stream in

---

## File changes summary

| File | Change type | What |
|------|------------|------|
| `assets/AssetManifest.js` | Update | Replace placeholder texture paths with real pack paths |
| `assets/TextureManager.js` | **New** | PBR set loader + applier helper |
| `buildings/BuildingFactory.js` | Modify | `mat()` accepts PBR sets, `tierMaterials()` uses them |
| `terrain/BiomeShader.js` | Modify | Add texture sampler uniforms, splat blending in fragment shader |
| `terrain/TownTerrainBuilder.js` | Minor | Pass textures to BiomeShader material |
| `terrain/WaterSystem.js` | Modify | Add water normal uniforms, dual-scroll blending |
| `TownRenderer.js` | Modify | Load HDRIs, init TextureManager, pass textures to subsystems |

Only **one new file** (TextureManager.js). Everything else is modifications to existing files.
