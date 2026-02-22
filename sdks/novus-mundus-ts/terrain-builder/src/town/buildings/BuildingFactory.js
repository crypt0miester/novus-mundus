/**
 * BuildingFactory — Procedural building mesh generator using modular kit pieces.
 *
 * 19 building types × 4 visual tiers (Foundation, Established, Grand, Legendary).
 * Each building is assembled from reusable modules: foundations, walls, roofs, accents.
 * Small random vertex displacement ("deformation") gives a hand-built medieval look.
 *
 * Geometry and material caches reduce GPU memory; static meshes are merged per-material
 * to cut draw calls. Animated/addressable meshes are excluded from merging.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ═══════════════════════════════════════════════════════
//  Seeded PRNG (mulberry32)
// ═══════════════════════════════════════════════════════

function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ═══════════════════════════════════════════════════════
//  Named Constants
// ═══════════════════════════════════════════════════════

const WALL_THICKNESS = 0.006;
const WINDOW_DEPTH = 0.008;
const BEAM_WIDTH = 0.004;
const BEAM_DEPTH = 0.008;
const DOOR_DEPTH = 0.008;
const PLATFORM_HEIGHT = 0.003;
const STILT_RADIUS_TOP = 0.004;
const STILT_RADIUS_BOTTOM = 0.005;
const FLAG_POLE_RADIUS = 0.002;
const DEFORM_AMOUNT = 0.003;

// ═══════════════════════════════════════════════════════
//  Material Palette
// ═══════════════════════════════════════════════════════

const MAT_CACHE = new Map();

// Shared snow uniform — all building materials reference this same object,
// so a single value update applies everywhere instantly.
const _snowUniform = { value: 0 };

/**
 * Inject snow accumulation into a MeshStandardMaterial via onBeforeCompile.
 * Snow blends to white on upward-facing surfaces, scaled by uSnowAmount.
 * Uses a single shared function reference so Three.js program caching works.
 */
function _onBeforeCompileSnow(shader) {
  shader.uniforms.uSnowAmount = _snowUniform;

  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    /* glsl */ `#include <common>
    uniform float uSnowAmount;`,
  );

  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <dithering_fragment>',
    /* glsl */ `
    // Snow accumulation on upward-facing surfaces
    if (uSnowAmount > 0.01) {
      vec3 snowWorldN = normalize(normal * mat3(viewMatrix));
      float snowDot = smoothstep(0.3, 0.8, snowWorldN.y);
      float snowCov = snowDot * uSnowAmount;
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.95, 0.96, 0.98), snowCov);
      // Snow is rough and non-metallic — slightly brighten to simulate diffuse scatter
      gl_FragColor.rgb += snowCov * 0.05;
    }
    #include <dithering_fragment>`,
  );
}

function mat(color, opts = {}) {
  const emissiveIntensity = opts.emissiveIntensity ?? 0;
  const side = opts.side ?? THREE.FrontSide;
  const key = `${color}-${opts.emissive || 0}-${opts.metalness || 0}-${opts.roughness ?? 0.8}-${opts.transparent || false}-${opts.opacity ?? 1}-${emissiveIntensity}-${side}`;
  if (MAT_CACHE.has(key)) return MAT_CACHE.get(key);
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.8,
    metalness: opts.metalness ?? 0,
    emissive: opts.emissive || 0x000000,
    emissiveIntensity,
    transparent: opts.transparent || false,
    opacity: opts.opacity ?? 1,
    side,
  });
  if (!opts.transparent) m.onBeforeCompile = _onBeforeCompileSnow;
  MAT_CACHE.set(key, m);
  return m;
}

// ═══════════════════════════════════════════════════════
//  PBR Texture Support
// ═══════════════════════════════════════════════════════

/** Loaded PBR texture sets, keyed by pack name. Set via BuildingFactory.setTextures(). */
let _pbrSets = null;

/**
 * Create a PBR-textured material with flat-color fallback.
 * When no textures are loaded, delegates to mat() for identical flat-color output.
 * @param {string} packName - Texture pack name (e.g. 'wood-dark')
 * @param {number} fallbackColor - Hex color when no textures are loaded
 * @param {object} [opts] - Same as mat() options
 */
function pbrMat(packName, fallbackColor, opts = {}) {
  if (!_pbrSets || !_pbrSets.has(packName)) {
    return mat(fallbackColor, opts);
  }
  const emissiveIntensity = opts.emissiveIntensity ?? 0;
  const side = opts.side ?? THREE.FrontSide;
  const key = `pbr:${packName}:${fallbackColor}:${opts.metalness || 0}:${opts.roughness ?? 0.8}:${emissiveIntensity}:${side}`;
  if (MAT_CACHE.has(key)) return MAT_CACHE.get(key);

  const pbrSet = _pbrSets.get(packName);
  const m = new THREE.MeshStandardMaterial({
    color: fallbackColor,
    roughness: opts.roughness ?? 0.8,
    metalness: opts.metalness ?? 0,
    emissive: opts.emissive || 0x000000,
    emissiveIntensity,
    transparent: opts.transparent || false,
    opacity: opts.opacity ?? 1,
    side,
  });

  if (pbrSet.map) m.map = pbrSet.map;
  if (pbrSet.normalMap) {
    m.normalMap = pbrSet.normalMap;
    m.normalScale = new THREE.Vector2(1, 1);
  }
  if (pbrSet.roughnessMap) {
    m.roughnessMap = pbrSet.roughnessMap;
    m.roughness = 1.0;
  }
  if (pbrSet.aoMap) m.aoMap = pbrSet.aoMap;
  if (pbrSet.metalnessMap) {
    m.metalnessMap = pbrSet.metalnessMap;
    m.metalness = 1.0;
  }
  if (pbrSet.emissiveMap) {
    m.emissiveMap = pbrSet.emissiveMap;
    m.emissive = new THREE.Color(0xffffff);
    m.emissiveIntensity = opts.emissiveIntensity ?? 1.0;
  }

  if (!opts.transparent) m.onBeforeCompile = _onBeforeCompileSnow;
  MAT_CACHE.set(key, m);
  return m;
}

// ═══════════════════════════════════════════════════════
//  Geometry Cache
// ═══════════════════════════════════════════════════════

const GEO_CACHE = new Map();

const GEO_CTORS = {
  box: (a) => new THREE.BoxGeometry(...a),
  cylinder: (a) => new THREE.CylinderGeometry(...a),
  sphere: (a) => new THREE.SphereGeometry(...a),
  cone: (a) => new THREE.ConeGeometry(...a),
  torus: (a) => new THREE.TorusGeometry(...a),
  ring: (a) => new THREE.RingGeometry(...a),
  circle: (a) => new THREE.CircleGeometry(...a),
  plane: (a) => new THREE.PlaneGeometry(...a),
  octahedron: (a) => new THREE.OctahedronGeometry(...a),
};

function geo(type, ...args) {
  const key = `${type}-${args.join('-')}`;
  if (GEO_CACHE.has(key)) return GEO_CACHE.get(key);
  const ctor = GEO_CTORS[type];
  if (!ctor) throw new Error(`Unknown geometry type: ${type}`);
  const g = ctor(args);
  GEO_CACHE.set(key, g);
  return g;
}

// Tier-based palettes
const WOOD_BROWN = 0x8B6914;
const WOOD_DARK = 0x5a3a20;
const STONE_GREY = 0x888888;
const STONE_DARK = 0x555555;
const STONE_LIGHT = 0xaaaaaa;
const GOLD_TRIM = 0xFFD700;
const THATCH = 0xC4A460;
const TILE_RED = 0xB84C34;
const SLATE_GREY = 0x607080;

const TIER_MATS = new Map();

/** Per-building-type PBR material overrides — slot → pack name.
 *  Applied on top of tierMaterials() when textures are available. */
const BUILDING_OVERRIDES = {
  1:  { wall: 'wall-block-rough' },                          // Barracks — rough military walls
  5:  { accent: 'metal-iron' },                              // Forge — iron accents
  8:  { floor: 'ground-sand' },                              // Arena — sand floor
  9:  { floor: 'rock-mossy' },                               // Sanctuary — mossy stone base
  12: { wall: 'wall-castle-mixed', floor: 'stone-medieval' }, // Citadel — castle walls
};

/** Tier → texture-pack-name mapping (from texture-map.json tier_material_mapping) */
const TIER_TEXTURE_MAP = {
  1: { wall: 'wood-dark', roof: 'roof-thatch', floor: 'stone-rubble', accent: 'wood-aged' },
  2: { wall: 'brick-classic', roof: 'roof-clay', floor: 'stone-cobble', accent: 'wood-dark', upper: 'plaster-white' },
  3: { wall: 'wall-stone-clean', roof: 'roof-slate', floor: 'stone-medieval', accent: 'stone-rubble', trim: 'metal-gold-worn' },
  4: { wall: 'stone-marble', roof: 'roof-slate', floor: 'stone-marble', accent: 'metal-gold-polished', trim: 'metal-gold-polished' },
};

function tierMaterials(tier) {
  const t = Math.min(Math.max(tier, 0), 4);
  const prefix = _pbrSets ? 'pbr:' : '';
  const key = `${prefix}${t}`;
  if (TIER_MATS.has(key)) return TIER_MATS.get(key);

  let result;
  if (!_pbrSets) {
    // Flat-color fallback (original behavior)
    if (t <= 1) result = { wall: mat(WOOD_BROWN), roof: mat(THATCH), floor: mat(STONE_DARK, { roughness: 0.95 }), accent: mat(WOOD_DARK) };
    else if (t === 2) result = { wall: mat(STONE_GREY), roof: mat(TILE_RED), floor: mat(STONE_GREY), accent: mat(WOOD_BROWN), upper: mat(WOOD_BROWN) };
    else if (t === 3) result = { wall: mat(STONE_LIGHT), roof: mat(SLATE_GREY), floor: mat(STONE_LIGHT), accent: mat(STONE_DARK), trim: mat(0xc0c0c0, { metalness: 0.3 }) };
    else result = { wall: mat(STONE_LIGHT), roof: mat(SLATE_GREY, { metalness: 0.1 }), floor: mat(STONE_LIGHT), accent: mat(GOLD_TRIM, { metalness: 0.6, roughness: 0.3 }), trim: mat(GOLD_TRIM, { metalness: 0.8, roughness: 0.2 }), glow: mat(0xffffff, { emissive: 0xffeebb, emissiveIntensity: 0.5 }) };
  } else {
    // PBR-textured materials (flat-color fallback per-material when pack missing)
    const tex = TIER_TEXTURE_MAP[Math.max(t, 1)] || TIER_TEXTURE_MAP[1];
    if (t <= 1) {
      result = {
        wall:   pbrMat(tex.wall,   WOOD_BROWN),
        roof:   pbrMat(tex.roof,   THATCH),
        floor:  pbrMat(tex.floor,  STONE_DARK, { roughness: 0.95 }),
        accent: pbrMat(tex.accent, WOOD_DARK),
      };
    } else if (t === 2) {
      result = {
        wall:   pbrMat(tex.wall,   STONE_GREY),
        roof:   pbrMat(tex.roof,   TILE_RED),
        floor:  pbrMat(tex.floor,  STONE_GREY),
        accent: pbrMat(tex.accent, WOOD_BROWN),
        upper:  pbrMat(tex.upper,  WOOD_BROWN),
      };
    } else if (t === 3) {
      result = {
        wall:   pbrMat(tex.wall,   STONE_LIGHT),
        roof:   pbrMat(tex.roof,   SLATE_GREY),
        floor:  pbrMat(tex.floor,  STONE_LIGHT),
        accent: pbrMat(tex.accent, STONE_DARK),
        trim:   pbrMat(tex.trim,   0xc0c0c0, { metalness: 0.3 }),
      };
    } else {
      result = {
        wall:   pbrMat(tex.wall,   STONE_LIGHT),
        roof:   pbrMat(tex.roof,   SLATE_GREY, { metalness: 0.1 }),
        floor:  pbrMat(tex.floor,  STONE_LIGHT),
        accent: pbrMat(tex.accent, GOLD_TRIM, { metalness: 0.6, roughness: 0.3 }),
        trim:   pbrMat(tex.trim,   GOLD_TRIM, { metalness: 0.8, roughness: 0.2 }),
        glow:   mat(0xffffff, { emissive: 0xffeebb, emissiveIntensity: 0.5 }),
      };
    }
  }

  TIER_MATS.set(key, result);
  return result;
}

// ═══════════════════════════════════════════════════════
//  Modular Kit — Reusable geometry generators
// ═══════════════════════════════════════════════════════

function mk(geometry, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  if (ry) m.rotation.y = ry;
  if (rz) m.rotation.z = rz;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Apply slight random vertex displacement for medieval character. Clones first to preserve cached geometry. */
function deform(geometry, rng, amount = DEFORM_AMOUNT) {
  const clone = geometry.clone();
  clone.userData._owned = true;
  const pos = clone.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) + (rng() - 0.5) * amount);
    pos.setY(i, pos.getY(i) + (rng() - 0.5) * amount * 0.5);
    pos.setZ(i, pos.getZ(i) + (rng() - 0.5) * amount);
  }
  pos.needsUpdate = true;
  clone.computeVertexNormals();
  return clone;
}

// ── Foundation modules ──

function stoneBase(w, d, h, material) {
  return mk(geo('box', w, h, d), material, 0, h / 2, 0);
}

function raisedPlatform(w, d, h, material) {
  const g = new THREE.Group();
  g.add(mk(geo('box', w, h, d), material, 0, h / 2, 0));
  const cs = h * 0.6;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(mk(geo('box', cs, h * 1.2, cs), material, sx * w * 0.45, h * 0.6, sz * d * 0.45));
  }
  return g;
}

function stilts(w, d, h, count, material) {
  const g = new THREE.Group();
  const spacing = w / (count - 1);
  for (let i = 0; i < count; i++) {
    const x = -w / 2 + i * spacing;
    g.add(mk(geo('cylinder', STILT_RADIUS_TOP, STILT_RADIUS_BOTTOM, h, 6), material, x, h / 2, -d * 0.3));
    g.add(mk(geo('cylinder', STILT_RADIUS_TOP, STILT_RADIUS_BOTTOM, h, 6), material, x, h / 2, d * 0.3));
  }
  g.add(mk(geo('box', w, PLATFORM_HEIGHT, d), material, 0, h, 0));
  return g;
}

// ── Wall modules ──

function plainWall(w, h, d, material) {
  return mk(geo('box', w, h, d || WALL_THICKNESS), material, 0, h / 2, 0);
}

function windowedWall(w, h, windowCount, wallMat, windowMat) {
  const g = new THREE.Group();
  g.add(mk(geo('box', w, h, WALL_THICKNESS), wallMat, 0, h / 2, 0));
  const spacing = w / (windowCount + 1);
  const ww = w * 0.12;
  const wh = h * 0.25;
  const resolvedWindowMat = windowMat || mat(0x88bbcc, { emissive: 0x88bbcc, emissiveIntensity: 0.15, transparent: true, opacity: 0.6 });
  for (let i = 1; i <= windowCount; i++) {
    const wx = -w / 2 + i * spacing;
    const m = mk(geo('box', ww, wh, WINDOW_DEPTH), resolvedWindowMat, wx, h * 0.6, 0);
    m.name = 'window';
    g.add(m);
  }
  return g;
}

function doorWall(w, h, wallMat, doorMat) {
  const g = new THREE.Group();
  g.add(mk(geo('box', w, h, WALL_THICKNESS), wallMat, 0, h / 2, 0));
  doorMat = doorMat || mat(WOOD_DARK);
  const dw = w * 0.2;
  const dh = h * 0.5;
  g.add(mk(geo('box', dw, dh, DOOR_DEPTH), doorMat, 0, dh / 2, 0));
  return g;
}

