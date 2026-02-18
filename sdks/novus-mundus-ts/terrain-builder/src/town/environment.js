/**
 * Town environment — town square, trees, decorations, walls, grid overlay.
 */

import * as THREE from 'three';
import { DEG, SLOT_OFFSETS } from '../core/constants.js';
import { mk } from '../core/utils.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/**
 * Build the town square (plaza, fountain, roads, lamp posts).
 * @param {THREE.Group} parent - Parent group to add to
 * @param {object} ctx - { layout, plotPositions }
 * @returns {THREE.Group} The town square group
 */
export function buildTownSquare(parent, ctx) {
  const g = new THREE.Group(); g.name = 'town-square';
  const L = ctx.layout;
  const ts = L ? L.townSquare : null;
  const rd = L ? L.roads : null;

  const stoneColor = ts ? ts.stoneColor : 0xa09880;
  const radius = ts ? ts.radius : 0.4;
  const innerR = ts ? ts.innerRingRadius : [0.28, 0.32];
  const lampCount = ts ? ts.lampPostCount : 4;
  const lampRadius = ts ? ts.lampPostRadius : 0.32;
  const lampColor = ts ? ts.lampColor : 0xffeeaa;
  const fountainScale = ts ? ts.fountainScale : 1.0;
  const tsX = ts ? (ts.x || 0) : 0;
  const tsZ = ts ? (ts.z || 0) : 0;

  const stoneMat = new THREE.MeshStandardMaterial({ color: stoneColor, roughness: 0.8 });

  // Cobblestone plaza
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), stoneMat);
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.008;
  plaza.receiveShadow = true;
  g.add(plaza);

  // Inner ring decoration
  const innerRing = new THREE.Mesh(
    new THREE.RingGeometry(innerR[0], innerR[1], 32),
    new THREE.MeshStandardMaterial({ color: 0x8a7a68, roughness: 0.7 })
  );
  innerRing.rotation.x = -Math.PI / 2; innerRing.position.y = 0.009;
  g.add(innerRing);

  // Fountain
  const fs = fountainScale;
  const fountainMat = new THREE.MeshStandardMaterial({ color: 0x888880, roughness: 0.5, metalness: 0.2 });
  g.add(mk(new THREE.CylinderGeometry(0.08 * fs, 0.1 * fs, 0.06 * fs, 12), fountainMat, 0, 0.04 * fs, 0));
  g.add(mk(new THREE.CylinderGeometry(0.05 * fs, 0.06 * fs, 0.04 * fs, 10), fountainMat, 0, 0.04 * fs + 0.05 * fs, 0));
  g.add(mk(new THREE.CircleGeometry(0.075 * fs, 12),
    new THREE.MeshStandardMaterial({ color: 0x4499cc, roughness: 0.1, metalness: 0.4 }),
    0, 0.065 * fs, 0, -Math.PI / 2));
  g.add(mk(new THREE.CylinderGeometry(0.012 * fs, 0.015 * fs, 0.08 * fs, 6), fountainMat, 0, 0.12 * fs, 0));
  g.add(mk(new THREE.CylinderGeometry(0.025 * fs, 0.018 * fs, 0.015 * fs, 8),
    new THREE.MeshStandardMaterial({ color: 0x777770, roughness: 0.4, metalness: 0.3 }),
    0, 0.17 * fs, 0));

  // Roads to each plot
  const roadColor = rd ? rd.color : 0x9a9080;
  const roadWidth = rd ? rd.width : 0.08;
  const roadHeight = rd ? rd.height : 0.003;
  const roadMat = new THREE.MeshStandardMaterial({ color: roadColor, roughness: 0.85 });
  for (let p = 0; p < ctx.plotPositions.length; p++) {
    const pp = ctx.plotPositions[p];
    const dx = pp.x - tsX, dz = pp.z - tsZ;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.2) continue;
    const angle = Math.atan2(dx, dz);
    const roadLen = len - 0.5;
    const road = new THREE.Mesh(new THREE.BoxGeometry(roadWidth, roadHeight, roadLen), roadMat);
    road.position.set(
      tsX + Math.sin(angle) * (0.38 + roadLen / 2),
      0.007,
      tsZ + Math.cos(angle) * (0.38 + roadLen / 2)
    );
    road.rotation.y = angle;
    road.receiveShadow = true;
    g.add(road);
  }

  // Lamp posts
  const postMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.3, metalness: 0.6 });
  for (let i = 0; i < lampCount; i++) {
    const a = (i / lampCount) * Math.PI * 2;
    const px = Math.sin(a) * lampRadius, pz = Math.cos(a) * lampRadius;
    g.add(mk(new THREE.CylinderGeometry(0.006, 0.008, 0.14, 6), postMat, px, 0.08, pz));
    g.add(mk(new THREE.SphereGeometry(0.015, 6, 4),
      new THREE.MeshBasicMaterial({ color: lampColor }), px, 0.16, pz));
  }

  g.position.set(tsX, 0, tsZ);
  parent.add(g);
  return g;
}

