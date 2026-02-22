"use client";

import { useState, useMemo, useCallback } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useResearchBuffs } from "@/lib/hooks/useDerived";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { DetailPanel } from "@/components/shared/DetailPanel";
import { SpeedupPanel } from "@/components/shared/SpeedupPanel";
import { GemAction } from "@/components/shared/GemAction";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import {
  derivePlayerPda,
  deriveResearchPda,
  deriveResearchTemplatePda,
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
  parseResearchTemplate,
  parseResearchProgress,
  isResearching,
  isResearchComplete,
  getResearchLevel,
  checkResearchPrerequisites,
} from "@/lib/sdk";
import type { ResearchTemplateAccount, ResearchProgressAccount } from "@/lib/sdk";

// ─── Category / buff-type display maps ──────────────────────
const CATEGORY_NAMES: Record<number, string> = { 0: "Battle", 1: "Economy", 2: "Growth" };
const CATEGORY_ICONS: Record<number, string> = { 0: "\u2694", 1: "\uD83D\uDCE6", 2: "\u26A1" };
const BUFF_NAMES: Record<number, string> = {
  0: "Attack Power", 1: "Defense Power", 2: "Unit Capacity", 3: "Crit Chance",
  4: "Crit Damage", 5: "Rally Capacity", 6: "Encounter Success", 7: "Loot Bonus",
  8: "Training Speed", 9: "Ambush Damage",
  10: "Production", 11: "Resource Cap", 12: "Market Tax", 13: "Trade Speed",
  14: "Mining Output", 15: "Cash Gen", 16: "Build Speed", 17: "Upkeep Reduction",
  18: "Black Market", 19: "Tax Collection",
  20: "Daily Rewards", 21: "Mining Ops", 22: "Fishing", 23: "Loot Magnetism",
  24: "Reputation", 25: "Stamina", 26: "Streak Bonus", 27: "Fragment Discovery",
  28: "Gem Prospecting", 29: "Collection Mastery", 30: "Travel Speed",
};

// ─── Fetch all initialized research templates (types 0-29) ──
function useResearchTemplates() {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["research-templates"],
    queryFn: async () => {
      const pdas = Array.from({ length: 30 }, (_, i) => deriveResearchTemplatePda(i)[0]);
      const infos = await connection.getMultipleAccountsInfo(pdas);
      const templates: (ResearchTemplateAccount & { pda: string })[] = [];
      for (let i = 0; i < 30; i++) {
        const info = infos[i];
        if (!info) continue;
        const parsed = parseResearchTemplate(info);
        if (parsed && parsed.isActive) {
          templates.push({ ...parsed, pda: pdas[i].toBase58() });
        }
      }
      return templates;
    },
    staleTime: 60_000, // templates rarely change
  });
}

// ─── Fetch player's research progress ───────────────────────
function useResearchProgress() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const client = useNovusMundusClient();

  return useQuery({
    queryKey: ["research-progress", publicKey?.toBase58()],
    queryFn: async () => {
      if (!publicKey) return null;
      const [playerPda] = derivePlayerPda(client.gameEngine, publicKey);
      const [researchPda] = deriveResearchPda(playerPda);
      const info = await connection.getAccountInfo(researchPda);
      if (!info) return { exists: false as const, account: null };
      const account = parseResearchProgress(info);
      return { exists: true as const, account };
    },
    enabled: !!publicKey,
    staleTime: 10_000,
  });
}

/* ─── Detail panel (shared between desktop sidebar + mobile bottom sheet) ─── */

