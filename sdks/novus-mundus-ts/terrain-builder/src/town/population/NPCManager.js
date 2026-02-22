/**
 * NPC population system — instanced villager rendering and movement.
 *
 * Uses InstancedMesh for bodies and heads to render 10-300 NPCs in a handful
 * of draw calls.  All per-entity state lives in flat typed arrays; there are
 * no per-NPC Object3Ds.
 *
 * Exports:
 *   - NPCManager   — spawns, schedules, and updates NPC populations
 *   - NPCRenderer  — manages the InstancedMesh pair (body cones + head spheres)
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_NPC_COUNT = 300;

/** Villager type enum — indices into NPC_TYPE_DEFS. */
const NPC_WORKER     = 0;
const NPC_FISHER     = 1;
const NPC_SOLDIER    = 2;
const NPC_SCHOLAR    = 3;
const NPC_MERCHANT   = 4;
const NPC_SMITH      = 5;
const NPC_MONK       = 6;
const NPC_GUARD      = 7;
const NPC_GLADIATOR  = 8;
const NPC_CITIZEN    = 9;
const NPC_STARGAZER  = 10;
const NPC_VISITOR    = 11;

/** NPC state enum. */
const STATE_IDLE     = 0;
const STATE_WALKING  = 1;
const STATE_WORKING  = 2;

/** Building-type to NPC-type mapping (by building type id from constants.js). */
const BUILDING_NPC_MAP = {
  0:  NPC_CITIZEN,    // Mansion — citizens emerge from here
  1:  NPC_SOLDIER,    // Barracks
  2:  NPC_WORKER,     // Workshop
  3:  NPC_GUARD,      // Vault
  4:  NPC_FISHER,     // Dock
  5:  NPC_SMITH,      // Forge
  6:  NPC_MERCHANT,   // Market
  7:  NPC_SCHOLAR,    // Academy
  8:  NPC_GLADIATOR,  // Arena
  9:  NPC_MONK,       // Sanctuary
  10: NPC_STARGAZER,  // Observatory
  11: NPC_GUARD,      // Treasury
  12: NPC_SOLDIER,    // Citadel
};

/** Per-type colors: [body, head] as hex. */
const NPC_TYPE_COLORS = [
  /* Worker    */ [0x8b6914, 0xf5d5a0],
  /* Fisher    */ [0x4682b4, 0xf5d5a0],
  /* Soldier   */ [0x556b2f, 0xc8b080],
  /* Scholar   */ [0x191970, 0xf5d5a0],
  /* Merchant  */ [0xdaa520, 0xf5d5a0],
  /* Smith     */ [0x8b4513, 0xd5b590],
  /* Monk      */ [0x9370db, 0xf5d5a0],
  /* Guard     */ [0x708090, 0xc8b080],
  /* Gladiator */ [0xcd853f, 0xd5b590],
  /* Citizen   */ [0xa0886a, 0xf5d5a0],
  /* Stargazer */ [0x2f4f4f, 0xf5d5a0],
  /* Visitor   */ [0xb22222, 0xf5d5a0],
];

/** Speed ranges per type [min, max] in world-units/sec. */
const NPC_SPEED = [
  /* Worker    */ [0.12, 0.20],
  /* Fisher    */ [0.06, 0.10],
  /* Soldier   */ [0.16, 0.24],
  /* Scholar   */ [0.04, 0.08],
  /* Merchant  */ [0.08, 0.14],
  /* Smith     */ [0.05, 0.09],
  /* Monk      */ [0.03, 0.06],
  /* Guard     */ [0.10, 0.16],
  /* Gladiator */ [0.14, 0.22],
  /* Citizen   */ [0.08, 0.16],
  /* Stargazer */ [0.03, 0.06],
  /* Visitor   */ [0.10, 0.18],
];

/** Day/night schedule: which types are active at which time-of-day phase.
 *  0 = dawn (5-7), 1 = day (7-17), 2 = dusk (17-19), 3 = night (19-5). */
