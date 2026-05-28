// Halo pattern 0: nested concentric rings with irregular spacing.
// Austere, ceremonial. See docs/design/HERO_PORTRAITS.md §7.

import type { SKRSContext2D } from "@napi-rs/canvas";

export interface HaloDrawParams {
  centerX: number;
  centerY: number;
  innerRadius: number;
  outerRadius: number;
  /** Hero tier accent color (TIER_ACCENT[tier].primary) */
  strokeColor: string;
  /** 48-bit seed from fingerprint.haloSeed */
  seed: number;
}

export function drawConcentric(
  ctx: SKRSContext2D,
  p: HaloDrawParams,
): void {
  const rng = mulberry32(p.seed);

  ctx.save();
  ctx.strokeStyle = p.strokeColor;
  ctx.lineWidth = 1;

  let r = p.innerRadius;
  while (r < p.outerRadius) {
    // 8..24 px gap per ring, jittered for an etched-relief feel.
    const gap = 8 + rng() * 16;
    r += gap;
    if (r > p.outerRadius) break;

    ctx.globalAlpha = 0.35 + rng() * 0.5;
    ctx.beginPath();
    ctx.arc(p.centerX, p.centerY, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

// Tiny seedable PRNG. Returns floats in [0, 1). Mulberry32's state is 32 bits,
// but the halo seed is up to 48 (fingerprint.ts packs bytes 2..7 of the
// pubkey). XOR-mix the high 16 bits into the low 32 so the full 48 bits of
// entropy reach the state — otherwise pubkeys differing only in bytes 2-3
// render identical halos.
function mulberry32(seed: number): () => number {
  const low = seed >>> 0;
  const high = Math.floor(seed / 0x100000000) & 0xffff;
  let a = (low ^ Math.imul(high, 0x9e3779b1)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
