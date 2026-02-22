/**
 * RoadNetwork -- generates roads, paths, and bridges from Voronoi district edges.
 *
 * Roads follow DistrictSystem Voronoi cell boundaries, producing organic winding
 * paths between districts.  Road surface type upgrades with estate level (dirt ->
 * cobblestone -> polished stone).  Bridges are generated where roads cross water.
 *
 * Exports a pre-computed graph structure for NPC pathfinding consumed by
 * NPCManager (nodes + edges with types, widths, and distances).
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROAD_Y_OFFSET = 0.003; // slight raise to prevent z-fighting
const BRIDGE_Y_RISE = 0.06;  // bridge deck height above water
const BRIDGE_RAIL_HEIGHT = 0.025;
const BRIDGE_RAIL_THICKNESS = 0.004;
const BRIDGE_ARCH_SEGMENTS = 8;
const CATMULL_SAMPLES = 12;   // samples per road edge for smooth curves
const ROAD_BORDER_RATIO = 0.15; // fraction of width used for darker border
const NODE_MERGE_THRESHOLD = 0.015; // distance below which road nodes are merged
const INTERSECTION_SEGMENTS = 16; // segments for circular intersection patches
const CAP_SEGMENTS = 8;           // segments for semicircular dead-end caps

/** Road style per estate level tier. */
const ROAD_TIERS = [
  // Level 1-9: dirt
  { color: 0x8b7355, borderColor: 0x6b5335, width: 0.025, name: 'dirt', pack: 'ground-dirt', borderPack: 'ground-gravel' },
  // Level 10-19: cobblestone
  { color: 0x888888, borderColor: 0x606060, width: 0.035, name: 'cobblestone', pack: 'stone-cobble', borderPack: null },
  // Level 20+: polished stone
  { color: 0x505050, borderColor: 0x353535, width: 0.045, name: 'polished', pack: 'stone-paving', borderPack: null },
];

