/**
 * Town building geometry factory — procedural 3D meshes for 13 building types.
 */

import * as THREE from 'three';
import { BUILDING_TYPES, SLOT_OFFSETS, DEG } from '../core/constants.js';
import { mk } from '../core/utils.js';

/**
 * Create a procedural 3D mesh group for a building type at a given level.
 * @param {number} typeId - Building type index (0-12)
 * @param {number} level - Building level (1-20)
 * @param {object|null} layout - Town layout config (for buildingScale)
 * @returns {THREE.Group|null}
 */
export function createBuildingMesh(typeId, level, layout) {
  const bt = BUILDING_TYPES[typeId];
  if (!bt) return null;
  const g = new THREE.Group();
  const bs = layout ? layout.buildingScale : null;
  const levelScale = bs ? bs.levelScaleFactor : 0.055;
  const s = 1 + Math.max(0, level - 1) * levelScale;
  const bodyMat = new THREE.MeshStandardMaterial({ color: bt.color, roughness: 0.7, metalness: 0.05 });
  const roofMat = new THREE.MeshStandardMaterial({ color: bt.roof, roughness: 0.5, metalness: 0.1 });
  const w = bs ? bs.baseUnit : 0.05;

  switch (typeId) {
    case 0: { // Mansion
      const bh = 0.08 * s;
      const body = mk(new THREE.BoxGeometry(w * 2.2, bh, w * 1.8), bodyMat, 0, bh / 2, 0);
      body.castShadow = true; body.receiveShadow = true; g.add(body);
      const rh = 0.05 * s;
      const shape = new THREE.Shape();
      shape.moveTo(-w * 1.2, 0); shape.lineTo(0, rh); shape.lineTo(w * 1.2, 0); shape.closePath();
      const roof = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, { depth: w * 1.8, bevelEnabled: false }), roofMat);
      roof.position.set(0, bh, -w * 0.9);
      roof.castShadow = true; g.add(roof);
      const winMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });
      for (const wx of [-0.4, 0.4]) {
        g.add(mk(new THREE.BoxGeometry(0.015, 0.02, 0.002), winMat, wx * w, bh * 0.55, w * 0.91));
      }
      g.add(mk(new THREE.BoxGeometry(0.02, 0.035, 0.002),
        new THREE.MeshStandardMaterial({ color: 0x6b4420 }), 0, 0.02, w * 0.91));
      if (level >= 3) {
        const chimney = mk(new THREE.BoxGeometry(0.02, 0.05, 0.02),
          new THREE.MeshStandardMaterial({ color: 0x665555, roughness: 0.8 }),
          w * 0.6, bh + rh * 0.4, -w * 0.3);
        chimney.castShadow = true; g.add(chimney);
      }
      break;
    }
    case 1: { // Barracks
      const bh = 0.06 * s;
      const body = mk(new THREE.BoxGeometry(w * 2.6, bh, w * 1.4), bodyMat, 0, bh / 2, 0);
      body.castShadow = true; body.receiveShadow = true; g.add(body);
      g.add(mk(new THREE.BoxGeometry(w * 2.8, 0.008, w * 1.6), roofMat, 0, bh, 0));
      for (let cx = -3; cx <= 3; cx++) {
        g.add(mk(new THREE.BoxGeometry(0.012, 0.012, w * 1.4),
          bodyMat, cx * 0.018, bh + 0.014, 0));
      }
      g.add(mk(new THREE.CylinderGeometry(0.003, 0.003, 0.1, 4),
        new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.5 }),
        w * 1.1, bh + 0.05, -w * 0.5));
      g.add(mk(new THREE.BoxGeometry(0.03, 0.018, 0.002),
        new THREE.MeshBasicMaterial({ color: 0xcc2222 }),
        w * 1.1 + 0.016, bh + 0.09, -w * 0.5));
      break;
    }
    case 2: { // Workshop
      const bh = 0.07 * s;
      const body = mk(new THREE.BoxGeometry(w * 2, bh, w * 1.8), bodyMat, 0, bh / 2, 0);
      body.castShadow = true; body.receiveShadow = true; g.add(body);
      g.add(mk(new THREE.BoxGeometry(w * 2.2, 0.006, w * 2), roofMat, 0, bh, 0));
      const chimney = mk(new THREE.CylinderGeometry(0.015, 0.02, 0.06, 6),
        new THREE.MeshStandardMaterial({ color: 0x555555 }), -w * 0.6, bh + 0.03, 0);
      chimney.castShadow = true; g.add(chimney);
      g.add(mk(new THREE.TorusGeometry(0.03, 0.005, 6, 10),
        new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.7 }),
        w * 1.05, 0.03, w * 0.5, 0, 0, Math.PI / 6));
      break;
    }
    case 3: { // Vault
      const bh = 0.06 * s;
      const body = mk(new THREE.CylinderGeometry(w * 0.9, w * 1.1, bh, 10), bodyMat, 0, bh / 2, 0);
      body.castShadow = true; body.receiveShadow = true; g.add(body);
      g.add(mk(new THREE.SphereGeometry(w * 0.95, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: bt.roof, roughness: 0.3, metalness: 0.5 }),
        0, bh, 0));
      for (let i = 1; i <= 2; i++) {
        g.add(mk(new THREE.TorusGeometry(w * 1.0 + 0.002, 0.004, 4, 12),
          new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.6 }),
          0, bh * i / 3, 0, Math.PI / 2));
      }
      break;
    }
    case 4: { // Dock
      const bh = 0.03 * s;
      const body = mk(new THREE.BoxGeometry(w * 2, bh, w * 1.4), bodyMat, 0, bh / 2, 0);
      body.castShadow = true; g.add(body);
      const plankMat = new THREE.MeshStandardMaterial({ color: 0xa08050, roughness: 0.8 });
      g.add(mk(new THREE.BoxGeometry(w * 0.8, 0.01, w * 2.5), plankMat, 0, bh * 0.6, w * 1.5));
      for (const bx of [-0.3, 0.3]) {
        g.add(mk(new THREE.CylinderGeometry(0.006, 0.008, 0.04, 5),
          new THREE.MeshStandardMaterial({ color: 0x6b5030 }),
          bx * w, bh + 0.02, w * 2.2));
      }
      g.add(mk(new THREE.BoxGeometry(w * 0.7, 0.04, w * 0.6), bodyMat, -w * 0.5, bh + 0.02, -w * 0.2));
      g.add(mk(new THREE.BoxGeometry(w * 0.8, 0.005, w * 0.7), roofMat, -w * 0.5, bh + 0.042, -w * 0.2));
      break;
    }
    case 5: { // Forge
      const bh = 0.07 * s;
      const body = mk(new THREE.BoxGeometry(w * 2, bh, w * 1.8), bodyMat, 0, bh / 2, 0);
      body.castShadow = true; body.receiveShadow = true; g.add(body);
      g.add(mk(new THREE.BoxGeometry(w * 2.2, 0.006, w * 2), roofMat, 0, bh, 0));
      const ch = 0.12 * s;
      const chimney = mk(new THREE.CylinderGeometry(0.018, 0.025, ch, 6),
        new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.3 }),
        -w * 0.6, bh + ch / 2, -w * 0.5);
      chimney.castShadow = true; g.add(chimney);
      g.add(mk(new THREE.SphereGeometry(0.015, 6, 4),
        new THREE.MeshBasicMaterial({ color: 0xff5500 }),
        -w * 0.6, bh + ch + 0.005, -w * 0.5));
      g.add(mk(new THREE.BoxGeometry(0.02, 0.015, 0.015),
        new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7 }),
        w * 0.5, 0.012, w * 0.4));
      g.add(mk(new THREE.BoxGeometry(0.03, 0.03, 0.002),
        new THREE.MeshBasicMaterial({ color: 0xff4400 }),
        0, 0.025, w * 0.91));
      break;
    }
    case 6: { // Market
      const bh = 0.07 * s;
      const postMat = new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.7 });
      for (const [px, pz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
        const post = mk(new THREE.CylinderGeometry(0.006, 0.006, bh, 5),
          postMat, px * w * 0.85, bh / 2, pz * w * 0.7);
        post.castShadow = true; g.add(post);
      }
      const canopy = mk(new THREE.BoxGeometry(w * 2.2, 0.005, w * 1.8), roofMat, 0, bh, 0);
      canopy.castShadow = true; g.add(canopy);
      g.add(mk(new THREE.BoxGeometry(w * 2.4, 0.01, 0.005),
        new THREE.MeshBasicMaterial({ color: 0xffeedd }),
        0, bh - 0.005, w * 0.9));
      g.add(mk(new THREE.BoxGeometry(w * 1.6, 0.02, w * 0.4),
        new THREE.MeshStandardMaterial({ color: 0x9a7a50 }),
        0, 0.025, w * 0.35));
      for (const bx of [-0.5, 0.5]) {
        g.add(mk(new THREE.CylinderGeometry(0.012, 0.014, 0.025, 8),
          new THREE.MeshStandardMaterial({ color: 0x7a5a30 }),
          bx * w, 0.015, -w * 0.5));
      }
      break;
    }
    case 7: { // Academy
      const bh = 0.11 * s;
      const body = mk(new THREE.BoxGeometry(w * 1.4, bh, w * 1.4), bodyMat, 0, bh / 2, 0);
      body.castShadow = true; body.receiveShadow = true; g.add(body);
      g.add(mk(new THREE.SphereGeometry(w * 0.85, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        roofMat, 0, bh, 0));
      const winMat = new THREE.MeshBasicMaterial({ color: 0x6688cc });
      for (const [wx, wz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        g.add(mk(new THREE.BoxGeometry(wx ? 0.002 : 0.018, 0.03, wz ? 0.002 : 0.018),
          winMat, wx * w * 0.71, bh * 0.6, wz * w * 0.71));
      }
      break;
    }
    case 8: { // Arena
      const bh = 0.05 * s;
      const outer = w * 1.2;
      const wall = mk(new THREE.CylinderGeometry(outer, outer * 1.05, bh, 20, 1, true),
        bodyMat, 0, bh / 2, 0);
      wall.castShadow = true; g.add(wall);
      g.add(mk(new THREE.CircleGeometry(outer * 0.7, 16),
        new THREE.MeshStandardMaterial({ color: 0xc8a878, roughness: 0.9 }),
        0, 0.004, 0, -Math.PI / 2));
      g.add(mk(new THREE.TorusGeometry(outer * 0.85, 0.008, 4, 20), roofMat, 0, bh * 0.5, 0, Math.PI / 2));
      g.add(mk(new THREE.TorusGeometry(outer, 0.006, 4, 20), roofMat, 0, bh, 0, Math.PI / 2));
      g.add(mk(new THREE.BoxGeometry(0.025, bh * 0.8, 0.015),
        new THREE.MeshStandardMaterial({ color: 0x555544, metalness: 0.4 }),
        0, bh * 0.4, outer));
      break;
    }
    case 9: { // Sanctuary
      const bh = 0.07 * s;
      const body = mk(new THREE.CylinderGeometry(w * 0.9, w * 1.1, bh, 8), bodyMat, 0, bh / 2, 0);
      body.castShadow = true; body.receiveShadow = true; g.add(body);
      const sh = 0.1 * s;
      const spire = mk(new THREE.ConeGeometry(w * 0.5, sh, 8), roofMat, 0, bh + sh / 2, 0);
      spire.castShadow = true; g.add(spire);
      g.add(mk(new THREE.OctahedronGeometry(0.012), new THREE.MeshBasicMaterial({ color: 0xcc88ff }), 0, bh + sh + 0.01, 0));
      for (let a = 0; a < 6; a++) {
        const angle = (a / 6) * Math.PI * 2;
        g.add(mk(new THREE.SphereGeometry(0.008, 4, 3),
          new THREE.MeshStandardMaterial({ color: 0x999999 }),
          Math.sin(angle) * w * 1.5, 0.006, Math.cos(angle) * w * 1.5));
      }
      break;
    }
    case 10: { // Observatory
      const bh = 0.1 * s;
      const body = mk(new THREE.CylinderGeometry(w * 0.75, w * 0.95, bh, 10), bodyMat, 0, bh / 2, 0);
      body.castShadow = true; body.receiveShadow = true; g.add(body);
      const dome = mk(new THREE.SphereGeometry(w * 0.8, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: bt.roof, roughness: 0.3, metalness: 0.4 }),
        0, bh, 0);
      dome.castShadow = true; g.add(dome);
      g.add(mk(new THREE.BoxGeometry(0.008, w * 0.7, 0.008),
        new THREE.MeshBasicMaterial({ color: 0x88ccff }),
        w * 0.75, bh + w * 0.3, 0));
      g.add(mk(new THREE.CylinderGeometry(0.005, 0.008, 0.04, 6),
        new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.5 }),
        w * 0.6, bh + w * 0.5, 0, 0, 0, Math.PI / 4));
      break;
    }
    case 11: { // Treasury
      const bh = 0.08 * s;
      const body = mk(new THREE.BoxGeometry(w * 2, bh, w * 1.6), bodyMat, 0, bh / 2, 0);
      body.castShadow = true; body.receiveShadow = true; g.add(body);
      const rh = 0.04 * s;
      const shape = new THREE.Shape();
      shape.moveTo(-w * 1.1, 0); shape.lineTo(0, rh); shape.lineTo(w * 1.1, 0); shape.closePath();
      const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: w * 1.6, bevelEnabled: false });
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.position.set(0, bh, -w * 0.8);
      roof.castShadow = true; g.add(roof);
      const colMat = new THREE.MeshStandardMaterial({ color: 0xeeeecc, roughness: 0.4, metalness: 0.1 });
      for (const cx of [-0.7, -0.23, 0.23, 0.7]) {
        const col = mk(new THREE.CylinderGeometry(0.008, 0.01, bh, 8), colMat, cx * w, bh / 2, w * 0.82);
        col.castShadow = true; g.add(col);
      }
      g.add(mk(new THREE.SphereGeometry(0.01, 6, 4),
        new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8, roughness: 0.2 }),
        0, bh + rh * 0.7, w * 0.1));
      break;
    }
    case 12: { // Citadel
      const bh = 0.12 * s;
      const body = mk(new THREE.BoxGeometry(w * 1.6, bh, w * 1.6), bodyMat, 0, bh / 2, 0);
      body.castShadow = true; body.receiveShadow = true; g.add(body);
      const th = bh * 1.25;
      for (const [tx, tz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
        const turret = mk(new THREE.CylinderGeometry(0.018, 0.022, th, 8),
          bodyMat, tx * w * 0.9, th / 2, tz * w * 0.9);
        turret.castShadow = true; g.add(turret);
        g.add(mk(new THREE.ConeGeometry(0.024, 0.03, 8), roofMat,
          tx * w * 0.9, th + 0.015, tz * w * 0.9));
      }
      g.add(mk(new THREE.BoxGeometry(w * 1.7, 0.01, w * 1.7), roofMat, 0, bh, 0));
      if (level >= 8) {
        const ct = mk(new THREE.CylinderGeometry(0.015, 0.018, bh * 0.5, 8),
          bodyMat, 0, bh + bh * 0.25, 0);
        ct.castShadow = true; g.add(ct);
        g.add(mk(new THREE.ConeGeometry(0.02, 0.025, 8), roofMat, 0, bh * 1.52, 0));
      }
      g.add(mk(new THREE.BoxGeometry(0.03, 0.04, 0.005),
        new THREE.MeshStandardMaterial({ color: 0x5a4a3a, metalness: 0.3 }),
        0, 0.025, w * 0.81));
      break;
    }
  }

  // Selection ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(w * 1.5, w * 1.7, 20),
    new THREE.MeshBasicMaterial({ color: 0xffdd00, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002;
  ring.visible = false; ring.name = 'select-ring';
  g.add(ring);

  return g;
}

/**
 * Place a building mesh in a plot slot.
 * @param {object} ctx - { plotGroups, buildingMeshes, layout }
 * @param {number} plotIdx
 * @param {number} slotIdx
 * @param {number} typeId
 * @param {number} level
 */
export function placeBuildingMesh(ctx, plotIdx, slotIdx, typeId, level) {
  const key = `${plotIdx}_${slotIdx}`;
  const old = ctx.buildingMeshes.get(key);
  if (old) {
    ctx.plotGroups[plotIdx]?.remove(old);
    old.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  const mesh = createBuildingMesh(typeId, level, ctx.layout);
  if (!mesh) return;
  const plotCfg = ctx.layout && ctx.layout.plots && ctx.layout.plots[plotIdx] ? ctx.layout.plots[plotIdx] : null;
  const slotDefs = plotCfg && plotCfg.slots ? plotCfg.slots : SLOT_OFFSETS;
  const so = slotDefs[slotIdx] || SLOT_OFFSETS[slotIdx];
  mesh.position.set(so.dx, 0.018, so.dz);
  if (so.rotation) mesh.rotation.y = so.rotation * DEG;
  mesh.userData = { plotIdx, slotIdx, type: 'building', buildingType: typeId };
  ctx.plotGroups[plotIdx]?.add(mesh);
  ctx.buildingMeshes.set(key, mesh);
}

/**
 * Refresh all buildings from estate state.
 * @param {object} ctx - { plotGroups, buildingMeshes, estateState, layout }
 */
export function refreshAllBuildings(ctx) {
  for (const [key, mesh] of ctx.buildingMeshes) {
    const plotIdx = parseInt(key.split('_')[0]);
    const pg = ctx.plotGroups[plotIdx];
    if (pg) pg.remove(mesh);
    mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  ctx.buildingMeshes.clear();
  if (!ctx.estateState) return;
  for (let p = 0; p < 5; p++) {
    for (let s = 0; s < 4; s++) {
      const b = ctx.estateState.buildings[p * 4 + s];
      if (b && b.type >= 0 && b.status > 0) placeBuildingMesh(ctx, p, s, b.type, b.level);
    }
  }
}
