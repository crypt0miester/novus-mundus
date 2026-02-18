/**
 * TownSquare -- central plaza that evolves across 5 stages with estate level.
 *
 * Stage 1 (Camp, L1-9):       bare clearing, campfire, wooden stakes
 * Stage 2 (Cobblestone, L10-19): cobblestone plaza, lamp posts, well, market frame
 * Stage 3 (Proper, L20-39):   fountain, flower beds, hanging lanterns, town banner
 * Stage 4 (Grand, L40-59):    stone archways, seasonal decor, merchant spawn points
 * Stage 5 (Monumental, L60+): golden trim, floating runic orbs, eternal flame
 *
 * Always present: activity board (3 rune indicators for Dawn/Midday/Dusk daily
 * windows) and road connections to districts.
 *
 * Milestone decorations layer on top of the current stage.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAGE_THRESHOLDS = [1, 10, 20, 40, 60]; // estate levels

// Ground radii per stage
const GROUND_RADIUS = [0.15, 0.22, 0.30, 0.38, 0.42];

// Ground colors per stage
const GROUND_COLORS = [
  0x8b7355, // dirt brown
  0x888888, // grey cobblestone
  0x707070, // polished stone
  0x606060, // grand stone
  0x505050, // monumental stone
];

// Lamp post positions per stage (angles around circle, radius fraction)
const LAMP_CONFIGS = [
  [],                                                     // stage 1: no lamps
  [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5],            // stage 2: 4 posts
  [0, Math.PI / 3, Math.PI * 2 / 3, Math.PI, Math.PI * 4 / 3, Math.PI * 5 / 3], // stage 3: 6
  [0, Math.PI / 3, Math.PI * 2 / 3, Math.PI, Math.PI * 4 / 3, Math.PI * 5 / 3], // stage 4: 6
  [0, Math.PI / 4, Math.PI / 2, Math.PI * 3 / 4, Math.PI, Math.PI * 5 / 4, Math.PI * 3 / 2, Math.PI * 7 / 4], // stage 5: 8
];

const ROAD_Y_OFFSET = 0.003;
const CAMPFIRE_RADIUS = 0.015;
const ORB_FLOAT_HEIGHT = 0.18;
const ORB_BOB_SPEED = 1.5;
const ORB_BOB_AMPLITUDE = 0.02;
const FLAME_FLICKER_SPEED = 6.0;
const GOLDEN_WATER_COLOR = 0xffd700;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStage(estateLevel) {
  if (estateLevel >= 60) return 4;
  if (estateLevel >= 40) return 3;
  if (estateLevel >= 20) return 2;
  if (estateLevel >= 10) return 1;
  return 0;
}

function disposeMesh(mesh) {
  if (mesh.geometry) mesh.geometry.dispose();
  if (mesh.material) {
    if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
    else mesh.material.dispose();
  }
}

function disposeGroup(group) {
  if (!group) return;
  group.traverse((child) => {
    if (child.isMesh) disposeMesh(child);
  });
  if (group.parent) group.parent.remove(group);
}

// ---------------------------------------------------------------------------
// Stage builders
// ---------------------------------------------------------------------------

/**
 * Stage 1: Camp (Level 1-9)
 * Ground: circle brown dirt, wooden stakes, campfire.
 */
function buildStage1(group, radius) {
  const groundMat = new THREE.MeshStandardMaterial({
    color: GROUND_COLORS[0],
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  // Ground disc
  const groundGeo = new THREE.CircleGeometry(radius, 24);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.y = ROAD_Y_OFFSET;
  ground.receiveShadow = true;
  group.add(ground);

  // Wooden stakes around perimeter
  const stakeMat = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.9 });
  const stakeCount = 5;
  for (let i = 0; i < stakeCount; i++) {
    const angle = (i / stakeCount) * Math.PI * 2 + 0.3;
    const sr = radius * 0.85;
    const stakeH = 0.03 + Math.random() * 0.015;
    const stakeGeo = new THREE.CylinderGeometry(0.002, 0.003, stakeH, 4);
    const stake = new THREE.Mesh(stakeGeo, stakeMat);
    stake.position.set(
      Math.cos(angle) * sr,
      stakeH * 0.5 + ROAD_Y_OFFSET,
      Math.sin(angle) * sr
    );
    // Slight tilt
    stake.rotation.z = (Math.random() - 0.5) * 0.15;
    stake.rotation.x = (Math.random() - 0.5) * 0.1;
    stake.castShadow = true;
    group.add(stake);
  }

  // Campfire: ring of stones + fire cone
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.95 });
  const stoneCount = 8;
  for (let i = 0; i < stoneCount; i++) {
    const angle = (i / stoneCount) * Math.PI * 2;
    const stoneGeo = new THREE.CylinderGeometry(0.004, 0.005, 0.006, 5);
    const stone = new THREE.Mesh(stoneGeo, stoneMat);
    stone.position.set(
      Math.cos(angle) * CAMPFIRE_RADIUS,
      0.003 + ROAD_Y_OFFSET,
      Math.sin(angle) * CAMPFIRE_RADIUS
    );
    stone.castShadow = true;
    group.add(stone);
  }

  // Fire mesh: warm cone
  const fireMat = new THREE.MeshStandardMaterial({
    color: 0xff4500,
    emissive: 0xff6600,
    emissiveIntensity: 0.15,
    roughness: 1.0,
    transparent: true,
    opacity: 0.85,
  });
  const fireGeo = new THREE.ConeGeometry(0.008, 0.025, 6);
  const fire = new THREE.Mesh(fireGeo, fireMat);
  fire.position.set(0, 0.015 + ROAD_Y_OFFSET, 0);
  fire.name = 'campfire';
  group.add(fire);

  // Inner fire cone (smaller, slightly warmer)
  const innerFireMat = new THREE.MeshStandardMaterial({
    color: 0xffcc00,
    emissive: 0xffaa00,
    emissiveIntensity: 0.2,
    roughness: 1.0,
    transparent: true,
    opacity: 0.7,
  });
  const innerFireGeo = new THREE.ConeGeometry(0.005, 0.018, 5);
  const innerFire = new THREE.Mesh(innerFireGeo, innerFireMat);
  innerFire.position.set(0, 0.012 + ROAD_Y_OFFSET, 0);
  innerFire.name = 'campfire-inner';
  group.add(innerFire);

  return { lampPositions: [], groundMat };
}

/**
 * Stage 2: Cobblestone (Level 10-19)
 * Cobblestone ground, 4 iron lamp posts, market stall frame, stone well, activity board.
 */
