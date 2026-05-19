/**
 * show player — List all players or show detailed player state
 */

import { PublicKey } from '@solana/web3.js';
import type { NovusMundusClient } from '../../../src/client';
import type { CLIContext } from '../context';
import { log } from '../helpers';
import {
  table, section, addr, formatNum, formatDate, formatBps, dim,
  type Column,
} from '../format';
import { CITIES } from '../../data/cities';
import { SubscriptionTier, TravelType } from '../../../src/types/enums';
import { isNullPubkey } from '../../../src/utils/deserialize';
import { getTotalUnits } from '../../../src/state/player';
import type { PlayerAccount } from '../../../src/state/player';

const TIER_NAMES: Record<number, string> = {
  [SubscriptionTier.Rookie]: 'Rookie',
  [SubscriptionTier.Expert]: 'Expert',
  [SubscriptionTier.Epic]: 'Epic',
  [SubscriptionTier.Legendary]: 'Legendary',
};

function cityName(id: number): string {
  return CITIES.find(c => c.id === id)?.name ?? `City ${id}`;
}

export async function showAllPlayers(client: NovusMundusClient, ctx: CLIContext): Promise<void> {
  const players = await client.fetchAllPlayers();

  log.info(section(`Players — Kingdom ${ctx.kingdomId} (${players.length} total)`));

  if (players.length === 0) {
    log.info(dim('  No players found.'));
    return;
  }

  const cols: Column[] = [
    { header: 'Name', width: 16 },
    { header: 'Lvl', align: 'right', width: 3 },
    { header: 'City', width: 12 },
    { header: 'Networth', align: 'right', width: 12 },
    { header: 'Cash', align: 'right', width: 10 },
    { header: 'Units', align: 'right', width: 7 },
    { header: 'Team' },
  ];

  const rows = players
    .sort((a, b) => (b.account.networth < a.account.networth ? -1 : b.account.networth > a.account.networth ? 1 : 0))
    .map(({ account: p }) => [
      p.name || dim('--'),
      String(p.level),
      cityName(p.currentCity),
      formatNum(p.networth),
      formatNum(p.cashOnHand),
      formatNum(getTotalUnits(p)),
      isNullPubkey(p.team) ? dim('--') : addr(p.team),
    ]);

  log.info(table(cols, rows));
}

