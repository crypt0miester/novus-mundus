"use client";

import { useMemo } from "react";
import { History } from "lucide-react";
import { isNullPubkey } from "novus-mundus-sdk";
import type { ArenaParticipantAccount, ArenaBattleResolvedEvent } from "novus-mundus-sdk";
import { InfoButton } from "@/components/shared/InfoButton";
import { shortenAddress } from "@/lib/utils";

interface ArenaRecentBattlesProps {
  participant: ArenaParticipantAccount;
}

function relativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// The fields an ArenaBattleResolved indexer would later attach to each row.
// Typed but unpopulated here: the on-chain participant only stores opponent +
// timestamp, so win/loss, ELO delta, and power need an event-sourced backend.
type EnrichedBattle = Pick<
  ArenaBattleResolvedEvent,
  "challengerWon" | "newChallengerElo" | "challengerPower"
>;

interface BattleRow {
  opponent: string;
  timestamp: number;
  enrichment: EnrichedBattle | null;
}

export function ArenaRecentBattles({ participant }: ArenaRecentBattlesProps) {
  // battleOpponents/battleTimestamps are a 10-slot ring buffer; battleIndex is
  // the next write slot, so the most recent battle sits at battleIndex - 1.
  // Walk backward to render most-recent-first, dropping unfilled slots.
  const rows = useMemo<BattleRow[]>(() => {
    const out: BattleRow[] = [];
    const len = participant.battleOpponents.length;
    if (len === 0) return out;
    for (let step = 1; step <= len; step++) {
      const idx = (participant.battleIndex - step + len) % len;
      const opponent = participant.battleOpponents[idx];
      const ts = participant.battleTimestamps[idx];
      if (!opponent || isNullPubkey(opponent)) continue;
      const tsNum = Number(ts ?? 0n);
      if (tsNum <= 0) continue;
      out.push({ opponent: opponent.toBase58(), timestamp: tsNum, enrichment: null });
    }
    return out;
  }, [participant]);

  return (
    <div className="card space-y-3">
      <h3 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
        <History className="h-3.5 w-3.5" />
        Recent Activity
        <InfoButton>
          The opponents you last faced, read from your on-chain participant record. It keeps your
          last 10 matchups. Win/loss, ELO change, and battle power are not stored on the account, so
          a full battle log needs a backend that indexes the ArenaBattleResolved events.
        </InfoButton>
      </h3>

      {rows.length === 0 ? (
        <p className="text-center text-xs text-text-muted">
          No battles yet. Find a match to start your record.
        </p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row, i) => (
            <li
              key={`${row.opponent}-${row.timestamp}-${i}`}
              className="flex items-center justify-between rounded-lg border border-zinc-800 bg-surface-raised/40 px-3 py-2"
            >
              <span className="font-mono text-xs text-text-secondary">
                vs {shortenAddress(row.opponent, 4)}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-text-muted">
                {relativeTime(row.timestamp)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-text-muted">
        Showing recent opponents only. Detailed results (outcome, ELO delta, power) require an
        indexer consuming arena battle events.
      </p>
    </div>
  );
}