function halfTimberWall(w, h, wallMat, timberMat) {
  const g = new THREE.Group();
  g.add(mk(geo('box', w, h, WALL_THICKNESS), wallMat || mat(0xf5deb3), 0, h / 2, 0));
  timberMat = timberMat || mat(WOOD_DARK);
  // Horizontal beams
  g.add(mk(geo('box', w, BEAM_WIDTH, BEAM_DEPTH), timberMat, 0, 0.002, 0));
  g.add(mk(geo('box', w, BEAM_WIDTH, BEAM_DEPTH), timberMat, 0, h * 0.5, 0));
  g.add(mk(geo('box', w, BEAM_WIDTH, BEAM_DEPTH), timberMat, 0, h, 0));
  // Vertical beams
  g.add(mk(geo('box', BEAM_WIDTH, h, BEAM_DEPTH), timberMat, -w * 0.45, h / 2, 0));
  g.add(mk(geo('box', BEAM_WIDTH, h, BEAM_DEPTH), timberMat, w * 0.45, h / 2, 0));
  // Cross bracing
  g.add(mk(geo('box', 0.003, h * 0.7, 0.007), timberMat, -w * 0.2, h * 0.35, 0, 0, 0, 0.3));
  g.add(mk(geo('box', 0.003, h * 0.7, 0.007), timberMat, w * 0.2, h * 0.35, 0, 0, 0, -0.3));
  return g;
}

// ── Roof modules ──

function gableRoof(w, d, h, material, rng) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(0, h);
  shape.lineTo(w / 2, 0);
  shape.closePath();
  // ExtrudeGeometry is not cached (Shape varies continuously) — tag _owned for disposal
  let finalGeo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  finalGeo.userData._owned = true;
  if (rng) {
    const deformed = deform(finalGeo, rng, 0.002);
    finalGeo.dispose();
    finalGeo = deformed;
  }
  return mk(finalGeo, material, 0, 0, -d / 2);
}

function flatRoof(w, d, h, material, crenellations = false) {
  const g = new THREE.Group();
  g.add(mk(geo('box', w, h || 0.005, d), material, 0, (h || 0.005) / 2, 0));
  if (crenellations) {
    const cw = 0.012;
    const ch = 0.015;
    const gap = 0.015;
    for (let x = -w / 2 + cw; x < w / 2; x += cw + gap) {
      g.add(mk(geo('box', cw, ch, 0.008), material, x, ch / 2 + (h || 0.005), -d / 2));
      g.add(mk(geo('box', cw, ch, 0.008), material, x, ch / 2 + (h || 0.005), d / 2));
    }
    for (let z = -d / 2 + cw; z < d / 2; z += cw + gap) {
      g.add(mk(geo('box', 0.008, ch, cw), material, -w / 2, ch / 2 + (h || 0.005), z));
      g.add(mk(geo('box', 0.008, ch, cw), material, w / 2, ch / 2 + (h || 0.005), z));
    }
  }
  return g;
}

function domeRoof(r, h, material) {
  return mk(geo('sphere', r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), material, 0, h || 0, 0);
}

function coneRoof(r, h, material) {
  return mk(geo('cone', r, h, 8), material, 0, h / 2, 0);
}

// ── Accent modules ──

function chimney(w, h, material) {
  const g = new THREE.Group();
  g.add(mk(geo('box', w, h, w), material, 0, h / 2, 0));
  const anchor = new THREE.Object3D();
  anchor.name = 'particle-chimney';
  anchor.position.set(0, h, 0);
  g.add(anchor);
  return g;
}

function flagPole(h, flagW, flagH, flagColor) {
  const g = new THREE.Group();
  g.add(mk(geo('cylinder', FLAG_POLE_RADIUS, FLAG_POLE_RADIUS, h, 6), mat(WOOD_DARK), 0, h / 2, 0));
  const flag = mk(geo('plane', flagW || 0.04, flagH || 0.025, 8, 4), mat(flagColor || 0xcc2222, { side: THREE.DoubleSide }), flagW / 2, h - (flagH || 0.025) / 2, 0);
  flag.name = 'flag';
  g.add(flag);
  g.add(mk(geo('sphere', 0.004, 6, 4), mat(GOLD_TRIM, { metalness: 0.5 }), 0, h, 0));
  return g;
}

function balcony(w, d, material) {
  const g = new THREE.Group();
  g.add(mk(geo('box', w, PLATFORM_HEIGHT, d), material, 0, 0, d / 2));
  g.add(mk(geo('box', w, 0.01, 0.003), material, 0, 0.01, d));
  return g;
}

function turret(r, h, wallMat, roofMat) {
  const g = new THREE.Group();
  g.add(mk(geo('cylinder', r, r * 1.05, h, 8), wallMat, 0, h / 2, 0));
  const roof = coneRoof(r * 1.3, h * 0.4, roofMat);
  roof.position.y = h;
  g.add(roof);
  return g;
}

function anvil(scale) {
  const s = scale || 0.01;
  const g = new THREE.Group();
  g.add(mk(geo('box', s * 2, s, s * 1.5), mat(0x444444, { metalness: 0.7, roughness: 0.4 }), 0, s / 2, 0));
  g.add(mk(geo('box', s * 1.2, s * 0.5, s), mat(0x333333, { metalness: 0.7 }), 0, s * 1.25, 0));
  const anchor = new THREE.Object3D();
  anchor.name = 'particle-forge-fire';
  anchor.position.set(0, s * 1.5, 0);
  g.add(anchor);
  return g;
}

function barrel(r, h, material) {
  const g = new THREE.Group();
  g.add(mk(geo('cylinder', r, r * 0.9, h, 8), material || mat(WOOD_BROWN), 0, h / 2, 0));
  const bandMat = mat(0x666666, { metalness: 0.5 });
  g.add(mk(geo('torus', r * 1.01, 0.001, 4, 8), bandMat, 0, h * 0.2, 0, Math.PI / 2, 0, 0));
  g.add(mk(geo('torus', r * 1.01, 0.001, 4, 8), bandMat, 0, h * 0.8, 0, Math.PI / 2, 0, 0));
  return g;
}

// ── Selection ring ──

function selectionRing(radius) {
  const ring = mk(geo('ring', radius * 0.9, radius, 32), mat(0xFFFF00, { transparent: true, opacity: 0.6, side: THREE.DoubleSide }), 0, 0.001, 0, -Math.PI / 2, 0, 0);
  ring.name = 'select-ring';
  ring.visible = false;
  return ring;
}

// ═══════════════════════════════════════════════════════
//  Visual tier from level
// ═══════════════════════════════════════════════════════

function visualTier(level) {
  if (level <= 0) return 0; // Construction
  if (level <= 5) return 1; // Foundation
  if (level <= 12) return 2; // Established
  if (level <= 18) return 3; // Grand
  return 4; // Legendary
}

// ═══════════════════════════════════════════════════════
//  Building Registry
// ═══════════════════════════════════════════════════════

function buildMansion(tier, w, rng, mats) {
  const g = new THREE.Group();
  if (tier <= 1) {
    const base = stoneBase(w, w * 0.8, w * 0.3, mats.floor);
    g.add(base);
    const walls = halfTimberWall(w, w * 0.5, mats.wall);
    walls.position.set(0, w * 0.3, 0);
    g.add(walls);
    const roof = gableRoof(w * 1.1, w * 0.9, w * 0.35, mats.roof, rng);
    roof.position.y = w * 0.8;
    g.add(roof);
    if (tier >= 1) {
      const ch = chimney(w * 0.08, w * 0.3, mat(STONE_DARK));
      ch.position.set(w * 0.3, w * 0.8, 0);
      g.add(ch);
    }
  } else if (tier === 2) {
    g.add(stoneBase(w * 1.2, w, w * 0.05, mats.floor));
    const frontWall = windowedWall(w * 1.2, w * 0.6, 3, mats.wall);
    frontWall.position.set(0, w * 0.05, -w * 0.5);
    g.add(frontWall);
    const backWall = windowedWall(w * 1.2, w * 0.6, 2, mats.wall);
    backWall.position.set(0, w * 0.05, w * 0.5);
    g.add(backWall);
    g.add(mk(geo('box', WALL_THICKNESS, w * 0.6, w), mats.wall, -w * 0.6, w * 0.05 + w * 0.3, 0));
    g.add(mk(geo('box', WALL_THICKNESS, w * 0.6, w), mats.wall, w * 0.6, w * 0.05 + w * 0.3, 0));
    const roof = gableRoof(w * 1.3, w * 1.1, w * 0.3, mats.roof, rng);
    roof.position.y = w * 0.65;
    g.add(roof);
    const ch = chimney(w * 0.1, w * 0.35, mat(STONE_DARK));
    ch.position.set(w * 0.35, w * 0.65, 0);
    g.add(ch);
    g.add(mk(geo('box', w * 0.15, 0.002, w * 0.5), mat(0x999988), 0, 0.001, -w * 0.75));
  } else if (tier === 3) {
    const wingW = w * 0.8;
    const wingD = w * 0.6;
    for (const [ox, oz] of [[0, 0], [-wingW * 0.7, wingD * 0.3], [wingW * 0.7, wingD * 0.3]]) {
      const wing = new THREE.Group();
      wing.add(stoneBase(wingW, wingD, w * 0.05, mats.floor));
      wing.add(mk(geo('box', wingW, w * 0.7, wingD), mats.wall, 0, w * 0.05 + w * 0.35, 0));
      const wr = gableRoof(wingW * 1.1, wingD * 1.1, w * 0.25, mats.roof, rng);
      wr.position.y = w * 0.75;
      wing.add(wr);
      wing.position.set(ox, 0, oz);
      g.add(wing);
    }
    for (const ox of [-wingW * 0.7, wingW * 0.7]) {
      const b = balcony(w * 0.2, w * 0.06, mats.accent);
      b.position.set(ox, w * 0.5, -wingD * 0.3);
      g.add(b);
    }
    const ch = chimney(w * 0.1, w * 0.4, mat(STONE_DARK));
    ch.position.set(0, w * 0.75, 0);
    g.add(ch);
  } else {
    const mainW = w * 1.5;
    const mainD = w;
    g.add(stoneBase(mainW, mainD, w * 0.06, mats.floor));
    g.add(mk(geo('box', mainW, w * 0.8, mainD), mats.wall, 0, w * 0.06 + w * 0.4, 0));
    g.add(mk(geo('box', mainW * 0.8, w * 0.5, mainD * 0.8), mats.wall, 0, w * 0.86 + w * 0.25, 0));
    const roof = gableRoof(mainW * 0.9, mainD * 0.9, w * 0.3, mats.roof, rng);
    roof.position.y = w * 1.36;
    g.add(roof);
    g.add(mk(geo('box', mainW * 1.02, 0.004, mainD * 1.02), mats.trim, 0, w * 0.86, 0));
    g.add(mk(geo('box', mainW * 0.82, 0.004, mainD * 0.82), mats.trim, 0, w * 1.36, 0));
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      g.add(mk(geo('sphere', 0.008, 4, 3), mat(0xff4466), Math.cos(angle) * w * 0.5, 0.01, Math.sin(angle) * w * 0.5 + mainD * 0.7));
    }
    const ch = chimney(w * 0.12, w * 0.45, mat(STONE_DARK));
    ch.position.set(mainW * 0.3, w * 1.36, 0);
    g.add(ch);
    for (let i = 0; i < 5; i++) {
      const wx = -mainW * 0.4 + i * mainW * 0.2;
      const m = mk(geo('box', w * 0.06, w * 0.08, WINDOW_DEPTH), mat(0xffeeaa, { emissive: 0xffeeaa, emissiveIntensity: 0.2 }), wx, w * 0.55, -mainD * 0.5 - 0.004);
      m.name = 'window';
      g.add(m);
    }
  }
  const sfxMansion = new THREE.Object3D();
  sfxMansion.name = 'sound-fireplace';
  sfxMansion.position.set(w * 0.3, w * 0.4, 0);
  g.add(sfxMansion);
  return g;
}

function buildBarracks(tier, w, rng, mats) {
  const g = new THREE.Group();
  if (tier <= 1) {
    g.add(mk(geo('cylinder', w * 0.7, w * 0.7, 0.003, 16), mat(0xccaa77), 0, 0.002, 0));
    g.add(mk(geo('cone', w * 0.3, w * 0.4, 6), mat(0xeeeecc), w * 0.5, w * 0.2, w * 0.3));
    g.add(mk(geo('cylinder', 0.003, 0.003, w * 0.3, 4), mat(WOOD_BROWN), -w * 0.3, w * 0.15, 0));
    g.add(mk(geo('box', w * 0.12, 0.005, 0.005), mat(WOOD_BROWN), -w * 0.3, w * 0.25, 0));
    // Brazier fire particle anchor
    const brazier = new THREE.Object3D();
    brazier.name = 'particle-brazier';
    brazier.position.set(-w * 0.3, w * 0.3, 0);
    g.add(brazier);
  } else if (tier === 2) {
    g.add(raisedPlatform(w * 1.3, w * 0.6, w * 0.05, mats.floor));
    g.add(mk(geo('box', w * 1.3, w * 0.5, w * 0.6), mats.wall, 0, w * 0.05 + w * 0.25, 0));
    const roof = flatRoof(w * 1.4, w * 0.7, w * 0.02, mats.roof, true);
    roof.position.y = w * 0.55;
    g.add(roof);
    const fp = flagPole(w * 0.6, w * 0.15, w * 0.1, 0xcc2222);
    fp.position.set(w * 0.7, 0, 0);
    g.add(fp);
  } else if (tier === 3) {
    g.add(stoneBase(w * 1.5, w * 0.8, w * 0.06, mats.floor));
    g.add(mk(geo('box', w * 1.5, w * 0.7, w * 0.8), mats.wall, 0, w * 0.06 + w * 0.35, 0));
    const roof = flatRoof(w * 1.6, w * 0.9, w * 0.02, mats.roof, true);
    roof.position.y = w * 0.76;
    g.add(roof);
    g.add(mk(geo('box', w * 0.5, w * 0.4, w * 0.5), mats.wall, w * 0.9, w * 0.2, 0));
    const armRoof = flatRoof(w * 0.55, w * 0.55, w * 0.015, mats.roof, true);
    armRoof.position.set(w * 0.9, w * 0.4, 0);
    g.add(armRoof);
  } else {
    g.add(stoneBase(w * 1.8, w, w * 0.07, mats.floor));
    g.add(mk(geo('box', w * 1.8, w * 0.85, w), mats.wall, 0, w * 0.07 + w * 0.425, 0));
    const roof = flatRoof(w * 1.9, w * 1.1, w * 0.03, mats.roof, true);
    roof.position.y = w * 0.92;
    g.add(roof);
    for (const sz of [-1, 1]) {
      g.add(mk(geo('plane', w * 0.4, w * 0.3), mat(0x4444ff, { transparent: true, opacity: 0.3, emissive: 0x4444ff, emissiveIntensity: 0.4, side: THREE.DoubleSide }), 0, w * 0.3, sz * w * 0.8));
    }
    const fp = flagPole(w * 0.8, w * 0.2, w * 0.12, 0xcc2222);
    fp.position.set(w * 0.9, 0, 0);
    g.add(fp);
  }
  const sfxBarracks = new THREE.Object3D();
  sfxBarracks.name = 'sound-training';
  sfxBarracks.position.set(0, w * 0.1, 0);
  g.add(sfxBarracks);
  return g;
}