function ResearchDetailPanel({
  template,
  progress,
  playerData,
  onStart,
  onComplete,
  onInstant,
  onCancel,
  onAscend,
  onSpeedup,
  onClose,
}: {
  template: ResearchTemplateAccount;
  progress: ResearchProgressAccount | null;
  playerData: any;
  onStart: (rp: (p: TxPhase) => void) => Promise<string>;
  onComplete: (rp: (p: TxPhase) => void) => Promise<string>;
  onInstant: (rp: (p: TxPhase) => void) => Promise<string>;
  onCancel: (rp: (p: TxPhase) => void) => Promise<string>;
  onAscend: (rp: (p: TxPhase) => void) => Promise<string>;
  onSpeedup: (tier: number, rp: (p: TxPhase) => void) => Promise<string>;
  onClose: () => void;
}) {
  const gemBalance = playerData?.account?.gems?.toNumber?.() ?? 0;
  const noviBalance = playerData?.account?.lockedNovi?.toNumber?.() ?? 0;
  const currentLevel = progress ? getResearchLevel(progress, template.researchType) : 0;
  const isActiveForThis = progress
    ? isResearching(progress) && progress.currentResearch === template.researchType
    : false;
  const nowSec = Math.floor(Date.now() / 1000);
  const isComplete = progress
    ? isActiveForThis && isResearchComplete(progress, nowSec)
    : false;
  const canMeetPrereqs = progress ? checkResearchPrerequisites(progress, template) : true;
  const isAnyActive = progress ? isResearching(progress) : false;
  const remainingSeconds = isActiveForThis && progress
    ? Math.max(0, progress.completesAt.toNumber() - nowSec)
    : 0;
  const buffName = BUFF_NAMES[template.buffType] ?? `Buff #${template.buffType}`;
  const categoryName = CATEGORY_NAMES[template.category] ?? "Unknown";

  // Cost preview from on-chain base cost
  const baseCost = template.baseNoviCost.toNumber();
  const baseTime = template.baseTimeSeconds;
  const nextLevelCost = currentLevel < template.maxLevel
    ? calculateResearchCost(baseCost, currentLevel + 1)
    : 0;
  const hasEnoughNovi = noviBalance >= nextLevelCost;
  const costPreview = useMemo(() => {
    const levels = Array.from({ length: Math.min(template.maxLevel, 10) }, (_, i) => i + 1);
    return levels.map((lvl) => ({
      level: lvl,
      cost: calculateResearchCost(baseCost, lvl),
      timeHours: Math.max(0.1, Math.round((baseTime * Math.pow(1.5, lvl)) / 360) / 10),
    }));
  }, [baseCost, baseTime, template.maxLevel]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          {buffName} Research
        </h3>
        <button
          onClick={onClose}
          className="hidden rounded border border-border-default px-2 py-0.5 text-xs text-text-muted hover:text-text-secondary lg:block"
        >
          Close
        </button>
      </div>

      {/* Template info */}
      <div className="flex items-center gap-3">
        <span className="text-3xl">{CATEGORY_ICONS[template.category] ?? "?"}</span>
        <div>
          <div className="text-sm font-semibold text-text-primary">{buffName}</div>
          <div className="text-xs text-text-muted">{categoryName} &middot; +{(template.buffPerLevelBps / 100).toFixed(1)}% per level</div>
          <div className="text-[11px] text-text-gold">
            Level {currentLevel}/{template.maxLevel}
          </div>
        </div>
      </div>

      {/* NOVI balance */}
      <div className="rounded-lg bg-surface/60 px-3 py-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">Your NOVI</span>
          <span className={`font-mono tabular-nums ${hasEnoughNovi || isActiveForThis ? "text-text-gold" : "text-red-400"}`}>
            {noviBalance.toLocaleString()}
          </span>
        </div>
        {currentLevel < template.maxLevel && !isActiveForThis && (
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-zinc-500">Lv {currentLevel + 1} Cost</span>
            <span className="font-mono tabular-nums text-text-muted">
              {nextLevelCost.toLocaleString()} NOVI
            </span>
          </div>
        )}
        {!hasEnoughNovi && !isActiveForThis && currentLevel < template.maxLevel && (
          <div className="mt-1 text-[11px] text-red-400">
            Need {(nextLevelCost - noviBalance).toLocaleString()} more NOVI
          </div>
        )}
      </div>

      {/* Prerequisite warning */}
      {!canMeetPrereqs && (
        <div className="rounded-lg border border-red-800/50 bg-red-900/20 p-2 text-xs text-red-300">
          Requires research #{template.prerequisiteResearch} at level {template.prerequisiteLevel}
        </div>
      )}

      {/* Active research countdown */}
      {isActiveForThis && !isComplete && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-900/20 p-3 text-center">
          <div className="text-xs text-text-muted">Researching...</div>
          <GoldCountdown endsAt={progress!.completesAt.toNumber()} format="full" />
        </div>
      )}

      {/* Research complete — claim */}
      {isComplete && (
        <div className="rounded-lg border border-green-800/50 bg-green-900/20 p-3 text-center">
          <div className="mb-2 text-xs text-green-400">Research Complete!</div>
          <TxButton onClick={onComplete} className="w-full">
            Claim Research
          </TxButton>
        </div>
      )}

      {/* Cost Preview */}
      <div className="rounded-lg border border-zinc-800 bg-surface/50 p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Cost Preview
        </div>
        <div className="flex flex-wrap gap-2">
          {costPreview.slice(0, 6).map((r) => (
            <div
              key={r.level}
              className={`rounded border px-2 py-1 text-center ${
                r.level === currentLevel + 1
                  ? "border-amber-600 bg-amber-900/20"
                  : r.level <= currentLevel
                    ? "border-green-800/50 bg-green-900/10"
                    : "border-zinc-800"
              }`}
            >
              <div className="text-[11px] text-text-muted">Lv {r.level}</div>
              <div className="text-xs font-semibold text-text-gold">{r.cost.toLocaleString()}</div>
              <div className="text-[11px] text-text-muted">~{r.timeHours}h</div>
            </div>
          ))}
        </div>
        <div className="mt-2 text-[10px] text-text-muted">
          Gem speedup: {template.gemCostPerMinute} gems/min
        </div>
      </div>

      {/* Start actions — only when not actively researching */}
      {!isAnyActive && canMeetPrereqs && currentLevel < template.maxLevel && (
        <div className="flex flex-col gap-2">
          <TxButton onClick={onStart} className="w-full" disabled={!hasEnoughNovi}>
            {hasEnoughNovi
              ? `Start ${buffName} Lv ${currentLevel + 1}`
              : "Insufficient NOVI"}
          </TxButton>
          <GemAction
            onClick={onInstant}
            gemCost={template.gemCostPerMinute * Math.ceil(baseTime / 60)}
            gemBalance={gemBalance}
          >
            Instant Research
          </GemAction>
        </div>
      )}

      {/* Ascend — only at max level */}
      {!isAnyActive && currentLevel >= template.maxLevel && (
        <TxButton
          onClick={onAscend}
          className="w-full border-amber-500 bg-amber-900/30 text-text-gold hover:bg-amber-900/50"
        >
          Ascend {buffName}
        </TxButton>
      )}

      {/* In-progress actions */}
      {isActiveForThis && !isComplete && (
        <>
          <SpeedupPanel
            visible
            remainingSeconds={remainingSeconds}
            onSpeedup={onSpeedup}
            tiers={[
              { tier: 1, label: "Skip 1 Hour", description: "Skip 1 hour of research time", gemCost: template.gemCostPerMinute * 60 },
              { tier: 2, label: "Instant", description: "Complete all remaining time", gemCost: template.gemCostPerMinute * Math.ceil(remainingSeconds / 60) },
            ]}
            gemBalance={gemBalance}
          />
          <TxButton onClick={onCancel} variant="danger" className="w-full">
            Cancel Research
          </TxButton>
        </>
      )}

      {/* Already researching something else */}
      {isAnyActive && !isActiveForThis && (
        <div className="text-center text-xs text-text-muted">
          Another research is in progress. Cancel or complete it first.
        </div>
      )}
    </div>
  );
}

