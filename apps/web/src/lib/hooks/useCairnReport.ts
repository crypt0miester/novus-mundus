"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayer } from "./usePlayer";
import { useEstate } from "./useEstate";
import {
  computeSnapshot,
  readSnapshot,
  writeSnapshot,
  diffSnapshot,
  type EstateSnapshot,
  type ReportDiff,
} from "@/lib/narrative";

/**
 * The comeback engine — PLAYER_JOURNEY_GAMEPLAN.md §8.
 *
 * On the estate it reads the prior per-wallet snapshot, diffs it against
 * current state for the Cairn's Report, and writes a fresh snapshot when the
 * estate is left. Returns the diff only when there is news; null otherwise.
 */
export function useCairnReport(): ReportDiff | null {
  const { publicKey } = useWallet();
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const player = playerData?.account ?? null;
  const estate = estateData?.account ?? null;
  const wallet = publicKey ? publicKey.toBase58() : null;

  const [report, setReport] = useState<ReportDiff | null>(null);
  const computed = useRef(false);
  const latest = useRef<{ wallet: string; snap: EstateSnapshot } | null>(null);

  // Keep the latest snapshot fresh; compute the Report once, on first load.
  useEffect(() => {
    if (!wallet || !player || !estate) return;
    const snap = computeSnapshot(player, estate);
    latest.current = { wallet, snap };
    if (!computed.current) {
      computed.current = true;
      const prev = readSnapshot(wallet);
      if (prev) {
        const diff = diffSnapshot(prev, snap);
        setReport(diff.hasNews ? diff : null);
      }
    }
  }, [wallet, player, estate]);

  // Write the latest snapshot when the estate is left.
  useEffect(() => {
    return () => {
      if (latest.current) {
        writeSnapshot(latest.current.wallet, latest.current.snap);
      }
    };
  }, []);

  return report;
}
