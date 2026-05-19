/**
 * HeroTemplate Account
 *
 * DAO controlled configuration for each hero type.
 * Heroes provide buffs that scale deterministically with level using golden root.
 *
 * Size: 96 bytes (repr(C) layout)
 */

import { reprC, struct, pad, u8, u16, u32, u64, bool, fixedString, array } from '../utils/codec';

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
  mintCostSol: bigint;
  supplyCap: number;
  mintedCount: number;
  enabled: boolean;
  eventExclusive: boolean;
  requiredPlayerLevel: number;
  meditationCityId: number;
  buffs: HeroBuffConfig[];
  bump: number;
}

/** HeroTemplate size in bytes (repr(C) layout with alignment padding) */
export const HERO_TEMPLATE_SIZE = 96;

// Codec

/** HeroBuffConfig `#[repr(C)]` codec (6 bytes) */
const heroBuffConfig = struct<HeroBuffConfig>([
  ['stat', u8],
  ['baseBps', u16],
  pad(2), // _reserved
]);

/** HeroTemplate `#[repr(C)]` codec */
const heroTemplateCodec = reprC<HeroTemplateAccount>([
  pad(1), // account_key discriminator
  ['templateId', u16],
  ['name', fixedString(32)],
  ['heroType', u8],
  ['category', u8],
  ['mintCostSol', u64],
  ['supplyCap', u32],
  ['mintedCount', u32],
  ['enabled', bool],
  ['eventExclusive', bool],
  ['requiredPlayerLevel', u8],
  ['meditationCityId', u16],
  ['buffs', array(heroBuffConfig, 4)],
  ['bump', u8],
  pad(3), // _padding
], HERO_TEMPLATE_SIZE);

// Deserialization

/** Deserialize HeroTemplate from raw bytes */
export function deserializeHeroTemplate(data: Uint8Array): HeroTemplateAccount {
  return heroTemplateCodec.decode(data);
}

/** Parse HeroTemplate from account info */
export function parseHeroTemplate(accountInfo: { data: Uint8Array }): HeroTemplateAccount | null {
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
