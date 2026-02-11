#!/usr/bin/env node
// Generate terrain JSONs for all 50 cities based on their geographic profiles.
// Usage: node generate-terrains.cjs

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const world = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'world.json'), 'utf8'));

// ─── Random helpers ───
function randSeed() { return (Math.random() * 0xFFFFFFFF) >>> 0; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max) { return Math.random() * (max - min) + min; }

// Convert target elevation (0-255) to mass/lift pair
function elevToMassLift(targetElev) {
  targetElev = Math.max(0, Math.min(255, Math.round(targetElev)));
  let mass;
  if (targetElev <= 80) {
    mass = Math.round(230 - targetElev * 0.9);
  } else {
    mass = Math.round(130 - (targetElev - 80) * 0.5);
  }
  mass = Math.max(10, Math.min(240, mass));
  const lift = Math.round((targetElev * 255) / (255 - mass));
  return { mass: Math.max(0, Math.min(255, mass)), lift: Math.max(0, Math.min(255, lift)) };
}

function makeAnchor(x, y, elev, pushX = 0, pushY = 0, moist = 128) {
  const { mass, lift } = elevToMassLift(elev + randInt(-5, 5));
  return {
    x: Math.round(x + randFloat(-40, 40)),
    y: Math.round(y + randFloat(-40, 40)),
    mass, lift,
    pushX: pushX || 0,
    pushY: pushY || 0,
    moisture: Math.max(0, Math.min(255, moist + randInt(-10, 10)))
  };
}

// ─── Profile generators ───
// Each returns { waterLine, peakLine, anchors[] }
// Spread is in game-units based on radiusKm

function genCoastalEast(S) {
  // Land on west, ocean on east
  const anchors = [];
  const a = (x, y, e, px, py, m) => anchors.push(makeAnchor(x * S, y * S, e, px, py, m));

  // Land mass (west side) — temperate moist
  a(-0.5,  0.0,  randInt(125, 155), 0, 0, randInt(150, 190));
  a(-0.4,  0.5,  randInt(130, 160), 0, 0, randInt(155, 195));
  a(-0.4, -0.5,  randInt(120, 150), 0, 0, randInt(145, 185));
  a(-0.6,  0.3,  randInt(140, 175), 0, 0, randInt(160, 200));
  a(-0.3, -0.2,  randInt(115, 140), 0, 0, randInt(140, 180));

  // Hills/highlands further inland
  a(-0.8,  0.0,  randInt(165, 200), 0, 0, randInt(130, 170));
  a(-0.7, -0.4,  randInt(155, 190), 0, 0, randInt(125, 165));

  // Coastal transition
  a(-0.1,  0.3,  randInt(85, 100), -1, 0, randInt(160, 200));
  a(-0.1, -0.3,  randInt(80, 98),  -1, 0, randInt(160, 200));

  // Ocean (east side)
  a( 0.3,  0.0,  randInt(30, 55), 0, 0, 128);
  a( 0.5,  0.5,  randInt(20, 40), 0, 0, 128);
  a( 0.5, -0.5,  randInt(15, 35), 0, 0, 128);
  a( 0.8,  0.0,  randInt(10, 25), 0, 0, 128);

  return { waterLine: randInt(85, 95), peakLine: randInt(235, 248), anchors };
}