function buildWorkshop(tier, w, rng, mats) {
  const g = new THREE.Group();
  if (tier <= 1) {
    g.add(mk(geo('box', w * 0.8, w * 0.4, w * 0.5), mats.wall, 0, w * 0.2, 0));
    g.add(mk(geo('box', w * 0.9, 0.003, w * 0.6), mats.roof, 0, w * 0.42, -w * 0.05, 0.15));
    g.add(mk(geo('sphere', w * 0.12, 5, 3), mat(0x555544), w * 0.5, w * 0.08, w * 0.3));
  } else if (tier === 2) {
    g.add(stoneBase(w * 1.1, w * 0.8, w * 0.04, mats.floor));
    g.add(mk(geo('box', w * 1.1, w * 0.55, w * 0.8), mats.wall, 0, w * 0.04 + w * 0.275, 0));
    const roof = gableRoof(w * 1.2, w * 0.9, w * 0.25, mats.roof, rng);
    roof.position.y = w * 0.59;
    g.add(roof);
    const wheel = mk(geo('torus', w * 0.2, 0.005, 4, 12), mat(WOOD_BROWN), -w * 0.65, w * 0.2, 0);
    wheel.name = 'waterwheel';
    g.add(wheel);
    const ch = chimney(w * 0.08, w * 0.25, mat(STONE_DARK));
    ch.position.set(w * 0.3, w * 0.59, 0);
    g.add(ch);
  } else if (tier === 3) {
    g.add(stoneBase(w * 1.4, w, w * 0.05, mats.floor));
    g.add(mk(geo('box', w * 1.4, w * 0.7, w), mats.wall, 0, w * 0.05 + w * 0.35, 0));
    const roof = gableRoof(w * 1.5, w * 1.1, w * 0.3, mats.roof, rng);
    roof.position.y = w * 0.75;
    g.add(roof);
    for (let i = 0; i < 3; i++) {
      const ch = chimney(w * 0.07, w * 0.3, mat(STONE_DARK));
      ch.position.set(-w * 0.4 + i * w * 0.4, w * 0.75, 0);
      g.add(ch);
    }
    for (const dz of [-0.005, 0.005]) {
      g.add(mk(geo('box', w * 2, 0.002, 0.003), mat(0x888888, { metalness: 0.5 }), 0, 0.001, w * 0.5 + dz));
    }
  } else {
    g.add(stoneBase(w * 1.6, w * 1.1, w * 0.06, mats.floor));
    g.add(mk(geo('box', w * 1.6, w * 0.85, w * 1.1), mats.wall, 0, w * 0.06 + w * 0.425, 0));
    const roof = gableRoof(w * 1.7, w * 1.2, w * 0.35, mats.roof, rng);
    roof.position.y = w * 0.91;
    g.add(roof);
    for (const sx of [-1, 1]) {
      g.add(mk(geo('octahedron', w * 0.08, 0), mat(0x88ccff, { emissive: 0x88ccff, emissiveIntensity: 0.5, transparent: true, opacity: 0.7 }), sx * w * 0.6, w * 0.5, w * 0.6));
    }
    g.add(mk(geo('sphere', w * 0.06, 8, 6), mat(0xaaffcc, { emissive: 0xaaffcc, emissiveIntensity: 0.4 }), 0, w * 1.2, 0));
  }
  const sfxWorkshop = new THREE.Object3D();
  sfxWorkshop.name = 'sound-hammering';
  sfxWorkshop.position.set(0, w * 0.3, 0);
  g.add(sfxWorkshop);
  return g;
}

function buildVault(tier, w, rng, mats) {
  const g = new THREE.Group();
  if (tier <= 1) {
    g.add(mk(geo('box', w * 0.6, w * 0.35, w * 0.4), mat(0x666655, { metalness: 0.4 }), 0, w * 0.175, 0));
    g.add(mk(geo('circle', w * 0.04, 8), mat(GOLD_TRIM, { metalness: 0.6 }), 0, w * 0.2, -w * 0.201));
    for (const sx of [-1, 1]) {
      g.add(mk(geo('cylinder', 0.004, 0.004, w * 0.4, 6), mat(0x444444, { metalness: 0.5 }), sx * w * 0.35, w * 0.2, -w * 0.3));
    }
  } else if (tier === 2) {
    g.add(mk(geo('cylinder', w * 0.5, w * 0.55, w * 0.6, 8), mats.wall, 0, w * 0.3, 0));
    g.add(domeRoof(w * 0.55, w * 0.6, mats.roof));
    const door = doorWall(w * 0.3, w * 0.4, mats.wall, mat(0x555555, { metalness: 0.5 }));
    door.position.set(0, 0, -w * 0.55);
    g.add(door);
  } else if (tier === 3) {
    g.add(stoneBase(w * 1.2, w * 0.8, w * 0.08, mats.floor));
    g.add(mk(geo('box', w * 0.8, w * 0.5, w * 0.6), mats.wall, 0, w * 0.08 + w * 0.25, 0));
    g.add(domeRoof(w * 0.5, w * 0.58, mats.roof));
    g.add(mk(geo('ring', w * 0.3, w * 0.35, 6), mat(0x4488ff, { emissive: 0x4488ff, emissiveIntensity: 0.3, side: THREE.DoubleSide }), 0, 0.003, 0, -Math.PI / 2));
    for (let i = 0; i < 4; i++) {
      g.add(mk(geo('box', 0.003, w * 0.3, w * 0.5), mat(GOLD_TRIM, { metalness: 0.5 }), -w * 0.2 + i * w * 0.13, w * 0.2, -w * 0.41));
    }
  } else {
    g.add(stoneBase(w * 1.4, w, w * 0.06, mats.floor));
    const vault = mk(geo('box', w * 0.8, w * 0.6, w * 0.6), mats.wall, 0, w * 0.6, 0);
    g.add(vault);
    g.add(domeRoof(w * 0.5, w * 0.9, mat(GOLD_TRIM, { metalness: 0.8, roughness: 0.2 })));
    g.add(mk(geo('sphere', w * 0.7, 8, 6), mat(0x88ccff, { transparent: true, opacity: 0.15, emissive: 0x88ccff, emissiveIntensity: 0.2, side: THREE.DoubleSide }), 0, w * 0.7, 0));
    const anchor = new THREE.Object3D();
    anchor.name = 'particle-gold';
    anchor.position.set(0, w * 0.3, 0);
    g.add(anchor);
  }
  const sfxVault = new THREE.Object3D();
  sfxVault.name = 'sound-coins';
  sfxVault.position.set(0, w * 0.2, 0);
  g.add(sfxVault);
  return g;
}

function buildDock(tier, w, rng, mats) {
  const g = new THREE.Group();
  const woodMat = mat(WOOD_BROWN);
  if (tier <= 1) {
    g.add(mk(geo('box', w * 0.3, 0.006, w * 1.2), woodMat, 0, 0.003, -w * 0.3));
    for (const dz of [-0.7, -0.1, 0.5]) {
      g.add(mk(geo('cylinder', 0.005, 0.006, 0.02, 6), woodMat, w * 0.12, 0.01, dz * w));
    }
  } else if (tier === 2) {
    g.add(mk(geo('box', w * 0.5, 0.008, w * 1.5), woodMat, 0, 0.004, -w * 0.3));
    g.add(mk(geo('box', w * 0.4, w * 0.3, w * 0.3), mats.wall, 0, w * 0.15, w * 0.5));
    const shedRoof = gableRoof(w * 0.45, w * 0.35, w * 0.15, mats.roof, rng);
    shedRoof.position.set(0, w * 0.3, w * 0.5);
    g.add(shedRoof);
    g.add(mk(geo('box', w * 0.1, 0.01, w * 0.25), woodMat, w * 0.25, 0.005, -w * 0.5));
  } else if (tier === 3) {
    g.add(mk(geo('box', w * 0.8, 0.01, w * 2), woodMat, 0, 0.005, -w * 0.5));
    g.add(mk(geo('box', w * 0.6, w * 0.4, w * 0.5), mats.wall, 0, w * 0.2, w * 0.7));
    const harborRoof = gableRoof(w * 0.7, w * 0.6, w * 0.2, mats.roof, rng);
    harborRoof.position.set(0, w * 0.4, w * 0.7);
    g.add(harborRoof);
    g.add(mk(geo('box', w * 0.15, 0.02, w * 0.5), woodMat, w * 0.3, 0.015, -w * 0.8));
    g.add(mk(geo('cylinder', 0.003, 0.003, w * 0.4, 4), woodMat, w * 0.3, w * 0.2, -w * 0.8));
    g.add(mk(geo('cylinder', 0.005, 0.006, w * 0.5, 6), woodMat, -w * 0.3, w * 0.25, w * 0.3));
    g.add(mk(geo('box', w * 0.3, 0.005, 0.005), woodMat, -w * 0.15, w * 0.5, w * 0.3));
    // Spray particle anchor
    const spray = new THREE.Object3D();
    spray.name = 'particle-spray';
    spray.position.set(0, 0.01, -w * 0.8);
    g.add(spray);
  } else {
    g.add(mk(geo('box', w * 1.2, 0.015, w * 2.5), woodMat, 0, 0.007, -w * 0.5));
    g.add(mk(geo('box', w * 0.8, w * 0.5, w * 0.6), mats.wall, 0, w * 0.25, w * 0.8));
    const dockRoof = gableRoof(w * 0.9, w * 0.7, w * 0.25, mats.roof, rng);
    dockRoof.position.set(0, w * 0.5, w * 0.8);
    g.add(dockRoof);
    g.add(mk(geo('box', w * 0.2, 0.03, w * 0.7), mat(0x555577, { transparent: true, opacity: 0.5 }), w * 0.4, 0.02, -w));
    g.add(mk(geo('cylinder', 0.003, 0.003, w * 0.5, 4), mat(0x555577, { transparent: true, opacity: 0.5 }), w * 0.4, w * 0.3, -w));
    g.add(mk(geo('ring', w * 0.4, w * 0.8, 16), mat(0x22ffaa, { emissive: 0x22ffaa, emissiveIntensity: 0.3, transparent: true, opacity: 0.3, side: THREE.DoubleSide }), 0, 0.002, -w * 0.8, -Math.PI / 2));
    // Spray particle anchor
    const spray = new THREE.Object3D();
    spray.name = 'particle-spray';
    spray.position.set(0, 0.01, -w);
    g.add(spray);
  }
  const sfxDock = new THREE.Object3D();
  sfxDock.name = 'sound-waves';
  sfxDock.position.set(0, 0.01, -w * 0.6);
  g.add(sfxDock);
  return g;
}

function buildForge(tier, w, rng, mats) {
  const g = new THREE.Group();
  // Lava PBR materials (fall back to flat emissive when textures unavailable)
  const lavaEmberMat = pbrMat('lava-ember', 0x222222, { emissive: 0xff4400, emissiveIntensity: 0.6 });
  const lavaCooledMat = pbrMat('lava-cooled', 0xff4400, { emissive: 0xff4400, emissiveIntensity: 0.7 });
  const lavaMoltenMat = pbrMat('lava-molten', 0xff2200, { emissive: 0xff2200, emissiveIntensity: 1.0 });

  if (tier <= 1) {
    g.add(anvil(w * 0.15));
    g.add(mk(geo('cylinder', w * 0.2, w * 0.2, 0.005, 8), mat(0x222222), w * 0.3, 0.003, 0));
    g.add(mk(geo('sphere', w * 0.06, 4, 3), mat(0xff4400, { emissive: 0xff4400, emissiveIntensity: 0.6 }), w * 0.3, 0.03, 0));
  } else if (tier === 2) {
    g.add(stoneBase(w * 1.1, w * 0.8, w * 0.05, mats.floor));
    g.add(mk(geo('box', w * 1.1, w * 0.5, w * 0.8), mats.wall, 0, w * 0.05 + w * 0.25, 0));
    g.add(flatRoof(w * 1.2, w * 0.9, w * 0.02, mats.roof));
    const ch = chimney(w * 0.12, w * 0.5, mat(STONE_DARK));
    ch.position.set(w * 0.3, w * 0.55, 0);
    g.add(ch);
    // Fire pit disc with lava-ember texture
    g.add(mk(geo('cylinder', w * 0.15, w * 0.15, 0.003, 8), lavaEmberMat, 0, 0.002, -w * 0.55));
    g.add(mk(geo('box', w * 0.12, w * 0.1, WINDOW_DEPTH), mat(0xff6600, { emissive: 0xff6600, emissiveIntensity: 0.8 }), 0, w * 0.2, -w * 0.41));
    const a = anvil(w * 0.12);
    a.position.set(-w * 0.5, 0, -w * 0.5);
    g.add(a);
  } else if (tier === 3) {
    g.add(stoneBase(w * 1.5, w * 1, w * 0.06, mats.floor));
    g.add(mk(geo('box', w * 1.5, w * 0.65, w * 1), mats.wall, 0, w * 0.06 + w * 0.325, 0));
    g.add(flatRoof(w * 1.6, w * 1.1, w * 0.025, mats.roof));
    for (let i = 0; i < 2; i++) {
      const ch = chimney(w * 0.1, w * 0.55, mat(STONE_DARK));
      ch.position.set(-w * 0.4 + i * w * 0.8, w * 0.68, 0);
      g.add(ch);
    }
    // Ground around forge with lava-cooled texture
    g.add(mk(geo('box', w * 1.2, 0.003, 0.01), lavaCooledMat, 0, 0.002, -w * 0.55));
    // Fire pit disc with lava-ember texture
    g.add(mk(geo('cylinder', w * 0.18, w * 0.18, 0.003, 8), lavaEmberMat, w * 0.4, 0.002, -w * 0.55));
  } else {
    g.add(stoneBase(w * 1.8, w * 1.2, w * 0.07, mat(0x443322)));
    g.add(mk(geo('box', w * 1.8, w * 0.8, w * 1.2), mat(0x553322), 0, w * 0.07 + w * 0.4, 0));
    g.add(flatRoof(w * 1.9, w * 1.3, w * 0.03, mats.roof));
    for (let i = 0; i < 3; i++) {
      const ch = chimney(w * 0.12, w * 0.65, mat(STONE_DARK));
      ch.position.set(-w * 0.5 + i * w * 0.5, w * 0.87, 0);
      g.add(ch);
    }
    // Molten channels with lava-molten texture
    for (const dz of [-0.3, 0, 0.3]) {
      g.add(mk(geo('box', w * 2, 0.005, 0.015), lavaMoltenMat, 0, 0.003, dz * w));
    }
    // Ground with lava-cooled texture
    g.add(mk(geo('cylinder', w * 0.8, w * 0.8, 0.003, 12), lavaCooledMat, 0, 0.002, 0));
    // Fire pit disc with lava-ember texture
    g.add(mk(geo('cylinder', w * 0.2, w * 0.2, 0.003, 8), lavaEmberMat, 0, 0.002, -w * 0.7));
    for (const sx of [-1, 1]) {
      g.add(mk(geo('box', 0.008, w * 0.15, 0.008), mat(0xffaa44, { emissive: 0xffaa44, emissiveIntensity: 0.4 }), sx * w * 0.4, w * 1.0, 0));
    }
  }
  const sfxForge = new THREE.Object3D();
  sfxForge.name = 'sound-anvil';
  sfxForge.position.set(0, w * 0.2, 0);
  g.add(sfxForge);
  return g;
}

