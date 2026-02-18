/**
 * DistrictSystem -- Voronoi-based organic district generation for town layout.
 *
 * Generates contextual districts from building placements, terrain sampling,
 * and plot ownership. Districts are irregular Voronoi cells with Lloyd-relaxed
 * boundaries; roads follow cell edges. Ground materials blend smoothly between
 * adjacent districts with no hard fences.
 *
 * Uses an inline Bowyer-Watson Delaunay triangulation (no external deps).
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Building type constants (must stay in sync with core/constants.js)
// ---------------------------------------------------------------------------

const TYPE_MANSION     = 0;
const TYPE_BARRACKS    = 1;
const TYPE_WORKSHOP    = 2;
const TYPE_VAULT       = 3;
const TYPE_DOCK        = 4;
const TYPE_FORGE       = 5;
const TYPE_MARKET      = 6;
const TYPE_ACADEMY     = 7;
const TYPE_ARENA       = 8;
const TYPE_SANCTUARY   = 9;
const TYPE_OBSERVATORY = 10;
const TYPE_TREASURY    = 11;
const TYPE_CITADEL     = 12;

const TOWN_SQUARE_ID = -1;

// ---------------------------------------------------------------------------
// District ground definitions
// ---------------------------------------------------------------------------

const DISTRICT_GROUND = {
  [TOWN_SQUARE_ID]: { type: 'cobblestone',  color: new THREE.Color(0xa09880), roughness: 0.80, props: ['fountain', 'lamp_post', 'bench'] },
  [TYPE_MANSION]:     { type: 'grass',        color: new THREE.Color(0x5a8c3a), roughness: 0.90, props: ['hedge', 'garden_path', 'ornamental_tree', 'flower_bed'] },
  [TYPE_BARRACKS]:    { type: 'packed_dirt',   color: new THREE.Color(0x8b7355), roughness: 0.95, props: ['weapon_rack', 'training_dummy', 'training_ring'] },
  [TYPE_WORKSHOP]:    { type: 'rocky',         color: new THREE.Color(0x7a6a55), roughness: 0.92, props: ['mine_cart', 'pickaxe', 'ore_deposit'] },
  [TYPE_VAULT]:       { type: 'polished_stone',color: new THREE.Color(0x708090), roughness: 0.40, props: ['locked_chest', 'iron_gate'] },
  [TYPE_DOCK]:        { type: 'boardwalk',     color: new THREE.Color(0xc2a570), roughness: 0.85, props: ['pier', 'moored_boat', 'fishing_net'] },
  [TYPE_FORGE]:       { type: 'scorched_stone', color: new THREE.Color(0x5c4033), roughness: 0.88, props: ['anvil', 'quench_trough', 'coal_pile'] },
  [TYPE_MARKET]:      { type: 'cobblestone',   color: new THREE.Color(0xb8a07a), roughness: 0.75, props: ['market_stall', 'hanging_lantern', 'banner'] },
  [TYPE_ACADEMY]:     { type: 'inscribed_stone',color: new THREE.Color(0x8899aa), roughness: 0.50, props: ['scroll_rack', 'glowing_rune'] },
  [TYPE_ARENA]:       { type: 'sand',          color: new THREE.Color(0xd2b48c), roughness: 0.92, props: ['circular_ring', 'spectator_stand', 'banner'] },
  [TYPE_SANCTUARY]:   { type: 'mossy_stone',   color: new THREE.Color(0x6b8e5a), roughness: 0.85, props: ['ancient_tree', 'meditation_circle', 'glowing_ground'] },
  [TYPE_OBSERVATORY]: { type: 'star_map_stone', color: new THREE.Color(0x3a4a5a), roughness: 0.45, props: ['star_chart', 'orrery'] },
  [TYPE_TREASURY]:    { type: 'gold_marble',   color: new THREE.Color(0xc5a845), roughness: 0.35, props: ['scales', 'gem_display'] },
  [TYPE_CITADEL]:     { type: 'battlements',   color: new THREE.Color(0x606060), roughness: 0.80, props: ['siege_equipment', 'watchtower'] },
};

// ---------------------------------------------------------------------------
// Seeded PRNG (xorshift32)
// ---------------------------------------------------------------------------

function _xorshift32(state) {
  let s = state | 0;
  s ^= s << 13;
  s ^= s >> 17;
  s ^= s << 5;
  return s >>> 0;
}

class SeededRandom {
  constructor(seed) { this._state = (seed || 1) >>> 0; }
  next() {
    this._state = _xorshift32(this._state);
    return this._state / 4294967296;
  }
  range(min, max) { return min + this.next() * (max - min); }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function dist2d(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function polygonArea(verts) {
  let area = 0;
  for (let i = 0, n = verts.length; i < n; i++) {
    const j = (i + 1) % n;
    area += verts[i].x * verts[j].z - verts[j].x * verts[i].z;
  }
  return Math.abs(area) * 0.5;
}

function polygonCentroid(verts) {
  let cx = 0, cz = 0, a = 0;
  for (let i = 0, n = verts.length; i < n; i++) {
    const j = (i + 1) % n;
    const cross = verts[i].x * verts[j].z - verts[j].x * verts[i].z;
    cx += (verts[i].x + verts[j].x) * cross;
    cz += (verts[i].z + verts[j].z) * cross;
    a += cross;
  }
  if (Math.abs(a) < 1e-10) {
    // degenerate -- fall back to simple average
    let sx = 0, sz = 0;
    for (const v of verts) { sx += v.x; sz += v.z; }
    return { x: sx / verts.length, z: sz / verts.length };
  }
  a *= 0.5;
  const f = 1 / (6 * a);
  return { x: cx * f, z: cz * f };
}

function pointInPolygon(px, pz, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x, zi = verts[i].z;
    const xj = verts[j].x, zj = verts[j].z;
    if (((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / (zj - zi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function sortVerticesCCW(verts, cx, cz) {
  return verts.slice().sort((a, b) => {
    return Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx);
  });
}

function clipPolygonToCircle(verts, cx, cz, r) {
  // Sutherland-Hodgman-style clip against a circle (approximate with 32-gon)
  const sides = 32;
  let clipPoly = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    clipPoly.push({ x: cx + r * Math.cos(a), z: cz + r * Math.sin(a) });
  }
  return sutherlandHodgman(verts, clipPoly);
}

function clipPolygonToRect(verts, minX, minZ, maxX, maxZ) {
  const clipPoly = [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ];
  return sutherlandHodgman(verts, clipPoly);
}

function sutherlandHodgman(subject, clip) {
  let output = subject.slice();
  for (let i = 0; i < clip.length && output.length > 0; i++) {
    const input = output;
    output = [];
    const edgeStart = clip[i];
    const edgeEnd = clip[(i + 1) % clip.length];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const curInside = crossSign(edgeStart, edgeEnd, cur) >= 0;
      const prevInside = crossSign(edgeStart, edgeEnd, prev) >= 0;
      if (curInside) {
        if (!prevInside) {
          const inter = lineIntersect(prev, cur, edgeStart, edgeEnd);
          if (inter) output.push(inter);
        }
        output.push(cur);
      } else if (prevInside) {
        const inter = lineIntersect(prev, cur, edgeStart, edgeEnd);
        if (inter) output.push(inter);
      }
    }
  }
  return output;
}

function crossSign(a, b, p) {
  return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
}

function lineIntersect(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1z = p2.z - p1.z;
  const d2x = p4.x - p3.x, d2z = p4.z - p3.z;
  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((p3.x - p1.x) * d2z - (p3.z - p1.z) * d2x) / denom;
  return { x: p1.x + t * d1x, z: p1.z + t * d1z };
}

// ---------------------------------------------------------------------------
// Bowyer-Watson Delaunay triangulation
// ---------------------------------------------------------------------------

function circumcircle(ax, az, bx, bz, cx, cz) {
  const D = 2 * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz));
  if (Math.abs(D) < 1e-12) return { x: 0, z: 0, r2: Infinity };
  const a2 = ax * ax + az * az;
  const b2 = bx * bx + bz * bz;
  const c2 = cx * cx + cz * cz;
  const ux = (a2 * (bz - cz) + b2 * (cz - az) + c2 * (az - bz)) / D;
  const uz = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / D;
  const dx = ax - ux, dz = az - uz;
  return { x: ux, z: uz, r2: dx * dx + dz * dz };
}

function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Bowyer-Watson Delaunay triangulation.
 * @param {Array<{x:number,z:number}>} points
 * @returns {{ triangles: Array<[number,number,number]>, points: Array<{x:number,z:number}> }}
 */