export function ResearchTab() {
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const buffs = useResearchBuffs();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  // Fetch on-chain data
  const { data: templates, isLoading: templatesLoading } = useResearchTemplates();
  const { data: progressData, isLoading: progressLoading } = useResearchProgress();
  const progress = progressData?.account ?? null;

  const [selectedResearch, setSelectedResearch] = useState<number>(-1);

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

  // Group templates by category
  const grouped = useMemo(() => {
    if (!templates) return {};
    const map: Record<string, ResearchTemplateAccount[]> = {};
    for (const t of templates) {
      const cat = CATEGORY_NAMES[t.category] ?? "Other";
      (map[cat] ??= []).push(t);
    }
    return map;
  }, [templates]);

  const selectedTemplate = useMemo(() => {
    return templates?.find((t) => t.researchType === selectedResearch) ?? null;
  }, [templates, selectedResearch]);

  const handleCreateProgress = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ix = createCreateProgressInstruction({
      owner: publicKey,
      gameEngine: client.gameEngine,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["research-progress"], ["player"]],
      successMessage: "Research unlocked!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleStart = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !selectedTemplate) throw new Error("Select a research type");
    const ix = createStartResearchInstruction({
      owner: publicKey,
      gameEngine: client.gameEngine,
      researchType: selectedTemplate.researchType,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["research-progress"], ["player"]],
      successMessage: "Research started!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleComplete = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !selectedTemplate) throw new Error("Select a research type");
    const ix = createCompleteResearchInstruction({
      payer: publicKey,
      gameEngine: client.gameEngine,
      playerOwner: publicKey,
      researchType: selectedTemplate.researchType,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["research-progress"], ["player"]],
      successMessage: "Research complete!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleInstantResearch = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !selectedTemplate) throw new Error("Select a research type");
    const ge = client.gameEngine;
    const rt = selectedTemplate.researchType;
    const startIx = createStartResearchInstruction({ owner: publicKey, gameEngine: ge, researchType: rt });
    const speedupIx = createSpeedUpResearchInstruction(
      { owner: publicKey, gameEngine: ge, researchType: rt },
      { speedUpSeconds: 0 },
    );
    const completeIx = createCompleteResearchInstruction({
      payer: publicKey, gameEngine: ge, playerOwner: publicKey, researchType: rt,
    });
    return transact.mutateAsync({
      instructions: [startIx, speedupIx, completeIx],
      invalidateKeys: [["research-progress"], ["player"]],
      successMessage: `${BUFF_NAMES[selectedTemplate.buffType] ?? "Research"} completed instantly!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleResearchSpeedup = async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !selectedTemplate) throw new Error("Select a research type");
    const speedUpSeconds = tier === 2 ? 0 : 3600;
    const ix = createSpeedUpResearchInstruction(
      { owner: publicKey, gameEngine: client.gameEngine, researchType: selectedTemplate.researchType },
      { speedUpSeconds },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["research-progress"], ["player"]],
      successMessage: "Research sped up!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleCancelResearch = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !selectedTemplate) throw new Error("Select a research type");
    const ix = createCancelResearchInstruction({
      owner: publicKey,
      gameEngine: client.gameEngine,
      researchType: selectedTemplate.researchType,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["research-progress"], ["player"]],
      successMessage: "Research cancelled!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleAscend = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !selectedTemplate) throw new Error("Select a research type");
    const ix = createAscendInstruction(
      { owner: publicKey, gameEngine: client.gameEngine },
      { researchType: selectedTemplate.researchType },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["research-progress"], ["player"]],
      successMessage: `${BUFF_NAMES[selectedTemplate.buffType] ?? "Research"} ascended!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const closePanel = useCallback(() => {
    setSelectedResearch(-1);
  }, []);

  const loading = templatesLoading || progressLoading;

  return (
    <div className="flex h-full flex-col gap-3">
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

      {/* Loading */}
      {loading && (
        <div className="card text-center text-sm text-text-muted">Loading research data...</div>
      )}

      {/* Research not initialized */}
      {!loading && progressData && !progressData.exists && (
        <div className="card text-center">
          <p className="mb-4 text-text-secondary">
            Unlock the research system to boost your abilities.
          </p>
          <TxButton onClick={handleCreateProgress}>Unlock Research</TxButton>
        </div>
      )}

      {/* No templates found */}
      {!loading && templates && templates.length === 0 && (
        <div className="card text-center text-sm text-text-muted">
          No research templates found on-chain.
        </div>
      )}

      {/* Research exists — 2-column on desktop */}
      {!loading && progressData?.exists && templates && templates.length > 0 && (
        <>
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

          {/* Main area: left grid + right detail */}
          <div className="min-h-0 flex-1 grid grid-cols-1 lg:grid-cols-3 gap-3 overflow-hidden">
            {/* Left — research types grid (scrollable) */}
            <div className="lg:col-span-2 overflow-y-auto space-y-4">
              {Object.entries(grouped).map(([category, catTemplates]) => (
                <div key={category}>
                  <h2 className="mb-2 text-sm font-semibold text-text-primary">{category}</h2>
                  <div className="grid gap-3 md:grid-cols-2">
                    {catTemplates.map((t) => {
                      const level = progress ? getResearchLevel(progress, t.researchType) : 0;
                      const isActiveHere = progress
                        ? isResearching(progress) && progress.currentResearch === t.researchType
                        : false;
                      const name = BUFF_NAMES[t.buffType] ?? `Research #${t.researchType}`;
                      return (
                        <button
                          key={t.researchType}
                          onClick={() => setSelectedResearch(t.researchType)}
                          className={`rounded-lg border p-4 text-left transition-all ${
                            selectedResearch === t.researchType
                              ? "border-amber-600 bg-amber-900/20"
                              : isActiveHere
                                ? "border-green-700 bg-green-900/10"
                                : "border-zinc-800 hover:border-zinc-700"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">{CATEGORY_ICONS[t.category] ?? "?"}</span>
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <div className="text-sm font-semibold text-text-primary">{name}</div>
                                <span className="text-[11px] text-text-gold">Lv {level}/{t.maxLevel}</span>
                              </div>
                              <div className="text-xs text-text-muted">
                                +{(t.buffPerLevelBps / 100).toFixed(1)}%/lv
                                {isActiveHere && <span className="ml-2 text-green-400">Researching...</span>}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <DetailPanel open={selectedResearch >= 0} onClose={closePanel}>
              {selectedTemplate ? (
                <ResearchDetailPanel
                  template={selectedTemplate}
                  progress={progress}
                  playerData={playerData}
                  onStart={handleStart}
                  onComplete={handleComplete}
                  onInstant={handleInstantResearch}
                  onCancel={handleCancelResearch}
                  onAscend={handleAscend}
                  onSpeedup={handleResearchSpeedup}
                  onClose={closePanel}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-xs text-text-muted">Select a research type to view details</p>
                </div>
              )}
            </DetailPanel>
          </div>
        </>
      )}
    </div>
  );
}
