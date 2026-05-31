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
import { TabNav } from "@/components/shared/TabNav";
import { useTabParam } from "@/lib/hooks/useTabParam";
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
import { ShowcaseBanner } from "./showcase-banner";
import { HeroesTab } from "./heroes-tab";
import { meditationLevelCap } from "./heroes/helpers";

const SPEEDUP_TIERS = [
  { tier: 1, label: "+1 hour", gems: 3_000 },
  { tier: 2, label: "+6 hours", gems: 18_000 },
];

const SUB_TABS = [
  { key: "heroes", label: "Heroes" },
  { key: "meditation", label: "Meditation" },
];

/** A hero's template id lives in its NFT attributes — never ask the user. */
function templateIdOf(asset: ParsedAssetV1 | null): number | null {
  const raw = asset?.attributes?.Template;
  if (raw == null) return null;
  const id = parseInt(raw, 10);
  return Number.isFinite(id) ? id : null;
}

export function SanctuaryTab() {
  const [subtab, setSubtab] = useTabParam("heroes", "subtab");

  return (
    <div className="flex h-full flex-col gap-3">
      <TabNav tabs={SUB_TABS} activeTab={subtab} onTabChange={setSubtab} />
      <div className="min-h-0 flex-1">
        {subtab === "meditation" ? <MeditationView /> : <HeroesTab />}
      </div>
    </div>
  );
}

function MeditationView() {
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const { data: geData } = useGameEngine();
  const player = playerData?.account;

  // Meditation XP is flat — Sanctuary level × 100/hr, no time-of-day term.
  // Mirrors `sanctuary_meditation_xp_per_hour` in
  // `programs/novus_mundus/src/helpers/estate.rs`.
  const sanctuaryLevel = estateData?.account
    ? (findBuilding(estateData.account, BuildingId.Sanctuary)?.level ?? 0)
    : 0;
  const meditationXpPerHour = sanctuaryLevel * 100;
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const transact = useTransact();

  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [heroAssets, setHeroAssets] = useState<(ParsedAssetV1 | null)[]>([null, null, null]);

  const meditating = player ? isHeroMeditating(player) : false;
  const meditationStart = player ? Number(player.meditationStartedAt) : 0;
  const meditatingSlot = player?.meditatingHeroSlot ?? 255;

  const traveling = player ? isTraveling(player) : false;

  const heroMintsKey = useMemo(
    () =>
      player
        ? (player.activeHeroes as { toBase58(): string }[]).map((m) => m.toBase58()).join(",")
        : "",
    [player],
  );

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

  // Chain caps elapsed at sanctuary_meditation_max_seconds = (24 + (level-1)*3) * 3600
  // (clamped to 48h); claiming after that window does not earn more XP.
  // Mirror the cap so the elapsed display and XP estimate match what the
  // user would actually receive on claim.
  const meditationMaxHours = sanctuaryLevel === 0 ? 0 : Math.min(48, 24 + (sanctuaryLevel - 1) * 3);
  const meditationMaxSeconds = meditationMaxHours * 3600;
  const now = Math.floor(Date.now() / 1000);
  const rawElapsed = meditating ? now - meditationStart : 0;
  const elapsed =
    meditationMaxSeconds > 0 ? Math.min(rawElapsed, meditationMaxSeconds) : rawElapsed;
  const elapsedHours = Math.floor(elapsed / 3600);
  const elapsedMinutes = Math.floor((elapsed % 3600) / 60);

  // Chain awards xp_per_hour * elapsed_seconds / 3600 — proportional within
  // the hour. Prior `floor(elapsed/3600) * rate` only ticked every full hour,
  // under-reporting partial-hour XP by up to one whole rate's worth.
  const meditationXpEstimate = meditating ? Math.floor((meditationXpPerHour * elapsed) / 3600) : 0;

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

  // Chain `meditation_level_cap` is φ-based and tighter than the
  // fragment-level-up cap. Once the selected hero reaches it, chain
  // rejects start_meditation; surface the cap in the UI so the user
  // sees the gate before paying the priority fee.
  const meditationCap = meditationLevelCap(sanctuaryLevel);
  const selectedHeroLevel = useMemo(() => {
    if (selectedSlot == null) return 0;
    const asset = heroAssets[selectedSlot];
    const raw = asset?.attributes?.Level;
    const lv = raw == null ? 0 : parseInt(raw as string, 10);
    return Number.isFinite(lv) ? lv : 0;
  }, [selectedSlot, heroAssets]);
  const meditationAtCap = meditationCap > 0 && selectedHeroLevel >= meditationCap;

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
    const ix = await createStartMeditationInstruction(
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
    const ix = await createClaimMeditationInstruction({
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
    const ix = await createSpeedupMeditationInstruction(
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
    const startIx = await createStartMeditationInstruction(
      { owner: publicKey, gameEngine: ge, heroMint, heroTemplateId },
      { heroSlot: selectedSlot },
    );
    const speedupIx = await createSpeedupMeditationInstruction(
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
    <div className="space-y-4">
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

          <div className="mt-4">
            <TxButton onClick={handleClaimMeditation} className="w-full">
              Claim Meditation Rewards
            </TxButton>
          </div>
        </div>
      )}

      {!meditating && (
        <div className="card">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Start Meditation
          </h3>
          <p className="mb-4 text-sm text-text-secondary">
            Send a locked hero to meditate for passive XP over time. Requires a Sanctuary building
            on your estate.
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
                ? `Sanctuary level ${sanctuaryLevel} · max session ${meditationMaxHours}h.`
                : "Build a Sanctuary to begin — the rate scales with its level."}
            </div>
          </div>

          {!hasLockedHero ? (
            <p className="rounded-lg border border-border-gold/40 bg-accent/10 px-4 py-3 text-sm text-text-gold">
              No locked heroes. Lock a hero into an active slot on the Heroes tab first — only
              locked heroes can meditate.
            </p>
          ) : (
            <>
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

              {selectedSlot != null &&
                heroSlots[selectedSlot]?.occupied &&
                (!meditationCityOk && selectedTemplate && player ? (
                  <p className="rounded-lg border border-border-gold/40 bg-accent/10 px-4 py-3 text-sm text-text-gold">
                    This hero can only meditate in {cityName(selectedTemplate.meditationCityId)},
                    you are in {cityName(player.currentCity)}.{" "}
                    <Link
                      href="/map"
                      className="font-semibold underline underline-offset-2 hover:opacity-80"
                    >
                      Travel
                    </Link>{" "}
                    there first.
                  </p>
                ) : meditationAtCap ? (
                  <p className="text-center text-sm text-red-300">
                    This hero is at the meditation cap for Sanctuary level {sanctuaryLevel} (Lv{" "}
                    {meditationCap}). Spend fragments in the Heroes tab to level past it, or upgrade
                    your Sanctuary.
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
                        gemBalance={Number(player?.gems ?? 0n)}
                      >
                        Meditate &amp; Speed Up (+1h)
                      </GemAction>
                      <GemAction
                        onClick={(rp) => handleMeditateAndSpeedup(2, rp)}
                        gemCost={18000}
                        gemBalance={Number(player?.gems ?? 0n)}
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
                    value: Number(gp.healthPerLevel).toLocaleString(),
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
    </div>
  );
}
