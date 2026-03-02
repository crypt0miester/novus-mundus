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
import { useRightPanelStore } from "@/lib/store/right-panel";
import {
  derivePlayerPda,
  deriveResearchPda,
  deriveResearchTemplatePda,
  createCreateProgressInstruction,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  isTraveling,
  parseResearchTemplate,
  parseResearchProgress,
  isResearching,
  getResearchLevel,
} from "@/lib/sdk";
import type { ResearchTemplateAccount } from "@/lib/sdk";

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
    staleTime: 60_000,
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

export function ResearchTab() {
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const buffs = useResearchBuffs();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();
  const show = useRightPanelStore((s) => s.show);

  // Fetch on-chain data
  const { data: templates, isLoading: templatesLoading } = useResearchTemplates();
  const { data: progressData, isLoading: progressLoading } = useResearchProgress();
  const progress = progressData?.account ?? null;

  // Time-of-day indicator
  const now = Math.floor(Date.now() / 1000);
  const timeInfo = useMemo(() => {
    if (!player) return null;
    const longitude = player.currentLong ?? 0;
    const tod = getCurrentTimeOfDay(now, longitude / 10000);
    const researchMult = getActivityMultiplier('researching' as any, tod);
    return { name: getTimeOfDayName(tod), researchMult };
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

  const handleSelectResearch = useCallback(
    (researchType: number) => {
      const name = BUFF_NAMES[researchType] ?? `Research #${researchType}`;
      show(`${name} Research`, "research", { researchType });
    },
    [show]
  );

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
          <span className="text-[11px]">(Best at Deep Night, Dawn, Evening)</span>
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

      {/* Research exists — grid of research types */}
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

          {/* Research types grid — clicks open right panel */}
          <div className="min-h-0 flex-1 overflow-y-auto space-y-4">
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
                        onClick={() => handleSelectResearch(t.researchType)}
                        className={`rounded-lg border p-4 text-left transition-all ${
                          isActiveHere
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
        </>
      )}
    </div>
  );
}