/**
 * Scatter procedural + custom trees.
 * @param {THREE.Group} parent
 * @param {object} config - Terrain config { seed, waterLine, peakLine }
 * @param {number} patchR
 * @param {number} meshSize
 * @param {number} maxH
 * @param {object} ctx - { layout, plotPositions, fn }
 */
export function scatterTrees(parent, config, patchR, meshSize, maxH, ctx) {
  const L = ctx.layout;
  const tc = L ? L.trees : null;

  const trunkColor = tc ? tc.trunkColor : 0x5a3a20;
  const leafColorArr = tc ? tc.leafColors : ['#2d6b30', '#3a7a35', '#4a8a40'];
  const treeCount = tc ? tc.count : 40;
  const minDist = tc ? tc.minDistance : 0.7;
  const plotClear = tc ? tc.plotClearance : 0.4;
  const minTreeH = tc ? tc.minHeight : 0.06;
  const maxTreeH = tc ? tc.maxHeight : 0.14;

  const trunkMat = new THREE.MeshStandardMaterial({ color: trunkColor, roughness: 0.9 });
  const leafMats = leafColorArr.map(c =>
    new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));

  let seed = config.seed;
  const rng = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 16) / 65536; };

  for (let t = 0; t < treeCount; t++) {
    const tx = (rng() - 0.5) * meshSize * 0.85;
    const tz = (rng() - 0.5) * meshSize * 0.85;
    const dist = Math.sqrt(tx * tx + tz * tz);
    if (dist < minDist) continue;

    let tooClose = false;
    for (const pp of ctx.plotPositions) {
      if (Math.abs(tx - pp.x) < plotClear && Math.abs(tz - pp.z) < plotClear) { tooClose = true; break; }
    }
    if (tooClose) continue;

    const ox = Math.round((tx / meshSize) * 2 * patchR);
    const oy = Math.round((-tz / meshSize) * 2 * patchR);
    const e = ctx.fn.elevation(config, ox, oy);
    if (e <= config.waterLine || e >= config.peakLine) continue;
    const h = ((e - config.waterLine) / 255) * maxH;

    const treeH = minTreeH + rng() * (maxTreeH - minTreeH);
    const leafR = 0.04 + rng() * 0.04;
    const tree = new THREE.Group();
    tree.add(mk(new THREE.CylinderGeometry(0.008, 0.012, treeH, 5), trunkMat, 0, treeH / 2, 0));
    tree.add(mk(new THREE.ConeGeometry(leafR, treeH * 0.8, 6),
      leafMats[t % leafMats.length], 0, treeH * 0.8, 0));
    if (rng() > 0.5) {
      tree.add(mk(new THREE.ConeGeometry(leafR * 0.7, treeH * 0.5, 6),
        leafMats[(t + 1) % leafMats.length], 0, treeH * 1.1, 0));
    }
    tree.position.set(tx, Math.max(h, 0), tz);
    tree.castShadow = true;
    parent.add(tree);
  }

  // Custom trees from layout
  if (tc && tc.custom) {
    for (const ct of tc.custom) {
      const treeH = ct.height || 0.1;
      const leafR = ct.leafRadius || 0.06;
      const tree = new THREE.Group();
      tree.add(mk(new THREE.CylinderGeometry(0.008, 0.012, treeH, 5), trunkMat, 0, treeH / 2, 0));
      tree.add(mk(new THREE.ConeGeometry(leafR, treeH * 0.8, 6),
        leafMats[0], 0, treeH * 0.8, 0));
      tree.position.set(ct.x || 0, 0, ct.z || 0);
      tree.castShadow = true;
      parent.add(tree);
    }
  }
}

