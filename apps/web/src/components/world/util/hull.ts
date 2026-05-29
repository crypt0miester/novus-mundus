/**
 * Convex hull (Andrew's monotone chain) + Catmull–Rom smoothing.
 *
 * Used by RealmMap to draw a soft, hand-drawn "kingdom shape" enclosing the
 * scattered cities — gives the parchment a sense of *territory* without needing
 * a real geographic landmass.
 */

export interface Pt {
  x: number;
  y: number;
}

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Lower-then-upper hull. Returns CCW polygon, no repeated first/last point. */
export function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;

  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Inflate a polygon outward along the centroid->vertex direction. Cheap
 * approximation of true offsetting — fine for a decorative ink wash.
 */
export function inflate(poly: Pt[], delta: number): Pt[] {
  if (poly.length === 0) return poly;
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  return poly.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * delta, y: p.y + (dy / len) * delta };
  });
}

/**
 * Catmull–Rom to cubic Bezier SVG path string for a closed polygon. Tension
 * `t` ∈ [0, 1]; lower is rounder. 0.5 reads as a hand-drawn flowing outline.
 */
export function smoothClosedPath(poly: Pt[], t = 0.5): string {
  if (poly.length === 0) return "";
  if (poly.length < 3) {
    return `M ${poly.map((p) => `${p.x} ${p.y}`).join(" L ")} Z`;
  }
  const n = poly.length;
  const get = (i: number) => poly[((i % n) + n) % n]!;

  let d = `M ${get(0).x} ${get(0).y}`;
  for (let i = 0; i < n; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const c1x = p1.x + (p2.x - p0.x) * (t / 6);
    const c1y = p1.y + (p2.y - p0.y) * (t / 6);
    const c2x = p2.x - (p3.x - p1.x) * (t / 6);
    const c2y = p2.y - (p3.y - p1.y) * (t / 6);
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return `${d} Z`;
}