function genCoastalWest(S) {
  // Land on east, ocean on west
  const anchors = [];
  const a = (x, y, e, px, py, m) => anchors.push(makeAnchor(x * S, y * S, e, px, py, m));

  // Land mass (east side)
  a( 0.5,  0.0,  randInt(125, 155), 0, 0, randInt(150, 190));
  a( 0.4,  0.5,  randInt(130, 160), 0, 0, randInt(155, 195));
  a( 0.4, -0.5,  randInt(120, 150), 0, 0, randInt(145, 185));
  a( 0.6,  0.3,  randInt(140, 175), 0, 0, randInt(160, 200));
  a( 0.3, -0.2,  randInt(115, 140), 0, 0, randInt(140, 180));

  // Hills
  a( 0.8,  0.0,  randInt(165, 200), 0, 0, randInt(130, 170));
  a( 0.7, -0.4,  randInt(155, 190), 0, 0, randInt(125, 165));

  // Coast
  a( 0.1,  0.3,  randInt(85, 100), 1, 0, randInt(160, 200));
  a( 0.1, -0.3,  randInt(80, 98),  1, 0, randInt(160, 200));

  // Ocean (west side)
  a(-0.3,  0.0,  randInt(30, 55), 0, 0, 128);
  a(-0.5,  0.5,  randInt(20, 40), 0, 0, 128);
  a(-0.5, -0.5,  randInt(15, 35), 0, 0, 128);
  a(-0.8,  0.0,  randInt(10, 25), 0, 0, 128);

  return { waterLine: randInt(85, 95), peakLine: randInt(235, 248), anchors };
}

function genCoastalSouth(S) {
  // Land on north, ocean on south
  const anchors = [];
  const a = (x, y, e, px, py, m) => anchors.push(makeAnchor(x * S, y * S, e, px, py, m));

  // Land mass (north)
  a( 0.0,  0.5,  randInt(125, 155), 0, 0, randInt(150, 190));
  a( 0.5,  0.4,  randInt(130, 160), 0, 0, randInt(155, 195));
  a(-0.5,  0.4,  randInt(120, 150), 0, 0, randInt(145, 185));
  a( 0.3,  0.6,  randInt(140, 175), 0, 0, randInt(160, 200));
  a(-0.2,  0.3,  randInt(115, 140), 0, 0, randInt(140, 180));

  // Hills
  a( 0.0,  0.8,  randInt(165, 200), 0, 0, randInt(130, 170));
  a(-0.4,  0.7,  randInt(155, 190), 0, 0, randInt(125, 165));

  // Coast
  a( 0.3,  0.1,  randInt(85, 100), 0, -1, randInt(160, 200));
  a(-0.3,  0.1,  randInt(80, 98),  0, -1, randInt(160, 200));

  // Ocean (south)
  a( 0.0, -0.3,  randInt(30, 55), 0, 0, 128);
  a( 0.5, -0.5,  randInt(20, 40), 0, 0, 128);
  a(-0.5, -0.5,  randInt(15, 35), 0, 0, 128);
  a( 0.0, -0.8,  randInt(10, 25), 0, 0, 128);

  return { waterLine: randInt(85, 95), peakLine: randInt(235, 248), anchors };
}

function genIsland(S) {
  // Land in center, ocean all around — tropical/humid
  const anchors = [];
  const a = (x, y, e, px, py, m) => anchors.push(makeAnchor(x * S, y * S, e, px, py, m));

  // Central land mass
  a( 0.0,  0.0,  randInt(140, 175), 0, 0, randInt(170, 220));
  a( 0.15, 0.2,  randInt(130, 165), 0, 0, randInt(175, 225));
  a(-0.15,-0.1,  randInt(135, 170), 0, 0, randInt(165, 215));

  // Secondary land bumps
  const bumps = randInt(2, 4);
  for (let i = 0; i < bumps; i++) {
    const angle = (i / bumps) * Math.PI * 2 + randFloat(-0.3, 0.3);
    const dist = randFloat(0.15, 0.35);
    a(Math.cos(angle) * dist, Math.sin(angle) * dist, randInt(110, 155), 0, 0, randInt(160, 210));
  }

  // Optional peak
  if (Math.random() < 0.5) {
    a(randFloat(-0.1, 0.1), randFloat(-0.1, 0.1), randInt(200, 240), 0, 0, randInt(140, 180));
  }

  // Surrounding ocean
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const dist = randFloat(0.6, 0.85);
    a(Math.cos(angle) * dist, Math.sin(angle) * dist, randInt(15, 40), 0, 0, 128);
  }

  return { waterLine: randInt(88, 96), peakLine: randInt(235, 248), anchors };
}

