/**
 * Simplify Natural Earth 50m land polygons into a compact land outline for the
 * web realm map. Drops tiny islands, Douglas-Peucker simplifies each outer
 * ring, rounds coords, and writes a small `world-land.json` the RealmMap
 * imports and projects equirectangular.
 *
 * Run once: `bun run terrain-builder/simplify-coastlines.ts`
 */
import * as fs from "fs";
import * as path from "path";

type Pt = [number, number]; // [lon, lat]

const SRC = path.join(__dirname, "data", "coastlines-50m.json");
const OUT = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "apps",
  "web",
  "src",
  "components",
  "world",
  "data",
  "world-land.json",
);

// Tuning: tolerance is in degrees (world scale), so 0.35° drops sub-pixel
// wiggle at the realm-map viewBox. Min-extent drops islands smaller than a few
// degrees so the silhouette stays clean and small.
const TOLERANCE_DEG = 0.35;
const MIN_RING_POINTS = 12;
const MIN_BBOX_DEG = 2.5;
// Drop Antarctica / south-pole land: any ring whose northernmost point is below
// this latitude is discarded (no cities there, and it just smears the bottom).
const DROP_ABOVE_SOUTH_OF = -55;

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Iterative Douglas-Peucker (avoids deep recursion on long rings).
function simplify(points: Pt[], tol: number): Pt[] {
  if (points.length < 3) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDist(points[i]!, points[lo]!, points[hi]!);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx !== -1) {
      keep[idx] = true;
      stack.push([lo, idx], [idx, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function bboxSpan(ring: Pt[]): number {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return Math.max(maxLon - minLon, maxLat - minLat);
}

const src = JSON.parse(fs.readFileSync(SRC, "utf8")) as {
  features: { geometry: { type: string; coordinates: unknown } }[];
};

const rings: Pt[][] = [];

function addPolygon(poly: Pt[][]) {
  // poly[0] is the outer ring; holes (lakes) are skipped for a land silhouette.
  const outer = poly[0];
  if (!outer || outer.length < MIN_RING_POINTS) return;
  if (bboxSpan(outer) < MIN_BBOX_DEG) return;
  // Skip south-pole land (Antarctica): the whole ring sits below the cutoff.
  let maxLat = -Infinity;
  for (const [, lat] of outer) if (lat > maxLat) maxLat = lat;
  if (maxLat < DROP_ABOVE_SOUTH_OF) return;
  const simplified = simplify(outer, TOLERANCE_DEG).map(
    ([lon, lat]) => [Math.round(lon * 100) / 100, Math.round(lat * 100) / 100] as Pt,
  );
  if (simplified.length >= 4) rings.push(simplified);
}

for (const f of src.features) {
  const g = f.geometry;
  if (g.type === "Polygon") {
    addPolygon(g.coordinates as Pt[][]);
  } else if (g.type === "MultiPolygon") {
    for (const poly of g.coordinates as Pt[][][]) addPolygon(poly);
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ rings }));

const totalPts = rings.reduce((n, r) => n + r.length, 0);
const sizeKb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`Wrote ${rings.length} land rings, ${totalPts} points, ${sizeKb} KB -> ${OUT}`);