function buildStage2(group, radius) {
  const groundMat = new THREE.MeshStandardMaterial({
    color: GROUND_COLORS[1],
    roughness: 0.80,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  // Ground disc
  const groundGeo = new THREE.CircleGeometry(radius, 32);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.y = ROAD_Y_OFFSET;
  ground.receiveShadow = true;
  group.add(ground);

  // Iron lamp posts
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.6, metalness: 0.4 });
  const lampGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffcc66,
    emissive: 0xffaa33,
    emissiveIntensity: 0.15,
    roughness: 0.3,
  });

  const lampPositions = [];
  const lampAngles = LAMP_CONFIGS[1];
  const lampR = radius * 0.75;

  for (let i = 0; i < lampAngles.length; i++) {
    const a = lampAngles[i];
    const lx = Math.cos(a) * lampR;
    const lz = Math.sin(a) * lampR;

    // Post
    const postGeo = new THREE.CylinderGeometry(0.003, 0.004, 0.06, 6);
    const post = new THREE.Mesh(postGeo, lampMat);
    post.position.set(lx, 0.03 + ROAD_Y_OFFSET, lz);
    post.castShadow = true;
    group.add(post);

    // Lamp top (sphere)
    const topGeo = new THREE.SphereGeometry(0.006, 6, 5);
    const top = new THREE.Mesh(topGeo, lampGlowMat);
    top.position.set(lx, 0.063 + ROAD_Y_OFFSET, lz);
    top.name = 'lamp-glow';
    group.add(top);

    lampPositions.push({ x: lx, y: 0.063 + ROAD_Y_OFFSET, z: lz });
  }

  // Market stall frame (4 posts + top beam, no covering)
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.9 });
  const stallX = radius * 0.35;
  const stallZ = -radius * 0.3;
  const stallW = 0.06;
  const stallD = 0.04;
  const stallH = 0.05;
  const stallPostGeo = new THREE.CylinderGeometry(0.002, 0.003, stallH, 4);

  const stallCorners = [
    [stallX - stallW * 0.5, stallZ - stallD * 0.5],
    [stallX + stallW * 0.5, stallZ - stallD * 0.5],
    [stallX - stallW * 0.5, stallZ + stallD * 0.5],
    [stallX + stallW * 0.5, stallZ + stallD * 0.5],
  ];

  for (const [sx, sz] of stallCorners) {
    const sp = new THREE.Mesh(stallPostGeo, woodMat);
    sp.position.set(sx, stallH * 0.5 + ROAD_Y_OFFSET, sz);
    sp.castShadow = true;
    group.add(sp);
  }

  // Top beams
  const beamGeo = new THREE.BoxGeometry(stallW, 0.003, 0.003);
  const beamFront = new THREE.Mesh(beamGeo, woodMat);
  beamFront.position.set(stallX, stallH + ROAD_Y_OFFSET, stallZ - stallD * 0.5);
  beamFront.castShadow = true;
  group.add(beamFront);

  const beamBack = new THREE.Mesh(beamGeo.clone(), woodMat);
  beamBack.position.set(stallX, stallH + ROAD_Y_OFFSET, stallZ + stallD * 0.5);
  beamBack.castShadow = true;
  group.add(beamBack);

  const sideBeamGeo = new THREE.BoxGeometry(0.003, 0.003, stallD);
  const beamLeft = new THREE.Mesh(sideBeamGeo, woodMat);
  beamLeft.position.set(stallX - stallW * 0.5, stallH + ROAD_Y_OFFSET, stallZ);
  beamLeft.castShadow = true;
  group.add(beamLeft);

  const beamRight = new THREE.Mesh(sideBeamGeo.clone(), woodMat);
  beamRight.position.set(stallX + stallW * 0.5, stallH + ROAD_Y_OFFSET, stallZ);
  beamRight.castShadow = true;
  group.add(beamRight);

  // Stone well
  buildWell(group, -radius * 0.35, radius * 0.2);

  return { lampPositions, groundMat };
}

/**
 * Build a stone well at position.
 */
function buildWell(group, x, z) {
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x707070, roughness: 0.8 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.9 });

  // Cylinder wall
  const wallGeo = new THREE.CylinderGeometry(0.015, 0.016, 0.02, 10);
  const wall = new THREE.Mesh(wallGeo, stoneMat);
  wall.position.set(x, 0.01 + ROAD_Y_OFFSET, z);
  wall.castShadow = true;
  group.add(wall);

  // Torus rim
  const rimGeo = new THREE.TorusGeometry(0.016, 0.003, 6, 12);
  const rim = new THREE.Mesh(rimGeo, stoneMat);
  rim.position.set(x, 0.02 + ROAD_Y_OFFSET, z);
  rim.rotation.x = Math.PI / 2;
  rim.castShadow = true;
  group.add(rim);

  // Roof frame: 2 posts + crossbar
  const postH = 0.04;
  const postGeo = new THREE.CylinderGeometry(0.002, 0.002, postH, 4);
  const p1 = new THREE.Mesh(postGeo, woodMat);
  p1.position.set(x - 0.014, 0.02 + postH * 0.5 + ROAD_Y_OFFSET, z);
  p1.castShadow = true;
  group.add(p1);

  const p2 = new THREE.Mesh(postGeo, woodMat);
  p2.position.set(x + 0.014, 0.02 + postH * 0.5 + ROAD_Y_OFFSET, z);
  p2.castShadow = true;
  group.add(p2);

  // Crossbar
  const barGeo = new THREE.BoxGeometry(0.032, 0.003, 0.003);
  const bar = new THREE.Mesh(barGeo, woodMat);
  bar.position.set(x, 0.02 + postH + ROAD_Y_OFFSET, z);
  bar.castShadow = true;
  group.add(bar);

  // Roof peak (small triangular shape approximated with a cone)
  const roofGeo = new THREE.ConeGeometry(0.018, 0.012, 4);
  const roof = new THREE.Mesh(roofGeo, woodMat);
  roof.position.set(x, 0.02 + postH + 0.006 + ROAD_Y_OFFSET, z);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  group.add(roof);
}

/**
 * Stage 3: Proper (Level 20-39)
 * Multi-tiered fountain, 6 lamp posts, flower beds, hanging lanterns, town banner.
 */
