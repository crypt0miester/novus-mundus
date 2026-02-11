/**
 * Shared utility functions for the terrain renderer system.
 */

import * as THREE from 'three';
import { DEG } from './constants.js';

/**
 * Convert lat/lon to Vec3 aligned with Three.js SphereGeometry UV.
 *
 *   x =  R * cos(lon) * cos(lat)
 *   y =  R * sin(lat)
 *   z = -R * sin(lon) * cos(lat)
 */
export function latLonToVec3(lat, lon, radius) {
  const latR = lat * DEG;
  const lonR = lon * DEG;
  const cosLat = Math.cos(latR);
  return new THREE.Vector3(
    radius * Math.cos(lonR) * cosLat,
    radius * Math.sin(latR),
    -radius * Math.sin(lonR) * cosLat
  );
}

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Create and position a mesh (shadow-friendly helper) */
export function mk(geom, mat, x, y, z, rx, ry, rz) {
  const m = new THREE.Mesh(geom, mat);
  if (x != null) m.position.set(x, y || 0, z || 0);
  if (rx != null) m.rotation.x = rx;
  if (ry != null) m.rotation.y = ry;
  if (rz != null) m.rotation.z = rz;
  return m;
}
