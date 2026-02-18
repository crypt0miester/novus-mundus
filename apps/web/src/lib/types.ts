/**
 * Local type definitions to avoid SDK re-export resolution issues.
 * These mirror the SDK types from novus-mundus-sdk/state/player.
 */

import type BN from "bn.js";

/** Helper to safely convert BN to number */
export function bnToNum(val: BN | number | undefined): number {
  if (val === undefined) return 0;
  if (typeof val === "number") return val;
  return val.toNumber();
}