function buildStage3(group, radius) {
  const groundMat = new THREE.MeshStandardMaterial({
    color: GROUND_COLORS[2],
    roughness: 0.65,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });

  // Ground disc
  const groundGeo = new THREE.CircleGeometry(radius, 36);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.y = ROAD_Y_OFFSET;
  ground.receiveShadow = true;
  group.add(ground);

  // Multi-tiered fountain
  const fountainData = buildFountain(group, 0, 0);

  // 6 ornate lamp posts
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5, metalness: 0.5 });
  const lampGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffcc66,
    emissive: 0xffaa33,
    emissiveIntensity: 0.1,
    roughness: 0.3,
  });

  const lampPositions = [];
  const lampAngles = LAMP_CONFIGS[2];
  const lampR = radius * 0.75;

  for (let i = 0; i < lampAngles.length; i++) {
    const a = lampAngles[i];
    const lx = Math.cos(a) * lampR;
    const lz = Math.sin(a) * lampR;

    // Ornate post (thicker base, thinner top)
    const postGeo = new THREE.CylinderGeometry(0.003, 0.005, 0.07, 6);
    const post = new THREE.Mesh(postGeo, lampMat);
    post.position.set(lx, 0.035 + ROAD_Y_OFFSET, lz);
    post.castShadow = true;
    group.add(post);

    // Post base (wider disc)
    const baseGeo = new THREE.CylinderGeometry(0.007, 0.008, 0.004, 8);
    const base = new THREE.Mesh(baseGeo, lampMat);
    base.position.set(lx, 0.002 + ROAD_Y_OFFSET, lz);
    group.add(base);

    // Lamp globe
    const globeGeo = new THREE.SphereGeometry(0.007, 8, 6);
    const globe = new THREE.Mesh(globeGeo, lampGlowMat);
    globe.position.set(lx, 0.073 + ROAD_Y_OFFSET, lz);
    globe.name = 'lamp-glow';
    group.add(globe);

    lampPositions.push({ x: lx, y: 0.073 + ROAD_Y_OFFSET, z: lz });
  }

  // Hanging lanterns on chains between adjacent lamp posts
  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xffcc44,
    emissive: 0xffaa22,
    emissiveIntensity: 0.1,
    transparent: true,
    opacity: 0.9,
    roughness: 0.4,
  });
  const chainMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.6, metalness: 0.4 });

  for (let i = 0; i < lampAngles.length; i++) {
    const j = (i + 1) % lampAngles.length;
    const ax = Math.cos(lampAngles[i]) * lampR;
    const az = Math.sin(lampAngles[i]) * lampR;
    const bx = Math.cos(lampAngles[j]) * lampR;
    const bz = Math.sin(lampAngles[j]) * lampR;

    // Chain: thin cylinder between posts at sagging height
    const mx = (ax + bx) * 0.5;
    const mz = (az + bz) * 0.5;
    const chainLen = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
    const chainAngle = Math.atan2(bx - ax, bz - az);

    const chainGeo = new THREE.CylinderGeometry(0.001, 0.001, chainLen, 3);
    chainGeo.rotateZ(Math.PI / 2);
    const chain = new THREE.Mesh(chainGeo, chainMat);
    chain.position.set(mx, 0.06 + ROAD_Y_OFFSET, mz);
    chain.rotation.y = chainAngle;
    group.add(chain);

    // Lantern at chain midpoint (sagging)
    const lanternGeo = new THREE.SphereGeometry(0.004, 5, 4);
    const lantern = new THREE.Mesh(lanternGeo, lanternMat);
    lantern.position.set(mx, 0.055 + ROAD_Y_OFFSET, mz);
    lantern.name = 'hanging-lantern';
    group.add(lantern);
  }

  // 2 flower beds (colored geometry patches)
  const flowerColors = [0xff6699, 0x66cc66];
  const flowerPositions = [
    { x: radius * 0.45, z: radius * 0.35 },
    { x: -radius * 0.45, z: -radius * 0.35 },
  ];

  for (let fi = 0; fi < flowerPositions.length; fi++) {
    const fp = flowerPositions[fi];
    const bedMat = new THREE.MeshStandardMaterial({
      color: 0x4a8b3a,
      roughness: 0.9,
    });
    const bedGeo = new THREE.CircleGeometry(0.03, 12);
    bedGeo.rotateX(-Math.PI / 2);
    const bed = new THREE.Mesh(bedGeo, bedMat);
    bed.position.set(fp.x, ROAD_Y_OFFSET + 0.001, fp.z);
    bed.receiveShadow = true;
    group.add(bed);

    // Flower dots
    const flowerMat = new THREE.MeshStandardMaterial({
      color: flowerColors[fi],
      roughness: 0.7,
    });
    const flowerCount = 7;
    for (let fli = 0; fli < flowerCount; fli++) {
      const fa = (fli / flowerCount) * Math.PI * 2;
      const fr = 0.012 + Math.random() * 0.012;
      const flGeo = new THREE.SphereGeometry(0.003, 4, 3);
      const flower = new THREE.Mesh(flGeo, flowerMat);
      flower.position.set(
        fp.x + Math.cos(fa) * fr,
        0.005 + ROAD_Y_OFFSET,
        fp.z + Math.sin(fa) * fr
      );
      group.add(flower);
    }
  }

  // Town banner (pole + cloth plane)
  buildTownBanner(group, -radius * 0.1, radius * 0.55);

  return { lampPositions, fountainData, groundMat };
}

/**
 * Build multi-tiered fountain.
 * Returns { waterSurfaces: [THREE.Mesh] } for golden fountain effect.
 */
function buildFountain(group, x, z) {
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.6, metalness: 0.1 });
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x3388cc,
    emissive: 0x112244,
    emissiveIntensity: 0.03,
    roughness: 0.1,
    metalness: 0.2,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
  });

  const waterSurfaces = [];

  // Bottom basin
  const basin1Geo = new THREE.CylinderGeometry(0.04, 0.045, 0.012, 16);
  const basin1 = new THREE.Mesh(basin1Geo, stoneMat);
  basin1.position.set(x, 0.006 + ROAD_Y_OFFSET, z);
  basin1.castShadow = true;
  basin1.receiveShadow = true;
  group.add(basin1);

  // Bottom water surface
  const water1Geo = new THREE.CircleGeometry(0.038, 16);
  water1Geo.rotateX(-Math.PI / 2);
  const water1 = new THREE.Mesh(water1Geo, waterMat.clone());
  water1.position.set(x, 0.012 + ROAD_Y_OFFSET, z);
  water1.name = 'fountain-water';
  group.add(water1);
  waterSurfaces.push(water1);

  // Middle pillar
  const pillarGeo = new THREE.CylinderGeometry(0.008, 0.01, 0.025, 8);
  const pillar = new THREE.Mesh(pillarGeo, stoneMat);
  pillar.position.set(x, 0.012 + 0.0125 + ROAD_Y_OFFSET, z);
  pillar.castShadow = true;
  group.add(pillar);

  // Middle basin
  const basin2Geo = new THREE.CylinderGeometry(0.025, 0.028, 0.008, 12);
  const basin2 = new THREE.Mesh(basin2Geo, stoneMat);
  basin2.position.set(x, 0.037 + 0.004 + ROAD_Y_OFFSET, z);
  basin2.castShadow = true;
  group.add(basin2);

  // Middle water surface
  const water2Geo = new THREE.CircleGeometry(0.023, 12);
  water2Geo.rotateX(-Math.PI / 2);
  const water2 = new THREE.Mesh(water2Geo, waterMat.clone());
  water2.position.set(x, 0.045 + ROAD_Y_OFFSET, z);
  water2.name = 'fountain-water';
  group.add(water2);
  waterSurfaces.push(water2);

  // Top pillar
  const topPillarGeo = new THREE.CylinderGeometry(0.005, 0.006, 0.02, 6);
  const topPillar = new THREE.Mesh(topPillarGeo, stoneMat);
  topPillar.position.set(x, 0.045 + 0.01 + ROAD_Y_OFFSET, z);
  topPillar.castShadow = true;
  group.add(topPillar);

  // Top basin (smallest)
  const basin3Geo = new THREE.CylinderGeometry(0.012, 0.014, 0.005, 10);
  const basin3 = new THREE.Mesh(basin3Geo, stoneMat);
  basin3.position.set(x, 0.065 + 0.0025 + ROAD_Y_OFFSET, z);
  basin3.castShadow = true;
  group.add(basin3);

  // Top water surface
  const water3Geo = new THREE.CircleGeometry(0.011, 10);
  water3Geo.rotateX(-Math.PI / 2);
  const water3 = new THREE.Mesh(water3Geo, waterMat.clone());
  water3.position.set(x, 0.07 + ROAD_Y_OFFSET, z);
  water3.name = 'fountain-water';
  group.add(water3);
  waterSurfaces.push(water3);

  // Spout top sphere (decorative)
  const spoutGeo = new THREE.SphereGeometry(0.006, 6, 5);
  const spoutMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.4, metalness: 0.3 });
  const spout = new THREE.Mesh(spoutGeo, spoutMat);
  spout.position.set(x, 0.074 + ROAD_Y_OFFSET, z);
  spout.castShadow = true;
  group.add(spout);

  return { waterSurfaces, stoneMat };
}

/**
 * Build town banner (pole + cloth plane).
 */