function delaunayTriangulate(points) {
  const n = points.length;
  if (n < 3) return { triangles: [], points };

  // Compute bounding box
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const dx = maxX - minX || 1;
  const dz = maxZ - minZ || 1;
  const margin = Math.max(dx, dz) * 10;
  const midX = (minX + maxX) * 0.5;
  const midZ = (minZ + maxZ) * 0.5;

  // Super-triangle vertices (indices n, n+1, n+2)
  const allPoints = points.slice();
  allPoints.push({ x: midX - margin * 2, z: midZ - margin });
  allPoints.push({ x: midX + margin * 2, z: midZ - margin });
  allPoints.push({ x: midX, z: midZ + margin * 2 });

  // triangles: each { i, j, k, cc: { x, z, r2 } }
  const superA = n, superB = n + 1, superC = n + 2;
  let triangles = [{
    i: superA, j: superB, k: superC,
    cc: circumcircle(
      allPoints[superA].x, allPoints[superA].z,
      allPoints[superB].x, allPoints[superB].z,
      allPoints[superC].x, allPoints[superC].z),
  }];

  for (let p = 0; p < n; p++) {
    const px = allPoints[p].x, pz = allPoints[p].z;

    // Find all triangles whose circumcircle contains this point
    const bad = [];
    const good = [];
    for (const tri of triangles) {
      const ddx = px - tri.cc.x, ddz = pz - tri.cc.z;
      if (ddx * ddx + ddz * ddz <= tri.cc.r2 + 1e-10) {
        bad.push(tri);
      } else {
        good.push(tri);
      }
    }

    // Find boundary polygon (edges that appear in exactly one bad triangle)
    const edgeCount = new Map();
    for (const tri of bad) {
      const edges = [[tri.i, tri.j], [tri.j, tri.k], [tri.k, tri.i]];
      for (const [a, b] of edges) {
        const key = edgeKey(a, b);
        const prev = edgeCount.get(key);
        if (prev) {
          edgeCount.set(key, { a, b, count: prev.count + 1 });
        } else {
          edgeCount.set(key, { a, b, count: 1 });
        }
      }
    }

    // Re-triangulate: create new triangles from boundary edges to point p
    for (const { a, b, count } of edgeCount.values()) {
      if (count === 1) {
        const cc = circumcircle(
          allPoints[a].x, allPoints[a].z,
          allPoints[b].x, allPoints[b].z,
          allPoints[p].x, allPoints[p].z);
        good.push({ i: a, j: b, k: p, cc });
      }
    }
    triangles = good;
  }

  // Remove triangles that share vertices with super-triangle
  const result = [];
  for (const tri of triangles) {
    if (tri.i >= n || tri.j >= n || tri.k >= n) continue;
    result.push([tri.i, tri.j, tri.k]);
  }

  return { triangles: result, points: allPoints.slice(0, n) };
}

