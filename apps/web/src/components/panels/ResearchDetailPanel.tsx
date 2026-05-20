"use client";

import { useMemo, useCallback } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { SpeedupPanel } from "@/components/shared/SpeedupPanel";
import { GemAction } from "@/components/shared/GemAction";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import type { PanelAction } from "@/lib/store/right-panel";
import { BuildingId } from "@/lib/hooks/useFeatureGate";
import {
  derivePlayerPda,
  deriveResearchPda,
  deriveResearchTemplatePda,
  createStartResearchInstruction,
  createCompleteResearchInstruction,
  createSpeedUpResearchInstruction,
  createCancelResearchInstruction,
  createAscendInstruction,
  calculateResearchCost,
  parseResearchTemplate,
  parseResearchProgress,
  isResearching,
  isResearchComplete,
  getResearchLevel,
  checkResearchPrerequisites,
  findBuilding,
  getResearchName,
  getResearchNode,
  getResearchCategoryName,
} from "novus-mundus-sdk";
import type { ResearchTemplateAccount, ResearchProgressAccount } from "novus-mundus-sdk";

// Category icons are UI-only; node names/descriptions come from the SDK catalog.
const CATEGORY_ICONS: Record<number, string> = { 0: "\u2694", 1: "\uD83D\uDCE6", 2: "\u26A1" };

/** Minimum Academy level to start research, by category (Battle/Economy/Growth). */
const ACADEMY_REQUIRED: Record<number, number> = { 0: 1, 1: 5, 2: 10 };

