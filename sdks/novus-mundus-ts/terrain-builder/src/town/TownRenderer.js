/**
 * TownRenderer — Main orchestrator for the living town view.
 *
 * Wires together all subsystems:
 *   - Terrain (heightmap, biome, water)
 *   - Layout (districts, roads, town square)
 *   - Buildings (factory, animator)
 *   - Atmosphere (day/night, weather, post-processing, daily windows)
 *   - Population (NPCs, animals, economy carts)
 *   - Vegetation (grass, trees, flowers)
 *   - Physics (props, cloth, water interaction)
 *   - Particles (GPU-driven shader particles)
 *   - Camera (isometric + transitions)
 *   - Audio (spatial three-layer soundscape)
 *
 * Consumes TownVisualState from TownStateManager and renders accordingly.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { TownTerrainBuilder } from './terrain/TownTerrainBuilder.js';
import { WaterSystem } from './terrain/WaterSystem.js';
import { BiomeShaderMaterial } from './terrain/BiomeShader.js';
import { DistrictSystem } from './layout/DistrictSystem.js';

import { TownSquare } from './layout/TownSquare.js';
import { BuildingFactory } from './buildings/BuildingFactory.js';
import { BuildingAnimator } from './buildings/BuildingAnimator.js';
import { DayNightCycle } from './atmosphere/DayNightCycle.js';
import { WeatherSystem } from './atmosphere/WeatherSystem.js';

import { DailyWindows } from './atmosphere/DailyWindows.js';
import { NPCManager } from './population/NPCManager.js';
import { AnimalSystem } from './population/AnimalSystem.js';
import { EconomyCartSystem } from './population/EconomyCarts.js';
import { GrassSystem } from './vegetation/GrassSystem.js';
import { TreeWindSystem } from './vegetation/TreeWind.js';
import { FlowerFieldSystem } from './vegetation/FlowerFields.js';
import { PropPhysicsSystem } from './physics/PropPhysics.js';
import { ClothSimulation } from './physics/ClothSimulation.js';
import { WaterInteraction } from './physics/WaterInteraction.js';
import { GPUParticleSystem } from './particles/GPUParticles.js';
import { IsometricCamera } from './camera/IsometricCamera.js';
import { CameraTransitions } from './camera/CameraTransitions.js';
import { AudioManager } from './audio/AudioManager.js';
import { FootprintSystem } from './terrain/FootprintSystem.js';
import { AssetLoader } from './assets/AssetLoader.js';
import { TextureManager } from './assets/TextureManager.js';
import { TownStateManager } from './TownStateManager.js';
import { createDecorationMesh } from './environment.js';

/** Kingdom theme enum for visual reskinning. */
const THEMES = {
  MEDIEVAL: 'medieval',
  CYBERPUNK: 'cyberpunk',
  SCIFI: 'scifi',
  MODERN: 'modern',
  POST_APOCALYPTIC: 'post-apocalyptic',
};

/** Manifest names for building types 0-18. */
const _BUILDING_MANIFEST_NAMES = [
  'mansion', 'barracks', 'workshop', 'vault', 'dock',
  'forge', 'market', 'academy', 'arena', 'sanctuary',
  'observatory', 'treasury', 'citadel',
  'camp', 'mine', 'catacombs', 'farm', 'stables', 'infirmary',
];

/** Map building level to asset tier index (0-3) matching AssetManifest tier convention. */
function _visualTierIndex(level) {
  if (level <= 5) return 0;   // foundation  → t1
  if (level <= 12) return 1;  // established → t2
  if (level <= 18) return 2;  // grand       → t3
  return 3;                   // legendary   → t4
}

/**
 * Population count for a given estate level.
 * @param {number} estateLevel Sum of all building levels.
 * @returns {number}
 */
function populationForLevel(estateLevel) {
  if (estateLevel <= 10) return Math.max(5, estateLevel * 2);
  if (estateLevel <= 25) return 20 + (estateLevel - 10) * 2.5;
  if (estateLevel <= 40) return 57 + (estateLevel - 25) * 4;
  if (estateLevel <= 55) return 117 + (estateLevel - 40) * 6;
  return Math.min(300, 207 + (estateLevel - 55) * 8);
}

// ═══════════════════════════════════════════════════════
//  Edge-mountain 9-point grid constants
// ═══════════════════════════════════════════════════════

/** Grid key → polar angle (degrees) + radius fraction of half-mesh. */
const MOUNTAIN_GRID = {
  TL: { angle: 225, radius: 0.80 },   // NW — screen top-left
  T:  { angle: 270, radius: 0.78 },   // N  — screen top
  TR: { angle: 315, radius: 0.80 },   // NE — screen top-right
  ML: { angle: 180, radius: 0.82 },   // W  — screen mid-left
  MR: { angle:   0, radius: 0.82 },   // E  — screen mid-right
  BL: { angle: 135, radius: 0.82 },   // SW — screen bottom-left
  B:  { angle:  90, radius: 0.85 },   // S  — screen bottom
  BR: { angle:  45, radius: 0.82 },   // SE — screen bottom-right
};

/** Fallback flat-color hex per rock texture pack. */
const ROCK_COLORS = {
  'rock-cliff':          0x6a6a5a,
  'rock-aerial-dark':    0x4a4a42,
  'rock-aerial-light':   0x8a8a7a,
  'rock-mossy':          0x5a6a4a,
  'terrain-rocky-dark':  0x3a3a32,
  'terrain-rocky-light': 0x7a7a6a,
};

/** Default mountain configuration — reproduces the original visual. */
export const DEFAULT_MOUNTAIN_CONFIG = {
  T:  { height: 3, density: 5, snowLine: 0.55, rock: 'rock-cliff' },
  TL: { height: 4, density: 0, snowLine: 0.55, rock: 'rock-cliff' },
  TR: { height: 2, density: 0, snowLine: 0.55, rock: 'rock-cliff' },
  ML: { height: 2, density: 3, snowLine: 0.65, rock: 'rock-cliff' },
  MR: { height: 2, density: 3, snowLine: 0.55, rock: 'rock-cliff' },
  BL: { height: 1, density: 1, snowLine: 0.80, rock: 'rock-cliff' },
  B:  { height: 2, density: 3, snowLine: 1.0,  rock: 'rock-cliff' },
  BR: { height: 1, density: 0, snowLine: 0.90, rock: 'rock-cliff' },
};

/** Clockwise adjacency order for backdrop interpolation. */
const RING_ORDER = ['TL', 'T', 'TR', 'MR', 'BR', 'B', 'BL', 'ML'];

export class TownRenderer {
  /**
   * @param {Object} config
   * @param {HTMLElement} config.container — DOM element to mount into
   * @param {Object} config.terrainFunctions — { elevation, moisture, elevColor, noise, buoyancy, twoNearest }
   * @param {Object} [config.callbacks] — { onBuildingClick, onSlotClick, onTownSquareClick }
   */
  constructor({ container, terrainFunctions, callbacks = {} }) {
    this._container = container;
    this._fn = terrainFunctions;
    this._callbacks = callbacks;
    this._disposed = false;
    this._initialized = false;
    this._loadGeneration = 0;
    this._clock = new THREE.Clock();
    this._elapsedTime = 0;

    // ── Scene ──
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x88bbee);