/**
 * Build plot pad with slot markers and labels.
 * @param {THREE.Group} parent
 * @param {number} plotIdx
 * @param {object} ctx - { layout, plotPositions, estateState, labels }
 * @returns {THREE.Group}
 */
export function buildPlotPad(parent, plotIdx, ctx) {
  const estate = ctx.estateState;
  const owned = plotIdx < estate.plotsOwned;
  const pp = ctx.plotPositions[plotIdx];
  const g = new THREE.Group();
  g.name = `plot-${plotIdx}`;
  g.userData = { plotIdx, type: 'plot' };

  const L = ctx.layout;
  const plotCfg = L && L.plots && L.plots[plotIdx] ? L.plots[plotIdx] : null;
  const maxPadSize = plotCfg ? plotCfg.padSize : 0.58;

  // Scale pad proportionally with building levels on this plot
  let maxLevel = 0;
  let hasCatacombs = false;
  if (owned && estate.buildings) {
    for (let s = 0; s < 4; s++) {
      const b = estate.buildings[plotIdx * 4 + s];
      if (b && b.type >= 0 && b.status > 0) {
        maxLevel = Math.max(maxLevel, b.level || 1);
        if (b.type === 15) hasCatacombs = true;
      }
    }
  }
  const minPadFraction = 0.3; // minimum 30% of configured size
  const tierFactor = Math.min(1, maxLevel / 20);
  const padSize = owned
    ? maxPadSize * (minPadFraction + (1 - minPadFraction) * tierFactor)
    : maxPadSize;
  const padH = owned ? 0.015 : 0.008;

  // Catacombs has its own rocky ground — skip the green pad, border, corners
  if (hasCatacombs) {
    const div = document.createElement('div');
    div.innerHTML = `<span style="font:bold 11px monospace;color:#9988bb;
      text-shadow:0 1px 3px rgba(0,0,0,0.8)">Catacombs</span>`;
    div.style.cssText = 'text-align:center;white-space:nowrap;user-select:none;pointer-events:none;';
    const label = new CSS2DObject(div);
    label.position.set(0, 0.14, 0);
    g.add(label);
    ctx.labels.push(label);
    g.position.set(pp.x, 0, pp.z);
    parent.add(g);
    return g;
  }

  // Stone foundation pad
  const padColor = plotCfg && plotCfg.padColor ? plotCfg.padColor : (owned ? 0x6a8a55 : 0x555555);
  const padMat = new THREE.MeshStandardMaterial({
    color: owned ? padColor : 0x555555,
    roughness: 0.75, metalness: 0,
    transparent: !owned, opacity: owned ? 1 : 0.35,
  });
  // Store per-plot texture pack for async loading
  padMat.userData = { texturePackOverride: plotCfg?.groundTexture || null };
  const pad = new THREE.Mesh(new THREE.BoxGeometry(padSize, padH, padSize), padMat);
  pad.position.y = padH / 2;
  pad.receiveShadow = true; pad.castShadow = true;
  pad.userData = { plotIdx, type: 'plot-pad' };
  g.add(pad);
  // Expose pad material for async texturing
  g.userData.padMaterial = padMat;

  // Stone edge border
  const borderColor = plotCfg && plotCfg.borderColor ? plotCfg.borderColor : 0x887766;
  const edgeMat = new THREE.MeshStandardMaterial({
    color: owned ? borderColor : 0x555555, roughness: 0.6,
    transparent: !owned, opacity: owned ? 1 : 0.3,
  });
  const half = padSize / 2; const bw = 0.02; const bh = padH + 0.008;
  for (const [bx, bz, bsx, bsz] of [
    [0, -half, padSize + bw, bw], [0, half, padSize + bw, bw],
    [-half, 0, bw, padSize], [half, 0, bw, padSize],
  ]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(bsx, bh, bsz), edgeMat);
    edge.position.set(bx, bh / 2, bz);
    g.add(edge);
  }

  // Corner posts on owned plots
  if (owned) {
    const cornerMat = new THREE.MeshStandardMaterial({ color: 0x776655, roughness: 0.5, metalness: 0.2 });
    for (const [cx, cz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
      g.add(mk(new THREE.CylinderGeometry(0.012, 0.015, 0.05, 6), cornerMat,
        cx * half, 0.03, cz * half));
    }
  }

  // Slot markers (size scales with pad, positions stay fixed for building placement)
  if (owned) {
    const slotMat = new THREE.MeshStandardMaterial({
      color: 0xaabb88, roughness: 0.6, transparent: true, opacity: 0.35
    });
    const slotDefs = plotCfg && plotCfg.slots ? plotCfg.slots : SLOT_OFFSETS;
    const padScale = padSize / maxPadSize; // 0.3 to 1.0
    const markerSize = 0.13 * padScale;
    for (let s = 0; s < slotDefs.length; s++) {
      const so = slotDefs[s];
      const marker = new THREE.Mesh(new THREE.BoxGeometry(markerSize, 0.003, markerSize), slotMat);
      marker.position.set(so.dx, padH + 0.003, so.dz);
      if (so.rotation) marker.rotation.y = so.rotation * DEG;
      marker.receiveShadow = true;
      marker.userData = { plotIdx, slotIdx: s, type: 'slot' };
      g.add(marker);
    }
  } else {
    // "FOR SALE" sign
    g.add(mk(new THREE.CylinderGeometry(0.005, 0.005, 0.08, 4),
      new THREE.MeshStandardMaterial({ color: 0x8b6914 }), 0, 0.04, 0));
    g.add(mk(new THREE.BoxGeometry(0.08, 0.035, 0.003),
      new THREE.MeshStandardMaterial({ color: 0xd4c090 }), 0, 0.085, 0));
  }

  // Label
  const div = document.createElement('div');
  const defaultNames = ['Starter', 'Tier 1', 'Tier 2', 'Tier 2', 'Prestige'];
  const plotLabel = plotCfg ? plotCfg.label : defaultNames[plotIdx];
  const owned_str = owned ? '' : ' (locked)';
  div.innerHTML = `<span style="font:bold 11px monospace;color:${owned ? '#afd89a' : '#888'};
    text-shadow:0 1px 3px rgba(0,0,0,0.8)">Plot ${plotIdx + 1} \u2014 ${plotLabel}${owned_str}</span>`;
  div.style.cssText = 'text-align:center;white-space:nowrap;user-select:none;pointer-events:none;';
  const label = new CSS2DObject(div);
  label.position.set(0, 0.14, 0);
  g.add(label);
  ctx.labels.push(label);

  g.position.set(pp.x, 0, pp.z);
  parent.add(g);
  return g;
}

