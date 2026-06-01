// Pure function: 32-byte Solana pubkey + hero state -> procedural composition
// parameters. Same pubkey + same state -> identical CompositionParams.
//
// The pubkey only drives composition (halo type, glyph variant, constellation,
// flip, rotation). Colors are fixed by tier in palette.ts.
// See docs/design/HERO_PORTRAITS.md §9 for the byte-slicing table.

import type { HeroTier } from "./palette";

export type HaloKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface HeroState {
  templateId: number;
  tier: HeroTier;
  level: number;
  locked: boolean;
}

export interface CompositionParams {
  haloKind: HaloKind;
  /** 48-bit PRNG seed packed from bytes 2..7 */
  haloSeed: number;
  flipX: boolean;
  rotateDeg: number;
  cornerVariant: 0 | 1 | 2 | 3;
  categoryBannerVariant: 0 | 1 | 2 | 3;
  buffNudges: [number, number, number, number];
  /** 8 dots in [0,1] coords; compose.ts maps them to the rim band. */
  constellation: Array<{ x: number; y: number }>;
}

export function fingerprintFromPubkey(pubkey: Uint8Array, state: HeroState): CompositionParams {
  if (pubkey.length !== 32) {
    throw new Error(`fingerprintFromPubkey: expected 32 bytes, got ${pubkey.length}`);
  }
  const b = pubkey;

  const haloKind = (((b[0] << 8) | b[1]) % 8) as HaloKind;

  // 48-bit seed packed from bytes 2..7 (stays inside JS-safe integer range)
  const haloSeed =
    b[2] * 0x010000000000 +
    b[3] * 0x000100000000 +
    b[4] * 0x000001000000 +
    b[5] * 0x000000010000 +
    b[6] * 0x000000000100 +
    b[7];

  const flipX = b[8] < 51; // ~20%
  const rotateDeg = byteToRange(b[9], -3, 3);
  const cornerVariant = (b[10] % 4) as 0 | 1 | 2 | 3;
  const categoryBannerVariant = (b[12] % 4) as 0 | 1 | 2 | 3;
  const buffNudges: [number, number, number, number] = [
    byteToRange(b[13], -6, 6),
    byteToRange(b[14], -6, 6),
    byteToRange(b[15], -6, 6),
    0,
  ];

  const constellation: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 8; i++) {
    constellation.push({
      x: b[16 + 2 * i] / 255,
      y: b[17 + 2 * i] / 255,
    });
  }

  // state reserved for future state-dependent variation (burn scars, etc.)
  void state;

  return {
    haloKind,
    haloSeed,
    flipX,
    rotateDeg,
    cornerVariant,
    categoryBannerVariant,
    buffNudges,
    constellation,
  };
}

function byteToRange(byte: number, min: number, max: number): number {
  return min + (byte / 255) * (max - min);
}
