"use client";

import { useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { usePlayer } from "./usePlayer";
import { useEstate } from "./useEstate";
import { useTransact } from "./useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import type { TxPhase } from "@/components/shared/TxButton";
import {
  createCreateEstateInstruction,
  createBuildBuildingInstruction,
  createUpgradeBuildingInstruction,
  createBuildingSpeedupInstruction,
  createCompleteBuildingInstruction,
  createBuyPlotInstruction,
  deriveBuildingTemplatePda,
  parseBuildingTemplate,
  calculateBuildingCost,
  calculateBuildingTime,
  findBuilding,
  BuildingStatus,
  type BuildingTemplateAccount,
} from "novus-mundus-sdk";
import { BUILDING_FEATURE_MAP } from "@/lib/config/building-features";

/**
 * Plot costs — must match the program's `EstateAccount::next_plot_cost()`
 * (φ² scaling from a 100k base). Display only; the chain computes the real
 * charge. Index = plots_owned, so [1] is the cost of the 2nd plot.
 */
const PLOT_COSTS = [0, 100_000, 261_800, 685_400, 1_794_400];

/** All 19 building type ids (BuildingType enum is dense 0-18). */
const BUILDING_TYPE_IDS = Array.from({ length: 19 }, (_, i) => i);

export function useEstateActions() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const client = useNovusMundusClient();
  const transact = useTransact();

  const estate = estateData?.account;
  const plotsOwned = estate?.plotsOwned ?? 1;
  const maxSlots = plotsOwned * 4;
  const canBuyPlot = plotsOwned < 5;
  const nextPlotCost = canBuyPlot ? (PLOT_COSTS[plotsOwned] ?? 0) : 0;

  // Building cost/time config is read live from the on-chain BuildingTemplate
  // PDAs (one per type), so the panel always shows what the tx will charge.
  const { data: buildingTemplates } = useQuery({
    queryKey: ["building-templates"],
    queryFn: async () => {
      const pdas = BUILDING_TYPE_IDS.map((id) => deriveBuildingTemplatePda(id)[0]);
      const infos = await connection.getMultipleAccountsInfo(pdas);
      const map = new Map<number, BuildingTemplateAccount>();
      infos.forEach((info, i) => {
        if (!info) return;
        const parsed = parseBuildingTemplate(info);
        if (parsed) map.set(BUILDING_TYPE_IDS[i]!, parsed);
      });
      return map;
    },
    staleTime: 300_000,
  });

  const handleCreateEstate = useCallback(
    async (reportPhase: (p: TxPhase) => void) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const ge = client.gameEngine;

      const playerCity = playerData?.account.currentCity;
      const ix = createCreateEstateInstruction(
        { gameEngine: ge, owner: publicKey },
        { cityId: playerCity! },
      );

      return transact
        .mutateAsync({
          instructions: [ix],
          successMessage: "Estate created!",
          onPhase: reportPhase,
        })
        .then((r) => r.signature);
    },
    [publicKey, client, transact, playerData],
  );

  const handleBuildOrUpgrade = useCallback(
    async (buildingType: number, reportPhase: (p: TxPhase) => void) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const ge = client.gameEngine;
      const slot = estate ? findBuilding(estate, buildingType) : null;
      const isUpgrade = slot?.status === BuildingStatus.Active;
      const name = BUILDING_FEATURE_MAP.get(buildingType)?.name ?? `Building #${buildingType}`;

      const ix = isUpgrade
        ? createUpgradeBuildingInstruction({ owner: publicKey, gameEngine: ge }, { buildingType })
        : createBuildBuildingInstruction(
            {
              gameEngine: ge,
              owner: publicKey,
            },
            { buildingType },
          );

      return transact
        .mutateAsync({
          instructions: [ix],
          invalidateKeys: [["estate"], ["player"]],
          successMessage: `${isUpgrade ? "Upgrading" : "Building"} ${name}!`,
          onPhase: reportPhase,
        })
        .then((r) => r.signature);
    },
    [publicKey, client, transact, estate],
  );

  const handleBuildingSpeedup = useCallback(
    async (
      buildingType: number,
      tier: number,
      reportPhase: (p: TxPhase) => void,
      count: number = 1,
    ) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const ge = client.gameEngine;
      const name = BUILDING_FEATURE_MAP.get(buildingType)?.name ?? `Building #${buildingType}`;
      // Hold-to-charge packs `count` speedups into one tx; each reads the live timer.
      const n = Math.max(1, Math.floor(count));
      const instructions = Array.from({ length: n }, () =>
        createBuildingSpeedupInstruction(
          { owner: publicKey, gameEngine: ge },
          { buildingType, speedupTier: tier as 1 | 2 },
        ),
      );
      return transact
        .mutateAsync({
          instructions,
          invalidateKeys: [["estate"], ["player"]],
          successMessage:
            n > 1 ? `${name} construction sped up ×${n}!` : `${name} construction sped up!`,
          onPhase: reportPhase,
        })
        .then((r) => r.signature);
    },
    [publicKey, client, transact],
  );

  const handleCompleteBuilding = useCallback(
    async (buildingType: number, reportPhase: (p: TxPhase) => void) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const ge = client.gameEngine;
      const name = BUILDING_FEATURE_MAP.get(buildingType)?.name ?? `Building #${buildingType}`;
      const ix = createCompleteBuildingInstruction(
        { owner: publicKey, gameEngine: ge },
        { buildingType },
      );
      return transact
        .mutateAsync({
          instructions: [ix],
          invalidateKeys: [["estate"], ["player"]],
          successMessage: `${name} construction complete!`,
          onPhase: reportPhase,
        })
        .then((r) => r.signature);
    },
    [publicKey, client, transact],
  );

  const handleBuyPlot = useCallback(
    async (reportPhase: (p: TxPhase) => void) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const ge = client.gameEngine;
      const ix = createBuyPlotInstruction({ owner: publicKey, gameEngine: ge });
      return transact
        .mutateAsync({
          instructions: [ix],
          invalidateKeys: [["estate"], ["player"]],
          successMessage: `Purchased plot ${plotsOwned + 1}! +4 building slots unlocked.`,
          onPhase: reportPhase,
        })
        .then((r) => r.signature);
    },
    [publicKey, client, transact, plotsOwned],
  );

  /**
   * Cost & time of the NEXT action on a building (build if empty, upgrade if
   * active), derived from the on-chain BuildingTemplate. Returns null while
   * the templates are still loading.
   */
  const getBuildCostInfo = useCallback(
    (buildingType: number) => {
      const t = buildingTemplates?.get(buildingType);
      if (!t) return null;
      const slot = estate ? findBuilding(estate, buildingType) : null;
      const isUpgrade = slot?.status === BuildingStatus.Active;
      const level = isUpgrade ? slot!.level : 0;
      const base = t.baseNoviCost.toNumber();
      return {
        baseCost: calculateBuildingCost(base, level, t.costGrowthBps),
        baseTimeHours: calculateBuildingTime(t.baseTimeSeconds, level, t.timeGrowthBps) / 3600,
        tier: t.tier,
        isUpgrade,
        level,
        maxLevel: t.maxLevel,
        atMaxLevel: isUpgrade && level >= t.maxLevel,
      };
    },
    [buildingTemplates, estate],
  );

  /**
   * A rolling window of up to 6 upcoming actions for a building, each entry's
   * `level` being the level the action is performed *from* (0 = the build).
   */
  const getUpgradeCostPreview = useCallback(
    (buildingType: number) => {
      const t = buildingTemplates?.get(buildingType);
      if (!t) return null;
      const slot = estate ? findBuilding(estate, buildingType) : null;
      const curLevel = slot?.level ?? 0;
      const base = t.baseNoviCost.toNumber();
      const COUNT = 6;
      const start = Math.max(0, Math.min(curLevel, t.maxLevel - COUNT + 1));
      const out: { level: number; cost: number; timeHours: number }[] = [];
      for (let i = 0; i < COUNT; i++) {
        const level = start + i;
        if (level > t.maxLevel) break;
        out.push({
          level,
          cost: calculateBuildingCost(base, level, t.costGrowthBps),
          timeHours: calculateBuildingTime(t.baseTimeSeconds, level, t.timeGrowthBps) / 3600,
        });
      }
      return out;
    },
    [buildingTemplates, estate],
  );

  return {
    handleCreateEstate,
    handleBuildOrUpgrade,
    handleBuildingSpeedup,
    handleCompleteBuilding,
    handleBuyPlot,
    getBuildCostInfo,
    getUpgradeCostPreview,
    plotsOwned,
    maxSlots,
    canBuyPlot,
    nextPlotCost,
  };
}