// ---------------------------------------------------------------------------
// Voronoi diagram from Delaunay
// ---------------------------------------------------------------------------

/**
 * Build Voronoi cells from Delaunay triangulation.
 * @param {Array<{x:number,z:number}>} seedPoints
 * @param {number|{minX:number,minZ:number,maxX:number,maxZ:number}} bound - clipping radius or bounding rect
 * @returns {Array<{ seed: {x:number,z:number}, vertices: Array<{x:number,z:number}> }>}
 */
function buildVoronoi(seedPoints, bound) {
  const n = seedPoints.length;
  if (n === 0) return [];

  // Determine if we use rect or circle clipping
  const useRect = typeof bound === 'object' && bound !== null;
  const boundRadius = useRect ? Math.max(bound.maxX - bound.minX, bound.maxZ - bound.minZ) : bound;

  if (n === 1) {
    if (useRect) {
      const verts = [
        { x: bound.minX, z: bound.minZ },
        { x: bound.maxX, z: bound.minZ },
        { x: bound.maxX, z: bound.maxZ },
        { x: bound.minX, z: bound.maxZ },
      ];
      return [{ seed: seedPoints[0], vertices: verts }];
    }
    const verts = [];
    const steps = 24;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      verts.push({ x: seedPoints[0].x + boundRadius * Math.cos(a), z: seedPoints[0].z + boundRadius * Math.sin(a) });
    }
    return [{ seed: seedPoints[0], vertices: verts }];
  }
  if (n === 2 && !useRect) {
    return buildTwoCellVoronoi(seedPoints, boundRadius);
  }

  // For 2 cells with rect bounds, fall through to general Delaunay

  const { triangles: delTriangles } = delaunayTriangulate(seedPoints);

  // Build adjacency: for each triangle, compute circumcenter
  const triCircumcenters = delTriangles.map(([i, j, k]) => {
    return circumcircle(
      seedPoints[i].x, seedPoints[i].z,
      seedPoints[j].x, seedPoints[j].z,
      seedPoints[k].x, seedPoints[k].z);
  });

  // For each seed point, collect circumcenters of all triangles that contain it
  // and sort them in CCW order to form the Voronoi cell polygon
  const cells = [];
  for (let s = 0; s < n; s++) {
    const circumCenters = [];
    for (let t = 0; t < delTriangles.length; t++) {
      const [i, j, k] = delTriangles[t];
      if (i === s || j === s || k === s) {
        circumCenters.push({ x: triCircumcenters[t].x, z: triCircumcenters[t].z });
      }
    }

    if (circumCenters.length < 3) {
      // Boundary cell -- create partial cell from available circumcenters + bounding extension
      const sorted = sortVerticesCCW(circumCenters, seedPoints[s].x, seedPoints[s].z);
      if (useRect) {
        const extended = extendCellToRect(sorted, seedPoints[s], bound);
        cells.push({ seed: { x: seedPoints[s].x, z: seedPoints[s].z }, vertices: extended });
      } else {
        const extended = extendCellToBound(sorted, seedPoints[s], boundRadius);
        cells.push({ seed: { x: seedPoints[s].x, z: seedPoints[s].z }, vertices: extended });
      }
    } else {
      // Full interior cell -- sort circumcenters CCW around seed point
      const sorted = sortVerticesCCW(circumCenters, seedPoints[s].x, seedPoints[s].z);
      if (useRect) {
        const clipped = clipPolygonToRect(sorted, bound.minX, bound.minZ, bound.maxX, bound.maxZ);
        if (clipped.length >= 3) {
          cells.push({ seed: { x: seedPoints[s].x, z: seedPoints[s].z }, vertices: clipped });
        } else {
          cells.push({ seed: { x: seedPoints[s].x, z: seedPoints[s].z }, vertices: sorted });
        }
      } else {
        const clipped = clipPolygonToCircle(sorted, 0, 0, boundRadius);
        if (clipped.length >= 3) {
          cells.push({ seed: { x: seedPoints[s].x, z: seedPoints[s].z }, vertices: clipped });
        } else {
          cells.push({ seed: { x: seedPoints[s].x, z: seedPoints[s].z }, vertices: sorted });
        }
      }
    }
  }

  return cells;
}