function buildMarket(tier, w, rng, mats) {
  const g = new THREE.Group();
  if (tier <= 1) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      g.add(mk(geo('cylinder', 0.004, 0.004, w * 0.35, 4), mat(WOOD_BROWN), sx * w * 0.25, w * 0.175, sz * w * 0.15));
    }
    g.add(mk(geo('box', w * 0.55, 0.004, w * 0.35), mat(0xff6347, { side: THREE.DoubleSide }), 0, w * 0.35, 0, 0.1));
    g.add(mk(geo('box', w * 0.4, w * 0.05, w * 0.2), mat(WOOD_BROWN), 0, w * 0.025, 0));
    const b = barrel(w * 0.05, w * 0.08);
    b.position.set(w * 0.3, 0, w * 0.25);
    g.add(b);
  } else if (tier === 2) {
    for (let i = 0; i < 3; i++) {
      const ox = -w * 0.5 + i * w * 0.5;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        g.add(mk(geo('cylinder', 0.004, 0.004, w * 0.35, 4), mat(WOOD_BROWN), ox + sx * w * 0.18, w * 0.175, sz * w * 0.12));
      }
      const awningColor = [0xff6347, 0x4488ff, 0x44bb44][i];
      g.add(mk(geo('box', w * 0.4, 0.004, w * 0.28), mat(awningColor, { side: THREE.DoubleSide }), ox, w * 0.35, 0, 0.1));
    }
  } else if (tier === 3) {
    g.add(stoneBase(w * 1.4, w * 0.9, w * 0.04, mats.floor));
    g.add(mk(geo('box', w * 1.4, w * 0.6, w * 0.9), mats.wall, 0, w * 0.04 + w * 0.3, 0));
    g.add(mk(geo('box', w * 1.2, w * 0.4, w * 0.7), mats.wall, 0, w * 0.64 + w * 0.2, 0));
    const roof = gableRoof(w * 1.5, w * 1.0, w * 0.3, mats.roof, rng);
    roof.position.y = w * 1.04;
    g.add(roof);
  } else {
    g.add(stoneBase(w * 1.6, w * 1.1, w * 0.05, mats.floor));
    g.add(mk(geo('box', w * 1.6, w * 0.7, w * 1.1), mats.wall, 0, w * 0.05 + w * 0.35, 0));
    g.add(mk(geo('box', w * 1.3, w * 0.5, w * 0.8), mats.wall, 0, w * 0.75 + w * 0.25, 0));
    const roof = gableRoof(w * 1.7, w * 1.2, w * 0.35, mats.roof, rng);
    roof.position.y = w * 1.25;
    g.add(roof);
    for (const [ox, oz] of [[-1, 0], [1, 0]]) {
      g.add(mk(geo('cylinder', w * 0.2, w * 0.2, 0.01, 8), mats.trim, ox * w, w * 0.6, oz * w * 0.8));
    }
    g.add(mk(geo('torus', w * 0.15, 0.008, 8, 16), mat(0x9966ff, { emissive: 0x9966ff, emissiveIntensity: 0.5 }), 0, w * 0.5, -w * 0.56));
  }
  const sfxMarket = new THREE.Object3D();
  sfxMarket.name = 'sound-chatter';
  sfxMarket.position.set(0, w * 0.2, 0);
  g.add(sfxMarket);
  return g;
}

function buildAcademy(tier, w, rng, mats) {
  const g = new THREE.Group();
  if (tier <= 1) {
    g.add(mk(geo('cylinder', 0.004, 0.005, w * 0.15, 4), mat(WOOD_BROWN), 0, w * 0.075, 0));
    g.add(mk(geo('box', w * 0.1, 0.004, w * 0.08), mat(WOOD_BROWN), 0, w * 0.15, 0, 0.3));
    g.add(mk(geo('box', w * 0.06, 0.003, w * 0.05), mat(0x884422), 0, w * 0.155, 0));
    g.add(mk(geo('cylinder', 0.005, 0.008, w * 0.3, 5), mat(WOOD_DARK), w * 0.3, w * 0.15, w * 0.2));
    g.add(mk(geo('sphere', w * 0.12, 5, 4), mat(0x228833), w * 0.3, w * 0.35, w * 0.2));
  } else if (tier === 2) {
    g.add(stoneBase(w * 1.0, w * 0.8, w * 0.04, mats.floor));
    g.add(mk(geo('box', w * 1.0, w * 0.8, w * 0.8), mats.wall, 0, w * 0.04 + w * 0.4, 0));
    g.add(domeRoof(w * 0.55, w * 0.84, mat(0x4682b4)));
    for (const [fx, fz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      g.add(mk(geo('box', fx ? WINDOW_DEPTH : w * 0.15, w * 0.2, fz ? WINDOW_DEPTH : w * 0.15), mat(0x8844cc, { emissive: 0x8844cc, emissiveIntensity: 0.15, transparent: true, opacity: 0.5 }), fx * w * 0.5, w * 0.5, fz * w * 0.4));
    }
    g.add(mk(geo('cylinder', 0.006, 0.004, w * 0.15, 6), mat(0x886633), 0, w * 1.0 + w * 0.075, 0, 0.4));
  } else if (tier === 3) {
    g.add(stoneBase(w * 1.5, w * 1.0, w * 0.05, mats.floor));
    g.add(mk(geo('box', w * 1.5, w * 0.8, w * 1.0), mats.wall, 0, w * 0.05 + w * 0.4, 0));
    g.add(mk(geo('box', w * 0.8, w * 0.5, w * 0.6), mats.wall, 0, w * 0.85 + w * 0.25, 0));
    g.add(domeRoof(w * 0.45, w * 1.35, mat(0x4682b4)));
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      const book = mk(geo('box', 0.015, 0.003, 0.012), mat(0x884422), Math.cos(angle) * w * 0.3, w * 1.2 + i * 0.02, Math.sin(angle) * w * 0.3);
      book.name = `floating-book-${i}`;
      g.add(book);
    }
    // Arcane particle anchor
    const arcane = new THREE.Object3D();
    arcane.name = 'particle-arcane';
    arcane.position.set(0, w * 1.35, 0);
    g.add(arcane);
  } else {
    g.add(stoneBase(w * 1.8, w * 1.2, w * 0.06, mats.floor));
    g.add(mk(geo('box', w * 1.8, w * 1.0, w * 1.2), mats.wall, 0, w * 0.06 + w * 0.5, 0));
    g.add(mk(geo('box', w * 1.0, w * 0.7, w * 0.8), mats.wall, 0, w * 1.06 + w * 0.35, 0));
    g.add(domeRoof(w * 0.6, w * 1.76, mat(0x4682b4, { metalness: 0.2 })));
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      g.add(mk(geo('plane', 0.02, 0.01), mat(0x88ddff, { emissive: 0x88ddff, emissiveIntensity: 0.5, transparent: true, opacity: 0.4, side: THREE.DoubleSide }), Math.cos(angle) * w * 0.5, w * 1.5 + Math.sin(i) * 0.05, Math.sin(angle) * w * 0.5));
    }
    // Arcane particle anchor
    const arcane = new THREE.Object3D();
    arcane.name = 'particle-arcane';
    arcane.position.set(0, w * 1.76, 0);
    g.add(arcane);
  }
  const sfxAcademy = new THREE.Object3D();
  sfxAcademy.name = 'sound-studying';
  sfxAcademy.position.set(0, w * 0.5, 0);
  g.add(sfxAcademy);
  return g;
}

function buildArena(tier, w, rng, mats) {
  const g = new THREE.Group();
  if (tier <= 1) {
    g.add(mk(geo('cylinder', w * 0.5, w * 0.5, 0.005, 16), mat(0xccaa77), 0, 0.003, 0));
    g.add(mk(geo('torus', w * 0.5, 0.003, 4, 16), mat(0xaa8844), 0, w * 0.08, 0, Math.PI / 2));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.add(mk(geo('cylinder', 0.004, 0.005, w * 0.15, 4), mat(WOOD_BROWN), Math.cos(a) * w * 0.5, w * 0.075, Math.sin(a) * w * 0.5));
    }
  } else if (tier === 2) {
    g.add(mk(geo('cylinder', w * 0.5, w * 0.5, 0.005, 16), mat(0xddcc99), 0, 0.003, 0));
    g.add(mk(geo('cylinder', w * 0.7, w * 0.7, w * 0.4, 16, 1, true), mats.wall, 0, w * 0.2, 0));
    g.add(mk(geo('cylinder', w * 0.85, w * 0.7, w * 0.15, 16, 1, true), mats.wall, 0, w * 0.4 + w * 0.075, 0));
    const fp = flagPole(w * 0.5, w * 0.12, w * 0.08, 0x8b0000);
    fp.position.set(w * 0.75, 0, 0);
    g.add(fp);
    // Dust particle anchor
    const dust = new THREE.Object3D();
    dust.name = 'particle-dust';
    dust.position.set(0, 0.01, 0);
    g.add(dust);
  } else if (tier === 3) {
    g.add(mk(geo('cylinder', w * 0.6, w * 0.6, 0.005, 16), mat(0xddcc99), 0, 0.003, 0));
    g.add(mk(geo('cylinder', w * 0.9, w * 0.85, w * 0.6, 20, 1, true), mats.wall, 0, w * 0.3, 0));
    g.add(mk(geo('cylinder', w * 1.0, w * 0.9, w * 0.2, 20, 1, true), mats.wall, 0, w * 0.6 + w * 0.1, 0));
    for (const a of [0, Math.PI]) {
      g.add(mk(geo('box', w * 0.15, w * 0.3, 0.01), mat(0x444444, { metalness: 0.5 }), Math.cos(a) * w * 0.85, w * 0.15, Math.sin(a) * w * 0.85));
    }
    // Dust particle anchor
    const dust = new THREE.Object3D();
    dust.name = 'particle-dust';
    dust.position.set(0, 0.01, 0);
    g.add(dust);
  } else {
    g.add(mk(geo('cylinder', w * 0.7, w * 0.7, 0.005, 16), mat(0xddcc99), 0, 0.003, 0));
    g.add(mk(geo('cylinder', w * 1.1, w * 1.05, w * 0.8, 24, 1, true), mats.wall, 0, w * 0.4, 0));
    g.add(mk(geo('cylinder', w * 1.2, w * 1.1, w * 0.3, 24, 1, true), mats.wall, 0, w * 0.8 + w * 0.15, 0));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      g.add(mk(geo('cylinder', 0.01, 0.01, w * 0.2, 6), mat(0xaabbff, { transparent: true, opacity: 0.25, emissive: 0xaabbff, emissiveIntensity: 0.3 }), Math.cos(a) * w * 0.3, w * 0.1, Math.sin(a) * w * 0.3));
    }
    // Dust particle anchor
    const dust = new THREE.Object3D();
    dust.name = 'particle-dust';
    dust.position.set(0, 0.01, 0);
    g.add(dust);
  }
  const sfxArena = new THREE.Object3D();
  sfxArena.name = 'sound-crowd';
  sfxArena.position.set(0, w * 0.2, 0);
  g.add(sfxArena);
  return g;
}

function buildSanctuary(tier, w, rng, mats) {
  const g = new THREE.Group();
  if (tier <= 1) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.add(mk(geo('cylinder', 0.008, 0.01, w * 0.15, 5), mat(STONE_GREY), Math.cos(a) * w * 0.35, w * 0.075, Math.sin(a) * w * 0.35));
    }
    g.add(mk(geo('circle', w * 0.1, 6), mat(0x9966ff, { emissive: 0x9966ff, emissiveIntensity: 0.4, side: THREE.DoubleSide }), 0, 0.003, 0, -Math.PI / 2));
    const anchor = new THREE.Object3D();
    anchor.name = 'particle-sanctuary';
    anchor.position.set(0, 0.01, 0);
    g.add(anchor);
  } else if (tier === 2) {
    g.add(mk(geo('cylinder', w * 0.6, w * 0.65, w * 0.05, 8), mat(0xe6e6fa), 0, w * 0.025, 0));
    g.add(mk(geo('cylinder', w * 0.5, w * 0.5, w * 0.5, 8), mat(0xe6e6fa), 0, w * 0.05 + w * 0.25, 0));
    g.add(domeRoof(w * 0.55, w * 0.55, mat(0x9370db)));
    g.add(mk(geo('cylinder', w * 0.15, w * 0.15, 0.005, 12), mat(0x3366aa, { transparent: true, opacity: 0.6 }), w * 0.5, 0.003, w * 0.3));
  } else if (tier === 3) {
    g.add(mk(geo('cylinder', w * 0.7, w * 0.75, w * 0.06, 8), mat(0xe6e6fa), 0, w * 0.03, 0));
    g.add(mk(geo('cylinder', w * 0.6, w * 0.6, w * 0.7, 8), mat(0xe6e6fa, { transparent: true, opacity: 0.8 }), 0, w * 0.06 + w * 0.35, 0));
    const spire = coneRoof(w * 0.65, w * 0.5, mat(0x9370db, { metalness: 0.2 }));
    spire.position.y = w * 0.76;
    g.add(spire);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      g.add(mk(geo('sphere', 0.006, 4, 3), mat(GOLD_TRIM, { metalness: 0.6 }), Math.cos(a) * w * 0.4, w * 1.0, Math.sin(a) * w * 0.4));
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.add(mk(geo('plane', w * 0.08, w * 0.15), mat([0xff4444, 0x4488ff, 0x44ff44, 0xffff44, 0xff44ff, 0x44ffff, 0xff8844, 0x8844ff][i], { transparent: true, opacity: 0.4, emissive: [0xff4444, 0x4488ff, 0x44ff44, 0xffff44, 0xff44ff, 0x44ffff, 0xff8844, 0x8844ff][i], emissiveIntensity: 0.15, side: THREE.DoubleSide }), Math.cos(a) * w * 0.61, w * 0.4, Math.sin(a) * w * 0.61, 0, a + Math.PI / 2));
    }
  } else {
    g.add(mk(geo('cylinder', w * 0.8, w * 0.85, w * 0.07, 8), mat(0xe6e6fa), 0, w * 0.035, 0));
    g.add(mk(geo('cylinder', w * 0.7, w * 0.7, w * 0.9, 8), mat(0xe6e6fa, { transparent: true, opacity: 0.6 }), 0, w * 0.07 + w * 0.45, 0));
    const spire = coneRoof(w * 0.75, w * 0.7, mat(0x9370db, { metalness: 0.3 }));
    spire.position.y = w * 0.97;
    g.add(spire);
    g.add(mk(geo('sphere', w * 0.9, 12, 8), mat(0xaaaaff, { transparent: true, opacity: 0.08, emissive: 0xaaaaff, emissiveIntensity: 0.3, side: THREE.DoubleSide }), 0, w * 0.6, 0));
    g.add(mk(geo('plane', w * 2, w * 0.3), mat(0x44ffaa, { transparent: true, opacity: 0.15, emissive: 0x44ffaa, emissiveIntensity: 0.4, side: THREE.DoubleSide }), 0, w * 1.8, 0));
    const anchor = new THREE.Object3D();
    anchor.name = 'particle-sanctuary';
    anchor.position.set(0, 0.05, 0);
    g.add(anchor);
  }
  const sfxSanctuary = new THREE.Object3D();
  sfxSanctuary.name = 'sound-chime';
  sfxSanctuary.position.set(0, w * 0.3, 0);
  g.add(sfxSanctuary);
  return g;
}