    // ── Camera ──
    this._camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);

    // ── WebGL Renderer ──
    this._renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this._renderer.domElement);

    // ── Root group ──
    this._townGroup = new THREE.Group();
    this._townGroup.name = 'town-root';
    this._scene.add(this._townGroup);

    // ── Subsystems (initialized lazily in load()) ──
    this._terrain = null;
    this._water = null;
    this._biomeMaterial = null;
    this._originalTerrainColors = null;
    this._districts = null;

    this._townSquare = null;
    this._buildingFactory = null;
    this._buildingAnimator = null;
    this._dayNight = null;
    this._weather = null;
    this._dailyWindows = null;
    this._npcs = null;
    this._animals = null;
    this._economyCarts = null;
    this._grass = null;
    this._flowers = null;
    this._edgeRocksGroup = null;
    this._edgeRockMats = null;
    this._edgeSnowMat = null;
    this._propPhysics = null;
    this._cloth = null;
    this._waterInteraction = null;
    this._particles = null;
    this._cameraController = null;
    this._cameraTransitions = null;
    this._audio = null;
    this._stateManager = null;
    this._textureManager = null;

    // ── Building groups ──
    this._buildingGroups = new Map(); // key: buildingIndex → THREE.Group

    // ── Editor-accessible custom objects ──
    this._customLamps = [];
    this._customTreeMeshes = [];
    this._customDecorations = [];
    this._customRoads = [];
    this._plotMarkers = [];
    this._layoutConfig = null;
    this._organicRoads = null;
    this._buildingLamps = [];
    this._boundsGroup = null;
    this._boundsAnchors = [];

    // ── Raycaster for interactions ──
    this._raycaster = new THREE.Raycaster();
    this._mouse = new THREE.Vector2(9, 9);

    // ── Event handlers ──
    this._onMouseMove = (e) => {
      const rect = this._renderer.domElement.getBoundingClientRect();
      this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };
    // Track pointer down position to distinguish clicks from drags
    this._pointerDownPos = { x: 0, y: 0 };
    this._onPointerDown = (e) => {
      this._pointerDownPos.x = e.clientX;
      this._pointerDownPos.y = e.clientY;
    };
    this._onClick = (e) => {
      // Ignore if user dragged more than 5px (it was a pan, not a click)
      const dx = e.clientX - this._pointerDownPos.x;
      const dy = e.clientY - this._pointerDownPos.y;
      if (dx * dx + dy * dy > 25) return;
      this._handleClick(e);
    };
    this._renderer.domElement.addEventListener('mousemove', this._onMouseMove);
    this._renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this._renderer.domElement.addEventListener('click', this._onClick);

    // ── Resize ──
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  // ════════════════════════════════════════════════════
  //  Initialization
  // ════════════════════════════════════════════════════

  /**
   * Load the town from on-chain state. Call once after construction.
   *
   * @param {Object} cityTerrain — terrain config { seed, waterLine, peakLine, anchors, ... }
   * @param {Object} visualState — TownVisualState from TownStateManager
   * @param {Object} [options]
   */
  async load(cityTerrain, visualState, options = {}) {
    if (this._initialized) this._teardown();
    this._animErrorLogged = false;
    this._renderErrorLogged = false;

    const vs = visualState;

    // ── 0. Layout Config ──
    this._layoutConfig = options.layoutConfig || null;
    this._editMode = !!options.editMode;
    this._skip = options.skip || {};
    this._ribbonRoadMats = [];

    // ── 1. Terrain ──
    const meshSize = 20;
    const terrainCfg = this._layoutConfig?.terrain;
    this._terrain = new TownTerrainBuilder(this._fn, {
      gridSize: 256,
      patchRadius: terrainCfg?.patchRadius ?? 100,
      heightScale: terrainCfg?.maxHeight ?? 0.05,
      meshSize: meshSize,
    });
    const { mesh: terrainMesh, waterMesh, skirtMesh } = this._terrain.build(
      cityTerrain,
      options.centerOx || 0,
      options.centerOy || 0,
    );
    this._townGroup.add(terrainMesh);
    if (waterMesh) this._townGroup.add(waterMesh);
    if (skirtMesh) this._townGroup.add(skirtMesh);

    // Terrain sampler for all subsystems
    const terrainSampler = {
      getHeight: (x, z) => this._terrain.getHeight(x, z),
      getMoisture: (x, z) => this._terrain.getMoisture(x, z),
      getSlope: (x, z) => this._terrain.getSlope(x, z),
      isWater: (x, z) => this._terrain.isWater(x, z),
      isMountain: (x, z) => this._terrain.isMountain(x, z),
      isGrassable: (x, z) => this._terrain.isGrassable(x, z),
      findNearestWater: (x, z) => this._terrain.findNearestWater(x, z),
      getWaterDistance: (x, z) => this._terrain.findNearestWater(x, z),
    };

    // ── 2. Biome Material ──
    this._biomeMaterial = new BiomeShaderMaterial({
      moisture: cityTerrain.waterLine,
    });

    // ── 3. Water System ──
    const seaCfg = this._layoutConfig?.sea;
    if (!this._skip.water) {
      this._water = new WaterSystem(this._scene, {
        sunDirection: new THREE.Vector3(3, 4, 2).normalize(),
      });

      if (seaCfg?.enabled) {
        if (waterMesh) waterMesh.visible = false;
        this._createSea(meshSize, seaCfg);
      } else {
        const waterEdges = this._terrain.findWaterEdges();
        if (waterEdges.length >= 2) {
          this._water.createRiver(
            waterEdges.map(p => new THREE.Vector3(p.x, this._terrain.getHeight(p.x, p.z) - 0.01, p.z)),
            0.3,
          );
        }
      }
    }

    // ── 4. Districts ──
    this._districts = new DistrictSystem({
      townRadius: meshSize * 0.4,
      meshSize: meshSize,
      seed: cityTerrain.seed,
    });

    // Wire JSON layout into district system if provided
    if (this._layoutConfig) {
      this._districts.setLayout(this._layoutConfig);
    }

    const buildingsForDistricts = [];
    if (vs.buildings) {
      vs.buildings.forEach((b, i) => {
        if (b && b.type >= 0 && b.status > 0) {
          buildingsForDistricts.push({
            typeId: b.type,
            level: b.level || 1,
            plotIndex: Math.floor(i / 4),
          });
        }
      });
    }

    const districtLayout = this._districts.generate(
      buildingsForDistricts,
      terrainSampler,
      vs.plotsOwned || 1,
    );

    // Paint district ground colors onto terrain mesh
    this._terrain.applyDistrictColors(this._districts, vs.plotsOwned || 1);

    // Enrich buildings with positions from district layout for NPC/Animal systems
    for (const b of buildingsForDistricts) {
      const pos = this._districts.getBuildingPosition(b.typeId, b.plotIndex);
      if (pos) {
        b.position = { x: pos.x, z: pos.z };
      } else {
        b.position = { x: 0, z: 0 };
      }
      // Find matching district center
      const district = districtLayout.districts.find(d => d.buildingType === b.typeId);
      if (district) {
        b.districtCenter = { x: district.center.x, z: district.center.z };
      }
    }

    // ── 6. Town Square ──
    const townSquarePos = this._districts.getTownSquarePosition(vs.plotsOwned || 1);
    const squareX = this._layoutConfig?.townSquare?.x ?? townSquarePos.x;
    const squareZ = this._layoutConfig?.townSquare?.z ?? townSquarePos.z;
    if (!this._skip.townSquare) {
      this._townSquare = new TownSquare(this._scene);
      const squareGroup = this._townSquare.build(vs.estateLevel || 1, {
        x: squareX,
        z: squareZ,
        windowsCompleted: vs.windowsCompleted || 0,
        loginStreak: vs.loginStreak || 0,
        permanentBonus: vs.permanentBonus || 0,
        milestones: this._computeMilestones(vs),
      });
      this._townGroup.add(squareGroup);
    }

    // ── 7. Texture Manager (must init before buildings so textures are ready) ──
    this._textureManager = new TextureManager({
      basePath: './src/town/assets/textures/',
    });

    // ── 7a. Asset Loader (must be ready before buildings so GLB overrides work) ──
    this._assetLoader = new AssetLoader({
      maxConcurrent: 4,
      cacheSizeMB: 128,
      basePath: './src/town/assets/',
    });

    // ── 7b. Buildings ──
    this._buildingFactory = new BuildingFactory({
      baseUnit: this._layoutConfig?.buildingScale?.baseUnit ?? 0.12,
      seed: cityTerrain.seed,
    });
    this._buildingAnimator = new BuildingAnimator(this._scene);

    // Store estate level for fabric tier selection
    this._currentEstateLevel = vs.estateLevel || 1;

    if (!this._skip.buildings) {
      if (!this._skip.textures) await this._loadBuildingTextures(vs);
      await this._placeAllBuildings(vs);
    }

    // ── 7c. Plot center markers (for editor dragging) ──
    this._createPlotMarkers(vs, terrainSampler);

    // Fire-and-forget texture loading (skipped entirely when textures toggle is off)
    if (!this._skip.textures) {
      this._loadEnvironmentTextures();
      if (!this._skip.townSquare) this._loadTownSquareTextures();
      this._loadFabricTextures();
      this._loadUtilityTextures();
    }

    // ── 8. Day/Night Cycle ──
    this._dayNight = new DayNightCycle(this._scene, {
      shadowCameraBounds: meshSize * 0.6,
    });
    this._dayNight.setTime(vs.currentTime || 12);

    // Register lamp posts from town square
    if (this._townSquare) {
      const lampPositions = this._townSquare.getLampPositions();
      for (const pos of lampPositions) {
        this._dayNight.registerTorch(
          new THREE.Vector3(pos.x, pos.y, pos.z),
          { color: 0xffeeaa, intensity: 1.2, radius: 3.0 },
        );
      }
    }

    // ── 8b. Custom Lamps from layout config ──
    if (this._layoutConfig) {
      this._placeCustomLamps(this._layoutConfig, terrainSampler);
    }

    // ── 8b2. Custom Decorations from layout config ──
    if (this._layoutConfig && !this._skip.decorations) {
      this._placeCustomDecorations(this._layoutConfig, terrainSampler);
    }

    // ── 8c. Per-building entrance lamps ──
    if (!this._skip.buildings) {
      this._placePerBuildingLamps(terrainSampler);
    }

    // ── 8e. Organic curved roads ──
    if (!this._skip.roads) {
      this._buildOrganicRoads(vs, terrainSampler);

      // ── 8f. Custom roads from layout config ──
      if (this._layoutConfig) {
        this._placeCustomRoads(this._layoutConfig, terrainSampler);
      }

      // Fire-and-forget ribbon road textures
      if (!this._skip.textures) this._loadRibbonRoadTextures();
    }

    // Fire-and-forget plot ground textures
    if (!this._skip.textures) this._loadPlotGroundTextures();

    // ── 9. Weather ──
    if (!this._skip.weather) {
      this._weather = new WeatherSystem(this._scene);
      if (cityTerrain.seed != null) {
        const dayOfYear = Math.floor((Date.now() / 86400000) % 365);
        const avgMoisture = cityTerrain.anchors
          ? cityTerrain.anchors.reduce((s, a) => s + (a.moisture || 0), 0) / cityTerrain.anchors.length
          : 128;
        this._weather.setWeatherFromSeed(cityTerrain.seed, dayOfYear, avgMoisture);
      }
    }

    // ── 10. Footprint System ──
    this._footprints = new FootprintSystem(this._renderer, {
      resolution: 256,
      worldSize: meshSize * 0.8,
      fadeRate: 0.995,
    });

    // ── 11. Daily Windows ──
    this._dailyWindows = new DailyWindows(this._scene);
    this._dailyWindows.setWindowState(
      vs.windowsCompleted || 0,
      this._getCurrentWindow(vs.currentTime || 12),
    );

    // ── 12. Particles ──
    if (!this._skip.particles) {
      this._particles = new GPUParticleSystem(this._scene);
      this._attachBuildingParticles(vs);
    }

    // ── 13. NPCs ──
    if (!this._skip.npcs) {
      this._npcs = new NPCManager(this._scene, {
        maxCount: Math.ceil(populationForLevel(vs.estateLevel || 1)),
      });
      this._npcs.initialize(buildingsForDistricts, null, terrainSampler);
      this._npcs.spawnForBuildings(buildingsForDistricts);

      // ── 14. Animals ──
      this._animals = new AnimalSystem(this._scene);
      this._animals.initialize(buildingsForDistricts, terrainSampler);

      // ── 15. Economy Carts ──
      this._economyCarts = new EconomyCartSystem(this._scene);
      this._setupEconomyRoutes(vs, districtLayout);
    }

    // ── 16. Vegetation ──
    if (!this._skip.grass) {
      const grassCfg = this._layoutConfig?.grass;
      const grassEnabled = grassCfg?.enabled !== false;
      const half = meshSize * 0.5;
      const grassBounds = { minX: -half, maxX: half, minZ: -half, maxZ: half };
      const grassArea = meshSize * meshSize;
      const grassDensity = grassCfg?.bladesPerUnit != null
        ? Math.round(grassCfg.bladesPerUnit * grassArea)
        : grassCfg?.density ?? this._getGrassDensity(vs.estateLevel || 1);

      if (grassEnabled) {
        this._grass = new GrassSystem(this._scene, {
          seed: cityTerrain.seed ?? 42,
          maxBlades: Math.min(grassDensity, 200000),
          minHeight: grassCfg?.minHeight,
          maxHeight: grassCfg?.maxHeight,
          bladeWidth: grassCfg?.bladeWidth,
          windStrength: grassCfg?.windStrength,
          colorBrightness: grassCfg?.colorBrightness,
        });
        if (seaCfg?.enabled) {
          const seaAngleRad = (seaCfg.angle ?? 135) * Math.PI / 180;
          const seaSpreadRad = ((seaCfg.spread ?? 60) + 20) * Math.PI / 180;
          const seaHalfSpread = seaSpreadRad / 2;
          const seaTotalZone = (seaCfg.reach ?? 3.0) + (seaCfg.beachWidth ?? 1.5) + 0.5;
          const seaHalf = meshSize * 0.5;
          this._grass.addExclusionTest((x, z) => {
            const vertAngle = Math.atan2(-z, x);
            let angleDiff = vertAngle - seaAngleRad;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            if (Math.abs(angleDiff) > seaHalfSpread) return false;
            const dist = Math.sqrt(x * x + z * z);
            const edgeDist = seaHalf - dist;
            return edgeDist <= seaTotalZone;
          });
        }
        for (const [, group] of this._buildingGroups) {
          const pos = group.position;
          const box = new THREE.Box3().setFromObject(group);
          const sx = (box.max.x - box.min.x) * 0.5;
          const sz = (box.max.z - box.min.z) * 0.5;
          const r = Math.max(sx, sz) + 0.04;
          this._grass.addExclusionZone({ x: pos.x, z: pos.z }, r);
        }
        if (this._townSquare && this._townSquare._group) {
          const sqPos = this._townSquare._group.position;
          const sqStage = this._townSquare._stage ?? 0;
          const sqRadii = [0.15, 0.22, 0.30, 0.38, 0.42];
          const sqR = (sqRadii[sqStage] ?? 0.30) + 0.05;
          this._grass.addExclusionZone({ x: sqPos.x, z: sqPos.z }, sqR);
        }
        if (this._scene.fog) {
          this._grass.setFog(this._scene.fog.near, this._scene.fog.far, this._scene.fog.color);
        }
        this._grass.scatter(terrainSampler, grassBounds, grassDensity);
      }
    }

    // ── 16b. Custom tree clusters ──
    if (this._layoutConfig && !this._skip.trees) {
      this._placeCustomTrees(this._layoutConfig, terrainSampler);
    }

    // ── 16c. Flowers ──
    if (!this._skip.flowers) {
      this._flowers = new FlowerFieldSystem(this._scene);
      this._placeFlowers(vs, districtLayout, terrainSampler);
    }

    // ── 16d. Edge mountains ──
    if (!this._skip.mountains) {
      const mtCfg = this._layoutConfig?.mountains || undefined;
      this._createEdgeRocks(meshSize, terrainSampler, mtCfg);
    }

    // ── 17. Physics ──
    this._propPhysics = new PropPhysicsSystem();
    this._registerBuildingProps(vs);

    this._waterInteraction = new WaterInteraction(this._renderer);

    // Cloth (town banner flag)
    this._cloth = new ClothSimulation(0.15, 0.1, 20, 10, {
      damping: 0.97,
      gravity: new THREE.Vector3(0, -0.5, 0),
      constraintIterations: 5,
    });
    const bannerPolePos = new THREE.Vector3(0, 0.25, 0);
    this._cloth.pinLeftEdge(bannerPolePos, 0.1);
    this._cloth.mesh.material = new THREE.MeshStandardMaterial({
      color: 0xcc2222,
      side: THREE.DoubleSide,
      roughness: 0.8,
    });
    this._townGroup.add(this._cloth.mesh);

    // ── 18. Camera ──
    // Pan bounds restrict camera to active district area
    let camBounds;
    if (this._editMode) {
      camBounds = 999; // unrestricted in edit mode
    } else if (this._layoutConfig?.cameraBounds) {
      camBounds = this._layoutConfig.cameraBounds;
    } else {
      camBounds = this._districts.getActiveBounds(vs.plotsOwned || 1);
    }
    this._cameraController = new IsometricCamera(this._camera, this._renderer.domElement, {
      panBounds: camBounds,
    });
    // Focus camera on the town square centroid
    this._cameraController.setTarget(townSquarePos.x, 0.1, townSquarePos.z);
    this._cameraTransitions = new CameraTransitions(this._camera, this._cameraController);

    // ── 18b. Bounds anchors (disabled — uncomment to re-enable) ──
    // if (this._editMode && this._layoutConfig?.cameraBounds) {
    //   this._createBoundsAnchors(this._layoutConfig.cameraBounds);
    // }

    // ── 19. Audio ──
    this._audio = new AudioManager({ masterVolume: 0.5, enabled: false });
    this._setupAudio(vs, districtLayout);

    // ── 20. Scene Fog ──
    // Exponential fog softens far edges naturally
    const skyColor = this._dayNight ? this._dayNight.getSkyColor() : new THREE.Color(0x88bbee);
    this._scene.fog = new THREE.Fog(skyColor, 9, 16);

    // ── 21. State Manager ──
    this._stateManager = new TownStateManager();
    this._stateManager.on('building-change', (idx, data) => this._onBuildingChange(idx, data));
    this._stateManager.on('level-up', (idx) => this._onBuildingLevelUp(idx));
    this._stateManager.on('plot-unlock', (plotIdx) => this._onPlotUnlock(plotIdx));
    this._stateManager.on('craft-start', (data) => this._onCraftStart(data));
    this._stateManager.on('craft-complete', (data) => this._onCraftComplete(data));

    this._initialized = true;
    this._loadGeneration++;
    this._animate(this._loadGeneration);
  }

  // ════════════════════════════════════════════════════
  //  Public API
  // ════════════════════════════════════════════════════

  /** Update the visual state (e.g. from WebSocket push). */
  updateState(visualState) {
    if (!this._initialized) return;
    const vs = visualState;

    // Update day/night
    if (vs.currentTime != null) {
      this._dayNight.setTime(vs.currentTime);
      this._dailyWindows.setWindowState(
        vs.windowsCompleted || 0,
        this._getCurrentWindow(vs.currentTime),
      );
    }

    // Update building states
    if (vs.buildings) {
      for (let i = 0; i < vs.buildings.length; i++) {
        const b = vs.buildings[i];
        if (!b || b.type < 0) continue;
        this._updateBuilding(i, b);
      }
    }

    // Update town square
    if (this._townSquare && vs.estateLevel != null) {
      this._townSquare.updateStage(vs.estateLevel);
    }

    // Update activity windows
    if (this._townSquare && vs.windowsCompleted != null) {
      this._townSquare.updateActivityBoard(vs.windowsCompleted);
    }
  }

  /** Set time of day (0-24). */
  setTimeOfDay(hour) {
    if (!this._initialized) return;
    this._dayNight.setTime(hour);
    this._dailyWindows.update(0, hour);
  }

  /** Set weather manually. */
  setWeather(type) {
    if (!this._initialized) return;
    this._weather.transitionTo(type, 5.0);
  }

  /** Toggle post-processing effects (no-op — post-processing removed). */
  setPostProcessingEnabled(_effect, _enabled) {
    // Post-processing pipeline removed for simplicity
  }

  /** Toggle audio. */
  setAudioEnabled(enabled) {
    if (this._audio) this._audio.setEnabled(enabled);
  }

  /** Set biome theme (desert, snow, swamp, volcanic, forest, or null for default). */
  setTheme(theme) {
    if (this._textureManager) {
      this._textureManager.setTheme(theme || null);
    }
    // Repaint terrain vertex colors for the theme (immediate visual change)
    this._recolorTerrain(theme || null);
    // Reload subsystem textures with new theme swaps
    this._loadEnvironmentTextures();
    this._loadTownSquareTextures();
    this._loadFabricTextures();
  }

  /** Fly camera to a building. */
  focusBuilding(buildingIndex) {
    const group = this._buildingGroups.get(buildingIndex);
    if (group && this._cameraTransitions) {
      const box = new THREE.Box3().setFromObject(group);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      this._cameraTransitions.flyToBuilding(center, Math.max(size.x, size.z));
    }
  }

  /** Fly camera to overview. */
  focusOverview() {
    if (this._cameraTransitions) this._cameraTransitions.flyToOverview();
  }

  /** Resize renderer to container. */
  resize() {
    if (this._disposed) return;
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;
    if (w === 0 || h === 0) return;
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h);
  }

  /** Dispose all resources. */
  dispose() {
    this._disposed = true;
    window.removeEventListener('resize', this._onResize);
    this._renderer.domElement.removeEventListener('mousemove', this._onMouseMove);
    this._renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this._renderer.domElement.removeEventListener('click', this._onClick);

    // Dispose subsystems in reverse order
    if (this._audio) this._audio.dispose();
    if (this._cameraTransitions) this._cameraTransitions = null;
    if (this._cameraController) this._cameraController.dispose();
    if (this._cloth) this._cloth.dispose();
    if (this._waterInteraction) this._waterInteraction.dispose();
    if (this._propPhysics) this._propPhysics.dispose();
    if (this._flowers) this._flowers.dispose();
    if (this._economyCarts) this._economyCarts.dispose();
    if (this._animals) this._animals.dispose();
    if (this._npcs) this._npcs.dispose();
    if (this._particles) this._particles.dispose();
    if (this._footprints) this._footprints.dispose();
    if (this._assetLoader) this._assetLoader.dispose();
    if (this._textureManager) this._textureManager.dispose();
    if (this._dailyWindows) this._dailyWindows.dispose();
    if (this._weather) this._weather.dispose();
    if (this._dayNight) this._dayNight.dispose();
    if (this._buildingAnimator) this._buildingAnimator.dispose();
    if (this._buildingFactory) this._buildingFactory.dispose();
    if (this._townSquare) this._townSquare.dispose();
    if (this._water) this._water.dispose();
    if (this._terrain) this._terrain.dispose();

    this._scene.clear();
    this._renderer.dispose();

    if (this._renderer.domElement.parentNode) {
      this._renderer.domElement.parentNode.removeChild(this._renderer.domElement);
    }
  }

  // Getters
  get scene() { return this._scene; }
  get camera() { return this._camera; }
  get renderer() { return this._renderer; }
  get canvas() { return this._renderer.domElement; }
  get buildingGroups() { return this._buildingGroups; }
  get customLamps() { return this._customLamps; }
  get customTrees() { return this._customTreeMeshes; }
  get customDecorations() { return this._customDecorations; }
  get customRoads() { return this._customRoads; }
  get plotMarkers() { return this._plotMarkers; }
  get boundsAnchors() { return this._boundsAnchors; }
  get boundsGroup() { return this._boundsGroup; }
  get layoutConfig() { return this._layoutConfig; }
  get cameraController() { return this._cameraController; }

  // ════════════════════════════════════════════════════
  //  PBR Texture Loading
  // ════════════════════════════════════════════════════

  /**
   * Load building textures — only loads packs actually needed by the scene.
   * @private
   */
  async _loadBuildingTextures(vs) {
    const tm = this._textureManager;
    if (!tm) return;

    try {
      // Determine which tiers and building types exist
      const tiersUsed = new Set();
      const typesUsed = new Set();
      const buildings = vs?.buildings || [];
      for (const b of buildings) {
        if (!b || b.type < 0 || b.status === 0) continue;
        typesUsed.add(b.type);
        tiersUsed.add(Math.min(Math.max(b.level || 1, 1), 4));
      }
      if (tiersUsed.size === 0) return;

      // Tier → packs mapping (mirrors BuildingFactory TIER_TEXTURE_MAP)
      const TIER_PACKS = {
        1: ['wood-dark', 'roof-thatch', 'stone-rubble', 'wood-aged'],
        2: ['brick-classic', 'roof-clay', 'stone-cobble', 'wood-dark', 'plaster-white'],
        3: ['wall-stone-clean', 'roof-slate', 'stone-medieval', 'stone-rubble', 'metal-gold-worn'],
        4: ['stone-marble', 'roof-slate', 'metal-gold-polished'],
      };

      // Building type → override packs
      const TYPE_OVERRIDES = {
        1:  ['wall-block-rough'],                       // Barracks
        5:  ['metal-iron'],                             // Forge
        12: ['wall-castle-mixed', 'stone-medieval'],    // Citadel
      };

      // Packs that need metalness extra
      const METAL_PACKS = new Set(['metal-gold-worn', 'metal-gold-polished', 'metal-iron', 'wood-dark', 'wood-aged']);
      // Packs that need opacity extra
      const ALPHA_PACKS = new Set(['roof-clay', 'roof-slate']);

      // Collect only what's needed
      const needed = new Set();
      for (const tier of tiersUsed) {
        for (const p of (TIER_PACKS[tier] || [])) needed.add(p);
      }
      for (const type of typesUsed) {
        for (const p of (TYPE_OVERRIDES[type] || [])) needed.add(p);
      }

      // Separate by extras needed
      const corePacks = [];
      const metalPacks = [];
      const alphaPacks = [];
      for (const p of needed) {
        if (METAL_PACKS.has(p)) metalPacks.push(p);
        else if (ALPHA_PACKS.has(p)) alphaPacks.push(p);
        else corePacks.push(p);
      }

      // Lava only if forge exists
      const lavaPacks = typesUsed.has(5) ? ['lava-cooled', 'lava-molten', 'lava-ember'] : [];

      const batches = [];
      if (corePacks.length)  batches.push(tm.preloadBatch(corePacks, { repeat: [1, 1], extras: ['ao'] }));
      if (metalPacks.length) batches.push(tm.preloadBatch(metalPacks, { repeat: [1, 1], extras: ['metalness', 'ao'] }));
      if (alphaPacks.length) batches.push(tm.preloadBatch(alphaPacks, { repeat: [1, 1], extras: ['opacity', 'ao'] }));
      if (lavaPacks.length)  batches.push(tm.preloadBatch(lavaPacks, { repeat: [1, 1], extras: ['emissive', 'ao'] }));

      const results = await Promise.all(batches);
      const buildingTextures = new Map();
      for (const m of results) {
        for (const [k, v] of m) buildingTextures.set(k, v);
      }

      if (this._disposed) return;
      if (this._buildingFactory) {
        this._buildingFactory.setTextures(buildingTextures);
      }
    } catch (err) {
      console.warn('[TownRenderer] Building textures failed, using flat colors:', err.message || err);
    }
  }

  /**
   * Load terrain, edge-rock, and water textures (fire-and-forget —
   * shader uniforms / material props update in-place).
   * @private
   */
  async _loadEnvironmentTextures() {
    const tm = this._textureManager;
    if (!tm) return;

    try {
      // ── Terrain splatting (configurable via layoutConfig.textures) ──
      const tCfg = this._layoutConfig?.textures || {};
      const [grassSet, dirtSet, rockSet, sandSet] = await Promise.all([
        tm.loadPBRSet(tCfg.grass || 'grass-lush', { repeat: [8, 8] }),
        tm.loadPBRSet(tCfg.dirt || 'ground-dirt', { repeat: [8, 8] }),
        tm.loadPBRSet(tCfg.rock || 'rock-cliff', { repeat: [6, 6] }),
        tm.loadPBRSet(tCfg.sand || 'ground-sand', { repeat: [8, 8] }),
      ]);
      if (this._disposed) return;
      if (this._biomeMaterial) {
        this._biomeMaterial.setTerrainTextures({
          grass: grassSet.map,
          dirt:  dirtSet.map,
          rock:  rockSet.map,
          sand:  sandSet.map,
        });
      }

      // ── Edge-mountain PBR upgrades ──
      if (this._edgeRockMats && this._edgeRockMats.size > 0) {
        const rockPackNames = [...this._edgeRockMats.keys()];
        const rockSets = await Promise.all(
          rockPackNames.map(name => tm.loadPBRSet(name, { repeat: [3, 3] }))
        );
        if (!this._disposed) {
          for (let i = 0; i < rockPackNames.length; i++) {
            const mat = this._edgeRockMats.get(rockPackNames[i]);
            if (mat && rockSets[i]) tm.applyToMaterial(mat, rockSets[i]);
          }
        }
      }
      if (this._edgeSnowMat && !this._disposed) {
        const snowSet = await tm.loadPBRSet('snow-fresh', { repeat: [4, 4] });
        if (!this._disposed && snowSet) tm.applyToMaterial(this._edgeSnowMat, snowSet);
      }

      // ── Water normal maps ──
      const [waterN1, waterN2] = await Promise.all([
        tm.loadSingle('water-normal/water-normal-1.jpg', { repeat: [4, 4] }),
        tm.loadSingle('water-normal/water-normal-2.jpg', { repeat: [4, 4] }),
      ]);
      if (this._disposed) return;
      if (this._water && waterN1 && waterN2) {
        this._water.setWaterNormals(waterN1, waterN2);
      }
    } catch (err) {
      console.warn('[TownRenderer] Environment textures incomplete:', err.message || err);
    }
  }

  /**
   * Load textures for ribbon roads (organic + custom) and apply in-place.
   * @private
   */
  async _loadRibbonRoadTextures() {
    const tm = this._textureManager;
    const mats = this._ribbonRoadMats;
    if (!tm || !mats || mats.length === 0) return;

    try {
      const defaultPack = (this._layoutConfig?.roads?.style || 'cobblestone') === 'path'
        ? 'ground-gravel' : 'stone-cobble';

      // Group materials by texture pack to avoid redundant loads
      const packGroups = new Map();
      for (const mat of mats) {
        const pack = mat.userData?.texturePackOverride || defaultPack;
        if (!packGroups.has(pack)) packGroups.set(pack, []);
        packGroups.get(pack).push(mat);
      }

      await Promise.all([...packGroups.entries()].map(async ([pack, packMats]) => {
        const pbrSet = await tm.loadPBRSet(pack, { repeat: [4, 4], extras: ['ao'] });
        if (this._disposed) return;
        for (const m of packMats) tm.applyToMaterial(m, pbrSet);
      }));
    } catch (err) {
      console.warn('[TownRenderer] Ribbon road textures failed:', err.message || err);
    }
  }

  /**
   * Load plot ground textures (per-plot, fire-and-forget).
   * @private
   */
  async _loadPlotGroundTextures() {
    const tm = this._textureManager;
    const mats = this._plotGroundMats;
    if (!tm || !mats || mats.length === 0) return;

    try {
      const packGroups = new Map();
      for (const mat of mats) {
        const pack = mat.userData?.texturePackOverride;
        if (!pack) continue;
        if (!packGroups.has(pack)) packGroups.set(pack, []);
        packGroups.get(pack).push(mat);
      }

      await Promise.all([...packGroups.entries()].map(async ([pack, packMats]) => {
        const pbrSet = await tm.loadPBRSet(pack, { repeat: [2, 2], extras: ['ao'] });
        if (this._disposed) return;
        for (const m of packMats) tm.applyToMaterial(m, pbrSet);
      }));
    } catch (err) {
      console.warn('[TownRenderer] Plot ground textures failed:', err.message || err);
    }
  }

  /**
   * Load town square textures and apply in-place (fire-and-forget).
   * Only loads the 1-2 packs needed for the current estate stage.
   * @private
   */
  async _loadTownSquareTextures() {
    const tm = this._textureManager;
    if (!tm || !this._townSquare) return;

    try {
      // Stage → ground pack (mirrors TownSquare GROUND_PACKS)
      const level = this._currentEstateLevel || 1;
      const stage = level >= 60 ? 4 : level >= 40 ? 3 : level >= 20 ? 2 : level >= 10 ? 1 : 0;
      const GROUND_PACKS = ['ground-dirt', 'stone-pebbles', 'stone-paving', 'tile-floor', 'stone-marble'];
      const needed = [GROUND_PACKS[stage] || 'ground-dirt'];
      if (stage >= 2) needed.push('metal-ornate'); // fountain stone

      const squareTextures = await tm.preloadBatch(needed, { repeat: [2, 2], extras: ['ao'] });
      if (this._disposed) return;
      this._townSquare.setTextures(squareTextures);
    } catch (err) {
      console.warn('[TownRenderer] Town square textures failed:', err.message || err);
    }
  }

  /**
   * Load fabric texture for the cloth banner based on estate tier (fire-and-forget).
   * @private
   */
  async _loadFabricTextures() {
    const tm = this._textureManager;
    if (!tm || !this._cloth) return;

    try {
      const tier = this._currentEstateLevel ?? 1;
      const packName = tier >= 4 ? 'fabric-royal'
                     : tier >= 3 ? 'fabric-corduroy'
                     : tier >= 2 ? 'fabric-linen'
                     : 'fabric-canvas';
      const set = await tm.loadPBRSet(packName, { repeat: [1, 1] });
      if (this._disposed || !this._cloth) return;
      const mat = new THREE.MeshStandardMaterial({
        side: THREE.DoubleSide,
        roughness: 0.8,
      });
      tm.applyToMaterial(mat, set);
      this._cloth.setMaterial(mat);
    } catch (err) {
      console.warn('[TownRenderer] Fabric textures failed:', err.message || err);
    }
  }

  /**
   * Load utility textures (particles, footprints) and distribute (fire-and-forget).
   * @private
   */
  async _loadUtilityTextures() {
    const tm = this._textureManager;
    if (!tm) return;

    try {
      const [stampTex, smokeTex, fireTex] = await Promise.all([
        tm.loadSingle('footprint.png'),
        tm.loadSingle('particle_smoke.png'),
        tm.loadSingle('particle_fire.png'),
      ]);
      if (this._disposed) return;
      if (this._footprints && stampTex) this._footprints.setStampTexture(stampTex);
      if (this._particles) this._particles.setTextures({ smoke: smokeTex, fire: fireTex });
    } catch (err) {
      console.warn('[TownRenderer] Utility textures failed:', err.message || err);
    }
  }

  // ════════════════════════════════════════════════════
  //  Animation Loop
  // ════════════════════════════════════════════════════

  _animate(gen) {
    if (this._disposed || gen !== this._loadGeneration) return;
    requestAnimationFrame(() => this._animate(gen));

    // Update subsystems — errors here should not prevent rendering
    try {
      this._updateSubsystems();
    } catch (err) {
      if (!this._animErrorLogged) {
        console.error('[TownRenderer] subsystem update error:', err);
        this._animErrorLogged = true;
      }
    }

    // Render
    this._renderer.render(this._scene, this._camera);
  }

  _updateSubsystems() {
    const dt = this._clock.getDelta();
    const clampedDt = Math.min(dt, 0.05); // Cap at 50ms to avoid spiral
    this._elapsedTime += clampedDt;

    const camPos = this._camera.position;
    const windDir = this._weather
      ? this._weather.getWindDirection()
      : new THREE.Vector2(1, 0);
    const windStr = this._weather
      ? this._weather.getWindStrength()
      : 0.5;
    const timeOfDay = this._dayNight ? this._dayNight.currentHour : 12;

    // ── Update subsystems ──

    // Camera (first, so position is fresh for culling)
    if (this._cameraController) this._cameraController.update(clampedDt);
    if (this._cameraTransitions) this._cameraTransitions.update(clampedDt);

    // Atmosphere
    if (this._dayNight) this._dayNight.update(clampedDt, camPos);
    if (this._weather) this._weather.update(clampedDt);
    if (this._dailyWindows) this._dailyWindows.update(clampedDt, timeOfDay);

    // Update scene background and fog color from sky color
    if (this._dayNight) {
      const skyCol = this._dayNight.getSkyColor();
      this._scene.background = skyCol;
      if (this._scene.fog) {
        this._scene.fog.color.copy(skyCol);
      }
    }

    // Water
    if (this._water) {
      if (this._dayNight) {
        this._water.setSunDirection(this._dayNight.getSunDirection());
      }
      this._water.setWindInfluence(windStr);
      if (this._weather) {
        this._water.setRainIntensity(this._weather.getRainIntensity());
      }
      this._water.update(clampedDt);
    }

    // Biome material updates
    if (this._biomeMaterial && this._weather) {
      this._biomeMaterial.setWetness(this._weather.getWetness());
      this._biomeMaterial.setSnowAmount(this._weather.getSnowAmount());
    }

    // Town square animation (floating orbs, flames)
    if (this._townSquare) this._townSquare.update(clampedDt);

    // Building animations
    if (this._buildingAnimator) this._buildingAnimator.update(clampedDt);

    // Population
    if (this._npcs) {
      this._npcs.update(clampedDt, camPos, timeOfDay);
    }
    if (this._animals) {
      this._animals.update(clampedDt, windDir);
    }
    if (this._economyCarts) {
      this._economyCarts.update(clampedDt, {
        getHeight: (x, z) => this._terrain ? this._terrain.getHeight(x, z) : 0,
      });
    }

    // Vegetation
    if (this._grass) {
      this._grass.update(clampedDt, windDir, windStr);
      if (this._scene.fog) {
        this._grass.setFog(this._scene.fog.near, this._scene.fog.far, this._scene.fog.color);
      }
    }
    if (this._flowers) {
      this._flowers.update(clampedDt, windDir, windStr);
    }

    // Physics
    if (this._propPhysics) {
      this._propPhysics.applyWindToAll(windDir, windStr);
      this._propPhysics.update(clampedDt);
    }
    if (this._cloth) {
      const windVec = new THREE.Vector3(windDir.x, 0, windDir.y);
      this._cloth.applyWind(windVec, windStr);
      this._cloth.update(clampedDt);
    }
    if (this._waterInteraction) {
      this._waterInteraction.update(clampedDt);
    }

    // Footprints — stamp NPC and cart positions, then fade
    if (this._footprints) {
      // Stamp NPC footprints
      if (this._npcs) {
        const walkers = this._npcs.getWalkingNPCs ? this._npcs.getWalkingNPCs() : [];
        for (let i = 0; i < walkers.length; i++) {
          const npc = walkers[i];
          if (npc && npc.isWalking && npc.stepReady) {
            this._footprints.stampFootprintPair(
              npc.position.x, npc.position.z,
              npc.heading, npc.strideLength || 0.04,
              npc.currentFoot || 'left',
            );
          }
        }
      }
      // Stamp cart tracks
      if (this._economyCarts) {
        const carts = this._economyCarts.getActiveSegments ? this._economyCarts.getActiveSegments() : [];
        for (let i = 0; i < carts.length; i++) {
          const seg = carts[i];
          if (seg) {
            this._footprints.stampTrack(seg.x1, seg.z1, seg.x2, seg.z2, 0.015);
          }
        }
      }
      this._footprints.update();

      // Feed footprint texture to biome shader
      if (this._biomeMaterial && this._biomeMaterial.setFootprintMap) {
        this._biomeMaterial.setFootprintMap(this._footprints.getTexture());
      }
    }

    // Particles
    if (this._particles) {
      this._particles.update(clampedDt, windDir, windStr);
    }

    // Audio
    if (this._audio) {
      this._audio.setListenerPosition(camPos.x, camPos.y, camPos.z);
      this._audio.setTimeOfDay(timeOfDay);
      this._audio.update(clampedDt, camPos);
    }
  }

  // ════════════════════════════════════════════════════
  //  Plot Markers (for editor dragging)
  // ════════════════════════════════════════════════════

  _createPlotMarkers(vs, terrainSampler) {
    this._plotMarkers = [];
    this._plotGroundMats = [];
    if (!this._layoutConfig?.plots) return;
    const plotsOwned = vs.plotsOwned || 1;

    const markerGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.02, 6);
    const ownedMat = new THREE.MeshStandardMaterial({
      color: 0xffaa44, roughness: 0.4, metalness: 0.3,
      transparent: true, opacity: 0.7,
    });
    const lockedMat = new THREE.MeshStandardMaterial({
      color: 0x888888, roughness: 0.6,
      transparent: true, opacity: 0.4,
    });

    for (let p = 0; p < this._layoutConfig.plots.length; p++) {
      const plot = this._layoutConfig.plots[p];
      const owned = p < plotsOwned;
      const marker = new THREE.Mesh(markerGeo, owned ? ownedMat : lockedMat);
      const py = terrainSampler ? terrainSampler.getHeight(plot.x, plot.z) : 0;
      marker.position.set(plot.x, py + 0.02, plot.z);
      marker.userData = {
        editType: 'plot',
        editIndex: p,
        plotIndex: p,
      };
      marker.castShadow = false;
      marker.receiveShadow = false;
      this._townGroup.add(marker);
      this._plotMarkers.push(marker);

      // Textured ground plane under each plot
      if (owned && plot.groundTexture) {
        const padSize = plot.padSize || 0.58;
        const groundGeo = new THREE.PlaneGeometry(padSize, padSize);
        const groundMat = new THREE.MeshStandardMaterial({
          color: plot.padColor || 0x6a8a55,
          roughness: 0.85,
          transparent: true,
          opacity: 0.85,
        });
        groundMat.userData = { texturePackOverride: plot.groundTexture };
        const groundPlane = new THREE.Mesh(groundGeo, groundMat);
        groundPlane.rotation.x = -Math.PI / 2;
        groundPlane.position.set(plot.x, py + 0.005, plot.z);
        groundPlane.receiveShadow = true;
        this._townGroup.add(groundPlane);
        this._plotGroundMats.push(groundMat);
      }
    }
  }

  // ════════════════════════════════════════════════════
  //  Building Management
  // ════════════════════════════════════════════════════

  /**
   * Build the asset override key for a building type and level.
   * @param {number} typeId
   * @param {number} level
   * @returns {string|null} e.g. "mansion_t1", "forge_t3"
   */
  _buildingAssetKey(typeId, level) {
    if (typeId < 0 || typeId > 18) return null;
    const name = _BUILDING_MANIFEST_NAMES[typeId];
    const tier = _visualTierIndex(level) + 1; // 1-4
    return `${name}_t${tier}`;
  }

  async _placeAllBuildings(vs) {
    if (!vs.buildings) return;
    const promises = [];
    for (let i = 0; i < vs.buildings.length; i++) {
      const b = vs.buildings[i];
      if (!b || b.type < 0 || b.status === 0) continue;
      promises.push(this._placeBuilding(i, b));
    }
    await Promise.all(promises);
  }

  async _placeBuilding(index, buildingState) {
    const plotIndex = Math.floor(index / 4);
    const slotIndex = index % 4;

    // Get position from layout config via district system (slot-based)
    let pos;
    if (this._districts) {
      pos = this._districts.getSlotPosition(plotIndex, slotIndex);
    }
    if (!pos) {
      pos = { x: 0, z: 0 };
    }

    // Collect per-slot texture overrides from layoutConfig
    let textureOverrides = null;
    if (this._layoutConfig) {
      const slotCfg = this._layoutConfig.plots?.[plotIndex]?.slots?.[slotIndex];
      if (slotCfg) {
        const to = {};
        if (slotCfg.wallTexture) to.wall = slotCfg.wallTexture;
        if (slotCfg.roofTexture) to.roof = slotCfg.roofTexture;
        if (slotCfg.floorTexture) to.floor = slotCfg.floorTexture;
        if (Object.keys(to).length > 0) textureOverrides = to;
      }
    }

    // Check for 3D asset override — search all tiers for this building type
    const level = buildingState.level || 1;
    const manifestName = _BUILDING_MANIFEST_NAMES[buildingState.type];
    let useAssetTier = -1;

    if (manifestName && this._layoutConfig?.assetOverrides) {
      // Exact match first (current level's tier)
      const exactKey = this._buildingAssetKey(buildingState.type, level);
      if (exactKey && this._layoutConfig.assetOverrides[exactKey]) {
        useAssetTier = _visualTierIndex(level);
      } else {
        // Check all tiers (highest first) so the override works regardless of level
        for (let t = 3; t >= 0; t--) {
          if (this._layoutConfig.assetOverrides[`${manifestName}_t${t + 1}`]) {
            useAssetTier = t;
            break;
          }
        }
      }
    }

    let buildingGroup;
    if (useAssetTier >= 0 && this._assetLoader) {
      const gltf = await this._assetLoader.load(manifestName, 'buildings', { tier: useAssetTier });
      if (gltf && gltf.scene) {
        buildingGroup = gltf.scene.clone();
        buildingGroup.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
      }
    }

    // Fallback to procedural mesh
    if (!buildingGroup) {
      buildingGroup = this._buildingFactory.createBuilding(
        buildingState.type,
        level,
        {
          seed: index,
          dockFacingAngle: this._terrain ? this._computeDockFacing(pos.x, pos.z) : 0,
          masteryGlow: buildingState.mastery || 0,
          textureOverrides,
        },
      );
    }

    buildingGroup.position.set(pos.x, this._terrain ? this._terrain.getHeight(pos.x, pos.z) : 0, pos.z);

    // Apply per-slot rotation, falling back to global buildingRotation
    const globalRotDeg = this._layoutConfig?.buildingRotation ?? 0;
    let slotRotDeg = globalRotDeg;

    // Apply yOffset, per-type-tier scale, and per-slot rotation from layoutConfig
    if (this._layoutConfig) {
      const plotCfg = this._layoutConfig.plots[plotIndex];
      if (plotCfg && plotCfg.slots[slotIndex]) {
        const slotCfg = plotCfg.slots[slotIndex];
        if (slotCfg.yOffset) buildingGroup.position.y += slotCfg.yOffset;
        if (slotCfg.rotation != null) slotRotDeg = slotCfg.rotation;
      }
      // Per type+tier scale (e.g. "mansion_t1": 1.2)
      const scaleKey = this._buildingAssetKey(buildingState.type, level);
      if (scaleKey && this._layoutConfig.buildingScales?.[scaleKey]) {
        buildingGroup.scale.multiplyScalar(this._layoutConfig.buildingScales[scaleKey]);
      }
    }
    buildingGroup.rotation.y = slotRotDeg * (Math.PI / 180);

    buildingGroup.userData.editType = 'building';
    buildingGroup.userData.editIndex = index;
    buildingGroup.userData.buildingIndex = index;
    buildingGroup.userData.buildingType = buildingState.type;
    buildingGroup.userData.buildingLevel = level;
    buildingGroup.userData.plotIndex = plotIndex;
    buildingGroup.userData.slotIndex = slotIndex;
    this._townGroup.add(buildingGroup);
    this._buildingGroups.set(index, buildingGroup);

    // Construction animation
    if (buildingState.status === 1 && buildingState.constructionProgress != null) {
      this._buildingAnimator.setConstructionProgress(buildingGroup, buildingState.constructionProgress);
      this._buildingAnimator.createScaffolding(buildingGroup, new THREE.Box3().setFromObject(buildingGroup));
    }

    // Register window positions for night glow
    if (this._dayNight) {
      const windows = this._buildingFactory.getWindowPositions(buildingState.type, buildingState.level || 1);
      for (const w of windows) {
        const worldPos = w.position.clone().add(buildingGroup.position);
        this._dayNight.registerWindow(worldPos, { color: 0xffeeaa, intensity: 0.6 });
      }
    }

    // Register particle anchors
    if (this._particles) {
      const anchors = this._buildingFactory.getParticleAnchors(buildingState.type, buildingState.level || 1);
      for (const anchor of anchors) {
        const worldPos = anchor.position.clone().add(buildingGroup.position);
        this._particles.createEmitter(anchor.type, worldPos);
      }
    }
  }

  async _updateBuilding(index, buildingState) {
    const existing = this._buildingGroups.get(index);
    if (!existing) {
      await this._placeBuilding(index, buildingState);
      return;
    }

    // Update construction progress
    if (buildingState.constructionProgress != null) {
      this._buildingAnimator.setConstructionProgress(existing, buildingState.constructionProgress);
    }

    // Check for level change
    if (existing.userData.buildingLevel !== buildingState.level) {
      // Rebuild the building mesh at new level
      this._buildingFactory.disposeBuilding(existing);
      this._townGroup.remove(existing);
      this._buildingGroups.delete(index);
      await this._placeBuilding(index, buildingState);

      // Play level-up effect
      const newGroup = this._buildingGroups.get(index);
      if (newGroup) this._buildingAnimator.playLevelUpEffect(newGroup);
    }

    // Update active states
    if (buildingState.type === 5) { // Forge
      if (buildingState.activeCraft) {
        this._buildingAnimator.showCraftIndicator(existing, buildingState.activeCraft.qualityTier, buildingState.activeCraft.progress);
      } else {
        this._buildingAnimator.hideCraftIndicator(existing);
      }
    }
    if (buildingState.type === 7) { // Academy
      if (buildingState.activeResearch) {
        this._buildingAnimator.showResearchIndicator(existing, buildingState.activeResearch.researchId, buildingState.activeResearch.progress);
      } else {
        this._buildingAnimator.hideResearchIndicator(existing);
      }
    }
    if (buildingState.type === 9) { // Sanctuary
      if (buildingState.meditatingHeroes > 0) {
        this._buildingAnimator.showMeditationFigures(existing, buildingState.meditatingHeroes);
      } else {
        this._buildingAnimator.hideMeditationFigures(existing);
      }
    }
  }

  // ════════════════════════════════════════════════════
  //  Interaction
  // ════════════════════════════════════════════════════

  _handleClick(e) {
    if (!this._initialized) return;
    if (this._cameraTransitions && this._cameraTransitions.isTransitioning) return;

    this._raycaster.setFromCamera(this._mouse, this._camera);

    // Check building clicks
    const buildingMeshes = [];
    for (const [, group] of this._buildingGroups) {
      group.traverse((child) => {
        if (child.isMesh && child.name !== 'select-ring') buildingMeshes.push(child);
      });
    }
    const hits = this._raycaster.intersectObjects(buildingMeshes, false);
    if (hits.length > 0) {
      let obj = hits[0].object;
      while (obj && obj.userData.buildingIndex == null) obj = obj.parent;
      if (obj && obj.userData.buildingIndex != null) {
        if (this._callbacks.onBuildingClick) {
          this._callbacks.onBuildingClick(obj.userData.buildingIndex, obj.userData.buildingType);
        }
        this.focusBuilding(obj.userData.buildingIndex);
        return;
      }
    }

    // Check town square click
    if (this._townSquare) {
      const squareGroup = this._townSquare.getGroup();
      if (squareGroup) {
        const squareHits = this._raycaster.intersectObjects(squareGroup.children, true);
        if (squareHits.length > 0) {
          if (this._callbacks.onTownSquareClick) this._callbacks.onTownSquareClick();
          this.focusOverview();
          return;
        }
      }
    }
  }

  // ════════════════════════════════════════════════════
  //  Theme Recoloring
  // ════════════════════════════════════════════════════

  /**
   * Repaint terrain vertex colors based on the active biome theme.
   * Stores original colors on first call so themes can be reverted.
   * @param {string|null} theme
   * @private
   */
  _recolorTerrain(theme) {
    if (!this._terrain || !this._terrain._mesh) return;
    const geo = this._terrain._mesh.geometry;
    const colors = geo.getAttribute('color');
    if (!colors) return;

    // Save original vertex colors on first theme change
    if (!this._originalTerrainColors) {
      this._originalTerrainColors = new Float32Array(colors.array);
    }

    const orig = this._originalTerrainColors;
    const arr = colors.array;

    // Restore originals if no theme
    if (!theme) {
      arr.set(orig);
      colors.needsUpdate = true;
      // Reset skirt color
      if (this._terrain._skirtMesh) {
        this._terrain._skirtMesh.material.color.setHex(0x2a3a20);
        this._terrain._skirtMesh.material.needsUpdate = true;
      }
      // Reset fog
      if (this._scene.fog) {
        const skyCol = this._dayNight ? this._dayNight.getSkyColor() : new THREE.Color(0x88bbee);
        this._scene.fog.color.copy(skyCol);
      }
      return;
    }

    // Theme palettes: [r, g, b] target color and blend strength
    // Higher blend = more dramatic recolor
    const THEME_PALETTES = {
      desert:   { target: [0.84, 0.76, 0.58], blend: 0.65, skirt: 0x6b5a3a, fog: 0xc8b898 },
      snow:     { target: [0.92, 0.94, 0.97], blend: 0.72, skirt: 0x8898a8, fog: 0xc8d0d8 },
      swamp:    { target: [0.28, 0.38, 0.22], blend: 0.55, skirt: 0x1a2a14, fog: 0x485848 },
      volcanic: { target: [0.32, 0.26, 0.24], blend: 0.62, skirt: 0x1a1412, fog: 0x483838 },
      forest:   { target: [0.20, 0.42, 0.16], blend: 0.50, skirt: 0x142a10, fog: 0x486838 },
    };

    const palette = THEME_PALETTES[theme];
    if (!palette) {
      arr.set(orig);
      colors.needsUpdate = true;
      return;
    }

    const [tr, tg, tb] = palette.target;
    const b = palette.blend;
    const invB = 1 - b;

    for (let i = 0; i < orig.length; i += 3) {
      arr[i]     = orig[i]     * invB + tr * b;
      arr[i + 1] = orig[i + 1] * invB + tg * b;
      arr[i + 2] = orig[i + 2] * invB + tb * b;
    }
    colors.needsUpdate = true;

    // Update skirt to match theme
    if (this._terrain._skirtMesh) {
      this._terrain._skirtMesh.material.color.setHex(palette.skirt);
      this._terrain._skirtMesh.material.needsUpdate = true;
    }

    // Tint fog to match theme
    if (this._scene.fog) {
      this._scene.fog.color.set(palette.fog);
    }
  }

  // ════════════════════════════════════════════════════
  //  Helpers
  // ════════════════════════════════════════════════════

  _computeMilestones(vs) {
    if (!vs.buildings) return {};
    const buildings = vs.buildings.filter(b => b && b.type >= 0 && b.status > 0);
    const tier1Types = new Set([0, 1, 2, 3, 4]);
    const tier2Types = new Set([5, 6, 7, 8]);
    const tier3Types = new Set([9, 10, 11, 12]);
    const builtTypes = new Set(buildings.map(b => b.type));

    return {
      firstBuilding: buildings.length > 0,
      allTier1: [...tier1Types].every(t => builtTypes.has(t)),
      firstTier2: [...tier2Types].some(t => builtTypes.has(t)),
      allTier2: [...tier2Types].every(t => builtTypes.has(t)),
      firstTier3: [...tier3Types].some(t => builtTypes.has(t)),
      allBuildings: builtTypes.size === 13,
      anyLevel10: buildings.some(b => b.level >= 10),
      anyLevel20: buildings.some(b => b.level >= 20),
      eternalFlame: (vs.permanentBonus || 0) > 0,
      allMastery50: buildings.every(b => (b.mastery || 0) >= 50),
      allMastery100: buildings.every(b => (b.mastery || 0) >= 100),
    };
  }

  _getCurrentWindow(hour) {
    if (hour >= 5 && hour < 10) return 'dawn';
    if (hour >= 10 && hour < 16) return 'midday';
    if (hour >= 16 && hour < 21) return 'dusk';
    return null;
  }

  _getGrassDensity(estateLevel) {
    if (estateLevel < 10) return 8000;
    if (estateLevel < 25) return 15000;
    if (estateLevel < 40) return 22000;
    return 30000;
  }

  _getTreeCount(estateLevel) {
    if (estateLevel < 10) return 15;
    if (estateLevel < 25) return 25;
    if (estateLevel < 40) return 35;
    return 50;
  }

  /**
   * Place procedural mountains around the map edge using a 9-point grid.
   * Merges all geometry per rock-type into a single draw call each.
   * @param {number} meshSize
   * @param {object} terrainSampler
   * @param {object} [config=DEFAULT_MOUNTAIN_CONFIG]
   */
  _createEdgeRocks(meshSize, terrainSampler, config = DEFAULT_MOUNTAIN_CONFIG) {
    this._edgeRocksGroup = new THREE.Group();
    this._edgeRocksGroup.name = 'edge-mountains';

    const half = meshSize * 0.5;
    const PI2 = Math.PI * 2;
    const toRad = (deg) => deg * Math.PI / 180;
    const rng = (i) => Math.sin(i * 127.1 + 311.7) * 0.5 + 0.5;

    // ── Template geometries ──
    // Two layer types: flat ledges and tapered slopes
    const ledgeTpl = new THREE.CylinderGeometry(1, 1, 1, 10, 1);      // flat plateau
    const slopeTpl = new THREE.CylinderGeometry(0.55, 1, 1, 10, 2);   // tapered frustum (slope face)
    const capTpl   = new THREE.IcosahedronGeometry(0.4, 0);            // irregular snow lump
    const screeTpl = new THREE.IcosahedronGeometry(1, 0);              // scree boulders

    // ── Inline helpers ──
    function deformGeo(geo, seed, amount = 0.25) {
      const clone = geo.clone();
      const pos = clone.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        const rx = Math.sin((seed * 1000 + v * 7.31) * 127.1 + 311.7) * 0.5 + 0.5;
        const ry = Math.sin((seed * 1000 + v * 13.17) * 269.3 + 183.1) * 0.5 + 0.5;
        const rz = Math.sin((seed * 1000 + v * 23.41) * 419.7 + 571.3) * 0.5 + 0.5;
        pos.setX(v, pos.getX(v) + (rx - 0.5) * amount);
        pos.setY(v, pos.getY(v) + (ry - 0.5) * amount * 0.2);
        pos.setZ(v, pos.getZ(v) + (rz - 0.5) * amount);
      }
      pos.needsUpdate = true;
      clone.computeVertexNormals();
      return clone;
    }

    // Build a mountain from alternating ledges and slopes — topographic profile
    function buildMountainLayers(geoArray, seed, x, baseY, z, width, height, rotY) {
      const layers = 5 + Math.floor(rng(seed * 47) * 3); // 5-7 layers total
      let curY = baseY;
      let curR = width; // current radius at this height

      for (let l = 0; l < layers; l++) {
        const t = l / layers;
        const isSlope = rng(seed + l * 67) > 0.35; // ~65% slopes, ~35% ledges
        const tpl = isSlope ? slopeTpl : ledgeTpl;

        // Slopes are taller, ledges are thin
        const layerH = isSlope
          ? (height / layers) * (1.0 + rng(seed + l * 31) * 0.6)
          : (height / layers) * (0.25 + rng(seed + l * 31) * 0.25);

        // Radius shrinks as we go up
        const nextR = curR * (isSlope ? (0.72 + rng(seed + l * 43) * 0.12) : (0.92 + rng(seed + l * 43) * 0.08));

        // Asymmetric XZ radii for non-circular footprint
        const rX = curR * (0.9 + rng(seed + l * 17) * 0.2);
        const rZ = curR * (0.85 + rng(seed + l * 23) * 0.3);

        // Slight XZ offset per layer
        const ox = (rng(seed + l * 41) - 0.5) * width * 0.08;
        const oz = (rng(seed + l * 53) - 0.5) * width * 0.08;

        const layer = deformGeo(tpl, seed + l * 100, isSlope ? 0.18 : 0.12);
        bakeTransform(layer, x + ox, curY + layerH * 0.5, z + oz, rX, layerH, rZ, rotY + rng(seed + l * 61) * 0.4);
        geoArray.push(layer);

        curY += layerH;
        curR = nextR;
      }
    }

    const _m4 = new THREE.Matrix4();
    const _pos = new THREE.Vector3();
    const _quat = new THREE.Quaternion();
    const _scl = new THREE.Vector3();
    const _euler = new THREE.Euler();

    function bakeTransform(geo, x, y, z, sx, sy, sz, rotY) {
      _pos.set(x, y, z);
      _euler.set(0, rotY, 0);
      _quat.setFromEuler(_euler);
      _scl.set(sx, sy, sz);
      _m4.compose(_pos, _quat, _scl);
      geo.applyMatrix4(_m4);
    }

    // ── Materials ──
    const rockMats = new Map();
    for (const pos of Object.keys(config)) {
      const packName = config[pos].rock || 'rock-cliff';
      if (!rockMats.has(packName)) {
        rockMats.set(packName, new THREE.MeshStandardMaterial({
          color: ROCK_COLORS[packName] || 0x6a6a5a,
          roughness: 0.95,
          metalness: 0.05,
          flatShading: true,
        }));
      }
    }
    const snowMat = new THREE.MeshStandardMaterial({
      color: 0xdde8ee,
      roughness: 0.8,
      metalness: 0,
      flatShading: true,
    });
    this._edgeRockMats = rockMats;
    this._edgeSnowMat = snowMat;

    // ── Geometry accumulators ──
    const rockGeoArrays = new Map(); // packName → BufferGeometry[]
    for (const name of rockMats.keys()) rockGeoArrays.set(name, []);
    const snowGeoArray = [];

    // ── (c) Front ring — per config grid point ──
    let seedOffset = 0;
    for (const [key, cfg] of Object.entries(config)) {
      if (!cfg.density || cfg.density <= 0) continue;
      const grid = MOUNTAIN_GRID[key];
      if (!grid) continue;

      const centerAngle = toRad(grid.angle);
      const centerDist = half * grid.radius;
      const packName = cfg.rock || 'rock-cliff';
      const spread = toRad(25); // ±25° angular spread

      for (let c = 0; c < cfg.density; c++) {
        const clusterSeed = seedOffset + c * 100;
        const peaksInCluster = 2 + Math.floor(rng(clusterSeed * 31) * 3); // 2-4

        for (let p = 0; p < peaksInCluster; p++) {
          const i = clusterSeed + p;
          const angleOff = (rng(i * 7) - 0.5) * spread * 2;
          const angle = centerAngle + (c / cfg.density - 0.5) * spread * 2 + angleOff;
          const distJitter = rng(i * 13 + 1) * 0.15;
          const dist = centerDist + half * distJitter;
          const x = Math.cos(angle) * dist;
          const z = Math.sin(angle) * dist;
          const baseY = terrainSampler.getHeight(x, z);

          // Layered mountain mass
          const height = 1.5 + rng(i * 11 + 3) * cfg.height;
          const width = 0.8 + rng(i * 17 + 5) * 1.4;
          const rotY = rng(i * 19) * PI2;
          buildMountainLayers(rockGeoArrays.get(packName), i, x, baseY, z, width, height, rotY);

          // Snow cap if above snow line
          const heightFraction = height / (1.5 + cfg.height);
          if (heightFraction > cfg.snowLine) {
            const capClone = deformGeo(capTpl, i + 75, 0.15);
            bakeTransform(capClone, x, baseY + height * 0.8, z, width * 0.5, 0.8, width * 0.5, rng(i * 37) * Math.PI);
            snowGeoArray.push(capClone);
          }
        }

        // Scree boulders (3-5 per cluster)
        const screeCount = 3 + Math.floor(rng(clusterSeed * 41) * 3);
        for (let s = 0; s < screeCount; s++) {
          const si = clusterSeed + 200 + s;
          const sAngle = centerAngle + (c / cfg.density - 0.5) * spread * 2 + (rng(si * 3) - 0.5) * spread;
          const sDist = centerDist + half * rng(si * 5) * 0.12;
          const sx = Math.cos(sAngle) * sDist;
          const sz = Math.sin(sAngle) * sDist;
          const sy = terrainSampler.getHeight(sx, sz);
          const sScale = 0.15 + rng(si * 9) * 0.35;
          const screeClone = deformGeo(screeTpl, si, 0.2);
          bakeTransform(screeClone, sx, sy + sScale * 0.3, sz, sScale, sScale * 0.7, sScale, rng(si * 11) * PI2);
          rockGeoArrays.get(packName).push(screeClone);
        }
      }
      seedOffset += cfg.density * 100 + 500;
    }

    // ── (d) Backdrop auto-fill ──
    for (let ri = 0; ri < RING_ORDER.length; ri++) {
      const keyA = RING_ORDER[ri];
      const keyB = RING_ORDER[(ri + 1) % RING_ORDER.length];
      const cfgA = config[keyA];
      const cfgB = config[keyB];
      // Skip backdrop if either neighbor has no mountains — respects density:0 gaps
      if (!cfgA || cfgA.density <= 0 || !cfgB || cfgB.density <= 0) continue;

      const gridA = MOUNTAIN_GRID[keyA];
      const gridB = MOUNTAIN_GRID[keyB];
      let angleA = toRad(gridA.angle);
      let angleB = toRad(gridB.angle);

      // Handle angle wrapping through 0/360
      if (angleB < angleA - Math.PI) angleB += PI2;
      if (angleA < angleB - Math.PI) angleA += PI2;

      const nearerCfg = (cfgA && cfgA.density > 0) ? cfgA : cfgB;
      const packName = nearerCfg.rock || 'rock-cliff';
      if (!rockGeoArrays.has(packName)) rockGeoArrays.set(packName, []);

      const count = 2 + Math.floor(rng(ri * 71) * 2); // 2-3 peaks
      for (let b = 0; b < count; b++) {
        const i = 5000 + ri * 100 + b;
        const t = (b + 0.5) / count;
        const angle = angleA + (angleB - angleA) * t + (rng(i * 7) - 0.5) * 0.15;
        const radiusFrac = 0.88 + rng(i * 13) * 0.10; // 88-98%
        const dist = half * radiusFrac;
        const x = Math.cos(angle) * dist;
        const z = Math.sin(angle) * dist;
        const baseY = terrainSampler.getHeight(x, z);

        const height = 3.0 + rng(i * 11 + 3) * 4.0;
        const width = 1.0 + rng(i * 17 + 5) * 1.5;

        const rotY = rng(i * 19) * PI2;
        buildMountainLayers(rockGeoArrays.get(packName), i + 300, x, baseY, z, width, height, rotY);

        // Snow cap on tall backdrop peaks
        if (height > 3.5) {
          const capClone = deformGeo(capTpl, i + 375, 0.15);
          bakeTransform(capClone, x, baseY + height * 0.8, z, width * 0.6, 1.0, width * 0.6, rng(i * 37) * Math.PI);
          snowGeoArray.push(capClone);
        }
      }
    }

    // ── (e) Merge phase ──
    const mergedGeos = [];
    const allMats = [];

    // Normalize attributes for merge compatibility
    function normalizeAttrs(g) {
      // Convert indexed to non-indexed so all geometries are consistent
      if (g.index) {
        const nonIndexed = g.toNonIndexed();
        // Copy attributes back
        for (const key of Object.keys(g.attributes)) g.deleteAttribute(key);
        for (const key of Object.keys(nonIndexed.attributes)) {
          g.setAttribute(key, nonIndexed.attributes[key]);
        }
        g.setIndex(null);
        nonIndexed.dispose();
      }
      if (!g.attributes.uv) {
        g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      }
      for (const attr of Object.keys(g.attributes)) {
        if (attr !== 'position' && attr !== 'normal' && attr !== 'uv') {
          g.deleteAttribute(attr);
        }
      }
    }

    // Merge per rock type
    for (const [packName, geoArr] of rockGeoArrays) {
      if (geoArr.length === 0) continue;
      for (const g of geoArr) normalizeAttrs(g);

      const merged = mergeGeometries(geoArr, false);
      if (merged) {
        const mesh = new THREE.Mesh(merged, rockMats.get(packName));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this._edgeRocksGroup.add(mesh);
        mergedGeos.push(merged);
        allMats.push(rockMats.get(packName));
      }
      for (const g of geoArr) g.dispose();
    }

    // Merge snow caps
    if (snowGeoArray.length > 0) {
      for (const g of snowGeoArray) normalizeAttrs(g);
      const mergedSnow = mergeGeometries(snowGeoArray, false);
      if (mergedSnow) {
        const snowMesh = new THREE.Mesh(mergedSnow, snowMat);
        snowMesh.castShadow = false;
        snowMesh.receiveShadow = true;
        this._edgeRocksGroup.add(snowMesh);
        mergedGeos.push(mergedSnow);
        allMats.push(snowMat);
      }
      for (const g of snowGeoArray) g.dispose();
    }

    // Dispose templates
    ledgeTpl.dispose();
    slopeTpl.dispose();
    capTpl.dispose();
    screeTpl.dispose();

    this._edgeRockGeo = mergedGeos;
    this._edgeRockMat = [snowMat, ...rockMats.values()];
    this._townGroup.add(this._edgeRocksGroup);
  }

  /**
   * Create a sea inlet with beach transition by carving terrain and adding a water plane.
   * @param {number} meshSize
   * @param {object} config - { enabled, angle, spread, reach, depth, beachWidth }
   */
  _createSea(meshSize, config) {
    if (!config || !config.enabled) return;

    const half = meshSize * 0.5;
    const angleDeg = config.angle ?? 135;
    const spreadDeg = config.spread ?? 60;
    const reach = config.reach ?? 3.0;
    const depth = config.depth ?? 0.15;
    const seaHeight = config.height ?? -0.04;
    const beachWidth = config.beachWidth ?? 1.5;

    const angleRad = angleDeg * Math.PI / 180;
    const spreadRad = spreadDeg * Math.PI / 180;
    const halfSpread = spreadRad / 2;

    // ── 1. Carve terrain vertices to create beach slope ──
    const terrainMesh = this._terrain._mesh;
    if (!terrainMesh) return;

    const pos = terrainMesh.geometry.attributes.position;
    const colors = terrainMesh.geometry.attributes.color;

    // Beach/sand color
    const sandR = 0.82, sandG = 0.78, sandB = 0.63;
    // Wet sand (near water)
    const wetR = 0.6, wetG = 0.55, wetB = 0.45;

    // Extra angular feather beyond halfSpread for color-only blending
    // so the green skirt edge-fade color doesn't show through at sea boundaries
    const colorFeather = 15 * Math.PI / 180; // 15 degrees of extra color blending
    const colorHalfSpread = halfSpread + colorFeather;

    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);

      // Angle from center to this vertex (note: terrain Z is flipped from plane Y)
      const vertAngle = Math.atan2(-vz, vx);

      // Angular distance from sea center, handling wraparound
      let angleDiff = vertAngle - angleRad;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      const absAngle = Math.abs(angleDiff);
      if (absAngle > colorHalfSpread) continue;

      const dist = Math.sqrt(vx * vx + vz * vz);
      const edgeDist = half - dist; // distance from terrain edge inward

      const totalZone = reach + beachWidth;
      if (edgeDist > totalZone) continue;

      // Angular softness — fade at the edges of the spread
      const angularT = Math.min(1, absAngle / halfSpread);
      const angularFade = 1.0 - angularT * angularT; // quadratic falloff at spread edges

      // Carve terrain only within the main spread
      if (absAngle <= halfSpread) {
        // One continuous slope: 0 at terrain edge → 1 at inland boundary
        const t = Math.max(0, Math.min(1, edgeDist / totalZone));
        const smoothT = t * t * (3 - 2 * t); // smoothstep

        const currentY = pos.getY(i);
        const belowWater = -depth * angularFade;
        const newY = belowWater + (currentY - belowWater) * smoothT;
        pos.setY(i, newY);
      }

      // Color: blend sand/wet-sand with extended angular reach
      // In the feather zone (beyond halfSpread), only color is applied (no terrain carving)
      const colorAngularT = Math.min(1, absAngle / colorHalfSpread);
      const colorAngularFade = 1.0 - colorAngularT * colorAngularT;

      const t = Math.max(0, Math.min(1, edgeDist / totalZone));
      const smoothT = t * t * (3 - 2 * t);

      const sandBlend = (1 - smoothT) * colorAngularFade;
      const wetBlend = (1 - t) * colorAngularFade; // stronger near edge
      const cr = colors.getX(i), cg = colors.getY(i), cb = colors.getZ(i);
      // Lerp terrain → sand, then tint toward wet sand near water
      const sr = cr * (1 - sandBlend) + sandR * sandBlend;
      const sg = cg * (1 - sandBlend) + sandG * sandBlend;
      const sb = cb * (1 - sandBlend) + sandB * sandBlend;
      colors.setXYZ(i,
        sr * (1 - wetBlend) + wetR * wetBlend,
        sg * (1 - wetBlend) + wetG * wetBlend,
        sb * (1 - wetBlend) + wetB * wetBlend,
      );
    }

    pos.needsUpdate = true;
    colors.needsUpdate = true;
    terrainMesh.geometry.computeVertexNormals();

    // ── 2. Generate procedural water textures ──
    const texSize = 256;
    const normalData = new Uint8Array(texSize * texSize * 4);
    const roughData = new Uint8Array(texSize * texSize * 4);

    // Simple hash for procedural generation
    const hash = (x, y, s) => {
      const n = Math.sin(x * 127.1 + y * 311.7 + s * 73.7) * 43758.5453;
      return n - Math.floor(n);
    };

    for (let y = 0; y < texSize; y++) {
      for (let x = 0; x < texSize; x++) {
        const idx = (y * texSize + x) * 4;
        const u = x / texSize;
        const v = y / texSize;

        // Multi-octave noise for water ripple normals
        let nx = 0, ny = 0;
        for (let oct = 0; oct < 4; oct++) {
          const freq = Math.pow(2, oct + 2);
          const amp = 1.0 / Math.pow(2, oct);
          const sx = Math.sin(u * freq * 6.28 + hash(oct, 0, 1) * 6.28) * amp;
          const sy = Math.sin(v * freq * 6.28 + hash(oct, 1, 2) * 6.28) * amp;
          nx += (hash(Math.floor(u * freq * texSize), Math.floor(v * freq * texSize), oct) - 0.5) * amp;
          ny += (hash(Math.floor(u * freq * texSize) + 1, Math.floor(v * freq * texSize), oct + 5) - 0.5) * amp;
        }
        // Encode normal: XY perturbation, Z up, tangent space
        normalData[idx]     = Math.min(255, Math.max(0, (nx * 0.3 + 0.5) * 255));
        normalData[idx + 1] = Math.min(255, Math.max(0, (ny * 0.3 + 0.5) * 255));
        normalData[idx + 2] = 220; // strong Z (mostly facing up)
        normalData[idx + 3] = 255;

        // Roughness: subtle variation
        const r = 0.1 + hash(x, y, 99) * 0.15;
        const rv = Math.min(255, Math.max(0, r * 255));
        roughData[idx] = rv;
        roughData[idx + 1] = rv;
        roughData[idx + 2] = rv;
        roughData[idx + 3] = 255;
      }
    }

    const normalTex = new THREE.DataTexture(normalData, texSize, texSize, THREE.RGBAFormat);
    normalTex.wrapS = THREE.RepeatWrapping;
    normalTex.wrapT = THREE.RepeatWrapping;
    normalTex.magFilter = THREE.LinearFilter;
    normalTex.minFilter = THREE.LinearMipMapLinearFilter;
    normalTex.generateMipmaps = true;
    normalTex.needsUpdate = true;

    const roughTex = new THREE.DataTexture(roughData, texSize, texSize, THREE.RGBAFormat);
    roughTex.wrapS = THREE.RepeatWrapping;
    roughTex.wrapT = THREE.RepeatWrapping;
    roughTex.magFilter = THREE.LinearFilter;
    roughTex.minFilter = THREE.LinearMipMapLinearFilter;
    roughTex.generateMipmaps = true;
    roughTex.needsUpdate = true;

    // ── 3. Create fan-shaped water surface matching the sea arc ──
    const fanSegs = 32;
    const innerR = 0.01; // tiny inner radius at the fan center
    const outerR = half + 1; // extend past terrain edge
    const fanVerts = [];
    const fanUvs = [];
    const fanIndices = [];

    // Fan origin is at world center; vertices are in world XZ
    for (let s = 0; s <= fanSegs; s++) {
      const t = s / fanSegs;
      const a = angleRad - halfSpread + spreadRad * t;
      const cosA = Math.cos(a);
      const sinA = -Math.sin(a); // flip Z to match terrain coords

      // Inner vertex
      fanVerts.push(cosA * innerR, 0, sinA * innerR);
      fanUvs.push(t, 0);

      // Outer vertex
      fanVerts.push(cosA * outerR, 0, sinA * outerR);
      fanUvs.push(t, 1);
    }

    for (let s = 0; s < fanSegs; s++) {
      const i0 = s * 2;
      const i1 = s * 2 + 1;
      const i2 = s * 2 + 2;
      const i3 = s * 2 + 3;
      fanIndices.push(i0, i1, i2);
      fanIndices.push(i2, i1, i3);
    }

    const seaGeo = new THREE.BufferGeometry();
    seaGeo.setAttribute('position', new THREE.Float32BufferAttribute(fanVerts, 3));
    seaGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fanUvs, 2));
    seaGeo.setIndex(fanIndices);
    seaGeo.computeVertexNormals();

    const seaMat = new THREE.MeshStandardMaterial({
      color: 0x2266aa,
      transparent: true,
      opacity: 0.7,
      roughness: 0.15,
      metalness: 0.3,
      normalMap: normalTex,
      normalScale: new THREE.Vector2(0.4, 0.4),
      roughnessMap: roughTex,
      side: THREE.DoubleSide,
    });

    const seaMesh = new THREE.Mesh(seaGeo, seaMat);
    seaMesh.position.set(0, seaHeight, 0);
    seaMesh.name = 'water-sea';
    seaMesh.renderOrder = 5;
    this._townGroup.add(seaMesh);
    this._seaMesh = seaMesh;
    this._seaMat = seaMat;

    // ── 4. Opaque seabed to hide the green skirt plane underneath the transparent water ──
    const seabedGeo = seaGeo.clone();
    const seabedMat = new THREE.MeshStandardMaterial({
      color: 0x8a7a5a, // sandy seabed color
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const seabedMesh = new THREE.Mesh(seabedGeo, seabedMat);
    seabedMesh.position.set(0, seaHeight - 0.01, 0);
    seabedMesh.name = 'seabed';
    seabedMesh.renderOrder = 4;
    this._townGroup.add(seabedMesh);
    this._seabedMesh = seabedMesh;
    this._seabedMat = seabedMat;
  }

  _computeDockFacing(x, z) {
    if (!this._terrain) return 0;
    let bestAngle = 0;
    let lowestElev = Infinity;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const testX = x + Math.cos(a) * 0.5;
      const testZ = z + Math.sin(a) * 0.5;
      const h = this._terrain.getHeight(testX, testZ);
      if (h < lowestElev) {
        lowestElev = h;
        bestAngle = a;
      }
    }
    return bestAngle;
  }

  _attachBuildingParticles(vs) {
    if (!vs.buildings || !this._particles) return;
    for (let i = 0; i < vs.buildings.length; i++) {
      const b = vs.buildings[i];
      if (!b || b.type < 0 || b.status === 0) continue;
      const group = this._buildingGroups.get(i);
      if (!group) continue;
      const pos = group.position;

      // Building-specific particles
      switch (b.type) {
        case 0: // Mansion — chimney smoke
          if (b.level >= 5) {
            this._particles.createEmitter('chimney-smoke', new THREE.Vector3(pos.x + 0.03, pos.y + 0.15, pos.z));
          }
          break;
        case 5: // Forge — sparks + smoke
          this._particles.createEmitter('forge-smoke', new THREE.Vector3(pos.x, pos.y + 0.18, pos.z));
          this._particles.createEmitter('forge-sparks', new THREE.Vector3(pos.x, pos.y + 0.05, pos.z));
          break;
        case 9: // Sanctuary — motes
          this._particles.createEmitter('sanctuary-motes', new THREE.Vector3(pos.x, pos.y + 0.05, pos.z));
          break;
        case 11: // Treasury — gold coins
          this._particles.createEmitter('dust-motes', new THREE.Vector3(pos.x, pos.y + 0.08, pos.z));
          break;
      }
    }
  }

  _setupEconomyRoutes(vs, districtLayout) {
    if (!this._economyCarts || !vs.buildings) return;
    const buildings = vs.buildings;
    const groups = this._buildingGroups;

    // Workshop → Forge route
    const workshopIdx = buildings.findIndex(b => b && b.type === 2 && b.status > 0);
    const forgeIdx = buildings.findIndex(b => b && b.type === 5 && b.status > 0);
    if (workshopIdx >= 0 && forgeIdx >= 0 && groups.has(workshopIdx) && groups.has(forgeIdx)) {
      const from = groups.get(workshopIdx).position.clone();
      const to = groups.get(forgeIdx).position.clone();
      this._economyCarts.addRoute(from, to, [], 0, 25);
    }

    // Dock → Market route
    const dockIdx = buildings.findIndex(b => b && b.type === 4 && b.status > 0);
    const marketIdx = buildings.findIndex(b => b && b.type === 6 && b.status > 0);
    if (dockIdx >= 0 && marketIdx >= 0 && groups.has(dockIdx) && groups.has(marketIdx)) {
      const from = groups.get(dockIdx).position.clone();
      const to = groups.get(marketIdx).position.clone();
      this._economyCarts.addRoute(from, to, [], 2, 30);
    }
  }

  _placeFlowers(vs, districtLayout, terrainSampler) {
    if (!this._flowers || !districtLayout) return;
    for (const district of districtLayout.districts) {
      if (district.buildingType === 0) { // Mansion — flower garden
        this._flowers.createPatch(
          new THREE.Vector3(district.center.x + 0.2, 0, district.center.z + 0.2),
          0.15, 'wildflower',
        );
      }
      if (district.buildingType === 9) { // Sanctuary — shrine flowers
        this._flowers.createPatch(
          new THREE.Vector3(district.center.x, 0, district.center.z),
          0.2, 'shrine',
        );
      }
      if (district.buildingType === 6) { // Market — crop field
        this._flowers.createCropField(
          new THREE.Vector3(district.center.x - 0.15, 0, district.center.z + 0.15),
          0.3, 0.2, 0.03,
        );
      }
    }
  }

  _registerBuildingProps(vs) {
    if (!this._propPhysics || !vs.buildings) return;
    for (const [index, group] of this._buildingGroups) {
      // Find swinging signs
      const sign = group.getObjectByName('sign');
      if (sign) {
        this._propPhysics.registerPendulum(sign, { ropeLength: 0.05, damping: 0.97 });
      }
      // Find water wheels
      const wheel = group.getObjectByName('waterwheel');
      if (wheel) {
        this._propPhysics.registerRotor(wheel, { friction: 0.01, speed: 1.0 });
      }
    }
  }

  async _setupAudio(vs, districtLayout) {
    if (!this._audio) return;

    // Initialize the AudioContext (requires user gesture on most browsers).
    // If suspended, set up a one-time click/touch listener to resume it.
    await this._audio.initialize();
    if (!this._audio._initialized) return;

    const resumeAudio = () => {
      if (this._audio && this._audio._ctx && this._audio._ctx.state === 'suspended') {
        this._audio._ctx.resume();
      }
      document.removeEventListener('click', resumeAudio);
      document.removeEventListener('touchstart', resumeAudio);
    };
    document.addEventListener('click', resumeAudio, { once: true });
    document.addEventListener('touchstart', resumeAudio, { once: true });

    // Sound anchor type → { clip name, volume }
    const SOUND_CONFIG = {
      'anvil':      { clip: 'hammer',  volume: 0.4 },
      'hammering':  { clip: 'hammer',  volume: 0.35 },
      'waves':      { clip: 'waves',   volume: 0.3 },
      'chime':      { clip: 'choir',   volume: 0.2 },
      'fireplace':  { clip: 'fire',    volume: 0.25 },
      'training':   { clip: 'training', volume: 0.3 },
      'coins':      { clip: 'coins',   volume: 0.2 },
      'chatter':    { clip: 'chatter', volume: 0.3 },
      'studying':   { clip: 'studying', volume: 0.15 },
      'crowd':      { clip: 'crowd',   volume: 0.35 },
      'mechanical': { clip: 'mechanical', volume: 0.2 },
      'guards':     { clip: 'guards',  volume: 0.25 },
    };

    // Register building sound sources from anchors
    for (const [index, group] of this._buildingGroups) {
      const b = vs.buildings[index];
      if (!b) continue;
      const sounds = this._buildingFactory.getSoundAnchors(b.type, b.level || 1);
      for (const sound of sounds) {
        const worldPos = sound.position.clone().add(group.position);
        const cfg = SOUND_CONFIG[sound.type] || { clip: sound.type, volume: 0.25 };
        this._audio.registerSource(`${sound.type}-${index}`, worldPos, cfg.clip, { loop: true, volume: cfg.volume });
      }
    }

    // Fountain in town square
    if (vs.estateLevel >= 20) {
      this._audio.registerSource('fountain', new THREE.Vector3(0, 0.1, 0), 'water', { loop: true, volume: 0.5 });
    }
  }

  // ── State change callbacks ──

  _onBuildingChange(index, data) {
    this._updateBuilding(index, data);
  }

  _onBuildingLevelUp(index) {
    const group = this._buildingGroups.get(index);
    if (group) this._buildingAnimator.playLevelUpEffect(group);
    if (this._audio) this._audio.playOneShot('levelup', group ? group.position : null);
  }

  _onPlotUnlock(plotIndex) {
    if (this._audio) this._audio.playOneShot('construction', null);

    // Update camera bounds to include the new plot area
    if (this._districts && this._cameraController) {
      const newPlots = Math.min(5, plotIndex + 1);
      const newBounds = this._districts.getActiveBounds(newPlots);
      this._cameraController.setPanBounds(newBounds);

      // Transition camera to new centroid
      const newCenter = this._districts.getTownSquarePosition(newPlots);
      this._cameraController.setTarget(newCenter.x, 0.1, newCenter.z);
    }

  }

  _onCraftStart(data) {
    const forgeIndex = data.buildingIndex;
    const group = this._buildingGroups.get(forgeIndex);
    if (group) {
      this._buildingAnimator.showCraftIndicator(group, data.qualityTier, 0);
    }
  }

  _onCraftComplete(data) {
    const forgeIndex = data.buildingIndex;
    const group = this._buildingGroups.get(forgeIndex);
    if (group) {
      this._buildingAnimator.hideCraftIndicator(group);
      this._buildingAnimator.playLevelUpEffect(group); // celebrate
    }
  }

  // ════════════════════════════════════════════════════
  //  Organic Roads & Per-Building Lamps
  // ════════════════════════════════════════════════════

  /**
   * Deterministic hash for seeded randomness.
   * @param {number} n
   * @returns {number} 0..1
   */
  static _hash(n) {
    let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /**
   * Generate a curved path between two points using Catmull-Rom splines.
   * Inserts intermediate waypoints with seeded perpendicular offsets
   * to create organic, non-straight roads.
   *
   * @param {number} sx Start X
   * @param {number} sz Start Z
   * @param {number} ex End X
   * @param {number} ez End Z
   * @param {number} numWaypoints How many interior control points (1-4)
   * @param {number} maxOffset Max perpendicular wobble distance
   * @param {number} seed Deterministic seed
   * @returns {Array<{x:number,z:number}>} Sampled spline points
   */
  _generateCurvedPath(sx, sz, ex, ez, numWaypoints, maxOffset, seed) {
    const dx = ex - sx, dz = ez - sz;
    const len = Math.sqrt(dx * dx + dz * dz) || 0.01;
    // Perpendicular direction
    const nx = -dz / len, nz = dx / len;
    const h = TownRenderer._hash;

    // Build waypoints with seeded perpendicular offsets
    const waypoints = [{ x: sx, z: sz }];
    for (let i = 1; i <= numWaypoints; i++) {
      const t = i / (numWaypoints + 1);
      // Alternate sides and vary magnitude for S-curve feel
      const sign = (i % 2 === 0) ? 1 : -1;
      const magnitude = (h(seed + i * 7) * 0.6 + 0.4) * maxOffset * sign;
      waypoints.push({
        x: sx + dx * t + nx * magnitude,
        z: sz + dz * t + nz * magnitude,
      });
    }
    waypoints.push({ x: ex, z: ez });

    // Catmull-Rom interpolation across segments
    const samplesPerSegment = 8;
    const result = [];

    for (let i = 0; i < waypoints.length - 1; i++) {
      const p0 = waypoints[Math.max(0, i - 1)];
      const p1 = waypoints[i];
      const p2 = waypoints[Math.min(waypoints.length - 1, i + 1)];
      const p3 = waypoints[Math.min(waypoints.length - 1, i + 2)];

      for (let s = 0; s < samplesPerSegment; s++) {
        const t = s / samplesPerSegment;
        const t2 = t * t, t3 = t2 * t;
        result.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
        });
      }
    }
    // Final point
    result.push({ x: ex, z: ez });
    return result;
  }

  /**
   * Build a ribbon mesh along a path (for roads/paths).
   * Width swells in the middle and tapers at endpoints for organic feel.
   *
   * @param {Array<{x:number,z:number}>} pathPoints
   * @param {number} width
   * @param {object} terrainSampler
   * @param {THREE.Material} material
   * @returns {THREE.Mesh}
   */
  _buildRibbonMesh(pathPoints, width, terrainSampler, material, closed = false) {
    if (pathPoints.length < 2) return new THREE.Group();

    const halfW = width * 0.5;
    const vertices = [];
    const uvs = [];
    const indices = [];
    const n = pathPoints.length;
    let accumLen = 0;

    for (let i = 0; i < n; i++) {
      const p = pathPoints[i];

      // Accumulate distance along the path for UV tiling
      if (i > 0) {
        const prev = pathPoints[i - 1];
        const dx = p.x - prev.x, dz = p.z - prev.z;
        accumLen += Math.sqrt(dx * dx + dz * dz);
      }

      // Tangent from neighboring points
      let tx, tz;
      if (closed) {
        // For closed paths, wrap around
        const prev = pathPoints[(i - 1 + n) % n];
        const next = pathPoints[(i + 1) % n];
        tx = next.x - prev.x;
        tz = next.z - prev.z;
      } else if (i === 0) {
        tx = pathPoints[1].x - p.x;
        tz = pathPoints[1].z - p.z;
      } else if (i === n - 1) {
        tx = p.x - pathPoints[i - 1].x;
        tz = p.z - pathPoints[i - 1].z;
      } else {
        tx = pathPoints[i + 1].x - pathPoints[i - 1].x;
        tz = pathPoints[i + 1].z - pathPoints[i - 1].z;
      }
      const tLen = Math.sqrt(tx * tx + tz * tz) || 0.01;
      tx /= tLen;
      tz /= tLen;

      // Perpendicular
      const nx = -tz, nz = tx;

      // Width swell: wider in the middle, tapers at endpoints (skip for closed)
      const t = i / (n - 1);
      const swell = closed ? 1.0 : 0.65 + 0.35 * Math.sin(t * Math.PI);
      const hw = halfW * swell;

      const y = terrainSampler.getHeight(p.x, p.z) + 0.004;

      // Left + right vertices
      vertices.push(p.x + nx * hw, y, p.z + nz * hw);
      vertices.push(p.x - nx * hw, y, p.z - nz * hw);

      // UVs: u = 0/1 across width, v = distance along road (tiles every ~4 widths)
      const vCoord = accumLen / (width * 4);
      uvs.push(0, vCoord);
      uvs.push(1, vCoord);

      // Two triangles per quad
      if (i > 0) {
        const v = (i - 1) * 2;
        indices.push(v, v + 1, v + 2);
        indices.push(v + 1, v + 3, v + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Build curved organic roads:
   *  1. Main roads from town square to each owned plot center (wide, 3 waypoints)
   *  2. Inter-plot roads connecting adjacent plots (medium width, 2 waypoints)
   *  3. Building access paths from each building to its plot center (narrow, 1 waypoint)
   */
  _buildOrganicRoads(vs, terrainSampler) {
    this._organicRoads = new THREE.Group();
    this._organicRoads.name = 'organic-roads';

    const roadColor = this._layoutConfig?.roads?.color || '#9a9080';
    const mainRoadMat = new THREE.MeshStandardMaterial({
      color: roadColor, roughness: 0.85, metalness: 0.02,
    });
    const accessPathMat = new THREE.MeshStandardMaterial({
      color: roadColor, roughness: 0.9, metalness: 0,
    });
    // Store for async texture application
    this._ribbonRoadMats = this._ribbonRoadMats || [];
    this._ribbonRoadMats.push(mainRoadMat, accessPathMat);

    const plotConfigs = this._layoutConfig ? this._layoutConfig.plots : null;
    if (!plotConfigs) {
      this._townGroup.add(this._organicRoads);
      return;
    }

    // Road widths from layout config (roads.width is the base unit)
    const baseWidth = this._layoutConfig?.roads?.width ?? 0.23;
    const mainWidth = baseWidth;
    const interWidth = baseWidth * 0.7;
    const accessWidth = baseWidth * 0.35;

    const plotsOwned = vs.plotsOwned || 1;
    const townSquarePos = this._districts.getTownSquarePosition(plotsOwned);
    const tsX = this._layoutConfig?.townSquare?.x ?? townSquarePos.x;
    const tsZ = this._layoutConfig?.townSquare?.z ?? townSquarePos.z;

    for (let p = 0; p < plotsOwned && p < plotConfigs.length; p++) {
      const plot = plotConfigs[p];
      const px = plot.x ?? 0;
      const pz = plot.z ?? 0;

      // ── Main road: town square → plot center (3 waypoints, wide, S-curve) ──
      const mainPath = this._generateCurvedPath(
        tsX, tsZ, px, pz,
        3,    // waypoints for gentle S-curve
        0.35, // max perpendicular offset
        p * 137 + 7,
      );
      this._organicRoads.add(this._buildRibbonMesh(mainPath, mainWidth, terrainSampler, mainRoadMat));

      // ── Inter-plot roads: connect to previous plot (2 waypoints) ──
      if (p > 0) {
        const prev = plotConfigs[p - 1];
        const prevX = prev.x ?? 0;
        const prevZ = prev.z ?? 0;
        const interPath = this._generateCurvedPath(
          prevX, prevZ, px, pz,
          2,
          0.25,
          p * 211 + 13,
        );
        this._organicRoads.add(this._buildRibbonMesh(interPath, interWidth, terrainSampler, mainRoadMat));
      }

      // ── Access paths: each building → plot center (1 waypoint, narrow) ──
      const buildings = plot.buildings || [];
      for (let si = 0; si < buildings.length; si++) {
        const slot = plot.slots[si];
        if (!slot) continue;
        const bx = px + slot.dx;
        const bz = pz + slot.dz;

        const accessPath = this._generateCurvedPath(
          bx, bz, px, pz,
          1,    // single bend
          0.06, // subtle wobble
          p * 100 + si * 17 + 3,
        );
        this._organicRoads.add(this._buildRibbonMesh(accessPath, accessWidth, terrainSampler, accessPathMat));
      }
    }

    this._townGroup.add(this._organicRoads);
  }

  /**
   * Place a lamp post near each building, facing toward the plot center
   * (the "entrance" side). Registers each lamp with the day/night system.
   */
  _placePerBuildingLamps(terrainSampler) {
    this._buildingLamps = [];

    const postMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.7, metalness: 0.3 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0xffddaa, emissive: 0xffddaa, emissiveIntensity: 0.6 });
    const postGeo = new THREE.CylinderGeometry(0.002, 0.003, 0.05, 5);
    const glowGeo = new THREE.SphereGeometry(0.006, 6, 4);

  //   for (const [index, group] of this._buildingGroups) {
  //     const pos = group.position;
  //     const plotIndex = group.userData.plotIndex ?? Math.floor(index / 4);

  //     // Place lamp south-east of the building, outside its footprint
  //     const seNorm = 1 / Math.SQRT2; // normalized (1,1) direction
  //     const lampDist = 0.3;
  //     const lx = pos.x + seNorm * lampDist;
  //     const lz = pos.z + seNorm * lampDist;
  //     const ly = terrainSampler.getHeight(lx, lz);
  //     const lampHeight = 0.05;

  //     const post = new THREE.Mesh(postGeo, postMat);
  //     post.position.set(lx, ly + lampHeight * 0.5, lz);
  //     post.castShadow = true;

  //     const glow = new THREE.Mesh(glowGeo, glowMat);
  //     glow.position.set(lx, ly + lampHeight + 0.006, lz);

  //     this._townGroup.add(post);
  //     this._townGroup.add(glow);
  //     this._buildingLamps.push(post, glow);

  //     // Register with day/night for nighttime glow
  //     if (this._dayNight) {
  //       this._dayNight.registerTorch(
  //         new THREE.Vector3(lx, ly + lampHeight + 0.006, lz),
  //         { color: 0xffddaa, intensity: 0.8, radius: 2.0 },
  //       );
  //     }
  //   }
  }

  // ════════════════════════════════════════════════════
  //  Custom Layout Objects (lamps, trees, walls)
  // ════════════════════════════════════════════════════

  _placeCustomLamps(layoutConfig, terrainSampler) {
    this._customLamps = [];
    const lamps = layoutConfig.lamps?.custom;
    if (!lamps || lamps.length === 0) return;

    const postMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.7, metalness: 0.3 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0xffeeaa, emissive: 0xffeeaa, emissiveIntensity: 0.8 });

    for (let i = 0; i < lamps.length; i++) {
      const lamp = lamps[i];
      const y = terrainSampler.getHeight(lamp.x, lamp.z);
      const height = lamp.height || 0.06;

      // Lamp post — thin cylinder
      const postGeo = new THREE.CylinderGeometry(0.003, 0.004, height, 6);
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(lamp.x, y + height * 0.5, lamp.z);
      post.castShadow = true;

      // Glow sphere at top
      const glowGeo = new THREE.SphereGeometry(0.014, 8, 6);
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.set(lamp.x, y + height + 0.008, lamp.z);

      const group = new THREE.Group();
      group.add(post);
      group.add(glow);
      group.userData.editType = 'lamp';
      group.userData.editIndex = i;
      this._townGroup.add(group);
      this._customLamps.push(group);

      // Register with day/night system
      if (this._dayNight) {
        const color = lamp.color ? new THREE.Color(lamp.color) : new THREE.Color(0xffeeaa);
        this._dayNight.registerTorch(
          new THREE.Vector3(lamp.x, y + height + 0.008, lamp.z),
          { color: color.getHex(), intensity: 1.2, radius: 3.0 },
        );
      }
    }
  }

  _placeCustomDecorations(layoutConfig, terrainSampler) {
    this._customDecorations = [];
    const decorations = layoutConfig.decorations;
    if (!decorations || decorations.length === 0) return;

    const DEG = Math.PI / 180;
    for (let i = 0; i < decorations.length; i++) {
      const dec = decorations[i];
      const mesh = createDecorationMesh(dec.type, dec);
      if (!mesh) continue;

      const y = terrainSampler ? terrainSampler.getHeight(dec.x || 0, dec.z || 0) : 0;
      mesh.position.set(dec.x || 0, y, dec.z || 0);
      if (dec.rotation) mesh.rotation.y = dec.rotation * DEG;

      mesh.userData.editType = 'decoration';
      mesh.userData.editIndex = i;
      mesh.userData.decorationType = dec.type;
      this._townGroup.add(mesh);
      this._customDecorations.push(mesh);
    }
  }

  _placeCustomTrees(layoutConfig, terrainSampler) {
    this._customTreeMeshes = [];
    const trees = layoutConfig.trees?.custom;
    if (!trees || trees.length === 0) return;

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.9 });
    const leafColors = {
      oak:   [0x2d6b30, 0x3a7a35, 0x4a8a40],
      pine:  [0x1a5a20, 0x2d5a30, 0x1e6828],
      birch: [0x5a9a40, 0x4a8a35, 0x6aaa50],
    };
    for (let i = 0; i < trees.length; i++) {
      const treeCfg = trees[i];
      const cx = treeCfg.x;
      const cz = treeCfg.z;
      const baseScale = treeCfg.scale || 1.0;
      const treeType = treeCfg.type || 'oak';
      const clusterSize = treeCfg.count || 8;
      const spread = treeCfg.spread || 0.12;

      // Cluster group — the editor selects/drags this as one unit
      const clusterGroup = new THREE.Group();
      clusterGroup.userData.editType = 'tree';
      clusterGroup.userData.editIndex = i;

      const seed = TownRenderer._hash(i * 137 + 51);
      for (let j = 0; j < clusterSize; j++) {
        // Deterministic offset from cluster center
        const h1 = TownRenderer._hash(seed + j * 73);
        const h2 = TownRenderer._hash(seed + j * 73 + 31);
        const h3 = TownRenderer._hash(seed + j * 73 + 59);
        const angle = h1 * Math.PI * 2;
        const dist = Math.sqrt(h2) * spread; // sqrt for uniform area distribution
        const ox = Math.cos(angle) * dist;
        const oz = Math.sin(angle) * dist;

        const tx = cx + ox;
        const tz = cz + oz;
        const ty = terrainSampler.getHeight(tx, tz);

        // Vary scale per tree in cluster
        const scaleJitter = 0.6 + h3 * 0.8; // 0.6 – 1.4
        const s = baseScale * scaleJitter;

        const trunkH = 0.08 * s;
        const trunkR = 0.006 * s;

        const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 5);
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(ox, ty + trunkH * 0.5, oz);
        trunk.rotation.y = h1 * 6;

        const colors = leafColors[treeType] || leafColors.oak;
        const leafColor = colors[j % colors.length];
        const leafR = 0.04 * s;
        const leafGeo = treeType === 'pine'
          ? new THREE.ConeGeometry(leafR, leafR * 2.5, 6)
          : new THREE.IcosahedronGeometry(leafR, 1);
        const leafMat = new THREE.MeshStandardMaterial({ color: leafColor, roughness: 0.85 });
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        leaf.position.set(ox, ty + trunkH + leafR * 0.6, oz);
        leaf.rotation.y = h2 * 6;

        trunk.castShadow = true;
        leaf.castShadow = true;
        leaf.receiveShadow = true;
        clusterGroup.add(trunk);
        clusterGroup.add(leaf);
      }

      clusterGroup.position.set(cx, 0, cz);
      this._townGroup.add(clusterGroup);
      this._customTreeMeshes.push(clusterGroup);
    }
  }

  /**
   * Catmull-Rom spline sampling from an array of control points.
   * @param {Array<{x:number,z:number}>} waypoints
   * @param {number} [samplesPerSegment=8]
   * @returns {Array<{x:number,z:number}>}
   */
  _sampleCatmullRom(waypoints, samplesPerSegment = 8, closed = false) {
    if (waypoints.length < 2) return waypoints.slice();
    const n = waypoints.length;
    const result = [];
    const segCount = closed ? n : n - 1;

    for (let i = 0; i < segCount; i++) {
      const p0 = waypoints[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const p1 = waypoints[closed ? i % n : i];
      const p2 = waypoints[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const p3 = waypoints[closed ? (i + 2) % n : Math.min(n - 1, i + 2)];
      for (let s = 0; s < samplesPerSegment; s++) {
        const t = s / samplesPerSegment;
        const t2 = t * t, t3 = t2 * t;
        result.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
        });
      }
    }
    if (closed) {
      // Close the loop by appending the first sampled point
      if (result.length > 0) result.push({ x: result[0].x, z: result[0].z });
    } else {
      result.push({ x: waypoints[n - 1].x, z: waypoints[n - 1].z });
    }
    return result;
  }

  /**
   * Place custom roads from layoutConfig.roads.customPaths.
   * Each path is rendered as a Catmull-Rom ribbon mesh with draggable control point handles.
   */
  _placeCustomRoads(layoutConfig, terrainSampler) {
    this._customRoads = [];
    const paths = layoutConfig.roads?.customPaths;
    if (!paths || paths.length === 0) return;

    const handleGeo = new THREE.SphereGeometry(0.02, 8, 6);
    const handleMat = new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.85 });

    for (let i = 0; i < paths.length; i++) {
      const pathCfg = paths[i];
      const points = pathCfg.points;
      if (!points || points.length < 2) continue;

      const width = pathCfg.width || (this._layoutConfig?.roads?.width ?? 0.04);
      const style = pathCfg.style || 'main';
      const cfgColor = this._layoutConfig?.roads?.color || '#9a9080';
      const mat = new THREE.MeshStandardMaterial({
        color: cfgColor,
        roughness: style === 'path' ? 0.9 : 0.85,
        metalness: 0.02,
        side: THREE.DoubleSide,
      });
      // Store per-path texture pack name for async loading
      mat.userData = { texturePackOverride: pathCfg.texture || null };
      this._ribbonRoadMats = this._ribbonRoadMats || [];
      this._ribbonRoadMats.push(mat);

      const closed = !!pathCfg.closed;
      const sampled = this._sampleCatmullRom(points, 8, closed);
      const ribbonMesh = this._buildRibbonMesh(sampled, width, terrainSampler, mat, closed);
      // Raise custom roads above terrain and organic roads to avoid z-fighting
      ribbonMesh.position.y += (this._layoutConfig?.roads?.height ?? 0.008);

      const roadGroup = new THREE.Group();
      roadGroup.name = `custom-road-${i}`;
      roadGroup.userData.editType = 'road';
      roadGroup.userData.editIndex = i;
      roadGroup.add(ribbonMesh);

      // Control point handles (visible only in edit mode)
      const handles = [];
      for (let j = 0; j < points.length; j++) {
        const pt = points[j];
        const handle = new THREE.Mesh(handleGeo, handleMat);
        const y = terrainSampler.getHeight(pt.x, pt.z) + 0.02;
        handle.position.set(pt.x, y, pt.z);
        handle.userData.editType = 'roadPoint';
        handle.userData.editIndex = i;
        handle.userData.pointIndex = j;
        handle.userData._editGroup = handle;
        handle.visible = false;
        handle.renderOrder = 999;
        roadGroup.add(handle);
        handles.push(handle);
      }

      this._townGroup.add(roadGroup);
      this._customRoads.push({ group: roadGroup, ribbonMesh, handles, pathIndex: i });
    }
  }

  // ════════════════════════════════════════════════════
  //  Camera bounds visualization (edit mode)
  // ════════════════════════════════════════════════════

  _createBoundsAnchors(bounds) {
    this._disposeBoundsAnchors();

    const group = new THREE.Group();
    group.name = 'camera-bounds';
    const y = 0.01; // just above ground

    const { minX, maxX, minZ, maxZ } = bounds;
    const midX = (minX + maxX) / 2;
    const midZ = (minZ + maxZ) / 2;

    // Rectangle outline
    const corners = [
      new THREE.Vector3(minX, y, minZ),
      new THREE.Vector3(maxX, y, minZ),
      new THREE.Vector3(maxX, y, maxZ),
      new THREE.Vector3(minX, y, maxZ),
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(corners);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x44aaff, linewidth: 2 });
    const outline = new THREE.LineLoop(lineGeo, lineMat);
    group.add(outline);

    // Semi-transparent fill plane (unit geometry, scaled to match bounds)
    const fillGeo = new THREE.PlaneGeometry(1, 1);
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0x44aaff, transparent: true, opacity: 0.06,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(midX, y, midZ);
    fill.scale.set(maxX - minX, maxZ - minZ, 1);
    group.add(fill);

    // Edge anchor spheres
    const anchorGeo = new THREE.SphereGeometry(0.12, 12, 8);
    const anchorMat = new THREE.MeshBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.7 });

    const anchorDefs = [
      { axis: 'minX', pos: [minX, y + 0.12, midZ] },
      { axis: 'maxX', pos: [maxX, y + 0.12, midZ] },
      { axis: 'minZ', pos: [midX, y + 0.12, minZ] },
      { axis: 'maxZ', pos: [midX, y + 0.12, maxZ] },
    ];

    this._boundsAnchors = [];
    for (const def of anchorDefs) {
      const sphere = new THREE.Mesh(anchorGeo, anchorMat.clone());
      sphere.position.set(def.pos[0], def.pos[1], def.pos[2]);
      sphere.userData = { editType: 'cameraBound', axis: def.axis };
      group.add(sphere);
      this._boundsAnchors.push(sphere);
    }

    this._boundsGroup = group;
    this._scene.add(group);

    // Keep refs for live update
    this._boundsOutline = outline;
    this._boundsFill = fill;
  }

  /** Update the visual bounds rectangle and anchor positions from current config values. */
  updateBoundsVisual(bounds) {
    if (!this._boundsGroup) return;
    const { minX, maxX, minZ, maxZ } = bounds;
    const midX = (minX + maxX) / 2;
    const midZ = (minZ + maxZ) / 2;
    const y = 0.01;

    // Update outline corners
    const positions = this._boundsOutline.geometry.attributes.position;
    positions.setXYZ(0, minX, y, minZ);
    positions.setXYZ(1, maxX, y, minZ);
    positions.setXYZ(2, maxX, y, maxZ);
    positions.setXYZ(3, minX, y, maxZ);
    positions.needsUpdate = true;

    // Update fill plane
    this._boundsFill.position.set(midX, y, midZ);
    this._boundsFill.scale.set((maxX - minX) || 0.01, (maxZ - minZ) || 0.01, 1);

    // Update anchor positions
    const anchorPositions = [
      [minX, y + 0.12, midZ],  // minX
      [maxX, y + 0.12, midZ],  // maxX
      [midX, y + 0.12, minZ],  // minZ
      [midX, y + 0.12, maxZ],  // maxZ
    ];
    for (let i = 0; i < this._boundsAnchors.length; i++) {
      this._boundsAnchors[i].position.set(...anchorPositions[i]);
    }
  }

  _disposeBoundsAnchors() {
    if (this._boundsGroup) {
      this._scene.remove(this._boundsGroup);
      this._boundsGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      this._boundsGroup = null;
    }
    this._boundsAnchors = [];
    this._boundsOutline = null;
    this._boundsFill = null;
  }

  _teardown() {
    // Stop old animation loop via generation counter
    this._loadGeneration++;

    // Dispose subsystems in reverse order
    const disposables = [
      '_audio', '_cameraController', '_cloth', '_waterInteraction',
      '_propPhysics', '_flowers',
      '_grass', '_economyCarts',
      '_animals', '_npcs', '_particles', '_footprints', '_assetLoader',
      '_dailyWindows', '_weather', '_dayNight',
      '_buildingAnimator', '_townSquare', '_roads',
      '_water', '_terrain',
    ];
    for (const key of disposables) {
      if (this[key] && typeof this[key].dispose === 'function') {
        try { this[key].dispose(); } catch (_) { /* ignore */ }
      }
      this[key] = null;
    }
    this._biomeMaterial = null;
    this._originalTerrainColors = null;
    this._districts = null;
    this._cameraTransitions = null;
    this._stateManager = null;

    // Dispose organic roads + building lamps
    if (this._organicRoads) {
      this._townGroup.remove(this._organicRoads);
      this._organicRoads = null;
    }
    for (const obj of this._buildingLamps) this._townGroup.remove(obj);
    this._buildingLamps = [];

    // Dispose custom layout objects
    for (const lamp of this._customLamps) this._townGroup.remove(lamp);
    this._customLamps = [];
    for (const dec of this._customDecorations) this._townGroup.remove(dec);
    this._customDecorations = [];
    for (const tree of this._customTreeMeshes) this._townGroup.remove(tree);
    this._customTreeMeshes = [];
    for (const road of this._customRoads) this._townGroup.remove(road.group);
    this._customRoads = [];
    for (const marker of this._plotMarkers) this._townGroup.remove(marker);
    this._plotMarkers = [];

    // Dispose bounds anchors
    this._disposeBoundsAnchors();

    // Dispose edge rocks
    if (this._edgeRocksGroup) {
      this._townGroup.remove(this._edgeRocksGroup);
      this._edgeRocksGroup = null;
    }
    if (this._edgeRockGeo) { this._edgeRockGeo.forEach(g => g.dispose()); this._edgeRockGeo = null; }
    if (this._edgeRockMat) { this._edgeRockMat.forEach(m => m.dispose()); this._edgeRockMat = null; }
    this._edgeRockMats = null;
    this._edgeSnowMat = null;

    // Clear fog
    this._scene.fog = null;

    // Remove all building groups
    for (const [, group] of this._buildingGroups) {
      if (this._buildingFactory) this._buildingFactory.disposeBuilding(group);
      this._townGroup.remove(group);
    }
    this._buildingGroups.clear();

    // Clear town group
    while (this._townGroup.children.length > 0) {
      this._townGroup.remove(this._townGroup.children[0]);
    }

    this._initialized = false;
  }
}