function genMountain(S) {
  // High elevation, peaks, valleys — drier at altitude
  const anchors = [];
  const a = (x, y, e, px, py, m) => anchors.push(makeAnchor(x * S, y * S, e, px, py, m));

  // Mountain peaks — dry/rocky
  a( 0.0,  0.0,  randInt(220, 250), 0, 0, randInt(60, 100));
  a( 0.3,  0.2,  randInt(210, 245), 0, 0, randInt(55, 95));
  a(-0.2,  0.3,  randInt(215, 248), 0, 0, randInt(50, 90));
  a(-0.3, -0.2,  randInt(205, 240), 0, 0, randInt(65, 105));

  // High plateaus/valleys — moderate
  a( 0.4, -0.3,  randInt(155, 185), 0, 0, randInt(90, 130));
  a(-0.4,  0.4,  randInt(150, 180), 0, 0, randInt(95, 135));
  a( 0.1, -0.5,  randInt(140, 170), 0, 0, randInt(100, 140));
  a(-0.5, -0.1,  randInt(145, 175), 0, 0, randInt(95, 135));

  // Foothills — more vegetation
  a( 0.6,  0.5,  randInt(120, 150), 0, 0, randInt(130, 170));
  a(-0.6, -0.5,  randInt(115, 145), 0, 0, randInt(135, 175));

  // Distant lowlands/water
  a( 0.8,  0.0,  randInt(50, 75), 0, 0, randInt(140, 180));
  a(-0.8,  0.0,  randInt(45, 70), 0, 0, randInt(140, 180));
  a( 0.0,  0.9,  randInt(40, 65), 0, 0, 128);

  return { waterLine: randInt(82, 92), peakLine: randInt(230, 245), anchors };
}

function genDesert(S) {
  // Flat, arid terrain — very low moisture
  const anchors = [];
  const a = (x, y, e, px, py, m) => anchors.push(makeAnchor(x * S, y * S, e, px, py, m));

  // Flat desert floor — very arid
  a( 0.0,  0.0,  randInt(100, 118), 0, 0, randInt(10, 30));
  a( 0.3,  0.3,  randInt(98, 115),  0, 0, randInt(8, 25));
  a(-0.3,  0.3,  randInt(100, 120), 0, 0, randInt(12, 32));
  a( 0.3, -0.3,  randInt(95, 112),  0, 0, randInt(10, 28));
  a(-0.3, -0.3,  randInt(100, 118), 0, 0, randInt(8, 25));
  a( 0.0,  0.5,  randInt(98, 116),  0, 0, randInt(10, 30));
  a( 0.0, -0.5,  randInt(96, 114),  0, 0, randInt(12, 32));

  // Dune ridges
  a( 0.5,  0.0,  randInt(120, 145), 0, 0, randInt(5, 20));
  a(-0.5,  0.1,  randInt(118, 140), 0, 0, randInt(5, 20));

  // Distant water/coast on one edge
  a( 0.0,  0.85, randInt(40, 65), 0, 0, randInt(60, 100));
  a( 0.5,  0.8,  randInt(35, 55), 0, 0, randInt(50, 90));
  a(-0.5,  0.85, randInt(30, 50), 0, 0, randInt(50, 90));

  return { waterLine: randInt(80, 90), peakLine: randInt(240, 252), anchors };
}

function genPlains(S) {
  // Flat, rolling terrain — temperate grassland
  const anchors = [];
  const a = (x, y, e, px, py, m) => anchors.push(makeAnchor(x * S, y * S, e, px, py, m));

  // Gentle rolling plains — moderate moisture
  a( 0.0,  0.0,  randInt(118, 145), 0, 0, randInt(100, 145));
  a( 0.4,  0.3,  randInt(115, 140), 0, 0, randInt(95, 140));
  a(-0.3,  0.4,  randInt(120, 148), 0, 0, randInt(105, 150));
  a( 0.3, -0.4,  randInt(112, 138), 0, 0, randInt(90, 135));
  a(-0.4, -0.3,  randInt(118, 142), 0, 0, randInt(100, 145));

  // Gentle hills — slightly drier
  a(-0.6,  0.0,  randInt(155, 185), 0, 0, randInt(110, 150));
  a(-0.5,  0.5,  randInt(148, 178), 0, 0, randInt(115, 155));

  // River valley — moist
  a( 0.1,  0.0,  randInt(95, 108), 0, 0, randInt(170, 210));

  // Distant features
  a( 0.7,  0.0,  randInt(105, 130), 0, 0, randInt(100, 140));
  a( 0.0,  0.7,  randInt(110, 135), 0, 0, randInt(105, 145));
  a( 0.0, -0.7,  randInt(100, 125), 0, 0, randInt(95, 135));

  // One water edge
  a( 0.85, 0.5,  randInt(40, 65), 0, 0, 128);
  a( 0.9, -0.3,  randInt(35, 55), 0, 0, 128);

  return { waterLine: randInt(82, 92), peakLine: randInt(238, 250), anchors };
}