function buildTownBanner(group, x, z) {
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.85 });
  const clothMat = new THREE.MeshStandardMaterial({
    color: 0xcc2244,
    roughness: 0.8,
    side: THREE.DoubleSide,
  });

  // Pole
  const poleH = 0.08;
  const poleGeo = new THREE.CylinderGeometry(0.002, 0.003, poleH, 5);
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.set(x, poleH * 0.5 + ROAD_Y_OFFSET, z);
  pole.castShadow = true;
  group.add(pole);

  // Pole top ball
  const topBallGeo = new THREE.SphereGeometry(0.004, 5, 4);
  const topBall = new THREE.Mesh(topBallGeo, poleMat);
  topBall.position.set(x, poleH + 0.004 + ROAD_Y_OFFSET, z);
  group.add(topBall);

  // Cloth: plane hanging from pole
  const clothW = 0.03;
  const clothH = 0.025;
  const clothGeo = new THREE.PlaneGeometry(clothW, clothH, 6, 4);
  const cloth = new THREE.Mesh(clothGeo, clothMat);
  cloth.position.set(x + clothW * 0.5 + 0.002, poleH - clothH * 0.5 + ROAD_Y_OFFSET, z);
  cloth.name = 'town-banner';
  group.add(cloth);

  // Banner sigil: small diamond shape on the cloth
  const sigilMat = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    emissive: 0xcc9900,
    emissiveIntensity: 0.05,
    roughness: 0.4,
    side: THREE.DoubleSide,
  });
  const sigilShape = new THREE.Shape();
  sigilShape.moveTo(0, 0.006);
  sigilShape.lineTo(0.005, 0);
  sigilShape.lineTo(0, -0.006);
  sigilShape.lineTo(-0.005, 0);
  sigilShape.closePath();
  const sigilGeo = new THREE.ShapeGeometry(sigilShape);
  const sigil = new THREE.Mesh(sigilGeo, sigilMat);
  sigil.position.set(x + clothW * 0.5 + 0.002, poleH - clothH * 0.5 + ROAD_Y_OFFSET, z - 0.001);
  group.add(sigil);
}

/**
 * Stage 4: Grand (Level 40-59)
 * Stage 3 + stone archways, seasonal decorations, merchant spawn points.
 */
function buildStage4(group, radius) {
  // Build everything from stage 3 first
  const stage3Data = buildStage3(group, radius);

  // 4 stone archways at cardinal directions
  const archMat = new THREE.MeshStandardMaterial({ color: 0x707070, roughness: 0.6, metalness: 0.1 });
  const garlandMat = new THREE.MeshStandardMaterial({
    color: 0x66aa44,
    roughness: 0.8,
  });

  const archAngles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
  const archR = radius * 0.88;
  const npcSpawnPoints = [];

  for (let ai = 0; ai < archAngles.length; ai++) {
    const a = archAngles[ai];
    const ax = Math.cos(a) * archR;
    const az = Math.sin(a) * archR;

    // Arch: two pillars + curved top
    const pillarH = 0.06;
    const pillarW = 0.008;
    const archSpan = 0.05;

    // Perpendicular direction for pillar offset
    const perpX = -Math.sin(a);
    const perpZ = Math.cos(a);

    // Left pillar
    const lpGeo = new THREE.BoxGeometry(pillarW, pillarH, pillarW);
    const lp = new THREE.Mesh(lpGeo, archMat);
    lp.position.set(
      ax + perpX * archSpan * 0.5,
      pillarH * 0.5 + ROAD_Y_OFFSET,
      az + perpZ * archSpan * 0.5
    );
    lp.castShadow = true;
    group.add(lp);

    // Right pillar
    const rp = new THREE.Mesh(lpGeo.clone(), archMat);
    rp.position.set(
      ax - perpX * archSpan * 0.5,
      pillarH * 0.5 + ROAD_Y_OFFSET,
      az - perpZ * archSpan * 0.5
    );
    rp.castShadow = true;
    group.add(rp);

    // Arch curve: build from a TorusGeometry segment
    const archCurveGeo = new THREE.TorusGeometry(archSpan * 0.5, 0.004, 6, 12, Math.PI);
    const archCurve = new THREE.Mesh(archCurveGeo, archMat);
    archCurve.position.set(ax, pillarH + ROAD_Y_OFFSET, az);
    archCurve.rotation.x = Math.PI / 2;
    archCurve.rotation.z = a + Math.PI / 2;
    archCurve.castShadow = true;
    group.add(archCurve);

    // Seasonal garland decoration on arch
    const garlandGeo = new THREE.TorusGeometry(archSpan * 0.45, 0.003, 4, 10, Math.PI);
    const garland = new THREE.Mesh(garlandGeo, garlandMat);
    garland.position.set(ax, pillarH * 0.85 + ROAD_Y_OFFSET, az);
    garland.rotation.x = Math.PI / 2;
    garland.rotation.z = a + Math.PI / 2;
    group.add(garland);

    // Small flower buds on garland
    const budMat = new THREE.MeshStandardMaterial({ color: 0xff88aa, roughness: 0.7 });
    const budCount = 5;
    for (let bi = 0; bi < budCount; bi++) {
      const bt = (bi + 0.5) / budCount;
      const ba = bt * Math.PI;
      const bx = ax + perpX * Math.cos(ba) * archSpan * 0.45;
      const bz = az + perpZ * Math.cos(ba) * archSpan * 0.45;
      const by = pillarH * 0.85 + Math.sin(ba) * archSpan * 0.45 + ROAD_Y_OFFSET;

      const budGeo = new THREE.SphereGeometry(0.003, 4, 3);
      const bud = new THREE.Mesh(budGeo, budMat);
      bud.position.set(bx, by, bz);
      group.add(bud);
    }

    // Merchant NPC spawn points near archways (inner side)
    const spawnDist = archR - 0.06;
    npcSpawnPoints.push({
      x: Math.cos(a) * spawnDist,
      z: Math.sin(a) * spawnDist,
      type: 'merchant',
    });
  }

  // Decorative cobblestone pattern on ground (vertex color rings)
  // Add a ring pattern via a second circle mesh with vertex colors
  const ringGeo = new THREE.RingGeometry(radius * 0.3, radius * 0.35, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x555555,
    roughness: 0.7,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = ROAD_Y_OFFSET + 0.001;
  ring.receiveShadow = true;
  group.add(ring);

  // Second decorative ring
  const ring2Geo = new THREE.RingGeometry(radius * 0.55, radius * 0.58, 32);
  ring2Geo.rotateX(-Math.PI / 2);
  const ring2 = new THREE.Mesh(ring2Geo, ringMat);
  ring2.position.y = ROAD_Y_OFFSET + 0.001;
  ring2.receiveShadow = true;
  group.add(ring2);

  return {
    lampPositions: stage3Data.lampPositions,
    fountainData: stage3Data.fountainData,
    groundMat: stage3Data.groundMat,
    npcSpawnPoints,
  };
}

/**
 * Stage 5: Monumental (Level 60+)
 * Stage 4 + golden trim, floating runic orbs, eternal flame, ground glow.
 */
function buildStage5(group, radius) {
  // Build everything from stage 4
  const stage4Data = buildStage4(group, radius);

  // Golden trim on archways
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    emissive: 0xcc9900,
    emissiveIntensity: 0.1,
    roughness: 0.2,
    metalness: 0.8,
  });

  const archAngles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
  const archR = radius * 0.88;
  const archSpan = 0.05;

  for (let ai = 0; ai < archAngles.length; ai++) {
    const a = archAngles[ai];
    const ax = Math.cos(a) * archR;
    const az = Math.sin(a) * archR;
    const pillarH = 0.06;

    // Gold trim strip on top of arch
    const trimGeo = new THREE.TorusGeometry(archSpan * 0.5, 0.002, 4, 12, Math.PI);
    const trim = new THREE.Mesh(trimGeo, goldMat);
    trim.position.set(ax, pillarH + 0.005 + ROAD_Y_OFFSET, az);
    trim.rotation.x = Math.PI / 2;
    trim.rotation.z = a + Math.PI / 2;
    group.add(trim);

    // Gold caps on pillar tops
    const perpX = -Math.sin(a);
    const perpZ = Math.cos(a);
    const capGeo = new THREE.BoxGeometry(0.012, 0.004, 0.012);

    const capL = new THREE.Mesh(capGeo, goldMat);
    capL.position.set(
      ax + perpX * archSpan * 0.5,
      pillarH + 0.002 + ROAD_Y_OFFSET,
      az + perpZ * archSpan * 0.5
    );
    group.add(capL);

    const capR = new THREE.Mesh(capGeo.clone(), goldMat);
    capR.position.set(
      ax - perpX * archSpan * 0.5,
      pillarH + 0.002 + ROAD_Y_OFFSET,
      az - perpZ * archSpan * 0.5
    );
    group.add(capR);
  }

  // Decorative orbs (6, evenly spaced — subtle, not glowing)
  const orbMat = new THREE.MeshStandardMaterial({
    color: 0x6644ff,
    emissive: 0x4422cc,
    emissiveIntensity: 0.08,
    roughness: 0.15,
    metalness: 0.3,
    transparent: true,
    opacity: 0.85,
  });

  const orbCount = 6;
  const orbR = radius * 0.5;
  const orbs = [];

  for (let oi = 0; oi < orbCount; oi++) {
    const oa = (oi / orbCount) * Math.PI * 2;
    const ox = Math.cos(oa) * orbR;
    const oz = Math.sin(oa) * orbR;

    const orbGeo = new THREE.SphereGeometry(0.008, 8, 6);
    const orb = new THREE.Mesh(orbGeo, orbMat.clone());
    orb.position.set(ox, ORB_FLOAT_HEIGHT + ROAD_Y_OFFSET, oz);
    orb.name = 'runic-orb';
    orb.userData.orbIndex = oi;
    orb.userData.baseY = ORB_FLOAT_HEIGHT + ROAD_Y_OFFSET;
    orb.userData.phaseOffset = oa;
    group.add(orb);
    orbs.push(orb);

    // No glow ring — orb is sufficient on its own
  }

  // Eternal flame centerpiece (warm, not glowing)
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0xff3300,
    emissive: 0xff5500,
    emissiveIntensity: 0.15,
    roughness: 1.0,
    transparent: true,
    opacity: 0.8,
  });

  const flameGeo = new THREE.ConeGeometry(0.015, 0.05, 8);
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.set(0, 0.1 + ROAD_Y_OFFSET, 0);
  flame.name = 'eternal-flame';
  group.add(flame);

  const innerFlameMat = new THREE.MeshStandardMaterial({
    color: 0xffcc00,
    emissive: 0xffaa00,
    emissiveIntensity: 0.2,
    roughness: 1.0,
    transparent: true,
    opacity: 0.7,
  });
  const innerFlameGeo = new THREE.ConeGeometry(0.009, 0.035, 6);
  const innerFlame = new THREE.Mesh(innerFlameGeo, innerFlameMat);
  innerFlame.position.set(0, 0.095 + ROAD_Y_OFFSET, 0);
  innerFlame.name = 'eternal-flame-inner';
  group.add(innerFlame);

  // Flame base (brazier)
  const brazierMat = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    roughness: 0.3,
    metalness: 0.7,
  });
  const brazierGeo = new THREE.CylinderGeometry(0.018, 0.014, 0.015, 8);
  const brazier = new THREE.Mesh(brazierGeo, brazierMat);
  brazier.position.set(0, 0.075 + ROAD_Y_OFFSET, 0);
  brazier.castShadow = true;
  group.add(brazier);

  // Ground pattern (subtle, not glowing)
  const glowGroundMat = new THREE.MeshStandardMaterial({
    color: 0x332244,
    emissive: 0x221133,
    emissiveIntensity: 0.05,
    roughness: 0.9,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });

  // Inner glow ring
  const glowRing1Geo = new THREE.RingGeometry(0.05, 0.08, 32);
  glowRing1Geo.rotateX(-Math.PI / 2);
  const glowRing1 = new THREE.Mesh(glowRing1Geo, glowGroundMat);
  glowRing1.position.y = ROAD_Y_OFFSET + 0.002;
  group.add(glowRing1);

  // Outer glow ring
  const glowRing2Geo = new THREE.RingGeometry(0.12, 0.14, 32);
  glowRing2Geo.rotateX(-Math.PI / 2);
  const glowRing2 = new THREE.Mesh(glowRing2Geo, glowGroundMat.clone());
  glowRing2.position.y = ROAD_Y_OFFSET + 0.002;
  group.add(glowRing2);

  // Rune circle on ground (star pattern via lines)
  const runePoints = [];
  const runeR = 0.1;
  const runeCount = 8;
  for (let ri = 0; ri < runeCount; ri++) {
    const ra1 = (ri / runeCount) * Math.PI * 2;
    const ra2 = ((ri + 3) / runeCount) * Math.PI * 2;
    runePoints.push(new THREE.Vector3(Math.cos(ra1) * runeR, ROAD_Y_OFFSET + 0.003, Math.sin(ra1) * runeR));
    runePoints.push(new THREE.Vector3(Math.cos(ra2) * runeR, ROAD_Y_OFFSET + 0.003, Math.sin(ra2) * runeR));
  }
  const runeLineGeo = new THREE.BufferGeometry().setFromPoints(runePoints);
  const runeLineMat = new THREE.LineBasicMaterial({
    color: 0x6644ff,
    transparent: true,
    opacity: 0.5,
  });
  const runeLines = new THREE.LineSegments(runeLineGeo, runeLineMat);
  runeLines.name = 'ground-runes';
  group.add(runeLines);

  return {
    lampPositions: stage4Data.lampPositions,
    fountainData: stage4Data.fountainData,
    groundMat: stage4Data.groundMat,
    npcSpawnPoints: stage4Data.npcSpawnPoints,
    orbs,
  };
}

