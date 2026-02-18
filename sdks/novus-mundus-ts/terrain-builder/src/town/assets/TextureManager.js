/**
 * TextureManager — Centralized PBR texture loading and caching.
 *
 * Loads full PBR texture sets (color, normal, roughness, AO, displacement,
 * metalness, emissive, opacity) from the texture pack directory and applies
 * them to Three.js MeshStandardMaterial instances.
 *
 * Sits between the raw texture files and the consumers (BuildingFactory,
 * BiomeShader, WaterSystem, TownRenderer).
 *
 * Three.js 0.170.0 — vanilla ES module.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Theme texture swaps — when a theme is active, resolve alternate packs
// ---------------------------------------------------------------------------

const THEME_SWAPS = {
  desert: {
    'grass-lush': 'ground-sand',
    'ground-dirt': 'ground-sand',
    'rock-cliff': 'rock-aerial-light',
    'roof-clay': 'roof-clay-warm',
  },
  snow: {
    'grass-lush': 'snow-fresh',
    'ground-dirt': 'snow-packed',
    'ground-sand': 'snow-packed',
  },
  swamp: {
    'grass-lush': 'ground-forest',
    'stone-wall': 'rock-mossy',
    'ground-dirt': 'ground-rocky',
  },
  volcanic: {
    'grass-lush': 'terrain-rocky-dark',
    'stone-wall': 'rock-aerial-dark',
    'ground-dirt': 'terrain-rocky-dark',
    'rock-cliff': 'terrain-rocky-light',
  },
  forest: {
    'ground-dirt': 'ground-forest',
    'grass-lush': 'grass-wild',
    'rock-cliff': 'rock-mossy',
  },
};

// ---------------------------------------------------------------------------
// Map type suffixes: packName-{suffix}.jpg
// ---------------------------------------------------------------------------

/** Core maps present in every pack */
const CORE_MAPS = {
  map:            'color',
  normalMap:      'normal',
  roughnessMap:   'roughness',
};

/** Extra maps — only loaded when explicitly requested via opts.extras */
const EXTRA_MAPS = {
  aoMap:          'ao',
  displacementMap:'displacement',
  metalnessMap:   'metalness',
  emissiveMap:    'emissive',
  alphaMap:       'opacity',
};

// ---------------------------------------------------------------------------
// TextureManager class
// ---------------------------------------------------------------------------

export class TextureManager {
  /**
   * @param {object} [options]
   * @param {string} [options.basePath='./src/town/assets/textures/'] - Root path to texture packs
   */
  constructor(options = {}) {
    this._basePath = options.basePath || './src/town/assets/textures/';
    this._loader = new THREE.TextureLoader();
    this._sets = new Map();   // packName → Promise<PBRSet>
    this._theme = null;
  }

  /**
   * Set the active theme for texture resolution.
   * @param {string|null} theme - 'desert', 'snow', 'swamp', 'volcanic', or null
   */
  setTheme(theme) {
    this._theme = theme;
  }

  /**
   * Resolve a pack name through theme swaps.
   * @param {string} packName
   * @param {string} [theme]
   * @returns {string}
   */
  resolveForTheme(packName, theme) {
    const t = theme || this._theme;
    if (!t || !THEME_SWAPS[t]) return packName;
    return THEME_SWAPS[t][packName] || packName;
  }

  /**
   * Load a full PBR texture set for a given pack name.
   * Returns an object with Three.js Texture instances keyed by material property:
   *   { map, normalMap, roughnessMap, aoMap, displacementMap, metalnessMap, emissiveMap, alphaMap }
   *
   * Missing maps are silently skipped (not every pack has every map type).
   * Results are cached — subsequent calls for the same pack return the same promise.
   *
   * @param {string} packName - e.g. 'grass-lush', 'wood-dark', 'lava-molten'
   * @param {object} [opts]
   * @param {number[]} [opts.repeat=[4,4]] - UV repeat
   * @param {boolean} [opts.useTheme=true] - Apply theme resolution
   * @param {string[]} [opts.extras] - Extra map types to load: 'metalness', 'emissive', 'opacity'
   * @returns {Promise<object>} PBR set: { map?, normalMap?, roughnessMap?, ... }
   */
  async loadPBRSet(packName, opts = {}) {
    const resolved = (opts.useTheme !== false)
      ? this.resolveForTheme(packName)
      : packName;

    if (this._sets.has(resolved)) return this._sets.get(resolved);

    const promise = this._doLoad(resolved, opts);
    this._sets.set(resolved, promise);
    return promise;
  }

  /** @private */
  async _doLoad(packName, opts) {
    const repeat = opts.repeat ?? [4, 4];
    const basePath = `${this._basePath}${packName}/${packName}`;

    // Build the map entries to load: always core, plus requested extras
    const entries = Object.entries(CORE_MAPS);
    if (opts.extras) {
      for (const key of opts.extras) {
        if (EXTRA_MAPS[key])        entries.push([key, EXTRA_MAPS[key]]);
        else if (EXTRA_MAPS[key + 'Map']) entries.push([key + 'Map', EXTRA_MAPS[key + 'Map']]);
        // Also accept suffix names directly: 'metalness' → metalnessMap
        else {
          for (const [prop, suffix] of Object.entries(EXTRA_MAPS)) {
            if (suffix === key) { entries.push([prop, suffix]); break; }
          }
        }
      }
    }

    const result = {};
    const promises = [];

    for (const [prop, suffix] of entries) {
      const path = `${basePath}-${suffix}.jpg`;
      promises.push(
        this._loadTexture(path)
          .then(tex => {
            if (tex) {
              tex.wrapS = THREE.RepeatWrapping;
              tex.wrapT = THREE.RepeatWrapping;
              tex.repeat.set(repeat[0], repeat[1]);
              tex.generateMipmaps = true;
              tex.minFilter = THREE.LinearMipmapLinearFilter;
              tex.magFilter = THREE.LinearFilter;
              // Color and emissive maps are sRGB; all others are linear data
              tex.colorSpace = (prop === 'map' || prop === 'emissiveMap')
                ? THREE.SRGBColorSpace
                : THREE.LinearSRGBColorSpace;
              result[prop] = tex;
            }
          })
          .catch(() => {}) // Skip missing maps silently
      );
    }

    await Promise.all(promises);
    return result;
  }