function buildObservatory(tier, w, rng, mats) {
  const g = new THREE.Group();
  if (tier <= 1) {
    g.add(mk(geo('box', w * 0.5, w * 0.3, w * 0.5), mat(WOOD_BROWN), 0, w * 0.15, 0));
    g.add(mk(geo('cylinder', 0.003, 0.005, w * 0.2, 6), mat(0x886633), 0, w * 0.3 + w * 0.1, 0, 0.5));
  } else if (tier === 2) {
    g.add(mk(geo('cylinder', w * 0.35, w * 0.4, w * 0.7, 8), mats.wall, 0, w * 0.35, 0));
    const dome = domeRoof(w * 0.4, w * 0.7, mat(0xb87333, { metalness: 0.4, roughness: 0.5 }));
    dome.name = 'rotating-dome';
    g.add(dome);
    g.add(mk(geo('cylinder', 0.008, 0.005, w * 0.2, 6), mat(0x886633, { metalness: 0.3 }), w * 0.1, w * 0.85, 0, 0, 0, 0.5));
  } else if (tier === 3) {
    g.add(mk(geo('cylinder', w * 0.4, w * 0.45, w * 1.0, 8), mats.wall, 0, w * 0.5, 0));
    g.add(mk(geo('cylinder', w * 0.3, w * 0.4, w * 0.5, 8), mats.wall, 0, w * 1.0 + w * 0.25, 0));
    const dome = domeRoof(w * 0.35, w * 1.5, mat(0xb87333, { metalness: 0.4 }));
    dome.name = 'rotating-dome';
    g.add(dome);
    for (let i = 0; i < 3; i++) {
      const r = w * (0.15 + i * 0.05);
      g.add(mk(geo('torus', r, 0.002, 4, 16), mat(0xb87333, { metalness: 0.5 }), 0, w * 0.6, 0, Math.PI / 2 + i * 0.4));
    }
    for (let i = 0; i < 3; i++) {
      g.add(mk(geo('sphere', 0.006, 4, 3), mat([0x4488ff, 0xff8844, 0x88ff44][i]), w * (0.15 + i * 0.05), w * 0.6, 0));
    }
    // Starlight particle anchor
    const starlight = new THREE.Object3D();
    starlight.name = 'particle-starlight';
    starlight.position.set(0, w * 1.5, 0);
    g.add(starlight);
  } else {
    g.add(mk(geo('cylinder', w * 0.5, w * 0.55, w * 1.3, 10), mats.wall, 0, w * 0.65, 0));
    g.add(mk(geo('cylinder', w * 0.35, w * 0.5, w * 0.6, 10), mats.wall, 0, w * 1.3 + w * 0.3, 0));
    g.add(mk(geo('sphere', w * 0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.35), mat(0xb87333, { metalness: 0.5 }), 0, w * 1.9, 0));
    g.add(mk(geo('sphere', w * 0.2, 8, 6), mat(0x1122aa, { emissive: 0x4466ff, emissiveIntensity: 0.8 }), 0, w * 1.5, 0));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.add(mk(geo('sphere', 0.003, 3, 2), mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 1.0 }), Math.cos(a) * w * 0.15, w * 1.5 + Math.sin(a * 2) * 0.03, Math.sin(a) * w * 0.15));
    }
    // Starlight particle anchor
    const starlight = new THREE.Object3D();
    starlight.name = 'particle-starlight';
    starlight.position.set(0, w * 1.9, 0);
    g.add(starlight);
  }
  const sfxObservatory = new THREE.Object3D();
  sfxObservatory.name = 'sound-mechanical';
  sfxObservatory.position.set(0, w * 0.6, 0);
  g.add(sfxObservatory);
  return g;
}

function buildTreasury(tier, w, rng, mats) {
  const g = new THREE.Group();
  if (tier <= 1) {
    g.add(mk(geo('box', w * 0.4, w * 0.25, w * 0.2), mat(WOOD_BROWN), 0, w * 0.125, 0));
    g.add(mk(geo('cylinder', 0.003, 0.003, w * 0.15, 4), mat(0x888833), 0, w * 0.25 + w * 0.075, 0));
    g.add(mk(geo('box', w * 0.12, 0.003, 0.003), mat(0x888833), 0, w * 0.4, 0));
    g.add(mk(geo('cylinder', w * 0.03, w * 0.03, 0.002, 6), mat(0x888833), -w * 0.05, w * 0.37, 0));
    g.add(mk(geo('cylinder', w * 0.03, w * 0.03, 0.002, 6), mat(0x888833), w * 0.05, w * 0.37, 0));
  } else if (tier === 2) {
    g.add(stoneBase(w * 1.0, w * 0.7, w * 0.05, mats.floor));
    g.add(mk(geo('box', w * 1.0, w * 0.5, w * 0.7), mats.wall, 0, w * 0.05 + w * 0.25, 0));
    const roof = gableRoof(w * 1.1, w * 0.8, w * 0.25, mats.roof, rng);
    roof.position.y = w * 0.55;
    g.add(roof);
    for (let i = 0; i < 3; i++) {
      g.add(mk(geo('box', w * 0.06, 0.005, w * 0.03), mat(GOLD_TRIM, { metalness: 0.6 }), -w * 0.2 + i * w * 0.2, 0.003, -w * 0.4));
    }
  } else if (tier === 3) {
    g.add(stoneBase(w * 1.3, w * 0.9, w * 0.06, mat(0xddddcc)));
    g.add(mk(geo('box', w * 1.3, w * 0.7, w * 0.9), mat(0xddddcc), 0, w * 0.06 + w * 0.35, 0));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        g.add(mk(geo('cylinder', w * 0.04, w * 0.04, w * 0.7, 8), mat(0xddddcc), sx * w * 0.55, w * 0.06 + w * 0.35, sz * w * 0.35));
      }
    }
    const roof = gableRoof(w * 1.4, w * 1.0, w * 0.3, mat(0xccbb99), rng);
    roof.position.y = w * 0.76;
    g.add(roof);
    g.add(mk(geo('sphere', w * 0.06, 6, 4), mat(GOLD_TRIM, { metalness: 0.8, roughness: 0.2 }), 0, w * 1.06, 0));
  } else {
    g.add(stoneBase(w * 1.5, w * 1.1, w * 0.07, mat(0xddddcc)));
    g.add(mk(geo('box', w * 1.5, w * 0.8, w * 1.1), mat(0xddddcc), 0, w * 0.07 + w * 0.4, 0));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        g.add(mk(geo('cylinder', w * 0.05, w * 0.05, w * 0.8, 8), mat(0xddddcc), sx * w * 0.65, w * 0.07 + w * 0.4, sz * w * 0.45));
      }
    }
    const roof = gableRoof(w * 1.6, w * 1.2, w * 0.35, mat(GOLD_TRIM, { metalness: 0.6, roughness: 0.3 }), rng);
    roof.position.y = w * 0.87;
    g.add(roof);
    g.add(mk(geo('cone', w * 0.3, w * 0.3, 8), mat(GOLD_TRIM, { metalness: 0.7, roughness: 0.3 }), 0, w * 0.2, -w * 0.7));
    g.add(mk(geo('box', w * 0.3, w * 0.15, w * 0.6), mat(0x336633, { emissive: 0x224422, emissiveIntensity: 0.1 }), 0, w * 0.35, -w * 0.7));
    const anchor = new THREE.Object3D();
    anchor.name = 'particle-gold';
    anchor.position.set(0, w * 0.5, -w * 0.7);
    g.add(anchor);
  }
  const sfxTreasury = new THREE.Object3D();
  sfxTreasury.name = 'sound-coins';
  sfxTreasury.position.set(0, w * 0.3, 0);
  g.add(sfxTreasury);
  return g;
}

function buildCitadel(tier, w, rng, mats) {
  const g = new THREE.Group();
  if (tier <= 1) {
    g.add(mk(geo('box', w * 0.4, w * 0.7, w * 0.4), mats.wall, 0, w * 0.35, 0));
    const roofCren = flatRoof(w * 0.5, w * 0.5, w * 0.02, mats.roof, true);
    roofCren.position.y = w * 0.7;
    g.add(roofCren);
    g.add(mk(geo('cone', 0.008, w * 0.08, 6), mat(0xaa8844), w * 0.2, w * 0.6, 0, 0, 0, Math.PI / 2));
  } else if (tier === 2) {
    g.add(mk(geo('box', w * 0.8, w * 0.8, w * 0.8), mats.wall, 0, w * 0.4, 0));
    const roofCren2 = flatRoof(w * 0.9, w * 0.9, w * 0.025, mats.roof, true);
    roofCren2.position.y = w * 0.8;
    g.add(roofCren2);
    const bridge = mk(geo('box', w * 0.3, 0.005, w * 0.4), mat(WOOD_BROWN), 0, 0.003, -w * 0.6);
    bridge.name = 'drawbridge';
    g.add(bridge);
    g.add(mk(geo('ring', w * 0.5, w * 0.6, 16), mat(0x336699, { transparent: true, opacity: 0.4, side: THREE.DoubleSide }), 0, 0.002, 0, -Math.PI / 2));
  } else if (tier === 3) {
    g.add(mk(geo('box', w * 1.2, w * 0.9, w * 1.2), mats.wall, 0, w * 0.45, 0));
    const roof = flatRoof(w * 1.3, w * 1.3, w * 0.025, mats.roof, true);
    roof.position.y = w * 0.9;
    g.add(roof);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const t = turret(w * 0.12, w * 0.5, mats.wall, mats.roof);
      t.position.set(sx * w * 0.6, w * 0.6, sz * w * 0.6);
      g.add(t);
    }
    g.add(mk(geo('box', w * 0.35, w * 0.5, w * 0.35), mats.wall, 0, w * 0.9 + w * 0.25, 0));
    const centerRoof = flatRoof(w * 0.4, w * 0.4, w * 0.02, mats.roof, true);
    centerRoof.position.y = w * 1.4;
    g.add(centerRoof);
    const fp = flagPole(w * 0.3, w * 0.15, w * 0.1, 0x2244aa);
    fp.name = 'stance-banner';
    fp.position.set(0, w * 1.4, 0);
    g.add(fp);
  } else {
    g.add(mk(geo('box', w * 1.5, w * 1.0, w * 1.5), mats.wall, 0, w * 0.5, 0));
    const roof = flatRoof(w * 1.6, w * 1.6, w * 0.03, mats.roof, true);
    roof.position.y = w * 1.0;
    g.add(roof);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const t = turret(w * 0.15, w * 0.7, mats.wall, mats.roof);
      t.position.set(sx * w * 0.7, w * 0.7, sz * w * 0.7);
      g.add(t);
    }
    g.add(mk(geo('box', w * 0.4, w * 1.5, w * 0.4), mats.wall, 0, w * 1.0 + w * 0.75, 0));
    const towerTop = coneRoof(w * 0.35, w * 0.4, mat(SLATE_GREY, { metalness: 0.2 }));
    towerTop.position.y = w * 2.5;
    g.add(towerTop);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + rng() * 0.5;
      g.add(mk(geo('box', 0.003, w * 0.3, 0.003), mat(0x88aaff, { emissive: 0x88aaff, emissiveIntensity: 0.8 }), Math.cos(a) * w * 0.15, w * 2.6 + rng() * w * 0.2, Math.sin(a) * w * 0.15, rng() * 0.5, 0, rng() * 0.5));
    }
    g.add(mk(geo('sphere', w * 0.5, 6, 4), mat(0xccccdd, { transparent: true, opacity: 0.3 }), 0, w * 2.3, 0));
    const fp = flagPole(w * 0.3, w * 0.2, w * 0.12, 0x2244aa);
    fp.name = 'stance-banner';
    fp.position.set(0, w * 2.9, 0);
    g.add(fp);
    // Lightning particle anchor
    const lightning = new THREE.Object3D();
    lightning.name = 'particle-lightning';
    lightning.position.set(0, w * 2.6, 0);
    g.add(lightning);
  }
  const sfxCitadel = new THREE.Object3D();
  sfxCitadel.name = 'sound-guards';
  sfxCitadel.position.set(0, w * 0.1, -w * 0.5);
  g.add(sfxCitadel);
  return g;
}

// ═══════════════════════════════════════════════════════
//  Phase 6 buildings — Camp, Mine, Catacombs, Farm, Stables, Infirmary
// ═══════════════════════════════════════════════════════

function buildCamp(tier, w, rng, mats) {
  const g = new THREE.Group();
  const canvasMat = mat(0xeeeecc);
  const poleMat = mat(WOOD_BROWN);
  if (tier <= 1) {
    // Simple tent
    const tentShape = new THREE.Shape();
    tentShape.moveTo(-w * 0.4, 0);
    tentShape.lineTo(0, w * 0.35);
    tentShape.lineTo(w * 0.4, 0);
    tentShape.closePath();
    let tentGeo = new THREE.ExtrudeGeometry(tentShape, { depth: w * 0.5, bevelEnabled: false });
    tentGeo.userData._owned = true;
    g.add(mk(tentGeo, canvasMat, 0, 0, -w * 0.25));
    // Training dummy
    g.add(mk(geo('cylinder', 0.004, 0.004, w * 0.25, 6), poleMat, w * 0.5, w * 0.125, 0));
    g.add(mk(geo('box', w * 0.08, w * 0.06, 0.004), mat(0xccaa77), w * 0.5, w * 0.2, 0));
    // Campfire
    g.add(mk(geo('cylinder', w * 0.06, w * 0.08, 0.005, 8), mat(STONE_DARK), -w * 0.3, 0.003, w * 0.3));
    const campfire = new THREE.Object3D();
    campfire.name = 'particle-campfire';
    campfire.position.set(-w * 0.3, 0.02, w * 0.3);
    g.add(campfire);
  } else if (tier === 2) {
    // Two tents + weapon rack
    for (const sx of [-1, 1]) {
      const tentShape = new THREE.Shape();
      tentShape.moveTo(-w * 0.35, 0);
      tentShape.lineTo(0, w * 0.3);
      tentShape.lineTo(w * 0.35, 0);
      tentShape.closePath();
      let tentGeo = new THREE.ExtrudeGeometry(tentShape, { depth: w * 0.45, bevelEnabled: false });
      tentGeo.userData._owned = true;
      g.add(mk(tentGeo, canvasMat, sx * w * 0.4, 0, -w * 0.22));
    }
    // Weapon rack
    g.add(mk(geo('box', w * 0.3, w * 0.25, 0.006), poleMat, 0, w * 0.125, -w * 0.5));
    for (let i = 0; i < 3; i++) {
      g.add(mk(geo('box', 0.003, w * 0.2, 0.003), mat(0x888888, { metalness: 0.5 }), -w * 0.08 + i * w * 0.08, w * 0.1, -w * 0.51));
    }
    // Campfire
    g.add(mk(geo('cylinder', w * 0.08, w * 0.1, 0.006, 8), mat(STONE_DARK), 0, 0.003, w * 0.3));
    const campfire = new THREE.Object3D();
    campfire.name = 'particle-campfire';
    campfire.position.set(0, 0.02, w * 0.3);
    g.add(campfire);
  } else if (tier === 3) {
    // Palisade wall section + larger tent
    g.add(stoneBase(w * 1.4, w * 0.8, w * 0.03, mats.floor));
    const tentShape = new THREE.Shape();
    tentShape.moveTo(-w * 0.5, 0);
    tentShape.lineTo(0, w * 0.45);
    tentShape.lineTo(w * 0.5, 0);
    tentShape.closePath();
    let tentGeo = new THREE.ExtrudeGeometry(tentShape, { depth: w * 0.6, bevelEnabled: false });
    tentGeo.userData._owned = true;
    g.add(mk(tentGeo, canvasMat, 0, w * 0.03, -w * 0.3));
    // Palisade stakes
    for (let i = 0; i < 6; i++) {
      g.add(mk(geo('cylinder', 0.005, 0.003, w * 0.35, 5), poleMat, -w * 0.6 + i * w * 0.25, w * 0.175, -w * 0.55));
    }
    const fp = flagPole(w * 0.5, w * 0.12, w * 0.08, 0xcc2222);
    fp.position.set(w * 0.6, 0, 0);
    g.add(fp);
  } else {
    // Fortified camp with watchtower
    g.add(stoneBase(w * 1.6, w, w * 0.05, mats.floor));
    const tentShape = new THREE.Shape();
    tentShape.moveTo(-w * 0.55, 0);
    tentShape.lineTo(0, w * 0.5);
    tentShape.lineTo(w * 0.55, 0);
    tentShape.closePath();
    let tentGeo = new THREE.ExtrudeGeometry(tentShape, { depth: w * 0.7, bevelEnabled: false });
    tentGeo.userData._owned = true;
    g.add(mk(tentGeo, mat(0xddddbb), 0, w * 0.05, -w * 0.35));
    // Watchtower
    g.add(mk(geo('box', w * 0.2, w * 0.8, w * 0.2), mats.wall, w * 0.7, w * 0.4, 0));
    const towerRoof = flatRoof(w * 0.3, w * 0.3, w * 0.02, mats.roof, true);
    towerRoof.position.set(w * 0.7, w * 0.8, 0);
    g.add(towerRoof);
    const fp = flagPole(w * 0.6, w * 0.15, w * 0.1, 0xcc2222);
    fp.position.set(w * 0.7, w * 0.8, 0);
    g.add(fp);
  }
  const sfxCamp = new THREE.Object3D();
  sfxCamp.name = 'sound-camp';
  sfxCamp.position.set(0, w * 0.1, 0);
  g.add(sfxCamp);
  return g;
}

