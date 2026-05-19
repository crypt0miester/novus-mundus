/**
 * CLI: terrain commands
 *
 * Usage:
 *   terrain preview <city-id>       Render terrain to terminal
 *   terrain export <city-id>        Export anchor config as JSON
 *   terrain set <city-id>           Submit set_terrain instruction
 *   terrain add <city-id>           Append anchors to existing terrain
 */

import { type CliContext, type ParsedArgs } from '../context';
import { log, sendWithRetry } from '../helpers';
import {
  type Anchor,
  type CityTerrain,
  terrainElevation,
  isPassable,
  toGrid,
  radiusToGridUnits,
} from '../../../src/calculators/terrain';
import { createSetTerrainInstruction, createAppendTerrainInstruction } from '../../../src/instructions/initialization';
import { deriveCityPda } from '../../../src/pda';
import * as fs from 'fs';
import * as path from 'path';

// Preset city terrain configs

interface CityPreset {
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  terrain: CityTerrain;
}

const PRESETS: Record<number, CityPreset> = {
  0: {
    name: 'New York City',
    lat: 40.7128, lon: -74.006, radiusKm: 50,
    terrain: {
      seed: 3045891723, waterLine: 88, peakLine: 240, anchorCount: 11, version: 1,
      anchors: [
        { x: -200, y: 150, mass: 78, lift: 180, pushX: 0, pushY: 0 },
        { x: -2000, y: 1500, mass: 82, lift: 180, pushX: 0, pushY: 0 },
        { x: 1500, y: 1200, mass: 85, lift: 175, pushX: 0, pushY: 0 },
        { x: 3500, y: 500, mass: 95, lift: 165, pushX: 0, pushY: 0 },
        { x: 2000, y: -2500, mass: 210, lift: 50, pushX: 0, pushY: 2 },
        { x: 0, y: -3500, mass: 220, lift: 40, pushX: 0, pushY: 1 },
        { x: -2500, y: -2000, mass: 205, lift: 55, pushX: 1, pushY: 1 },
        { x: 4000, y: -1000, mass: 200, lift: 60, pushX: -1, pushY: 1 },
        { x: -3000, y: 2500, mass: 72, lift: 198, pushX: 0, pushY: -1 },
        { x: 1000, y: -800, mass: 130, lift: 130, pushX: 0, pushY: 1 },
        { x: -1200, y: -200, mass: 88, lift: 172, pushX: 0, pushY: 0 },
      ],
    },
  },
  1: {
    name: 'London',
    lat: 51.5074, lon: -0.1278, radiusKm: 40,
    terrain: {
      seed: 1279872052, waterLine: 90, peakLine: 245, anchorCount: 12, version: 1,
      anchors: [
        { x: -200, y: 200, mass: 88, lift: 172, pushX: 0, pushY: 0 },
        { x: 600, y: 800, mass: 85, lift: 168, pushX: 0, pushY: 0 },
        { x: -1200, y: -400, mass: 82, lift: 175, pushX: 0, pushY: 0 },
        { x: -600, y: -2200, mass: 72, lift: 192, pushX: 0, pushY: 2 },
        { x: -1800, y: 1800, mass: 70, lift: 195, pushX: 1, pushY: -1 },
        { x: 700, y: 2500, mass: 80, lift: 178, pushX: 0, pushY: 0 },
        { x: 3200, y: 0, mass: 205, lift: 55, pushX: -2, pushY: 0 },
        { x: 2800, y: -1500, mass: 215, lift: 45, pushX: -1, pushY: 1 },
        { x: 3500, y: 1500, mass: 210, lift: 50, pushX: -2, pushY: -1 },
        { x: 1800, y: -600, mass: 140, lift: 120, pushX: -1, pushY: 0 },
        { x: 4200, y: -2500, mass: 220, lift: 40, pushX: 0, pushY: 0 },
        { x: 200, y: -3200, mass: 78, lift: 185, pushX: 0, pushY: 1 },
      ],
    },
  },
  2: {
    name: 'Tokyo',
    lat: 35.6762, lon: 139.6503, radiusKm: 55,
    terrain: {
      seed: 1953287401, waterLine: 90, peakLine: 235, anchorCount: 11, version: 1,
      anchors: [
        { x: -500, y: 500, mass: 88, lift: 170, pushX: 0, pushY: 0 },
        { x: -2000, y: -500, mass: 85, lift: 175, pushX: 0, pushY: 0 },
        { x: 500, y: 2000, mass: 82, lift: 178, pushX: 0, pushY: 0 },
        { x: 1500, y: -2000, mass: 210, lift: 50, pushX: -1, pushY: 2 },
        { x: 2500, y: -3500, mass: 225, lift: 35, pushX: 0, pushY: 1 },
        { x: -500, y: -3000, mass: 215, lift: 45, pushX: 0, pushY: 2 },
        { x: -3500, y: 0, mass: 65, lift: 215, pushX: 2, pushY: 0 },
        { x: -4200, y: 1500, mass: 60, lift: 220, pushX: 3, pushY: -1 },
        { x: 2000, y: 1500, mass: 90, lift: 168, pushX: 0, pushY: 0 },
        { x: 3000, y: -800, mass: 200, lift: 55, pushX: -1, pushY: 0 },
        { x: 1000, y: -800, mass: 145, lift: 115, pushX: 0, pushY: 1 },
      ],
    },
  },
};

// Handlers