function genTropicalCoast(S) {
  // Low-lying coast — lush tropical vegetation
  const anchors = [];
  const a = (x, y, e, px, py, m) => anchors.push(makeAnchor(x * S, y * S, e, px, py, m));

  // Lowland terrain (north/interior) — very lush
  a( 0.0,  0.3,  randInt(105, 130), 0, 0, randInt(200, 240));
  a( 0.3,  0.4,  randInt(110, 135), 0, 0, randInt(205, 245));
  a(-0.3,  0.5,  randInt(108, 132), 0, 0, randInt(210, 248));
  a( 0.5,  0.2,  randInt(100, 125), 0, 0, randInt(195, 235));
  a(-0.5,  0.3,  randInt(102, 128), 0, 0, randInt(200, 240));

  // Mangrove/delta zone — extremely lush
  a( 0.0,  0.0,  randInt(88, 100), 0, -1, randInt(220, 250));
  a( 0.2, -0.1,  randInt(85, 98),  0, -1, randInt(220, 250));

  // Gentle inland hills
  a( 0.0,  0.7,  randInt(145, 175), 0, 0, randInt(185, 225));
  a(-0.4,  0.7,  randInt(140, 168), 0, 0, randInt(180, 220));

  // Ocean/lagoon (south)
  a( 0.0, -0.4,  randInt(35, 55), 0, 0, 128);
  a( 0.4, -0.5,  randInt(25, 45), 0, 0, 128);
  a(-0.4, -0.5,  randInt(20, 40), 0, 0, 128);
  a( 0.0, -0.8,  randInt(10, 30), 0, 0, 128);

  return { waterLine: randInt(86, 94), peakLine: randInt(238, 250), anchors };
}

// ─── Profile dispatcher ───
const GENERATORS = {
  coastal_east: genCoastalEast,
  coastal_west: genCoastalWest,
  coastal_south: genCoastalSouth,
  island: genIsland,
  mountain: genMountain,
  desert: genDesert,
  plains: genPlains,
  tropical_coast: genTropicalCoast,
};

// ─── Generate all cities ───
let generated = 0;
let skipped = 0;

for (const city of world.cities) {
  const filePath = path.join(DATA_DIR, city.terrain);

  // Skip if file already exists
  if (fs.existsSync(filePath)) {
    console.log(`  skip  ${city.terrain} (exists)`);
    skipped++;
    continue;
  }

  const gen = GENERATORS[city.profile];
  if (!gen) {
    console.log(`  WARN  No generator for profile "${city.profile}" (${city.name})`);
    continue;
  }

  // Spread in game-units from radiusKm
  const S = Math.round(city.radiusKm / 111 * 10000);
  const result = gen(S);

  const terrain = {
    seed: randSeed(),
    waterLine: result.waterLine,
    peakLine: result.peakLine,
    radiusKm: city.radiusKm,
    anchorCount: result.anchors.length,
    version: 1,
    anchors: result.anchors,
  };

  fs.writeFileSync(filePath, JSON.stringify(terrain, null, 2) + '\n');
  console.log(`  gen   ${city.terrain} (${city.profile}, ${result.anchors.length} anchors)`);
  generated++;
}

console.log(`\nDone: ${generated} generated, ${skipped} skipped (already exist)`);