const SCHEDULE_ACTIVE = [
  /* Worker    */ [true,  true,  true,  false],
  /* Fisher    */ [true,  true,  true,  false],
  /* Soldier   */ [true,  true,  true,  true ],
  /* Scholar   */ [false, true,  true,  false],
  /* Merchant  */ [true,  true,  true,  false],
  /* Smith     */ [false, true,  true,  false],
  /* Monk      */ [true,  true,  true,  false],
  /* Guard     */ [true,  true,  true,  true ],
  /* Gladiator */ [false, true,  false, false],
  /* Citizen   */ [true,  true,  true,  false],
  /* Stargazer */ [false, false, false, true ],
  /* Visitor   */ [false, true,  true,  false],
];

/** District wander radius per type. */
const DISTRICT_RADIUS = [
  /* Worker    */ 0.35,
  /* Fisher    */ 0.25,
  /* Soldier   */ 0.45,
  /* Scholar   */ 0.20,
  /* Merchant  */ 0.30,
  /* Smith     */ 0.18,
  /* Monk      */ 0.22,
  /* Guard     */ 0.15,
  /* Gladiator */ 0.25,
  /* Citizen   */ 1.20,
  /* Stargazer */ 0.20,
  /* Visitor   */ 1.00,
];

/** Body geometry: cone (body) dimensions. */
const BODY_RADIUS_TOP = 0.004;
const BODY_RADIUS_BOTTOM = 0.008;
const BODY_HEIGHT = 0.025;

/** Head geometry: sphere radius. */
const HEAD_RADIUS = 0.005;

/** Billboard quad half-size. */
const BILLBOARD_HALF = 0.008;

/** Idle pause range [min, max] seconds. */
const IDLE_PAUSE_MIN = 0.6;
const IDLE_PAUSE_MAX = 2.5;

/** Working bob animation frequency and amplitude. */
const WORK_BOB_FREQ = 4.0;
const WORK_BOB_AMP = 0.003;

/** Walking leg-swing animation frequency. */
const WALK_SWING_FREQ = 8.0;

// ---------------------------------------------------------------------------
// Seeded RNG
// ---------------------------------------------------------------------------

function makeRng(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return (s >>> 16) / 65536;
  };
}

// ---------------------------------------------------------------------------
// Reusable THREE objects (avoid per-frame allocation)
// ---------------------------------------------------------------------------

const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const _forward = new THREE.Vector3();
const _color = new THREE.Color();

// ---------------------------------------------------------------------------
// Road graph BFS pathfinding
// ---------------------------------------------------------------------------

/**
 * Find a path between two nodes via BFS on a small graph.
 * @param {{ adjacency: number[][] }} graph - Pre-built adjacency list
 * @param {number} from - Start node index
 * @param {number} to - Target node index
 * @returns {number[]} Array of node indices from `from` to `to`, or [from] if unreachable
 */
function findPath(graph, from, to) {
  if (from === to) return [from];
  const adj = graph.adjacency;
  const nodeCount = adj.length;
  const visited = new Uint8Array(nodeCount);
  const parent = new Int16Array(nodeCount).fill(-1);
  const queue = [from];
  visited[from] = 1;

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const neighbors = adj[cur];
    for (let i = 0; i < neighbors.length; i++) {
      const n = neighbors[i];
      if (visited[n]) continue;
      visited[n] = 1;
      parent[n] = cur;
      if (n === to) {
        // Reconstruct path
        const path = [];
        let c = to;
        while (c !== -1) {
          path.push(c);
          c = parent[c];
        }
        path.reverse();
        return path;
      }
      queue.push(n);
    }
  }
  // Unreachable — stay put
  return [from];
}

/**
 * Build adjacency list from edge pairs.
 * @param {number} nodeCount
 * @param {{ from: number, to: number }[]} edges
 * @returns {{ adjacency: number[][] }}
 */
function buildAdjacency(nodeCount, edges) {
  const adjacency = new Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) adjacency[i] = [];
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    adjacency[e.from].push(e.to);
    adjacency[e.to].push(e.from);
  }
  return { adjacency };
}

/**
 * Find the graph node closest to a world position.
 * @param {{ x: number, z: number }[]} nodes
 * @param {number} x
 * @param {number} z
 * @returns {number} node index
 */
