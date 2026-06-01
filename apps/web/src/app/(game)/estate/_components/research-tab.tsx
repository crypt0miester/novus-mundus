"use client";

import { useState, useMemo, useCallback } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useResearchBuffs } from "@/lib/hooks/useDerived";
import { BuildingId } from "@/lib/hooks/useFeatureGate";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { GameIcon, buffStatIcon } from "@/components/shared/GameIcon";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { cn } from "@/lib/utils";
import {
  derivePlayerPda,
  deriveResearchPda,
  deriveResearchTemplatePda,
  createCreateProgressInstruction,
  ActivityType,
  isTraveling,
  parseResearchTemplate,
  parseResearchProgress,
  isResearching,
  getResearchLevel,
  findBuilding,
  getResearchName,
  getResearchCategoryName,
} from "novus-mundus-sdk";
import type { ResearchTemplateAccount } from "novus-mundus-sdk";
import { ActivityForecast } from "./activity-forecast";
import { BuildingShowcase } from "./building-showcase";

// Category icons are UI-only; node names/descriptions come from the SDK catalog.
const CATEGORY_ICONS: Record<number, string> = { 0: "\u2694", 1: "\uD83D\uDCE6", 2: "\u26A1" };
/** Minimum Academy level to start research, by category (Battle/Economy/Growth). */
const ACADEMY_REQUIRED: Record<number, number> = { 0: 1, 1: 2, 2: 3 };

// ─── Fetch all initialized research templates (types 0-29) ──
function useResearchTemplates() {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["research-templates"],
    queryFn: async () => {
      const pdas = await Promise.all(
        Array.from({ length: 30 }, async (_, i) => (await deriveResearchTemplatePda(i))[0]),
      );
      const infos = await connection.getMultipleAccountsInfo(pdas);
      const templates: (ResearchTemplateAccount & { pda: string })[] = [];
      for (let i = 0; i < 30; i++) {
        const info = infos[i];
        if (!info) continue;
        const parsed = parseResearchTemplate(info);
        if (parsed?.isActive) {
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
      const [playerPda] = await derivePlayerPda(client.gameEngine, publicKey);
      const [researchPda] = await deriveResearchPda(playerPda);
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
  const { data: estateData } = useEstate();
  const player = playerData?.account;
  const buffs = useResearchBuffs();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();
  const show = useRightPanelStore((s) => s.show);
  const [activeCat, setActiveCat] = useState(0);

  // Fetch on-chain data
  const { data: templates, isLoading: templatesLoading } = useResearchTemplates();
  const { data: progressData, isLoading: progressLoading } = useResearchProgress();
  const progress = progressData?.account ?? null;

  // Academy building level — research is hard-gated by it (Battle ≥1,
  // Economy ≥2, Growth ≥3), so cards below this bar are shown locked.
  const academyLevel = estateData?.account
    ? (findBuilding(estateData.account, BuildingId.Academy)?.level ?? 0)
    : 0;

  // Traveling warning
  const travelWarning = useMemo(() => {
    if (!player) return null;
    return isTraveling(player) ? "Cannot research while traveling" : null;
  }, [player]);

  // Templates grouped by category, ordered by category number (Battle to
  // Economy to Growth). The view shows one category at a time.
  const categories = useMemo(() => {
    if (!templates) return [];
    const byNum = new Map<number, ResearchTemplateAccount[]>();
    for (const t of templates) {
      const list = byNum.get(t.category) ?? [];
      list.push(t);
      byNum.set(t.category, list);
    }
    return [...byNum.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([num, list]) => ({ num, name: getResearchCategoryName(num), templates: list }));
  }, [templates]);

  const currentCategory = categories.find((c) => c.num === activeCat) ?? categories[0] ?? null;

  const handleCreateProgress = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ix = await createCreateProgressInstruction({
      owner: publicKey,
      gameEngine: client.gameEngine,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["research-progress"], ["player"]],
        successMessage: "Research unlocked!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleSelectResearch = useCallback(
    (researchType: number) => {
      show(`${getResearchName(researchType)} Research`, "research", { researchType });
    },
    [show],
  );

  const loading = templatesLoading || progressLoading;

  return (
    // Content-driven height, matching the other estate tabs. The FeatureView
    // wrapper supplies the scroll; a former `h-full` here collapsed to 0 on
    // desktop when the flex height-chain did not resolve, hiding everything.
    <div className="flex flex-col gap-3">
      <BuildingShowcase buildingId={BuildingId.Academy} icon="buff-xp-gain" />
      {travelWarning && (
        <div className="rounded-lg border border-border-gold/50 bg-accent/20 p-3 text-sm text-danger">
          {travelWarning}
        </div>
      )}

      {/* Research speed swings with time of day — peaks at night. */}
      <ActivityForecast activity={ActivityType.Researching} verb="Research" />

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
                {buffs.map((buff) => {
                  const icon = buff.stat ? buffStatIcon(buff.stat) : undefined;
                  return (
                    <div
                      key={buff.label}
                      className="flex flex-col items-center gap-0.5 rounded-lg border border-zinc-800 p-3 text-center"
                    >
                      {icon && <GameIcon id={icon} title={buff.label} size={20} />}
                      <div className="text-xs text-text-muted">{buff.label}</div>
                      <div className="text-lg font-bold text-text-gold">
                        +{(buff.bps / 100).toFixed(1)}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Category toggle — one category at a time keeps the mobile list short. */}
          {currentCategory && (
            <div className="flex gap-1 rounded-lg bg-surface-overlay/40 p-1">
              {categories.map((c) => {
                const active = c.num === currentCategory.num;
                const locked = academyLevel < (ACADEMY_REQUIRED[c.num] ?? 1);
                return (
                  <button
                    key={c.num}
                    onClick={() => setActiveCat(c.num)}
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                      active
                        ? "bg-surface-raised text-text-primary"
                        : "text-text-muted hover:text-text-secondary",
                      locked && !active && "opacity-60",
                    )}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}

          {currentCategory && (
            <div>
              {academyLevel < (ACADEMY_REQUIRED[currentCategory.num] ?? 1) && (
                <p className="mb-2 text-xs text-red-400">
                  Requires Academy Lv {ACADEMY_REQUIRED[currentCategory.num] ?? 1}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {currentCategory.templates.map((t) => {
                  const level = progress ? getResearchLevel(progress, t.researchType) : 0;
                  const isActiveHere = progress
                    ? isResearching(progress) && progress.currentResearch === t.researchType
                    : false;
                  const name = getResearchName(t.researchType);
                  const locked = academyLevel < (ACADEMY_REQUIRED[t.category] ?? 1);
                  return (
                    <button
                      key={t.researchType}
                      onClick={() => handleSelectResearch(t.researchType)}
                      className={cn(
                        "rounded-lg border p-3 text-left transition-all",
                        isActiveHere
                          ? "border-green-700 bg-green-900/10"
                          : locked
                            ? "border-zinc-800/60 opacity-60 hover:opacity-90"
                            : "border-zinc-800 hover:border-zinc-700",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{CATEGORY_ICONS[t.category] ?? "?"}</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-text-primary">
                            {name}
                          </div>
                          <div className="text-[11px] text-text-gold">
                            Lv {level}/{t.maxLevel}
                          </div>
                        </div>
                      </div>
                      <div className="mt-1.5 text-[11px] text-text-muted">
                        +{(t.buffPerLevelBps / 100).toFixed(1)}%/lv
                        {isActiveHere && <span className="ml-1 text-green-400">· active</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
