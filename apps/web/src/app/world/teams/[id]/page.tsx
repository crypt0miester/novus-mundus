"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import {
  useWorldTeam,
  useWorldTeamMembers,
  useWorldPlayers,
  useCitizenStatus,
} from "@/lib/hooks/world";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { Badge } from "@/components/shared/Badge";
import { PageTransition } from "@/components/shared/PageTransition";
import { DomainName } from "@/components/shared/DomainName";
import { deriveTeamPda } from "@/lib/sdk";
import { useNovusMundusClient } from "@/lib/solana/provider";

const RANK_LABELS = ["Member", "Officer", "Co-Leader", "Leader"] as const;
const RANK_VARIANTS = ["default", "info", "gold", "legendary"] as const;

export default function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const teamId = parseInt(id, 10);
  const client = useNovusMundusClient();

  const [teamPda] = deriveTeamPda(client.gameEngine, teamId);
  const teamPdaStr = teamPda.toBase58();

  const { data: teamResult, isLoading: teamLoading } = useWorldTeam(teamId);
  const { data: members } = useWorldTeamMembers(teamPdaStr);
  const { data: allPlayers } = useWorldPlayers();
  const citizen = useCitizenStatus();

  const team = teamResult?.account;

  // Build a map of player PDA → player data
  const playerMap = useMemo(() => {
    if (!allPlayers) return new Map<string, { name: string; level: number; networth: number; owner: string }>();
    const map = new Map<string, { name: string; level: number; networth: number; owner: string }>();
    for (const p of allPlayers) {
      map.set(p.pubkey.toBase58(), {
        name: p.account.name || "Unnamed",
        level: p.account.level,
        networth: p.account.networth.toNumber(),
        owner: p.account.owner.toBase58(),
      });
    }
    return map;
  }, [allPlayers]);

  // Sort members by rank descending
  const sortedMembers = useMemo(() => {
    if (!members) return [];
    return [...members].sort((a, b) => b.account.rank - a.account.rank);
  }, [members]);

  // Aggregate stats
  const stats = useMemo(() => {
    if (!sortedMembers.length || !playerMap.size) return null;
    let totalNetworth = 0;
    let totalLevel = 0;
    let count = 0;
    for (const m of sortedMembers) {
      const pdata = playerMap.get(m.account.player.toBase58());
      if (pdata) {
        totalNetworth += pdata.networth;
        totalLevel += pdata.level;
        count++;
      }
    }
    return {
      totalNetworth,
      avgLevel: count > 0 ? Math.round(totalLevel / count) : 0,
    };
  }, [sortedMembers, playerMap]);

  const citizenHasTeam =
    citizen.isCitizen &&
    citizen.player &&
    citizen.player.team.toBase58() !== "11111111111111111111111111111111";

  if (teamLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-text-muted">
        Loading team...
      </div>
    );
  }

  if (!teamResult?.exists || !team) {
    return (
      <PageTransition>
        <div className="mx-auto max-w-3xl space-y-6">
          <h1 className="tier-title font-display text-3xl font-bold tracking-wide">
            TEAM NOT FOUND
          </h1>
          <div className="card">
            <p className="text-sm text-text-muted">Team #{id} does not exist.</p>
            <Link href="/world/teams" className="mt-3 inline-block text-sm text-text-gold hover:underline">
              Browse Teams
            </Link>
          </div>
        </div>
      </PageTransition>
    );
  }

  const isPublic = (team.settings & 1) !== 0;
  const createdDate = new Date(team.createdAt.toNumber() * 1000).toLocaleDateString();
  const canJoin = citizen.isCitizen && !citizenHasTeam && isPublic;

  return (
    <PageTransition>
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Team Info */}
        <div className="card accent-border">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-text-gold">
                {team.name || `Team #${teamId}`}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant={isPublic ? "success" : "default"}>
                  {isPublic ? "Public" : "Private"}
                </Badge>
                <Badge variant="gold">
                  {team.memberCount}/{team.maxMembers} Members
                </Badge>
                {team.minLevelToJoin > 1 && (
                  <Badge variant="info">Lv {team.minLevelToJoin}+</Badge>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-text-muted">Treasury</div>
              <GoldNumber value={team.treasury.toNumber()} prefix="$" size="lg" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-text-muted">Leader: </span>
              <Link
                href={`/world/players/${team.leader.toBase58()}`}
                className="text-text-gold hover:underline"
              >
                <DomainName pubkey={team.leader} chars={4} />
              </Link>
            </div>
            <div>
              <span className="text-text-muted">Founded: </span>
              <span className="text-text-secondary">{createdDate}</span>
            </div>
          </div>

          {team.motd && (
            <div className="mt-3 rounded bg-surface-overlay px-3 py-2 text-sm italic text-text-secondary">
              "{team.motd}"
            </div>
          )}

          {canJoin && (
            <div className="mt-4">
              <Link
                href={`/team?join=${teamId}`}
                className="inline-block rounded-md border border-border-gold bg-amber-900/20 px-4 py-2 text-sm font-semibold text-text-gold transition-colors hover:bg-amber-900/40"
              >
                Join Team
              </Link>
            </div>
          )}
        </div>

        {/* Aggregate Stats */}
        {stats && (
          <div className="grid grid-cols-2 gap-3">
            <div className="card text-center">
              <div className="text-xs text-text-muted">Total Networth</div>
              <GoldNumber value={stats.totalNetworth} size="lg" />
            </div>
            <div className="card text-center">
              <div className="text-xs text-text-muted">Avg Level</div>
              <GoldNumber value={stats.avgLevel} size="lg" />
            </div>
          </div>
        )}

        {/* Roster */}
        <div className="card">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Roster
          </h3>
          <div className="space-y-1">
            <div className="flex items-center gap-4 border-b border-zinc-800 pb-2 text-xs font-semibold uppercase text-text-muted">
              <span className="w-20">Rank</span>
              <span className="flex-1">Player</span>
              <span className="hidden w-20 text-right sm:block">Networth</span>
              <span className="hidden w-24 text-right sm:block">Joined</span>
            </div>
            {sortedMembers.map((m) => {
              const pdata = playerMap.get(m.account.player.toBase58());
              const joinDate = new Date(
                m.account.joinedAt.toNumber() * 1000
              ).toLocaleDateString();
              const rankIndex = Math.min(m.account.rank, 3);

              return (
                <div
                  key={m.pubkey.toBase58()}
                  className="flex items-center gap-4 rounded-lg px-2 py-2"
                >
                  <span className="w-20">
                    <Badge variant={RANK_VARIANTS[rankIndex] as any}>
                      {RANK_LABELS[rankIndex]}
                    </Badge>
                  </span>
                  <Link
                    href={`/world/players/${pdata?.owner ?? m.account.player.toBase58()}`}
                    className="flex-1 truncate text-sm text-text-secondary hover:text-text-gold transition-colors"
                  >
                    {pdata?.name ?? <DomainName pubkey={m.account.player} chars={4} />}
                    {pdata && (
                      <span className="ml-2 text-xs text-text-muted">
                        Lv{pdata.level}
                      </span>
                    )}
                  </Link>
                  <span className="hidden w-20 text-right sm:block">
                    {pdata ? (
                      <GoldNumber value={pdata.networth} size="sm" />
                    ) : (
                      <span className="text-xs text-text-muted">-</span>
                    )}
                  </span>
                  <span className="hidden w-24 text-right text-xs text-text-muted sm:block">
                    {joinDate}
                  </span>
                </div>
              );
            })}
            {sortedMembers.length === 0 && (
              <p className="py-4 text-center text-sm text-text-muted">
                No members found.
              </p>
            )}
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