function buildTwoCellVoronoi(seeds, boundRadius) {
  const [a, b] = seeds;
  const mx = (a.x + b.x) * 0.5, mz = (a.z + b.z) * 0.5;
  // Perpendicular bisector direction
  const dx = b.x - a.x, dz = b.z - a.z;
  const perpX = -dz, perpZ = dx;
  const len = Math.sqrt(perpX * perpX + perpZ * perpZ) || 1;
  const nx = perpX / len, nz = perpZ / len;

  // Two half-discs
  const steps = 24;
  const cellA = [], cellB = [];
  for (let i = 0; i <= steps; i++) {
    const t = -boundRadius * 2 + (i / steps) * boundRadius * 4;
    const lx = mx + nx * t, lz = mz + nz * t;
    // Clamp to circle
    const dd = Math.sqrt(lx * lx + lz * lz);
    if (dd <= boundRadius) {
      cellA.push({ x: lx, z: lz });
    }
  }
  // Build arcs for each half
  const resultA = buildHalfDiscCell(a, mx, mz, nx, nz, boundRadius, steps, 1);
  const resultB = buildHalfDiscCell(b, mx, mz, nx, nz, boundRadius, steps, -1);
  return [
    { seed: { x: a.x, z: a.z }, vertices: resultA },
    { seed: { x: b.x, z: b.z }, vertices: resultB },
  ];
}

function buildHalfDiscCell(seed, mx, mz, nx, nz, radius, steps, side) {
  const verts = [];
  // Line segment along bisector within circle
  const lineLen = radius * 2;
  const linePoints = [];
  for (let i = 0; i <= 12; i++) {
    const t = -lineLen + (i / 12) * lineLen * 2;
    const lx = mx + nx * t, lz = mz + nz * t;
    if (lx * lx + lz * lz <= radius * radius) {
      linePoints.push({ x: lx, z: lz });
    }
  }

  // Arc on the side of `seed`
  const arcPoints = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const px = radius * Math.cos(a), pz = radius * Math.sin(a);
    // Check which side of bisector
    const dot = (px - mx) * (-nz) + (pz - mz) * nx;
    if (dot * side >= 0) {
      arcPoints.push({ x: px, z: pz });
    }
  }

  // Combine: bisector line + arc
  const all = linePoints.concat(arcPoints);
  if (all.length < 3) {
    // Fallback: small polygon around seed
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      all.push({ x: seed.x + 0.1 * Math.cos(a), z: seed.z + 0.1 * Math.sin(a) });
    }
  }
  return sortVerticesCCW(all, seed.x, seed.z);
}

function extendCellToBound(sortedCircumcenters, seed, boundRadius) {
  // For boundary Voronoi cells with insufficient circumcenters,
  // extend outward to the bounding circle
  const verts = sortedCircumcenters.slice();
  const cx = seed.x, cz = seed.z;

  // Add bounding arc points in the direction of the seed from center
  const angleToSeed = Math.atan2(cz, cx);
  const arcSpan = Math.PI * 0.8;
  const arcSteps = 8;
  for (let i = 0; i <= arcSteps; i++) {
    const a = angleToSeed - arcSpan / 2 + (i / arcSteps) * arcSpan;
    verts.push({ x: boundRadius * Math.cos(a), z: boundRadius * Math.sin(a) });
  }

  return sortVerticesCCW(verts, cx, cz);
}

