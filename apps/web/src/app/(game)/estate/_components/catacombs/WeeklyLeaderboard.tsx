"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useTransact } from "@/lib/hooks/useTransact";
import { useChainNow } from "@/lib/hooks/useChainTime";
import { usePlayerPda } from "@/lib/hooks/usePlayerPda";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { GameIcon } from "@/components/shared/GameIcon";
import { InfoButton } from "@/components/shared/InfoButton";
import { cn, formatNumber } from "@/lib/utils";
import {
  createClaimLeaderboardPrizeInstruction,
  deriveDungeonLeaderboardPda,
  parseDungeonLeaderboard,
  PRIZE_DISTRIBUTION,
  deciToNovi,
} from "novus-mundus-sdk";

const WEEK_SECONDS = 7 * 24 * 60 * 60;

// A rank's slice of the pool, mirroring claim_leaderboard_prize.rs
// (prize_pool * PRIZE_DISTRIBUTION[rank] / 10000). One definition, used by both
// the per-row display and the player's own claimable amount.
function prizeForRank(prizePool: bigint, rank: number): bigint {
  return (prizePool * BigInt(PRIZE_DISTRIBUTION[rank] ?? 0)) / 10_000n;
}

interface WeeklyLeaderboardProps {
  dungeonId: number;
  dungeonName?: string;
}

/**
 * The most-recent ENDED weekly dungeon leaderboard for the selected dungeon,
 * plus the prize claim (claim_leaderboard_prize, Ix 259). The on-chain rule is
 * weekNumber < currentWeek, so we surface currentWeek-1 — the week that just
 * closed. Entries are keyed by the PlayerAccount PDA (matched against
 * usePlayerPda), the prize is prizePool x PRIZE_DISTRIBUTION[rank], and the
 * claim is preflight-gated so a non-ranked / already-claimed player never fires
 * a tx that bounces with NotOnLeaderboard / LeaderboardPrizeAlreadyClaimed.
 */
export function WeeklyLeaderboard({ dungeonId, dungeonName }: WeeklyLeaderboardProps) {
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const transact = useTransact();
  const myPlayerPda = usePlayerPda();
  // Coarse tick: this only feeds claimableWeek (week granularity), so a 30s
  // heartbeat would re-render the list for nothing. 5 min keeps the chain
  // anchor (week boundaries must track chain time) without the churn.
  const now = useChainNow(5 * 60_000);

  // The just-closed week. Claiming requires the week to be strictly past.
  const claimableWeek = Math.floor(now / WEEK_SECONDS) - 1;

  const { data: board } = useQuery({
    queryKey: ["dungeonLeaderboard", dungeonId, claimableWeek],
    queryFn: async () => {
      const [pda] = await deriveDungeonLeaderboardPda(client.gameEngine, dungeonId, claimableWeek);
      const info = await connection.getAccountInfo(pda);
      return info ? parseDungeonLeaderboard(info) : null;
    },
    enabled: !!publicKey && claimableWeek >= 0,
    staleTime: 30_000,
  });

  // My rank (0-indexed) on this board, by PlayerAccount PDA, and the per-rank
  // prize / claimed state derived from the on-chain pool + claimed mask.
  const mine = useMemo(() => {
    if (!board || !myPlayerPda) return null;
    const rank = board.entries.findIndex((e) => e.player.equals(myPlayerPda));
    if (rank < 0) return null;
    const prizeDeci = prizeForRank(board.prizePool, rank);
    const claimed = ((board.claimedMask >> rank) & 1) === 1;
    return { rank, prizeDeci, claimed };
  }, [board, myPlayerPda]);

  const handleClaim = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ix = await createClaimLeaderboardPrizeInstruction(
      { owner: publicKey, gameEngine: client.gameEngine },
      { dungeonId, weekNumber: claimableWeek },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        // Prefix match — invalidates the keyed ["dungeonLeaderboard", id, week] query.
        invalidateKeys: [["dungeonLeaderboard"], ["player"]],
        successMessage: "Leaderboard prize claimed.",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  return (
    <div className="card">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Weekly Leaderboard{" "}
          <InfoButton>
            Top 10 clears of {dungeonName ?? "this dungeon"} each week split a NOVI prize pool
            (35/25/15/7.5/7.5% then 2% each for 6-10). Claimable once the week ends.
          </InfoButton>
        </h3>
        <span className="font-mono text-[10px] text-text-muted">Week {claimableWeek}</span>
      </div>

      {!board || board.entries.length === 0 ? (
        <p className="text-xs italic text-text-muted">
          No leaderboard recorded for last week. Clear this dungeon to land on the next one.
        </p>
      ) : (
        <>
          <div className="space-y-1">
            {board.entries.map((e, rank) => {
              const isMe = !!myPlayerPda && e.player.equals(myPlayerPda);
              const prizeDeci = prizeForRank(board.prizePool, rank);
              return (
                <div
                  key={`${e.player.toBase58()}-${rank}`}
                  className={cn(
                    "flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs",
                    isMe ? "bg-[var(--nm-accent)]/10 text-text-primary" : "text-text-secondary",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-5 font-mono tabular-nums text-text-muted">#{rank + 1}</span>
                    <span className="font-mono tabular-nums">{formatNumber(Number(e.score))}</span>
                    {isMe && <span className="text-[10px] uppercase text-text-gold">you</span>}
                  </span>
                  <span className="flex items-center gap-1 font-mono tabular-nums text-text-gold">
                    <GameIcon id="resource-novi" size={12} />
                    {formatNumber(deciToNovi(prizeDeci))}
                  </span>
                </div>
              );
            })}
          </div>

          {mine && (
            <div className="mt-3 border-t border-border-default pt-3">
              {mine.claimed ? (
                <div className="flex items-center justify-center rounded-lg bg-surface-overlay/30 px-3 py-2 text-xs text-text-muted">
                  Prize for rank #{mine.rank + 1} already claimed.
                </div>
              ) : mine.prizeDeci > 0n ? (
                <TxButton onClick={handleClaim} className="w-full">
                  Claim {formatNumber(deciToNovi(mine.prizeDeci))} NOVI (rank #{mine.rank + 1})
                </TxButton>
              ) : (
                <div className="flex items-center justify-center rounded-lg bg-surface-overlay/30 px-3 py-2 text-xs italic text-text-muted">
                  No prize pool was funded for this week.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