// ---------------------------------------------------------------------------
// Activity board builder
// ---------------------------------------------------------------------------

/**
 * Build the activity board with 3 rune indicators.
 * Returns { boardGroup, runes: [{ mesh, glowMat, checkMesh }] }
 */
function buildActivityBoard(x, z) {
  const boardGroup = new THREE.Group();
  boardGroup.name = 'activity-board';
  boardGroup.position.set(x, 0, z);

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.9 });

  // Post
  const postH = 0.06;
  const postGeo = new THREE.CylinderGeometry(0.003, 0.004, postH, 5);
  const post = new THREE.Mesh(postGeo, woodMat);
  post.position.set(0, postH * 0.5 + ROAD_Y_OFFSET, 0);
  post.castShadow = true;
  boardGroup.add(post);

  // Board (rectangular)
  const boardW = 0.025;
  const boardH = 0.035;
  const boardGeo = new THREE.BoxGeometry(boardW, boardH, 0.003);
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.85 });
  const board = new THREE.Mesh(boardGeo, boardMat);
  board.position.set(0, postH - boardH * 0.3 + ROAD_Y_OFFSET, 0);
  board.castShadow = true;
  boardGroup.add(board);

  // 3 rune indicators: Dawn (top), Midday (middle), Dusk (bottom)
  const runeLabels = ['dawn', 'midday', 'dusk'];
  const runeColors = [0xffcc00, 0xffaa00, 0xff6600];
  const runes = [];
  const runeSpacing = 0.01;
  const startY = postH - boardH * 0.3 + runeSpacing + ROAD_Y_OFFSET;

  for (let ri = 0; ri < 3; ri++) {
    const ry = startY + (1 - ri) * runeSpacing;

    // Rune symbol: small diamond shape
    const runeGlowMat = new THREE.MeshStandardMaterial({
      color: runeColors[ri],
      emissive: runeColors[ri],
      emissiveIntensity: 0.0, // starts inactive
      roughness: 0.4,
      side: THREE.DoubleSide,
    });

    const runeShape = new THREE.Shape();
    runeShape.moveTo(0, 0.003);
    runeShape.lineTo(0.003, 0);
    runeShape.lineTo(0, -0.003);
    runeShape.lineTo(-0.003, 0);
    runeShape.closePath();

    const runeGeo = new THREE.ShapeGeometry(runeShape);
    const rune = new THREE.Mesh(runeGeo, runeGlowMat);
    rune.position.set(0, ry, -0.002);
    rune.name = `rune-${runeLabels[ri]}`;
    boardGroup.add(rune);

    // Checkmark overlay (V shape, initially invisible)
    const checkPoints = [
      new THREE.Vector3(-0.002, 0.001, -0.003),
      new THREE.Vector3(0, -0.001, -0.003),
      new THREE.Vector3(0.003, 0.003, -0.003),
    ];
    const checkGeo = new THREE.BufferGeometry().setFromPoints(checkPoints);
    const checkMat = new THREE.LineBasicMaterial({ color: 0x00ff00 });
    const checkLine = new THREE.Line(checkGeo, checkMat);
    checkLine.position.set(0.005, ry, 0);
    checkLine.visible = false;
    checkLine.name = `check-${runeLabels[ri]}`;
    boardGroup.add(checkLine);

    runes.push({
      mesh: rune,
      glowMat: runeGlowMat,
      checkMesh: checkLine,
      label: runeLabels[ri],
    });
  }

  return { boardGroup, runes };
}

