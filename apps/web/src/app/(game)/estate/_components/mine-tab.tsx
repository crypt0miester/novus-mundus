"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GameIcon } from "@/components/shared/GameIcon";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { NoviGenerator } from "@/components/shared/NoviGenerator";
import { NumberField } from "@/components/shared/NumberField";
import { BuildingId, FEATURES, useFeatureGate } from "@/lib/hooks/useFeatureGate";
import { buildingFraming } from "@/lib/narrative";
import { FeatureLayout } from "./feature-layout";
import { ActivityForecast } from "./activity-forecast";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTimeOfDay } from "@/lib/estate/useTimeOfDay";
import { forecastCollect } from "@/lib/estate/forecast";
import { ActivityType, createCollectResourcesInstruction } from "novus-mundus-sdk";

// Gem mining is collection type 1 on-chain.
const COLLECTION_TYPE = 1;

export function MineTab() {
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const player = playerData?.account;
  const [collectNoviAmount, setCollectNoviAmount] = useState(100);

  const gate = useFeatureGate(FEATURES.COLLECT_MINING);
  const { data: geData } = useGameEngine();
  const { now } = useTimeOfDay();

  const handleCollect = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createCollectResourcesInstruction(
      { owner: publicKey, gameEngine: ge },
      { noviAmount: collectNoviAmount, collectionType: COLLECTION_TYPE },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Mined gems from the veins!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  if (!estateData?.exists) {
    return (
      <div className="card text-center">
        <p className="text-sm text-text-muted">Create an estate first to access the Mine.</p>
      </div>
    );
  }
  if (!player) return null;

  const noviBalance = player.lockedNovi?.toNumber?.() ?? 0;
  const gems = player.gems?.toNumber?.() ?? 0;
  const operativeUnits =
    (player.operativeUnit1?.toNumber?.() ?? 0) +
    (player.operativeUnit2?.toNumber?.() ?? 0) +
    (player.operativeUnit3?.toNumber?.() ?? 0);
  const hasEnough = noviBalance >= collectNoviAmount;

  const ge = geData?.account;
  const forecast = ge ? forecastCollect(collectNoviAmount, "mining", player, ge, now) : null;

  return (
    <FeatureLayout
      main={
        <>
          <p className="text-xs italic text-text-muted">{buildingFraming(BuildingId.Mine).line}</p>

          <NoviGenerator compact />

          {!gate.allowed && gate.missing.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {gate.missing.map((m) => (
                <Link
                  key={m.label}
                  href={m.href}
                  className="inline-flex items-center gap-1 rounded-md border border-border-gold/50 bg-accent/20 px-2.5 py-1 text-xs font-medium text-text-gold hover:bg-accent/40"
                >
                  {m.label}
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              ))}
            </div>
          )}

          {/* The ledger: NOVI spent down the shaft, gems carried back up. */}
          <div className="grid gap-2 grid-cols-2">
            <div className="card">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Sent Down</div>
              <div className="mt-1 font-mono text-sm tabular-nums text-text-gold">
                {noviBalance.toLocaleString()} NOVI on hand
              </div>
            </div>
            <div className="card">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Brought Up</div>
              <div className="mt-1">
                <span className="inline-flex items-center gap-1">
                  <GameIcon id="resource-gem" size={14} />
                  <GoldNumber value={gems} size="sm" glow={gems > 0} />
                </span>
              </div>
            </div>
          </div>
        </>
      }
      aside={
        gate.allowed ? (
          <div className="card">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Work the Veins
            </h4>
            <div className="space-y-3">
              <div
                className={`rounded-lg bg-surface-overlay px-2.5 py-1.5 text-xs font-semibold ${operativeUnits > 0 ? "tier-accent-text" : "text-text-muted"}`}
              >
                {operativeUnits > 0
                  ? `Operative Units: ${operativeUnits.toLocaleString()}`
                  : "No operative units"}
              </div>
              <NumberField
                label="NOVI to spend"
                value={collectNoviAmount}
                onChange={setCollectNoviAmount}
                min={1}
                max={noviBalance}
                suffix="NOVI"
              />
              <ActivityForecast activity={ActivityType.Consuming} verb="Mining">
                {operativeUnits > 0 && forecast ? (
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-text-muted">
                      {collectNoviAmount.toLocaleString()} NOVI →
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums text-text-gold">
                      ≥ {forecast.output.toLocaleString()}
                      <GameIcon id="resource-gem" size={12} />
                    </span>
                  </span>
                ) : (
                  <span className="text-text-muted">Hire operative units to start mining.</span>
                )}
              </ActivityForecast>
              <TxButton onClick={handleCollect} disabled={operativeUnits === 0 || !hasEnough}>
                {hasEnough ? "Mine Gems" : "Insufficient NOVI"}
              </TxButton>
            </div>
          </div>
        ) : undefined
      }
    />
  );
}
