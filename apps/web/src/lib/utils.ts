import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(
  n: number,
  fmt: "compact" | "full" | "novi" | "percentage" = "compact",
): string {
  if (fmt === "compact") {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return n.toLocaleString();
  }
  if (fmt === "novi") return n.toLocaleString() + " NOVI";
  if (fmt === "percentage") return n.toFixed(1) + "%";
  return n.toLocaleString();
}

export function formatTime(seconds: number, fmt: "full" | "compact" | "colon" = "full"): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  if (fmt === "colon") return `${pad(h + d * 24)}:${pad(m)}:${pad(s)}`;
  if (fmt === "compact") {
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s}s`;
  }
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}..${address.slice(-chars)}`;
}

/** Convert basis points to percentage string: 7500 to "75%" */
export function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(bps % 100 === 0 ? 0 : 1) + "%";
}

/** Convert basis points to multiplier string: 15000 to "1.5x" */
export function bpsToMultiplier(bps: number): string {
  return (bps / 10000).toFixed(bps % 10000 === 0 ? 0 : 1) + "x";
}

/** True when n is a Fibonacci number — re-exported from the SDK, the canonical
 *  port of the on-chain `is_fibonacci`. */
export { isFibonacci } from "novus-mundus-sdk";

/**
 * Coerce a BN (or BN-like) to a JS number, clamped to `Number.MAX_SAFE_INTEGER`.
 *
 * On-chain u64 fields (unit pools, treasuries, lifetime spend) can exceed 2^53
 * for endgame whales; `BN.prototype.toNumber()` throws once that boundary is
 * crossed, which would otherwise crash inputs / displays mid-render. Clamping
 * is the right choice for UI bounds (the cap is "all you have" and the chain
 * does the real arithmetic), but never use this for values that need to round-
 * trip to the chain — pass the BN itself.
 */
interface BNLike {
  toNumber?: () => number;
  bitLength?: () => number;
  toString?: (base?: number) => string;
}
export function bnToSafeNumber(bn: BNLike | null | undefined): number {
  if (!bn) return 0;
  // Fast path: anything that fits in 53 bits is safe.
  if (typeof bn.bitLength === "function" && bn.bitLength() <= 53) {
    return bn.toNumber?.() ?? 0;
  }
  // Past the safe-integer ceiling — clamp without throwing.
  if (typeof bn.toString === "function") {
    const s = bn.toString();
    const asNum = Number(s);
    return Number.isFinite(asNum) ? Math.min(asNum, Number.MAX_SAFE_INTEGER) : 0;
  }
  return 0;
}