function buildMine(tier, w, rng, mats) {
  const g = new THREE.Group();
  const rockMat = mat(0x6e6e6e, { roughness: 0.95 });
  const oreMat = mat(0xaa8833, { metalness: 0.4 });
  if (tier <= 1) {
    // Cave entrance arch
    g.add(mk(geo('box', w * 0.5, w * 0.4, w * 0.15), rockMat, 0, w * 0.2, 0));
    g.add(mk(geo('box', w * 0.25, w * 0.3, w * 0.15), mat(0x222222), 0, w * 0.15, -0.005));
    // Support beams
    for (const sx of [-1, 1]) {
      g.add(mk(geo('cylinder', 0.004, 0.005, w * 0.35, 5), mat(WOOD_BROWN), sx * w * 0.2, w * 0.175, w * 0.02));
    }
    g.add(mk(geo('box', w * 0.45, 0.005, 0.005), mat(WOOD_BROWN), 0, w * 0.35, w * 0.02));
    // Ore pile
    g.add(mk(geo('sphere', w * 0.08, 5, 3), oreMat, w * 0.35, w * 0.04, w * 0.2));
  } else if (tier === 2) {
    g.add(stoneBase(w * 1.0, w * 0.7, w * 0.04, mats.floor));
    // Larger cave entrance
    g.add(mk(geo('box', w * 0.7, w * 0.55, w * 0.2), rockMat, 0, w * 0.04 + w * 0.275, 0));
    g.add(mk(geo('box', w * 0.35, w * 0.4, w * 0.2), mat(0x1a1a1a), 0, w * 0.04 + w * 0.2, -0.005));
    // Minecart tracks
    for (const dz of [-0.005, 0.005]) {
      g.add(mk(geo('box', w * 0.8, 0.002, 0.003), mat(0x888888, { metalness: 0.5 }), 0, 0.001, w * 0.4 + dz));
    }
    // Minecart
    g.add(mk(geo('box', w * 0.12, w * 0.08, w * 0.1), mat(WOOD_BROWN), w * 0.25, w * 0.04, w * 0.4));
    g.add(mk(geo('sphere', w * 0.06, 4, 3), oreMat, w * 0.25, w * 0.1, w * 0.4));
    // Ore pile
    for (let i = 0; i < 3; i++) {
      g.add(mk(geo('sphere', w * 0.06 + rng() * w * 0.03, 4, 3), oreMat, w * 0.4 + rng() * w * 0.1, w * 0.03, -w * 0.2 + rng() * w * 0.15));
    }
  } else if (tier === 3) {
    g.add(stoneBase(w * 1.3, w * 0.9, w * 0.05, mats.floor));
    // Mine building
    g.add(mk(geo('box', w * 0.8, w * 0.6, w * 0.6), mats.wall, 0, w * 0.05 + w * 0.3, 0));
    const roof = gableRoof(w * 0.9, w * 0.7, w * 0.2, mats.roof, rng);
    roof.position.y = w * 0.65;
    g.add(roof);
    // Mine shaft entrance
    g.add(mk(geo('box', w * 0.3, w * 0.35, w * 0.1), mat(0x1a1a1a), 0, w * 0.175, -w * 0.35));
    // Ore cart tracks extending out
    for (const dz of [-0.005, 0.005]) {
      g.add(mk(geo('box', w * 1.4, 0.002, 0.003), mat(0x888888, { metalness: 0.5 }), 0, 0.001, w * 0.5 + dz));
    }
    // Conveyor/elevator structure
    g.add(mk(geo('box', w * 0.15, w * 0.8, w * 0.15), mats.wall, w * 0.5, w * 0.4, 0));
    g.add(mk(geo('torus', w * 0.1, 0.003, 4, 8), mat(0x666666, { metalness: 0.5 }), w * 0.5, w * 0.8, 0, Math.PI / 2));
  } else {
    g.add(stoneBase(w * 1.5, w * 1.0, w * 0.06, mats.floor));
    g.add(mk(geo('box', w * 1.0, w * 0.7, w * 0.8), mats.wall, 0, w * 0.06 + w * 0.35, 0));
    const roof = gableRoof(w * 1.1, w * 0.9, w * 0.25, mats.roof, rng);
    roof.position.y = w * 0.76;
    g.add(roof);
    // Elevator tower
    g.add(mk(geo('box', w * 0.2, w * 1.2, w * 0.2), mats.wall, w * 0.6, w * 0.6, 0));
    g.add(mk(geo('torus', w * 0.12, 0.004, 6, 10), mat(GOLD_TRIM, { metalness: 0.6 }), w * 0.6, w * 1.2, 0, Math.PI / 2));
    // Glowing ore veins
    for (let i = 0; i < 4; i++) {
      g.add(mk(geo('sphere', w * 0.04, 4, 3), mat(0xffaa33, { emissive: 0xffaa33, emissiveIntensity: 0.5 }), -w * 0.3 + rng() * w * 0.6, w * 0.03, w * 0.55 + rng() * w * 0.1));
    }
    const anchor = new THREE.Object3D();
    anchor.name = 'particle-dust';
    anchor.position.set(0, w * 0.3, -w * 0.4);
    g.add(anchor);
  }
  const sfxMine = new THREE.Object3D();
  sfxMine.name = 'sound-mining';
  sfxMine.position.set(0, w * 0.2, 0);
  g.add(sfxMine);
  return g;
}

