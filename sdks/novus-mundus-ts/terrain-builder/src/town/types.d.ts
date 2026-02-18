/**
 * Shared type definitions for Town Renderer modules.
 *
 * These interfaces document the shapes of objects passed between subsystems.
 * With `checkJs: true` in jsconfig.json, TypeScript will verify JS code against
 * these types via JSDoc annotations.
 *
 * Usage in any .js file:
 *   /** @param {TownTypes.TerrainSampler} sampler * /
 *
 * Or import inline:
 *   /** @param {import('./types').TerrainSampler} sampler * /
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Terrain
// ─────────────────────────────────────────────────────────────────────────────

/** Terrain sampler interface shared by DistrictSystem, RoadNetwork, NPCManager, AnimalSystem, vegetation, etc. */
export interface TerrainSampler {
  getHeight(x: number, z: number): number;
  getMoisture(x: number, z: number): number;
  getSlope(x: number, z: number): number;
  isWater(x: number, z: number): boolean;
  isMountain(x: number, z: number): boolean;
  isGrassable(x: number, z: number): boolean;
  getWaterDistance(x: number, z: number): number;
  findNearestWater(x: number, z: number): number;
}

/** City terrain config — on-chain data that defines a city's terrain. */
export interface CityTerrainConfig {
  seed: number;
  waterLine: number;
  peakLine: number;
  radiusKm?: number;
  anchorCount?: number;
  version?: number;
  anchors: TerrainAnchor[];
}

export interface TerrainAnchor {
  x: number;
  y: number;
  mass: number;
  lift: number;
  pushX: number;
  pushY: number;
  moisture: number;
}

/** Functions passed from the host page for terrain math (matches on-chain logic). */
export interface TerrainFunctions {
  elevation(config: CityTerrainConfig, ox: number, oy: number): number;
  moisture(config: CityTerrainConfig, ox: number, oy: number): number;
  elevColor(e: number, wl: number, pl: number, m?: number): [number, number, number];
  noise(seed: number, x: number, y: number): number;
  buoyancy(mass: number, lift: number): number;
  twoNearest(anchors: TerrainAnchor[], ox: number, oy: number): [number, number, number, number];
}

// ─────────────────────────────────────────────────────────────────────────────
// Visual State (from TownStateManager / host page)
// ─────────────────────────────────────────────────────────────────────────────

/** Complete visual state of a town — passed to TownRenderer.load(). */
export interface TownVisualState {
  buildings: (BuildingVisualState | null)[];
  plotsOwned: number;
  estateLevel: number;
  attackBps?: number;
  defenseBps?: number;
  resourceGenBps?: number;
  craftSuccessBps?: number;
  windowsCompleted?: number;
  loginStreak?: number;
  permanentBonus?: number;
  activeCraft?: unknown;
  activeResearch?: unknown;
  meditatingHeroes?: number;
  playerLevel?: number;
  subscriptionTier?: number;
  networth?: bigint;
  terrain?: unknown;
  terrainAffinity?: unknown;
  theme?: string | null;
  currentTime?: number;
}

/** Per-building visual state — element of vs.buildings[]. */
export interface BuildingVisualState {
  type: number;
  status: number;
  level: number;
  mastery: number;
  constructionProgress: number;
  noviInvested: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Building entries for population systems (NPCManager, AnimalSystem)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enriched building entry used by NPCManager, AnimalSystem, DistrictSystem.
 * Created in TownRenderer from vs.buildings then enriched with position data.
 */
export interface BuildingEntry {
  typeId: number;
  level: number;
  plotIndex: number;
  position: Point2D;
  districtCenter?: Point2D;
}

export interface Point2D {
  x: number;
  z: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// District System
// ─────────────────────────────────────────────────────────────────────────────

/** Output of DistrictSystem.generate(). */
export interface DistrictLayout {
  districts: District[];
  roads: RoadSegment[];
  bridges: BridgeSegment[];
}

export interface District {
  id: number;
  buildingType: number;
  center: Point2D;
  vertices: Point2D[];
  area: number;
  groundType: string;
  groundColor: THREE.Color;
  props: DistrictProp[];
}

export interface DistrictProp {
  type: string;
  x: number;
  z: number;
  rotation?: number;
  scale?: number;
}

export interface RoadSegment {
  start: Point2D;
  end: Point2D;
  width: number;
  type: 'main' | 'path' | 'bridge';
}

export interface BridgeSegment {
  start: Point2D;
  end: Point2D;
  width: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Road Network
// ─────────────────────────────────────────────────────────────────────────────

/** Road graph used by NPCManager for pathfinding. */
export interface RoadGraph {
  nodes: RoadNode[];
  edges: RoadEdge[];
}

export interface RoadNode {
  id: number;
  x: number;
  z: number;
  type: string;
  connections: number;
}

export interface RoadEdge {
  from: number;
  to: number;
  weight: number;
  type: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TownRenderer options
// ─────────────────────────────────────────────────────────────────────────────

export interface TownRendererOptions {
  container: HTMLElement;
  terrainFunctions: TerrainFunctions;
  callbacks?: {
    onBuildingClick?: (index: number) => void;
    onPlotClick?: (plotIndex: number) => void;
  };
}

export interface TownLoadOptions {
  meshSize?: number;
  patchRadius?: number;
  centerOx?: number;
  centerOy?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Building Factory
// ─────────────────────────────────────────────────────────────────────────────

export interface WindowPosition {
  position: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface ParticleAnchor {
  type: string;
  position: THREE.Vector3;
}

// ─────────────────────────────────────────────────────────────────────────────
// Town Square
// ─────────────────────────────────────────────────────────────────────────────

/** Lamp position returned by TownSquare.getLampPositions() — plain object, NOT Vector3. */
export interface LampPosition {
  x: number;
  y: number;
  z: number;
}

/** NPC spawn point returned by TownSquare.getNPCSpawnPoints(). */
export interface NPCSpawnPoint {
  x: number;
  z: number;
  type: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DayNightCycle
// ─────────────────────────────────────────────────────────────────────────────

export interface TorchOptions {
  color?: number;
  intensity?: number;
  radius?: number;
}

export interface WindowOptions {
  color?: number;
  intensity?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Milestones (TownSquare)
// ─────────────────────────────────────────────────────────────────────────────

export interface TownSquareBuildOptions {
  windowsCompleted?: number;
  loginStreak?: number;
  permanentBonus?: number;
  milestones?: Record<string, boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Economy Carts
// ─────────────────────────────────────────────────────────────────────────────

export interface EconomyRoute {
  from: THREE.Vector3;
  to: THREE.Vector3;
  waypoints: THREE.Vector3[];
  cargoType: string;
  speed: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Town bounds (used by vegetation scatter)
// ─────────────────────────────────────────────────────────────────────────────

export interface TownBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