function closestNode(nodes, x, z) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const dx = nodes[i].x - x;
    const dz = nodes[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Time-of-day phase helper
// ---------------------------------------------------------------------------

/**
 * Convert hour (0-24) to phase index: 0=dawn, 1=day, 2=dusk, 3=night.
 * @param {number} hour
 * @returns {number}
 */
function timePhase(hour) {
  if (hour >= 5 && hour < 7) return 0;
  if (hour >= 7 && hour < 17) return 1;
  if (hour >= 17 && hour < 19) return 2;
  return 3;
}

// ---------------------------------------------------------------------------
// NPCRenderer
// ---------------------------------------------------------------------------

export class NPCRenderer {
  /**
   * @param {THREE.Scene} scene
   * @param {number} [maxCount=300]
   */
  constructor(scene, maxCount = MAX_NPC_COUNT) {
    this._scene = scene;
    this._maxCount = maxCount;
    this._activeCount = 0;
    this._mode = '3d'; // '3d' or 'billboard'

    // --- 3D mode meshes ---

    // Body: truncated cone
    const bodyGeo = new THREE.ConeGeometry(BODY_RADIUS_BOTTOM, BODY_HEIGHT, 5);
    // Shift origin to base
    bodyGeo.translate(0, BODY_HEIGHT * 0.5, 0);
    const bodyMat = new THREE.MeshStandardMaterial({
      roughness: 0.8,
      metalness: 0.0,
    });
    this._bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, maxCount);
    this._bodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._bodyMesh.count = 0;
    this._bodyMesh.frustumCulled = false;
    this._bodyMesh.castShadow = true;
    this._bodyMesh.receiveShadow = false;

    // Head: sphere
    const headGeo = new THREE.SphereGeometry(HEAD_RADIUS, 5, 4);
    const headMat = new THREE.MeshStandardMaterial({
      roughness: 0.6,
      metalness: 0.0,
    });
    this._headMesh = new THREE.InstancedMesh(headGeo, headMat, maxCount);
    this._headMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._headMesh.count = 0;
    this._headMesh.frustumCulled = false;
    this._headMesh.castShadow = false;
    this._headMesh.receiveShadow = false;

    // --- Billboard mode mesh ---

    const bbGeo = new THREE.PlaneGeometry(BILLBOARD_HALF * 2, BILLBOARD_HALF * 3);
    // Shift origin to bottom center
    bbGeo.translate(0, BILLBOARD_HALF * 1.5, 0);
    const bbMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this._billboardMesh = new THREE.InstancedMesh(bbGeo, bbMat, maxCount);
    this._billboardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._billboardMesh.count = 0;
    this._billboardMesh.frustumCulled = false;
    this._billboardMesh.visible = false;

    scene.add(this._bodyMesh);
    scene.add(this._headMesh);
    scene.add(this._billboardMesh);
  }

  /** The InstancedMesh for NPC body cones. */
  get bodyMesh() { return this._bodyMesh; }

  /** The InstancedMesh for NPC head spheres. */
  get headMesh() { return this._headMesh; }

  /**
   * Set the active instance count.
   * @param {number} count
   */
  setCount(count) {
    const n = Math.min(count, this._maxCount);
    this._activeCount = n;
    if (this._mode === '3d') {
      this._bodyMesh.count = n;
      this._headMesh.count = n;
      this._billboardMesh.count = 0;
    } else {
      this._bodyMesh.count = 0;
      this._headMesh.count = 0;
      this._billboardMesh.count = n;
    }
  }

  /**
   * Write transform and colour for a single instance.
   * @param {number} index
   * @param {THREE.Vector3} position - World position (feet)
   * @param {number} rotation - Y-axis rotation in radians
   * @param {number} type - Villager type enum
   * @param {number} animFrame - Animation phase (0-1 looping)
   */
  updateInstance(index, position, rotation, type, animFrame) {
    if (index >= this._maxCount) return;

    const colors = NPC_TYPE_COLORS[type] || NPC_TYPE_COLORS[NPC_CITIZEN];

    if (this._mode === '3d') {
      // Body transform
      _quat.setFromAxisAngle(_up, rotation);

      // Walking sway: slight body lean
      const sway = Math.sin(animFrame * WALK_SWING_FREQ) * 0.002;

      _pos.set(position.x + sway, position.y, position.z);
      _scale.set(1, 1, 1);
      _mat4.compose(_pos, _quat, _scale);
      this._bodyMesh.setMatrixAt(index, _mat4);
      _color.setHex(colors[0]);
      this._bodyMesh.setColorAt(index, _color);

      // Head transform — sits on top of body
      const headY = position.y + BODY_HEIGHT + HEAD_RADIUS * 0.5;
      // Working bob
      const bob = Math.sin(animFrame * WORK_BOB_FREQ) * WORK_BOB_AMP;
      _pos.set(position.x + sway, headY + bob, position.z);
      _mat4.compose(_pos, _quat, _scale);
      this._headMesh.setMatrixAt(index, _mat4);
      _color.setHex(colors[1]);
      this._headMesh.setColorAt(index, _color);
    } else {
      // Billboard: position the quad
      _quat.setFromAxisAngle(_up, rotation);
      _pos.copy(position);
      _scale.set(1, 1, 1);
      _mat4.compose(_pos, _quat, _scale);
      this._billboardMesh.setMatrixAt(index, _mat4);
      _color.setHex(colors[0]);
      this._billboardMesh.setColorAt(index, _color);
    }
  }

  /**
   * Mark instance matrices as dirty so the GPU re-uploads.
   */
  flagUpdate() {
    if (this._mode === '3d') {
      this._bodyMesh.instanceMatrix.needsUpdate = true;
      this._headMesh.instanceMatrix.needsUpdate = true;
      if (this._bodyMesh.instanceColor) this._bodyMesh.instanceColor.needsUpdate = true;
      if (this._headMesh.instanceColor) this._headMesh.instanceColor.needsUpdate = true;
    } else {
      this._billboardMesh.instanceMatrix.needsUpdate = true;
      if (this._billboardMesh.instanceColor) this._billboardMesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Dispose all GPU resources.
   */
  dispose() {
    this._scene.remove(this._bodyMesh);
    this._scene.remove(this._headMesh);
    this._scene.remove(this._billboardMesh);

    this._bodyMesh.geometry.dispose();
    this._bodyMesh.material.dispose();
    this._bodyMesh.dispose();

    this._headMesh.geometry.dispose();
    this._headMesh.material.dispose();
    this._headMesh.dispose();

    this._billboardMesh.geometry.dispose();
    this._billboardMesh.material.dispose();
    this._billboardMesh.dispose();
  }
}

// ---------------------------------------------------------------------------
// NPCManager
// ---------------------------------------------------------------------------

export class NPCManager {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [options]
   * @param {number} [options.maxCount=300]
   * @param {number} [options.seed=42]
   */
  constructor(scene, options = {}) {
    this._scene = scene;
    this._maxCount = options.maxCount || MAX_NPC_COUNT;
    this._seed = options.seed || 42;
    this._disposed = false;

    this._renderer = new NPCRenderer(scene, this._maxCount);

    // --- Flat parallel arrays ---
    this._posX = new Float32Array(this._maxCount);
    this._posZ = new Float32Array(this._maxCount);
    this._posY = new Float32Array(this._maxCount);  // terrain height cache
    this._targetX = new Float32Array(this._maxCount);
    this._targetZ = new Float32Array(this._maxCount);
    this._speed = new Float32Array(this._maxCount);
    this._type = new Uint8Array(this._maxCount);
    this._state = new Uint8Array(this._maxCount);
    this._animPhase = new Float32Array(this._maxCount);
    this._buildingIdx = new Int16Array(this._maxCount).fill(-1);
    this._rotation = new Float32Array(this._maxCount);
    this._idleTimer = new Float32Array(this._maxCount);
    this._active = new Uint8Array(this._maxCount);  // visible this phase

    // Path state per NPC: current path and index into it
    this._pathNodeIdx = new Int16Array(this._maxCount).fill(-1);
    this._paths = new Array(this._maxCount).fill(null);

    // District centers for building-attached NPCs
    this._homeX = new Float32Array(this._maxCount);
    this._homeZ = new Float32Array(this._maxCount);
    this._wanderRadius = new Float32Array(this._maxCount);

    this._npcCount = 0;
    this._buildings = null;
    this._roadGraph = null;
    this._graphData = null;
    this._terrainSampler = null;
    this._rng = makeRng(this._seed);
    this._currentPhase = 1; // default to daytime

    // Pre-allocated vec3 for position output
    this._tmpPos = new THREE.Vector3();
  }

  /** Current NPC count. */
  get count() { return this._npcCount; }

  /**
   * Initialize with building data, road graph, and terrain height sampler.
   * @param {{ typeId: number, level: number, position: {x:number,z:number}, districtCenter?: {x:number,z:number} }[]} buildings
   * @param {{ nodes: {x:number,z:number}[], edges: {from:number,to:number}[] }} roadGraph
   * @param {{ getHeight(x:number,z:number): number }} terrainSampler
   */
  initialize(buildings, roadGraph, terrainSampler) {
    this._buildings = buildings;
    this._terrainSampler = terrainSampler;

    // Build road graph adjacency (optional — NPCs free-roam if no graph)
    this._roadGraph = roadGraph;
    if (roadGraph && roadGraph.nodes) {
      const nodes = roadGraph.nodes;
      const edges = roadGraph.edges;
      this._graphData = buildAdjacency(nodes.length, edges);
    } else {
      this._graphData = null;
    }

    // Spawn initial population
    this.spawnForBuildings(buildings);
  }

  /**
   * Spawn NPCs based on current building state. Clears existing population.
   * @param {{ typeId: number, level: number, position: {x:number,z:number}, districtCenter?: {x:number,z:number} }[]} buildings
   */
  spawnForBuildings(buildings) {
    this._buildings = buildings;
    this._npcCount = 0;
    const rng = this._rng;

    // Spawn per-building NPCs
    for (let bi = 0; bi < buildings.length; bi++) {
      const b = buildings[bi];
      const npcType = BUILDING_NPC_MAP[b.typeId];
      if (npcType === undefined) continue;

      const npcCount = Math.floor(b.level / 4) + 1;
      const center = b.districtCenter || b.position;
      const radius = DISTRICT_RADIUS[npcType];
      const speedRange = NPC_SPEED[npcType];

      for (let ni = 0; ni < npcCount; ni++) {
        if (this._npcCount >= this._maxCount) break;
        const idx = this._npcCount;

        // Spawn around building center with slight offset
        const angle = rng() * Math.PI * 2;
        const dist = rng() * radius * 0.5;
        const sx = center.x + Math.cos(angle) * dist;
        const sz = center.z + Math.sin(angle) * dist;
        const sy = this._terrainSampler ? this._terrainSampler.getHeight(sx, sz) : 0;

        this._posX[idx] = sx;
        this._posZ[idx] = sz;
        this._posY[idx] = sy;
        this._targetX[idx] = sx;
        this._targetZ[idx] = sz;
        this._speed[idx] = speedRange[0] + rng() * (speedRange[1] - speedRange[0]);
        this._type[idx] = npcType;
        this._state[idx] = STATE_IDLE;
        this._animPhase[idx] = rng() * Math.PI * 2;
        this._buildingIdx[idx] = bi;
        this._rotation[idx] = rng() * Math.PI * 2;
        this._idleTimer[idx] = rng() * IDLE_PAUSE_MAX;
        this._active[idx] = 1;
        this._homeX[idx] = center.x;
        this._homeZ[idx] = center.z;
        this._wanderRadius[idx] = radius;
        this._pathNodeIdx[idx] = -1;
        this._paths[idx] = null;

        this._npcCount++;
      }
    }

    // Spawn extra citizens if we have a Mansion (typeId 0)
    const mansionBuildings = buildings.filter(b => b.typeId === 0);
    for (let mi = 0; mi < mansionBuildings.length; mi++) {
      const mansion = mansionBuildings[mi];
      const citizenCount = Math.floor(mansion.level / 3) + 2;
      const center = mansion.position;

      for (let ci = 0; ci < citizenCount; ci++) {
        if (this._npcCount >= this._maxCount) break;
        const idx = this._npcCount;

        const angle = rng() * Math.PI * 2;
        const dist = rng() * 0.6;
        const sx = center.x + Math.cos(angle) * dist;
        const sz = center.z + Math.sin(angle) * dist;
        const sy = this._terrainSampler ? this._terrainSampler.getHeight(sx, sz) : 0;
        const speedRange = NPC_SPEED[NPC_CITIZEN];

        this._posX[idx] = sx;
        this._posZ[idx] = sz;
        this._posY[idx] = sy;
        this._targetX[idx] = sx;
        this._targetZ[idx] = sz;
        this._speed[idx] = speedRange[0] + rng() * (speedRange[1] - speedRange[0]);
        this._type[idx] = NPC_CITIZEN;
        this._state[idx] = STATE_IDLE;
        this._animPhase[idx] = rng() * Math.PI * 2;
        this._buildingIdx[idx] = -1;
        this._rotation[idx] = rng() * Math.PI * 2;
        this._idleTimer[idx] = rng() * IDLE_PAUSE_MAX;
        this._active[idx] = 1;
        this._homeX[idx] = center.x;
        this._homeZ[idx] = center.z;
        this._wanderRadius[idx] = DISTRICT_RADIUS[NPC_CITIZEN];
        this._pathNodeIdx[idx] = -1;
        this._paths[idx] = null;

        this._npcCount++;
      }
    }

    // Spawn visitors if total estate level >= 20
    const totalLevel = buildings.reduce((sum, b) => sum + b.level, 0);
    if (totalLevel >= 20) {
      const visitorCount = Math.min(5, Math.floor((totalLevel - 20) / 10) + 1);
      for (let vi = 0; vi < visitorCount; vi++) {
        if (this._npcCount >= this._maxCount) break;
        const idx = this._npcCount;

        // Spawn visitors near the center of town
        const sx = (rng() - 0.5) * 0.8;
        const sz = (rng() - 0.5) * 0.8;
        const sy = this._terrainSampler ? this._terrainSampler.getHeight(sx, sz) : 0;
        const speedRange = NPC_SPEED[NPC_VISITOR];

        this._posX[idx] = sx;
        this._posZ[idx] = sz;
        this._posY[idx] = sy;
        this._targetX[idx] = sx;
        this._targetZ[idx] = sz;
        this._speed[idx] = speedRange[0] + rng() * (speedRange[1] - speedRange[0]);
        this._type[idx] = NPC_VISITOR;
        this._state[idx] = STATE_IDLE;
        this._animPhase[idx] = rng() * Math.PI * 2;
        this._buildingIdx[idx] = -1;
        this._rotation[idx] = rng() * Math.PI * 2;
        this._idleTimer[idx] = rng() * IDLE_PAUSE_MAX;
        this._active[idx] = 1;
        this._homeX[idx] = 0;
        this._homeZ[idx] = 0;
        this._wanderRadius[idx] = DISTRICT_RADIUS[NPC_VISITOR];
        this._pathNodeIdx[idx] = -1;
        this._paths[idx] = null;

        this._npcCount++;
      }
    }

    this._renderer.setCount(this._npcCount);
  }

  /**
   * Get NPCs that are currently walking (for footprint stamping).
   * @returns {Array<{ position: {x:number, z:number}, heading: number, strideLength: number, isWalking: boolean, stepReady: boolean, currentFoot: string }>}
   */
  getWalkingNPCs() {
    const result = [];
    for (let i = 0; i < this._npcCount; i++) {
      if (this._state[i] !== 1) continue; // 1 = walking
      result.push({
        position: { x: this._posX[i], z: this._posZ[i] },
        heading: this._rotation[i],
        strideLength: 0.04,
        isWalking: true,
        stepReady: true,
        currentFoot: (this._animPhase[i] || 0) > 0.5 ? 'right' : 'left',
      });
    }
    return result;
  }

  /**
   * Per-frame update.
   * @param {number} deltaTime - Seconds since last frame
   * @param {THREE.Vector3} cameraPosition - Current camera world position
   * @param {number} timeOfDay - Hour (0-24)
   */
  update(deltaTime, cameraPosition, timeOfDay) {
    if (this._disposed || this._npcCount === 0) return;

    const dt = Math.min(deltaTime, 0.1); // clamp to avoid physics explosion

    // 1. Day/night scheduling
    const phase = timePhase(timeOfDay);
    if (phase !== this._currentPhase) {
      this._currentPhase = phase;
      this._updateSchedule(phase);
    }

    // 2. Update each NPC
    let visibleCount = 0;
    const rng = this._rng;
    const nodes = this._roadGraph ? this._roadGraph.nodes : null;
    const tmpPos = this._tmpPos;

    for (let i = 0; i < this._npcCount; i++) {
      if (!this._active[i]) continue;

      const state = this._state[i];
      const type = this._type[i];

      if (state === STATE_IDLE) {
        // Count down idle timer
        this._idleTimer[i] -= dt;
        if (this._idleTimer[i] <= 0) {
          // Pick new target
          this._pickNewTarget(i, rng, nodes);
          this._state[i] = STATE_WALKING;
        }
        // Working animation for building NPCs while idle at building
        if (this._buildingIdx[i] >= 0) {
          this._animPhase[i] += dt;
          this._state[i] = STATE_WORKING;
        }
      } else if (state === STATE_WALKING) {
        this._advancePosition(i, dt);
        this._animPhase[i] += dt;

        // Check if reached target
        const dx = this._targetX[i] - this._posX[i];
        const dz = this._targetZ[i] - this._posZ[i];
        const distSq = dx * dx + dz * dz;

        if (distSq < 0.0004) { // threshold ~0.02
          this._posX[i] = this._targetX[i];
          this._posZ[i] = this._targetZ[i];

          // Check if there is a remaining path segment
          if (this._paths[i] && this._pathNodeIdx[i] < this._paths[i].length - 1) {
            // Advance to next node in path
            this._pathNodeIdx[i]++;
            const nextNode = this._paths[i][this._pathNodeIdx[i]];
            this._targetX[i] = nodes[nextNode].x;
            this._targetZ[i] = nodes[nextNode].z;
          } else {
            // Arrived at final destination — go idle
            this._state[i] = STATE_IDLE;
            this._idleTimer[i] = IDLE_PAUSE_MIN + rng() * (IDLE_PAUSE_MAX - IDLE_PAUSE_MIN);
            this._paths[i] = null;
            this._pathNodeIdx[i] = -1;
          }
        }
      } else if (state === STATE_WORKING) {
        this._animPhase[i] += dt;

        // Periodically switch to walking to simulate going between waypoints
        this._idleTimer[i] -= dt;
        if (this._idleTimer[i] <= 0) {
          this._pickNewTarget(i, rng, nodes);
          this._state[i] = STATE_WALKING;
        }
      }

      // Update terrain height
      if (this._terrainSampler) {
        this._posY[i] = this._terrainSampler.getHeight(this._posX[i], this._posZ[i]);
      }

      // Write instance transform
      tmpPos.set(this._posX[i], this._posY[i], this._posZ[i]);
      this._renderer.updateInstance(
        visibleCount,
        tmpPos,
        this._rotation[i],
        type,
        this._animPhase[i]
      );
      visibleCount++;
    }

    this._renderer.setCount(visibleCount);
    this._renderer.flagUpdate();
  }

  /**
   * Dispose all resources.
   */
  dispose() {
    this._disposed = true;
    this._renderer.dispose();
    this._npcCount = 0;
    this._buildings = null;
    this._roadGraph = null;
    this._graphData = null;
    this._terrainSampler = null;
    for (let i = 0; i < this._maxCount; i++) {
      this._paths[i] = null;
    }
  }

  // ── Internal ──

  /**
   * Advance an NPC's position toward its target.
   * @param {number} i - NPC index
   * @param {number} dt - Delta time
   */
  _advancePosition(i, dt) {
    const dx = this._targetX[i] - this._posX[i];
    const dz = this._targetZ[i] - this._posZ[i];
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.001) return;

    const step = this._speed[i] * dt;
    if (step >= dist) {
      this._posX[i] = this._targetX[i];
      this._posZ[i] = this._targetZ[i];
    } else {
      const inv = step / dist;
      this._posX[i] += dx * inv;
      this._posZ[i] += dz * inv;
    }

    // Update facing rotation toward movement direction
    this._rotation[i] = Math.atan2(dx, dz);
  }

  /**
   * Pick a new target for an NPC, using road graph if available.
   * @param {number} i - NPC index
   * @param {function} rng
   * @param {{ x: number, z: number }[] | null} nodes
   */
  _pickNewTarget(i, rng, nodes) {
    const type = this._type[i];
    const homeX = this._homeX[i];
    const homeZ = this._homeZ[i];
    const radius = this._wanderRadius[i];

    // Citizens and visitors use the road graph to walk between nodes
    if ((type === NPC_CITIZEN || type === NPC_VISITOR) && nodes && nodes.length > 1 && this._graphData) {
      const fromNode = closestNode(nodes, this._posX[i], this._posZ[i]);
      const toNode = Math.floor(rng() * nodes.length);
      if (fromNode !== toNode) {
        const path = findPath(this._graphData, fromNode, toNode);
        if (path.length > 1) {
          this._paths[i] = path;
          this._pathNodeIdx[i] = 1; // skip the start node (we are already there)
          this._targetX[i] = nodes[path[1]].x;
          this._targetZ[i] = nodes[path[1]].z;
          return;
        }
      }
    }

    // Building-attached NPCs and fallback: wander within district radius
    // Pick 2-3 waypoints near the home center
    const angle = rng() * Math.PI * 2;
    const dist = rng() * radius;
    this._targetX[i] = homeX + Math.cos(angle) * dist;
    this._targetZ[i] = homeZ + Math.sin(angle) * dist;
    this._paths[i] = null;
    this._pathNodeIdx[i] = -1;
  }

  /**
   * Update schedule visibility for all NPCs based on time-of-day phase.
   * Dawn: workers walk to buildings. Dusk: NPCs return toward mansion.
   * Night: only guards and stargazers active.
   * @param {number} phase
   */
  _updateSchedule(phase) {
    const rng = this._rng;
    for (let i = 0; i < this._npcCount; i++) {
      const type = this._type[i];
      const wasActive = this._active[i];
      const nowActive = SCHEDULE_ACTIVE[type] ? SCHEDULE_ACTIVE[type][phase] : true;

      this._active[i] = nowActive ? 1 : 0;

      // Dawn: NPCs that just became active start walking from mansion toward home
      if (nowActive && !wasActive && phase === 0) {
        // Find mansion position (building type 0)
        let mansionX = 0, mansionZ = 0;
        if (this._buildings) {
          for (let b = 0; b < this._buildings.length; b++) {
            if (this._buildings[b].typeId === 0) {
              mansionX = this._buildings[b].position.x;
              mansionZ = this._buildings[b].position.z;
              break;
            }
          }
        }
        this._posX[i] = mansionX + (rng() - 0.5) * 0.1;
        this._posZ[i] = mansionZ + (rng() - 0.5) * 0.1;
        this._targetX[i] = this._homeX[i];
        this._targetZ[i] = this._homeZ[i];
        this._state[i] = STATE_WALKING;
        this._paths[i] = null;
        this._pathNodeIdx[i] = -1;
      }

      // Dusk: active NPCs start walking back toward mansion
      if (nowActive && phase === 2) {
        if (this._buildings) {
          for (let b = 0; b < this._buildings.length; b++) {
            if (this._buildings[b].typeId === 0) {
              this._targetX[i] = this._buildings[b].position.x + (rng() - 0.5) * 0.15;
              this._targetZ[i] = this._buildings[b].position.z + (rng() - 0.5) * 0.15;
              this._state[i] = STATE_WALKING;
              this._paths[i] = null;
              this._pathNodeIdx[i] = -1;
              break;
            }
          }
        }
      }
    }
  }

}