/**
 * Build decoration meshes from layout.
 * @param {THREE.Group} parent
 * @param {object} layout
 * @returns {THREE.Group}
 */
export function buildDecorations(parent, layout) {
  const dg = new THREE.Group();
  dg.name = 'decorations';
  for (const dec of layout.decorations) {
    const mesh = createDecorationMesh(dec.type, dec);
    if (mesh) {
      mesh.position.set(dec.x || 0, 0, dec.z || 0);
      if (dec.rotation) mesh.rotation.y = dec.rotation * DEG;
      mesh.userData = { type: 'decoration', decorationType: dec.type, config: dec };
      dg.add(mesh);
    }
  }
  parent.add(dg);
  return dg;
}

/**
 * Create a decoration mesh by type.
 * @param {string} type
 * @param {object} cfg
 * @returns {THREE.Group|null}
 */
export function createDecorationMesh(type, cfg) {
  const g = new THREE.Group();
  const s = cfg.scale || 1.0;
  const color = cfg.color || '#777777';

  switch (type) {
    case 'rock': {
      const geo = new THREE.IcosahedronGeometry(0.04 * s, 0);
      const posAttr = geo.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        posAttr.setX(i, posAttr.getX(i) + (Math.random() - 0.5) * 0.01);
        posAttr.setY(i, posAttr.getY(i) * 0.6);
        posAttr.setZ(i, posAttr.getZ(i) + (Math.random() - 0.5) * 0.01);
      }
      geo.computeVertexNormals();
      const rock = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
      rock.position.y = 0.02 * s;
      rock.castShadow = true;
      g.add(rock);
      break;
    }
    case 'well': {
      const wallMat = new THREE.MeshStandardMaterial({ color: '#888888', roughness: 0.7 });
      g.add(mk(new THREE.CylinderGeometry(0.04 * s, 0.045 * s, 0.05 * s, 10, 1, true), wallMat, 0, 0.025 * s, 0));
      g.add(mk(new THREE.TorusGeometry(0.042 * s, 0.005 * s, 4, 10), wallMat, 0, 0.05 * s, 0, Math.PI / 2));
      g.add(mk(new THREE.CircleGeometry(0.035 * s, 10),
        new THREE.MeshStandardMaterial({ color: 0x4499cc, roughness: 0.1 }), 0, 0.03 * s, 0, -Math.PI / 2));
      const postMat = new THREE.MeshStandardMaterial({ color: '#6b4420', roughness: 0.8 });
      for (const px of [-1, 1]) {
        g.add(mk(new THREE.CylinderGeometry(0.004 * s, 0.004 * s, 0.08 * s, 4), postMat, px * 0.035 * s, 0.04 * s + 0.04 * s, 0));
      }
      g.add(mk(new THREE.CylinderGeometry(0.003 * s, 0.003 * s, 0.08 * s, 4), postMat, 0, 0.09 * s, 0, 0, 0, Math.PI / 2));
      g.castShadow = true;
      break;
    }
    case 'barrel': {
      const barrelMat = new THREE.MeshStandardMaterial({ color: '#7a5a30', roughness: 0.7 });
      g.add(mk(new THREE.CylinderGeometry(0.018 * s, 0.02 * s, 0.04 * s, 8), barrelMat, 0, 0.02 * s, 0));
      const bandMat = new THREE.MeshStandardMaterial({ color: '#555555', metalness: 0.5 });
      for (const by of [0.01, 0.03]) {
        g.add(mk(new THREE.TorusGeometry(0.019 * s, 0.002 * s, 4, 10), bandMat, 0, by * s, 0, Math.PI / 2));
      }
      g.castShadow = true;
      break;
    }
    case 'crate': {
      const crateMat = new THREE.MeshStandardMaterial({ color: '#9a7a50', roughness: 0.8 });
      const box = mk(new THREE.BoxGeometry(0.035 * s, 0.03 * s, 0.035 * s), crateMat, 0, 0.015 * s, 0);
      box.castShadow = true;
      g.add(box);
      const edgeMat = new THREE.MeshStandardMaterial({ color: '#6b4420' });
      const eSize = 0.036 * s;
      for (const [ex, ey, ez, ew, eh, ed] of [
        [0, 0.03, 0, eSize, 0.003, 0.003], [0, 0, 0, eSize, 0.003, 0.003],
        [eSize/2, 0.015, 0, 0.003, 0.03, 0.003], [-eSize/2, 0.015, 0, 0.003, 0.03, 0.003],
      ]) {
        g.add(mk(new THREE.BoxGeometry(ew, eh, ed), edgeMat, ex * s, ey * s, ez * s));
      }
      break;
    }
    case 'banner': {
      const poleMat = new THREE.MeshStandardMaterial({ color: '#888888', metalness: 0.4 });
      g.add(mk(new THREE.CylinderGeometry(0.004 * s, 0.005 * s, 0.15 * s, 5), poleMat, 0, 0.075 * s, 0));
      const clothColor = cfg.color || '#cc2222';
      g.add(mk(new THREE.BoxGeometry(0.04 * s, 0.05 * s, 0.002 * s),
        new THREE.MeshStandardMaterial({ color: clothColor, side: THREE.DoubleSide }),
        0.022 * s, 0.125 * s, 0));
      g.add(mk(new THREE.SphereGeometry(0.006 * s, 5, 4),
        new THREE.MeshStandardMaterial({ color: '#daa520', metalness: 0.6 }), 0, 0.155 * s, 0));
      g.castShadow = true;
      break;
    }
    case 'campfire': {
      const logMat = new THREE.MeshStandardMaterial({ color: '#5a3a20', roughness: 0.9 });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const lx = Math.sin(a) * 0.025 * s, lz = Math.cos(a) * 0.025 * s;
        g.add(mk(new THREE.CylinderGeometry(0.005 * s, 0.006 * s, 0.025 * s, 4), logMat,
          lx, 0.008 * s, lz, 0, a + Math.PI / 2, Math.PI / 6));
      }
      g.add(mk(new THREE.SphereGeometry(0.015 * s, 6, 4),
        new THREE.MeshBasicMaterial({ color: 0xff4400 }), 0, 0.015 * s, 0));
      g.add(mk(new THREE.SphereGeometry(0.008 * s, 4, 3),
        new THREE.MeshBasicMaterial({ color: 0xffaa00 }), 0, 0.025 * s, 0));
      break;
    }
    case 'cart': {
      const woodMat = new THREE.MeshStandardMaterial({ color: '#8b6914', roughness: 0.8 });
      const body = mk(new THREE.BoxGeometry(0.06 * s, 0.02 * s, 0.035 * s), woodMat, 0, 0.025 * s, 0);
      body.castShadow = true;
      g.add(body);
      for (const sz of [-1, 1]) {
        g.add(mk(new THREE.BoxGeometry(0.06 * s, 0.015 * s, 0.003 * s), woodMat,
          0, 0.04 * s, sz * 0.018 * s));
      }
      const wheelMat = new THREE.MeshStandardMaterial({ color: '#555555', metalness: 0.3 });
      for (const wx of [-1, 1]) {
        g.add(mk(new THREE.TorusGeometry(0.012 * s, 0.003 * s, 6, 10), wheelMat,
          wx * 0.032 * s, 0.012 * s, 0.02 * s, 0, 0, Math.PI / 2));
        g.add(mk(new THREE.TorusGeometry(0.012 * s, 0.003 * s, 6, 10), wheelMat,
          wx * 0.032 * s, 0.012 * s, -0.02 * s, 0, 0, Math.PI / 2));
      }
      g.add(mk(new THREE.CylinderGeometry(0.003 * s, 0.003 * s, 0.04 * s, 4), woodMat,
        0.05 * s, 0.025 * s, 0, 0, 0, Math.PI / 2));
      break;
    }
    case 'fence': {
      const fenceMat = new THREE.MeshStandardMaterial({ color: cfg.color || '#8b6914', roughness: 0.8 });
      const pts = cfg.points || [];
      const fh = (cfg.height || 0.03) * s;
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, z1] = pts[i];
        const [x2, z2] = pts[i + 1];
        const dx = x2 - x1, dz = z2 - z1;
        const segLen = Math.sqrt(dx * dx + dz * dz);
        const angle = Math.atan2(dx, dz);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.005 * s, fh, segLen), fenceMat);
        rail.position.set((x1 + x2) / 2, fh / 2, (z1 + z2) / 2);
        rail.rotation.y = angle;
        rail.castShadow = true;
        g.add(rail);
        if (i === 0) {
          g.add(mk(new THREE.CylinderGeometry(0.004 * s, 0.005 * s, fh * 1.3, 4), fenceMat,
            x1, fh * 0.65, z1));
        }
        g.add(mk(new THREE.CylinderGeometry(0.004 * s, 0.005 * s, fh * 1.3, 4), fenceMat,
          x2, fh * 0.65, z2));
      }
      break;
    }
    case 'lamp': {
      const postMat = new THREE.MeshStandardMaterial({ color: '#444444', roughness: 0.3, metalness: 0.6 });
      g.add(mk(new THREE.CylinderGeometry(0.006 * s, 0.008 * s, 0.14 * s, 6), postMat, 0, 0.07 * s, 0));
      g.add(mk(new THREE.SphereGeometry(0.015 * s, 6, 4),
        new THREE.MeshBasicMaterial({ color: cfg.color || '#ffeeaa' }), 0, 0.15 * s, 0));
      g.castShadow = true;
      break;
    }
    case 'sign': {
      const postMat = new THREE.MeshStandardMaterial({ color: '#8b6914', roughness: 0.8 });
      g.add(mk(new THREE.CylinderGeometry(0.005 * s, 0.005 * s, 0.1 * s, 4), postMat, 0, 0.05 * s, 0));
      g.add(mk(new THREE.BoxGeometry(0.06 * s, 0.03 * s, 0.003 * s),
        new THREE.MeshStandardMaterial({ color: '#d4c090' }), 0, 0.09 * s, 0));
      g.castShadow = true;
      break;
    }
    default:
      return null;
  }

  // Selection ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.05 * s, 0.06 * s, 16),
    new THREE.MeshBasicMaterial({ color: 0xffdd00, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002;
  ring.visible = false; ring.name = 'select-ring';
  g.add(ring);

  return g;
}

/**
 * Build perimeter walls with crenellations.
 * @param {THREE.Group} parent
 * @param {object} layout
 * @returns {THREE.Group|null}
 */
export function buildWalls(parent, layout) {
  const wc = layout.walls;
  if (!wc || !wc.enabled || !wc.points || wc.points.length < 2) return null;
  const wg = new THREE.Group();
  wg.name = 'walls';
  const wallMat = new THREE.MeshStandardMaterial({ color: wc.color || '#887766', roughness: 0.7 });
  const h = wc.height || 0.06;
  const thick = wc.thickness || 0.02;
  const pts = wc.points;
  const gates = new Set((wc.gatePositions || []).map(g => g.toString()));

  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    if (gates.has(i.toString())) continue;
    const dx = x2 - x1, dz = z2 - z1;
    const segLen = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dx, dz);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(thick, h, segLen), wallMat);
    wall.position.set((x1 + x2) / 2, h / 2, (z1 + z2) / 2);
    wall.rotation.y = angle;
    wall.castShadow = true; wall.receiveShadow = true;
    wg.add(wall);
    const cCount = Math.floor(segLen / 0.05);
    for (let c = 0; c <= cCount; c++) {
      const t = cCount > 0 ? c / cCount : 0;
      const cx = x1 + dx * t, cz = z1 + dz * t;
      wg.add(mk(new THREE.BoxGeometry(thick * 1.2, 0.015, thick * 1.2), wallMat, cx, h + 0.0075, cz));
    }
  }
  parent.add(wg);
  return wg;
}

/**
 * Build coordinate grid overlay.
 * @param {THREE.Group} parent
 * @returns {THREE.Group}
 */
export function buildGridOverlay(parent) {
  const gridGroup = new THREE.Group();
  gridGroup.name = 'grid-overlay';
  const gridMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 });
  const size = 5, step = 0.25;
  const half = size / 2;
  for (let x = -half; x <= half; x += step) {
    const pts = [new THREE.Vector3(x, 0.005, -half), new THREE.Vector3(x, 0.005, half)];
    gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
  }
  for (let z = -half; z <= half; z += step) {
    const pts = [new THREE.Vector3(-half, 0.005, z), new THREE.Vector3(half, 0.005, z)];
    gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
  }
  const axisX = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-half, 0.006, 0), new THREE.Vector3(half, 0.006, 0)]),
    new THREE.LineBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.4 })
  );
  const axisZ = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.006, -half), new THREE.Vector3(0, 0.006, half)]),
    new THREE.LineBasicMaterial({ color: 0x4444ff, transparent: true, opacity: 0.4 })
  );
  gridGroup.add(axisX, axisZ);
  parent.add(gridGroup);
  return gridGroup;
}