function buildCatacombs(tier, w, rng, mats) {
  const g = new THREE.Group();
  const rockMat = mat(0x5a5a58, { roughness: 0.95 });
  const darkRockMat = mat(0x3d3d3b, { roughness: 1.0 });
  const darkStoneMat = mat(0x3d3d5c, { roughness: 0.95 });
  const ironMat = mat(0x444444, { roughness: 0.4, metalness: 0.7 });
  const voidMat = mat(0x060608, { roughness: 1.0 });
  const boneMat = mat(0xddddcc);

  // ── Cracked stone ground (replaces green pad visually) ──
  const groundMat = mat(0x4a4a48, { roughness: 1.0 });
  g.add(mk(geo('cylinder', w * 0.8, w * 0.7, 0.008, 8), groundMat, 0, 0.004, 0));

  // ── Surrounding boulders — natural rock formations ──
  const boulderPositions = [
    { x: -w * 0.45, z: w * 0.15, sx: w * 0.25, sy: w * 0.2, sz: w * 0.2, ry: 0.4 },
    { x: w * 0.45,  z: w * 0.1,  sx: w * 0.22, sy: w * 0.22, sz: w * 0.18, ry: -0.6 },
    { x: -w * 0.3,  z: w * 0.35, sx: w * 0.18, sy: w * 0.28, sz: w * 0.2, ry: 0.8 },
    { x: w * 0.35,  z: w * 0.3,  sx: w * 0.2,  sy: w * 0.3,  sz: w * 0.18, ry: -0.3 },
    { x: -w * 0.5,  z: -w * 0.1, sx: w * 0.15, sy: w * 0.12, sz: w * 0.15, ry: 1.2 },
    { x: w * 0.5,   z: -w * 0.15,sx: w * 0.15, sy: w * 0.14, sz: w * 0.12, ry: -1.0 },
  ];
  // Rear wall of rock — taller, forms the "mountain face"
  g.add(mk(geo('box', w * 0.9, w * 0.5, w * 0.3), rockMat, 0, w * 0.25, w * 0.3, 0, 0, 0));
  // Irregularity on the rear wall
  g.add(mk(geo('box', w * 0.4, w * 0.35, w * 0.2), darkRockMat, -w * 0.15, w * 0.18, w * 0.35, 0, 0.2, 0));
  g.add(mk(geo('box', w * 0.35, w * 0.4, w * 0.2), rockMat, w * 0.2, w * 0.2, w * 0.38, 0, -0.15, 0));
  // Top overhang
  g.add(mk(geo('box', w * 0.7, w * 0.12, w * 0.4), darkRockMat, 0, w * 0.48, w * 0.2, 0.1, 0, 0));

  for (const b of boulderPositions) {
    g.add(mk(geo('box', b.sx, b.sy, b.sz), rng() > 0.5 ? rockMat : darkRockMat, b.x, b.sy / 2, b.z, 0, b.ry, 0));
  }
  // Smaller rubble stones scattered around entrance
  for (let i = 0; i < 6; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = w * 0.3 + rng() * w * 0.4;
    const sz = w * 0.04 + rng() * w * 0.06;
    g.add(mk(geo('box', sz, sz * 0.6, sz * 0.8), darkRockMat,
      Math.cos(angle) * dist, sz * 0.3, Math.sin(angle) * dist - w * 0.1, rng() * 0.3, rng() * 1.5, 0));
  }

  // ── Cave mouth / dark void ──
  const archW = w * 0.28;
  const archH = w * 0.38;
  g.add(mk(geo('box', archW, archH, w * 0.15), voidMat, 0, archH / 2, w * 0.08));

  // ── Stone arch frame around the opening ──
  const frameMat = darkStoneMat;
  const frameT = w * 0.05;
  // Left pillar
  g.add(mk(geo('box', frameT, archH, frameT * 1.5), frameMat, -archW / 2 - frameT / 2, archH / 2, 0));
  // Right pillar
  g.add(mk(geo('box', frameT, archH, frameT * 1.5), frameMat, archW / 2 + frameT / 2, archH / 2, 0));
  // Lintel / keystone
  g.add(mk(geo('box', archW + frameT * 2, frameT * 1.2, frameT * 1.5), frameMat, 0, archH + frameT * 0.5, 0));
  // Keystone accent
  g.add(mk(geo('box', frameT * 0.8, frameT * 1.4, frameT * 0.6), rockMat, 0, archH + frameT * 0.6, -frameT * 0.3));

  // ── Descending stairs into the void ──
  const stairMat = mat(0x3a3a3a, { roughness: 0.9 });
  const stairCount = tier >= 3 ? 7 : tier >= 2 ? 6 : 5;
  const stairW = archW * 0.9;
  for (let i = 0; i < stairCount; i++) {
    g.add(mk(geo('box', stairW, 0.005, w * 0.04), stairMat,
      0, -i * 0.008 - 0.002, w * 0.02 - i * w * 0.045));
  }

  if (tier >= 2) {
    // ── Iron gate bars across entrance ──
    const barCount = 5;
    const barSpacing = archW / (barCount + 1);
    for (let i = 1; i <= barCount; i++) {
      g.add(mk(geo('cylinder', 0.002, 0.002, archH * 0.9, 4), ironMat,
        -archW / 2 + i * barSpacing, archH * 0.45, -0.005));
    }
    // Horizontal bar
    g.add(mk(geo('cylinder', 0.003, 0.003, archW, 4), ironMat, 0, archH * 0.7, -0.005, 0, 0, Math.PI / 2));
  }

  // ── Braziers / torches on each side ──
  for (const sx of [-1, 1]) {
    const bx = sx * (archW / 2 + w * 0.12);
    if (tier >= 3) {
      // Stone brazier
      g.add(mk(geo('cylinder', w * 0.03, w * 0.025, w * 0.03, 6), darkStoneMat, bx, w * 0.015, -w * 0.04));
      g.add(mk(geo('cylinder', w * 0.015, w * 0.035, w * 0.015, 6), darkStoneMat, bx, w * 0.038, -w * 0.04));
      const fire = new THREE.Object3D();
      fire.name = 'particle-fire';
      fire.position.set(bx, w * 0.06, -w * 0.04);
      g.add(fire);
    } else {
      // Wooden torch on pole
      g.add(mk(geo('cylinder', 0.004, 0.004, w * 0.3, 5), mat(WOOD_DARK), bx, w * 0.15, -w * 0.02));
      g.add(mk(geo('sphere', 0.007, 5, 4), boneMat, bx, w * 0.32, -w * 0.02));
      const torch = new THREE.Object3D();
      torch.name = 'particle-torch';
      torch.position.set(bx, w * 0.35, -w * 0.02);
      g.add(torch);
    }
  }

  if (tier >= 3) {
    // ── Glowing runes on the lintel ──
    const runeMat = mat(0x6644aa, { emissive: 0x6644aa, emissiveIntensity: 0.6, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) {
      g.add(mk(geo('ring', w * 0.015, w * 0.025, 6), runeMat,
        -w * 0.06 + i * w * 0.06, archH + frameT * 0.5, -frameT * 0.8, 0, 0, 0));
    }
    // Ground rune circle in front of entrance
    g.add(mk(geo('ring', w * 0.12, w * 0.15, 8), runeMat, 0, 0.005, -w * 0.2, -Math.PI / 2));
  }

  if (tier >= 4) {
    // ── Soul glow emanating from the depths ──
    g.add(mk(geo('sphere', w * 0.2, 6, 4), mat(0x6644aa, {
      transparent: true, opacity: 0.15, emissive: 0x6644aa, emissiveIntensity: 0.5, side: THREE.DoubleSide
    }), 0, w * 0.15, w * 0.05));
    const anchor = new THREE.Object3D();
    anchor.name = 'particle-souls';
    anchor.position.set(0, w * 0.2, w * 0.05);
    g.add(anchor);
    // Skull decorations on the arch pillars
    for (const sx of [-1, 1]) {
      g.add(mk(geo('sphere', 0.008, 5, 4), boneMat, sx * (archW / 2 + frameT / 2), archH * 0.65, -frameT * 0.5));
    }
  }

  const sfxCatacombs = new THREE.Object3D();
  sfxCatacombs.name = 'sound-echoes';
  sfxCatacombs.position.set(0, w * 0.1, 0);
  g.add(sfxCatacombs);
  return g;
}

function buildFarm(tier, w, rng, mats) {
  const g = new THREE.Group();
  const soilMat = mat(0x5a4020, { roughness: 1.0 });
  const cropMat = mat(0x7caa2d);
  const fenceMat = mat(WOOD_BROWN);
  if (tier <= 1) {
    // Crop rows
    g.add(mk(geo('box', w * 0.8, 0.004, w * 0.6), soilMat, 0, 0.002, 0));
    for (let i = 0; i < 5; i++) {
      g.add(mk(geo('box', 0.004, w * 0.06, w * 0.5), cropMat, -w * 0.3 + i * w * 0.15, w * 0.03, 0));
    }
    // Scarecrow
    g.add(mk(geo('cylinder', 0.003, 0.003, w * 0.3, 5), fenceMat, w * 0.5, w * 0.15, 0));
    g.add(mk(geo('box', w * 0.15, 0.004, 0.004), fenceMat, w * 0.5, w * 0.25, 0));
    g.add(mk(geo('sphere', 0.008, 5, 4), mat(0xccaa77), w * 0.5, w * 0.32, 0));
  } else if (tier === 2) {
    // Larger field + small barn
    g.add(mk(geo('box', w * 1.2, 0.005, w * 0.7), soilMat, 0, 0.003, w * 0.15));
    for (let i = 0; i < 7; i++) {
      g.add(mk(geo('box', 0.004, w * 0.08, w * 0.6), cropMat, -w * 0.5 + i * w * 0.17, w * 0.04, w * 0.15));
    }
    // Small barn
    g.add(mk(geo('box', w * 0.5, w * 0.35, w * 0.4), mats.wall, 0, w * 0.175, -w * 0.5));
    const roof = gableRoof(w * 0.55, w * 0.45, w * 0.15, mats.roof, rng);
    roof.position.y = w * 0.35;
    roof.position.z = -w * 0.5;
    g.add(roof);
    // Fence
    for (let i = 0; i < 6; i++) {
      g.add(mk(geo('cylinder', 0.003, 0.003, w * 0.15, 4), fenceMat, -w * 0.6 + i * w * 0.25, w * 0.075, w * 0.55));
    }
    g.add(mk(geo('box', w * 1.2, 0.003, 0.003), fenceMat, 0, w * 0.1, w * 0.55));
  } else if (tier === 3) {
    g.add(stoneBase(w * 1.5, w * 1.0, w * 0.03, mats.floor));
    // Large field
    g.add(mk(geo('box', w * 1.3, 0.005, w * 0.6), soilMat, 0, w * 0.03 + 0.003, w * 0.2));
    for (let i = 0; i < 9; i++) {
      const h = w * 0.08 + rng() * w * 0.04;
      g.add(mk(geo('box', 0.004, h, w * 0.5), cropMat, -w * 0.55 + i * w * 0.14, w * 0.03 + h / 2, w * 0.2));
    }
    // Barn with loft
    g.add(mk(geo('box', w * 0.7, w * 0.5, w * 0.5), mats.wall, 0, w * 0.03 + w * 0.25, -w * 0.45));
    const roof = gableRoof(w * 0.8, w * 0.6, w * 0.2, mats.roof, rng);
    roof.position.set(0, w * 0.53, -w * 0.45);
    g.add(roof);
    // Windmill blades placeholder (simple cross)
    g.add(mk(geo('cylinder', 0.004, 0.004, w * 0.6, 5), mats.wall, -w * 0.65, w * 0.3, 0));
    g.add(mk(geo('box', 0.004, w * 0.3, 0.004), mats.accent, -w * 0.65, w * 0.55, 0));
    g.add(mk(geo('box', 0.004, 0.004, w * 0.3), mats.accent, -w * 0.65, w * 0.55, 0));
  } else {
    g.add(stoneBase(w * 1.8, w * 1.2, w * 0.04, mats.floor));
    // Bountiful fields
    g.add(mk(geo('box', w * 1.5, 0.006, w * 0.7), soilMat, 0, w * 0.04 + 0.003, w * 0.25));
    for (let i = 0; i < 11; i++) {
      const h = w * 0.1 + rng() * w * 0.05;
      g.add(mk(geo('box', 0.005, h, w * 0.6), mat(0x88bb33), -w * 0.65 + i * w * 0.13, w * 0.04 + h / 2, w * 0.25));
    }
    // Grand barn
    g.add(mk(geo('box', w * 0.9, w * 0.6, w * 0.6), mats.wall, 0, w * 0.04 + w * 0.3, -w * 0.5));
    const roof = gableRoof(w * 1.0, w * 0.7, w * 0.25, mats.roof, rng);
    roof.position.set(0, w * 0.64, -w * 0.5);
    g.add(roof);
    // Windmill tower
    g.add(mk(geo('cylinder', w * 0.1, w * 0.12, w * 0.8, 6), mats.wall, -w * 0.8, w * 0.4, 0));
    g.add(mk(geo('cone', w * 0.15, w * 0.15, 6), mats.roof, -w * 0.8, w * 0.8 + w * 0.075, 0));
    // Golden wheat glow
    g.add(mk(geo('box', w * 1.6, 0.002, w * 0.75), mat(0xddcc44, { emissive: 0xddcc44, emissiveIntensity: 0.15, transparent: true, opacity: 0.4 }), 0, w * 0.13, w * 0.25));
  }
  const sfxFarm = new THREE.Object3D();
  sfxFarm.name = 'sound-farm';
  sfxFarm.position.set(0, w * 0.05, 0);
  g.add(sfxFarm);
  return g;
}

function buildStables(tier, w, rng, mats) {
  const g = new THREE.Group();
  const hayMat = mat(0xccbb66);
  const fenceMat = mat(WOOD_BROWN);
  if (tier <= 1) {
    // Simple pen with fence
    g.add(mk(geo('box', w * 0.7, 0.004, w * 0.5), mat(0x8a7040, { roughness: 1.0 }), 0, 0.002, 0));
    // Fence posts + rails
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 0, 1]) {
        g.add(mk(geo('cylinder', 0.003, 0.003, w * 0.15, 4), fenceMat, sx * w * 0.35, w * 0.075, sz * w * 0.2));
      }
      g.add(mk(geo('box', 0.003, 0.003, w * 0.5), fenceMat, sx * w * 0.35, w * 0.1, 0));
    }
    // Hay bale
    g.add(mk(geo('box', w * 0.12, w * 0.08, w * 0.1), hayMat, w * 0.15, w * 0.04, w * 0.15));
    // Hitching post
    g.add(mk(geo('cylinder', 0.004, 0.004, w * 0.2, 5), fenceMat, -w * 0.45, w * 0.1, 0));
    g.add(mk(geo('box', w * 0.08, 0.004, 0.004), fenceMat, -w * 0.45, w * 0.18, 0));
  } else if (tier === 2) {
    g.add(stoneBase(w * 1.1, w * 0.7, w * 0.03, mats.floor));
    // Stable building
    g.add(mk(geo('box', w * 0.9, w * 0.4, w * 0.5), mats.wall, 0, w * 0.03 + w * 0.2, 0));
    const roof = gableRoof(w * 1.0, w * 0.6, w * 0.2, mats.roof, rng);
    roof.position.y = w * 0.43;
    g.add(roof);
    // Stall doors
    for (let i = 0; i < 3; i++) {
      g.add(mk(geo('box', w * 0.15, w * 0.25, DOOR_DEPTH), mat(WOOD_DARK), -w * 0.25 + i * w * 0.25, w * 0.03 + w * 0.125, -w * 0.26));
    }
    // Hay bales
    for (let i = 0; i < 2; i++) {
      g.add(mk(geo('box', w * 0.12, w * 0.1, w * 0.12), hayMat, w * 0.55 + i * w * 0.15, w * 0.05, -w * 0.15 + i * w * 0.15));
    }
    // Trough
    g.add(mk(geo('box', w * 0.3, w * 0.06, w * 0.08), mat(WOOD_DARK), -w * 0.5, w * 0.03, w * 0.35));
  } else if (tier === 3) {
    g.add(stoneBase(w * 1.4, w * 0.9, w * 0.04, mats.floor));
    // Main stable
    g.add(mk(geo('box', w * 1.1, w * 0.55, w * 0.6), mats.wall, 0, w * 0.04 + w * 0.275, 0));
    const roof = gableRoof(w * 1.2, w * 0.7, w * 0.25, mats.roof, rng);
    roof.position.y = w * 0.59;
    g.add(roof);
    // Paddock fence
    for (let i = 0; i < 5; i++) {
      g.add(mk(geo('cylinder', 0.004, 0.004, w * 0.2, 4), fenceMat, -w * 0.55 + i * w * 0.28, w * 0.1, w * 0.55));
    }
    g.add(mk(geo('box', w * 1.1, 0.003, 0.003), fenceMat, 0, w * 0.14, w * 0.55));
    g.add(mk(geo('box', w * 1.1, 0.003, 0.003), fenceMat, 0, w * 0.06, w * 0.55));
    // Saddle rack
    g.add(mk(geo('box', w * 0.15, w * 0.2, 0.006), fenceMat, w * 0.65, w * 0.1, -w * 0.2));
    g.add(mk(geo('box', w * 0.12, w * 0.04, w * 0.06), mat(0x8b4513), w * 0.65, w * 0.2, -w * 0.2));
  } else {
    g.add(stoneBase(w * 1.6, w * 1.1, w * 0.05, mats.floor));
    // Grand stables
    g.add(mk(geo('box', w * 1.3, w * 0.65, w * 0.8), mats.wall, 0, w * 0.05 + w * 0.325, 0));
    const roof = gableRoof(w * 1.4, w * 0.9, w * 0.3, mats.roof, rng);
    roof.position.y = w * 0.7;
    g.add(roof);
    // Clock tower / cupola
    g.add(mk(geo('box', w * 0.15, w * 0.4, w * 0.15), mats.wall, 0, w * 0.7 + w * 0.2, 0));
    g.add(mk(geo('cone', w * 0.12, w * 0.15, 4), mats.roof, 0, w * 1.1 + w * 0.075, 0));
    // Weathervane
    g.add(mk(geo('cylinder', 0.002, 0.002, w * 0.15, 4), mat(0x888888, { metalness: 0.5 }), 0, w * 1.25, 0));
    // Large paddock
    for (let i = 0; i < 7; i++) {
      g.add(mk(geo('cylinder', 0.004, 0.004, w * 0.25, 4), fenceMat, -w * 0.75 + i * w * 0.25, w * 0.125, w * 0.7));
    }
    g.add(mk(geo('box', w * 1.5, 0.003, 0.003), fenceMat, 0, w * 0.18, w * 0.7));
    g.add(mk(geo('box', w * 1.5, 0.003, 0.003), fenceMat, 0, w * 0.08, w * 0.7));
    // Decorative horse shoe
    g.add(mk(geo('torus', w * 0.05, 0.004, 4, 6, Math.PI), mat(GOLD_TRIM, { metalness: 0.6 }), 0, w * 0.5, -w * 0.41));
  }
  const sfxStables = new THREE.Object3D();
  sfxStables.name = 'sound-horses';
  sfxStables.position.set(0, w * 0.1, 0);
  g.add(sfxStables);
  return g;
}

function buildInfirmary(tier, w, rng, mats) {
  const g = new THREE.Group();
  const whiteMat = mat(0xeeeee8);
  const crossMat = mat(0xcc2222);
  const herbMat = mat(0x55aa44);
  if (tier <= 1) {
    // White tent
    const tentShape = new THREE.Shape();
    tentShape.moveTo(-w * 0.4, 0);
    tentShape.lineTo(0, w * 0.35);
    tentShape.lineTo(w * 0.4, 0);
    tentShape.closePath();
    let tentGeo = new THREE.ExtrudeGeometry(tentShape, { depth: w * 0.5, bevelEnabled: false });
    tentGeo.userData._owned = true;
    g.add(mk(tentGeo, whiteMat, 0, 0, -w * 0.25));
    // Red cross on tent
    g.add(mk(geo('box', w * 0.06, w * 0.12, 0.003), crossMat, 0, w * 0.2, -w * 0.26));
    g.add(mk(geo('box', w * 0.12, w * 0.06, 0.003), crossMat, 0, w * 0.2, -w * 0.26));
    // Small herb patch
    g.add(mk(geo('box', w * 0.3, 0.004, w * 0.2), mat(0x4a6b35), w * 0.4, 0.002, 0));
    for (let i = 0; i < 4; i++) {
      g.add(mk(geo('sphere', 0.005, 4, 3), herbMat, w * 0.3 + rng() * w * 0.2, 0.008, -w * 0.08 + rng() * w * 0.16));
    }
  } else if (tier === 2) {
    g.add(stoneBase(w * 1.0, w * 0.7, w * 0.04, mats.floor));
    // White building
    g.add(mk(geo('box', w * 0.8, w * 0.45, w * 0.55), whiteMat, 0, w * 0.04 + w * 0.225, 0));
    const roof = gableRoof(w * 0.9, w * 0.65, w * 0.2, mats.roof, rng);
    roof.position.y = w * 0.49;
    g.add(roof);
    // Red cross banner
    const fp = flagPole(w * 0.4, w * 0.12, w * 0.08, 0xeeeeee);
    fp.position.set(w * 0.5, 0, 0);
    g.add(fp);
    // Red cross on flag area
    g.add(mk(geo('box', 0.005, w * 0.04, 0.003), crossMat, w * 0.5 + w * 0.06, w * 0.38, 0));
    g.add(mk(geo('box', w * 0.04, 0.005, 0.003), crossMat, w * 0.5 + w * 0.06, w * 0.38, 0));
    // Herb garden
    g.add(mk(geo('box', w * 0.4, 0.005, w * 0.25), mat(0x4a6b35), -w * 0.4, 0.003, w * 0.35));
    for (let i = 0; i < 6; i++) {
      g.add(mk(geo('sphere', 0.006, 4, 3), herbMat, -w * 0.55 + rng() * w * 0.3, 0.01, w * 0.28 + rng() * w * 0.15));
    }
    // Cot visible through doorway
    g.add(mk(geo('box', w * 0.2, 0.005, w * 0.08), whiteMat, w * 0.15, w * 0.08, -w * 0.29));
  } else if (tier === 3) {
    g.add(stoneBase(w * 1.3, w * 0.9, w * 0.05, mats.floor));
    // Main infirmary building
    g.add(mk(geo('box', w * 1.0, w * 0.6, w * 0.7), whiteMat, 0, w * 0.05 + w * 0.3, 0));
    const roof = gableRoof(w * 1.1, w * 0.8, w * 0.25, mats.roof, rng);
    roof.position.y = w * 0.65;
    g.add(roof);
    // Windows with warm glow
    for (let i = 0; i < 3; i++) {
      const win = mk(geo('box', w * 0.06, w * 0.08, WINDOW_DEPTH), mat(0xffeecc, { emissive: 0xffeecc, emissiveIntensity: 0.2 }), -w * 0.3 + i * w * 0.3, w * 0.4, -w * 0.36);
      win.name = 'window';
      g.add(win);
    }
    // Red cross emblem on facade
    g.add(mk(geo('box', w * 0.06, w * 0.12, 0.004), crossMat, 0, w * 0.55, -w * 0.36));
    g.add(mk(geo('box', w * 0.12, w * 0.06, 0.004), crossMat, 0, w * 0.55, -w * 0.36));
    // Herb garden
    g.add(mk(geo('box', w * 0.5, 0.006, w * 0.3), mat(0x4a6b35), w * 0.5, w * 0.05 + 0.003, w * 0.4));
    for (let i = 0; i < 8; i++) {
      g.add(mk(geo('sphere', 0.007, 4, 3), herbMat, w * 0.3 + rng() * w * 0.4, w * 0.05 + 0.012, w * 0.3 + rng() * w * 0.2));
    }
  } else {
    g.add(stoneBase(w * 1.5, w * 1.1, w * 0.06, mats.floor));
    // Grand hospital
    g.add(mk(geo('box', w * 1.2, w * 0.75, w * 0.9), whiteMat, 0, w * 0.06 + w * 0.375, 0));
    const roof = gableRoof(w * 1.3, w * 1.0, w * 0.3, mats.roof, rng);
    roof.position.y = w * 0.81;
    g.add(roof);
    // Chapel wing
    g.add(mk(geo('box', w * 0.3, w * 0.9, w * 0.3), whiteMat, w * 0.7, w * 0.45, 0));
    g.add(mk(geo('cone', w * 0.18, w * 0.3, 4), mats.roof, w * 0.7, w * 0.9 + w * 0.15, 0));
    // Glowing healing aura
    g.add(mk(geo('sphere', w * 0.4, 8, 6), mat(0xc8a2c8, { transparent: true, opacity: 0.12, emissive: 0xc8a2c8, emissiveIntensity: 0.3, side: THREE.DoubleSide }), 0, w * 0.5, 0));
    // Grand red cross
    g.add(mk(geo('box', w * 0.08, w * 0.18, 0.005), crossMat, 0, w * 0.65, -w * 0.46));
    g.add(mk(geo('box', w * 0.18, w * 0.08, 0.005), crossMat, 0, w * 0.65, -w * 0.46));
    // Herb garden
    g.add(mk(geo('box', w * 0.6, 0.006, w * 0.4), mat(0x4a6b35), -w * 0.5, w * 0.06 + 0.003, w * 0.5));
    for (let i = 0; i < 10; i++) {
      g.add(mk(geo('sphere', 0.008, 4, 3), herbMat, -w * 0.75 + rng() * w * 0.5, w * 0.06 + 0.014, w * 0.35 + rng() * w * 0.3));
    }
    const anchor = new THREE.Object3D();
    anchor.name = 'particle-healing';
    anchor.position.set(0, w * 0.5, 0);
    g.add(anchor);
  }
  const sfxInfirmary = new THREE.Object3D();
  sfxInfirmary.name = 'sound-healing';
  sfxInfirmary.position.set(0, w * 0.2, 0);
  g.add(sfxInfirmary);
  return g;
}

