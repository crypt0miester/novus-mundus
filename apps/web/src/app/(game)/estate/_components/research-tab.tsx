"use client";

import { useState, useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useResearchBuffs } from "@/lib/hooks/useDerived";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { SpeedupPanel } from "@/components/shared/SpeedupPanel";
import { GemAction } from "@/components/shared/GemAction";
import {
  derivePlayerPda,
  deriveResearchPda,
  createCreateProgressInstruction,
  createStartResearchInstruction,
  createCompleteResearchInstruction,
  createSpeedUpResearchInstruction,
  createCancelResearchInstruction,
  createAscendInstruction,
  calculateResearchCost,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  isTraveling,
} from "@/lib/sdk";
import BN from "bn.js";

const RESEARCH_TYPES = [
  { id: 0, name: "Attack", icon: "\u2694", desc: "Increase attack power" },
  { id: 1, name: "Defense", icon: "\uD83D\uDEE1", desc: "Increase defense power" },
  { id: 2, name: "Crit Chance", icon: "\uD83C\uDFAF", desc: "Higher critical hit rate" },
  { id: 3, name: "Crit Damage", icon: "\uD83D\uDCA5", desc: "More damage on crits" },
  { id: 4, name: "Loot Bonus", icon: "\uD83D\uDCB0", desc: "Better loot drops" },
  { id: 5, name: "Stamina", icon: "\u26A1", desc: "Faster stamina regen" },
  { id: 6, name: "Collection", icon: "\uD83D\uDCE6", desc: "Resource collection bonus" },
];

