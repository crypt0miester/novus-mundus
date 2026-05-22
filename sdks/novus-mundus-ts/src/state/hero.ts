/**
 * HeroTemplate Account
 *
 * DAO controlled configuration for each hero type.
 * Heroes provide buffs that scale deterministically with level using golden root.
 *
 * Size: 112 bytes (repr(C) layout)
 */

import type { AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader } from '../utils/deserialize';

// Buff Config

export interface HeroBuffConfig {
  stat: number;
  baseBps: number;
}

// Hero Template Interface

export interface HeroTemplateAccount {
  templateId: number;
  name: string;
  heroType: number;
  category: number;
  mintCostSol: BN;
  supplyCap: number;
  mintedCount: number;
  enabled: boolean;
  eventExclusive: boolean;
  requiredPlayerLevel: number;
  meditationCityId: number;
  buffs: HeroBuffConfig[];
  bump: number;
  /** Active ability kind (0=none, 1=BuffNext, 2=CritNext, 3=ShieldNext, 4=EncounterSkip, 5=InstantResource, 6=FragmentRefund) */
  abilityKind: number;
  /** Stat targeted by BuffNext (BuffStat enum, else 0) */
  abilityStat: number;
  /** Generic param: bps for BuffNext, amount for InstantResource/FragmentRefund */
  abilityParam1: number;
  /** Generic param: duration secs for BuffNext, else 0 */
  abilityParam2: number;
  /** Cooldown between uses, in seconds */
  abilityCooldownSecs: number;
}

/** HeroTemplate size in bytes (repr(C) layout with alignment padding) */
export const HERO_TEMPLATE_SIZE = 112;

// Deserialization

/** Deserialize a single HeroBuffConfig (6 bytes in repr(C) layout) */
function deserializeHeroBuffConfig(reader: BufferReader): HeroBuffConfig {
  const stat = reader.readU8();
  reader.skip(1); // implicit padding for u16 alignment
  const baseBps = reader.readU16();
  reader.skip(2); // _reserved
  return { stat, baseBps };
}

/** Deserialize HeroTemplate from raw bytes */
export function deserializeHeroTemplate(data: Uint8Array | Buffer): HeroTemplateAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key discriminator
  reader.skip(1); // implicit padding for u16 alignment (offset 1 -> 2)
  const templateId = reader.readU16();
  const name = reader.readString(32);
  const heroType = reader.readU8();
  const category = reader.readU8();
  reader.skip(2); // implicit padding for u64 alignment (offset 38 -> 40)
  const mintCostSol = reader.readU64();
  const supplyCap = reader.readU32();
  const mintedCount = reader.readU32();
  const enabled = reader.readBool();
  const eventExclusive = reader.readBool();
  const requiredPlayerLevel = reader.readU8();
  reader.skip(1); // implicit padding for u16 alignment (offset 59 -> 60)
  const meditationCityId = reader.readU16();

  // buffs: [HeroBuffConfig; 4] - each is 6 bytes in repr(C)
  const buffs: HeroBuffConfig[] = [];
  for (let i = 0; i < 4; i++) {
    buffs.push(deserializeHeroBuffConfig(reader));
  }

  const bump = reader.readU8();
  reader.skip(3); // _padding

  // Ability config (18 bytes incl. alignment padding; struct grew here).
  // repr(C): abilityKind/abilityStat/abilityParam1 land at 90/91/92, then a
  // u16->u32 alignment gap pushes abilityParam2 to 96 and the cooldown to 100.
  const abilityKind = reader.readU8();
  const abilityStat = reader.readU8();
  const abilityParam1 = reader.readU16();
  reader.skip(2); // implicit padding: u16 abilityParam1 -> u32 abilityParam2
  const abilityParam2 = reader.readU32();
  const abilityCooldownSecs = reader.readU32();
  reader.skip(4); // _ability_padding

  return {
    templateId,
    name,
    heroType,
    category,
    mintCostSol,
    supplyCap,
    mintedCount,
    enabled,
    eventExclusive,
    requiredPlayerLevel,
    meditationCityId,
    buffs,
    bump,
    abilityKind,
    abilityStat,
    abilityParam1,
    abilityParam2,
    abilityCooldownSecs,
  };
}

/** Parse HeroTemplate from account info */
export function parseHeroTemplate(accountInfo: AccountInfo<Buffer>): HeroTemplateAccount | null {
  if (!accountInfo.data || accountInfo.data.length < HERO_TEMPLATE_SIZE) {
    return null;
  }
  return deserializeHeroTemplate(accountInfo.data);
}

// Helper Functions

/** Check if hero template can still be minted */
export function canMintHero(template: HeroTemplateAccount): boolean {
  if (!template.enabled) return false;
  if (template.supplyCap === 0) return true; // Unlimited supply
  return template.mintedCount < template.supplyCap;
}

/** Get remaining mint supply (0 = unlimited) */
export function getRemainingSupply(template: HeroTemplateAccount): number {
  if (template.supplyCap === 0) return 0; // Unlimited
  return Math.max(0, template.supplyCap - template.mintedCount);
}

/** Get active (non-None) buffs from a hero template */
export function getActiveBuffs(template: HeroTemplateAccount): HeroBuffConfig[] {
  return template.buffs.filter((b) => b.stat !== 0 && b.baseBps > 0);
}

/** Check if hero is event-exclusive */
export function isEventExclusive(template: HeroTemplateAccount): boolean {
  return template.eventExclusive;
}

/** Check if hero requires a specific city for meditation */
export function requiresSpecificCity(template: HeroTemplateAccount): boolean {
  return template.meditationCityId !== 0;
}

/** Check if hero is "at home" (in their meditation city) */
export function isHeroAtHome(template: HeroTemplateAccount, playerCityId: number): boolean {
  return template.meditationCityId === 0 || template.meditationCityId === playerCityId;
}
