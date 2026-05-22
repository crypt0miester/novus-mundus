"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useWorldPlayer, useWorldCities, useWorldTeams, useCitizenStatus } from "@/lib/hooks/world";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { Badge } from "@/components/shared/Badge";
import { UnitGrid } from "@/components/shared/UnitGrid";
import { PageTransition } from "@/components/shared/PageTransition";
import { cn, shortenAddress } from "@/lib/utils";
import { useDomainName } from "@/lib/hooks/useDomainName";
import { isNullPubkey, calculateDefensivePower } from "novus-mundus-sdk";

const TIER_LABELS = ["Rookie", "Expert", "Epic", "Legendary"] as const;
const TIER_VARIANTS = ["default", "info", "epic", "legendary"] as const;

export default function PlayerProfilePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const { data: result, isLoading } = useWorldPlayer(address);
  const { data: cities } = useWorldCities();
  const { data: teams } = useWorldTeams();
  const citizen = useCitizenStatus();
  const domain = useDomainName(address);
  const [copied, setCopied] = useState(false);

  const cityMap = useMemo(() => {
    if (!cities) return new Map<number, string>();
    const map = new Map<number, string>();
    for (const c of cities) {
      map.set(c.account.cityId, c.account.name);
    }
    return map;
  }, [cities]);

  const teamInfo = useMemo(() => {
    if (!result?.account || !teams) return null;
    const teamPda = result.account.team;
    if (isNullPubkey(teamPda)) return null;
    const teamPdaStr = teamPda.toBase58();
    const match = teams.find((t) => t.pubkey.toBase58() === teamPdaStr);
    if (!match) return null;
    return { id: match.account.id.toNumber(), name: match.account.name };
  }, [result, teams]);

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-text-muted">
        Loading player...
      </div>
    );
  }

  if (!result || !result.exists || !result.account) {
    return (
      <PageTransition>
        <div className="mx-auto max-w-3xl space-y-6">
          <h1 className="tier-title font-display text-3xl font-bold tracking-wide">
            PLAYER NOT FOUND
          </h1>
          <div className="card">
            <p className="text-sm text-text-muted">
              No player account found for address{" "}
              <span className="font-mono text-text-secondary">{shortenAddress(address, 8)}</span>.
            </p>
            <Link
              href="/world"
              className="mt-3 inline-block text-sm text-text-gold hover:underline"
            >
              Back to Realm Overview
            </Link>
          </div>
        </div>
      </PageTransition>
    );
  }

  const player = result.account;
  const name = player.name || "Unnamed Warrior";
  const tierIndex = Math.min(player.subscriptionTier, 3);
  const cityName = cityMap.get(player.currentCity);
  const isProtected = player.newPlayerProtectionUntil.toNumber() > Math.floor(Date.now() / 1000);
  const createdDate = new Date(player.createdAt.toNumber() * 1000).toLocaleDateString();

  // Combat power = defensive units only (operatives don't fight on-chain)
  const totalPower = calculateDefensivePower(
    player.defensiveUnit1.toNumber(),
    player.defensiveUnit2.toNumber(),
    player.defensiveUnit3.toNumber(),
  );

  const isSelf = citizen.isCitizen && citizen.player && citizen.player.owner.toBase58() === address;

  const sameCity =
    citizen.isCitizen &&
    citizen.player &&
    citizen.player.currentCity === player.currentCity &&
    !isSelf;

  return (
    <PageTransition>
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Identity Card */}
        <div className="card accent-border">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-text-gold">{name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant="gold">Lv {player.level}</Badge>
                {tierIndex > 0 && (
                  <Badge variant={TIER_VARIANTS[tierIndex] as any}>{TIER_LABELS[tierIndex]}</Badge>
                )}
                {isProtected && <Badge variant="info">Protected</Badge>}
                {player.flaggedByGovernance && <Badge variant="danger">Flagged</Badge>}
                {isSelf && <Badge variant="success">You</Badge>}
              </div>
            </div>
            <div className="text-right text-xs text-text-muted">
              <button
                onClick={copyAddress}
                className="font-mono transition-colors hover:text-text-secondary"
              >
                {copied ? "Copied!" : (domain ?? shortenAddress(address, 6))}
              </button>
              <div className="mt-1">Joined {createdDate}</div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            {cityName && (
              <Link
                href={`/world/cities/${player.currentCity}`}
                className="text-text-secondary hover:text-text-gold transition-colors"
              >
                City: <span className="text-text-gold">{cityName}</span>
              </Link>
            )}
            {teamInfo && (
              <Link
                href={`/world/teams/${teamInfo.id}`}
                className="text-text-secondary hover:text-text-gold transition-colors"
              >
                Team:{" "}
                <span className="text-text-gold">{teamInfo.name || `Team #${teamInfo.id}`}</span>
              </Link>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: "Networth", value: player.networth.toNumber() },
            { label: "Combat Power", value: totalPower },
            { label: "Reputation", value: player.reputation.toNumber() },
            { label: "Level", value: player.level },
          ].map((stat) => (
            <div key={stat.label} className="card text-center">
              <div className="text-xs text-text-muted">{stat.label}</div>
              <GoldNumber value={stat.value} size="lg" />
            </div>
          ))}
        </div>

        {/* Army */}
        <div className="card">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Army
          </h3>
          <UnitGrid
            defense={[
              player.defensiveUnit1.toNumber(),
              player.defensiveUnit2.toNumber(),
              player.defensiveUnit3.toNumber(),
            ]}
            offense={[
              player.operativeUnit1.toNumber(),
              player.operativeUnit2.toNumber(),
              player.operativeUnit3.toNumber(),
            ]}
          />
          <div className="mt-4 grid grid-cols-4 gap-3">
            {[
              { label: "Melee", value: player.meleeWeapons.toNumber() },
              { label: "Ranged", value: player.rangedWeapons.toNumber() },
              { label: "Siege", value: player.siegeWeapons.toNumber() },
              { label: "Armor", value: player.armorPieces.toNumber() },
            ].map((w) => (
              <div key={w.label} className="text-center">
                <div className="text-[10px] text-text-muted">{w.label}</div>
                <div className="game-num text-sm">{w.value.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Combat Stats */}
        <div className="card">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Combat Record
          </h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              { label: "Total Attacks", value: player.totalAttacks.toNumber() },
              { label: "Total Defenses", value: player.totalDefenses.toNumber() },
              { label: "Encounter Kills", value: player.totalEncounterAttacks.toNumber() },
              { label: "Attack Power", value: player.totalAttackPower.toNumber() },
            ].map((s) => (
              <div key={s.label}>
                <div className="text-xs text-text-muted">{s.label}</div>
                <GoldNumber value={s.value} size="sm" />
              </div>
            ))}
          </div>
        </div>

        {/* Citizen Actions */}
        {sameCity && (
          <div className="card accent-border">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Actions
            </h3>
            <div className="flex gap-3">
              <Link
                href={`/combat?type=pvp`}
                className="rounded-md border border-red-800 bg-red-900/20 px-4 py-2 text-sm font-semibold text-red-400 transition-colors hover:bg-red-900/40"
              >
                Attack
              </Link>
              <Link
                href={`/estate?tab=market&transfer=${address}`}
                className="rounded-md border border-border-gold bg-accent/20 px-4 py-2 text-sm font-semibold text-text-gold transition-colors hover:bg-accent/40"
              >
                Send Cash
              </Link>
            </div>
          </div>
        )}
      </div>
    </PageTransition>
  );
}
