"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { BuildingId } from "@/lib/hooks/useFeatureGate";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { GemAction } from "@/components/shared/GemAction";
import { shortenAddress } from "@/lib/utils";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useAccountStore } from "@/lib/store/accounts";
import {
  isNullPubkey,
  isHeroMeditating,
  isHeroAtHome,
  createStartMeditationInstruction,
  createClaimMeditationInstruction,
  createSpeedupMeditationInstruction,
  parseAssetV1,
  findBuilding,
  isTraveling,
  type ParsedAssetV1,
} from "novus-mundus-sdk";
import { FeatureLayout } from "./feature-layout";
import { ShowcaseBanner } from "./showcase-banner";

const SPEEDUP_TIERS = [
  { tier: 1, label: "+1 hour", gems: 3_000 },
  { tier: 2, label: "+6 hours", gems: 18_000 },
];

/** A hero's template id lives in its NFT attributes — never ask the user. */
function templateIdOf(asset: ParsedAssetV1 | null): number | null {
  const raw = asset?.attributes?.["Template"];
  if (raw == null) return null;
  const id = parseInt(raw, 10);
  return Number.isFinite(id) ? id : null;
}

export function SanctuaryTab() {
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const { data: geData } = useGameEngine();
  const player = playerData?.account;

  // Meditation XP is flat — Sanctuary level × 20/hr, no time-of-day term.
  const sanctuaryLevel = estateData?.account
    ? (findBuilding(estateData.account, BuildingId.Sanctuary)?.level ?? 0)
    : 0;
  const meditationXpPerHour = sanctuaryLevel * 20;
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const transact = useTransact();

  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  // Hero NFT assets for the three active slots — drives names + template ids.
  const [heroAssets, setHeroAssets] = useState<(ParsedAssetV1 | null)[]>([null, null, null]);

  const meditating = player ? isHeroMeditating(player) : false;
  const meditationStart = player?.meditationStartedAt?.toNumber() ?? 0;
  const meditatingSlot = player?.meditatingHeroSlot ?? 255;

  const traveling = player ? isTraveling(player) : false;

  // Keyed on the slot mints so we only refetch when the line-up changes.
  const heroMintsKey = useMemo(
    () =>
      player
        ? (player.activeHeroes as { toBase58(): string }[]).map((m) => m.toBase58()).join(",")
        : "",
    [player],
  );

  // Pull the locked heroes' NFT assets so we can read each one's template id.
  useEffect(() => {
    if (!player || !connection) return;
    const mints = player.activeHeroes as { toBase58(): string }[];
    const filled = mints
      .map((mint, slot) => ({ mint, slot }))
      .filter((e) => !isNullPubkey(e.mint as never));
    if (filled.length === 0) {
      setHeroAssets([null, null, null]);
      return;
    }
    let cancelled = false;
    connection
      .getMultipleAccountsInfo(filled.map((e) => e.mint as never))
      .then((infos) => {
        if (cancelled) return;
        const next: (ParsedAssetV1 | null)[] = [null, null, null];
        filled.forEach((e, i) => {
          const data = infos[i]?.data;
          if (data) next[e.slot] = parseAssetV1(data) ?? null;
        });
        setHeroAssets(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [heroMintsKey, connection, player]);

  const now = Math.floor(Date.now() / 1000);
  const elapsed = meditating ? now - meditationStart : 0;
  const elapsedHours = Math.floor(elapsed / 3600);
  const elapsedMinutes = Math.floor((elapsed % 3600) / 60);

  const meditationXpEstimate = meditating ? Math.floor(elapsed / 3600) * 50 : 0;

  const heroSlots = useMemo(() => {
    if (!player) return [];
    return (player.activeHeroes as { toBase58(): string }[]).map((mint, i) => ({
      slot: i,
      mint,
      occupied: !isNullPubkey(mint as never),
      asset: heroAssets[i],
      isMeditating: meditating && meditatingSlot === i,
    }));
  }, [player, heroAssets, meditating, meditatingSlot]);

  const hasLockedHero = heroSlots.some((s) => s.occupied);

  // Some hero templates require meditation in a specific origin city.
  const heroTemplatesMap = useAccountStore((s) => s.heroTemplates);
  const cities = useAccountStore((s) => s.cities);

  const cityName = (id: number) => {
    for (const c of cities.values()) {
      if (c.account.cityId === id) return c.account.name;
    }
    return `City #${id}`;
  };

  const selectedTemplate = useMemo(() => {
    if (selectedSlot == null) return null;
    const tid = templateIdOf(heroAssets[selectedSlot]);
    if (tid == null) return null;
    for (const e of heroTemplatesMap.values()) {
      if (e.account.templateId === tid) return e.account;
    }
    return null;
  }, [selectedSlot, heroAssets, heroTemplatesMap]);

  const meditationCityOk =
    !selectedTemplate || !player || isHeroAtHome(selectedTemplate, player.currentCity);

  const meditatingHeroMint =
    meditating && meditatingSlot < 3 ? player!.activeHeroes[meditatingSlot] : null;
  const meditatingAsset = meditating && meditatingSlot < 3 ? heroAssets[meditatingSlot] : null;
  const heroLabel = (asset: ParsedAssetV1 | null, mint: { toBase58(): string }) =>
    asset?.name || shortenAddress(mint.toBase58());

  const handleStartMeditation = async (reportPhase: (p: TxPhase) => void) => {
    if (selectedSlot == null || !publicKey) throw new Error("No slot selected");
    const heroMint = player!.activeHeroes[selectedSlot];
    if (isNullPubkey(heroMint)) throw new Error("No hero in this slot");
    const heroTemplateId = templateIdOf(heroAssets[selectedSlot]);
    if (heroTemplateId == null) {
      throw new Error("Hero data still loading — reopen the Sanctuary and retry");
    }

    const ge = client.gameEngine;
    const ix = createStartMeditationInstruction(
      { owner: publicKey, gameEngine: ge, heroMint, heroTemplateId },
      { heroSlot: selectedSlot },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Meditation started!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleClaimMeditation = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !meditatingHeroMint) throw new Error("Not meditating");
    const heroTemplateId = templateIdOf(meditatingAsset);
    if (heroTemplateId == null) {
      throw new Error("Hero data still loading — reopen the Sanctuary and retry");
    }
    const ge = client.gameEngine;
    const ix = createClaimMeditationInstruction({
      owner: publicKey,
      gameEngine: ge,
      heroMint: meditatingHeroMint,
      heroTemplateId,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Meditation rewards claimed!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleSpeedup = async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createSpeedupMeditationInstruction(
      { owner: publicKey, gameEngine: ge },
      { speedupTier: tier as 1 | 2 },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: `Meditation sped up!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleMeditateAndSpeedup = async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (selectedSlot == null || !publicKey) throw new Error("No slot selected");
    const heroMint = player!.activeHeroes[selectedSlot];
    if (isNullPubkey(heroMint)) throw new Error("No hero in this slot");
    const heroTemplateId = templateIdOf(heroAssets[selectedSlot]);
    if (heroTemplateId == null) {
      throw new Error("Hero data still loading — reopen the Sanctuary and retry");
    }
    const ge = client.gameEngine;
    const startIx = createStartMeditationInstruction(
      { owner: publicKey, gameEngine: ge, heroMint, heroTemplateId },
      { heroSlot: selectedSlot },
    );
    const speedupIx = createSpeedupMeditationInstruction(
      { owner: publicKey, gameEngine: ge },
      { speedupTier: tier as 1 | 2 },
    );
    return transact
      .mutateAsync({
        instructions: [startIx, speedupIx],
        invalidateKeys: [["player"]],
        successMessage: `Meditation started & sped up!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  return (
    <FeatureLayout
      main={
        <>
          <ShowcaseBanner
            image="/img/banners/sanctuary-banner.webp"
            icon="sanctuary-meditation"
            title={
              meditating && meditatingHeroMint
                ? heroLabel(meditatingAsset, meditatingHeroMint)
                : "Meditation"
            }
            tag={
              meditating
                ? `Slot ${meditatingSlot}`
                : meditationXpPerHour > 0
                  ? `${meditationXpPerHour.toLocaleString()} XP / hr`
                  : undefined
            }
          >
            {meditating ? (
              <>
                <p className="text-xs italic text-zinc-300">
                  A hero sits in stillness, gathering experience with every passing hour.
                </p>
                <p className="text-xs text-zinc-400">
                  <span className="font-mono tabular-nums text-zinc-100">
                    {elapsedHours}h {elapsedMinutes}m
                  </span>{" "}
                  elapsed · ~
                  <span className="font-mono tabular-nums text-text-gold">
                    {meditationXpEstimate.toLocaleString()}
                  </span>{" "}
                  XP earned
                </p>
              </>
            ) : (
              <>
                <p className="text-xs italic text-zinc-300">
                  A quiet hall where a locked hero can sit and gather experience over time.
                </p>
                <p className="text-xs text-zinc-400">
                  {meditationXpPerHour > 0 ? (
                    <>
                      Earning{" "}
                      <span className="font-mono tabular-nums text-text-gold">
                        {meditationXpPerHour.toLocaleString()}
                      </span>{" "}
                      XP per hour at Sanctuary level {sanctuaryLevel}.
                    </>
                  ) : (
                    "Build a Sanctuary on your estate to begin."
                  )}
                </p>
              </>
            )}
          </ShowcaseBanner>

          {traveling && (
            <div className="rounded-lg border border-border-gold bg-accent/20 px-4 py-3 text-sm text-danger">
              You are currently traveling. Meditation may be restricted.
            </div>
          )}

          {/* Active Meditation */}
          {meditating && meditatingHeroMint && (
            <div className="card accent-border">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Active Meditation
              </h3>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-muted">Hero (Slot {meditatingSlot})</div>
                  <div className="text-sm font-semibold text-text-primary">
                    {heroLabel(meditatingAsset, meditatingHeroMint)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-text-muted">Elapsed</div>
                  <div className="text-lg font-semibold text-text-gold">
                    {elapsedHours}h {elapsedMinutes}m
                  </div>
                </div>
              </div>
              <div className="text-right mt-2">
                <div className="text-xs text-text-muted">Est. XP Earned</div>
                <div className="text-sm font-semibold text-text-gold">
                  ~{meditationXpEstimate.toLocaleString()}
                </div>
              </div>

              {/* Speedup */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {SPEEDUP_TIERS.map((s) => (
                  <TxButton
                    key={s.tier}
                    onClick={(reportPhase) => handleSpeedup(s.tier, reportPhase)}
                    variant="secondary"
                    className="text-xs"
                  >
                    {s.label} ({s.gems.toLocaleString()} gems)
                  </TxButton>
                ))}
              </div>

              {/* Claim */}
              <div className="mt-4">
                <TxButton onClick={handleClaimMeditation} className="w-full">
                  Claim Meditation Rewards
                </TxButton>
              </div>
            </div>
          )}

          {/* Start Meditation */}
          {!meditating && (
            <div className="card">
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Start Meditation
              </h3>
              <p className="mb-4 text-sm text-text-secondary">
                Send a locked hero to meditate for passive XP over time. Requires a Sanctuary
                building on your estate.
              </p>

              <div className="mb-4 rounded-lg bg-surface-overlay/30 px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-muted">Meditation rate</span>
                  <span className="font-mono font-semibold tabular-nums text-text-gold">
                    {meditationXpPerHour.toLocaleString()} XP / hr
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-text-muted">
                  {meditationXpPerHour > 0
                    ? `Sanctuary level ${sanctuaryLevel} · ≈ ${Math.ceil(
                        5000 / meditationXpPerHour,
                      )} hr per hero level (5,000 XP).`
                    : "Build a Sanctuary to begin — the rate scales with its level."}
                </div>
              </div>

              {!hasLockedHero ? (
                <p className="rounded-lg border border-border-gold/40 bg-accent/10 px-4 py-3 text-sm text-text-gold">
                  No locked heroes. Lock a hero into an active slot on the Heroes page first — only
                  locked heroes can meditate.
                </p>
              ) : (
                <>
                  {/* Hero Slots */}
                  <div className="mb-4 grid gap-3 md:grid-cols-3">
                    {heroSlots.map((slot) => (
                      <button
                        key={slot.slot}
                        onClick={() => (slot.occupied ? setSelectedSlot(slot.slot) : undefined)}
                        disabled={!slot.occupied}
                        className={`rounded-lg border p-4 text-left transition-all ${
                          selectedSlot === slot.slot
                            ? "border-border-gold bg-accent/20"
                            : slot.occupied
                              ? "border-zinc-800 hover:border-zinc-700"
                              : "border-zinc-900 opacity-40"
                        }`}
                      >
                        <div className="text-xs text-text-muted">Slot {slot.slot}</div>
                        {slot.occupied ? (
                          <div className="mt-1 text-sm font-semibold text-text-primary">
                            {heroLabel(slot.asset, slot.mint)}
                          </div>
                        ) : (
                          <div className="mt-1 text-sm text-text-muted italic">Empty</div>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Start — template is derived from the chosen hero's NFT */}
                  {selectedSlot != null &&
                    heroSlots[selectedSlot]?.occupied &&
                    (!meditationCityOk && selectedTemplate && player ? (
                      <p className="rounded-lg border border-border-gold/40 bg-accent/10 px-4 py-3 text-sm text-text-gold">
                        This hero can only meditate in {cityName(selectedTemplate.meditationCityId)}
                        , you are in {cityName(player.currentCity)}.{" "}
                        <Link
                          href="/map"
                          className="font-semibold underline underline-offset-2 hover:opacity-80"
                        >
                          Travel
                        </Link>{" "}
                        there first.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex justify-center">
                          <TxButton
                            onClick={handleStartMeditation}
                            disabled={traveling}
                            className="px-8 py-3 text-lg"
                          >
                            Begin Meditation
                          </TxButton>
                        </div>
                        <div className="flex flex-wrap justify-center gap-2">
                          <GemAction
                            onClick={(rp) => handleMeditateAndSpeedup(1, rp)}
                            gemCost={3000}
                            gemBalance={player?.gems?.toNumber?.() ?? 0}
                          >
                            Meditate &amp; Speed Up (+1h)
                          </GemAction>
                          <GemAction
                            onClick={(rp) => handleMeditateAndSpeedup(2, rp)}
                            gemCost={18000}
                            gemBalance={player?.gems?.toNumber?.() ?? 0}
                          >
                            Meditate &amp; Speed Up (+6h)
                          </GemAction>
                        </div>
                      </div>
                    ))}
                </>
              )}
            </div>
          )}
          {/* Game Parameters */}
          {geData?.account &&
            (() => {
              const gp = geData.account.gameplayConfig;
              return (
                <GameInfoPanel>
                  <InfoGrid
                    items={[
                      {
                        label: "Gem Cost/Min Speedup",
                        value: gp.gemCostPerMinuteSpeedup.toString(),
                        highlight: true,
                      },
                      {
                        label: "Health/Level",
                        value: gp.healthPerLevel.toNumber().toLocaleString(),
                      },
                      { label: "Defense/Level", value: gp.defensePerLevel.toString() },
                      { label: "Happiness Synch Max", value: gp.happinessSynchronyMax.toString() },
                      {
                        label: "Level Synch Bonus",
                        value: gp.levelSynchronyBonusPerLevel.toString(),
                        suffix: "/lvl",
                      },
                    ]}
                    columns={3}
                  />
                </GameInfoPanel>
              );
            })()}
        </>
      }
    />
  );
}