// ═══════════════════════════════════════════════════════
//  Building Registry — single source of truth
// ═══════════════════════════════════════════════════════

const BUILDING_REGISTRY = new Map([
  [0,  { name: 'Mansion',     builder: buildMansion,     tier: 1, color: 0xd4a574, district: 'noble',      ground: 'Manicured grass' }],
  [1,  { name: 'Barracks',    builder: buildBarracks,    tier: 1, color: 0x8b7355, district: 'military',   ground: 'Packed dirt' }],
  [2,  { name: 'Workshop',    builder: buildWorkshop,    tier: 1, color: 0xa0522d, district: 'mining',     ground: 'Rocky ground' }],
  [3,  { name: 'Vault',       builder: buildVault,       tier: 1, color: 0x708090, district: 'banking',    ground: 'Polished stone' }],
  [4,  { name: 'Dock',        builder: buildDock,        tier: 1, color: 0x8b7355, district: 'waterfront', ground: 'Wooden boardwalk' }],
  [5,  { name: 'Forge',       builder: buildForge,       tier: 2, color: 0x8b4513, district: 'smithing',   ground: 'Scorched stone' }],
  [6,  { name: 'Market',      builder: buildMarket,      tier: 2, color: 0xdaa520, district: 'bazaar',     ground: 'Cobblestone' }],
  [7,  { name: 'Academy',     builder: buildAcademy,     tier: 2, color: 0x4682b4, district: 'scholar',    ground: 'Clean stone' }],
  [8,  { name: 'Arena',       builder: buildArena,       tier: 2, color: 0xcd853f, district: 'pit',        ground: 'Sand floor' }],
  [9,  { name: 'Sanctuary',   builder: buildSanctuary,   tier: 3, color: 0xe6e6fa, district: 'grove',      ground: 'Mossy stone' }],
  [10, { name: 'Observatory', builder: buildObservatory, tier: 3, color: 0x2f4f4f, district: 'tower',      ground: 'Star-map stone' }],
  [11, { name: 'Treasury',    builder: buildTreasury,    tier: 3, color: 0xffd700, district: 'counting',   ground: 'Gold-veined marble' }],
  [12, { name: 'Citadel',     builder: buildCitadel,     tier: 3, color: 0x696969, district: 'fortress',   ground: 'Stone battlements' }],
  [13, { name: 'Camp',        builder: buildCamp,        tier: 1, color: 0x8b6914, district: 'military',   ground: 'Tent canvas' }],
  [14, { name: 'Mine',        builder: buildMine,        tier: 2, color: 0x6e6e6e, district: 'mining',     ground: 'Rocky gravel' }],
  [15, { name: 'Catacombs',   builder: buildCatacombs,   tier: 3, color: 0x3d3d5c, district: 'dungeon',    ground: 'Cracked stone' }],
  [16, { name: 'Farm',        builder: buildFarm,        tier: 1, color: 0x7caa2d, district: 'farming',    ground: 'Tilled earth' }],
  [17, { name: 'Stables',     builder: buildStables,     tier: 2, color: 0xa0724a, district: 'roads',      ground: 'Hay-strewn dirt' }],
  [18, { name: 'Infirmary',   builder: buildInfirmary,   tier: 3, color: 0xc8a2c8, district: 'healing',    ground: 'Herb garden' }],
]);

// Meshes excluded from static merge (must remain individually addressable)
const MERGE_EXCLUDE = new Set([
  'window', 'flag', 'waterwheel', 'drawbridge',
  'rotating-dome', 'select-ring', 'stance-banner',
]);

// ═══════════════════════════════════════════════════════
//  BuildingFactory
// ═══════════════════════════════════════════════════════

export class BuildingFactory {
  constructor(options = {}) {
    this._baseUnit = options.baseUnit || 0.12;
    this._seed = options.seed || 42;
    this._windowCache = new Map();
    this._anchorCache = new Map();
    this._soundCache = new Map();
  }

  /**
   * Set loaded PBR texture sets for building materials.
   * Call before creating buildings to get textured output.
   * Falls back to flat colors for any missing pack.
   *
   * @param {Map<string, object>} textureMap — packName → PBR set from TextureManager.preloadBatch()
   */
  setTextures(textureMap) {
    _pbrSets = textureMap;
    // Clear cached tier materials so they rebuild with textures
    TIER_MATS.clear();
  }

  /**
   * Create a complete building mesh group.
   * @param {number} typeId 0-12
   * @param {number} level 1-20
   * @param {Object} [options]
   * @returns {THREE.Group}
   */
  createBuilding(typeId, level, options = {}) {
    const tier = visualTier(level);
    const w = this._baseUnit * (1 + Math.max(0, level - 1) * 0.03);
    const rng = mulberry32(typeId * 1000 + level * 100 + (options.seed || this._seed));
    let mats = tierMaterials(tier);

    // Apply per-building-type PBR overrides
    const overrides = BUILDING_OVERRIDES[typeId];
    if (overrides && _pbrSets) {
      mats = { ...mats };
      for (const [slot, pack] of Object.entries(overrides)) {
        const fallbackColor = mats[slot]?.color?.getHex?.() ?? 0x888888;
        const m = pbrMat(pack, fallbackColor);
        if (m) mats[slot] = m;
      }
    }

    // Apply per-slot texture overrides from layout config
    if (options.textureOverrides && _pbrSets) {
      mats = { ...mats };
      for (const [slot, pack] of Object.entries(options.textureOverrides)) {
        if (!pack) continue;
        const fallbackColor = mats[slot]?.color?.getHex?.() ?? 0x888888;
        const m = pbrMat(pack, fallbackColor);
        if (m) mats[slot] = m;
      }
    }

    const entry = BUILDING_REGISTRY.get(typeId);
    if (!entry) return new THREE.Group();

    const group = entry.builder(tier, w, rng, mats);
    group.name = `building-${entry.name.toLowerCase()}`;
    group.userData.typeId = typeId;
    group.userData.level = level;
    group.userData.buildingLevel = level;
    group.userData.tier = tier;

    // Add selection ring
    const ringRadius = w * 1.2;
    group.add(selectionRing(ringRadius));

    // Dock facing
    if (typeId === 4 && options.dockFacingAngle != null) {
      group.rotation.y = options.dockFacingAngle;
    }

    // Phase 5 — extract real window positions before merge
    this._extractWindows(group, typeId, level);

    // Phase 6 — extract particle anchors before merge
    this._extractAnchors(group, typeId, level);

    // Extract sound anchors before merge
    this._extractSounds(group, typeId, level);

    // Phase 4 — merge static meshes to reduce draw calls
    this._mergeStaticMeshes(group);

    // Phase 8 — construction visual: hide upper meshes at tier 0
    if (tier === 0) {
      const box = new THREE.Box3().setFromObject(group);
      const cutoff = box.min.y + (box.max.y - box.min.y) * 0.4;
      group.traverse((child) => {
        if (child.isMesh && child.name !== 'select-ring') {
          const meshBox = new THREE.Box3().setFromObject(child);
          if (meshBox.min.y > cutoff) child.visible = false;
        }
      });
    }

    return group;
  }

  /**
   * Get building metadata.
   */
  getBuildingInfo(typeId) {
    const entry = BUILDING_REGISTRY.get(typeId);
    return entry ? { name: entry.name, tier: entry.tier, color: entry.color, district: entry.district, ground: entry.ground } : null;
  }

  /**
   * Get visual tier from level.
   */
  getVisualTier(level) {
    return visualTier(level);
  }

  /**
   * Get window positions for night glow. Returns cached real positions extracted during createBuilding().
   */
  getWindowPositions(typeId, level) {
    const key = `${typeId}-${level}`;
    return this._windowCache.get(key) || [];
  }

  /**
   * Get particle anchor points. Returns cached real positions extracted during createBuilding().
   */
  getParticleAnchors(typeId, level) {
    const key = `${typeId}-${level}`;
    return this._anchorCache.get(key) || [];
  }

  /**
   * Get sound anchor points. Returns cached positions extracted during createBuilding().
   */
  getSoundAnchors(typeId, level) {
    const key = `${typeId}-${level}`;
    return this._soundCache.get(key) || [];
  }

  // ── Snow API ──

  /**
   * Set snow accumulation amount on all building materials.
   * @param {number} amount — 0 (no snow) to 1 (full coverage)
   */
  static setSnowAmount(amount) {
    _snowUniform.value = Math.max(0, Math.min(1, amount));
  }

  // ── Dispose API (Phase 3) ──

  /**
   * Dispose all cached geometries and materials. Called from TownRenderer.dispose().
   */
  dispose() {
    for (const [, g] of GEO_CACHE) g.dispose();
    GEO_CACHE.clear();
    for (const [, m] of MAT_CACHE) m.dispose();
    MAT_CACHE.clear();
    TIER_MATS.clear();
    _pbrSets = null;
    this._windowCache.clear();
    this._anchorCache.clear();
    this._soundCache.clear();
  }

  /**
   * Dispose owned geometries within a building group (deformed clones and merged geos).
   * Called from TownRenderer before rebuilding a building.
   * @param {THREE.Group} group
   */
  disposeBuilding(group) {
    group.traverse((child) => {
      if (child.isMesh && child.geometry && child.geometry.userData._owned) {
        child.geometry.dispose();
      }
    });
  }

  // ── Window extraction (Phase 5) ──

  /** @private */
  _extractWindows(group, typeId, level) {
    const key = `${typeId}-${level}`;
    if (this._windowCache.has(key)) return;
    const positions = [];
    const quat = new THREE.Quaternion();
    group.updateMatrixWorld(true);
    group.traverse((child) => {
      if (child.isMesh && child.name === 'window') {
        const pos = new THREE.Vector3();
        child.getWorldPosition(pos);
        const normal = new THREE.Vector3(0, 0, -1);
        child.getWorldQuaternion(quat);
        normal.applyQuaternion(quat);
        positions.push({ position: pos, normal });
      }
    });
    this._windowCache.set(key, positions);
  }

  // ── Anchor extraction (Phase 6) ──

  /** @private */
  _extractAnchors(group, typeId, level) {
    const key = `${typeId}-${level}`;
    if (this._anchorCache.has(key)) return;
    const anchors = [];
    const toRemove = [];
    group.updateMatrixWorld(true);
    group.traverse((child) => {
      if (child.isObject3D && !child.isMesh && child.name.startsWith('particle-')) {
        const pos = new THREE.Vector3();
        child.getWorldPosition(pos);
        const type = child.name.replace('particle-', '');
        anchors.push({ type, position: pos });
        toRemove.push(child);
      }
    });
    // Remove anchor Object3Ds from scene graph — positions are now cached
    for (const obj of toRemove) {
      if (obj.parent) obj.parent.remove(obj);
    }
    this._anchorCache.set(key, anchors);
  }

  // ── Sound extraction ──

  /** @private */
  _extractSounds(group, typeId, level) {
    const key = `${typeId}-${level}`;
    if (this._soundCache.has(key)) return;
    const sounds = [];
    const toRemove = [];
    group.updateMatrixWorld(true);
    group.traverse((child) => {
      if (child.isObject3D && !child.isMesh && child.name.startsWith('sound-')) {
        const pos = new THREE.Vector3();
        child.getWorldPosition(pos);
        const type = child.name.replace('sound-', '');
        sounds.push({ type, position: pos });
        toRemove.push(child);
      }
    });
    for (const obj of toRemove) {
      if (obj.parent) obj.parent.remove(obj);
    }
    this._soundCache.set(key, sounds);
  }

  // ── Mesh merging (Phase 4) ──

  /** @private */
  _mergeStaticMeshes(group) {
    group.updateMatrixWorld(true);
    const groupInverse = group.matrixWorld.clone().invert();

    // Collect meshes grouped by material
    const byMaterial = new Map();
    const toRemove = [];

    group.traverse((child) => {
      if (child === group) return;
      if (!child.isMesh) return;
      // Skip meshes that must remain individually addressable
      if (MERGE_EXCLUDE.has(child.name) ||
          child.name.startsWith('particle-') ||
          child.name.startsWith('floating-book-')) return;

      const matKey = child.material.uuid;
      if (!byMaterial.has(matKey)) {
        byMaterial.set(matKey, { material: child.material, meshes: [] });
      }
      byMaterial.get(matKey).meshes.push(child);
    });

    // Merge each material group
    for (const [, { material, meshes }] of byMaterial) {
      if (meshes.length <= 1) continue;

      const geos = [];
      for (const mesh of meshes) {
        const cloned = mesh.geometry.clone();
        // Bake transform relative to building root
        const relMatrix = mesh.matrixWorld.clone().premultiply(groupInverse);
        cloned.applyMatrix4(relMatrix);
        geos.push(cloned);
        toRemove.push(mesh);
      }

      // Normalize attributes: keep only attributes common to all geometries
      const commonAttrs = new Set(Object.keys(geos[0].attributes));
      for (let i = 1; i < geos.length; i++) {
        const attrs = Object.keys(geos[i].attributes);
        for (const a of commonAttrs) {
          if (!attrs.includes(a)) commonAttrs.delete(a);
        }
      }
      for (const g of geos) {
        for (const a of Object.keys(g.attributes)) {
          if (!commonAttrs.has(a)) g.deleteAttribute(a);
        }
      }

      // Normalize index: all must be indexed or all non-indexed
      const hasIndex = geos.map(g => g.index !== null);
      const mixedIndex = hasIndex.some(v => v) && hasIndex.some(v => !v);
      if (mixedIndex) {
        for (const g of geos) {
          if (g.index === null) g.setIndex([...Array(g.attributes.position.count).keys()]);
        }
      }

      let merged;
      try {
        merged = mergeGeometries(geos, false);
      } catch (_) {
        // Fallback: skip merge for this material group
        for (const g of geos) g.dispose();
        continue;
      }
      if (!merged) {
        for (const g of geos) g.dispose();
        continue;
      }
      merged.userData._owned = true;

      // Dispose temp clones
      for (const g of geos) g.dispose();

      const mergedMesh = new THREE.Mesh(merged, material);
      mergedMesh.castShadow = true;
      mergedMesh.receiveShadow = true;
      group.add(mergedMesh);
    }

    // Remove original meshes that were merged
    for (const mesh of toRemove) {
      if (mesh.parent) mesh.parent.remove(mesh);
    }

    // Prune empty intermediate groups
    const emptyGroups = [];
    group.traverse((child) => {
      if (child !== group && child.isGroup && child.children.length === 0) {
        emptyGroups.push(child);
      }
    });
    for (const empty of emptyGroups) {
      if (empty.parent) empty.parent.remove(empty);
    }
  }

}