export function ResearchTab() {
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const buffs = useResearchBuffs();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const transact = useTransact();

  // Fetch research progress
  const { data: researchData } = useQuery({
    queryKey: ["research", publicKey?.toBase58()],
    queryFn: async () => {
      if (!publicKey) return null;
      const ge = client.gameEngine;
      const [playerPda] = derivePlayerPda(ge, publicKey);
      const [researchPda] = deriveResearchPda(playerPda);
      const info = await connection.getAccountInfo(researchPda);
      if (!info) return { pubkey: researchPda, exists: false, account: null };
      return { pubkey: researchPda, exists: true, account: null };
    },
    enabled: !!publicKey,
    staleTime: 10_000,
  });

  const [selectedResearch, setSelectedResearch] = useState(0);

  // Time-of-day indicator
  const now = Math.floor(Date.now() / 1000);
  const timeInfo = useMemo(() => {
    if (!player) return null;
    const longitude = player.currentLong ?? 0;
    const tod = getCurrentTimeOfDay(now, longitude / 10000);
    const researchMult = getActivityMultiplier('researching' as any, tod);
    return {
      name: getTimeOfDayName(tod),
      researchMult,
    };
  }, [player, now]);

  // Traveling warning
  const travelWarning = useMemo(() => {
    if (!player) return null;
    return isTraveling(player) ? "Cannot research while traveling" : null;
  }, [player]);

  // Research cost preview for selected type
  // On-chain uses base_novi_cost * 1.8^level. SDK uses calculateResearchCost(baseCost, level, GOLDEN_ROOT).
  // We show both an approximate cost and time progression for levels 1-10.
  const researchCostPreview = useMemo(() => {
    // Base cost is 5,000 NOVI for most research types (approx from on-chain templates)
    const baseCost = 5_000;
    const baseTimeSeconds = 3_600; // 1 hour base
    const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    return levels.map((lvl) => ({
      level: lvl,
      cost: calculateResearchCost(baseCost, lvl),
      timeHours: Math.max(1, Math.round((baseTimeSeconds * Math.pow(1.5, lvl)) / 3600)),
    }));
  }, []);

  // Current research level display (from buffs)
  const currentResearchLevel = useMemo(() => {
    const buff = buffs.find((b) => {
      const typeNames = ["Attack", "Defense", "Crit Chance", "Crit Damage", "Loot Bonus", "Stamina", "Collection"];
      return b.label === typeNames[selectedResearch];
    });
    if (!buff) return 0;
    // Approximate level from bps (each level adds roughly 100-200 bps)
    return Math.round(buff.bps / 100);
  }, [buffs, selectedResearch]);

  const handleCreateProgress = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [researchPda] = deriveResearchPda(playerPda);
    const ix = createCreateProgressInstruction({
      player: playerPda,
      research: researchPda,
      gameEngine: ge,
      owner: publicKey,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["research"], ["player"]],
      successMessage: "Research unlocked!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleStart = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [researchPda] = deriveResearchPda(playerPda);
    const ix = createStartResearchInstruction({
      player: playerPda,
      research: researchPda,
      gameEngine: ge,
      owner: publicKey,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["research"], ["player"]],
      successMessage: "Research started!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleComplete = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [researchPda] = deriveResearchPda(playerPda);
    const ix = createCompleteResearchInstruction({
      player: playerPda,
      research: researchPda,
      gameEngine: ge,
      owner: publicKey,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["research"], ["player"]],
      successMessage: "Research complete!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleInstantResearch = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [researchPda] = deriveResearchPda(playerPda);
    const startIx = createStartResearchInstruction({
      player: playerPda, research: researchPda, gameEngine: ge, owner: publicKey,
    });
    const speedupIx = createSpeedUpResearchInstruction(
      { owner: publicKey, gameEngine: ge, researchType: selectedResearch },
      { speedUpSeconds: 0 },
    );
    const completeIx = createCompleteResearchInstruction({
      player: playerPda, research: researchPda, gameEngine: ge, owner: publicKey,
    });
    return transact.mutateAsync({
      instructions: [startIx, speedupIx, completeIx],
      invalidateKeys: [["research"], ["player"]],
      successMessage: `${RESEARCH_TYPES[selectedResearch]?.name} research completed instantly!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleResearchSpeedup = async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const geKey = client.gameEngine;
    // Tier 1 = skip 1 hour, Tier 2 = complete all (0 = instant)
    const speedUpSeconds = tier === 2 ? 0 : 3600;
    const ix = createSpeedUpResearchInstruction(
      { owner: publicKey, gameEngine: geKey, researchType: selectedResearch },
      { speedUpSeconds },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["research"], ["player"]],
      successMessage: "Research sped up!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleCancelResearch = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createCancelResearchInstruction({
      owner: publicKey,
      gameEngine: ge,
      researchType: selectedResearch,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["research"], ["player"]],
      successMessage: "Research cancelled!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleAscend = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createAscendInstruction(
      { owner: publicKey, gameEngine: ge },
      { researchType: selectedResearch },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["research"], ["player"]],
      successMessage: `${RESEARCH_TYPES[selectedResearch]?.name} ascended!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  return (
    <div className="space-y-6">
      {travelWarning && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-900/20 p-3 text-sm text-amber-300">
          {travelWarning}
        </div>
      )}

      {/* Time of Day */}
      {timeInfo && (
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span>Time of Day: <span className="text-text-secondary">{timeInfo.name}</span></span>
          {timeInfo.researchMult > 1 && (
            <span className="text-green-400">
              Research speed bonus: {((timeInfo.researchMult - 1) * 100).toFixed(0)}% faster
            </span>
          )}
          {timeInfo.researchMult < 1 && (
            <span className="text-amber-400">
              Research speed penalty: {((1 - timeInfo.researchMult) * 100).toFixed(0)}% slower
            </span>
          )}
          <span className="text-[11px]">
            (Best at Deep Night, Dawn, Evening)
          </span>
        </div>
      )}

      {/* Current Buffs */}
      {buffs.length > 0 && (
        <div className="card accent-border">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Active Research Buffs
          </h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {buffs.map((buff) => (
              <div key={buff.label} className="rounded-lg border border-zinc-800 p-3 text-center">
                <div className="text-xs text-text-muted">{buff.label}</div>
                <div className="text-lg font-bold text-text-gold">
                  +{(buff.bps / 100).toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Research */}
      {researchData?.exists && player && player.researchBuffVersion > 0 && (
        <div className="card">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Research Active
          </h3>
          <p className="text-sm text-text-secondary">Research system is active. Complete research to earn buffs.</p>
        </div>
      )}

      {/* Research not initialized */}
      {!researchData?.exists && researchData !== undefined && (
        <div className="card text-center">
          <p className="mb-4 text-text-secondary">
            Unlock the research system to boost your abilities.
          </p>
          <TxButton onClick={handleCreateProgress}>Unlock Research</TxButton>
        </div>
      )}

      {/* Research Types */}
      {researchData?.exists && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-text-primary">Research Tree</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {RESEARCH_TYPES.map((type) => (
              <button
                key={type.id}
                onClick={() => setSelectedResearch(type.id)}
                className={`rounded-lg border p-4 text-left transition-all ${
                  selectedResearch === type.id
                    ? "border-amber-600 bg-amber-900/20"
                    : "border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{type.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-text-primary">{type.name}</div>
                      {selectedResearch === type.id && currentResearchLevel > 0 && (
                        <span className="text-[11px] text-text-gold">Lv {currentResearchLevel}/10</span>
                      )}
                    </div>
                    <div className="text-xs text-text-muted">{type.desc}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
          {/* Research Cost Preview */}
          <div className="mt-4 rounded-lg border border-zinc-800 bg-surface/50 p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              {RESEARCH_TYPES[selectedResearch]?.name} Research — Cost Preview
            </h3>
            {currentResearchLevel > 0 && (
              <div className="mb-2 text-[11px] text-text-gold">
                Current Level: {currentResearchLevel}/10
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {researchCostPreview.slice(0, 6).map((r) => (
                <div
                  key={r.level}
                  className={`rounded border px-2 py-1 text-center ${
                    r.level === currentResearchLevel + 1
                      ? "border-amber-600 bg-amber-900/20"
                      : "border-zinc-800"
                  }`}
                >
                  <div className="text-[11px] text-text-muted">Lv {r.level}</div>
                  <div className="text-xs font-semibold text-text-gold">{r.cost.toLocaleString()}</div>
                  <div className="text-[11px] text-text-muted">~{r.timeHours}h</div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-text-muted">
              Cost scales by ~1.27x per level (golden root). Time scales by 1.5x per level.
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <TxButton onClick={handleStart}>
              Start {RESEARCH_TYPES[selectedResearch]?.name} Research
            </TxButton>
            <GemAction
              onClick={handleInstantResearch}
              gemCost={5000}
              gemBalance={player?.gems?.toNumber?.() ?? 0}
            >
              Instant {RESEARCH_TYPES[selectedResearch]?.name}
            </GemAction>
            <TxButton onClick={handleCancelResearch} variant="danger">
              Cancel Research
            </TxButton>
            {currentResearchLevel >= 25 && (
              <TxButton
                onClick={handleAscend}
                className="border-amber-500 bg-amber-900/30 text-text-gold hover:bg-amber-900/50"
              >
                Ascend {RESEARCH_TYPES[selectedResearch]?.name}
              </TxButton>
            )}
          </div>
          {/* Research Speedup */}
          <div className="mt-6">
            <SpeedupPanel
              visible={researchData?.exists ?? false}
              remainingSeconds={3600}
              onSpeedup={handleResearchSpeedup}
              tiers={[
                { tier: 1, label: "Skip 1 Hour", description: "Skip 1 hour of research time", gemCost: 500 },
                { tier: 2, label: "Instant", description: "Complete all remaining time", gemCost: 5000 },
              ]}
              gemBalance={player?.gems?.toNumber?.()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