export async function showPlayer(client: NovusMundusClient, ctx: CLIContext, walletStr: string): Promise<void> {
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(walletStr);
  } catch {
    log.error(`Invalid public key: ${walletStr}`);
    return;
  }

  const result = await client.fetchPlayer(wallet);
  if (!result.exists || !result.account) {
    log.error(`Player not found for wallet ${addr(wallet)}`);
    return;
  }

  const p: PlayerAccount = result.account;

  log.info(`\nPlayer: ${p.name || dim('(unnamed)')}`);
  log.info(`Wallet: ${addr(wallet)}    PDA: ${addr(result.pubkey)}`);

  // Identity
  log.info(section('Identity'));
  log.info(`  Level ${p.level} (${formatNum(p.currentXp)} XP)    Reputation: ${formatNum(p.reputation)}    Networth: ${formatNum(p.networth)}`);
  const tierName = TIER_NAMES[p.subscriptionTier] ?? 'Unknown';
  const subExpiry = Number(p.subscriptionEnd) > 0 ? formatDate(p.subscriptionEnd) : dim('none');
  log.info(`  Subscription: ${tierName} (expires ${subExpiry})    City: ${cityName(p.currentCity)} (ID ${p.currentCity})`);

  // Location
  if (p.travelType !== TravelType.None) {
    log.info(section('Travel'));
    const travelLabel = p.travelType === TravelType.Intercity ? 'Intercity' : 'Intracity';
    log.info(`  ${travelLabel}: ${cityName(p.originCity)} → ${cityName(p.destinationCity)}    Arrives: ${formatDate(p.arrivalTime)}`);
  }

  // Military
  log.info(section('Military'));
  log.info(`  Defensive     ${formatNum(p.defensiveUnit1)} / ${formatNum(p.defensiveUnit2)} / ${formatNum(p.defensiveUnit3)}       Operative    ${formatNum(p.operativeUnit1)} / ${formatNum(p.operativeUnit2)} / ${formatNum(p.operativeUnit3)}`);
  log.info(`  Weapons       ${formatNum(p.meleeWeapons)}M / ${formatNum(p.rangedWeapons)}R / ${formatNum(p.siegeWeapons)}S      Armor: ${formatNum(p.armorPieces)}`);

  // Economy
  log.info(section('Economy'));
  log.info(`  Cash: ${formatNum(p.cashOnHand)} (vault: ${formatNum(p.cashInVault)})     Locked NOVI: ${formatNum(p.lockedNovi)}`);
  log.info(`  Produce: ${formatNum(p.produce)}    Vehicles: ${formatNum(p.vehicles)}      Gems: ${formatNum(p.gems)}    Fragments: ${formatNum(p.fragments)}`);

  // Heroes
  log.info(section('Heroes'));
  const heroSlots = p.activeHeroes.map((h, i) =>
    `Slot ${i}: ${isNullPubkey(h) ? dim('--') : addr(h)}`
  ).join('    ');
  log.info(`  ${heroSlots}`);
  const defSlot = p.defensiveHeroSlot === 255 ? dim('--') : `Slot ${p.defensiveHeroSlot}`;
  const medSlot = p.meditatingHeroSlot === 255 ? dim('--') : `Slot ${p.meditatingHeroSlot}`;
  log.info(`  Defensive: ${defSlot}     Meditating: ${medSlot}`);

  // Research Buffs
  const hasResearch = p.researchAttackBps > 0 || p.researchDefenseBps > 0 || p.researchCritChanceBps > 0;
  if (hasResearch) {
    log.info(section('Research Buffs'));
    log.info(`  Atk: ${formatBps(p.researchAttackBps)}  Def: ${formatBps(p.researchDefenseBps)}  Crit: ${formatBps(p.researchCritChanceBps)}/${formatBps(p.researchCritDamageBps)}  Loot: ${formatBps(p.researchLootBonusBps)}  Encounter: ${formatBps(p.researchEncounterSuccessBps)}`);
  }

  // Consumables
  const consumables = [
    ['Stamina Potions', p.staminaPotions],
    ['XP Boosters', p.xpBoosters],
    ['Loot Magnets', p.lootMagnets],
    ['Shield Tokens', p.shieldTokens],
    ['Speed Elixirs', p.speedElixirs],
    ['Attack Boosters', p.attackBoosters],
    ['Defense Boosters', p.defenseBoosters],
    ['Collection Boosters', p.collectionBoosters],
    ['Rally Horns', p.rallyHorns],
    ['Teleport Scrolls', p.teleportScrolls],
    ['Mystery Keys', p.mysteryKeys],
  ].filter(([, v]) => (v as number) > 0);

  if (consumables.length > 0) {
    log.info(section('Consumables'));
    log.info('  ' + consumables.map(([n, v]) => `${n}: ${v}`).join('  '));
  }

  // Materials
  const matTotal = (p.commonMaterials + p.uncommonMaterials).add(p.rareMaterials).add(p.epicMaterials).add(p.legendaryMaterials);
  if ((matTotal > 0n)) {
    log.info(section('Materials'));
    log.info(`  Common: ${formatNum(p.commonMaterials)}  Uncommon: ${formatNum(p.uncommonMaterials)}  Rare: ${formatNum(p.rareMaterials)}  Epic: ${formatNum(p.epicMaterials)}  Legendary: ${formatNum(p.legendaryMaterials)}`);
  }

  // Rally Stats
  log.info(section('Rally Stats'));
  const rs = p.rallyStats;
  log.info(`  Joined: ${formatNum(rs.totalRalliesJoined)}    Created: ${formatNum(rs.totalRalliesCreated)}    Won: ${formatNum(rs.totalRalliesWon)}    Lost: ${formatNum(rs.totalRalliesLost)}    Loot: ${formatNum(rs.totalRallyLootEarned)}`);

  // Shop Stats
  if ((p.totalShopSpent > 0n)) {
    log.info(section('Shop Stats'));
    log.info(`  Total Spent: ${formatNum(p.totalShopSpent)}    Milestone: ${p.milestoneTier}    Loyalty Streak: ${p.loyaltyStreak}`);
  }

  log.info('');
}
