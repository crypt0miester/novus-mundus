"use client";

import { useCallback, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayer } from "./usePlayer";
import { useEstate } from "./useEstate";
import { useGameEngine } from "./useGameEngine";
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
  calculateUpgradeCost,
  findBuilding,
  BuildingStatus,
} from "novus-mundus-sdk";
import { BUILDING_FEATURE_MAP } from "@/lib/config/building-features";

/**
 * Plot costs — must match the program's `EstateAccount::next_plot_cost()`
 * (φ² scaling from a 100k base). Display only; the chain computes the real
 * charge. Index = plots_owned, so [1] is the cost of the 2nd plot.
 */
const PLOT_COSTS = [0, 100_000, 261_800, 685_400, 1_794_400];

export function useEstateActions() {
  const { publicKey } = useWallet();
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const { data: geData } = useGameEngine();
  const client = useNovusMundusClient();
  const transact = useTransact();

  const estate = estateData?.account;
  const plotsOwned = estate?.plotsOwned ?? 1;
  const maxSlots = plotsOwned * 4;
  const canBuyPlot = plotsOwned < 5;
  const nextPlotCost = canBuyPlot ? PLOT_COSTS[plotsOwned] ?? 0 : 0;

  const handleCreateEstate = useCallback(
    async (reportPhase: (p: TxPhase) => void) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const ge = client.gameEngine;

      const playerCity = playerData?.account.currentCity;
      const ix = createCreateEstateInstruction(
        { gameEngine: ge, owner: publicKey },
        { cityId: playerCity! }
      );

      return transact
        .mutateAsync({
          instructions: [ix],
          successMessage: "Estate created!",
          onPhase: reportPhase,
        })
        .then((r) => r.signature);
    },
    [publicKey, client, transact]
  );

  const handleBuildOrUpgrade = useCallback(
    async (buildingType: number, reportPhase: (p: TxPhase) => void) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const ge = client.gameEngine;
      const slot = estate ? findBuilding(estate, buildingType) : null;
      const isUpgrade = slot?.status === BuildingStatus.Active;
      const name = BUILDING_FEATURE_MAP.get(buildingType)?.name ?? `Building #${buildingType}`;

      const ix = isUpgrade
        ? createUpgradeBuildingInstruction(
            { owner: publicKey, gameEngine: ge },
            { buildingType }
          )
        : createBuildBuildingInstruction(
            {
              gameEngine: ge,
              owner: publicKey,
            },
            { buildingType }
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
    [publicKey, client, transact, estate]
  );

  const handleBuildingSpeedup = useCallback(
    async (buildingType: number, tier: number, reportPhase: (p: TxPhase) => void) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const ge = client.gameEngine;
      const name = BUILDING_FEATURE_MAP.get(buildingType)?.name ?? `Building #${buildingType}`;
      const ix = createBuildingSpeedupInstruction(
        { owner: publicKey, gameEngine: ge },
        { buildingType, speedupTier: tier as 1 | 2 }
      );
      return transact
        .mutateAsync({
          instructions: [ix],
          invalidateKeys: [["estate"], ["player"]],
          successMessage: `${name} construction sped up!`,
          onPhase: reportPhase,
        })
        .then((r) => r.signature);
    },
    [publicKey, client, transact]
  );

  const handleCompleteBuilding = useCallback(
    async (buildingType: number, reportPhase: (p: TxPhase) => void) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const ge = client.gameEngine;
      const name = BUILDING_FEATURE_MAP.get(buildingType)?.name ?? `Building #${buildingType}`;
      const ix = createCompleteBuildingInstruction(
        { owner: publicKey, gameEngine: ge },
        { buildingType }
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
    [publicKey, client, transact]
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
    [publicKey, client, transact, plotsOwned]
  );

  /** Get build cost info for a given building type */
  const getBuildCostInfo = useCallback(
    (buildingType: number) => {
      const config = BUILDING_FEATURE_MAP.get(buildingType);
      if (!config) return null;
      const tier = config.tier;
      const baseCost = tier === 1 ? 1_000 : tier === 2 ? 2_000 : 3_000;
      const baseTimeHours = tier === 1 ? 4 : tier === 2 ? 12 : 24;
      const slot = estate ? findBuilding(estate, buildingType) : null;
      const isUpgrade = slot?.status === BuildingStatus.Active;
      const actualCost = isUpgrade
        ? calculateUpgradeCost(baseCost, slot!.level, 2.618)
        : baseCost;
      return { baseCost: actualCost, baseTimeHours, tier, isUpgrade, level: slot?.level ?? 0 };
    },
    [estate]
  );

  /** Get upgrade cost preview for a building */
  const getUpgradeCostPreview = useCallback(
    (buildingType: number) => {
      const config = BUILDING_FEATURE_MAP.get(buildingType);
      if (!config) return null;
      const tier = config.tier;
      const baseCost = tier === 1 ? 1_000 : tier === 2 ? 2_000 : 3_000;
      return [1, 2, 3, 4, 5].map((lvl) => ({
        level: lvl,
        cost: calculateUpgradeCost(baseCost, lvl, 2.618),
      }));
    },
    []
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