// ---------------------------------------------------------------------------
// Milestone decorations
// ---------------------------------------------------------------------------

/**
 * Build milestone-specific visual decorations.
 */
function buildMilestoneDecorations(group, milestones, radius) {
  if (!milestones) return;

  const milestoneGroup = new THREE.Group();
  milestoneGroup.name = 'milestones';

  // First building completed: notice board
  if (milestones.firstBuilding) {
    const boardX = radius * 0.6;
    const boardZ = -radius * 0.1;
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.85 });

    const nbPostGeo = new THREE.CylinderGeometry(0.003, 0.004, 0.05, 5);
    const nbPost = new THREE.Mesh(nbPostGeo, woodMat);
    nbPost.position.set(boardX, 0.025 + ROAD_Y_OFFSET, boardZ);
    nbPost.castShadow = true;
    milestoneGroup.add(nbPost);

    const nbBoardGeo = new THREE.BoxGeometry(0.04, 0.025, 0.002);
    const nbBoard = new THREE.Mesh(nbBoardGeo, woodMat);
    nbBoard.position.set(boardX, 0.05 + ROAD_Y_OFFSET, boardZ);
    nbBoard.castShadow = true;
    milestoneGroup.add(nbBoard);

    // Small paper notes on board
    const noteMat = new THREE.MeshStandardMaterial({ color: 0xffffee, roughness: 0.7, side: THREE.DoubleSide });
    const notePositions = [[-0.01, 0.003], [0.005, -0.005], [0.012, 0.005]];
    for (const [nx, ny] of notePositions) {
      const noteGeo = new THREE.PlaneGeometry(0.008, 0.006);
      const note = new THREE.Mesh(noteGeo, noteMat);
      note.position.set(boardX + nx, 0.05 + ny + ROAD_Y_OFFSET, boardZ - 0.002);
      milestoneGroup.add(note);
    }
  }

  // All Tier 1 buildings: stone walls around first district
  if (milestones.allTier1) {
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 });
    const wallSegments = 12;
    const wallR = radius * 0.65;
    const wallH = 0.02;

    for (let wi = 0; wi < wallSegments; wi++) {
      const a1 = (wi / wallSegments) * Math.PI * 2;
      const a2 = ((wi + 1) / wallSegments) * Math.PI * 2;

      // Skip segments near cardinal directions (gate gaps)
      const midAngle = (a1 + a2) * 0.5;
      const isGap = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5].some(ga =>
        Math.abs(((midAngle - ga + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.35
      );
      if (isGap) continue;

      const x1 = Math.cos(a1) * wallR;
      const z1 = Math.sin(a1) * wallR;
      const x2 = Math.cos(a2) * wallR;
      const z2 = Math.sin(a2) * wallR;

      const segLen = Math.sqrt((x2 - x1) * (x2 - x1) + (z2 - z1) * (z2 - z1));
      const segAngle = Math.atan2(x2 - x1, z2 - z1);

      const wallGeo = new THREE.BoxGeometry(0.004, wallH, segLen);
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(
        (x1 + x2) * 0.5,
        wallH * 0.5 + ROAD_Y_OFFSET,
        (z1 + z2) * 0.5
      );
      wall.rotation.y = segAngle;
      wall.castShadow = true;
      wall.receiveShadow = true;
      milestoneGroup.add(wall);
    }
  }

  // All Tier 2 buildings: gate with player name
  if (milestones.allTier2) {
    const gateMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.6, metalness: 0.3 });
    const gateX = 0;
    const gateZ = radius * 0.9;
    const gateH = 0.07;
    const gateSpan = 0.06;

    // Gate pillars
    const gpGeo = new THREE.BoxGeometry(0.01, gateH, 0.01);
    const gpl = new THREE.Mesh(gpGeo, gateMat);
    gpl.position.set(gateX - gateSpan * 0.5, gateH * 0.5 + ROAD_Y_OFFSET, gateZ);
    gpl.castShadow = true;
    milestoneGroup.add(gpl);

    const gpr = new THREE.Mesh(gpGeo.clone(), gateMat);
    gpr.position.set(gateX + gateSpan * 0.5, gateH * 0.5 + ROAD_Y_OFFSET, gateZ);
    gpr.castShadow = true;
    milestoneGroup.add(gpr);

    // Gate arch
    const gateArchGeo = new THREE.TorusGeometry(gateSpan * 0.5, 0.005, 6, 12, Math.PI);
    const gateArch = new THREE.Mesh(gateArchGeo, gateMat);
    gateArch.position.set(gateX, gateH + ROAD_Y_OFFSET, gateZ);
    gateArch.rotation.y = Math.PI / 2;
    gateArch.rotation.x = Math.PI / 2;
    gateArch.castShadow = true;
    milestoneGroup.add(gateArch);

    // Name plate (blank -- player name would be applied via texture)
    const plateMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      roughness: 0.3,
      metalness: 0.6,
    });
    const plateGeo = new THREE.BoxGeometry(gateSpan * 0.6, 0.008, 0.002);
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.set(gateX, gateH + 0.01 + ROAD_Y_OFFSET, gateZ - 0.006);
    plate.name = 'gate-nameplate';
    milestoneGroup.add(plate);
  }

  // All 13 buildings: Master Builder subtle golden ring
  if (milestones.masterBuilder) {
    const auraMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      emissive: 0xccaa00,
      emissiveIntensity: 0.05,
      roughness: 0.2,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
    });
    const auraGeo = new THREE.SphereGeometry(radius * 0.7, 16, 12);
    const aura = new THREE.Mesh(auraGeo, auraMat);
    aura.position.y = 0.03;
    aura.name = 'master-builder-aura';
    milestoneGroup.add(aura);
  }

  // Any building level 10: flag pole with level banner
  if (milestones.anyLevel10) {
    const flagX = -radius * 0.5;
    const flagZ = radius * 0.5;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5, metalness: 0.4 });
    const flagMat = new THREE.MeshStandardMaterial({
      color: 0x2266cc,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });

    const flagPoleH = 0.1;
    const fpGeo = new THREE.CylinderGeometry(0.002, 0.003, flagPoleH, 5);
    const fp = new THREE.Mesh(fpGeo, poleMat);
    fp.position.set(flagX, flagPoleH * 0.5 + ROAD_Y_OFFSET, flagZ);
    fp.castShadow = true;
    milestoneGroup.add(fp);

    const flagGeo = new THREE.PlaneGeometry(0.025, 0.015, 4, 2);
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(flagX + 0.015, flagPoleH * 0.9 + ROAD_Y_OFFSET, flagZ);
    flag.name = 'level-banner';
    milestoneGroup.add(flag);
  }

  // Any building level 20: golden roof trim, legendary halo
  if (milestones.anyLevel20) {
    const haloMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      emissive: 0xccaa00,
      emissiveIntensity: 0.08,
      roughness: 0.2,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });
    const haloGeo = new THREE.TorusGeometry(0.05, 0.003, 6, 24);
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.set(0, 0.14 + ROAD_Y_OFFSET, 0);
    halo.rotation.x = Math.PI / 2;
    halo.name = 'legendary-halo';
    milestoneGroup.add(halo);
  }

  // 180-day login streak: eternal flame (if not already from stage 5)
  if (milestones.eternalFlame) {
    // Only add if not already at stage 5
    const existingFlame = group.getObjectByName('eternal-flame');
    if (!existingFlame) {
      const flameMat = new THREE.MeshStandardMaterial({
        color: 0xff4400,
        emissive: 0xff5500,
        emissiveIntensity: 0.15,
        roughness: 1.0,
        transparent: true,
        opacity: 0.8,
      });
      const flameGeo = new THREE.ConeGeometry(0.012, 0.04, 7);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(0, 0.09 + ROAD_Y_OFFSET, 0);
      flame.name = 'eternal-flame';
      milestoneGroup.add(flame);
    }
  }

  group.add(milestoneGroup);
}