function extendCellToRect(sortedCircumcenters, seed, rect) {
  const verts = sortedCircumcenters.slice();
  const cx = seed.x, cz = seed.z;

  // Add bounding rect corner points on the seed's side
  const corners = [
    { x: rect.minX, z: rect.minZ },
    { x: rect.maxX, z: rect.minZ },
    { x: rect.maxX, z: rect.maxZ },
    { x: rect.minX, z: rect.maxZ },
  ];

  // Add midpoints along the edges facing the seed
  const midW = (rect.minX + rect.maxX) * 0.5;
  const midH = (rect.minZ + rect.maxZ) * 0.5;
  const edgeMids = [
    { x: midW, z: rect.minZ },
    { x: rect.maxX, z: midH },
    { x: midW, z: rect.maxZ },
    { x: rect.minX, z: midH },
  ];

  // Add the nearest corner(s) and edge midpoints
  const angleToSeed = Math.atan2(cz, cx);
  for (const c of corners) {
    const angleToCorn = Math.atan2(c.z - cz, c.x - cx);
    const diff = Math.abs(angleToCorn - angleToSeed);
    if (diff < Math.PI * 0.8 || diff > Math.PI * 1.2) {
      verts.push(c);
    }
  }
  for (const m of edgeMids) {
    verts.push(m);
  }

  return sortVerticesCCW(verts, cx, cz);
}

// ---------------------------------------------------------------------------
// Null terrain sampler (fallback when no sampler is provided)
// ---------------------------------------------------------------------------

const NULL_SAMPLER = {
  getHeight(x, z) { return 0.0; },
  getMoisture(x, z) { return 0.5; },
  getWaterDistance(x, z) { return 10.0; },
  getSlope(x, z) { return 0.0; },
};

// ---------------------------------------------------------------------------
// Prop generation
// ---------------------------------------------------------------------------

function generateProps(district, rng) {
  const ground = DISTRICT_GROUND[district.buildingType] || DISTRICT_GROUND[TOWN_SQUARE_ID];
  const propTypes = ground.props;
  if (!propTypes || propTypes.length === 0) return [];

  const props = [];
  const count = 3 + Math.floor(rng.next() * 4);
  const cx = district.center.x;
  const cz = district.center.z;

  // Approximate max radius of the cell
  let maxR = 0;
  for (const v of district.vertices) {
    const d = dist2d(v.x, v.z, cx, cz);
    if (d > maxR) maxR = d;
  }
  const placeR = maxR * 0.7;

  for (let i = 0; i < count; i++) {
    // Place props within the cell, avoiding the center (building footprint)
    const minDist = placeR * 0.25;
    let px, pz, attempts = 0;
    do {
      const angle = rng.next() * Math.PI * 2;
      const r = minDist + rng.next() * (placeR - minDist);
      px = cx + r * Math.cos(angle);
      pz = cz + r * Math.sin(angle);
      attempts++;
    } while (!pointInPolygon(px, pz, district.vertices) && attempts < 12);

    if (attempts >= 12) continue;

    props.push({
      type: propTypes[Math.floor(rng.next() * propTypes.length)],
      x: px,
      z: pz,
      rotation: rng.next() * Math.PI * 2,
      scale: 0.7 + rng.next() * 0.6,
    });
  }
  return props;
}

// ---------------------------------------------------------------------------
// Road extraction from Voronoi edges
// ---------------------------------------------------------------------------

function extractRoads(cells, sampler) {
  const edgeMap = new Map();

  for (let ci = 0; ci < cells.length; ci++) {
    const verts = cells[ci].vertices;
    if (!verts || verts.length < 2) continue;
    for (let vi = 0; vi < verts.length; vi++) {
      const vj = (vi + 1) % verts.length;
      const a = verts[vi];
      const b = verts[vj];
      // Quantize endpoints to avoid float key issues
      const kax = Math.round(a.x * 1000), kaz = Math.round(a.z * 1000);
      const kbx = Math.round(b.x * 1000), kbz = Math.round(b.z * 1000);
      const keyA = `${kax},${kaz}`, keyB = `${kbx},${kbz}`;
      const ek = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
      const prev = edgeMap.get(ek);
      if (prev) {
        prev.count++;
      } else {
        edgeMap.set(ek, { start: { x: a.x, z: a.z }, end: { x: b.x, z: b.z }, count: 1 });
      }
    }
  }

  // Shared edges (count >= 2) are interior Voronoi edges = roads
  const roads = [];
  for (const edge of edgeMap.values()) {
    if (edge.count >= 2) {
      const length = dist2d(edge.start.x, edge.start.z, edge.end.x, edge.end.z);
      if (length < 0.01) continue; // skip degenerate
      roads.push({
        start: edge.start,
        end: edge.end,
        width: length > 0.3 ? 0.04 : 0.025,
        type: length > 0.3 ? 'main' : 'path',
      });
    }
  }
  return roads;
}

function detectBridges(roads, sampler) {
  const bridges = [];
  for (const road of roads) {
    // Sample midpoint: if water distance is very small, this road segment is a bridge
    const mx = (road.start.x + road.end.x) * 0.5;
    const mz = (road.start.z + road.end.z) * 0.5;
    const waterDist = sampler.getWaterDistance(mx, mz);
    if (waterDist < 0.08) {
      road.type = 'bridge';
      bridges.push({
        start: { x: road.start.x, z: road.start.z },
        end: { x: road.end.x, z: road.end.z },
        width: road.width * 1.3,
      });
    }
  }
  return bridges;
}

