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
    // One fractional digit at most, but drop a trailing ".0" so round values
    // read clean ("1K" not "1.0K"); values under 1000 keep no decimal at all.
    const k = (x: number) => {
      const s = x.toFixed(1);
      return s.endsWith(".0") ? s.slice(0, -2) : s;
    };
    if (n >= 1_000_000_000) return `${k(n / 1_000_000_000)}B`;
    if (n >= 1_000_000) return `${k(n / 1_000_000)}M`;
    if (n >= 1_000) return `${k(n / 1_000)}K`;
    return n.toLocaleString();
  }
  if (fmt === "novi") return `${n.toLocaleString()} NOVI`;
  if (fmt === "percentage") return `${n.toFixed(1)}%`;
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
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}

/** Convert basis points to multiplier string: 15000 to "1.5x" */
export function bpsToMultiplier(bps: number): string {
  return `${(bps / 10000).toFixed(bps % 10000 === 0 ? 0 : 1)}x`;
}

/** True when n is a Fibonacci number — re-exported from the SDK, the canonical
 *  port of the on-chain `is_fibonacci`. */
export { isFibonacci } from "novus-mundus-sdk";

/** True when the user has asked for reduced motion. SSR-safe — false on the
 *  server, where no media query is available. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Coerce an on-chain u64 (a `bigint`) to a JS number, clamped to
 * `Number.MAX_SAFE_INTEGER`.
 *
 * On-chain u64 fields (unit pools, treasuries, lifetime spend) can exceed 2^53
 * for endgame whales; `Number(bigint)` silently loses precision past that
 * boundary. Clamping is the right choice for UI bounds (the cap is "all you
 * have" and the chain does the real arithmetic), but never use this for values
 * that need to round-trip to the chain — pass the bigint itself.
 */
export function bnToSafeNumber(value: bigint | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.min(value, Number.MAX_SAFE_INTEGER) : 0;
  }
  // bigint: clamp without losing the sign of overflow.
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Number(value);
}

// Compact "time since" label from a unix-seconds timestamp ("just now", "5m ago").
export function relativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
