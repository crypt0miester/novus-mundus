import type { RandomSource } from "../../types";

/** Deterministic `RandomSource` (mulberry32) — keeps generation reproducible. */
export class FakeRng implements RandomSource {
  private state: number;
  constructor(seed = 1) {
    this.state = seed >>> 0;
  }
  private next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  nextInt(n: number): number {
    return n <= 0 ? 0 : Math.floor(this.next() * n);
  }
  sampleDistinct<T>(pool: T[], count: number): T[] {
    const arr = [...pool];
    const out: T[] = [];
    for (let i = 0; i < count && arr.length > 0; i += 1) {
      out.push(arr.splice(this.nextInt(arr.length), 1)[0]!);
    }
    return out;
  }
}
