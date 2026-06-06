"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { Copy, Check, Share2 } from "lucide-react";
import { useWorldPlayer, useWorldCities, useWorldTeams, useCitizenStatus } from "@/lib/hooks/world";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { Badge } from "@/components/shared/Badge";
import { ProgressRing } from "@/components/shared/ProgressRing";
import { UnitGrid } from "@/components/shared/UnitGrid";
import { PageTransition } from "@/components/shared/PageTransition";
import { shortenAddress } from "@/lib/utils";
import { useDomainName } from "@/lib/hooks/useDomainName";
import {
  isNullPubkey,
  calculateDefensivePower,
  levelProgressPercent,
  xpRequiredForLevel,
  getEffectiveTier,
} from "novus-mundus-sdk";

const TIER_LABELS = ["Rookie", "Expert", "Epic", "Legendary"] as const;
const TIER_VARIANTS = ["default", "info", "epic", "legendary"] as const;

// Per-tier visual accents — mirrors the body[data-tier="N"] palette in
// `globals.css`. The viewing user's body `--tier-accent` only matches the
// profile owner when isSelf=true; for someone else's profile we need to key
// off the profile owner's tier explicitly, so the colours are inlined here as
// hex/rgba copies of the CSS variables (Rookie 92400e, Expert CD7F32,
// Epic daa520, Legendary 8B1A1A).
interface TierAccent {
  ring: string; // hex — stroke / avatar border / level number
  bright: string; // hex — chip text (the brighter cousin)
  chipBg: string; // rgba — chip background
  chipBorder: string; // rgba — chip border
  glow: string; // rgba — corner glow background + boxShadow tint
}

const TIER_ACCENT: Record<number, TierAccent> = {
  0: {
    ring: "#92400e",
    bright: "#b45309",
    chipBg: "rgba(146, 64, 14, 0.10)",
    chipBorder: "rgba(146, 64, 14, 0.40)",
    glow: "rgba(146, 64, 14, 0.55)",
  },
  1: {
    ring: "#CD7F32",
    bright: "#D4944A",
    chipBg: "rgba(205, 127, 50, 0.10)",
    chipBorder: "rgba(205, 127, 50, 0.45)",
    glow: "rgba(205, 127, 50, 0.55)",
  },
  2: {
    ring: "#daa520",
    bright: "#f1af09",
    chipBg: "rgba(218, 165, 32, 0.10)",
    chipBorder: "rgba(218, 165, 32, 0.45)",
    glow: "rgba(218, 165, 32, 0.55)",
  },
  3: {
    ring: "#8B1A1A",
    bright: "#9a2222",
    chipBg: "rgba(139, 26, 26, 0.15)",
    chipBorder: "rgba(139, 26, 26, 0.50)",
    glow: "rgba(139, 26, 26, 0.65)",
  },
};

/** First grapheme of a name, capitalised. Falls back to "?" for blanks. */
function initialOf(name: string): string {
  const first = name.trim()[0];
  return first ? first.toUpperCase() : "?";
}