// ---------------------------------------------------------------------------
// DistrictSystem
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Deterministic town layout from JSON config
// ---------------------------------------------------------------------------

import { TOWN_LAYOUT } from './town-layout.js';

/**
 * Build a lookup: buildingTypeId → { plotId, slotIndex, x, z }
 * Every building position is fully deterministic from the JSON.
 */
function _buildPositionLookup(layout) {
  const map = new Map(); // typeId → { plotId, slotIndex, x, z }
  for (const plot of layout.plots) {
    // Support both JSON format (plot.x/z) and JS format (plot.center.x/z)
    const cx = plot.center ? plot.center.x : plot.x;
    const cz = plot.center ? plot.center.z : plot.z;
    if (!plot.buildings) continue;
    for (let si = 0; si < plot.buildings.length; si++) {
      const typeId = plot.buildings[si];
      const slot = plot.slots[si]; // use slot at same index
      map.set(typeId, {
        plotId: plot.id,
        slotIndex: si,
        x: cx + slot.dx,
        z: cz + slot.dz,
      });
    }
  }
  return map;
}

const BUILDING_POSITIONS = _buildPositionLookup(TOWN_LAYOUT);

export class DistrictSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.townRadius=2.0] - Radius of the town area
   * @param {number} [options.meshSize=10] - Full mesh size (for bounding rect)
   * @param {number} [options.seed=42] - Seed for Voronoi relaxation (deterministic)
   */
  constructor(options = {}) {
    this._townRadius = options.townRadius ?? 2.0;
    this._meshSize = options.meshSize ?? 10;
    this._seed = options.seed ?? 42;
    this._layout = null;
    this._jsonLayout = null;     // external JSON layout config
    this._positionMap = null;    // instance-level position map from JSON
    this._districts = [];
    this._roads = [];
    this._bridges = [];
    this._plotsOwned = 1;
  }

  /**
   * Set an external layout config (from town-layout.json).
   * Rebuilds the position lookup map and stores the layout for use
   * by getBuildingPosition / getSlotPosition / generate.
   *
   * @param {object} json - Parsed town-layout.json
   */
  setLayout(json) {
    this._jsonLayout = json;
    this._positionMap = _buildPositionLookup(json);
  }

  /**
   * Get the active plot configs — from JSON layout if set, else from town-layout.js.
   * Normalizes the JSON format (plot.x/z) to the internal format (plot.center.x/z).
   * @returns {Array}
   */
  _getPlots() {
    if (this._jsonLayout) {
      return this._jsonLayout.plots.map(p => ({
        ...p,
        center: p.center || { x: p.x, z: p.z },
        buildings: p.buildings || [],
      }));
    }
    return TOWN_LAYOUT.plots;
  }

  /**
   * Generate districts based on current buildings and terrain.
   * All positions come from town-layout.json — no randomization.
   *
   * @param {Array<{typeId:number, level:number, plotIndex:number}>} buildings
   * @param {object} terrainSampler
   * @param {number} plotsOwned - 1 to 5
   * @returns {object} DistrictLayout
   */
  generate(buildings, terrainSampler, plotsOwned) {
    const sampler = terrainSampler || NULL_SAMPLER;
    const plots = Math.max(1, Math.min(5, plotsOwned || 1));
    this._plotsOwned = plots;

    // Town square = centroid of owned plot positions
    const townSquarePos = this.getTownSquarePosition(plots);
    const townCx = townSquarePos.x;
    const townCz = townSquarePos.z;

    // ---- Step 1: Deterministic seed points from layout config ----

    const plotConfigs = this._getPlots();

    // Town square seed at computed centroid
    const seedPoints = [{ x: townCx, z: townCz, typeId: TOWN_SQUARE_ID }];

    // One seed per owned plot center
    for (let p = 0; p < plots; p++) {
      const plotCfg = plotConfigs[p];
      seedPoints.push({
        x: plotCfg.center.x,
        z: plotCfg.center.z,
        typeId: plotCfg.buildings[0] ?? TOWN_SQUARE_ID,
      });
    }

    // ---- Step 2: Voronoi + Lloyd relaxation (3 passes) ----
    const halfMs = this._meshSize * 0.5;
    const boundRect = { minX: -halfMs, minZ: -halfMs, maxX: halfMs, maxZ: halfMs };

    let voronoiSeeds = seedPoints.map(s => ({ x: s.x, z: s.z }));
    let cells = buildVoronoi(voronoiSeeds, boundRect);

    for (let iter = 0; iter < 3; iter++) {
      for (let c = 0; c < cells.length; c++) {
        if (cells[c].vertices.length < 3) continue;
        const centroid = polygonCentroid(cells[c].vertices);
        voronoiSeeds[c] = {
          x: Math.max(boundRect.minX * 0.95, Math.min(boundRect.maxX * 0.95, centroid.x)),
          z: Math.max(boundRect.minZ * 0.95, Math.min(boundRect.maxZ * 0.95, centroid.z)),
        };
      }
      cells = buildVoronoi(voronoiSeeds, boundRect);
    }

    // ---- Step 3: Build district data ----

    const rng = new SeededRandom(this._seed);
    const districts = [];
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const typeId = i < seedPoints.length ? seedPoints[i].typeId : TOWN_SQUARE_ID;
      const ground = DISTRICT_GROUND[typeId] || DISTRICT_GROUND[TOWN_SQUARE_ID];
      const verts = cell.vertices && cell.vertices.length >= 3
        ? cell.vertices
        : fallbackCell(voronoiSeeds[i], this._townRadius * 0.2);

      const district = {
        id: i,
        buildingType: typeId,
        center: { x: voronoiSeeds[i].x, z: voronoiSeeds[i].z },
        vertices: verts,
        area: polygonArea(verts),
        groundType: ground.type,
        groundColor: ground.color.clone(),
        props: [],
      };

      district.props = generateProps(district, rng);
      districts.push(district);
    }

    // ---- Step 4: Roads + bridges ----

    const roads = extractRoads(cells, sampler);
    const bridges = detectBridges(roads, sampler);

    for (const road of roads) {
      const dStart = dist2d(road.start.x, road.start.z, townCx, townCz);
      const dEnd = dist2d(road.end.x, road.end.z, townCx, townCz);
      if (dStart < this._townRadius * 0.25 || dEnd < this._townRadius * 0.25) {
        if (road.type !== 'bridge') {
          road.type = 'main';
          road.width = Math.max(road.width, 0.04);
        }
      }
    }

    // ---- Step 5: Store and return layout ----

    this._districts = districts;
    this._roads = roads;
    this._bridges = bridges;
    this._seedPoints = seedPoints;
    this._voronoiSeeds = voronoiSeeds;

    this._layout = { districts, roads, bridges };
    return this._layout;
  }

  /**
   * Get district at a world position.
   * @param {number} x
   * @param {number} z
   * @returns {{ districtId: number, buildingType: number, blendFactor: number }|null}
   */
  getDistrictAt(x, z) {
    if (!this._districts.length) return null;

    // Find nearest district center
    let nearestId = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < this._districts.length; i++) {
      const d = dist2d(x, z, this._districts[i].center.x, this._districts[i].center.z);
      if (d < nearestDist) {
        nearestDist = d;
        nearestId = i;
      }
    }

    // Also check point-in-polygon for accuracy
    for (let i = 0; i < this._districts.length; i++) {
      if (this._districts[i].vertices.length >= 3 && pointInPolygon(x, z, this._districts[i].vertices)) {
        nearestId = i;
        nearestDist = dist2d(x, z, this._districts[i].center.x, this._districts[i].center.z);
        break;
      }
    }

    const district = this._districts[nearestId];

    // Compute blend factor: 0 at center, 1 at edge
    let maxEdgeDist = 0;
    for (const v of district.vertices) {
      const ed = dist2d(v.x, v.z, district.center.x, district.center.z);
      if (ed > maxEdgeDist) maxEdgeDist = ed;
    }
    const blendFactor = maxEdgeDist > 0.001 ? Math.min(1, nearestDist / maxEdgeDist) : 0;

    return {
      districtId: district.id,
      buildingType: district.buildingType,
      blendFactor,
    };
  }

  /**
   * Get ground material parameters at a position with inter-district blending.
   * @param {number} x
   * @param {number} z
   * @returns {{ color: THREE.Color, roughness: number, type: string, blendFactors: object }}
   */
  getGroundParams(x, z) {
    if (!this._districts.length) {
      return {
        color: new THREE.Color(0x888888),
        roughness: 0.8,
        type: 'default',
        blendFactors: {},
      };
    }

    let totalWeight = 0;
    const blendedColor = new THREE.Color(0, 0, 0);
    let blendedRoughness = 0;
    const blendFactors = {};
    let dominantType = 'default';
    let dominantWeight = 0;
    const tempColor = new THREE.Color();

    for (const district of this._districts) {
      const d = dist2d(x, z, district.center.x, district.center.z);
      const weight = 1.0 / (d * d + 0.01);

      tempColor.copy(district.groundColor);
      tempColor.multiplyScalar(weight);
      blendedColor.add(tempColor);

      const ground = DISTRICT_GROUND[district.buildingType] || DISTRICT_GROUND[TOWN_SQUARE_ID];
      blendedRoughness += ground.roughness * weight;
      totalWeight += weight;
      blendFactors[district.id] = weight;

      if (weight > dominantWeight) {
        dominantWeight = weight;
        dominantType = ground.type;
      }
    }

    if (totalWeight > 0) {
      const inv = 1.0 / totalWeight;
      blendedColor.multiplyScalar(inv);
      blendedRoughness *= inv;
      for (const key in blendFactors) {
        blendFactors[key] *= inv;
      }
    }

    return {
      color: blendedColor,
      roughness: blendedRoughness,
      type: dominantType,
      blendFactors,
    };
  }

  /**
   * Get the current district layout.
   * @returns {object|null} DistrictLayout
   */
  getLayout() {
    return this._layout;
  }

  /**
   * Get building placement position from the deterministic layout config.
   * @param {number} typeId - Building type (0-12)
   * @param {number} plotIndex - Plot index (0-4)
   * @returns {{ x: number, z: number }|null}
   */
  getBuildingPosition(typeId, plotIndex) {
    // Primary: look up exact position from instance map (JSON) or module-level map
    const posMap = this._positionMap || BUILDING_POSITIONS;
    const entry = posMap.get(typeId);
    if (entry) {
      return { x: entry.x, z: entry.z };
    }

    // Fallback for unknown types: use plot center + slot offset from config
    const plotConfigs = this._getPlots();
    const plotCfg = plotConfigs[plotIndex];
    if (plotCfg) {
      const slot = plotCfg.slots[0];
      return {
        x: plotCfg.center.x + slot.dx,
        z: plotCfg.center.z + slot.dz,
      };
    }
    return null;
  }

  /**
   * Get building position by slot index (buildingIndex % 4) within a plot.
   * @param {number} plotIndex - Plot index (0-4)
   * @param {number} slotIndex - Slot within plot (0-3)
   * @returns {{ x: number, z: number }|null}
   */
  getSlotPosition(plotIndex, slotIndex) {
    const plotConfigs = this._getPlots();
    const plotCfg = plotConfigs[plotIndex];
    if (!plotCfg) return null;
    const slot = plotCfg.slots[slotIndex] || plotCfg.slots[0];
    return {
      x: plotCfg.center.x + slot.dx,
      z: plotCfg.center.z + slot.dz,
    };
  }

  /**
   * Get road network edges from district boundaries.
   * @returns {Array<{ start: {x:number,z:number}, end: {x:number,z:number}, width: number }>}
   */
  getRoadEdges() {
    return this._roads.map(r => ({
      start: { x: r.start.x, z: r.start.z },
      end: { x: r.end.x, z: r.end.z },
      width: r.width,
    }));
  }

  /**
   * Get district boundary vertices for debug/display.
   * @returns {Array<{ districtId: number, vertices: Array<{x:number,z:number}> }>}
   */
  getDistrictBoundaries() {
    return this._districts.map(d => ({
      districtId: d.id,
      vertices: d.vertices.map(v => ({ x: v.x, z: v.z })),
    }));
  }

  /**
   * Get the bounding rect of all active (owned) plot areas + padding.
   * @param {number} [plotsOwned] - defaults to last generate() value
   * @returns {{ minX: number, maxX: number, minZ: number, maxZ: number }}
   */
  getActiveBounds(plotsOwned) {
    const plots = Math.max(1, Math.min(5, plotsOwned ?? this._plotsOwned));
    const plotConfigs = this._getPlots();
    const padding = 3.0;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < plots; i++) {
      const pc = plotConfigs[i].center;
      if (pc.x < minX) minX = pc.x;
      if (pc.x > maxX) maxX = pc.x;
      if (pc.z < minZ) minZ = pc.z;
      if (pc.z > maxZ) maxZ = pc.z;
    }
    return {
      minX: minX - padding,
      maxX: maxX + padding,
      minZ: minZ - padding,
      maxZ: maxZ + padding,
    };
  }

  /**
   * Get the town square position (centroid of owned plot cascade positions).
   * @param {number} [plotsOwned] - defaults to last generate() value
   * @returns {{ x: number, z: number }}
   */
  getTownSquarePosition(plotsOwned) {
    const plots = Math.max(1, Math.min(5, plotsOwned ?? this._plotsOwned));
    const plotConfigs = this._getPlots();
    let sx = 0, sz = 0;
    for (let i = 0; i < plots; i++) {
      sx += plotConfigs[i].center.x;
      sz += plotConfigs[i].center.z;
    }
    return { x: sx / plots, z: sz / plots };
  }

  /**
   * Check if a world position is within an active (owned) district.
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  isInActiveDistrict(x, z) {
    if (!this._districts.length) return false;
    for (const district of this._districts) {
      if (district.vertices.length >= 3 && pointInPolygon(x, z, district.vertices)) {
        return true;
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers (private)
// ---------------------------------------------------------------------------

function fallbackCell(center, radius) {
  const verts = [];
  const sides = 6;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    verts.push({ x: center.x + radius * Math.cos(a), z: center.z + radius * Math.sin(a) });
  }
  return verts;
}
