"use client";

import { useState, useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { GemAction } from "@/components/shared/GemAction";
import { shortenAddress } from "@/lib/utils";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import {
  isNullPubkey,
  isHeroMeditating,
  createStartMeditationInstruction,
  createClaimMeditationInstruction,
  createSpeedupMeditationInstruction,
  getCurrentTimeOfDay, getTimeOfDayName, getActivityMultiplier, isTraveling,
} from "@/lib/sdk";

const SPEEDUP_TIERS = [
  { tier: 1, label: "+1 hour", gems: 3_000 },
  { tier: 2, label: "+6 hours", gems: 18_000 },
];

export function SanctuaryTab() {
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const player = playerData?.account;
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [heroTemplateId, setHeroTemplateId] = useState(0);

  const meditating = player ? isHeroMeditating(player) : false;
  const meditationStart = player?.meditationStartedAt?.toNumber() ?? 0;
  const meditatingSlot = player?.meditatingHeroSlot ?? 255;

  const nowSec = Math.floor(Date.now() / 1000);
  const traveling = player ? isTraveling(player) : false;
  const tod = useMemo(() => getCurrentTimeOfDay(nowSec, 0), [nowSec]);
  const todName = getTimeOfDayName(tod);
  const meditationBonus = getActivityMultiplier('gathering' as any, tod);

  const heroSlots = useMemo(() => {
    if (!player) return [];
    return player.activeHeroes.map((mint, i) => ({
      slot: i,
      mint,
      occupied: !isNullPubkey(mint),
      isMeditating: meditating && meditatingSlot === i,
    }));
  }, [player, meditating, meditatingSlot]);

  const now = Math.floor(Date.now() / 1000);
  const elapsed = meditating ? now - meditationStart : 0;
  const elapsedHours = Math.floor(elapsed / 3600);
  const elapsedMinutes = Math.floor((elapsed % 3600) / 60);

  const meditationXpEstimate = meditating ? Math.floor(elapsed / 3600) * 50 : 0;

  const meditatingHeroMint = meditating && meditatingSlot < 3
    ? player!.activeHeroes[meditatingSlot]
    : null;

  const handleStartMeditation = async (reportPhase: (p: TxPhase) => void) => {
    if (selectedSlot == null || !publicKey) throw new Error("No slot selected");
    const heroMint = player!.activeHeroes[selectedSlot];
    if (isNullPubkey(heroMint)) throw new Error("No hero in this slot");

    const ge = client.gameEngine;
    const ix = createStartMeditationInstruction(
      { owner: publicKey, gameEngine: ge, heroMint, heroTemplateId },
      { heroSlot: selectedSlot }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Meditation started!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleClaimMeditation = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !meditatingHeroMint) throw new Error("Not meditating");
    const ge = client.gameEngine;
    const ix = createClaimMeditationInstruction({
      owner: publicKey,
      gameEngine: ge,
      heroMint: meditatingHeroMint,
      heroTemplateId,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Meditation rewards claimed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleSpeedup = async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createSpeedupMeditationInstruction(
      { owner: publicKey, gameEngine: ge },
      { speedupTier: tier }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: `Meditation sped up!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleMeditateAndSpeedup = async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (selectedSlot == null || !publicKey) throw new Error("No slot selected");
    const heroMint = player!.activeHeroes[selectedSlot];
    if (isNullPubkey(heroMint)) throw new Error("No hero in this slot");
    const ge = client.gameEngine;
    const startIx = createStartMeditationInstruction(
      { owner: publicKey, gameEngine: ge, heroMint, heroTemplateId },
      { heroSlot: selectedSlot }
    );
    const speedupIx = createSpeedupMeditationInstruction(
      { owner: publicKey, gameEngine: ge },
      { speedupTier: tier }
    );
    return transact.mutateAsync({
      instructions: [startIx, speedupIx],
      invalidateKeys: [["player"]],
      successMessage: `Meditation started & sped up!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span>{todName}</span>
        {meditationBonus > 1 ? (
          <span className="text-green-400">+{((meditationBonus - 1) * 100).toFixed(0)}% meditation XP</span>
        ) : meditationBonus < 1 ? (
          <span className="text-amber-400">{((meditationBonus - 1) * 100).toFixed(0)}% meditation XP</span>
        ) : null}
      </div>
      {traveling && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-4 py-3 text-sm text-amber-400">
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
              <div className="font-mono text-sm text-text-primary">
                {shortenAddress(meditatingHeroMint.toBase58())}
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
            <div className="text-sm font-semibold text-text-gold">~{meditationXpEstimate.toLocaleString()}</div>
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
            <div className="mb-2 rounded-lg border border-zinc-800 bg-surface/50 p-3">
              <label className="mb-1 block text-xs text-text-muted">
                Hero Template ID (same as when minted)
                <input
                  type="number"
                  value={heroTemplateId}
                  onChange={(e) => setHeroTemplateId(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-24 rounded border border-zinc-700 bg-surface px-2 py-1 text-sm text-text-primary"
                  min={0}
                />
              </label>
            </div>
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
            Lock a hero into meditation to earn XP over time. Requires a Sanctuary building on your estate.
          </p>

          {/* Hero Slots */}
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            {heroSlots.map((slot) => (
              <button
                key={slot.slot}
                onClick={() => slot.occupied ? setSelectedSlot(slot.slot) : undefined}
                disabled={!slot.occupied}
                className={`rounded-lg border p-4 text-left transition-all ${
                  selectedSlot === slot.slot
                    ? "border-amber-600 bg-amber-900/20"
                    : slot.occupied
                      ? "border-zinc-800 hover:border-zinc-700"
                      : "border-zinc-900 opacity-40"
                }`}
              >
                <div className="text-xs text-text-muted">Slot {slot.slot}</div>
                {slot.occupied ? (
                  <div className="mt-1 font-mono text-sm text-text-primary">
                    {shortenAddress(slot.mint.toBase58())}
                  </div>
                ) : (
                  <div className="mt-1 text-sm text-text-muted italic">Empty</div>
                )}
              </button>
            ))}
            {heroSlots.length === 0 && (
              <p className="col-span-3 text-sm text-text-muted">
                No hero data available. Lock heroes on the Hero page first.
              </p>
            )}
          </div>

          {/* Template ID + Start */}
          {selectedSlot != null && heroSlots[selectedSlot]?.occupied && (
            <div className="space-y-3">
              <div className="rounded-lg border border-zinc-800 bg-surface/50 p-3">
                <label className="mb-1 block text-xs text-text-muted">
                  Hero Template ID (from when you minted this hero)
                  <input
                    type="number"
                    value={heroTemplateId}
                    onChange={(e) => setHeroTemplateId(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-24 rounded border border-zinc-700 bg-surface px-2 py-1 text-sm text-text-primary"
                    min={0}
                  />
                </label>
              </div>
              <div className="space-y-3">
                <div className="flex justify-center">
                  <TxButton onClick={handleStartMeditation} disabled={traveling} className="px-8 py-3 text-lg">
                    Begin Meditation (Slot {selectedSlot})
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
            </div>
          )}
        </div>
      )}
      {/* Game Parameters */}
      {geData?.account && (() => {
        const gp = geData.account.gameplayConfig;
        return (
          <GameInfoPanel>
            <InfoGrid items={[
              { label: "Gem Cost/Min Speedup", value: gp.gemCostPerMinuteSpeedup.toString(), highlight: true },
              { label: "Health/Level", value: gp.healthPerLevel.toNumber().toLocaleString() },
              { label: "Defense/Level", value: gp.defensePerLevel.toString() },
              { label: "Happiness Synch Max", value: gp.happinessSynchronyMax.toString() },
              { label: "Level Synch Bonus", value: gp.levelSynchronyBonusPerLevel.toString(), suffix: "/lvl" },
            ]} columns={3} />
          </GameInfoPanel>
        );
      })()}
    </div>
  );
}
