"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";

/** Byte offset of `unix_timestamp` (i64, LE) within the Clock sysvar account.
 *  Layout: slot u64 | epoch_start_timestamp i64 | epoch u64 |
 *  leader_schedule_epoch u64 | unix_timestamp i64 to 8+8+8+8 = 32. */
const CLOCK_UNIX_TIMESTAMP_OFFSET = 32;

/** How often to re-anchor to the chain clock. Validator-clock drift is slow,
 *  so a few minutes between fetches is plenty. */
const RESYNC_INTERVAL_MS = 5 * 60_000;

/**
 * Offset, in seconds, between the Solana cluster clock and this device's clock:
 *
 *   chainTime ≈ Math.floor(Date.now() / 1000) + offset
 *
 * The on-chain program reads `Clock::unix_timestamp` — a stake-weighted validator
 * estimate that can drift minutes from any given device's wall clock. Time-of-day
 * (and every NOVI multiplier it drives) is computed from that value, so a UI
 * preview must be anchored to it, not to `Date.now()`, or it will mispredict the
 * multiplier the player actually receives on-chain.
 *
 * We fetch the Clock sysvar on mount and every few minutes thereafter, then let
 * callers advance time locally with `Date.now()` between syncs — cheap, smooth,
 * and still anchored to the chain.
 */
export function useChainTimeOffset(): number {
  const { connection } = useConnection();
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      try {
        const info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
        if (cancelled || !info) return;
        const view = new DataView(info.data.buffer, info.data.byteOffset, info.data.byteLength);
        const chainTs = Number(view.getBigInt64(CLOCK_UNIX_TIMESTAMP_OFFSET, true));
        const deviceTs = Math.floor(Date.now() / 1000);
        setOffset(chainTs - deviceTs);
      } catch {
        // Keep the last known offset (0 before the first success) — a stale
        // anchor beats no anchor; the next interval retries.
      }
    };

    void sync();
    const t = setInterval(() => void sync(), RESYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [connection]);

  return offset;
}

/**
 * Current time, in unix seconds, on the Solana cluster clock — the same value
 * the on-chain program sees via `Clock::unix_timestamp`.
 *
 * Combines the chain anchor from {@link useChainTimeOffset} with a local tick so
 * the value advances smoothly between syncs. Use this anywhere the UI previews a
 * time-of-day-dependent multiplier, in place of `Math.floor(Date.now() / 1000)`.
 *
 * @param tickMs How often to re-render with a fresh value. Default 30s — fine
 *               for hour-long day/night phases.
 */
export function useChainNow(tickMs = 30_000): number {
  const offset = useChainTimeOffset();
  const [deviceSec, setDeviceSec] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setDeviceSec(Math.floor(Date.now() / 1000)), tickMs);
    return () => clearInterval(t);
  }, [tickMs]);

  return deviceSec + offset;
}
