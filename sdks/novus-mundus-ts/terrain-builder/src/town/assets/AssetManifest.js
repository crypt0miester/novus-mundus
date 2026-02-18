/**
 * AssetManifest.js
 *
 * Comprehensive asset catalog for the town renderer. Every loadable resource
 * — buildings, props, vegetation, NPCs, animals, decorations, textures, and
 * audio — is declared here with its file path and metadata.
 *
 * Three.js 0.170.0 — vanilla ES module, no external dependencies.
 */

// ---------------------------------------------------------------------------
// Tier names mapped from numeric building level
// ---------------------------------------------------------------------------

const TIER_NAMES = ['foundation', 'established', 'grand', 'legendary'];

const TIER_LEVEL_MAP = {
  foundation: 0,
  established: 1,
  grand: 2,
  legendary: 3,
};

// ---------------------------------------------------------------------------
// Helper: generate building tiers for a given type
// ---------------------------------------------------------------------------

function makeBuildingTiers(type) {
  const tiers = {};
  for (let i = 0; i < 4; i++) {
    const tierName = TIER_NAMES[i];
    const tierNum = i + 1;
    tiers[tierName] = {
      model: `buildings/${type}_t${tierNum}.glb`,
      scale: 1.0,
      castShadow: true,
      receiveShadow: true,
    };
  }
  return tiers;
}

// ---------------------------------------------------------------------------
// Main manifest
// ---------------------------------------------------------------------------