const MAIN_ROAD_SCALE = 1.6; // main roads are this much wider than side paths

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dist2d(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function getRoadTier(estateLevel) {
  if (estateLevel >= 20) return 2;
  if (estateLevel >= 10) return 1;
  return 0;
}

/**
 * Quantize a 2D coordinate to an integer key for de-duplication.
 */
function quantizeKey(x, z) {
  return `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
}

// ---------------------------------------------------------------------------
// Null terrain sampler
// ---------------------------------------------------------------------------

const NULL_SAMPLER = {
  getHeight(x, z) { return 0; },
  isWater(x, z) { return false; },
  getWaterDistance(x, z) { return 10; },
  getMoisture(x, z) { return 0.5; },
  getSlope(x, z) { return 0; },
};

// ---------------------------------------------------------------------------
// Road graph builder
// ---------------------------------------------------------------------------

/**
 * Build the road graph from raw Voronoi edges + district layout.
 *
 * 1. Collect unique endpoints from Voronoi shared edges.
 * 2. Merge nearby endpoints (quantization).
 * 3. Classify node types: intersection, building, gate, bridge.
 * 4. Classify edge types: main, path, bridge.
 * 5. Return { nodes, edges } ready for pathfinding and mesh generation.
 */
function buildRoadGraph(districtLayout, terrainSampler, estateLevel) {
  const { districts, roads: rawRoads, bridges: rawBridges } = districtLayout;
  const sampler = terrainSampler || NULL_SAMPLER;
  const tier = getRoadTier(estateLevel);
  const style = ROAD_TIERS[tier];

  if (!rawRoads || rawRoads.length === 0) {
    return { nodes: [], edges: [], rawPaths: [] };
  }

  // --- Step 1: Collect unique nodes ---
  const nodeMap = new Map(); // quantized key -> node index
  const nodes = [];

  function getOrCreateNode(x, z) {
    const key = quantizeKey(x, z);
    if (nodeMap.has(key)) return nodeMap.get(key);
    const idx = nodes.length;
    nodes.push({ id: idx, x, z, type: 'intersection', connections: 0 });
    nodeMap.set(key, idx);
    return idx;
  }

  // --- Step 2: Process raw road edges into graph edges ---
  const edges = [];
  const rawPaths = []; // For mesh generation: each entry is { points, width, type, edgeIndex }

  // Build a set of bridge midpoints for quick lookup
  const bridgeMidpoints = new Set();
  if (rawBridges) {
    for (const bridge of rawBridges) {
      const mx = (bridge.start.x + bridge.end.x) * 0.5;
      const mz = (bridge.start.z + bridge.end.z) * 0.5;
      bridgeMidpoints.add(quantizeKey(mx, mz));
    }
  }

  for (let ri = 0; ri < rawRoads.length; ri++) {
    const road = rawRoads[ri];
    const fromIdx = getOrCreateNode(road.start.x, road.start.z);
    const toIdx = getOrCreateNode(road.end.x, road.end.z);

    if (fromIdx === toIdx) continue;

    const length = dist2d(road.start.x, road.start.z, road.end.x, road.end.z);
    if (length < 0.005) continue;

    const isMain = road.type === 'main';
    const isBridge = road.type === 'bridge';
    const roadWidth = isMain ? style.width * MAIN_ROAD_SCALE : style.width;

    const edgeType = isBridge ? 'bridge' : (isMain ? 'main' : 'path');

    const edgeIndex = edges.length;
    edges.push({
      from: fromIdx,
      to: toIdx,
      distance: length,
      width: roadWidth,
      type: edgeType,
    });

    nodes[fromIdx].connections++;
    nodes[toIdx].connections++;

    // Generate Catmull-Rom smoothed path for this edge
    const pathPoints = sampleRoadPath(
      road.start.x, road.start.z,
      road.end.x, road.end.z,
      sampler, isBridge
    );

    rawPaths.push({
      points: pathPoints,
      width: roadWidth,
      type: edgeType,
      edgeIndex,
    });

    // Mark bridge nodes
    if (isBridge) {
      nodes[fromIdx].type = 'bridge';
      nodes[toIdx].type = 'bridge';
    }
  }

  // --- Step 3: Classify node types ---
  // Building nodes: closest node to each district center
  if (districts) {
    for (const district of districts) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let ni = 0; ni < nodes.length; ni++) {
        const d = dist2d(nodes[ni].x, nodes[ni].z, district.center.x, district.center.z);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = ni;
        }
      }
      if (bestIdx >= 0 && nodes[bestIdx].type === 'intersection') {
        nodes[bestIdx].type = 'building';
      }
    }
  }

  // Gate nodes: nodes on the outer perimeter (far from center)
  const maxDist = nodes.reduce((mx, n) => {
    const d = Math.sqrt(n.x * n.x + n.z * n.z);
    return d > mx ? d : mx;
  }, 0);

  if (maxDist > 0) {
    for (const node of nodes) {
      const d = Math.sqrt(node.x * node.x + node.z * node.z);
      if (d > maxDist * 0.85 && node.connections <= 2 && node.type === 'intersection') {
        node.type = 'gate';
      }
    }
  }

  return { nodes, edges, rawPaths };
}

/**
 * Sample a smoothed road path between two endpoints using CatmullRomCurve3.
 * Includes terrain height sampling.
 */
function sampleRoadPath(x0, z0, x1, z1, sampler, isBridge) {
  const points = [];
  const dx = x1 - x0;
  const dz = z1 - z0;
  const length = Math.sqrt(dx * dx + dz * dz);

  // For short segments, just use linear interpolation
  if (length < 0.05) {
    const y0 = isBridge ? BRIDGE_Y_RISE : (sampler.getHeight(x0, z0) + ROAD_Y_OFFSET);
    const y1 = isBridge ? BRIDGE_Y_RISE : (sampler.getHeight(x1, z1) + ROAD_Y_OFFSET);
    points.push({ x: x0, y: y0, z: z0 });
    points.push({ x: x1, y: y1, z: z1 });
    return points;
  }

  // Create control points for Catmull-Rom curve
  // Add extra control points at start and end for proper tangent calculation
  const controlPoints = [];
  const numMidPoints = Math.max(2, Math.ceil(length / 0.1));

  for (let i = 0; i <= numMidPoints; i++) {
    const t = i / numMidPoints;
    const px = x0 + dx * t;
    const pz = z0 + dz * t;
    let py;

    if (isBridge) {
      // Bridge: arc shape rising in the middle
      const bridgeT = Math.sin(t * Math.PI);
      py = BRIDGE_Y_RISE + bridgeT * 0.01;
    } else {
      py = sampler.getHeight(px, pz) + ROAD_Y_OFFSET;
    }

    controlPoints.push(new THREE.Vector3(px, py, pz));
  }

  // Build Catmull-Rom curve
  const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'catmullrom', 0.5);

  // Sample the curve
  const sampleCount = Math.max(4, CATMULL_SAMPLES);
  for (let i = 0; i <= sampleCount; i++) {
    const t = i / sampleCount;
    const pt = curve.getPointAt(t);
    points.push({ x: pt.x, y: pt.y, z: pt.z });
  }

  return points;
}

// ---------------------------------------------------------------------------
// Mesh generation
// ---------------------------------------------------------------------------

/**
 * Generate road ribbon geometry from a smoothed path.
 * Creates a flat ribbon with left/right vertices offset from center by width/2.
 */
function generateRoadRibbonGeometry(pathPoints, width) {
  const n = pathPoints.length;
  if (n < 2) return null;

  // 2 verts per sample (left + right) for main strip
  // + 2 verts for left border + 2 verts for right border = 6 verts per sample
  const vertCount = n * 6;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = new Float32Array(vertCount * 3);

  const halfW = width * 0.5;
  const borderW = width * ROAD_BORDER_RATIO;
  const innerHalfW = halfW - borderW;

  let totalLength = 0;
  const cumulativeLength = [0];
  for (let i = 1; i < n; i++) {
    totalLength += dist2d(pathPoints[i].x, pathPoints[i].z, pathPoints[i - 1].x, pathPoints[i - 1].z);
    cumulativeLength.push(totalLength);
  }

  for (let i = 0; i < n; i++) {
    // Compute perpendicular direction
    let perpX, perpZ;
    if (i === 0) {
      perpX = -(pathPoints[1].z - pathPoints[0].z);
      perpZ = pathPoints[1].x - pathPoints[0].x;
    } else if (i === n - 1) {
      perpX = -(pathPoints[n - 1].z - pathPoints[n - 2].z);
      perpZ = pathPoints[n - 1].x - pathPoints[n - 2].x;
    } else {
      perpX = -(pathPoints[i + 1].z - pathPoints[i - 1].z);
      perpZ = pathPoints[i + 1].x - pathPoints[i - 1].x;
    }

    const pLen = Math.sqrt(perpX * perpX + perpZ * perpZ);
    if (pLen > 0.0001) {
      perpX /= pLen;
      perpZ /= pLen;
    }

    const cx = pathPoints[i].x;
    const cy = pathPoints[i].y;
    const cz = pathPoints[i].z;
    const u = totalLength > 0 ? cumulativeLength[i] / totalLength : 0;

    const base = i * 6;

    // Left border outer edge (index 0)
    positions[(base + 0) * 3] = cx + perpX * halfW;
    positions[(base + 0) * 3 + 1] = cy;
    positions[(base + 0) * 3 + 2] = cz + perpZ * halfW;
    uvs[(base + 0) * 2] = u;
    uvs[(base + 0) * 2 + 1] = 0.0;
    colors[(base + 0) * 3] = 0;
    colors[(base + 0) * 3 + 1] = 0;
    colors[(base + 0) * 3 + 2] = 0; // dark border, set later

    // Left border inner edge (index 1)
    positions[(base + 1) * 3] = cx + perpX * innerHalfW;
    positions[(base + 1) * 3 + 1] = cy;
    positions[(base + 1) * 3 + 2] = cz + perpZ * innerHalfW;
    uvs[(base + 1) * 2] = u;
    uvs[(base + 1) * 2 + 1] = ROAD_BORDER_RATIO;
    colors[(base + 1) * 3] = 1;
    colors[(base + 1) * 3 + 1] = 1;
    colors[(base + 1) * 3 + 2] = 1; // main color

    // Center-left (index 2) - same as inner left
    positions[(base + 2) * 3] = cx + perpX * innerHalfW;
    positions[(base + 2) * 3 + 1] = cy;
    positions[(base + 2) * 3 + 2] = cz + perpZ * innerHalfW;
    uvs[(base + 2) * 2] = u;
    uvs[(base + 2) * 2 + 1] = ROAD_BORDER_RATIO;
    colors[(base + 2) * 3] = 1;
    colors[(base + 2) * 3 + 1] = 1;
    colors[(base + 2) * 3 + 2] = 1;

    // Center-right (index 3) - same as inner right
    positions[(base + 3) * 3] = cx - perpX * innerHalfW;
    positions[(base + 3) * 3 + 1] = cy;
    positions[(base + 3) * 3 + 2] = cz - perpZ * innerHalfW;
    uvs[(base + 3) * 2] = u;
    uvs[(base + 3) * 2 + 1] = 1.0 - ROAD_BORDER_RATIO;
    colors[(base + 3) * 3] = 1;
    colors[(base + 3) * 3 + 1] = 1;
    colors[(base + 3) * 3 + 2] = 1;

    // Right border inner edge (index 4)
    positions[(base + 4) * 3] = cx - perpX * innerHalfW;
    positions[(base + 4) * 3 + 1] = cy;
    positions[(base + 4) * 3 + 2] = cz - perpZ * innerHalfW;
    uvs[(base + 4) * 2] = u;
    uvs[(base + 4) * 2 + 1] = 1.0 - ROAD_BORDER_RATIO;
    colors[(base + 4) * 3] = 1;
    colors[(base + 4) * 3 + 1] = 1;
    colors[(base + 4) * 3 + 2] = 1;

    // Right border outer edge (index 5)
    positions[(base + 5) * 3] = cx - perpX * halfW;
    positions[(base + 5) * 3 + 1] = cy;
    positions[(base + 5) * 3 + 2] = cz - perpZ * halfW;
    uvs[(base + 5) * 2] = u;
    uvs[(base + 5) * 2 + 1] = 1.0;
    colors[(base + 5) * 3] = 0;
    colors[(base + 5) * 3 + 1] = 0;
    colors[(base + 5) * 3 + 2] = 0; // dark border
  }

  // Build index buffer
  // For each segment (between consecutive samples), build quads for:
  // left border (verts 0-1), main center (verts 1-4 using 2,3), right border (verts 4-5)
  const indices = [];
  for (let i = 0; i < n - 1; i++) {
    const c = i * 6;
    const nn = (i + 1) * 6;

    // Left border quad: c+0, c+1, nn+0, nn+1
    indices.push(c + 0, nn + 0, c + 1);
    indices.push(c + 1, nn + 0, nn + 1);

    // Main center quad: c+2, c+3, nn+2, nn+3
    indices.push(c + 2, nn + 2, c + 3);
    indices.push(c + 3, nn + 2, nn + 3);

    // Right border quad: c+4, c+5, nn+4, nn+5
    indices.push(c + 4, nn + 4, c + 5);
    indices.push(c + 5, nn + 4, nn + 5);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * Create materials for road rendering.
 */
function createRoadMaterials(tier) {
  const style = ROAD_TIERS[tier];

  const mainMaterial = new THREE.MeshStandardMaterial({
    color: style.color,
    roughness: tier === 0 ? 0.95 : (tier === 1 ? 0.80 : 0.50),
    metalness: 0,
    vertexColors: true,
    side: THREE.DoubleSide,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  // Tint the vertex color channel: border verts have color (0,0,0),
  // main verts have (1,1,1). The vertex color multiplies into the base material
  // color, so border strips appear as borderColor and main strips as color.
  // To achieve two distinct colors we blend via vertex color:
  // We set the base to borderColor and vertex color 1 maps to a lightening factor.
  // Actually simpler: use a single material with vertexColors where border verts
  // store borderColor and main verts store mainColor.

  return { mainMaterial, borderColor: new THREE.Color(style.borderColor), mainColor: new THREE.Color(style.color) };
}

/**
 * Apply the two-tone color to a road geometry's vertex color attribute.
 */
function applyRoadColors(geometry, mainColor, borderColor) {
  const colorAttr = geometry.getAttribute('color');
  if (!colorAttr) return;
  const arr = colorAttr.array;

  for (let i = 0; i < arr.length; i += 3) {
    // The color was set to (0,0,0) for border and (1,1,1) for main
    const isBorder = arr[i] < 0.5;
    if (isBorder) {
      arr[i] = borderColor.r;
      arr[i + 1] = borderColor.g;
      arr[i + 2] = borderColor.b;
    } else {
      arr[i] = mainColor.r;
      arr[i + 1] = mainColor.g;
      arr[i + 2] = mainColor.b;
    }
  }
  colorAttr.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Junction geometry: intersection discs and dead-end caps
// ---------------------------------------------------------------------------

/**
 * Generate a flat circular disc at a road intersection.
 * Covers the ugly gaps between converging square-ended road ribbons.
 *
 * @param {number} cx - Center X
 * @param {number} cz - Center Z
 * @param {number} cy - Center Y (terrain height + offset)
 * @param {number} radius - Disc radius (derived from widest road at this node)
 * @param {THREE.Color} mainColor - Road surface color for vertex coloring
 * @returns {THREE.BufferGeometry}
 */
function generateIntersectionDisc(cx, cz, cy, radius, mainColor) {
  const seg = INTERSECTION_SEGMENTS;
  const vertCount = seg + 1; // center + ring
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = new Float32Array(vertCount * 3);

  // Center vertex
  positions[0] = cx; positions[1] = cy; positions[2] = cz;
  uvs[0] = 0.5; uvs[1] = 0.5;
  colors[0] = mainColor.r; colors[1] = mainColor.g; colors[2] = mainColor.b;

  // Ring vertices
  for (let i = 0; i < seg; i++) {
    const angle = (i / seg) * Math.PI * 2;
    const vi = i + 1;
    positions[vi * 3]     = cx + Math.cos(angle) * radius;
    positions[vi * 3 + 1] = cy;
    positions[vi * 3 + 2] = cz + Math.sin(angle) * radius;
    uvs[vi * 2]     = 0.5 + Math.cos(angle) * 0.5;
    uvs[vi * 2 + 1] = 0.5 + Math.sin(angle) * 0.5;
    colors[vi * 3]     = mainColor.r;
    colors[vi * 3 + 1] = mainColor.g;
    colors[vi * 3 + 2] = mainColor.b;
  }

  // Triangle fan
  const indices = [];
  for (let i = 0; i < seg; i++) {
    const next = ((i + 1) % seg) + 1;
    indices.push(0, i + 1, next);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Generate a semicircular cap at a dead-end road termination.
 * The dome extends outward from the road endpoint in the road's direction.
 *
 * @param {{ x: number, y: number, z: number }} endPoint - Last path sample
 * @param {number} dirX - Outward direction X (normalized, away from road interior)
 * @param {number} dirZ - Outward direction Z (normalized)
 * @param {number} width - Road width at this endpoint
 * @param {THREE.Color} mainColor - Road surface color
 * @returns {THREE.BufferGeometry}
 */
function generateRoadCap(endPoint, dirX, dirZ, width, mainColor) {
  const seg = CAP_SEGMENTS;
  const halfW = width * 0.5;
  const perpX = -dirZ;
  const perpZ = dirX;
  const cx = endPoint.x, cy = endPoint.y, cz = endPoint.z;

  const vertCount = seg + 2; // center + (seg+1) arc points
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = new Float32Array(vertCount * 3);

  // Center vertex (at the road endpoint)
  positions[0] = cx; positions[1] = cy; positions[2] = cz;
  uvs[0] = 0.5; uvs[1] = 0.0;
  colors[0] = mainColor.r; colors[1] = mainColor.g; colors[2] = mainColor.b;

  // Arc vertices: sweep from left edge → tip → right edge
  // angle goes PI/2 → -PI/2 so triangle fan winds CCW (upward normal)
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const angle = (0.5 - t) * Math.PI; // PI/2 to -PI/2
    const fwd = Math.cos(angle);  // forward (outward) component
    const lat = Math.sin(angle);  // lateral (perpendicular) component

    const vi = i + 1;
    positions[vi * 3]     = cx + dirX * fwd * halfW + perpX * lat * halfW;
    positions[vi * 3 + 1] = cy;
    positions[vi * 3 + 2] = cz + dirZ * fwd * halfW + perpZ * lat * halfW;
    uvs[vi * 2]     = t;
    uvs[vi * 2 + 1] = 1.0;
    colors[vi * 3]     = mainColor.r;
    colors[vi * 3 + 1] = mainColor.g;
    colors[vi * 3 + 2] = mainColor.b;
  }

  // Triangle fan from center to arc
  const indices = [];
  for (let i = 0; i < seg; i++) {
    indices.push(0, i + 1, i + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Normalize a 2D vector in the XZ plane.
 */
function normalize2d(x, z) {
  const len = Math.sqrt(x * x + z * z);
  if (len < 0.0001) return { x: 0, z: 1 };
  return { x: x / len, z: z / len };
}

/**
 * Generate intersection discs at multi-road junctions and semicircular caps
 * at dead-end road terminations for smooth, rounded road endings.
 *
 * @param {Array} nodes - Road graph nodes
 * @param {Array} edges - Road graph edges
 * @param {Array} rawPaths - Generated road paths
 * @param {object} sampler - Terrain height sampler
 * @param {THREE.Color} mainColor - Main road surface color
 * @returns {THREE.BufferGeometry[]} Array of junction geometries to merge
 */
function generateJunctionGeometry(nodes, edges, rawPaths, sampler, mainColor) {
  const geos = [];
  if (!nodes || nodes.length === 0) return geos;

  // Build per-node info: max road width reaching it + endpoint directions for caps
  const nodeInfo = nodes.map(() => ({ maxWidth: 0, endpoints: [] }));

  for (const path of rawPaths) {
    if (path.type === 'bridge') continue;
    const edge = edges[path.edgeIndex];
    if (!edge) continue;

    const fromIdx = edge.from;
    const toIdx = edge.to;
    const w = path.width;

    nodeInfo[fromIdx].maxWidth = Math.max(nodeInfo[fromIdx].maxWidth, w);
    nodeInfo[toIdx].maxWidth = Math.max(nodeInfo[toIdx].maxWidth, w);

    const pts = path.points;
    if (pts.length >= 2) {
      // "from" end: outward direction (away from road interior)
      const fd = normalize2d(pts[0].x - pts[1].x, pts[0].z - pts[1].z);
      nodeInfo[fromIdx].endpoints.push({ ...fd, endPoint: pts[0] });

      // "to" end: outward direction
      const td = normalize2d(
        pts[pts.length - 1].x - pts[pts.length - 2].x,
        pts[pts.length - 1].z - pts[pts.length - 2].z
      );
      nodeInfo[toIdx].endpoints.push({ ...td, endPoint: pts[pts.length - 1] });
    }
  }

  for (let ni = 0; ni < nodes.length; ni++) {
    const node = nodes[ni];
    const info = nodeInfo[ni];
    if (info.maxWidth === 0 || node.type === 'bridge') continue;

    const nodeY = sampler.getHeight(node.x, node.z) + ROAD_Y_OFFSET;

    if (node.connections >= 2) {
      // Intersection disc — smooth circular patch covering gaps between roads
      const radius = info.maxWidth * 0.5 * 1.15;
      const disc = generateIntersectionDisc(node.x, node.z, nodeY, radius, mainColor);
      if (disc) geos.push(disc);
    } else if (node.connections === 1 && info.endpoints.length > 0) {
      // Dead-end rounded cap — semicircle extending from the road's last point
      const ep = info.endpoints[0];
      const cap = generateRoadCap(ep.endPoint, ep.x, ep.z, info.maxWidth, mainColor);
      if (cap) geos.push(cap);
    }
  }

  return geos;
}

// ---------------------------------------------------------------------------
// Bridge mesh generation
// ---------------------------------------------------------------------------

/**
 * Generate bridge geometry: flat deck + side rails + support arches.
 */
function generateBridgeMesh(pathPoints, width, group, bridgeMaterial, railMaterial) {
  if (pathPoints.length < 2) return;

  const start = pathPoints[0];
  const end = pathPoints[pathPoints.length - 1];
  const length = dist2d(start.x, start.z, end.x, end.z);
  if (length < 0.01) return;

  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const angle = Math.atan2(dx, dz);

  const midX = (start.x + end.x) * 0.5;
  const midZ = (start.z + end.z) * 0.5;

  // Perpendicular direction
  const perpX = -dz / length;
  const perpZ = dx / length;

  // --- Deck: flat box ---
  const deckThickness = 0.008;
  const deckGeom = new THREE.BoxGeometry(width * 1.1, deckThickness, length * 1.05);
  const deck = new THREE.Mesh(deckGeom, bridgeMaterial);
  deck.position.set(midX, BRIDGE_Y_RISE - deckThickness * 0.5, midZ);
  deck.rotation.y = angle;
  deck.receiveShadow = true;
  deck.castShadow = true;
  group.add(deck);

  // --- Side rails ---
  const railGeom = new THREE.BoxGeometry(BRIDGE_RAIL_THICKNESS, BRIDGE_RAIL_HEIGHT, length * 1.05);

  const leftRail = new THREE.Mesh(railGeom, railMaterial);
  leftRail.position.set(
    midX + perpX * width * 0.5,
    BRIDGE_Y_RISE + BRIDGE_RAIL_HEIGHT * 0.5,
    midZ + perpZ * width * 0.5
  );
  leftRail.rotation.y = angle;
  leftRail.castShadow = true;
  group.add(leftRail);

  const rightRail = new THREE.Mesh(railGeom.clone(), railMaterial);
  rightRail.position.set(
    midX - perpX * width * 0.5,
    BRIDGE_Y_RISE + BRIDGE_RAIL_HEIGHT * 0.5,
    midZ - perpZ * width * 0.5
  );
  rightRail.rotation.y = angle;
  rightRail.castShadow = true;
  group.add(rightRail);

  // --- Rail posts (vertical pillars along the rails) ---
  const postCount = Math.max(2, Math.floor(length / 0.06));
  const postGeom = new THREE.CylinderGeometry(0.003, 0.003, BRIDGE_RAIL_HEIGHT + deckThickness, 4);

  for (let pi = 0; pi <= postCount; pi++) {
    const t = pi / postCount;
    const px = start.x + dx * t;
    const pz = start.z + dz * t;

    // Left post
    const lPost = new THREE.Mesh(postGeom, railMaterial);
    lPost.position.set(
      px + perpX * width * 0.5,
      BRIDGE_Y_RISE + (BRIDGE_RAIL_HEIGHT - deckThickness) * 0.5,
      pz + perpZ * width * 0.5
    );
    lPost.castShadow = true;
    group.add(lPost);

    // Right post
    const rPost = new THREE.Mesh(postGeom, railMaterial);
    rPost.position.set(
      px - perpX * width * 0.5,
      BRIDGE_Y_RISE + (BRIDGE_RAIL_HEIGHT - deckThickness) * 0.5,
      pz - perpZ * width * 0.5
    );
    rPost.castShadow = true;
    group.add(rPost);
  }

  // --- Support arches underneath ---
  const archCount = Math.max(1, Math.floor(length / 0.12));
  for (let ai = 0; ai < archCount; ai++) {
    const t = (ai + 0.5) / archCount;
    const ax = start.x + dx * t;
    const az = start.z + dz * t;

    // Arch: a half-torus approximated by curved cylinder segments
    const archRadius = width * 0.4;
    const archTube = 0.004;
    const archSegments = BRIDGE_ARCH_SEGMENTS;

    const archPositions = [];
    for (let si = 0; si <= archSegments; si++) {
      const sa = (si / archSegments) * Math.PI;
      const lx = Math.cos(sa) * archRadius;
      const ly = -Math.sin(sa) * archRadius;
      archPositions.push(new THREE.Vector3(
        ax + perpX * lx,
        BRIDGE_Y_RISE - deckThickness + ly,
        az + perpZ * lx
      ));
    }

    const archCurve = new THREE.CatmullRomCurve3(archPositions);
    const tubeGeom = new THREE.TubeGeometry(archCurve, archSegments, archTube, 4, false);
    const archMesh = new THREE.Mesh(tubeGeom, railMaterial);
    archMesh.castShadow = true;
    group.add(archMesh);
  }
}

// ---------------------------------------------------------------------------
// Spatial lookup for isOnRoad queries
// ---------------------------------------------------------------------------

/**
 * Build a flat array of road segments for efficient spatial queries.
 */
function buildRoadSegmentIndex(rawPaths) {
  const segments = [];
  for (const path of rawPaths) {
    const pts = path.points;
    const hw = path.width * 0.5;
    for (let i = 0; i < pts.length - 1; i++) {
      segments.push({
        x0: pts[i].x,
        z0: pts[i].z,
        x1: pts[i + 1].x,
        z1: pts[i + 1].z,
        halfWidth: hw,
        centerX: (pts[i].x + pts[i + 1].x) * 0.5,
        centerZ: (pts[i].z + pts[i + 1].z) * 0.5,
      });
    }
  }
  return segments;
}

/**
 * Point-to-segment distance in 2D.
 * Returns { dist, nearestX, nearestZ }.
 */
function pointToSegment2D(px, pz, x0, z0, x1, z1) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const lenSq = dx * dx + dz * dz;

  if (lenSq < 1e-12) {
    const dd = dist2d(px, pz, x0, z0);
    return { dist: dd, nearestX: x0, nearestZ: z0 };
  }

  let t = ((px - x0) * dx + (pz - z0) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const nx = x0 + t * dx;
  const nz = z0 + t * dz;
  const dd = dist2d(px, pz, nx, nz);
  return { dist: dd, nearestX: nx, nearestZ: nz };
}

// ---------------------------------------------------------------------------
// RoadNetwork
// ---------------------------------------------------------------------------

export class RoadNetwork {
  /**
   * @param {object} [options]
   * @param {number} [options.catmullSamples] - Curve sample count per road edge
   */
  constructor(options = {}) {
    this._catmullSamples = options.catmullSamples || CATMULL_SAMPLES;
    this._roadGraph = null;
    this._meshGroup = null;
    this._materials = [];
    this._currentTier = -1;
    this._roadSegments = null;
    this._rawPaths = null;
    this._estateLevel = 1;
    this._textures = null;
    this._mergedRoadMesh = null;
    this._ribbonVertexCount = 0;
  }

  /**
   * Set PBR texture map for road materials (fire-and-forget pattern).
   * Call applyTextures() after to update existing meshes.
   * @param {Map<string, object>} textureMap - packName → PBR set
   */
  setTextures(textureMap) {
    this._textures = textureMap;
  }

  /**
   * Apply loaded textures to existing road materials in-place.
   * Called fire-and-forget after async texture load.
   */
  applyTextures() {
    if (!this._textures || !this._meshGroup) return;

    const tier = this._currentTier;
    if (tier < 0) return;
    const style = ROAD_TIERS[tier];

    // Apply main road pack to road ribbon materials
    const mainPack = style.pack ? this._textures.get(style.pack) : null;
    if (mainPack) {
      this._meshGroup.traverse((child) => {
        if (!child.isMesh || !child.material || !child.material.isMeshStandardMaterial) return;
        if (!child.geometry || !child.geometry.getAttribute('color')) return;
        // This is a road ribbon mesh
        const mat = child.material;
        if (mainPack.map) mat.map = mainPack.map;
        if (mainPack.normalMap) {
          mat.normalMap = mainPack.normalMap;
          mat.normalScale = mat.normalScale || new THREE.Vector2(1, 1);
        }
        if (mainPack.roughnessMap) {
          mat.roughnessMap = mainPack.roughnessMap;
          mat.roughness = 1.0;
        }
        if (mainPack.aoMap) mat.aoMap = mainPack.aoMap;
        mat.needsUpdate = true;
      });
    }
  }

  /**
   * Generate road network from district layout.
   * @param {object} districtLayout - From DistrictSystem.getLayout()
   * @param {{ getHeight(x:number,z:number):number, isWater?(x:number,z:number):boolean, getWaterDistance?(x:number,z:number):number }} terrainSampler
   * @param {number} estateLevel
   * @returns {{ meshGroup: THREE.Group, roadGraph: { nodes: Array, edges: Array } }}
   */
  generate(districtLayout, terrainSampler, estateLevel) {
    this.dispose();

    const sampler = terrainSampler || NULL_SAMPLER;
    const level = Math.max(1, estateLevel || 1);
    this._estateLevel = level;
    const tier = getRoadTier(level);
    this._currentTier = tier;

    // Wrap sampler to ensure isWater exists
    const wrappedSampler = {
      getHeight: sampler.getHeight ? sampler.getHeight.bind(sampler) : NULL_SAMPLER.getHeight,
      isWater: sampler.isWater
        ? sampler.isWater.bind(sampler)
        : (x, z) => {
            const wd = sampler.getWaterDistance
              ? sampler.getWaterDistance(x, z)
              : NULL_SAMPLER.getWaterDistance(x, z);
            return wd < 0.05;
          },
      getWaterDistance: sampler.getWaterDistance
        ? sampler.getWaterDistance.bind(sampler)
        : NULL_SAMPLER.getWaterDistance,
      getMoisture: sampler.getMoisture ? sampler.getMoisture.bind(sampler) : NULL_SAMPLER.getMoisture,
      getSlope: sampler.getSlope ? sampler.getSlope.bind(sampler) : NULL_SAMPLER.getSlope,
    };

    // Build the road graph
    const { nodes, edges, rawPaths } = buildRoadGraph(districtLayout, wrappedSampler, level);
    this._roadGraph = { nodes, edges };
    this._rawPaths = rawPaths;

    // Build spatial index for isOnRoad queries
    this._roadSegments = buildRoadSegmentIndex(rawPaths);

    // Generate mesh group
    this._meshGroup = new THREE.Group();
    this._meshGroup.name = 'road-network';

    // Create road materials
    const { mainMaterial, borderColor, mainColor } = createRoadMaterials(tier);
    this._materials.push(mainMaterial);

    // Bridge materials
    const bridgeMaterial = new THREE.MeshStandardMaterial({
      color: tier === 0 ? 0x8b7355 : 0x707070,
      roughness: tier === 0 ? 0.90 : 0.65,
      metalness: 0,
    });
    this._materials.push(bridgeMaterial);

    const railMaterial = new THREE.MeshStandardMaterial({
      color: tier === 0 ? 0x6b5335 : 0x555555,
      roughness: 0.75,
      metalness: 0.1,
    });
    this._materials.push(railMaterial);

    // Generate road ribbon geometries
    const roadGeos = [];
    for (const path of rawPaths) {
      if (path.type === 'bridge') {
        // Bridge gets special geometry
        generateBridgeMesh(path.points, path.width, this._meshGroup, bridgeMaterial, railMaterial);
      } else {
        // Normal road ribbon
        const geo = generateRoadRibbonGeometry(path.points, path.width);
        if (geo) {
          applyRoadColors(geo, mainColor, borderColor);
          roadGeos.push(geo);
        }
      }
    }

    // Track ribbon vertex count so updateRoadType can distinguish
    // ribbon vertices (6-per-sample pattern) from junction vertices (all mainColor)
    let ribbonVertCount = 0;
    for (const geo of roadGeos) {
      ribbonVertCount += geo.getAttribute('position').count;
    }
    this._ribbonVertexCount = ribbonVertCount;

    // Generate smooth intersection discs and dead-end caps
    const junctionGeos = generateJunctionGeometry(
      nodes, edges, rawPaths, wrappedSampler, mainColor
    );

    // Combine ribbon + junction geometries for single-draw-call merge
    const allGeos = [...roadGeos, ...junctionGeos];

    if (allGeos.length > 0) {
      const merged = allGeos.length === 1
        ? allGeos[0]
        : mergeGeometries(allGeos, false);
      if (merged) {
        const mesh = new THREE.Mesh(merged, mainMaterial);
        mesh.receiveShadow = true;
        mesh.renderOrder = 1;
        mesh.name = 'road-ribbons-merged';
        this._meshGroup.add(mesh);
        this._mergedRoadMesh = mesh;
        // Dispose individual geometries after merge (mergeGeometries creates a new buffer)
        if (allGeos.length > 1) {
          for (const geo of allGeos) geo.dispose();
        }
      }
    }

    return {
      meshGroup: this._meshGroup,
      roadGraph: { nodes: this._cleanNodes(nodes), edges },
    };
  }

  /**
   * Return a cleaned copy of nodes without internal bookkeeping fields.
   */
  _cleanNodes(nodes) {
    return nodes.map(n => ({
      id: n.id,
      x: n.x,
      z: n.z,
      type: n.type,
    }));
  }

  /**
   * Get the road graph for NPC pathfinding.
   * @returns {{ nodes: Array<{ id: number, x: number, z: number, type: string }>, edges: Array<{ from: number, to: number, distance: number, width: number, type: string }> }}
   */
  getRoadGraph() {
    if (!this._roadGraph) {
      return { nodes: [], edges: [] };
    }
    return {
      nodes: this._cleanNodes(this._roadGraph.nodes),
      edges: this._roadGraph.edges,
    };
  }

  /**
   * Query whether a position is on a road.
   * @param {number} x
   * @param {number} z
   * @returns {{ onRoad: boolean, roadWidth: number, roadCenter: { x: number, z: number } }}
   */
  isOnRoad(x, z) {
    if (!this._roadSegments || this._roadSegments.length === 0) {
      return { onRoad: false, roadWidth: 0, roadCenter: { x, z } };
    }

    let bestDist = Infinity;
    let bestHalfWidth = 0;
    let bestCenterX = x;
    let bestCenterZ = z;

    for (let i = 0; i < this._roadSegments.length; i++) {
      const seg = this._roadSegments[i];

      // Quick bounding reject: if point is far from segment center, skip
      const rough = dist2d(x, z, seg.centerX, seg.centerZ);
      const segLen = dist2d(seg.x0, seg.z0, seg.x1, seg.z1);
      if (rough > segLen + seg.halfWidth * 2) continue;

      const { dist, nearestX, nearestZ } = pointToSegment2D(x, z, seg.x0, seg.z0, seg.x1, seg.z1);

      if (dist < bestDist) {
        bestDist = dist;
        bestHalfWidth = seg.halfWidth;
        bestCenterX = nearestX;
        bestCenterZ = nearestZ;
      }
    }

    const onRoad = bestDist <= bestHalfWidth;
    return {
      onRoad,
      roadWidth: bestHalfWidth * 2,
      roadCenter: { x: bestCenterX, z: bestCenterZ },
    };
  }

  /**
   * Get the mesh group containing all road and bridge meshes.
   * @returns {THREE.Group}
   */
  getMeshGroup() {
    return this._meshGroup;
  }

  /**
   * Update road appearance when estate level changes.
   * Regenerates materials and recolors existing geometry.
   * @param {number} estateLevel
   */
  updateRoadType(estateLevel) {
    const newTier = getRoadTier(estateLevel);
    if (newTier === this._currentTier) return;

    this._currentTier = newTier;
    this._estateLevel = estateLevel;
    const style = ROAD_TIERS[newTier];
    const newMainColor = new THREE.Color(style.color);
    const newBorderColor = new THREE.Color(style.borderColor);
    const newRoughness = newTier === 0 ? 0.95 : (newTier === 1 ? 0.80 : 0.50);

    if (!this._mergedRoadMesh) return;

    // Update material properties on the single merged road mesh
    const mat = this._mergedRoadMesh.material;
    mat.color.set(style.color);
    mat.roughness = newRoughness;
    mat.needsUpdate = true;

    // Recolor merged vertex colors:
    // Road ribbon vertices (first _ribbonVertexCount): 6-verts-per-sample pattern
    // Junction vertices (rest): all main color
    const colorAttr = this._mergedRoadMesh.geometry.getAttribute('color');
    if (colorAttr) {
      const arr = colorAttr.array;
      const ribbonCount = this._ribbonVertexCount || 0;

      // Road ribbon vertices: indices 0,5 per group of 6 = border; rest = main
      for (let vi = 0; vi < ribbonCount; vi++) {
        const mod = vi % 6;
        const c = (mod === 0 || mod === 5) ? newBorderColor : newMainColor;
        arr[vi * 3]     = c.r;
        arr[vi * 3 + 1] = c.g;
        arr[vi * 3 + 2] = c.b;
      }

      // Junction vertices (discs + caps): all main color
      for (let vi = ribbonCount; vi < colorAttr.count; vi++) {
        arr[vi * 3]     = newMainColor.r;
        arr[vi * 3 + 1] = newMainColor.g;
        arr[vi * 3 + 2] = newMainColor.b;
      }

      colorAttr.needsUpdate = true;
    }
  }

  /**
   * Dispose all GPU resources.
   */
  dispose() {
    if (this._meshGroup) {
      this._meshGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
      });
      // Remove from parent if attached
      if (this._meshGroup.parent) {
        this._meshGroup.parent.remove(this._meshGroup);
      }
      this._meshGroup = null;
    }

    for (const mat of this._materials) {
      mat.dispose();
    }
    this._materials = [];

    this._roadGraph = null;
    this._rawPaths = null;
    this._roadSegments = null;
    this._currentTier = -1;
    this._textures = null;
    this._mergedRoadMesh = null;
    this._ribbonVertexCount = 0;
  }
}
