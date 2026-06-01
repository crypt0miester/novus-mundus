/**
 * Seed-data integrity preflight.
 *
 * The init/update phases trust cli/data/* verbatim and push it straight to
 * chain, so a typo (a bundle pointing at a retired item, a hero meditating in a
 * non-existent city, a dungeon whose floor-power array is the wrong length)
 * only surfaces as a failed tx mid-seed or as silently wrong behaviour for
 * players. This module checks the cross-references and enum ranges that the
 * data files assume but nothing else enforces, so a bad edit fails loudly
 * BEFORE any account is written.
 *
 * Pure + synchronous: no chain calls. `checkSeedData()` returns the findings;
 * `assertSeedDataValid()` prints warnings and throws on errors.
 */

import { HERO_TEMPLATES, RESERVE_HEROES, type HeroTemplateData } from '../data/heroes';
import { SHOP_ITEMS, SHOP_BUNDLES } from '../data/shop-items';
import { CASTLES } from '../data/castles';
import { CITIES } from '../data/cities';
import { DUNGEONS } from '../data/dungeons';
import { BUILDING_TEMPLATES } from '../data/buildings';
import { EVENTS } from '../data/events';
import { log } from './helpers';

export interface SeedDataFindings {
  errors: string[];
  warnings: string[];
}

// On-chain fixed sizes / enum bounds we validate against.
const HERO_NAME_MAX = 32;        // HeroTemplate.name [u8; 32]
const CASTLE_NAME_MAX = 32;      // CastleAccount.name [u8; 32]
const EVENT_NAME_MAX = 64;       // EventAccount.name [u8; 64]
const MAX_BUFFS = 4;             // HeroTemplate.buffs [BuffConfig; 4]
const BUNDLE_ITEMS_MIN = 2;      // create_bundle: item_count 2..=10
const BUNDLE_ITEMS_MAX = 10;
const MAX_BUNDLE_SAVINGS_BPS = 7500; // mirrors create_bundle on-chain cap
const DUNGEON_FLOOR_MAX = 10;    // DungeonTemplate.floor_power [u32; 10]
const ROOM_WEIGHT_TOTAL = 10_000;

/** Collect every id that appears more than once. */
function duplicates(ids: (number | string)[]): (number | string)[] {
  const seen = new Set<number | string>();
  const dups = new Set<number | string>();
  for (const id of ids) {
    if (seen.has(id)) dups.add(id);
    seen.add(id);
  }
  return [...dups];
}