/** Parse a base58 wallet param to a PublicKey, or null if malformed. */
function parsePubkeyParam(value: string): PublicKey | null {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

export default function PlayerProfilePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  // Narrow the route param before any query so a malformed address is a clean
  // not-found here instead of a thrown `new PublicKey(...)` inside the queryFn.
  const parsedAddress = useMemo(() => parsePubkeyParam(address), [address]);
  const { data: result, isLoading } = useWorldPlayer(parsedAddress ? address : undefined);
  const { data: cities } = useWorldCities();
  const { data: teams } = useWorldTeams();
  const citizen = useCitizenStatus();
  const domain = useDomainName(address);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

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
    return { id: Number(match.account.id), name: match.account.name };
  }, [result, teams]);

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 1500);
  };

  const copyShareLink = () => {
    const url =
      typeof window !== "undefined"
        ? window.location.origin + window.location.pathname
        : `/players/${address}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 1500);
  };

  if (!parsedAddress) {
    return (
      <PageTransition>
        <div className="mx-auto max-w-3xl space-y-6">
          <h1 className="tier-title font-display text-3xl font-bold tracking-wide">
            PLAYER NOT FOUND
          </h1>
          <div className="card">
            <p className="text-sm text-text-muted">
              <span className="font-mono text-text-secondary">{shortenAddress(address, 8)}</span> is
              not a valid wallet address.
            </p>
            <Link
              href="/map"
              className="mt-3 inline-block text-sm text-text-gold hover:underline"
            >
              Back to Realm Overview
            </Link>
          </div>
        </div>
      </PageTransition>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-text-muted">
        Loading player...
      </div>
    );
  }

  if (!result?.exists || !result.account) {
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
              href="/map"
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
  // subscription_tier on chain persists until the next downgrade_expired ix
  // even after subscription_end < now. Use getEffectiveTier so an expired
  // Legendary doesn't still wear the crimson ring/chip and out-of-sync the
  // viewer's own useTierTheme (which gates on expiry).
  const effectiveTier = getEffectiveTier(player, Math.floor(Date.now() / 1000));
  const tierIndex = Math.min(effectiveTier, 3);
  const tierAccent = TIER_ACCENT[tierIndex] ?? TIER_ACCENT[0];
  const cityName = cityMap.get(player.currentCity);
  const isProtected = Number(player.newPlayerProtectionUntil) > Math.floor(Date.now() / 1000);
  const createdDate = new Date(Number(player.createdAt) * 1000).toLocaleDateString();

  // Combat power = defensive units only (operatives don't fight on-chain)
  const totalPower = calculateDefensivePower(
    Number(player.defensiveUnit1),
    Number(player.defensiveUnit2),
    Number(player.defensiveUnit3),
  );

  const xpProgress = levelProgressPercent(player.level, Number(player.currentXp));
  const xpToNext = xpRequiredForLevel(player.level + 1);
  const xpCurrent = Number(player.currentXp);

  const isSelf = citizen.isCitizen && citizen.player && citizen.player.owner.toBase58() === address;

  const sameCity =
    citizen.isCitizen &&
    citizen.player &&
    citizen.player.currentCity === player.currentCity &&
    !isSelf;

  const displayHandle = domain ?? shortenAddress(address, 6);

  return (
    <PageTransition>
      <div className="mx-auto max-w-4xl space-y-4">
        {/* ── Hero header ── shareable identity card */}
        <section
          className="relative overflow-hidden rounded-2xl border border-border-default bg-gradient-to-br from-surface-raised via-surface to-surface-raised p-5 sm:p-7"
          style={{ boxShadow: `0 0 48px -16px ${tierAccent.glow}` }}
        >
          {/* Subtle tier-tinted glow at the corner */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full opacity-40 blur-3xl"
            style={{ background: tierAccent.glow }}
          />

          {/* Share affordance — corner, doesn't compete with the name */}
          <div className="absolute right-4 top-4 z-10 flex gap-2">
            <button
              onClick={copyShareLink}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-surface/80 px-2.5 py-1 text-[11px] font-medium text-text-muted backdrop-blur transition-colors hover:border-border-gold hover:text-text-gold"
              title="Copy shareable link to this profile"
            >
              {copiedLink ? <Check className="h-3 w-3" /> : <Share2 className="h-3 w-3" />}
              {copiedLink ? "Copied" : "Share"}
            </button>
          </div>

          <div className="relative flex flex-col items-center gap-5 sm:flex-row sm:items-stretch sm:gap-6">
            {/* Avatar + name block */}
            <div className="flex flex-1 flex-col items-center text-center sm:items-start sm:text-left">
              <div
                className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 font-display text-3xl font-bold sm:h-24 sm:w-24 sm:text-4xl"
                style={{
                  backgroundColor: tierAccent.chipBg,
                  borderColor: tierAccent.ring,
                  color: tierAccent.bright,
                }}
              >
                {initialOf(name)}
              </div>

              <h1 className="mt-3 font-display text-3xl font-bold leading-tight tracking-wide text-text-primary sm:text-4xl">
                {name}
              </h1>

              <button
                onClick={copyAddress}
                className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs text-text-muted transition-colors hover:text-text-secondary"
                title="Copy wallet address"
              >
                {copiedAddr ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copiedAddr ? "Address copied" : displayHandle}
              </button>

              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                {/* "You" sits first so the viewer's own tag leads — same tier
                    accent as the tier label so the two read as one identity
                    pair instead of competing with a foreign colour. */}
                {isSelf && (
                  <span
                    className="rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                    style={{
                      backgroundColor: tierAccent.chipBg,
                      borderColor: tierAccent.chipBorder,
                      color: tierAccent.bright,
                    }}
                  >
                    You
                  </span>
                )}
                <span
                  className="rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                  style={{
                    backgroundColor: tierAccent.chipBg,
                    borderColor: tierAccent.chipBorder,
                    color: tierAccent.bright,
                  }}
                >
                  {TIER_LABELS[tierIndex]}
                </span>
                {isProtected && <Badge variant="info">Protected</Badge>}
                {player.flaggedByGovernance && <Badge variant="danger">Flagged</Badge>}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-text-muted sm:justify-start">
                {cityName && (
                  <Link
                    href={`/cities/${player.currentCity}`}
                    className="transition-colors hover:text-text-gold"
                  >
                    <span className="text-text-muted">City </span>
                    <span className="text-text-secondary">{cityName}</span>
                  </Link>
                )}
                {teamInfo && (
                  <Link
                    href={`/team/${teamInfo.id}`}
                    className="transition-colors hover:text-text-gold"
                  >
                    <span className="text-text-muted">Team </span>
                    <span className="text-text-secondary">
                      {teamInfo.name || `#${teamInfo.id}`}
                    </span>
                  </Link>
                )}
                <span>
                  <span className="text-text-muted">Joined </span>
                  <span className="text-text-secondary">{createdDate}</span>
                </span>
              </div>
            </div>

            {/* Level ring — the headline visual */}
            <div className="flex shrink-0 flex-col items-center justify-center gap-1">
              <ProgressRing percent={xpProgress} size={128} strokeWidth={5} color={tierAccent.ring}>
                <div className="flex flex-col items-center leading-none">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    Level
                  </div>
                  <div
                    className="font-display text-4xl font-bold tabular-nums"
                    style={{ color: tierAccent.ring }}
                  >
                    {player.level}
                  </div>
                </div>
              </ProgressRing>
              <div className="font-mono text-[10px] tabular-nums text-text-muted">
                {xpCurrent.toLocaleString()} / {xpToNext.toLocaleString()} XP
              </div>
            </div>
          </div>

          {/* Headline stats — three big numbers in the same hero card so the
              screenshot reads as one composed image. */}
          <div className="relative mt-5 grid grid-cols-3 gap-2 border-t border-border-default pt-4 sm:gap-4 sm:pt-5">
            {[
              { label: "Networth", value: Number(player.networth) },
              { label: "Combat Power", value: totalPower },
              { label: "Reputation", value: Number(player.reputation) },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  {stat.label}
                </div>
                <div className="mt-1">
                  <GoldNumber value={stat.value} size="lg" />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Army */}
        <div className="card">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Army
          </h3>
          <UnitGrid
            defense={[
              Number(player.defensiveUnit1),
              Number(player.defensiveUnit2),
              Number(player.defensiveUnit3),
            ]}
            offense={[
              Number(player.operativeUnit1),
              Number(player.operativeUnit2),
              Number(player.operativeUnit3),
            ]}
          />
          {/* Equipment + provisions. Produce + drays sit with the army stats
              because they're what gets the army to the fight and keep it fed. */}
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
            {[
              { label: "Melee", value: Number(player.meleeWeapons) },
              { label: "Ranged", value: Number(player.rangedWeapons) },
              { label: "Siege", value: Number(player.siegeWeapons) },
              { label: "Armor", value: Number(player.armorPieces) },
              { label: "Produce", value: Number(player.produce) },
              { label: "Drays", value: Number(player.vehicles) },
            ].map((w) => (
              <div key={w.label} className="text-center">
                <div className="text-[10px] text-text-muted">{w.label}</div>
                <div className="game-num text-sm">{w.value.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Combat Record */}
        <div className="card">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Combat Record
          </h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              { label: "Total Attacks", value: Number(player.totalAttacks) },
              { label: "Total Defenses", value: Number(player.totalDefenses) },
              { label: "Encounter Kills", value: Number(player.totalEncounterAttacks) },
              { label: "Attack Power", value: Number(player.totalAttackPower) },
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
              {/*
                Pre-snap the f64 lat/long to the chain's 1/10000-degree grid so
                the /map deep-link consumer (Math.round(lat * 10000)) reads the
                same cell the chain wrote. All current writers (player init,
                intercity/intracity complete, teleport) snap to grid centres
                via LocationAccount::from_grid, but a future processor that
                writes a mid-cell f64 (interpolated travel, near-but-not-on-
                grid spawn) would otherwise round to a neighbouring cell and
                focus the wrong square here. Doing the snap at the source
                makes the URL invariant explicit.
              */}
              <Link
                href={(() => {
                  const gridLat = Math.round(player.currentLat * 10000);
                  const gridLong = Math.round(player.currentLong * 10000);
                  const snapLat = gridLat / 10000;
                  const snapLong = gridLong / 10000;
                  return `/map?city=${player.currentCity}&lat=${snapLat}&long=${snapLong}&player=${address}`;
                })()}
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
