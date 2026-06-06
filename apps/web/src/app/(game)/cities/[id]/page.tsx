"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import {
  useWorldCities,
  useWorldPlayers,
  useWorldTeams,
  useCitizenStatus,
} from "@/lib/hooks/world";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { Badge } from "@/components/shared/Badge";
import { PlayerCard } from "@/components/shared/PlayerCard";
import { PageTransition } from "@/components/shared/PageTransition";
import { cn } from "@/lib/utils";
import { getCityLore } from "@/lib/cityLore";
import { CITY_TYPE_NAMES } from "novus-mundus-sdk";

// Variant order matches the on-chain CityType enum (Capital, Resource, Combat, Trade).
const CITY_TYPE_VARIANTS = ["legendary", "success", "danger", "gold"] as const;

export default function CityRosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const cityId = parseInt(id, 10);
  const { data: cities, isLoading: citiesLoading } = useWorldCities();
  const { data: allPlayers, isLoading: playersLoading } = useWorldPlayers();
  const { data: allTeams } = useWorldTeams();
  const citizen = useCitizenStatus();

  const city = useMemo(() => {
    if (!cities) return null;
    return cities.find((c) => c.account.cityId === cityId) ?? null;
  }, [cities, cityId]);

  const cityPlayers = useMemo(() => {
    if (!allPlayers) return [];
    return allPlayers
      .filter((p) => p.account.currentCity === cityId)
      .sort((a, b) => Number(b.account.networth) - Number(a.account.networth));
  }, [allPlayers, cityId]);

  // Build team lookup map
  const teamMap = useMemo(() => {
    if (!allTeams) return new Map<string, { id: number; name: string }>();
    const map = new Map<string, { id: number; name: string }>();
    for (const t of allTeams) {
      map.set(t.pubkey.toBase58(), {
        id: Number(t.account.id),
        name: t.account.name,
      });
    }
    return map;
  }, [allTeams]);

  // Derive teams present from players' team PDAs
  const teamsPresent = useMemo(() => {
    const teamPdas = new Set<string>();
    for (const p of cityPlayers) {
      const teamAddr = p.account.team.toBase58();
      if (teamAddr !== "11111111111111111111111111111111") {
        teamPdas.add(teamAddr);
      }
    }
    const result: { id: number; name: string; memberCount: number }[] = [];
    for (const pda of teamPdas) {
      const info = teamMap.get(pda);
      if (info) {
        const count = cityPlayers.filter((p) => p.account.team.toBase58() === pda).length;
        result.push({ ...info, memberCount: count });
      }
    }
    return result.sort((a, b) => b.memberCount - a.memberCount);
  }, [cityPlayers, teamMap]);

  const isLoading = citiesLoading || playersLoading;

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-text-muted">
        Loading city...
      </div>
    );
  }

  if (!city) {
    return (
      <PageTransition>
        <div className="mx-auto max-w-3xl space-y-6">
          <h1 className="tier-title font-display text-3xl font-bold tracking-wide">
            CITY NOT FOUND
          </h1>
          <div className="card">
            <p className="text-sm text-text-muted">City #{id} does not exist.</p>
            <Link
              href="/cities"
              className="mt-3 inline-block text-sm text-text-gold hover:underline"
            >
              Browse Cities
            </Link>
          </div>
        </div>
      </PageTransition>
    );
  }

  const c = city.account;
  const lore = getCityLore(cityId);
  const typeIndex = Math.min(c.cityType, 3);
  const isCurrentCity =
    citizen.isCitizen && citizen.player && citizen.player.currentCity === cityId;

  return (
    <PageTransition>
      <div className="mx-auto max-w-4xl space-y-6">
        {/* City Info */}
        <div className={cn("card accent-border", isCurrentCity && "accent-border-bright")}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-text-gold">{c.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant={CITY_TYPE_VARIANTS[typeIndex] as any}>
                  {CITY_TYPE_NAMES[typeIndex]}
                </Badge>
                {isCurrentCity && <Badge variant="success">You are here</Badge>}
              </div>
              {lore && (
                <div className="mt-1 text-xs uppercase tracking-wider text-text-muted">
                  {lore.region}
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="text-xs text-text-muted">Players Present</div>
              <GoldNumber value={c.playersPresent} size="lg" />
            </div>
          </div>

          {lore && (
            <p className="mt-4 text-sm italic leading-relaxed text-text-secondary">{lore.lore}</p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <span className="text-text-muted">Coordinates: </span>
              <span className="text-text-secondary">
                ({c.latitude.toFixed(2)}, {c.longitude.toFixed(2)})
              </span>
            </div>
            <div>
              <span className="text-text-muted">Encounter Levels: </span>
              <span className="text-text-secondary">
                {c.minEncounterLevel}-{c.maxEncounterLevel}
              </span>
            </div>
            <div>
              <span className="text-text-muted">Teams Present: </span>
              <span className="text-text-secondary">{teamsPresent.length}</span>
            </div>
            <div>
              <span className="text-text-muted">Plot: </span>
              <span className="text-text-secondary">
                {c.widthGrid} × {c.heightGrid} cells
              </span>
            </div>
          </div>
        </div>

        {/* Teams in City */}
        {teamsPresent.length > 0 && (
          <div>
            <h2 className="mb-3 text-lg font-semibold text-text-primary">Teams in {c.name}</h2>
            <div className="flex flex-wrap gap-2">
              {teamsPresent.map((t) => (
                <Link
                  key={t.id}
                  href={`/team/${t.id}`}
                  className="card inline-flex items-center gap-2 transition-all"
                >
                  <span className="text-sm font-semibold text-text-primary">
                    {t.name || `Team #${t.id}`}
                  </span>
                  <span className="text-xs text-text-muted">{t.memberCount} here</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Citizens */}
        <div>
          <h2 className="mb-3 text-lg font-semibold text-text-primary">Citizens of {c.name}</h2>
          <div className="space-y-2">
            {cityPlayers.map((p, i) => (
              <PlayerCard
                key={p.pubkey.toBase58()}
                address={p.account.owner.toBase58()}
                player={p.account}
                rank={i + 1}
                showNetworth
                highlight={
                  citizen.isCitizen &&
                  citizen.player?.owner.toBase58() === p.account.owner.toBase58()
                }
              />
            ))}
            {cityPlayers.length === 0 && (
              <div className="card">
                <p className="text-sm text-text-muted">No players currently in this city.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