  /** @private — load a single texture, returning null on failure */
  _loadTexture(path) {
    return new Promise((resolve) => {
      this._loader.load(
        path,
        (tex) => resolve(tex),
        undefined,
        () => resolve(null),
      );
    });
  }

  /**
   * Load a single named texture (not a full PBR set).
   * Useful for water normals, noise maps, etc.
   *
   * @param {string} path - Relative path from basePath (or absolute)
   * @param {object} [opts]
   * @param {number[]} [opts.repeat]
   * @param {string} [opts.colorSpace='linear']
   * @returns {Promise<THREE.Texture|null>}
   */
  async loadSingle(path, opts = {}) {
    const fullPath = path.startsWith('.') || path.startsWith('/')
      ? path
      : `${this._basePath}${path}`;

    const tex = await this._loadTexture(fullPath);
    if (!tex) return null;

    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = opts.colorSpace === 'srgb'
      ? THREE.SRGBColorSpace
      : THREE.LinearSRGBColorSpace;

    return tex;
  }

  /**
   * Apply a loaded PBR set to a MeshStandardMaterial.
   *
   * @param {THREE.MeshStandardMaterial} material
   * @param {object} pbrSet - Result from loadPBRSet()
   * @param {object} [opts]
   * @param {number} [opts.tint] - Optional color tint (multiplied with diffuse map)
   * @param {boolean} [opts.displacement=false] - Enable displacement mapping
   * @param {number} [opts.displacementScale=0.02] - Displacement scale
   * @param {number} [opts.emissiveIntensity=1.0] - Emissive intensity
   * @param {number} [opts.normalScale=1.0] - Normal map strength
   */
  applyToMaterial(material, pbrSet, opts = {}) {
    if (!pbrSet) return;

    if (pbrSet.map) material.map = pbrSet.map;
    if (pbrSet.normalMap) {
      material.normalMap = pbrSet.normalMap;
      const ns = opts.normalScale ?? 1.0;
      material.normalScale = new THREE.Vector2(ns, ns);
    }
    if (pbrSet.roughnessMap) {
      material.roughnessMap = pbrSet.roughnessMap;
      material.roughness = 1.0; // Let the map drive roughness fully
    }
    if (pbrSet.aoMap) {
      material.aoMap = pbrSet.aoMap;
    }
    if (pbrSet.displacementMap && opts.displacement) {
      material.displacementMap = pbrSet.displacementMap;
      material.displacementScale = opts.displacementScale ?? 0.02;
    }
    if (pbrSet.metalnessMap) {
      material.metalnessMap = pbrSet.metalnessMap;
      material.metalness = 1.0; // Let the map drive metalness fully
    }
    if (pbrSet.emissiveMap) {
      material.emissiveMap = pbrSet.emissiveMap;
      material.emissive = new THREE.Color(0xffffff);
      material.emissiveIntensity = opts.emissiveIntensity ?? 1.0;
    }
    if (pbrSet.alphaMap) {
      material.alphaMap = pbrSet.alphaMap;
      material.transparent = true;
    }
    if (opts.tint != null) {
      material.color.set(opts.tint);
    }

    material.needsUpdate = true;
  }

  /**
   * Create a new MeshStandardMaterial with a PBR set already applied.
   *
   * @param {object} pbrSet - Result from loadPBRSet()
   * @param {object} [opts] - Same as applyToMaterial opts, plus standard material props
   * @returns {THREE.MeshStandardMaterial}
   */
  createMaterial(pbrSet, opts = {}) {
    const m = new THREE.MeshStandardMaterial({
      color: opts.tint ?? 0xffffff,
      roughness: opts.roughness ?? 0.8,
      metalness: opts.metalness ?? 0,
      side: opts.side ?? THREE.FrontSide,
    });
    this.applyToMaterial(m, pbrSet, opts);
    return m;
  }

  /**
   * Preload a batch of texture packs in parallel.
   *
   * @param {string[]} packNames
   * @param {object} [opts] - Shared options for all packs
   * @returns {Promise<Map<string, object>>} Map of packName → PBR set
   */
  async preloadBatch(packNames, opts = {}) {
    const entries = await Promise.all(
      packNames.map(async (name) => {
        const set = await this.loadPBRSet(name, opts);
        return [name, set];
      })
    );
    return new Map(entries);
  }

  /**
   * Dispose all cached textures.
   */
  dispose() {
    for (const [, promise] of this._sets) {
      // Resolve and dispose each texture set
      Promise.resolve(promise).then(set => {
        if (set) {
          for (const tex of Object.values(set)) {
            if (tex && tex.dispose) tex.dispose();
          }
        }
      });
    }
    this._sets.clear();
  }
}