export async function handleTerrain(ctx: CliContext, args: ParsedArgs): Promise<void> {
  const sub = args.target;

  switch (sub) {
    case 'preview':
      return terrainPreview(ctx, args);
    case 'export':
      return terrainExport(args);
    case 'set':
      return terrainSet(ctx, args);
    case 'add':
      return terrainAdd(ctx, args);
    default:
      log.error(`Unknown terrain subcommand: ${sub}`);
      log.info('Usage: terrain <preview|export|set|add> <city-id>');
  }
}

// Preview — ASCII terrain in terminal

function terrainPreview(_ctx: CliContext, args: ParsedArgs): void {
  const cityId = parseCityId(args);
  const preset = getPresetOrFile(cityId, args);

  const cols = 80;
  const rows = 40;
  const radiusGU = radiusToGridUnits(preset.radiusKm, preset.lat);
  const scale = (radiusGU * 2) / cols;

  log.header(`${preset.name} — Terrain Preview`);
  log.info(`Anchors: ${preset.terrain.anchors.length}  Water line: ${preset.terrain.waterLine}  Peak line: ${preset.terrain.peakLine}`);
  log.info(`Radius: ${preset.radiusKm} km (${radiusGU} grid units)\n`);

  let landCount = 0;
  let waterCount = 0;
  let mountainCount = 0;

  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    let line = '';
    for (let col = 0; col < cols; col++) {
      const ox = Math.round((col - cols / 2) * scale);
      const oy = Math.round((rows / 2 - row) * scale);

      if (ox * ox + oy * oy > radiusGU * radiusGU) {
        line += ' ';
        continue;
      }

      const e = terrainElevation(preset.terrain, ox, oy);
      if (e <= preset.terrain.waterLine) {
        line += '~';
        waterCount++;
      } else if (e >= preset.terrain.peakLine) {
        line += '^';
        mountainCount++;
      } else {
        line += '.';
        landCount++;
      }
    }
    lines.push(line);
  }

  for (const l of lines) console.log(l);

  const total = landCount + waterCount + mountainCount;
  console.log();
  log.info(`. = land (${landCount})  ~ = water (${waterCount})  ^ = mountain (${mountainCount})`);
  log.info(`Land: ${((landCount / total) * 100).toFixed(1)}%  Water: ${((waterCount / total) * 100).toFixed(1)}%  Mountain: ${((mountainCount / total) * 100).toFixed(1)}%`);
}

// Export — save config as JSON

function terrainExport(args: ParsedArgs): void {
  const cityId = parseCityId(args);
  const preset = getPresetOrFile(cityId, args);

  const outDir = path.resolve(__dirname, '../../data/terrain');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, `city_${cityId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(preset.terrain, null, 2));
  log.success(`Exported ${preset.name} terrain to ${outPath}`);
  log.info(`  Anchors: ${preset.terrain.anchors.length}`);
}

// Set — submit set_terrain instruction

async function terrainSet(ctx: CliContext, args: ParsedArgs): Promise<void> {
  const cityId = parseCityId(args);
  const preset = getPresetOrFile(cityId, args);

  log.header(`Set terrain for city ${cityId} (${preset.name})`);
  log.info(`  Anchors: ${preset.terrain.anchors.length}`);
  log.info(`  Water line: ${preset.terrain.waterLine}`);
  log.info(`  Peak line: ${preset.terrain.peakLine}`);
  log.info(`  Account size delta: ${16 + preset.terrain.anchors.length * 8} bytes`);

  if (ctx.dryRun) {
    log.info('\n[dry-run] Would submit set_terrain instruction');
    return;
  }

  const ix = await createSetTerrainInstruction(
    { daoAuthority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
    { cityId, terrain: preset.terrain },
  );

  const sig = await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
  if (sig) {
    log.success(`Terrain set — tx: ${sig}`);
  }
}

// Add — append anchors

async function terrainAdd(ctx: CliContext, args: ParsedArgs): Promise<void> {
  const cityId = parseCityId(args);
  const anchorsJson = args.extra?.['anchors'];
  if (!anchorsJson) {
    log.error('Usage: terrain add <city-id> --anchors \'[{"x":0,"y":0,"mass":80,"lift":170,"pushX":0,"pushY":0}]\'');
    return;
  }

  const newAnchors: Anchor[] = JSON.parse(anchorsJson as string);
  log.header(`Add ${newAnchors.length} anchors to city ${cityId}`);

  if (ctx.dryRun) {
    log.info('[dry-run] Would submit append_terrain instruction');
    for (const a of newAnchors) {
      log.info(`  + (${a.x}, ${a.y}) mass=${a.mass} lift=${a.lift} push=(${a.pushX}, ${a.pushY})`);
    }
    return;
  }

  const ix = await createAppendTerrainInstruction(
    { daoAuthority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
    { cityId, anchors: newAnchors },
  );

  const sig = await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
  if (sig) {
    log.success(`Terrain appended — tx: ${sig}`);
  }
}

// Helpers

function parseCityId(args: ParsedArgs): number {
  const raw = args.extra?.['city-id'] ?? args.positional?.[0];
  if (raw === undefined) {
    throw new Error('Missing city-id argument');
  }
  return Number(raw);
}

function getPresetOrFile(cityId: number, args: ParsedArgs): CityPreset {
  // Check for --config flag pointing to a JSON file
  const configPath = args.extra?.['config'] as string | undefined;
  if (configPath) {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      name: data.name ?? `City ${cityId}`,
      lat: data.lat ?? 0,
      lon: data.lon ?? 0,
      radiusKm: data.radiusKm ?? 40,
      terrain: data.terrain ?? data,
    };
  }

  // Use built-in preset
  const preset = PRESETS[cityId];
  if (!preset) {
    throw new Error(`No preset for city ${cityId}. Use --config <path> to load from JSON.`);
  }
  return preset;
}
