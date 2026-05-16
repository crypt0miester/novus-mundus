import "server-only";
import { createHash } from "node:crypto";

const RNG_SECRET = process.env.GAME_AUTHORITY_RNG_SECRET ?? "";

/**
 * Deterministic, state-seeded PRNG.
 *
 * The same `(domain, account, discriminator)` always produces the same stream,
 * so a client cannot re-roll an outcome by retrying a co-sign endpoint. The
 * stream is keyed by a server secret (`GAME_AUTHORITY_RNG_SECRET`) so outcomes
 * are not predictable by the client.
 */
export class Rng {
  private readonly seed: Buffer;
  private buf: Buffer;
  private offset = 0;
  private counter = 0;

  constructor(domain: string, account: string, discriminator: string) {
    if (!RNG_SECRET) {
      // An empty secret makes every roll client-predictable — fail loudly
      // rather than silently void the anti-cheat guarantee.
      throw new Error("GAME_AUTHORITY_RNG_SECRET is not set");
    }
    this.seed = createHash("sha256")
      .update(RNG_SECRET)
      .update("|")
      .update(domain)
      .update("|")
      .update(account)
      .update("|")
      .update(discriminator)
      .digest();
    this.buf = this.nextBlock();
  }

  private nextBlock(): Buffer {
    const block = createHash("sha256")
      .update(this.seed)
      .update(String(this.counter))
      .digest();
    this.counter += 1;
    this.offset = 0;
    return block;
  }

  /** Next unsigned 32-bit integer. */
  nextU32(): number {
    if (this.offset + 4 > this.buf.length) this.buf = this.nextBlock();
    const value = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return value >>> 0;
  }

  /** Uniform float in [0, 1). */
  nextFloat(): number {
    return this.nextU32() / 0x1_0000_0000;
  }

  /** Integer in [0, n). */
  nextInt(n: number): number {
    return n <= 0 ? 0 : Math.floor(this.nextFloat() * n);
  }

  /** True with probability `chanceBps / 10000`. */
  rollBps(chanceBps: number): boolean {
    if (chanceBps <= 0) return false;
    if (chanceBps >= 10000) return true;
    return this.nextU32() % 10000 < chanceBps;
  }

  /** Weighted index pick; weights need not be normalised. */
  weightedPick(weights: number[]): number {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return 0;
    let r = this.nextU32() % total;
    for (let i = 0; i < weights.length; i += 1) {
      const w = Math.max(0, weights[i] ?? 0);
      if (r < w) return i;
      r -= w;
    }
    return weights.length - 1;
  }

  /** Pick `count` distinct entries from `pool` (order randomised). */
  sampleDistinct<T>(pool: T[], count: number): T[] {
    const arr = [...pool];
    const out: T[] = [];
    for (let i = 0; i < count && arr.length > 0; i += 1) {
      out.push(arr.splice(this.nextInt(arr.length), 1)[0]!);
    }
    return out;
  }
}