// ---------------------------------------------------------------------------
// TownSquare class
// ---------------------------------------------------------------------------

export class TownSquare {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [options]
   * @param {number} [options.x] - X position of town square center
   * @param {number} [options.z] - Z position of town square center
   */
  constructor(scene, options = {}) {
    this._scene = scene;
    this._centerX = options.x || 0;
    this._centerZ = options.z || 0;
    this._group = null;
    this._stage = -1;
    this._estateLevel = 0;
    this._lampPositions = [];
    this._npcSpawnPoints = [];
    this._orbs = [];
    this._flames = [];
    this._fountainWaterSurfaces = [];
    this._activityBoard = null;
    this._milestoneGroup = null;
    this._goldenFountain = false;
    this._time = 0;
    this._groundMat = null;
    this._fountainStoneMat = null;
    this._textures = null;
  }

  /**
   * Build the town square for the current estate level.
   * @param {number} estateLevel
   * @param {object} [options]
   * @param {number} [options.windowsCompleted] - Bitflag 0b00000DML (Dawn=4, Midday=2, Dusk=1)
   * @param {number} [options.loginStreak] - Login streak days
   * @param {number} [options.permanentBonus] - Permanent bonus value
   * @param {object} [options.milestones] - Milestone achievement flags
   * @returns {THREE.Group}
   */
  build(estateLevel, options = {}) {
    this.dispose();

    const level = Math.max(1, estateLevel || 1);
    this._estateLevel = level;
    this._stage = getStage(level);

    this._group = new THREE.Group();
    this._group.name = 'town-square';
    this._group.position.set(this._centerX, 0, this._centerZ);

    const stage = this._stage;
    const radius = GROUND_RADIUS[stage];
    let stageData;

    switch (stage) {
      case 0:
        stageData = buildStage1(this._group, radius);
        break;
      case 1:
        stageData = buildStage2(this._group, radius);
        break;
      case 2:
        stageData = buildStage3(this._group, radius);
        break;
      case 3:
        stageData = buildStage4(this._group, radius);
        break;
      case 4:
        stageData = buildStage5(this._group, radius);
        break;
    }

    this._lampPositions = stageData.lampPositions || [];
    this._npcSpawnPoints = stageData.npcSpawnPoints || [];

    // Store swappable material references for texture upgrades
    this._groundMat = stageData.groundMat || null;
    this._fountainStoneMat = (stageData.fountainData && stageData.fountainData.stoneMat) || null;

    // Store fountain water surfaces for golden fountain effect
    if (stageData.fountainData && stageData.fountainData.waterSurfaces) {
      this._fountainWaterSurfaces = stageData.fountainData.waterSurfaces;
    }

    // Store orbs for animation
    if (stageData.orbs) {
      this._orbs = stageData.orbs;
    }

    // Collect flame references for animation
    this._flames = [];
    this._group.traverse((child) => {
      if (child.name === 'campfire' || child.name === 'campfire-inner' ||
          child.name === 'eternal-flame' || child.name === 'eternal-flame-inner') {
        this._flames.push(child);
      }
    });

    // Activity board (always present from stage 1+)
    const boardX = radius * 0.65;
    const boardZ = radius * 0.15;
    this._activityBoard = buildActivityBoard(boardX, boardZ);
    this._group.add(this._activityBoard.boardGroup);

    // Apply initial activity board state
    if (options.windowsCompleted !== undefined) {
      this.updateActivityBoard(options.windowsCompleted);
    }

    // Milestone decorations
    if (options.milestones) {
      buildMilestoneDecorations(this._group, options.milestones, radius);
    }

    // Eternal flame from login streak milestone
    if (options.permanentBonus > 0 || (options.loginStreak && options.loginStreak >= 180)) {
      const existing = this._group.getObjectByName('eternal-flame');
      if (!existing) {
        buildMilestoneDecorations(this._group, { eternalFlame: true }, radius);
        // Re-collect flames
        this._flames = [];
        this._group.traverse((child) => {
          if (child.name === 'campfire' || child.name === 'campfire-inner' ||
              child.name === 'eternal-flame' || child.name === 'eternal-flame-inner') {
            this._flames.push(child);
          }
        });
      }
    }

    this._scene.add(this._group);
    return this._group;
  }

  /**
   * Update stage when estate level changes (full rebuild).
   * @param {number} estateLevel
   */
  updateStage(estateLevel) {
    const newStage = getStage(estateLevel);
    if (newStage === this._stage && this._group) return;

    // Preserve current activity board state
    let windowsState = 0;
    if (this._activityBoard) {
      for (let i = 0; i < this._activityBoard.runes.length; i++) {
        const rune = this._activityBoard.runes[i];
        if (rune.glowMat.emissiveIntensity > 0.5) {
          windowsState |= (4 >> i); // Dawn=4, Midday=2, Dusk=1
        }
      }
    }

    this.build(estateLevel, { windowsCompleted: windowsState });
  }

  /**
   * Update daily activity indicators.
   * @param {number} windowsCompleted - Bitflag 0b00000DML (Dawn=bit2, Midday=bit1, dusk=bit0)
   */
  updateActivityBoard(windowsCompleted) {
    if (!this._activityBoard) return;

    const flags = windowsCompleted || 0;
    const runes = this._activityBoard.runes;

    // Dawn = bit 2 (0b100 = 4)
    const dawnActive = (flags & 4) !== 0;
    runes[0].glowMat.emissiveIntensity = dawnActive ? 0.2 : 0.0;
    runes[0].checkMesh.visible = dawnActive;

    // Midday = bit 1 (0b010 = 2)
    const middayActive = (flags & 2) !== 0;
    runes[1].glowMat.emissiveIntensity = middayActive ? 0.2 : 0.0;
    runes[1].checkMesh.visible = middayActive;

    // Dusk = bit 0 (0b001 = 1)
    const duskActive = (flags & 1) !== 0;
    runes[2].glowMat.emissiveIntensity = duskActive ? 0.2 : 0.0;
    runes[2].checkMesh.visible = duskActive;

    // Golden fountain: all three windows completed (flags === 7)
    const allCompleted = flags === 7;
    if (allCompleted !== this._goldenFountain) {
      this._goldenFountain = allCompleted;
      this._updateFountainColor(allCompleted);
    }
  }

