"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useViewAsStore } from "@/lib/store/view-as";

/**
 * The single capability floor: may this visitor perform on-chain writes?
 *
 *   canAct = wallet connected && a registered player exists && not impersonating
 *
 * Three read-only states collapse under one umbrella:
 *   - anonymous spectator (no wallet),
 *   - unclaimed spectator (wallet connected, no player yet),
 *   - viewAs (the `?viewAs=<pubkey>` impersonation, which fakes a connected
 *     wallet with a real player but no signer).
 *
 * Per-tab `canX` predicates layer on top of this global floor; TxButton reads
 * it to gate every write at the seam (disable + claim CTA, never a raw error).
 */
export function useCanAct(): boolean {
  const { connected } = useWallet();
  const { data } = usePlayer();
  const isViewAs = useViewAsStore((s) => s.isViewAs);
  return connected && data?.exists === true && !isViewAs;
}

/** Inverse of useCanAct: this visitor is browsing the realm read-only. */
export function useIsSpectator(): boolean {
  return !useCanAct();
}
