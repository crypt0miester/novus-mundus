import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number, fmt: "compact" | "full" | "novi" | "percentage" = "compact"): string {
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

/** Convert basis points to percentage string: 7500 → "75%" */
export function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(bps % 100 === 0 ? 0 : 1) + "%";
}

/** Convert basis points to multiplier string: 15000 → "1.5x" */
export function bpsToMultiplier(bps: number): string {
  return (bps / 10000).toFixed(bps % 10000 === 0 ? 0 : 1) + "x";
}