/** Standalone research detail panel for the right panel store. */
export function ResearchPanel({
  researchType,
}: {
  researchType: number;
}) {
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const transact = useTransact();
  const close = useRightPanelStore((s) => s.close);

  // Fetch template
  const { data: template } = useQuery({
    queryKey: ["research-template", researchType],
    queryFn: async () => {
      const [pda] = deriveResearchTemplatePda(researchType);
      const info = await connection.getAccountInfo(pda);
      if (!info) return null;
      return parseResearchTemplate(info);
    },
    staleTime: 60_000,
  });

  // Fetch progress
  const { data: progressData } = useQuery({
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

  const progress = progressData?.account ?? null;

  const gemBalance = playerData?.account?.gems?.toNumber?.() ?? 0;
  const noviBalance = playerData?.account?.lockedNovi?.toNumber?.() ?? 0;

  const handleStart = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !template) throw new Error("Wallet not connected");
    const ix = createStartResearchInstruction({
      owner: publicKey, gameEngine: client.gameEngine, researchType: template.researchType,
    });
    return transact.mutateAsync({
      instructions: [ix], invalidateKeys: [["research-progress"], ["player"]],
      successMessage: "Research started!", onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleComplete = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !template) throw new Error("Wallet not connected");
    const ix = createCompleteResearchInstruction({
      payer: publicKey, gameEngine: client.gameEngine, playerOwner: publicKey,
      researchType: template.researchType,
    });
    return transact.mutateAsync({
      instructions: [ix], invalidateKeys: [["research-progress"], ["player"]],
      successMessage: "Research complete!", onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleInstant = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !template) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const rt = template.researchType;
    const buffName = getResearchName(rt);
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
      successMessage: `${buffName} completed instantly!`, onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleSpeedup = async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !template) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const rt = template.researchType;
    const buffName = getResearchName(rt);
    const speedUpSeconds = tier === 2 ? 0 : 3600;
    const instructions = [
      createSpeedUpResearchInstruction(
        { owner: publicKey, gameEngine: ge, researchType: rt },
        { speedUpSeconds },
      ),
    ];
    if (tier === 2) {
      instructions.push(
        createCompleteResearchInstruction({
          payer: publicKey, gameEngine: ge, playerOwner: publicKey, researchType: rt,
        }),
      );
    }
    return transact.mutateAsync({
      instructions, invalidateKeys: [["research-progress"], ["player"]],
      successMessage: tier === 2 ? `${buffName} completed instantly!` : "Research sped up!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleCancel = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !template) throw new Error("Wallet not connected");
    const ix = createCancelResearchInstruction({
      owner: publicKey, gameEngine: client.gameEngine, researchType: template.researchType,
    });
    return transact.mutateAsync({
      instructions: [ix], invalidateKeys: [["research-progress"], ["player"]],
      successMessage: "Research cancelled!", onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleAscend = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !template) throw new Error("Wallet not connected");
    const buffName = getResearchName(template.researchType);
    const ix = createAscendInstruction(
      { owner: publicKey, gameEngine: client.gameEngine },
      { researchType: template.researchType },
    );
    return transact.mutateAsync({
      instructions: [ix], invalidateKeys: [["research-progress"], ["player"]],
      successMessage: `${buffName} ascended!`, onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const morphActions = useMemo<PanelAction[] | null>(() => {
    if (!template) return null;
    const currentLevel = progress ? getResearchLevel(progress, template.researchType) : 0;
    const isActiveForThis = !!(
      progress &&
      isResearching(progress) &&
      progress.currentResearch === template.researchType
    );
    const nowSec = Math.floor(Date.now() / 1000);
    const isComplete = !!(progress && isActiveForThis && isResearchComplete(progress, nowSec));
    const isAnyActive = progress ? isResearching(progress) : false;
    const canMeetPrereqs = progress ? checkResearchPrerequisites(progress, template) : true;
    const academyLevel = estateData?.account
      ? findBuilding(estateData.account, BuildingId.Academy)?.level ?? 0
      : 0;
    const requiredAcademy = ACADEMY_REQUIRED[template.category] ?? 1;
    const meetsAcademy = academyLevel >= requiredAcademy;
    const buffName = getResearchName(template.researchType);
    const nextLevelCost = currentLevel < template.maxLevel
      ? calculateResearchCost(template.baseNoviCost.toNumber(), currentLevel + 1)
      : 0;
    const hasEnoughNovi = noviBalance >= nextLevelCost;

    if (isComplete) {
      return [
        {
          id: "claim-research",
          label: "Claim Research",
          variant: "primary" as const,
          onClick: handleComplete,
        },
      ];
    }
    if (!isAnyActive && canMeetPrereqs && meetsAcademy && currentLevel < template.maxLevel) {
      const baseTimeSec = template.baseTimeSeconds;
      const instantGemCost = template.gemCostPerMinute * Math.ceil(baseTimeSec / 60);
      const gems = playerData?.account?.gems?.toNumber?.() ?? 0;
      return [
        {
          id: "start-research",
          label: hasEnoughNovi
            ? `Start Lv ${currentLevel + 1}`
            : "Insufficient NOVI",
          variant: "primary" as const,
          disabled: !hasEnoughNovi,
          onClick: handleStart,
        },
        {
          id: "instant-research",
          label: "Instant",
          disabled: gems < instantGemCost,
          onClick: handleInstant,
        },
      ];
    }
    if (!isAnyActive && currentLevel >= template.maxLevel) {
      return [
        {
          id: "ascend",
          label: `Ascend ${buffName}`,
          variant: "primary" as const,
          onClick: handleAscend,
        },
      ];
    }
    if (isActiveForThis && !isComplete) {
      // Cancel stays inline (not in the morph bar) — destructive actions
      // shouldn't share weight with the gem speedups.
      const remainingMinutes = Math.max(1, Math.ceil(
        (progress.completesAt.toNumber() - nowSec) / 60,
      ));
      const t1Gems = template.gemCostPerMinute * 60;
      const t2Gems = template.gemCostPerMinute * remainingMinutes;
      const gems = playerData?.account?.gems?.toNumber?.() ?? 0;
      return [
        {
          id: "skip-hour",
          label: "Skip 1h",
          onClick: (rp) => handleSpeedup(1, rp),
          disabled: gems < t1Gems,
        },
        {
          id: "instant",
          label: "Instant",
          onClick: (rp) => handleSpeedup(2, rp),
          disabled: gems < t2Gems,
        },
      ];
    }
    return null;
  }, [
    template,
    progress,
    estateData,
    noviBalance,
    playerData,
    handleStart,
    handleComplete,
    handleAscend,
    handleCancel,
    handleSpeedup,
    handleInstant,
  ]);
  useMorphActions(morphActions);

  if (!template) {
    return <div className="text-xs text-text-muted">Loading research data...</div>;
  }

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
  const buffName = getResearchName(template.researchType);
  const categoryName = getResearchCategoryName(template.category);
  const description = getResearchNode(template.researchType)?.description;

  // Academy-level gate — research is hard-gated on-chain by the Academy
  // building level (Battle ≥1, Economy ≥5, Growth ≥10). Surface it like a
  // prerequisite so the player sees it before clicking Start, not as an
  // on-chain "building level too low" error after.
  const academyLevel = estateData?.account
    ? findBuilding(estateData.account, BuildingId.Academy)?.level ?? 0
    : 0;
  const requiredAcademy = ACADEMY_REQUIRED[template.category] ?? 1;
  const meetsAcademy = academyLevel >= requiredAcademy;

  const baseCost = template.baseNoviCost.toNumber();
  const baseTime = template.baseTimeSeconds;
  const nextLevelCost = currentLevel < template.maxLevel
    ? calculateResearchCost(baseCost, currentLevel + 1)
    : 0;
  const hasEnoughNovi = noviBalance >= nextLevelCost;

  // Cost preview — a rolling window of up to 6 *upcoming* levels starting at
  // the next one to research, so a mid-progress node shows what is ahead
  // rather than levels already completed. Near max level it backs up to keep
  // a full window in view.
  const PREVIEW_COUNT = 6;
  const firstPreviewLevel = Math.max(
    1,
    Math.min(currentLevel + 1, template.maxLevel - PREVIEW_COUNT + 1),
  );
  const costPreview = Array.from(
    { length: Math.max(0, Math.min(PREVIEW_COUNT, template.maxLevel - firstPreviewLevel + 1)) },
    (_, i) => {
      const level = firstPreviewLevel + i;
      return {
        level,
        cost: calculateResearchCost(baseCost, level),
        timeHours: Math.max(0.1, Math.round((baseTime * Math.pow(1.5, level)) / 360) / 10),
      };
    },
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Template info */}
      <div className="flex items-center gap-3">
        <span className="text-3xl">{CATEGORY_ICONS[template.category] ?? "?"}</span>
        <div>
          <div className="text-sm font-semibold text-text-primary">{buffName}</div>
          <div className="text-xs text-text-muted">{categoryName} &middot; +{(template.buffPerLevelBps / 100).toFixed(1)}% per level</div>
          <div className="text-[11px] text-text-gold">Level {currentLevel}/{template.maxLevel}</div>
        </div>
      </div>

      {/* Description */}
      {description && (
        <div className="-mt-1 text-xs leading-snug text-text-muted">{description}</div>
      )}

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
            <span className="font-mono tabular-nums text-text-muted">{nextLevelCost.toLocaleString()} NOVI</span>
          </div>
        )}
        {!hasEnoughNovi && !isActiveForThis && currentLevel < template.maxLevel && (
          <div className="mt-1 text-[11px] text-red-400">Need {(nextLevelCost - noviBalance).toLocaleString()} more NOVI</div>
        )}
      </div>

      {/* Prerequisite warning */}
      {!canMeetPrereqs && (
        <div className="rounded-lg border border-red-800/50 bg-red-900/20 p-2 text-xs text-red-300">
          Requires {getResearchName(template.prerequisiteResearch)} at level {template.prerequisiteLevel}
        </div>
      )}

      {/* Academy level gate */}
      {!meetsAcademy && (
        <div className="rounded-lg border border-red-800/50 bg-red-900/20 p-2 text-xs text-red-300">
          Academy level {requiredAcademy} required for {categoryName} research.
        </div>
      )}

      {isComplete && (
        <div className="rounded-lg border border-green-800/50 bg-green-900/20 p-3 text-center">
          <div className="mb-2 text-xs text-green-400">Research Complete!</div>
          <TxButton onClick={handleComplete} className="hidden w-full lg:block">Claim Research</TxButton>
        </div>
      )}

      {/* Cost Preview */}
      <div className="rounded-lg border border-zinc-800 bg-surface/50 p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Cost Preview</div>
        <div className="flex flex-wrap gap-2">
          {costPreview.map((r) => (
            <div key={r.level} className={`rounded border px-2 py-1 text-center ${
              r.level === currentLevel + 1 ? "border-amber-600 bg-amber-900/20"
                : r.level <= currentLevel ? "border-green-800/50 bg-green-900/10"
                : "border-zinc-800"
            }`}>
              <div className="text-[11px] text-text-muted">Lv {r.level}</div>
              <div className="text-xs font-semibold text-text-gold">{r.cost.toLocaleString()}</div>
              <div className="text-[11px] text-text-muted">~{r.timeHours}h</div>
            </div>
          ))}
        </div>
      </div>

      {/* Active research countdown */}
      {isActiveForThis && !isComplete && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-900/20 p-3 text-center">
          <div className="text-xs text-text-muted">Researching...</div>
          <GoldCountdown endsAt={progress!.completesAt.toNumber()} format="full" />
        </div>
      )}
      
      {!isAnyActive && canMeetPrereqs && meetsAcademy && currentLevel < template.maxLevel && (
        <div className="hidden flex-col gap-2 lg:flex">
          <TxButton onClick={handleStart} className="w-full" disabled={!hasEnoughNovi}>
            {hasEnoughNovi ? `Start ${buffName} Lv ${currentLevel + 1}` : "Insufficient NOVI"}
          </TxButton>
          <GemAction onClick={handleInstant} gemCost={template.gemCostPerMinute * Math.ceil(baseTime / 60)} gemBalance={gemBalance}>
            Instant Research
          </GemAction>
        </div>
      )}

      {!isAnyActive && currentLevel >= template.maxLevel && (
        <TxButton onClick={handleAscend} className="hidden w-full border-amber-500 bg-amber-900/30 text-text-gold hover:bg-amber-900/50 lg:block">
          Ascend {buffName}
        </TxButton>
      )}

      {/* In-progress actions */}
      {isActiveForThis && !isComplete && (
        <>
          <SpeedupPanel
            visible
            remainingSeconds={remainingSeconds}
            onSpeedup={handleSpeedup}
            tiers={[
              { tier: 1, label: "Skip 1 Hour", description: "Skip 1 hour of research time", gemCost: template.gemCostPerMinute * 60 },
              { tier: 2, label: "Instant", description: "Complete all remaining time", gemCost: template.gemCostPerMinute * Math.ceil(remainingSeconds / 60) },
            ]}
            gemBalance={gemBalance}
          />
          <TxButton onClick={handleCancel} variant="danger" className="w-full">Cancel Research</TxButton>
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