  /**
   * Update milestone decorations.
   * @param {object} milestones
   *   { firstBuilding, allTier1, firstTier2, allTier2, firstTier3, masterBuilder,
   *     anyLevel10, anyLevel20, eternalFlame }
   */
  updateMilestones(milestones) {
    if (!this._group) return;

    // Remove existing milestone group
    const existing = this._group.getObjectByName('milestones');
    if (existing) {
      disposeGroup(existing);
    }

    const radius = GROUND_RADIUS[this._stage];
    buildMilestoneDecorations(this._group, milestones, radius);

    // Recollect flames (eternal flame might have been added)
    this._flames = [];
    this._group.traverse((child) => {
      if (child.name === 'campfire' || child.name === 'campfire-inner' ||
          child.name === 'eternal-flame' || child.name === 'eternal-flame-inner') {
        this._flames.push(child);
      }
    });
  }

  /**
   * Set PBR texture map for town square materials (fire-and-forget).
   * Applies textures to ground disc and fountain metalwork based on current stage.
   * @param {Map<string, object>} textureMap - packName → PBR set
   */
  setTextures(textureMap) {
    if (!textureMap) return;
    this._textures = textureMap;

    // Stage → ground texture pack mapping
    const GROUND_PACKS = [
      'ground-dirt',    // Stage 0 (Camp)
      'stone-pebbles',  // Stage 1 (Cobblestone)
      'stone-paving',   // Stage 2 (Proper)
      'tile-floor',     // Stage 3 (Grand)
      'stone-marble',   // Stage 4 (Monumental)
    ];

    // Apply ground texture
    const groundPack = GROUND_PACKS[this._stage];
    const groundSet = groundPack ? textureMap.get(groundPack) : null;
    if (groundSet && this._groundMat) {
      if (groundSet.map) this._groundMat.map = groundSet.map;
      if (groundSet.normalMap) {
        this._groundMat.normalMap = groundSet.normalMap;
        this._groundMat.normalScale = new THREE.Vector2(1, 1);
      }
      if (groundSet.roughnessMap) {
        this._groundMat.roughnessMap = groundSet.roughnessMap;
        this._groundMat.roughness = 1.0;
      }
      if (groundSet.aoMap) this._groundMat.aoMap = groundSet.aoMap;
      this._groundMat.needsUpdate = true;
    }

    // Apply metal-ornate to fountain stone (stages 2+)
    if (this._stage >= 2 && this._fountainStoneMat) {
      const metalSet = textureMap.get('metal-ornate');
      if (metalSet) {
        if (metalSet.map) this._fountainStoneMat.map = metalSet.map;
        if (metalSet.normalMap) {
          this._fountainStoneMat.normalMap = metalSet.normalMap;
          this._fountainStoneMat.normalScale = new THREE.Vector2(0.8, 0.8);
        }
        if (metalSet.roughnessMap) {
          this._fountainStoneMat.roughnessMap = metalSet.roughnessMap;
          this._fountainStoneMat.roughness = 1.0;
        }
        this._fountainStoneMat.needsUpdate = true;
      }
    }
  }

  /**
   * Get lamp post positions for DayNightCycle torch registration.
   * @returns {Array<{ x: number, y: number, z: number }>}
   */
  getLampPositions() {
    return this._lampPositions.map(p => ({
      x: p.x + this._centerX,
      y: p.y,
      z: p.z + this._centerZ,
    }));
  }

  /**
   * Get NPC spawn points for NPCManager.
   * @returns {Array<{ x: number, z: number, type: string }>}
   */
  getNPCSpawnPoints() {
    return this._npcSpawnPoints.map(p => ({
      x: p.x + this._centerX,
      z: p.z + this._centerZ,
      type: p.type,
    }));
  }

  /**
   * Get the town square group.
   * @returns {THREE.Group|null}
   */
  getGroup() {
    return this._group;
  }

  /**
   * Per-frame update: animate floating orbs, flame flicker.
   * @param {number} deltaTime - Seconds since last frame
   */
  update(deltaTime) {
    if (!this._group) return;

    this._time += deltaTime;
    const t = this._time;

    // Floating runic orbs: bob up and down
    for (let i = 0; i < this._orbs.length; i++) {
      const orb = this._orbs[i];
      if (!orb || !orb.userData) continue;

      const baseY = orb.userData.baseY;
      const phase = orb.userData.phaseOffset || 0;
      const newY = baseY + Math.sin(t * ORB_BOB_SPEED + phase) * ORB_BOB_AMPLITUDE;
      orb.position.y = newY;

      // Also rotate the orb slowly
      orb.rotation.y = t * 0.5 + phase;
    }

    // Also update orb glow rings to match orb positions
    if (this._group) {
      this._group.traverse((child) => {
        if (child.name === 'orb-glow' && child.userData && child.userData.baseY !== undefined) {
          const baseY = child.userData.baseY;
          const phase = child.userData.phaseOffset || 0;
          child.position.y = baseY + Math.sin(t * ORB_BOB_SPEED + phase) * ORB_BOB_AMPLITUDE;
        }
      });
    }

    // Flame flicker animation
    for (let i = 0; i < this._flames.length; i++) {
      const flame = this._flames[i];
      if (!flame || !flame.material) continue;

      // Scale flicker
      const flicker = 0.85 + Math.sin(t * FLAME_FLICKER_SPEED + i * 1.7) * 0.1
                        + Math.sin(t * FLAME_FLICKER_SPEED * 2.3 + i * 0.9) * 0.05;
      flame.scale.set(flicker, 0.9 + Math.sin(t * FLAME_FLICKER_SPEED * 1.5 + i) * 0.1, flicker);

      // Subtle flicker
      const emFlicker = 0.15 + Math.sin(t * FLAME_FLICKER_SPEED * 1.1 + i * 2.3) * 0.05;
      flame.material.emissiveIntensity = Math.max(0.1, emFlicker);
    }
  }

  /**
   * Update fountain water surfaces to golden or normal color.
   */
  _updateFountainColor(golden) {
    for (const surface of this._fountainWaterSurfaces) {
      if (!surface || !surface.material) continue;
      if (golden) {
        surface.material.color.setHex(GOLDEN_WATER_COLOR);
        surface.material.emissive.setHex(0xcc9900);
        surface.material.emissiveIntensity = 0.08;
      } else {
        surface.material.color.setHex(0x3388cc);
        surface.material.emissive.setHex(0x112244);
        surface.material.emissiveIntensity = 0.03;
      }
      surface.material.needsUpdate = true;
    }
  }

  /**
   * Dispose all GPU resources.
   */
  dispose() {
    if (this._group) {
      this._group.traverse((child) => {
        if (child.isMesh) disposeMesh(child);
        if (child.isLine) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        }
      });
      if (this._group.parent) {
        this._group.parent.remove(this._group);
      }
      this._group = null;
    }

    this._lampPositions = [];
    this._npcSpawnPoints = [];
    this._orbs = [];
    this._flames = [];
    this._fountainWaterSurfaces = [];
    this._activityBoard = null;
    this._milestoneGroup = null;
    this._goldenFountain = false;
    this._stage = -1;
    this._time = 0;
    this._groundMat = null;
    this._fountainStoneMat = null;
    this._textures = null;
  }
}
