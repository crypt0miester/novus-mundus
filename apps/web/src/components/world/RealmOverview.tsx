"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  useWorldPlayers,
  useWorldTeams,
  useWorldCities,
  useCitizenStatus,
} from "@/lib/hooks/world";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { PlayerCard } from "@/components/shared/PlayerCard";
import { TeamCard } from "@/components/shared/TeamCard";

export function RealmOverview() {
  const { data: players, isLoading: playersLoading } = useWorldPlayers();
  const { data: teams, isLoading: teamsLoading } = useWorldTeams();
  const { data: cities, isLoading: citiesLoading } = useWorldCities();
  const citizen = useCitizenStatus();

  const isLoading = playersLoading || teamsLoading || citiesLoading;

  const topPlayers = useMemo(() => {
    if (!players) return [];
    return [...players]
      .sort((a, b) => b.account.networth.toNumber() - a.account.networth.toNumber())
      .slice(0, 5);
  }, [players]);

  const topTeams = useMemo(() => {
    if (!teams) return [];
    return [...teams]
      .sort((a, b) => b.account.memberCount - a.account.memberCount)
      .slice(0, 5);
  }, [teams]);

  const topCities = useMemo(() => {
    if (!cities) return [];
    return [...cities]
      .sort((a, b) => b.account.playersPresent - a.account.playersPresent)
      .slice(0, 4);
  }, [cities]);

  const cityMap = useMemo(() => {
    if (!cities) return new Map<number, string>();
    const map = new Map<number, string>();
    for (const c of cities) {
      map.set(c.account.cityId, c.account.name);
    }
    return map;
  }, [cities]);

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-text-muted">
        Loading realm data...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Realm Stats */}
      <div className="card accent-border">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-xs text-text-muted">Total Players</div>
            <GoldNumber value={players?.length ?? 0} size="lg" />
          </div>
          <div>
            <div className="text-xs text-text-muted">Total Teams</div>
            <GoldNumber value={teams?.length ?? 0} size="lg" />
          </div>
          <div>
            <div className="text-xs text-text-muted">Total Cities</div>
            <GoldNumber value={cities?.length ?? 0} size="lg" />
          </div>
        </div>
      </div>

      {/* Citizen Status */}
      {citizen.isCitizen && citizen.player && (
        <div className="card accent-border-bright">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Your Status
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-text-muted">Level</div>
              <div className="text-lg font-bold text-text-gold">{citizen.player.level}</div>
            </div>
            <div>
              <div className="text-xs text-text-muted">City</div>
              <div className="text-sm text-text-primary">
                {cityMap.get(citizen.player.currentCity) ?? `City #${citizen.player.currentCity}`}
              </div>
            </div>
            <div>
              <div className="text-xs text-text-muted">Networth</div>
              <GoldNumber value={citizen.player.networth.toNumber()} />
            </div>
          </div>
        </div>
      )}

      {/* Top Players */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Top Players</h2>
          <Link href="/world/leaderboard" className="text-xs text-text-gold hover:underline">
            View Full Leaderboard
          </Link>
        </div>
        <div className="space-y-2">
          {topPlayers.map((p, i) => (
            <PlayerCard
              key={p.pubkey.toBase58()}
              address={p.account.owner.toBase58()}
              player={p.account}
              rank={i + 1}
              showCity
              cityName={cityMap.get(p.account.currentCity)}
              compact
            />
          ))}
          {topPlayers.length === 0 && (
            <div className="card">
              <p className="text-sm text-text-muted">No players found.</p>
            </div>
          )}
        </div>
      </div>

      {/* Active Cities */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Active Cities</h2>
          <Link href="/world/cities" className="text-xs text-text-gold hover:underline">
            Browse All Cities
          </Link>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {topCities.map((c) => (
            <Link
              key={c.pubkey.toBase58()}
              href={`/world/cities/${c.account.cityId}`}
              className="card transition-all"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-text-primary">{c.account.name}</div>
                  <div className="text-xs text-text-muted">
                    {["Capital", "Trade", "Combat", "Resource"][c.account.cityType]}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-text-muted">Players</div>
                  <GoldNumber value={c.account.playersPresent} size="sm" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Top Teams */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Top Teams</h2>
          <Link href="/world/teams" className="text-xs text-text-gold hover:underline">
            Browse All Teams
          </Link>
        </div>
        <div className="space-y-2">
          {topTeams.map((t, i) => (
            <TeamCard
              key={t.pubkey.toBase58()}
              teamId={t.account.id.toNumber()}
              team={t.account}
              rank={i + 1}
            />
          ))}
          {topTeams.length === 0 && (
            <div className="card">
              <p className="text-sm text-text-muted">No teams found.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