export const ASSET_MANIFEST = {
  version: 1,
  basePath: './src/town/assets/',

  // -----------------------------------------------------------------------
  // Buildings — 19 types × 4 tiers each
  // -----------------------------------------------------------------------
  buildings: {
    mansion: {
      tiers: makeBuildingTiers('mansion'),
      props: ['chimney_smoke_anchor', 'window_glow_positions'],
      footprint: { width: 4, depth: 4 },
      category: 'residential',
    },
    barracks: {
      tiers: makeBuildingTiers('barracks'),
      props: ['flag_anchor', 'torch_positions'],
      footprint: { width: 5, depth: 4 },
      category: 'military',
    },
    workshop: {
      tiers: makeBuildingTiers('workshop'),
      props: ['gear_spin_anchor', 'smoke_vent_positions'],
      footprint: { width: 3, depth: 3 },
      category: 'production',
    },
    vault: {
      tiers: makeBuildingTiers('vault'),
      props: ['lock_glow_anchor', 'coin_particle_positions'],
      footprint: { width: 3, depth: 3 },
      category: 'economic',
    },
    dock: {
      tiers: makeBuildingTiers('dock'),
      props: ['rope_sway_anchor', 'lantern_positions', 'water_splash_anchor'],
      footprint: { width: 6, depth: 3 },
      category: 'maritime',
    },
    forge: {
      tiers: makeBuildingTiers('forge'),
      props: ['ember_particle_anchor', 'bellows_anim_anchor', 'heat_distortion_positions'],
      footprint: { width: 3, depth: 4 },
      category: 'production',
    },
    market: {
      tiers: makeBuildingTiers('market'),
      props: ['awning_sway_anchor', 'lantern_positions', 'crate_stack_positions'],
      footprint: { width: 5, depth: 5 },
      category: 'economic',
    },
    academy: {
      tiers: makeBuildingTiers('academy'),
      props: ['book_float_anchor', 'candle_glow_positions', 'globe_spin_anchor'],
      footprint: { width: 4, depth: 4 },
      category: 'knowledge',
    },
    arena: {
      tiers: makeBuildingTiers('arena'),
      props: ['banner_sway_anchors', 'torch_positions', 'dust_particle_anchor'],
      footprint: { width: 6, depth: 6 },
      category: 'military',
    },
    sanctuary: {
      tiers: makeBuildingTiers('sanctuary'),
      props: ['aura_glow_anchor', 'candle_positions', 'incense_particle_anchor'],
      footprint: { width: 4, depth: 5 },
      category: 'spiritual',
    },
    observatory: {
      tiers: makeBuildingTiers('observatory'),
      props: ['lens_glow_anchor', 'star_particle_positions', 'dome_rotate_anchor'],
      footprint: { width: 3, depth: 3 },
      category: 'knowledge',
    },
    treasury: {
      tiers: makeBuildingTiers('treasury'),
      props: ['coin_shimmer_anchor', 'vault_door_anim_anchor', 'gem_glow_positions'],
      footprint: { width: 4, depth: 4 },
      category: 'economic',
    },
    citadel: {
      tiers: makeBuildingTiers('citadel'),
      props: ['flag_anchor', 'torch_positions', 'gate_anim_anchor', 'crown_glow_anchor'],
      footprint: { width: 7, depth: 7 },
      category: 'military',
    },
    camp: {
      tiers: makeBuildingTiers('camp'),
      props: ['campfire_anchor', 'flag_anchor', 'torch_positions'],
      footprint: { width: 5, depth: 4 },
      category: 'military',
    },
    mine: {
      tiers: makeBuildingTiers('mine'),
      props: ['cart_track_anchor', 'lantern_positions', 'dust_particle_anchor'],
      footprint: { width: 4, depth: 4 },
      category: 'production',
    },
    catacombs: {
      tiers: makeBuildingTiers('catacombs'),
      props: ['mist_particle_anchor', 'torch_positions', 'glow_anchor'],
      footprint: { width: 4, depth: 3 },
      category: 'spiritual',
    },
    farm: {
      tiers: makeBuildingTiers('farm'),
      props: ['windmill_spin_anchor', 'crop_sway_positions', 'smoke_anchor'],
      footprint: { width: 5, depth: 5 },
      category: 'production',
    },
    stables: {
      tiers: makeBuildingTiers('stables'),
      props: ['hay_particle_anchor', 'lantern_positions', 'water_trough_anchor'],
      footprint: { width: 5, depth: 4 },
      category: 'military',
    },
    infirmary: {
      tiers: makeBuildingTiers('infirmary'),
      props: ['herb_sway_anchor', 'lantern_positions', 'smoke_anchor'],
      footprint: { width: 4, depth: 4 },
      category: 'knowledge',
    },
  },

  // -----------------------------------------------------------------------
  // Props
  // -----------------------------------------------------------------------
  props: {
    sign: {
      model: 'props/sign.glb',
      physics: 'pendulum',
      scale: 0.8,
      castShadow: true,
      receiveShadow: false,
      interactive: true,
    },
    barrel: {
      model: 'props/barrel.glb',
      physics: null,
      scale: 0.6,
      castShadow: true,
      receiveShadow: true,
      interactive: false,
    },
    crate: {
      model: 'props/crate.glb',
      physics: null,
      scale: 0.7,
      castShadow: true,
      receiveShadow: true,
      interactive: false,
    },
    cart: {
      model: 'props/cart.glb',
      physics: null,
      scale: 1.0,
      castShadow: true,
      receiveShadow: true,
      interactive: false,
    },
    well: {
      model: 'props/well.glb',
      physics: null,
      scale: 1.0,
      castShadow: true,
      receiveShadow: true,
      interactive: true,
      particleAnchor: 'water_ripple',
    },
    fence: {
      model: 'props/fence.glb',
      physics: null,
      scale: 1.0,
      castShadow: true,
      receiveShadow: false,
      interactive: false,
      tileable: true,
    },
    lamppost: {
      model: 'props/lamppost.glb',
      physics: null,
      scale: 1.2,
      castShadow: true,
      receiveShadow: false,
      interactive: false,
      lightAnchor: { type: 'point', color: 0xffe4b5, intensity: 0.6, distance: 8 },
    },
    banner: {
      model: 'props/banner.glb',
      physics: 'cloth',
      scale: 1.0,
      castShadow: false,
      receiveShadow: false,
      interactive: false,
    },
    campfire: {
      model: 'props/campfire.glb',
      physics: null,
      scale: 0.7,
      castShadow: false,
      receiveShadow: true,
      interactive: false,
      particleAnchor: 'fire_emitter',
      lightAnchor: { type: 'point', color: 0xff6622, intensity: 0.8, distance: 6 },
    },
    tent: {
      model: 'props/tent.glb',
      physics: null,
      scale: 1.2,
      castShadow: true,
      receiveShadow: true,
      interactive: false,
    },
    anvil: {
      model: 'props/anvil.glb',
      physics: null,
      scale: 0.5,
      castShadow: true,
      receiveShadow: true,
      interactive: true,
    },
    bellows: {
      model: 'props/bellows.glb',
      physics: 'pump',
      scale: 0.6,
      castShadow: true,
      receiveShadow: true,
      interactive: false,
    },
    bookshelf: {
      model: 'props/bookshelf.glb',
      physics: null,
      scale: 1.0,
      castShadow: true,
      receiveShadow: true,
      interactive: true,
    },
    telescope: {
      model: 'props/telescope.glb',
      physics: null,
      scale: 0.9,
      castShadow: true,
      receiveShadow: false,
      interactive: true,
    },
  },

  // -----------------------------------------------------------------------
  // Vegetation
  // -----------------------------------------------------------------------
  vegetation: {
    oak: {
      model: 'vegetation/oak.glb',
      scale: 1.5,
      castShadow: true,
      receiveShadow: false,
      windResponse: 0.3,
      canopyRadius: 3.0,
    },
    pine: {
      model: 'vegetation/pine.glb',
      scale: 1.8,
      castShadow: true,
      receiveShadow: false,
      windResponse: 0.15,
      canopyRadius: 1.8,
    },
    birch: {
      model: 'vegetation/birch.glb',
      scale: 1.4,
      castShadow: true,
      receiveShadow: false,
      windResponse: 0.4,
      canopyRadius: 2.2,
    },
    dead_tree: {
      model: 'vegetation/dead_tree.glb',
      scale: 1.3,
      castShadow: true,
      receiveShadow: false,
      windResponse: 0.0,
      canopyRadius: 0.0,
    },
    bush: {
      model: 'vegetation/bush.glb',
      scale: 0.6,
      castShadow: true,
      receiveShadow: true,
      windResponse: 0.2,
      canopyRadius: 0.8,
    },
    flower_patch: {
      model: 'vegetation/flower_patch.glb',
      scale: 0.4,
      castShadow: false,
      receiveShadow: true,
      windResponse: 0.5,
      canopyRadius: 0.0,
    },
  },

  // -----------------------------------------------------------------------
  // NPCs
  // -----------------------------------------------------------------------
  npcs: {
    villager: {
      model: 'npcs/villager.glb',
      animations: ['idle', 'walk', 'talk', 'wave'],
      scale: 1.0,
      castShadow: true,
      speed: 1.2,
      idleBehavior: 'wander',
      zones: ['residential', 'market'],
    },
    soldier: {
      model: 'npcs/soldier.glb',
      animations: ['idle', 'walk', 'patrol', 'salute', 'attack'],
      scale: 1.0,
      castShadow: true,
      speed: 1.5,
      idleBehavior: 'patrol',
      zones: ['barracks', 'gate', 'wall'],
    },
    merchant: {
      model: 'npcs/merchant.glb',
      animations: ['idle', 'walk', 'haggle', 'present_item'],
      scale: 1.0,
      castShadow: true,
      speed: 1.0,
      idleBehavior: 'stationary',
      zones: ['market', 'dock'],
    },
    scholar: {
      model: 'npcs/scholar.glb',
      animations: ['idle', 'walk', 'read', 'point_up'],
      scale: 1.0,
      castShadow: true,
      speed: 0.8,
      idleBehavior: 'wander',
      zones: ['academy', 'observatory'],
    },
    smith: {
      model: 'npcs/smith.glb',
      animations: ['idle', 'walk', 'hammer', 'wipe_brow'],
      scale: 1.1,
      castShadow: true,
      speed: 0.9,
      idleBehavior: 'stationary',
      zones: ['forge', 'workshop'],
    },
    monk: {
      model: 'npcs/monk.glb',
      animations: ['idle', 'walk', 'pray', 'meditate', 'bless'],
      scale: 1.0,
      castShadow: true,
      speed: 0.7,
      idleBehavior: 'stationary',
      zones: ['sanctuary'],
    },
    guard: {
      model: 'npcs/guard.glb',
      animations: ['idle', 'walk', 'stand_guard', 'challenge'],
      scale: 1.05,
      castShadow: true,
      speed: 1.3,
      idleBehavior: 'patrol',
      zones: ['gate', 'treasury', 'citadel'],
    },
    fisher: {
      model: 'npcs/fisher.glb',
      animations: ['idle', 'walk', 'cast_line', 'reel_in', 'sit'],
      scale: 1.0,
      castShadow: true,
      speed: 0.9,
      idleBehavior: 'stationary',
      zones: ['dock'],
    },
    gladiator: {
      model: 'npcs/gladiator.glb',
      animations: ['idle', 'walk', 'fight_stance', 'swing', 'victory'],
      scale: 1.1,
      castShadow: true,
      speed: 1.6,
      idleBehavior: 'wander',
      zones: ['arena'],
    },
    citizen: {
      model: 'npcs/citizen.glb',
      animations: ['idle', 'walk', 'talk', 'sit', 'cheer'],
      scale: 1.0,
      castShadow: true,
      speed: 1.1,
      idleBehavior: 'wander',
      zones: ['residential', 'market', 'sanctuary'],
    },
    stargazer: {
      model: 'npcs/stargazer.glb',
      animations: ['idle', 'walk', 'look_up', 'adjust_lens', 'write'],
      scale: 1.0,
      castShadow: true,
      speed: 0.7,
      idleBehavior: 'stationary',
      zones: ['observatory'],
    },
    visitor: {
      model: 'npcs/visitor.glb',
      animations: ['idle', 'walk', 'look_around', 'wave', 'sit'],
      scale: 1.0,
      castShadow: true,
      speed: 1.0,
      idleBehavior: 'wander',
      zones: ['gate', 'market', 'arena'],
    },
  },

  // -----------------------------------------------------------------------
  // Animals
  // -----------------------------------------------------------------------
  animals: {
    chicken: {
      model: 'animals/chicken.glb',
      animations: ['idle', 'walk', 'peck', 'flap'],
      scale: 0.3,
      castShadow: true,
      speed: 0.6,
      flockSize: { min: 3, max: 6 },
      zones: ['residential', 'market'],
    },
    horse: {
      model: 'animals/horse.glb',
      animations: ['idle', 'walk', 'trot', 'graze'],
      scale: 1.2,
      castShadow: true,
      speed: 2.0,
      flockSize: { min: 1, max: 3 },
      zones: ['barracks', 'gate'],
    },
    bird: {
      model: 'animals/bird.glb',
      animations: ['idle', 'fly', 'land', 'hop'],
      scale: 0.15,
      castShadow: false,
      speed: 3.0,
      flockSize: { min: 2, max: 8 },
      zones: ['residential', 'sanctuary', 'observatory'],
    },
    fish: {
      model: 'animals/fish.glb',
      animations: ['swim', 'jump', 'idle'],
      scale: 0.2,
      castShadow: false,
      speed: 1.0,
      flockSize: { min: 3, max: 10 },
      zones: ['dock'],
    },
  },

  // -----------------------------------------------------------------------
  // Decorations
  // -----------------------------------------------------------------------
  decorations: {
    fountain: {
      model: 'decorations/fountain.glb',
      scale: 1.2,
      castShadow: true,
      receiveShadow: true,
      particleAnchor: 'water_jet',
      soundAnchor: 'water_ambient',
    },
    arch: {
      model: 'decorations/arch.glb',
      scale: 1.5,
      castShadow: true,
      receiveShadow: false,
    },
    gate: {
      model: 'decorations/gate.glb',
      scale: 1.8,
      castShadow: true,
      receiveShadow: true,
      interactive: true,
      animations: ['open', 'close'],
    },
    wall_segment: {
      model: 'decorations/wall_segment.glb',
      scale: 1.0,
      castShadow: true,
      receiveShadow: true,
      tileable: true,
      snapPoints: ['left', 'right'],
    },
    cobblestone_ring: {
      model: 'decorations/cobblestone_ring.glb',
      scale: 1.0,
      castShadow: false,
      receiveShadow: true,
    },
    statue: {
      model: 'decorations/statue.glb',
      scale: 1.3,
      castShadow: true,
      receiveShadow: true,
      variants: ['hero', 'knight', 'scholar', 'king'],
    },
  },

  // -----------------------------------------------------------------------
  // Textures — PBR material packs + utility textures
  // Each PBR pack has maps: color, normal, roughness, ao, displacement,
  // and optionally metalness, emissive, opacity.
  // Convention: textures/{pack-name}/{pack-name}-{map-type}.jpg
  // -----------------------------------------------------------------------
  textures: {
    // ── Utility textures (non-PBR) ──
    terrain_noise: {
      path: 'textures/noise_256.png',
      format: 'rgb',
      wrapS: 'repeat',
      wrapT: 'repeat',
      generateMipmaps: true,
    },
    footprint_stamp: {
      path: 'textures/footprint.png',
      format: 'rgba',
      wrapS: 'clamp',
      wrapT: 'clamp',
      generateMipmaps: false,
    },
    particle_smoke: {
      path: 'textures/particle_smoke.png',
      format: 'rgba',
      wrapS: 'clamp',
      wrapT: 'clamp',
      generateMipmaps: false,
    },
    particle_fire: {
      path: 'textures/particle_fire.png',
      format: 'rgba',
      wrapS: 'clamp',
      wrapT: 'clamp',
      generateMipmaps: false,
    },

    // ── Water normals ──
    water_normal_1: { path: 'textures/water-normal/water-normal-1.jpg', wrapS: 'repeat', wrapT: 'repeat', generateMipmaps: true },
    water_normal_2: { path: 'textures/water-normal/water-normal-2.jpg', wrapS: 'repeat', wrapT: 'repeat', generateMipmaps: true },

    // ── PBR material packs (loaded via TextureManager.loadPBRSet) ──
    // Wood
    'wood-dark':        { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement', 'metalness'] },
    'wood-floor':       { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'wood-aged':        { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement', 'metalness'] },
    // Stone
    'stone-wall':       { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'stone-rubble':     { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'stone-paving':     { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'stone-cobble':     { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'stone-marble':     { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'stone-pebbles':    { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'stone-medieval':   { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'wall-stone-clean': { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'wall-block-rough': { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'wall-rock-stacked':{ pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'wall-castle-mixed':{ pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    // Brick
    'brick-classic':    { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'brick-castle-red': { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    // Plaster
    'plaster-white':    { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    // Roof
    'roof-thatch':      { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'roof-clay':        { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement', 'opacity'] },
    'roof-clay-warm':   { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'roof-slate':       { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement', 'opacity'] },
    // Tile
    'tile-floor':       { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    // Ground / Terrain
    'grass-lush':       { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'grass-wild':       { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'ground-dirt':      { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'ground-rocky':     { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'ground-forest':    { pack: true, maps: ['color', 'normal', 'roughness', 'displacement'] },
    'ground-sand':      { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'ground-gravel':    { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    // Rock
    'rock-aerial-light':{ pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'rock-aerial-dark': { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'rock-cliff':       { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'rock-mossy':       { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'terrain-rocky-light':{ pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'terrain-rocky-dark': { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    // Metal
    'metal-iron':       { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement', 'metalness'] },
    'metal-ornate':     { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'metal-gold-polished':{ pack: true, maps: ['color', 'normal', 'roughness', 'displacement', 'metalness'] },
    'metal-gold-worn':  { pack: true, maps: ['color', 'normal', 'roughness', 'displacement', 'metalness'] },
    // Snow
    'snow-fresh':       { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'snow-packed':      { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    // Fabric
    'fabric-corduroy':  { pack: true, maps: ['color', 'normal', 'roughness', 'displacement'] },
    'fabric-canvas':    { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement', 'metalness'] },
    'fabric-royal':     { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement'] },
    'fabric-suede':     { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement', 'metalness'] },
    'fabric-linen':     { pack: true, maps: ['color', 'normal', 'roughness', 'ao', 'displacement', 'metalness'] },
    // Lava
    'lava-cooled':      { pack: true, maps: ['color', 'normal', 'roughness', 'displacement', 'emissive'] },
    'lava-molten':      { pack: true, maps: ['color', 'normal', 'roughness', 'displacement', 'emissive'] },
    'lava-ember':       { pack: true, maps: ['color', 'normal', 'roughness', 'displacement', 'emissive'] },
  },

  // -----------------------------------------------------------------------
  // Audio (placeholder paths for future loading)
  // -----------------------------------------------------------------------
  audio: {
    ambient_town: {
      path: 'audio/ambient_town.ogg',
      loop: true,
      volume: 0.3,
      spatial: false,
    },
    ambient_market: {
      path: 'audio/ambient_market.ogg',
      loop: true,
      volume: 0.25,
      spatial: true,
      refDistance: 5,
      maxDistance: 30,
    },
    ambient_forge: {
      path: 'audio/ambient_forge.ogg',
      loop: true,
      volume: 0.35,
      spatial: true,
      refDistance: 3,
      maxDistance: 20,
    },
    ambient_water: {
      path: 'audio/ambient_water.ogg',
      loop: true,
      volume: 0.2,
      spatial: true,
      refDistance: 4,
      maxDistance: 25,
    },
    ambient_sanctuary: {
      path: 'audio/ambient_sanctuary.ogg',
      loop: true,
      volume: 0.15,
      spatial: true,
      refDistance: 3,
      maxDistance: 15,
    },
    sfx_footstep_stone: {
      path: 'audio/sfx_footstep_stone.ogg',
      loop: false,
      volume: 0.4,
      spatial: true,
      refDistance: 1,
      maxDistance: 10,
    },
    sfx_footstep_grass: {
      path: 'audio/sfx_footstep_grass.ogg',
      loop: false,
      volume: 0.3,
      spatial: true,
      refDistance: 1,
      maxDistance: 10,
    },
    sfx_door_open: {
      path: 'audio/sfx_door_open.ogg',
      loop: false,
      volume: 0.5,
      spatial: true,
      refDistance: 2,
      maxDistance: 15,
    },
    sfx_anvil_strike: {
      path: 'audio/sfx_anvil_strike.ogg',
      loop: false,
      volume: 0.6,
      spatial: true,
      refDistance: 3,
      maxDistance: 20,
    },
    sfx_crowd_cheer: {
      path: 'audio/sfx_crowd_cheer.ogg',
      loop: false,
      volume: 0.5,
      spatial: true,
      refDistance: 5,
      maxDistance: 40,
    },
    music_peaceful: {
      path: 'audio/music_peaceful.ogg',
      loop: true,
      volume: 0.2,
      spatial: false,
    },
    music_combat: {
      path: 'audio/music_combat.ogg',
      loop: true,
      volume: 0.25,
      spatial: false,
    },
  },
};

// ---------------------------------------------------------------------------
// Theme overrides — per-theme texture / model swaps
// ---------------------------------------------------------------------------

const THEME_OVERRIDES = {
  desert: {
    vegetation: {
      oak: { model: 'vegetation/themes/desert/palm.glb' },
      pine: { model: 'vegetation/themes/desert/cactus.glb' },
      birch: { model: 'vegetation/themes/desert/acacia.glb' },
      bush: { model: 'vegetation/themes/desert/scrub.glb' },
      flower_patch: { model: 'vegetation/themes/desert/desert_flower.glb' },
    },
    // Terrain texture swaps handled by TextureManager.THEME_SWAPS:
    //   grass-lush → ground-sand, ground-dirt → ground-sand, rock-cliff → rock-aerial-light
  },
  snow: {
    vegetation: {
      oak: { model: 'vegetation/themes/snow/snow_oak.glb' },
      birch: { model: 'vegetation/themes/snow/snow_birch.glb' },
      bush: { model: 'vegetation/themes/snow/snow_bush.glb' },
      flower_patch: { model: 'vegetation/themes/snow/frost_flower.glb' },
    },
    // Terrain texture swaps: grass-lush → snow-fresh, ground-dirt → snow-packed
  },
  swamp: {
    vegetation: {
      oak: { model: 'vegetation/themes/swamp/mangrove.glb' },
      pine: { model: 'vegetation/themes/swamp/cypress.glb' },
      birch: { model: 'vegetation/themes/swamp/willow.glb' },
      bush: { model: 'vegetation/themes/swamp/moss_bush.glb' },
      flower_patch: { model: 'vegetation/themes/swamp/lily_pad.glb' },
    },
    // Terrain texture swaps: grass-lush → ground-dirt, stone-wall → rock-mossy
  },
  volcanic: {
    vegetation: {
      oak: { model: 'vegetation/themes/volcanic/charred_tree.glb' },
      pine: { model: 'vegetation/themes/volcanic/obsidian_spire.glb' },
      birch: { model: 'vegetation/themes/volcanic/ash_tree.glb' },
      dead_tree: { model: 'vegetation/themes/volcanic/lava_tree.glb' },
      bush: { model: 'vegetation/themes/volcanic/ember_bush.glb' },
      flower_patch: { model: 'vegetation/themes/volcanic/fire_bloom.glb' },
    },
    // Terrain texture swaps: grass-lush → terrain-rocky-dark, stone-wall → rock-aerial-dark
  },
};

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

export { TIER_NAMES, TIER_LEVEL_MAP, THEME_OVERRIDES };

// ---------------------------------------------------------------------------
// Helper: resolve the full path for any asset
// ---------------------------------------------------------------------------

/**
 * Resolve the full file path for an asset given its category and id.
 *
 * @param {string} category  - One of: buildings, props, vegetation, npcs,
 *                             animals, decorations, textures, audio
 * @param {string} id        - The asset key within that category
 * @param {object} [options] - Optional overrides
 * @param {string} [options.basePath]  - Override the manifest basePath
 * @param {number} [options.tier]      - Tier index (0-3) for buildings
 * @param {string} [options.theme]     - Theme name for themed overrides
 * @returns {string} The resolved path
 */
export function getAssetPath(category, id, options = {}) {
  const basePath = options.basePath || ASSET_MANIFEST.basePath;
  const categoryData = ASSET_MANIFEST[category];
  if (!categoryData) {
    throw new Error(`Unknown asset category: "${category}"`);
  }

  const entry = categoryData[id];
  if (!entry) {
    throw new Error(`Unknown asset id "${id}" in category "${category}"`);
  }

  // Apply theme override if available
  if (options.theme && THEME_OVERRIDES[options.theme]) {
    const themeCategory = THEME_OVERRIDES[options.theme][category];
    if (themeCategory && themeCategory[id]) {
      const overrideEntry = themeCategory[id];
      const overridePath = overrideEntry.model || overrideEntry.path;
      if (overridePath) {
        return basePath + overridePath;
      }
    }
  }

  // Buildings require tier selection
  if (category === 'buildings') {
    const tierIndex = typeof options.tier === 'number' ? options.tier : 0;
    const tierName = TIER_NAMES[Math.min(Math.max(tierIndex, 0), 3)];
    const tierData = entry.tiers[tierName];
    return basePath + tierData.model;
  }

  // Textures use "path" instead of "model"
  if (entry.path) {
    return basePath + entry.path;
  }

  return basePath + entry.model;
}

// ---------------------------------------------------------------------------
// Helper: get building asset descriptor for a type and level
// ---------------------------------------------------------------------------

/**
 * Return the full building asset descriptor (model path, props,
 * footprint) for a building type at a given level.
 *
 * @param {string} typeId - The building type key (e.g. 'mansion', 'forge')
 * @param {number} level  - The building level (0-3)
 * @returns {object} { tierName, model, props, footprint, category,
 *                     scale, castShadow, receiveShadow }
 */
export function getBuildingAsset(typeId, level) {
  const building = ASSET_MANIFEST.buildings[typeId];
  if (!building) {
    throw new Error(`Unknown building type: "${typeId}"`);
  }

  const clampedLevel = Math.min(Math.max(Math.floor(level), 0), 3);
  const tierName = TIER_NAMES[clampedLevel];
  const tierData = building.tiers[tierName];

  return {
    typeId,
    tierName,
    level: clampedLevel,
    model: ASSET_MANIFEST.basePath + tierData.model,
    props: building.props,
    footprint: building.footprint,
    category: building.category,
    scale: tierData.scale,
    castShadow: tierData.castShadow,
    receiveShadow: tierData.receiveShadow,
  };
}

// ---------------------------------------------------------------------------
// Helper: return theme-specific overrides merged with default manifest data
// ---------------------------------------------------------------------------

/**
 * Merge theme-specific overrides onto the base manifest entries for every
 * affected category. Unaffected categories are returned unchanged.
 *
 * @param {string} theme - Theme name ('desert', 'snow', 'swamp', 'volcanic')
 * @returns {object} A shallow-merged manifest subset keyed by category, where
 *                   each entry in the affected categories carries the
 *                   theme-specific overrides applied on top of the defaults.
 *                   Returns the base manifest categories verbatim when the
 *                   theme is unknown or null.
 */
export function getAssetsForTheme(theme) {
  const base = {
    buildings: { ...ASSET_MANIFEST.buildings },
    props: { ...ASSET_MANIFEST.props },
    vegetation: { ...ASSET_MANIFEST.vegetation },
    npcs: { ...ASSET_MANIFEST.npcs },
    animals: { ...ASSET_MANIFEST.animals },
    decorations: { ...ASSET_MANIFEST.decorations },
    textures: { ...ASSET_MANIFEST.textures },
    audio: { ...ASSET_MANIFEST.audio },
  };

  if (!theme || !THEME_OVERRIDES[theme]) {
    return base;
  }

  const overrides = THEME_OVERRIDES[theme];

  for (const category of Object.keys(overrides)) {
    if (!base[category]) {
      continue;
    }
    for (const assetId of Object.keys(overrides[category])) {
      if (!base[category][assetId]) {
        continue;
      }
      base[category][assetId] = {
        ...base[category][assetId],
        ...overrides[category][assetId],
      };
    }
  }

  return base;
}
