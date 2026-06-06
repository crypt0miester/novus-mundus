"use client";

import { useMemo } from "react";
import { Trophy } from "lucide-react";
import type { ArenaSeasonAccount, ArenaLeaderboardEntry } from "novus-mundus-sdk";
import { usePlayerPda } from "@/lib/hooks/usePlayerPda";
import { InfoButton } from "@/components/shared/InfoButton";
import { cn, shortenAddress } from "@/lib/utils";

interface ArenaLeaderboardProps {
  season: ArenaSeasonAccount;
}

// Rank badge colours for the podium; everyone else is muted.
function rankClass(rank: number): string {
  if (rank === 1) return "text-text-gold";
  if (rank === 2) return "text-zinc-300";
  if (rank === 3) return "text-amber-600";
  return "text-text-muted";
}

export function ArenaLeaderboard({ season }: ArenaLeaderboardProps) {
  const myPlayerPda = usePlayerPda();

  // The on-chain leaderboard is a fixed-size array; only the first
  // leaderboardCount entries are populated.
  const entries = useMemo<ArenaLeaderboardEntry[]>(
    () => season.leaderboard.slice(0, season.leaderboardCount),
    [season],
  );

  return (
    <div className="card space-y-3">
      <h3 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
        <Trophy className="h-3.5 w-3.5" />
        Leaderboard
        <InfoButton>
          The season top 10 by total points, read live from on-chain state. Master rewards go to
          these finishers when the season ends.
        </InfoButton>
      </h3>

      {entries.length === 0 ? (
        <p className="text-center text-xs text-text-muted">
          No ranked players yet. Win battles to claim a spot.
        </p>
      ) : (
        <ol className="space-y-1">
          {entries.map((entry, i) => {
            const rank = i + 1;
            const isMe = myPlayerPda != null && entry.player.equals(myPlayerPda);
            return (
              <li
                key={entry.player.toBase58()}
                className={cn(
                  "flex items-center justify-between rounded-lg border px-3 py-2",
                  isMe
                    ? "border-[var(--tier-accent)] bg-accent/15"
                    : "border-zinc-800 bg-surface-raised/40",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      "w-6 shrink-0 text-center font-mono text-sm font-semibold tabular-nums",
                      rankClass(rank),
                    )}
                  >
                    {rank}
                  </span>
                  <span
                    className={cn(
                      "truncate font-mono text-xs",
                      isMe ? "text-text-primary" : "text-text-secondary",
                    )}
                  >
                    {shortenAddress(entry.player.toBase58(), 4)}
                    {isMe && <span className="ml-2 text-[10px] text-text-gold">you</span>}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-sm tabular-nums text-text-primary">
                  {entry.totalPoints.toLocaleString()}
                  <span className="ml-1 text-[10px] text-text-muted">pts</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