export function checkSeedData(): SeedDataFindings {
  const errors: string[] = [];
  const warnings: string[] = [];

  const cityIds = new Set(CITIES.map(c => c.id));

  // Cities
  {
    const dups = duplicates(CITIES.map(c => c.id));
    if (dups.length) errors.push(`cities: duplicate city id(s) ${dups.join(', ')}`);
    const sorted = [...cityIds].sort((a, b) => a - b);
    sorted.forEach((id, i) => {
      if (id !== i) {
        // Non-contiguous ids are legal but seedForCity / PDA derivation assume
        // a dense 0..N-1 range, so flag it rather than fail.
        warnings.push(`cities: ids are not a contiguous 0..${sorted.length - 1} range (gap near ${id})`);
      }
    });
    for (const c of CITIES) {
      const b = c.biome;
      for (const [k, v] of [['waterLevelDelta', b.waterLevelDelta], ['tempBias', b.tempBias], ['moistureBias', b.moistureBias]] as const) {
        if (v < -128 || v > 127) errors.push(`city ${c.id} (${c.name}): biome.${k}=${v} out of i8 range [-128,127]`);
      }
      if (b.coast < 0 || b.coast > 8) errors.push(`city ${c.id} (${c.name}): biome.coast=${b.coast} out of range [0,8]`);
      if (b.landmassSeed < 0 || b.landmassSeed > 255) errors.push(`city ${c.id} (${c.name}): biome.landmassSeed=${b.landmassSeed} out of u8 range [0,255]`);
    }
  }

  // Heroes — active roster, plus reserve templateId-collision check.
  {
    const dups = duplicates(HERO_TEMPLATES.map(h => h.templateId));
    if (dups.length) errors.push(`heroes: duplicate active templateId(s) ${dups.join(', ')}`);

    const activeIds = new Set(HERO_TEMPLATES.map(h => h.templateId));
    for (const r of RESERVE_HEROES) {
      if (activeIds.has(r.templateId)) {
        errors.push(`heroes: reserve '${r.name}' templateId ${r.templateId} collides with an active hero (activating it would clash on the PDA)`);
      }
    }

    const checkHero = (h: HeroTemplateData, where: string) => {
      if (h.name.length > HERO_NAME_MAX) errors.push(`${where} '${h.name}': name exceeds ${HERO_NAME_MAX} bytes`);
      if (h.heroType < 0 || h.heroType > 3) errors.push(`${where} '${h.name}': heroType=${h.heroType} out of range [0,3]`);
      if (h.category < 0 || h.category > 4) errors.push(`${where} '${h.name}': category=${h.category} out of range [0,4]`);
      if (h.meditationCityId !== 0 && !cityIds.has(h.meditationCityId)) {
        errors.push(`${where} '${h.name}': meditationCityId ${h.meditationCityId} is neither 0 (anywhere) nor a real city`);
      }
      if (h.buffs.length > MAX_BUFFS) errors.push(`${where} '${h.name}': ${h.buffs.length} buffs exceeds on-chain max of ${MAX_BUFFS}`);
      for (const buff of h.buffs) {
        if (buff.stat < 1 || buff.stat > 18) errors.push(`${where} '${h.name}': buff stat ${buff.stat} out of valid range [1,18]`);
      }
      const kind = h.abilityKind ?? 0;
      if (kind < 0 || kind > 6) errors.push(`${where} '${h.name}': abilityKind=${kind} out of range [0,6]`);
      if (kind !== 0 && (h.abilityCooldownSecs ?? 0) <= 0) {
        errors.push(`${where} '${h.name}': abilityKind ${kind} requires abilityCooldownSecs > 0`);
      }
    };
    HERO_TEMPLATES.forEach(h => checkHero(h, 'hero'));
    RESERVE_HEROES.forEach(h => checkHero(h, 'reserve hero'));
  }

  // Shop items + bundles
  {
    const itemDups = duplicates(SHOP_ITEMS.map(i => i.itemId));
    if (itemDups.length) errors.push(`shop: duplicate itemId(s) ${itemDups.join(', ')}`);
    for (const it of SHOP_ITEMS) {
      if (it.rarity < 0 || it.rarity > 4) errors.push(`shop item ${it.itemId} (${it.name}): rarity=${it.rarity} out of range [0,4]`);
      if (it.category < 0 || it.category > 4) errors.push(`shop item ${it.itemId} (${it.name}): category=${it.category} out of range [0,4]`);
      if (it.priceSolLamports <= 0) errors.push(`shop item ${it.itemId} (${it.name}): priceSolLamports must be > 0`);
      if (it.quantityPerPurchase <= 0) errors.push(`shop item ${it.itemId} (${it.name}): quantityPerPurchase must be > 0`);
    }

    const byId = new Map(SHOP_ITEMS.map(i => [i.itemId, i]));
    const bundleDups = duplicates(SHOP_BUNDLES.map(b => b.bundleId));
    if (bundleDups.length) errors.push(`shop: duplicate bundleId(s) ${bundleDups.join(', ')}`);
    for (const b of SHOP_BUNDLES) {
      if (b.items.length < BUNDLE_ITEMS_MIN || b.items.length > BUNDLE_ITEMS_MAX) {
        errors.push(`bundle ${b.bundleId} (${b.name}): item count ${b.items.length} outside on-chain range [${BUNDLE_ITEMS_MIN},${BUNDLE_ITEMS_MAX}]`);
      }
      if (b.savingsBps > MAX_BUNDLE_SAVINGS_BPS) {
        errors.push(`bundle ${b.bundleId} (${b.name}): savingsBps ${b.savingsBps} exceeds cap ${MAX_BUNDLE_SAVINGS_BPS}`);
      }
      for (const bi of b.items) {
        const ref = byId.get(bi.itemId);
        if (!ref) {
          errors.push(`bundle ${b.bundleId} (${b.name}): references itemId ${bi.itemId} which does not exist`);
        } else if (!ref.isActive) {
          errors.push(`bundle ${b.bundleId} (${b.name}): references itemId ${bi.itemId} ('${ref.name}') which is inactive — purchasers would pay for nothing`);
        }
        if (bi.quantity <= 0) errors.push(`bundle ${b.bundleId} (${b.name}): itemId ${bi.itemId} quantity must be > 0`);
      }
    }
  }

  // Castles
  {
    const pairDups = duplicates(CASTLES.map(c => `${c.cityId}:${c.castleId}`));
    if (pairDups.length) errors.push(`castles: duplicate (cityId:castleId) PDA key(s) ${pairDups.join(', ')}`);
    for (const c of CASTLES) {
      if (!cityIds.has(c.cityId)) errors.push(`castle '${c.name}' (city ${c.cityId}, id ${c.castleId}): cityId is not a real city`);
      if (c.tier < 0 || c.tier > 4) errors.push(`castle '${c.name}': tier=${c.tier} out of range [0,4]`);
      if (c.name.length > CASTLE_NAME_MAX) errors.push(`castle '${c.name}': name exceeds ${CASTLE_NAME_MAX} bytes`);
      const fp = c.footprintSize;
      if (fp !== undefined && (fp < 1 || fp > 4)) errors.push(`castle '${c.name}': footprintSize=${fp} out of range [1,4]`);
    }
  }

  // Dungeons
  {
    const dups = duplicates(DUNGEONS.map(d => d.templateId));
    if (dups.length) errors.push(`dungeons: duplicate templateId(s) ${dups.join(', ')}`);
    for (const d of DUNGEONS) {
      if (d.totalFloors > DUNGEON_FLOOR_MAX) errors.push(`dungeon ${d.templateId} (${d.name}): totalFloors ${d.totalFloors} exceeds on-chain floor_power slots (${DUNGEON_FLOOR_MAX})`);
      if (d.floorPower.length !== d.totalFloors) {
        errors.push(`dungeon ${d.templateId} (${d.name}): floorPower has ${d.floorPower.length} entries but totalFloors is ${d.totalFloors}`);
      }
      if (d.theme < 0 || d.theme > 3) errors.push(`dungeon ${d.templateId} (${d.name}): theme=${d.theme} out of range [0,3]`);
      const weightSum = d.combatWeight + d.treasureWeight + d.campWeight + d.restWeight + d.trapWeight;
      if (weightSum !== ROOM_WEIGHT_TOTAL) {
        errors.push(`dungeon ${d.templateId} (${d.name}): room weights sum to ${weightSum}, expected ${ROOM_WEIGHT_TOTAL}`);
      }
    }
  }

  // Buildings
  {
    const dups = duplicates(BUILDING_TEMPLATES.map(b => b.buildingType));
    if (dups.length) errors.push(`buildings: duplicate buildingType(s) ${dups.join(', ')}`);
    for (const b of BUILDING_TEMPLATES) {
      if (b.maxLevel < 1 || b.maxLevel > 255) errors.push(`building ${b.buildingType} (${b.name}): maxLevel=${b.maxLevel} out of u8 range [1,255]`);
      if (b.costGrowthBps < 0 || b.costGrowthBps > 65535) errors.push(`building ${b.buildingType} (${b.name}): costGrowthBps out of u16 range`);
      if (b.timeGrowthBps < 0 || b.timeGrowthBps > 65535) errors.push(`building ${b.buildingType} (${b.name}): timeGrowthBps out of u16 range`);
    }
  }

  // Events
  {
    const dups = duplicates(EVENTS.map(e => e.eventId));
    if (dups.length) errors.push(`events: duplicate eventId(s) ${dups.join(', ')}`);
    for (const e of EVENTS) {
      if (e.name.length > EVENT_NAME_MAX) errors.push(`event ${e.eventId} (${e.name}): name exceeds ${EVENT_NAME_MAX} bytes`);
      if (e.prizeType < 0 || e.prizeType > 3) errors.push(`event ${e.eventId} (${e.name}): prizeType=${e.prizeType} out of range [0,3]`);
      if (e.requiredSubscriptionTier < 0 || e.requiredSubscriptionTier > 4) {
        errors.push(`event ${e.eventId} (${e.name}): requiredSubscriptionTier=${e.requiredSubscriptionTier} out of range [0,4]`);
      }
    }
  }

  return { errors, warnings };
}

/**
 * Run the preflight; print warnings, and throw an aggregated error if any
 * check failed. Call at the top of init/update before any chain write.
 */
export function assertSeedDataValid(): void {
  const { errors, warnings } = checkSeedData();
  for (const w of warnings) log.warn(`seed-data: ${w}`);
  if (errors.length > 0) {
    throw new Error(
      `Seed-data validation failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):\n` +
        errors.map(e => `  - ${e}`).join('\n'),
    );
  }
}
